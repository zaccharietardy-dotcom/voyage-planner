/**
 * Validateur de cohérence géographique
 *
 * Vérifie que toutes les activités, restaurants et lieux sont bien
 * dans la zone de la destination (pas en France si on voyage en Espagne)
 *
 * Distance maximale acceptée: 50km du centre-ville de destination
 */

import { Trip, TripItem, TripDay } from '../types';
import { calculateDistance, getCityCenterCoords } from './geocoding';
import { resolveCoordinates } from './coordsResolver';

// Distance maximale acceptée depuis le centre-ville (en km)
const MAX_DISTANCE_FROM_CENTER_KM = 50;

// Distance maximale pour les attractions touristiques principales (en km)
const MAX_DISTANCE_ATTRACTIONS_KM = 30;

// Distance maximale pour les restaurants (en km)
const MAX_DISTANCE_RESTAURANTS_KM = 15;

export interface GeoValidationError {
  type: 'ACTIVITY_WRONG_LOCATION' | 'RESTAURANT_WRONG_LOCATION' | 'ATTRACTION_TOO_FAR';
  dayNumber: number;
  itemId: string;
  itemTitle: string;
  itemLocation: { lat: number; lng: number };
  destinationCenter: { lat: number; lng: number };
  distanceKm: number;
  message: string;
}

export interface GeoValidationResult {
  valid: boolean;
  errors: GeoValidationError[];
  itemsRemoved: number;
}

/**
 * Valide qu'un lieu est dans la zone de destination
 */
export function isLocationInDestination(
  location: { lat: number; lng: number },
  destinationCenter: { lat: number; lng: number },
  maxDistanceKm: number = MAX_DISTANCE_FROM_CENTER_KM
): boolean {
  // Coordonnées invalides ou par défaut (0,0)
  if (!location.lat || !location.lng || (location.lat === 0 && location.lng === 0)) {
    return false; // Coordonnées manquantes ou (0,0) = invalide
  }

  const distance = calculateDistance(
    location.lat,
    location.lng,
    destinationCenter.lat,
    destinationCenter.lng
  );

  return distance <= maxDistanceKm;
}

/**
 * Calcule la distance entre deux points
 */
export function getDistanceFromDestination(
  location: { lat: number; lng: number },
  destinationCenter: { lat: number; lng: number }
): number {
  if (!location.lat || !location.lng || (location.lat === 0 && location.lng === 0)) {
    return 0;
  }

  return calculateDistance(
    location.lat,
    location.lng,
    destinationCenter.lat,
    destinationCenter.lng
  );
}

/**
 * Tente de résoudre les coordonnées d'un item via la chaîne exhaustive d'APIs
 * Si échec: marque l'item comme 'estimated' (sera visible dans les logs de qualité)
 * JAMAIS de jitter/random — résolution réelle uniquement
 */
async function fixItemCoordinates(
  item: TripItem,
  destinationCenter: { lat: number; lng: number },
  destination: string
): Promise<boolean> {
  const oldLat = item.latitude;
  const oldLng = item.longitude;

  // Tenter résolution via chaîne exhaustive (inclut maintenant validation distance)
  const resolved = await resolveCoordinates(item.title, destination, destinationCenter, item.type as 'attraction' | 'restaurant');
  if (resolved) {
    // Double-check: vérifier que le résultat est bien dans la zone de destination
    if (isLocationInDestination({ lat: resolved.lat, lng: resolved.lng }, destinationCenter, MAX_DISTANCE_FROM_CENTER_KM)) {
      item.latitude = resolved.lat;
      item.longitude = resolved.lng;
      item.dataReliability = 'verified';
      return true;
    } else {
      console.warn(`[GeoValidator] ⚠️ RESOLVED but too far: "${item.title}" → (${resolved.lat.toFixed(4)}, ${resolved.lng.toFixed(4)}) — rejected`);
    }
  }

  // Échec: garder les coords actuelles mais marquer comme estimated
  item.dataReliability = 'estimated';
  console.error(`[GeoValidator] ❌ UNRESOLVED: "${item.title}" — coords aberrantes (${oldLat?.toFixed(4)}, ${oldLng?.toFixed(4)}) conservées, marquées estimated`);
  return false;
}

/**
 * Valide la cohérence géographique d'un voyage complet
 * AMÉLIORATION: Au lieu de supprimer les items trop loin, on CORRIGE leurs coordonnées
 */
export async function validateTripGeography(
  trip: Trip,
  destinationCenter: { lat: number; lng: number },
  autoFix: boolean = true,
  destination: string = ''
): Promise<GeoValidationResult> {
  const errors: GeoValidationError[] = [];
  let itemsFixed = 0;
  const itemsToRemove: { dayIndex: number; itemId: string; title: string }[] = [];

  for (let dayIdx = 0; dayIdx < trip.days.length; dayIdx++) {
    const day = trip.days[dayIdx];
    for (const item of day.items) {
      // Ignorer les éléments sans coordonnées ou logistiques
      if (!item.latitude || !item.longitude) continue;
      if (['flight', 'transport', 'hotel', 'checkin', 'checkout', 'parking'].includes(item.type)) continue;

      const location = { lat: item.latitude, lng: item.longitude };
      const distance = getDistanceFromDestination(location, destinationCenter);

      // Déterminer la distance max selon le type
      let maxDistance = MAX_DISTANCE_FROM_CENTER_KM;
      if (item.type === 'activity') {
        maxDistance = MAX_DISTANCE_ATTRACTIONS_KM;
      } else if (item.type === 'restaurant') {
        maxDistance = MAX_DISTANCE_RESTAURANTS_KM;
      }

      if (distance > maxDistance) {
        errors.push({
          type: item.type === 'activity' ? 'ACTIVITY_WRONG_LOCATION' : 'RESTAURANT_WRONG_LOCATION',
          dayNumber: day.dayNumber,
          itemId: item.id,
          itemTitle: item.title,
          itemLocation: location,
          destinationCenter,
          distanceKm: Math.round(distance),
          message: `"${item.title}" est à ${Math.round(distance)}km de la destination (max: ${maxDistance}km)`
        });

        // Résolution via chaîne exhaustive d'APIs (pas de jitter)
        if (autoFix) {
          const fixed = await fixItemCoordinates(item, destinationCenter, destination);
          if (fixed) {
            itemsFixed++;
          } else if (distance > 100) {
            // Item outrageusement loin (>100km) ET toutes les APIs ont échoué
            // Supprimer plutôt que garder avec des coordonnées dans le mauvais pays
            itemsToRemove.push({ dayIndex: dayIdx, itemId: item.id, title: item.title });
            console.error(`[GeoValidator] 🗑️ SUPPRESSION: "${item.title}" — ${Math.round(distance)}km de la destination, irréparable`);
          }
        }
      }
    }
  }

  // Supprimer les items irréparables et ré-indexer
  let itemsRemoved = 0;
  for (const { dayIndex, itemId, title } of itemsToRemove) {
    const day = trip.days[dayIndex];
    const beforeLen = day.items.length;
    day.items = day.items.filter(item => item.id !== itemId);
    if (day.items.length < beforeLen) {
      itemsRemoved++;
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }

  const result: GeoValidationResult = {
    valid: errors.length === 0,
    errors,
    itemsRemoved: itemsFixed + itemsRemoved
  };

  return result;
}

/**
 * Filtre une liste de lieux pour ne garder que ceux dans la destination
 * Utilisable AVANT d'ajouter des activités/restaurants au voyage
 */
export function filterPlacesByDestination<T extends { latitude?: number; longitude?: number; name?: string }>(
  places: T[],
  destinationCenter: { lat: number; lng: number },
  maxDistanceKm: number = MAX_DISTANCE_FROM_CENTER_KM
): T[] {
  return places.filter(place => {
    if (!place.latitude || !place.longitude) return true;

    const distance = getDistanceFromDestination(
      { lat: place.latitude, lng: place.longitude },
      destinationCenter
    );

    if (distance > maxDistanceKm) {
      return false;
    }

    return true;
  });
}

/**
 * Vérifie si un pays correspond à la destination
 * Ex: "France" != "Spain" si destination = "Valencia"
 */
export function isCountryMatchingDestination(
  itemCountry: string | undefined,
  destinationCity: string
): boolean {
  if (!itemCountry) return true; // Pas d'info = on laisse passer

  // Mapping ville -> pays
  const CITY_COUNTRY_MAP: Record<string, string> = {
    // Espagne
    'barcelona': 'Spain',
    'barcelone': 'Spain',
    'madrid': 'Spain',
    'valencia': 'Spain',
    'valence': 'Spain',
    'seville': 'Spain',
    'séville': 'Spain',
    'malaga': 'Spain',
    'bilbao': 'Spain',
    'grenade': 'Spain',
    'granada': 'Spain',
    // France
    'paris': 'France',
    'lyon': 'France',
    'marseille': 'France',
    'nice': 'France',
    'bordeaux': 'France',
    'toulouse': 'France',
    'lille': 'France',
    'nantes': 'France',
    'strasbourg': 'France',
    // Italie
    'rome': 'Italy',
    'roma': 'Italy',
    'milan': 'Italy',
    'milano': 'Italy',
    'florence': 'Italy',
    'firenze': 'Italy',
    'venice': 'Italy',
    'venezia': 'Italy',
    'naples': 'Italy',
    'napoli': 'Italy',
    // Portugal
    'lisbon': 'Portugal',
    'lisbonne': 'Portugal',
    'lisboa': 'Portugal',
    'porto': 'Portugal',
    // Royaume-Uni
    'london': 'United Kingdom',
    'londres': 'United Kingdom',
    'edinburgh': 'United Kingdom',
    'édimbourg': 'United Kingdom',
    'manchester': 'United Kingdom',
    // Allemagne
    'berlin': 'Germany',
    'munich': 'Germany',
    'münchen': 'Germany',
    'frankfurt': 'Germany',
    'francfort': 'Germany',
    'hamburg': 'Germany',
    'hambourg': 'Germany',
    // Autres
    'amsterdam': 'Netherlands',
    'brussels': 'Belgium',
    'bruxelles': 'Belgium',
    'vienna': 'Austria',
    'vienne': 'Austria',
    'prague': 'Czech Republic',
    'athens': 'Greece',
    'athènes': 'Greece',
    'budapest': 'Hungary',
    'warsaw': 'Poland',
    'varsovie': 'Poland',
    'dublin': 'Ireland',
    'copenhagen': 'Denmark',
    'copenhague': 'Denmark',
    'stockholm': 'Sweden',
    'oslo': 'Norway',
    'helsinki': 'Finland',
    'zurich': 'Switzerland',
    'geneva': 'Switzerland',
    'genève': 'Switzerland',
  };

  const destLower = destinationCity.toLowerCase().trim();
  const expectedCountry = CITY_COUNTRY_MAP[destLower];

  if (!expectedCountry) return true; // Ville inconnue = on laisse passer

  // Normaliser le pays de l'item
  const itemCountryNormalized = itemCountry.toLowerCase().trim();
  const expectedCountryNormalized = expectedCountry.toLowerCase();

  // Vérifier correspondance
  const matches = itemCountryNormalized.includes(expectedCountryNormalized) ||
                  expectedCountryNormalized.includes(itemCountryNormalized);

  if (!matches) {
  }

  return matches;
}

/**
 * Extraction du pays depuis une adresse
 */
export function extractCountryFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;

  const addressLower = address.toLowerCase();

  // Chercher le pays à la fin de l'adresse
  const COUNTRY_PATTERNS = [
    { pattern: /,\s*france\s*$/i, country: 'France' },
    { pattern: /,\s*spain\s*$/i, country: 'Spain' },
    { pattern: /,\s*españa\s*$/i, country: 'Spain' },
    { pattern: /,\s*espagne\s*$/i, country: 'Spain' },
    { pattern: /,\s*italy\s*$/i, country: 'Italy' },
    { pattern: /,\s*italia\s*$/i, country: 'Italy' },
    { pattern: /,\s*italie\s*$/i, country: 'Italy' },
    { pattern: /,\s*portugal\s*$/i, country: 'Portugal' },
    { pattern: /,\s*germany\s*$/i, country: 'Germany' },
    { pattern: /,\s*deutschland\s*$/i, country: 'Germany' },
    { pattern: /,\s*allemagne\s*$/i, country: 'Germany' },
    { pattern: /,\s*united kingdom\s*$/i, country: 'United Kingdom' },
    { pattern: /,\s*uk\s*$/i, country: 'United Kingdom' },
    { pattern: /,\s*royaume-uni\s*$/i, country: 'United Kingdom' },
    { pattern: /,\s*netherlands\s*$/i, country: 'Netherlands' },
    { pattern: /,\s*pays-bas\s*$/i, country: 'Netherlands' },
    { pattern: /,\s*belgium\s*$/i, country: 'Belgium' },
    { pattern: /,\s*belgique\s*$/i, country: 'Belgium' },
  ];

  for (const { pattern, country } of COUNTRY_PATTERNS) {
    if (pattern.test(address)) {
      return country;
    }
  }

  return undefined;
}

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
    return true; // On laisse passer les lieux sans coordonnées
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
 * Corrige les coordonnées d'un item en les ramenant près du centre-ville
 * Au lieu de supprimer l'item, on le recentre avec un petit offset aléatoire
 */
function fixItemCoordinates(
  item: TripItem,
  destinationCenter: { lat: number; lng: number }
): void {
  // Ajouter un offset aléatoire pour éviter que tous les items soient au même endroit
  // Offset de ±0.01° ≈ ±1km
  const latOffset = (Math.random() - 0.5) * 0.02;
  const lngOffset = (Math.random() - 0.5) * 0.02;

  const oldLat = item.latitude;
  const oldLng = item.longitude;

  item.latitude = destinationCenter.lat + latOffset;
  item.longitude = destinationCenter.lng + lngOffset;
  item.dataReliability = 'estimated';

  console.log(`[GeoValidator] CORRIGÉ: "${item.title}" coords (${oldLat?.toFixed(4)}, ${oldLng?.toFixed(4)}) → (${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)})`);
}

/**
 * Valide la cohérence géographique d'un voyage complet
 * AMÉLIORATION: Au lieu de supprimer les items trop loin, on CORRIGE leurs coordonnées
 */
export function validateTripGeography(
  trip: Trip,
  destinationCenter: { lat: number; lng: number },
  autoFix: boolean = true
): GeoValidationResult {
  const errors: GeoValidationError[] = [];
  let itemsFixed = 0;

  console.log(`\n[GeoValidator] Validation géographique - Centre destination: ${destinationCenter.lat}, ${destinationCenter.lng}`);

  for (const day of trip.days) {
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

        // NOUVEAU: Corriger les coords au lieu de supprimer
        if (autoFix) {
          fixItemCoordinates(item, destinationCenter);
          itemsFixed++;
        }
      }
    }
  }

  const result: GeoValidationResult = {
    valid: errors.length === 0,
    errors,
    itemsRemoved: itemsFixed // Renommé mais garde la compatibilité
  };

  if (errors.length > 0) {
    console.log(`[GeoValidator] ${errors.length} erreur(s) géographique(s) détectée(s), ${itemsFixed} élément(s) corrigé(s)`);
  } else {
    console.log(`[GeoValidator] Voyage géographiquement cohérent ✓`);
  }

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
      console.log(`[GeoValidator] Filtré: "${place.name || 'inconnu'}" - ${Math.round(distance)}km (max: ${maxDistanceKm}km)`);
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
    console.log(`[GeoValidator] Pays incorrect: "${itemCountry}" != "${expectedCountry}" pour destination "${destinationCity}"`);
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

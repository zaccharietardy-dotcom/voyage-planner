/**
 * Validation des itinéraires logiques (Bug #3)
 *
 * Empêche la création d'itinéraires impossibles:
 * - Entre check-in et boarding (même bâtiment)
 * - Entre deux villes sans vol
 * - Marche > 2km
 *
 * Règles:
 * 1. Même localisation = pas d'itinéraire
 * 2. Même terminal d'aéroport (même ville) = pas d'itinéraire
 * 3. Villes différentes sans aéroport = impossible
 * 4. Marche > 2km = suggérer métro/bus
 */

import type { TripItem, TripItemType } from '../types';

/**
 * Distance maximale pour la marche à pied (en km)
 */
export const MAX_WALKING_DISTANCE_KM = 2;

/**
 * Types de lieux pour les itinéraires
 */
export type LocationType = 'home' | 'airport_terminal' | 'airport_parking' | 'city_location';

/**
 * Représente un lieu dans l'itinéraire
 */
export interface Location {
  type: LocationType;
  name: string;
  city: string;
  coords: { lat: number; lng: number };
}

/**
 * Résultat de la validation d'itinéraire
 */
export interface ItineraryValidationResult {
  /** L'itinéraire est-il logique? */
  logical: boolean;
  /** Raison du rejet (vide si logique) */
  reason: string;
}

/**
 * Résultat de la validation du mode de transport
 */
export interface TransportValidationResult {
  /** Le mode est-il valide pour la distance? */
  valid: boolean;
  /** Suggestion alternative si invalide */
  suggestion?: string;
}

/**
 * Normalise un nom de ville pour la comparaison
 * Gère les variations comme "Paris-CDG" → "paris"
 */
function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/-cdg$/i, '')
    .replace(/-orly$/i, '')
    .replace(/-airport$/i, '')
    .replace(/ airport$/i, '');
}

/**
 * Vérifie si deux villes sont les mêmes (avec normalisation)
 */
function isSameCity(city1: string, city2: string): boolean {
  return normalizeCity(city1) === normalizeCity(city2);
}

/**
 * Vérifie si un itinéraire entre deux lieux est logique
 *
 * RÈGLES:
 * 1. Même lieu (même nom et type) = pas d'itinéraire
 * 2. Deux terminaux d'aéroport dans la même ville = pas d'itinéraire
 * 3. Villes différentes sans passer par l'aéroport = impossible
 *
 * @param from Lieu de départ
 * @param to Lieu d'arrivée
 * @returns Résultat avec logical: true/false et reason
 */
export function isLogicalItinerary(
  from: Location,
  to: Location
): ItineraryValidationResult {
  // Règle 1: Même lieu = pas d'itinéraire
  if (from.type === to.type && from.name === to.name) {
    return {
      logical: false,
      reason: `Cannot create itinerary between same location: ${from.name}`,
    };
  }

  // Règle 2: Deux terminaux d'aéroport dans la même ville = pas d'itinéraire
  // (ex: check-in → boarding sont dans le même bâtiment)
  if (
    from.type === 'airport_terminal' &&
    to.type === 'airport_terminal' &&
    isSameCity(from.city, to.city)
  ) {
    return {
      logical: false,
      reason: `Check-in to boarding are in same airport, no itinerary needed`,
    };
  }

  // Règle 3: Villes différentes
  if (!isSameCity(from.city, to.city)) {
    // 3a: Si l'un des deux est un aéroport, c'est potentiellement valide
    // (ex: arrivée à l'aéroport de Barcelona → hôtel à Barcelona)
    const fromIsAirport = from.type === 'airport_terminal' || from.type === 'airport_parking';
    const toIsAirport = to.type === 'airport_terminal' || to.type === 'airport_parking';

    // Si aucun n'est un aéroport, c'est impossible sans vol
    if (!fromIsAirport && !toIsAirport) {
      return {
        logical: false,
        reason: `Cannot travel between different cities (${from.city} → ${to.city}) without flight`,
      };
    }

    // Si le départ est un aéroport/parking mais la destination est une ville différente
    // sans que ce soit un terminal d'arrivée, c'est illogique
    if (fromIsAirport && !toIsAirport && !isSameCity(from.city, to.city)) {
      // Vérifier si c'est un cas valide: aéroport d'arrivée → ville
      // Pour cela, le "from" doit être un terminal (pas un parking)
      // et les villes doivent correspondre à l'aéroport de destination
      if (from.type === 'airport_parking') {
        return {
          logical: false,
          reason: `Cannot travel from ${from.city} parking to ${to.city} without flight`,
        };
      }
    }
  }

  // Itinéraire logique
  return {
    logical: true,
    reason: '',
  };
}

/**
 * Valide si un mode de transport est approprié pour la distance
 *
 * @param distanceKm Distance en kilomètres
 * @param transport Mode de transport proposé
 * @returns Résultat avec valid: true/false et suggestion
 */
export function validateTransportMode(
  distanceKm: number,
  transport: 'walking' | 'metro' | 'bus' | 'car' | 'taxi' | 'train'
): TransportValidationResult {
  // Règle: Marche limitée à MAX_WALKING_DISTANCE_KM
  if (transport === 'walking' && distanceKm > MAX_WALKING_DISTANCE_KM) {
    return {
      valid: false,
      suggestion: `Distance is ${distanceKm.toFixed(1)}km. Use metro/bus instead of walking.`,
    };
  }

  return { valid: true };
}

/**
 * Détermine si un itinéraire doit être créé entre deux lieux
 *
 * Retourne false pour les cas où aucun itinéraire n'est nécessaire:
 * - Check-in → Boarding (même bâtiment)
 * - Villes différentes sans aéroport
 *
 * @param from Lieu de départ
 * @param to Lieu d'arrivée
 * @returns true si un itinéraire doit être créé
 */
export function shouldCreateItinerary(from: Location, to: Location): boolean {
  const validation = isLogicalItinerary(from, to);
  return validation.logical;
}

/**
 * Calcule la distance entre deux coordonnées (formule de Haversine)
 */
export function calculateDistanceKm(
  coords1: { lat: number; lng: number },
  coords2: { lat: number; lng: number }
): number {
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(coords2.lat - coords1.lat);
  const dLon = toRad(coords2.lng - coords1.lng);
  const lat1 = toRad(coords1.lat);
  const lat2 = toRad(coords2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Suggère le mode de transport optimal en fonction de la distance
 */
export function suggestTransportMode(
  distanceKm: number
): 'walking' | 'metro' | 'bus' | 'car' | 'taxi' {
  if (distanceKm <= MAX_WALKING_DISTANCE_KM) {
    return 'walking';
  }
  if (distanceKm <= 10) {
    return 'metro';
  }
  if (distanceKm <= 30) {
    return 'bus';
  }
  return 'car';
}

/**
 * Génère la raison d'un itinéraire (pourquoi on se déplace)
 */
export function generateItineraryReason(from: Location, to: Location): string {
  if (from.type === 'home') {
    if (to.type === 'airport_parking' || to.type === 'airport_terminal') {
      return 'Drive from home to airport';
    }
    return `Go from home to ${to.name}`;
  }

  if (from.type === 'airport_parking') {
    return 'Take luggage to airport check-in';
  }

  if (from.type === 'airport_terminal' && to.type === 'city_location') {
    return `Transfer from airport to ${to.name}`;
  }

  if (from.type === 'city_location' && to.type === 'city_location') {
    return `Go from ${from.name} to ${to.name}`;
  }

  if (to.type === 'airport_terminal' || to.type === 'airport_parking') {
    return `Go to airport for departure`;
  }

  return `Travel from ${from.name} to ${to.name}`;
}

// =============================================================================
// NOUVELLES FONCTIONS POUR FILTRER LES ITINERAIRES DANS L'UI (Bug #3)
// =============================================================================

/**
 * Transitions qui ne nécessitent PAS d'itinéraire affiché
 * (même bâtiment, étapes automatiques, ou gérées par un tiers)
 */
const NO_ITINERARY_TRANSITIONS: Array<[TripItemType, TripItemType]> = [
  // Aéroport - même bâtiment ou étapes internes
  ['checkin', 'flight'],     // Enregistrement -> embarquement (même terminal)
  ['flight', 'luggage'],     // Vol -> récup bagages (pilote gère le vol)
  ['parking', 'checkin'],    // Parking navette -> terminal (navette automatique)

  // Vol - pas de déplacement utilisateur (le pilote gère)
  ['flight', 'transport'],   // Après le vol, transfert vers la ville

  // Bagages - transitions dans la même zone
  ['luggage', 'transport'],  // Récup bagages -> sortie aéroport
  ['luggage', 'luggage'],    // Dépôt puis récup consigne (même lieu)

  // Hôtel - même bâtiment
  ['hotel', 'checkout'],     // Check-in -> Check-out (pas applicable, jours différents)
];

/**
 * Détermine si un itinéraire doit être affiché entre deux TripItems
 *
 * Retourne false pour les transitions qui n'ont pas de valeur pratique:
 * - Même bâtiment (check-in → vol)
 * - Étapes gérées automatiquement (vol → bagages)
 * - Lieux très proches (< 100m)
 *
 * @param fromItem Item de départ
 * @param toItem Item d'arrivée
 * @returns true si un itinéraire doit être affiché
 */
export function shouldShowItinerary(
  fromItem: TripItem,
  toItem: TripItem
): boolean {
  const fromType = fromItem.type;
  const toType = toItem.type;

  // Règle 1: Vérifier les transitions blacklistées (même bâtiment ou auto)
  for (const [from, to] of NO_ITINERARY_TRANSITIONS) {
    if (fromType === from && toType === to) {
      return false;
    }
  }

  // Règle 2: Vol - pas d'itinéraire affiché (le pilote gère le trajet aérien)
  // Ni DEPUIS un vol, ni VERS un vol
  if (fromType === 'flight' || toType === 'flight') {
    return false;
  }

  // Règle 3: Même lieu (coordonnées très proches < 100m)
  if (fromItem.latitude && toItem.latitude && fromItem.longitude && toItem.longitude) {
    const distance = calculateDistanceKm(
      { lat: fromItem.latitude, lng: fromItem.longitude },
      { lat: toItem.latitude, lng: toItem.longitude }
    );
    if (distance < 0.1) { // < 100m
      return false;
    }
  }

  // Règle 4: Transport inclut déjà l'itinéraire (ex: "Transfert Aéroport → Hôtel")
  // On montre l'itinéraire APRÈS le transport, pas avant
  if (fromType === 'transport' && (toType === 'hotel' || toType === 'luggage')) {
    return false;
  }

  // Par défaut, afficher l'itinéraire
  return true;
}

/**
 * Détermine le mode d'affichage d'un itinéraire
 *
 * @param fromItem Item de départ
 * @param toItem Item d'arrivée
 * @returns 'full' (avec détails), 'compact' (résumé), ou 'hidden'
 */
export function getItineraryDisplayMode(
  fromItem: TripItem,
  toItem: TripItem
): 'full' | 'compact' | 'hidden' {
  // Hidden: transitions sans valeur
  if (!shouldShowItinerary(fromItem, toItem)) {
    return 'hidden';
  }

  // Full: activité → activité, restaurant → activité (navigation importante)
  const isActivityOrRestaurant = (type: TripItemType) =>
    type === 'activity' || type === 'restaurant';

  if (isActivityOrRestaurant(fromItem.type) && isActivityOrRestaurant(toItem.type)) {
    return 'full';
  }

  // Compact: autres cas (hôtel → activité, etc.)
  return 'compact';
}

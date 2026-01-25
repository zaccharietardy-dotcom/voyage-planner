/**
 * Calcul réaliste des temps de transport (Bug #5)
 *
 * Inclut:
 * - Temps d'attente pour les transports en commun
 * - Vitesses réalistes par mode
 * - Validation distance/mode
 *
 * Vitesses moyennes:
 * - Marche: 5 km/h
 * - Métro: 30 km/h (incluant arrêts)
 * - Bus: 20 km/h (incluant arrêts et trafic)
 * - Voiture: 35 km/h (trafic urbain)
 * - Train: 60 km/h (trains urbains/régionaux)
 * - Taxi: 30 km/h (trafic moyen)
 */

/**
 * Types de transport supportés
 */
export type TransportMode = 'walking' | 'car' | 'bus' | 'metro' | 'train' | 'taxi';

/**
 * Vitesses moyennes par mode de transport (km/h)
 */
export const TRANSPORT_SPEEDS: Record<TransportMode, number> = {
  walking: 5,   // 5 km/h = 12 min/km
  car: 35,      // 35 km/h en ville avec trafic
  bus: 20,      // 20 km/h avec arrêts fréquents
  metro: 30,    // 30 km/h incluant temps d'arrêt
  train: 60,    // 60 km/h trains urbains
  taxi: 30,     // 30 km/h trafic moyen
};

/**
 * Temps d'attente moyen par mode (minutes)
 */
export const WAIT_TIMES: Record<TransportMode, number> = {
  walking: 0,   // Pas d'attente
  car: 5,       // Temps pour récupérer la voiture
  bus: 10,      // Attente moyenne bus
  metro: 5,     // Attente moyenne métro
  train: 10,    // Attente train + accès quai
  taxi: 8,      // Attente taxi/VTC
};

/**
 * Distance maximale recommandée pour la marche (km)
 */
export const MAX_WALKING_DISTANCE = 2;

/**
 * Calcule la durée de transport (temps de trajet + attente)
 *
 * @param distanceKm Distance en kilomètres
 * @param mode Mode de transport
 * @returns Durée totale en minutes
 */
export function calculateDuration(
  distanceKm: number,
  mode: TransportMode
): number {
  const speed = TRANSPORT_SPEEDS[mode];
  const waitTime = WAIT_TIMES[mode];

  // Temps de trajet en minutes
  const travelTime = (distanceKm / speed) * 60;

  // Durée totale = trajet + attente
  const total = Math.ceil(travelTime) + waitTime;

  // Minimum 5 minutes pour tout trajet
  return Math.max(total, 5);
}

/**
 * Estime le temps de trajet réaliste avec temps d'attente
 *
 * Alias de calculateDuration pour compatibilité
 *
 * @param distanceKm Distance en kilomètres
 * @param mode Mode de transport
 * @returns Durée estimée en minutes
 */
export function estimateRealisticTravelTime(
  distanceKm: number,
  mode: TransportMode
): number {
  return calculateDuration(distanceKm, mode);
}

/**
 * Résultat de la validation du transport
 */
export interface TransportValidation {
  /** Le mode est-il valide pour cette distance? */
  valid: boolean;
  /** Raison si invalide */
  reason?: string;
  /** Avertissement (valide mais pas optimal) */
  warning?: string;
}

/**
 * Valide si un mode de transport est approprié pour la distance
 *
 * @param distanceKm Distance en kilomètres
 * @param mode Mode de transport proposé
 * @returns Résultat de validation
 */
export function validateTransportForDistance(
  distanceKm: number,
  mode: TransportMode
): TransportValidation {
  // Règle 1: Marche limitée à 2km
  if (mode === 'walking' && distanceKm > MAX_WALKING_DISTANCE) {
    return {
      valid: false,
      reason: `Distance ${distanceKm.toFixed(1)}km too long for walking (max ${MAX_WALKING_DISTANCE}km)`,
    };
  }

  // Règle 2: Métro/bus pour très courte distance = inefficace
  if ((mode === 'metro' || mode === 'bus') && distanceKm < 0.8) {
    return {
      valid: true,
      warning: `Short distance (${distanceKm.toFixed(1)}km) - consider walk instead`,
    };
  }

  // Règle 3: Voiture pour très courte distance = inefficace
  if ((mode === 'car' || mode === 'taxi') && distanceKm < 2) {
    return {
      valid: true,
      warning: `Short distance - public transport or walking might be faster`,
    };
  }

  return { valid: true };
}

/**
 * Suggère le meilleur mode de transport pour une distance donnée
 *
 * @param distanceKm Distance en kilomètres
 * @returns Mode de transport recommandé
 */
export function suggestBestTransport(distanceKm: number): TransportMode {
  // < 1 km: marche
  if (distanceKm < 1) {
    return 'walking';
  }

  // 1-2 km: marche ou métro selon préférence
  if (distanceKm <= 2) {
    return 'walking';
  }

  // 2-5 km: métro optimal
  if (distanceKm <= 5) {
    return 'metro';
  }

  // 5-15 km: bus ou métro
  if (distanceKm <= 15) {
    return 'bus';
  }

  // > 15 km: voiture/taxi
  return 'car';
}

/**
 * Calcule le temps de trajet entre deux activités
 *
 * @param fromCoords Coordonnées de départ
 * @param toCoords Coordonnées d'arrivée
 * @param mode Mode de transport (optionnel, auto-suggest si non fourni)
 * @returns Objet avec durée, distance et mode
 */
export function calculateTransportBetweenActivities(
  fromCoords: { lat: number; lng: number },
  toCoords: { lat: number; lng: number },
  mode?: TransportMode
): {
  duration: number;
  distanceKm: number;
  mode: TransportMode;
  suggestion?: string;
} {
  // Calculer la distance (Haversine)
  const distanceKm = haversineDistance(fromCoords, toCoords);

  // Suggérer le mode si non fourni
  const selectedMode = mode || suggestBestTransport(distanceKm);

  // Valider le mode
  const validation = validateTransportForDistance(distanceKm, selectedMode);

  // Calculer la durée
  const duration = calculateDuration(distanceKm, selectedMode);

  return {
    duration,
    distanceKm,
    mode: selectedMode,
    suggestion: validation.warning || validation.reason,
  };
}

/**
 * Calcule la distance entre deux points (formule de Haversine)
 */
function haversineDistance(
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
 * Formate une durée en texte lisible
 *
 * @param minutes Durée en minutes
 * @returns Texte formaté (ex: "1h30" ou "25 min")
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h${remainingMinutes}`;
}

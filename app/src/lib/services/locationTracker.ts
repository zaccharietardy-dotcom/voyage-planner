/**
 * Service de suivi de localisation du voyageur (Bug #1 & #9)
 *
 * Garantit la cohérence géographique des itinéraires:
 * - L'utilisateur ne peut visiter que des activités dans sa ville actuelle
 * - Pendant un vol (transit), aucune activité n'est possible
 * - Après le vol retour, l'utilisateur est de nouveau dans la ville d'origine
 *
 * Types de localisation:
 * - 'home': Domicile (ville d'origine)
 * - 'airport': Terminal d'aéroport (toujours dans une ville)
 * - 'city': En ville (destination ou origine)
 * - 'transit': En vol (pas de ville associée)
 */

/**
 * Représente la localisation actuelle du voyageur
 */
export interface TravelerLocation {
  /** Type de lieu */
  type: 'home' | 'airport' | 'city' | 'transit';
  /** Ville actuelle (vide si en transit) */
  city: string;
  /** Description du lieu */
  description: string;
  /** Horodatage de la dernière mise à jour */
  timestamp: Date;
}

/**
 * Informations sur un vol
 */
export interface FlightEvent {
  /** État du vol */
  status: 'boarding' | 'in_flight' | 'landed';
  /** Ville de départ */
  originCity: string;
  /** Ville d'arrivée */
  destinationCity: string;
  /** Heure d'arrivée (si atterri) */
  arrivalTime?: string;
}

/**
 * Résultat de la validation de localisation
 */
export interface LocationValidationResult {
  /** L'activité est-elle valide pour la localisation actuelle? */
  valid: boolean;
  /** Raison du rejet (vide si valide) */
  reason: string;
}

import { normalizeCitySync } from './cityNormalization';

/**
 * Normalise un nom de ville (utilise le service unifié)
 */
function normalizeCity(city: string): string {
  const result = normalizeCitySync(city);
  return result.normalized;
}

/**
 * Crée la localisation initiale du voyageur (à son domicile)
 *
 * @param originCity Ville d'origine (ex: "Paris")
 * @param description Description du lieu (ex: "Igny, France")
 * @returns Localisation initiale de type 'home'
 */
export function createInitialLocation(
  originCity: string,
  description: string
): TravelerLocation {
  return {
    type: 'home',
    city: normalizeCity(originCity),
    description,
    timestamp: new Date(),
  };
}

/**
 * Met à jour la localisation selon un événement de vol
 *
 * - boarding: Passe en 'transit' (pas de ville)
 * - in_flight: Reste en 'transit'
 * - landed: Passe en 'city' avec la ville de destination
 *
 * @param previousLocation Localisation précédente
 * @param flight Informations sur le vol
 * @returns Nouvelle localisation
 */
export function updateLocationOnFlightEvent(
  previousLocation: TravelerLocation,
  flight: FlightEvent
): TravelerLocation {
  const timestamp = new Date();

  switch (flight.status) {
    case 'boarding':
    case 'in_flight':
      // En transit: pas de ville associée
      return {
        type: 'transit',
        city: '', // Vide pendant le vol
        description: `En vol ${flight.originCity} → ${flight.destinationCity}`,
        timestamp,
      };

    case 'landed':
      // Atterri: la ville actuelle est la destination
      const arrivalInfo = flight.arrivalTime ? ` à ${flight.arrivalTime}` : '';
      return {
        type: 'city',
        city: normalizeCity(flight.destinationCity),
        description: `Arrivé à ${flight.destinationCity}${arrivalInfo}`,
        timestamp,
      };

    default:
      return previousLocation;
  }
}

/**
 * Valide si une activité est cohérente avec la localisation actuelle
 *
 * RÈGLES:
 * 1. En transit (vol) → aucune activité possible
 * 2. Sinon → l'activité doit être dans la même ville que l'utilisateur
 *
 * @param currentLocation Localisation actuelle du voyageur
 * @param activity Activité à valider { city, name }
 * @returns Résultat avec valid: true/false et reason
 */
export function validateActivityLocation(
  currentLocation: TravelerLocation,
  activity: { city: string; name: string }
): LocationValidationResult {
  // Règle 1: Pas d'activités pendant le vol
  if (currentLocation.type === 'transit') {
    return {
      valid: false,
      reason: `Impossible de suggérer "${activity.name}" pendant le transit (en vol)`,
    };
  }

  // Règle 2: L'activité doit être dans la même ville
  const activityCity = normalizeCity(activity.city);
  const currentCity = normalizeCity(currentLocation.city);

  if (activityCity !== currentCity) {
    return {
      valid: false,
      reason: `"${activity.name}" est à ${activity.city}, mais vous êtes à ${currentLocation.city}`,
    };
  }

  return {
    valid: true,
    reason: '',
  };
}

/**
 * Vérifie si le voyageur est en transit (vol)
 */
export function isInTransit(location: TravelerLocation): boolean {
  return location.type === 'transit';
}

/**
 * Retourne la ville actuelle du voyageur
 *
 * @returns Ville (normalisée) ou null si en transit
 */
export function getCurrentCity(location: TravelerLocation): string | null {
  if (location.type === 'transit' || !location.city) {
    return null;
  }
  return normalizeCity(location.city);
}

/**
 * Vérifie si une liste d'activités est valide pour la localisation actuelle
 *
 * @param location Localisation actuelle
 * @param activities Liste d'activités à valider
 * @returns Liste des activités invalides avec leurs raisons
 */
export function validateActivitiesList(
  location: TravelerLocation,
  activities: Array<{ city: string; name: string }>
): Array<{ activity: { city: string; name: string }; reason: string }> {
  const invalid: Array<{ activity: { city: string; name: string }; reason: string }> = [];

  for (const activity of activities) {
    const result = validateActivityLocation(location, activity);
    if (!result.valid) {
      invalid.push({ activity, reason: result.reason });
    }
  }

  return invalid;
}

/**
 * Crée un tracker de localisation pour un voyage complet
 *
 * Usage:
 * ```typescript
 * const tracker = createLocationTracker('Paris', 'Igny');
 * tracker.boardFlight('Paris', 'Barcelona');
 * tracker.landFlight('Barcelona', '12:30');
 * console.log(tracker.getCurrentLocation().city); // 'barcelona'
 * ```
 */
export function createLocationTracker(originCity: string, description: string) {
  let currentLocation = createInitialLocation(originCity, description);

  return {
    /** Retourne la localisation actuelle */
    getCurrentLocation(): TravelerLocation {
      return { ...currentLocation };
    },

    /** Passe au terminal d'aéroport */
    goToAirport(airportName: string): void {
      currentLocation = {
        ...currentLocation,
        type: 'airport',
        description: airportName,
        timestamp: new Date(),
      };
    },

    /** Embarque dans un vol */
    boardFlight(originCity: string, destinationCity: string): void {
      currentLocation = updateLocationOnFlightEvent(currentLocation, {
        status: 'boarding',
        originCity,
        destinationCity,
      });
    },

    /** Atterrit à destination */
    landFlight(destinationCity: string, arrivalTime?: string): void {
      currentLocation = updateLocationOnFlightEvent(currentLocation, {
        status: 'landed',
        originCity: '', // Non utilisé pour landed
        destinationCity,
        arrivalTime,
      });
    },

    /** Valide une activité */
    validateActivity(activity: { city: string; name: string }): LocationValidationResult {
      return validateActivityLocation(currentLocation, activity);
    },

    /** Vérifie si en transit */
    isInTransit(): boolean {
      return isInTransit(currentLocation);
    },

    /** Retourne la ville actuelle (null si en transit) */
    getCurrentCity(): string | null {
      return getCurrentCity(currentLocation);
    },
  };
}

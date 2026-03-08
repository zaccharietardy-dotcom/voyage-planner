import {
  TripPreferences,
  TripItem,
  TripItemType,
  Flight,
  ParkingOption,
  TransportOptionSummary,
  Accommodation,
  BudgetStrategy,
} from './types';
import { AirportInfo, calculateDistance, getCityCenterCoords, getCityCenterCoordsAsync, geocodeAddress } from './services/geocoding';
import { formatFlightDuration } from './services/flights';
import { calculateParkingTime } from './services/parking';
import { estimateMealPrice } from './services/restaurants';
import { Attraction, estimateTravelTime } from './services/attractions';
import { getDirections, generateGoogleMapsUrl, generateGoogleMapsSearchUrl, generateGoogleMapsDirectionsUrl } from './services/directions';
import { TransportOption, getTrainBookingUrl } from './services/transport';
import { DayScheduler, formatTime as formatScheduleTime, parseTime } from './services/scheduler';
import { searchLuggageStorage, selectBestStorage, needsLuggageStorage } from './services/luggageStorage';
import { createLocationTracker } from './services/locationTracker';
import { generateFlightLink, formatDateForUrl } from './services/linkGenerator';
import { BudgetTracker } from './services/budgetTracker';
import { LateFlightArrivalData } from './tripFlights';
import { generateId, normalizeToLocalDate, formatTime, pickDirectionMode, getAccommodationBookingUrl, getHotelLocationName, getReliableGoogleMapsPlaceUrl, getBudgetPriceLevel } from './tripUtils';
import { shouldSelfCater, findRestaurantForMeal } from './tripMeals';

// Types internes
export interface TimeSlot {
  start: Date;
  end: Date;
  type: 'available' | 'meal' | 'logistics';
}

export interface DayContext {
  dayNumber: number;
  date: Date;
  availableFrom: Date;
  availableUntil: Date;
  cityCenter: { lat: number; lng: number };
}

/**
 * Calcule le contexte d'une journée (heures disponibles)
 */
export function getDayContext(
  dayNumber: number,
  date: Date,
  isFirstDay: boolean,
  isLastDay: boolean,
  outboundFlight: Flight | null,
  returnFlight: Flight | null,
  cityCenter: { lat: number; lng: number },
  groundTransport?: TransportOption | null
): DayContext {
  // Par défaut: 9h - 22h
  let availableFrom = new Date(date);
  availableFrom.setHours(9, 0, 0, 0);

  let availableUntil = new Date(date);
  availableUntil.setHours(22, 0, 0, 0);

  // Premier jour: disponible après arrivée + transfert
  if (isFirstDay) {
    if (outboundFlight) {
      const arrivalTime = new Date(outboundFlight.arrivalTime);
      // +1h30 pour bagages + transfert + check-in hôtel
      availableFrom = new Date(arrivalTime.getTime() + 90 * 60 * 1000);
    } else if (groundTransport) {
      // Transport terrestre: utiliser horaires réels si dispo, sinon 8h + durée
      let arrivalTime: Date;
      if (groundTransport.transitLegs?.length) {
        const lastLeg = groundTransport.transitLegs[groundTransport.transitLegs.length - 1];
        arrivalTime = new Date(lastLeg.arrival);
      } else {
        const departureTime = new Date(date);
        departureTime.setHours(8, 0, 0, 0);
        arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      }
      availableFrom = new Date(arrivalTime.getTime() + 50 * 60 * 1000); // +50min pour arriver à l'hôtel et s'installer
    }
  }

  // Dernier jour: disponible jusqu'au check-out / départ
  if (isLastDay) {
    if (returnFlight) {
      const departureTime = new Date(returnFlight.departureTime);
      // -3h30 pour check-out + transfert + enregistrement
      availableUntil = new Date(departureTime.getTime() - 210 * 60 * 1000);
    } else if (groundTransport) {
      // Transport terrestre: disponible jusqu'à 1h30 avant le départ (check-out + se rendre à la gare)
      // Vérifier que les transitLegs correspondent au jour retour (pas l'aller)
      const legsMatchDate = groundTransport.transitLegs?.length &&
        new Date(groundTransport.transitLegs[0].departure).toDateString() === date.toDateString();
      if (legsMatchDate) {
        const firstLeg = groundTransport.transitLegs![0];
        const realDep = new Date(firstLeg.departure);
        availableUntil = new Date(realDep.getTime() - 90 * 60 * 1000);
      } else {
        availableUntil = new Date(date);
        availableUntil.setHours(12, 0, 0, 0); // Disponible jusqu'à midi avant check-out
      }
    }
  }

  return {
    dayNumber,
    date,
    availableFrom,
    availableUntil,
    cityCenter,
  };
}

/**
 * Récupère les coordonnées du dernier item placé qui a des coordonnées valides.
 * Utilisé pour passer une position précise à findRestaurantForMeal().
 */
function getLastItemCoords(
  items: TripItem[],
  fallback: { lat: number; lng: number }
): { lat: number; lng: number } {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].latitude && items[i].longitude) {
      return { lat: items[i].latitude!, lng: items[i].longitude! };
    }
  }
  return fallback;
}

/**
 * Convertit un ScheduleItem en TripItem
 *
 * IMPORTANT: Génère automatiquement googleMapsPlaceUrl par recherche de nom
 * pour éviter les problèmes de coordonnées GPS incorrectes (hallucinations).
 *
 * Google Maps trouvera automatiquement le vrai lieu par son nom.
 *
 * Pour les items de type 'transport', on génère un lien de DIRECTIONS au lieu
 * d'un lien de RECHERCHE, car le titre contient "A → B" qui n'est pas un lieu.
 */
export function schedulerItemToTripItem(
  item: import('./services/scheduler').ScheduleItem,
  dayNumber: number,
  orderIndex: number,
  extra: Partial<TripItem> & { dataReliability?: 'verified' | 'estimated' | 'generated' }
): TripItem {
  // Extraire la ville depuis locationName (format: "Adresse, Ville" ou "Centre-ville, Barcelona")
  const locationParts = extra.locationName?.split(',') || [];
  const city = locationParts.length > 0 ? locationParts[locationParts.length - 1].trim() : undefined;

  let googleMapsPlaceUrl: string;

  // Pour les items de type 'transport', générer un lien de DIRECTIONS
  // car locationName contient "Origine → Destination" (ex: "Rome Fiumicino → Centre-ville")
  if (item.type === 'transport' && extra.locationName?.includes('→')) {
    // Extraire origine et destination depuis locationName (format: "Origine → Destination")
    const [origin, destination] = extra.locationName.split('→').map(s => s.trim());
    if (origin && destination) {
      // Utiliser les coordonnées si disponibles, sinon utiliser les noms
      if (extra.latitude && extra.longitude) {
        // On a les coordonnées de destination, générer un lien avec coordonnées
        googleMapsPlaceUrl = `https://www.google.com/maps/dir/?api=1&destination=${extra.latitude},${extra.longitude}&travelmode=transit`;
      } else {
        // Utiliser les noms de lieux
        googleMapsPlaceUrl = generateGoogleMapsDirectionsUrl(origin, destination, city || '', 'transit');
      }
    } else {
      // Fallback: utiliser le nom de destination
      googleMapsPlaceUrl = generateGoogleMapsSearchUrl(destination || extra.locationName || '', city);
    }
  } else {
    // Pour tous les autres types, utiliser le nom du lieu pour la recherche
    const placeName = extra.title || item.title;
    googleMapsPlaceUrl = generateGoogleMapsSearchUrl(placeName, city);
  }

  // Déterminer la fiabilité des données:
  // - 'verified' si passé explicitement (données réelles de SerpAPI)
  // - 'estimated' si données partiellement vérifiées
  // - 'verified' par défaut pour les éléments de transport (vol, transfert, checkin, etc.)
  // - 'generated' pour les activités de remplissage
  const logisticsTypes = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'hotel', 'luggage'];
  const isLogistics = logisticsTypes.includes(item.type);
  const reliability = extra.dataReliability || (isLogistics ? 'verified' : 'generated');

  return {
    id: item.id,
    dayNumber,
    startTime: formatScheduleTime(item.slot.start),
    endTime: formatScheduleTime(item.slot.end),
    type: item.type as TripItem['type'],
    title: item.title,
    orderIndex,
    timeFromPrevious: item.travelTimeFromPrevious,
    googleMapsPlaceUrl, // Lien fiable par nom ou directions pour transport
    dataReliability: reliability as 'verified' | 'estimated' | 'generated',
    ...extra,
  } as TripItem;
}

// ============================================
// Route Optimization: minimise la distance intra-journée
// ============================================

/**
 * Calcule la distance totale d'un itinéraire depuis un point de départ.
 */
function totalRouteDistance(
  attractions: Attraction[],
  startCoords: { lat: number; lng: number }
): number {
  let total = 0;
  let prev = startCoords;
  for (const a of attractions) {
    total += calculateDistance(prev.lat, prev.lng, a.latitude || 0, a.longitude || 0);
    prev = { lat: a.latitude || prev.lat, lng: a.longitude || prev.lng };
  }
  return total;
}

/**
 * Vérifie que l'ordre proposé respecte les contraintes d'horaires d'ouverture.
 * Simule le parcours séquentiel pour s'assurer qu'on arrive avant la fermeture.
 */
function validateTimeConstraints(
  attractions: Attraction[],
  startCoords: { lat: number; lng: number },
  date: Date,
  periodEnd: Date,
  currentTime: Date,
): boolean {
  let simulatedTime = currentTime.getTime();
  let prev = startCoords;

  for (const a of attractions) {
    const travelTime = estimateTravelTime(
      { latitude: prev.lat, longitude: prev.lng } as Attraction,
      a
    );
    simulatedTime += travelTime * 60 * 1000;

    const openTime = parseTime(date, a.openingHours.open).getTime();
    const closeTime = parseTime(date, a.openingHours.close).getTime();
    const safeClose = closeTime - 30 * 60 * 1000;

    // Si on arrive avant l'ouverture, on attend
    if (simulatedTime < openTime) {
      simulatedTime = openTime;
    }

    // Si on arrive après la fermeture (marge 30min), invalide
    if (simulatedTime > safeClose) {
      return false;
    }

    // Vérifier qu'on finit avant la limite de période
    const endTime = simulatedTime + a.duration * 60 * 1000;
    if (endTime > periodEnd.getTime()) {
      return false;
    }

    simulatedTime = endTime;
    prev = { lat: a.latitude || prev.lat, lng: a.longitude || prev.lng };
  }
  return true;
}

/**
 * Optimise l'ordre des attractions pour minimiser la distance totale,
 * en respectant les contraintes d'horaires d'ouverture.
 *
 * Phase 1: Nearest-neighbor itératif depuis startCoords
 * Phase 2: 2-opt avec validation des contraintes temporelles
 */
function optimizeAttractionOrder(
  attractions: Attraction[],
  startCoords: { lat: number; lng: number },
  date: Date,
  periodEnd: Date,
  currentTime: Date,
): Attraction[] {
  if (attractions.length <= 2) return attractions;

  // Phase 1: Nearest-neighbor itératif
  const result: Attraction[] = [];
  const remaining = new Set<number>(attractions.map((_, i) => i));
  let currentPos = { lat: startCoords.lat, lng: startCoords.lng };

  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const idx of remaining) {
      const a = attractions[idx];
      const dist = calculateDistance(currentPos.lat, currentPos.lng, a.latitude || 0, a.longitude || 0);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }
    result.push(attractions[bestIdx]);
    currentPos = {
      lat: attractions[bestIdx].latitude || currentPos.lat,
      lng: attractions[bestIdx].longitude || currentPos.lng,
    };
    remaining.delete(bestIdx);
  }

  // Phase 2: 2-opt — essayer d'inverser des segments pour réduire la distance
  const ordered = [...result];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < ordered.length - 1; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const candidate = [...ordered];
        const segment = candidate.splice(i, j - i + 1);
        segment.reverse();
        candidate.splice(i, 0, ...segment);

        const oldDist = totalRouteDistance(ordered, startCoords);
        const newDist = totalRouteDistance(candidate, startCoords);

        if (newDist < oldDist - 0.01) {
          if (validateTimeConstraints(candidate, startCoords, date, periodEnd, currentTime)) {
            ordered.splice(0, ordered.length, ...candidate);
            improved = true;
          }
        }
      }
    }
  }

  return ordered;
}

export async function generateDayWithScheduler(params: {
  dayNumber: number;
  date: Date;
  isFirstDay: boolean;
  isLastDay: boolean;
  attractions: Attraction[];
  allAttractions?: Attraction[]; // TOUTES les attractions du voyage pour remplissage des trous
  preferences: TripPreferences;
  cityCenter: { lat: number; lng: number };
  outboundFlight: Flight | null;
  returnFlight: Flight | null;
  groundTransport: TransportOption | null;
  originAirport: AirportInfo;
  destAirport: AirportInfo;
  parking: ParkingOption | null;
  accommodation: import('./types').Accommodation | null;
  tripUsedAttractionIds: Set<string>; // ANTI-DOUBLON: Set partagé entre tous les jours
  locationTracker: ReturnType<typeof createLocationTracker>; // LOCATION TRACKING: Validation géographique
  budgetStrategy?: BudgetStrategy; // Stratégie budget pour repas self_catered vs restaurant
  budgetTracker?: BudgetTracker; // Suivi budget en temps réel
  lateFlightArrivalData?: LateFlightArrivalData | null; // Vol tardif du jour précédent à traiter
  isDayTrip?: boolean; // Day trip: relax city validation
  dayTripDestination?: string; // Day trip destination city name
  groceriesDone?: boolean; // true si les courses ont déjà été faites (on peut cuisiner)
  prefetchedRestaurants?: Map<string, import('./types').Restaurant | null>; // Pre-fetched restaurants keyed by "dayIndex-mealType"
  prefetchedLuggageStorages?: import('./services/luggageStorage').LuggageStorage[] | null; // Pre-fetched luggage storage results
}): Promise<{ items: TripItem[]; lateFlightForNextDay?: LateFlightArrivalData }> {
  const {
    dayNumber,
    date,
    isFirstDay,
    isLastDay,
    attractions,
    allAttractions = attractions, // Par défaut, utiliser les attractions du jour
    preferences,
    cityCenter,
    outboundFlight,
    returnFlight,
    groundTransport,
    originAirport,
    destAirport,
    parking,
    accommodation,
    tripUsedAttractionIds, // ANTI-DOUBLON: Set partagé entre tous les jours
    locationTracker, // LOCATION TRACKING: Validation géographique
    budgetStrategy, // Stratégie budget pour repas
    budgetTracker, // Suivi budget en temps réel
    lateFlightArrivalData, // Vol tardif à traiter en début de journée
    isDayTrip,
    dayTripDestination,
    groceriesDone,
    prefetchedRestaurants,
    prefetchedLuggageStorages,
  } = params;

  // Date de début du voyage normalisée (pour les URLs de réservation)
  // Évite les erreurs de timezone: "2026-01-27T23:00:00.000Z" → 27 janvier, pas 28
  const tripStartDate = normalizeToLocalDate(preferences.startDate);

  // Déterminer les heures de disponibilité
  let dayStart = parseTime(date, '08:00');

  // RÈGLE 3: Si nightlife sélectionné, journées jusqu'à minuit
  const hasNightlife = preferences.activities?.includes('nightlife') ?? false;
  let dayEnd = parseTime(date, hasNightlife ? '23:59' : '23:00');

  // Ajuster selon les contraintes de transport
  // JOUR 1: On NE PEUT PAS faire d'activités à destination AVANT d'y arriver!
  if (isFirstDay) {
    if (outboundFlight) {
      // Vol aller: disponible après arrivée + transfert + check-in hôtel
      const arrivalTime = new Date(outboundFlight.arrivalTime);
      // Vérifier que la date est valide
      if (isNaN(arrivalTime.getTime())) {
        console.error(`[Jour ${dayNumber}] ERREUR: arrivalTime invalide, utilisation de 20:00 par défaut`);
        dayStart = parseTime(date, '21:30'); // 20:00 + 1h30
      } else {
        // +1h30 après arrivée (transfert aéroport + check-in hôtel)
        dayStart = new Date(arrivalTime.getTime() + 90 * 60 * 1000);
      }
    } else if (groundTransport) {
      // Transport terrestre: disponible après arrivée + check-in hôtel
      let arrivalTime: Date;
      if (groundTransport.transitLegs?.length) {
        const lastLeg = groundTransport.transitLegs[groundTransport.transitLegs.length - 1];
        arrivalTime = new Date(lastLeg.arrival);
      } else {
        const departureTime = parseTime(date, '08:00');
        arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      }
      dayStart = new Date(arrivalTime.getTime() + 15 * 60 * 1000); // +15min buffer (check-in est un fixed item)
    }
  }

  if (isLastDay) {
    if (returnFlight) {
      // Dernier jour avec vol: checkout cappé à 12h, activités possibles entre checkout et transfert aéroport
      const departureTime = new Date(returnFlight.departureTime);
      const checkoutByFlight = new Date(departureTime.getTime() - 210 * 60 * 1000);
      const checkoutByStandard = parseTime(date, '12:00');
      const checkoutTime = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
      // Activités possibles jusqu'au transfert aéroport (2h avant vol)
      const transferToAirport = new Date(departureTime.getTime() - 120 * 60 * 1000);

      if (checkoutTime <= dayStart) {
        dayEnd = dayStart;
      } else {
        // Activités entre checkout et transfert (pas juste jusqu'au checkout)
        dayEnd = transferToAirport > checkoutTime ? transferToAirport : checkoutTime;
      }
    } else if (groundTransport) {
      // Dernier jour transport terrestre: activités possibles APRÈS check-out (10:30) jusqu'au départ (14:00)
      // Le check-out (10:00-10:30) et le transport retour (14:00) sont des fixed items
      // On étend dayEnd jusqu'à 13:30 pour permettre des activités entre check-out et départ
      const targetEnd = parseTime(date, '13:30'); // 30min avant transport retour (14:00)

      if (targetEnd <= dayStart) {
        dayEnd = dayStart;
      } else {
        dayEnd = targetEnd;
      }
    }
  }

  // Créer le scheduler pour ce jour
  const scheduler = new DayScheduler(date, dayStart, dayEnd);
  const items: TripItem[] = [];
  let orderIndex = 0;

  // === INSERTION PRÉCOCE: Transport retour dernier jour ===
  // Insérer le transport retour comme fixed item AVANT les activités,
  // pour que le scheduler refuse automatiquement tout ce qui chevauche.
  let returnTransportAlreadyInserted = false;
  let earlyReturnTransportItem: import('./services/scheduler').ScheduleItem | null = null;

  if (isLastDay && groundTransport) {
    let earlyStart: Date;
    let earlyEnd: Date;
    // Vérifier que les transitLegs correspondent au jour retour (pas ceux de l'aller)
    const legsMatchReturnDate = groundTransport.transitLegs?.length &&
      new Date(groundTransport.transitLegs[0].departure).toDateString() === date.toDateString();
    if (legsMatchReturnDate) {
      const firstLeg = groundTransport.transitLegs![0];
      const lastLeg = groundTransport.transitLegs![groundTransport.transitLegs!.length - 1];
      earlyStart = new Date(new Date(firstLeg.departure).getTime() - 30 * 60 * 1000);
      earlyEnd = new Date(lastLeg.arrival);
    } else {
      earlyStart = parseTime(date, '14:00');
      earlyEnd = new Date(earlyStart.getTime() + groundTransport.totalDuration * 60 * 1000);
    }
    earlyReturnTransportItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Transport retour → ${preferences.origin}`,
      type: 'transport',
      startTime: earlyStart,
      endTime: earlyEnd,
    });
    if (earlyReturnTransportItem) {
      returnTransportAlreadyInserted = true;
    }
  }

  // === INSERTION PRÉCOCE: Checkout dernier jour ===
  // Pré-insérer le checkout comme fixed item AVANT les activités,
  // pour que le scheduler décale automatiquement les activités autour du checkout.
  let earlyCheckoutItem: import('./services/scheduler').ScheduleItem | null = null;
  let checkoutAlreadyInserted = false;

  if (isLastDay && !isFirstDay) {
    let checkoutStart: Date;
    if (returnFlight) {
      const flightDep = new Date(returnFlight.departureTime);
      const checkoutByFlight = new Date(flightDep.getTime() - 210 * 60 * 1000); // 3h30 avant vol
      const checkoutByStandard = parseTime(date, '12:00');
      checkoutStart = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
    } else if (groundTransport) {
      checkoutStart = parseTime(date, accommodation?.checkOutTime || '10:00');
    } else {
      checkoutStart = parseTime(date, '11:00');
    }
    const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
    const hotelNameEarly = accommodation?.name || 'Hébergement';
    earlyCheckoutItem = scheduler.insertFixedItem({
      id: generateId(),
      title: `Check-out ${hotelNameEarly}`,
      type: 'checkout',
      startTime: checkoutStart,
      endTime: checkoutEnd,
    });
    if (earlyCheckoutItem) {
      checkoutAlreadyInserted = true;
    }
  }

  // Variable pour stocker les infos d'un vol tardif à reporter au jour suivant
  let lateFlightForNextDay: LateFlightArrivalData | undefined;

  // Position actuelle pour les itinéraires (déclaré au niveau fonction)
  let lastCoords = cityCenter;

  // Utiliser les restaurants pré-fetchés si disponibles, sinon fetch en direct
  const prefetchKey = (meal: string) => `${dayNumber - 1}-${meal}`;
  const hasPrefetchedRestaurant = (meal: 'breakfast' | 'lunch' | 'dinner'): boolean =>
    !!prefetchedRestaurants?.has(prefetchKey(meal));
  const getPrefetchedRestaurant = (meal: 'breakfast' | 'lunch' | 'dinner'): import('./types').Restaurant | null =>
    (prefetchedRestaurants?.get(prefetchKey(meal))) ?? null;

  // PRÉ-FETCH DU BREAKFAST UNIQUEMENT (si pas déjà pré-fetché au niveau ai.ts)
  const prefetchedBreakfast = shouldSelfCater('breakfast', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)
    ? null
    : (hasPrefetchedRestaurant('breakfast')
        ? getPrefetchedRestaurant('breakfast')
        : await findRestaurantForMeal('breakfast', cityCenter, preferences, dayNumber, cityCenter));

  // === TRAITER UN VOL OVERNIGHT DU JOUR PRÉCÉDENT ===
  // Pour un vol overnight (arrivée le lendemain), le transfert et check-in hôtel
  // n'ont PAS été faits la veille - on les fait ce matin
  if (lateFlightArrivalData && !isFirstDay) {
    const overnightFlight = lateFlightArrivalData.flight;
    const overnightArrival = new Date(overnightFlight.arrivalTime);
    const overnightDestAirport = lateFlightArrivalData.destAirport;
    const overnightAccommodation = lateFlightArrivalData.accommodation;

    // Transfert aéroport → hôtel (après l'arrivée du vol overnight)
    const transferStart = new Date(overnightArrival.getTime() + 30 * 60 * 1000); // 30min après atterrissage
    const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

    const transferItem = scheduler.insertFixedItem({
      id: generateId(),
      title: 'Transfert Aéroport → Centre-ville',
      type: 'transport',
      startTime: transferStart,
      endTime: transferEnd,
    });
    if (transferItem) {
      // LOCATION TRACKING: Atterrissage = arrivé à destination
      locationTracker.landFlight(preferences.destination, formatScheduleTime(transferEnd));
      items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
        description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun.',
        locationName: `${overnightDestAirport.name} → Centre-ville`,
        latitude: cityCenter.lat,
        longitude: cityCenter.lng,
        estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
      }));
    }

    // Check-in ou dépôt bagages (selon l'heure d'arrivée vs heure de check-in officielle)
    const overnightCheckInTime = overnightAccommodation?.checkInTime || '15:00';
    const [oCheckInH, oCheckInM] = overnightCheckInTime.split(':').map(Number);
    const officialCheckIn = new Date(date);
    officialCheckIn.setHours(oCheckInH, oCheckInM, 0, 0);
    const isBeforeCheckIn = transferEnd < officialCheckIn;

    const hotelCheckinStart = transferEnd;
    const hotelCheckinEnd = new Date(hotelCheckinStart.getTime() + (isBeforeCheckIn ? 10 : 20) * 60 * 1000);
    const hotelName = overnightAccommodation?.name || 'Hébergement';
    const hotelItem = scheduler.insertFixedItem({
      id: generateId(),
      title: isBeforeCheckIn ? `Dépôt bagages ${hotelName}` : `Check-in ${hotelName}`,
      type: 'hotel',
      startTime: hotelCheckinStart,
      endTime: hotelCheckinEnd,
    });
    if (hotelItem) {
      const hotelCheckOutDate = new Date(tripStartDate);
      hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
      const hotelBookingUrl = getAccommodationBookingUrl(overnightAccommodation, preferences.destination, tripStartDate, hotelCheckOutDate);

      items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
        description: overnightAccommodation
          ? (isBeforeCheckIn
            ? `Déposez vos bagages en attendant le check-in à ${overnightCheckInTime} | ${overnightAccommodation.pricePerNight}€/nuit`
            : `${overnightAccommodation.stars ? overnightAccommodation.stars + '⭐ | ' : ''}${overnightAccommodation.rating?.toFixed(1)}/10 | ${overnightAccommodation.pricePerNight}€/nuit`)
          : 'Déposez vos affaires et installez-vous.',
        locationName: getHotelLocationName(overnightAccommodation, preferences.destination),
        latitude: overnightAccommodation?.latitude || cityCenter.lat,
        longitude: overnightAccommodation?.longitude || cityCenter.lng,
        bookingUrl: hotelBookingUrl,
      }));
      if (!overnightAccommodation?.latitude) {
        console.warn(`[TripDay] ⚠️ Hébergement sans coordonnées vérifiées`);
      }
    }

    // Avancer le curseur après le check-in hôtel
    scheduler.advanceTo(hotelCheckinEnd);
  }

  // === JOUR 1: LOGISTIQUE DEPART ===
  if (isFirstDay) {
    if (outboundFlight) {
      // Vol aller
      const flightDeparture = new Date(outboundFlight.departureTime);
      const flightArrival = new Date(outboundFlight.arrivalTime);
      const airportArrival = new Date(flightDeparture.getTime() - 2 * 60 * 60 * 1000);

      // === TEMPS LIBRE À L'ORIGINE AVANT LE DÉPART ===
      // Si le vol est tard, on peut profiter de la matinée à l'origine
      const departureHour = flightDeparture.getHours();
      const dayStartHour = 8; // On commence la journée à 8h

      // Calculer l'heure effective où on doit partir de l'origine
      let originDepartureTime = airportArrival; // Par défaut: 2h avant le vol

      // === TRAJET ORIGINE → AÉROPORT (si villes différentes) ===
      // Ex: Angers → Paris Orly = train/voiture de ~2h30
      // Toujours calculer la distance réelle entre l'origine et l'aéroport
      // L'ancien check par nom échouait quand la ville et l'aéroport ont le même nom
      // (ex: "Marseille" → "Marseille Provence" = même nom mais 25km de distance)
      const originCoordsCheck = getCityCenterCoords(preferences.origin);
      const distOriginToAirport = originCoordsCheck
        ? calculateDistance(originCoordsCheck.lat, originCoordsCheck.lng, originAirport.latitude, originAirport.longitude)
        : 0;
      const originDifferentFromAirport = distOriginToAirport > 5; // >5km = besoin d'un transfert

      // Calculer le temps de trajet vers l'aéroport si villes différentes
      let travelTimeMinutes = 0;
      let distanceToAirport = 0;
      // IMPORTANT: Ne PAS utiliser cityCenter (destination) comme fallback pour l'origine !
      // Utiliser les coordonnées de l'aéroport d'origine comme fallback
      const originCoordsLocal = getCityCenterCoords(preferences.origin) || {
        lat: originAirport.latitude,
        lng: originAirport.longitude,
      };

      // Variables pour le calcul du temps disponible à l'origine
      let transferToAirportStart: Date;
      let estimatedTravelCost = 0;

      if (originDifferentFromAirport) {
        // Estimer le temps de trajet (basé sur la distance)
        distanceToAirport = calculateDistance(
          originCoordsLocal.lat, originCoordsLocal.lng,
          originAirport.latitude, originAirport.longitude
        );
        // Estimation réaliste du temps de trajet:
        // - Train grande vitesse: ~200km/h effectif (inclut temps gare)
        // - Train régional/voiture: ~100km/h effectif
        // - Minimum 60min pour tout trajet (temps de déplacement local + marge)
        const effectiveSpeed = distanceToAirport > 200 ? 150 : 100; // km/h
        travelTimeMinutes = Math.max(60, Math.round((distanceToAirport / effectiveSpeed) * 60) + 30); // +30min marge
        // Estimation coût: TGV ~40-80€, voiture ~0.15€/km
        estimatedTravelCost = distanceToAirport > 200 ? 70 : Math.round(distanceToAirport * 0.15);

        // Calculer l'heure de départ (avant parking ou arrivée aéroport)
        const transferToAirportEnd = parking
          ? new Date(airportArrival.getTime() - calculateParkingTime(parking) * 60 * 1000)
          : airportArrival;
        transferToAirportStart = new Date(transferToAirportEnd.getTime() - travelTimeMinutes * 60 * 1000);
        originDepartureTime = transferToAirportStart;

        const originTransferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Trajet ${preferences.origin} → ${originAirport.city === preferences.origin ? originAirport.name : originAirport.city}`,
          type: 'transport',
          startTime: transferToAirportStart,
          endTime: transferToAirportEnd,
        });
        if (originTransferItem) {
          items.push(schedulerItemToTripItem(originTransferItem, dayNumber, orderIndex++, {
            description: distanceToAirport > 150
              ? `Train ou covoiturage vers l'aéroport (${Math.round(distanceToAirport)}km)`
              : `Voiture ou navette vers l'aéroport (${Math.round(distanceToAirport)}km)`,
            locationName: `${preferences.origin} → ${originAirport.name}`,
            latitude: originAirport.latitude,
            longitude: originAirport.longitude,
            estimatedCost: estimatedTravelCost,
          }));
        }
      } else {
        // Origine = même ville que l'aéroport, mais on a quand même besoin d'un transfert local
        const localTransferMin = Math.max(20, Math.round((distOriginToAirport || 15) * 2)); // ~2min/km, min 20min
        const transferToAirportEnd = parking
          ? new Date(airportArrival.getTime() - calculateParkingTime(parking) * 60 * 1000)
          : airportArrival;
        transferToAirportStart = new Date(transferToAirportEnd.getTime() - localTransferMin * 60 * 1000);
        originDepartureTime = transferToAirportStart;

        // Ajouter un item de transfert local vers l'aéroport
        const localTransferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Trajet vers ${originAirport.name}`,
          type: 'transport',
          startTime: transferToAirportStart,
          endTime: transferToAirportEnd,
        });
        if (localTransferItem) {
          items.push(schedulerItemToTripItem(localTransferItem, dayNumber, orderIndex++, {
            description: `Taxi ou transports vers l'aéroport`,
            locationName: `${preferences.origin} → ${originAirport.name}`,
            latitude: originAirport.latitude,
            longitude: originAirport.longitude,
            estimatedCost: Math.round(15 * Math.ceil((preferences.groupSize || 1) / 4)),
          }));
        }
      }

      // Parking (si applicable)
      if (parking) {
        const parkingTime = calculateParkingTime(parking);
        const parkingStart = new Date(airportArrival.getTime() - parkingTime * 60 * 1000);
        const parkingItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Parking: ${parking.name}`,
          type: 'parking',
          startTime: parkingStart,
          endTime: airportArrival,
          data: { parking },
        });
        if (parkingItem) {
          items.push(schedulerItemToTripItem(parkingItem, dayNumber, orderIndex++, {
            description: `Garez votre voiture. Prix: ${parking.totalPrice}€`,
            locationName: parking.address,
            latitude: parking.latitude,
            longitude: parking.longitude,
            estimatedCost: parking.totalPrice,
          }));
        }
      }

      // Enregistrement
      const checkinEnd = new Date(flightDeparture.getTime() - 30 * 60 * 1000);
      const checkinItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Enregistrement & Sécurité',
        type: 'checkin',
        startTime: airportArrival,
        endTime: checkinEnd,
      });
      if (checkinItem) {
        items.push(schedulerItemToTripItem(checkinItem, dayNumber, orderIndex++, {
          description: `Arrivez 2h avant. Terminal: ${originAirport.name}`,
          locationName: originAirport.name,
          latitude: originAirport.latitude,
          longitude: originAirport.longitude,
        }));
      }

      // Vol
      // Utiliser les heures d'affichage (heures locales aéroport) si disponibles
      const outboundFlightStartTime = outboundFlight.departureTimeDisplay || formatTime(flightDeparture);
      const outboundFlightEndTime = outboundFlight.arrivalTimeDisplay || formatTime(flightArrival);
      const flightItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Vol ${outboundFlight.flightNumber} → ${preferences.destination}`,
        type: 'flight',
        startTime: flightDeparture,
        endTime: flightArrival,
        data: { flight: outboundFlight },
      });
      if (flightItem) {
        // LOCATION TRACKING: Embarquement = en transit (pas d'activités possibles)
        locationTracker.boardFlight(preferences.origin, preferences.destination);
        // Utiliser l'URL de réservation du vol (Google Flights) si disponible
        // Sinon fallback sur Skyscanner via linkGenerator
        const tripEndDate = new Date(tripStartDate);
        tripEndDate.setDate(tripEndDate.getDate() + preferences.durationDays - 1);
        const flightBookingUrl = outboundFlight.bookingUrl || generateFlightLink(
          { origin: originAirport.code, destination: destAirport.code },
          { date: formatDateForUrl(tripStartDate), returnDate: formatDateForUrl(tripEndDate), passengers: preferences.groupSize }
        );

        // Créer l'item et surcharger les heures avec les heures locales de l'aéroport
        // Afficher le prix par personne ET le prix total (avec protections NaN)
        const flightPrice = outboundFlight.price || 0;
        const groupSize = preferences.groupSize || 1;
        const pricePerPerson = outboundFlight.pricePerPerson || (flightPrice > 0 ? Math.round(flightPrice / groupSize) : 0);
        const priceDisplay = groupSize > 1 && pricePerPerson > 0
          ? `${pricePerPerson}€/pers (${flightPrice}€ total)`
          : flightPrice > 0 ? `${flightPrice}€` : 'Prix non disponible';
        const tripItem = schedulerItemToTripItem(flightItem, dayNumber, orderIndex++, {
          description: `${outboundFlight.flightNumber} | ${formatFlightDuration(outboundFlight.duration)} | ${outboundFlight.stops === 0 ? 'Direct' : `${outboundFlight.stops} escale(s)`} | ${priceDisplay}`,
          locationName: `${originAirport.code} → ${destAirport.code}`,
          // Utiliser l'aéroport de destination (pas le milieu de l'océan!)
          latitude: destAirport.latitude,
          longitude: destAirport.longitude,
          estimatedCost: outboundFlight.price,
          bookingUrl: flightBookingUrl,
        });
        // IMPORTANT: Surcharger les heures formatées avec les heures d'affichage correctes
        tripItem.startTime = outboundFlightStartTime;
        // Si vol overnight (arrivée < départ en string), ajouter "+1j" pour clarifier
        const isOvernightDisplay = outboundFlightEndTime < outboundFlightStartTime;
        tripItem.endTime = isOvernightDisplay ? `${outboundFlightEndTime} (+1j)` : outboundFlightEndTime;
        items.push(tripItem);
      }

      // === GESTION VOL TARDIF / OVERNIGHT ===
      // Détecter si le vol arrive le LENDEMAIN (vol overnight avec escale)
      // Exemple: Départ 18:30 le 28/01, arrivée 08:35 le 29/01
      const departureDay = new Date(flightDeparture.getFullYear(), flightDeparture.getMonth(), flightDeparture.getDate());
      const arrivalDay = new Date(flightArrival.getFullYear(), flightArrival.getMonth(), flightArrival.getDate());
      const isOvernightFlight = arrivalDay.getTime() > departureDay.getTime();

      const arrivalHour = flightArrival.getHours();
      // Vol tardif: arrive après 22h OU avant 5h (mais PAS overnight, géré séparément)
      const isLateNightFlight = (arrivalHour >= 22 || arrivalHour < 5) && !isOvernightFlight;

      // === VOL OVERNIGHT: Arrivée le lendemain ===
      // Le Jour 1 ne contient QUE la logistique de départ (parking, enregistrement, vol)
      // Le transfert et check-in hôtel seront faits au Jour 2
      if (isOvernightFlight) {
        // Stocker les infos pour le jour suivant
        lateFlightForNextDay = {
          flight: outboundFlight,
          destAirport,
          accommodation,
        };
        // NE PAS ajouter de transfert/check-in hôtel aujourd'hui - ils seront au Jour 2
      } else if (isLateNightFlight) {
        // MÊME pour un vol tardif, on fait le transfert et check-in hôtel le même soir
        // Cela évite que le voyageur "dorme à l'aéroport"

        // Transfert aéroport → hôtel (directement, pas de consigne à cette heure)
        const lateTransferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000); // 30min après atterrissage
        const lateTransferEnd = new Date(lateTransferStart.getTime() + 40 * 60 * 1000);

        const lateTransferItem = scheduler.insertFixedItem({
          id: generateId(),
          title: 'Transfert Aéroport → Hôtel',
          type: 'transport',
          startTime: lateTransferStart,
          endTime: lateTransferEnd,
        });
        if (lateTransferItem) {
          // LOCATION TRACKING: Atterrissage tardif = arrivé à destination
          locationTracker.landFlight(preferences.destination, formatScheduleTime(lateTransferEnd));
          items.push(schedulerItemToTripItem(lateTransferItem, dayNumber, orderIndex++, {
            description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou Uber vers votre hôtel.',
            locationName: `${destAirport.name} → Hôtel`,
            latitude: cityCenter.lat,
            longitude: cityCenter.lng,
            estimatedCost: preferences.carRental ? 0 : 35 * Math.ceil(preferences.groupSize / 4), // Plus cher la nuit
          }));
        }

        // Check-in hôtel tardif (les hôtels acceptent généralement les arrivées tardives)
        const lateCheckinStart = lateTransferEnd;
        const lateCheckinEnd = new Date(lateCheckinStart.getTime() + 15 * 60 * 1000);
        const hotelName = accommodation?.name || 'Hébergement';

        const lateHotelItem = scheduler.insertFixedItem({
          id: generateId(),
          title: `Check-in tardif ${hotelName}`,
          type: 'hotel',
          startTime: lateCheckinStart,
          endTime: lateCheckinEnd,
        });
        if (lateHotelItem) {
          // tripStartDate est déjà normalisé au début de la fonction
          const hotelCheckOutDate = new Date(tripStartDate);
          hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
          const hotelBookingUrl = getAccommodationBookingUrl(accommodation, preferences.destination, tripStartDate, hotelCheckOutDate);

          items.push(schedulerItemToTripItem(lateHotelItem, dayNumber, orderIndex++, {
            description: `Arrivée tardive prévue. Check-out le dernier jour à ${accommodation?.checkOutTime || '11:00'}.`,
            locationName: getHotelLocationName(accommodation, preferences.destination),
            latitude: accommodation?.latitude || cityCenter.lat,
            longitude: accommodation?.longitude || cityCenter.lng,
            estimatedCost: 0, // Inclus dans le prix total
            bookingUrl: hotelBookingUrl,
          }));
        }

        // PAS de report au jour suivant pour le transfert/hôtel, c'est fait!
        // Les activités du jour 2 commenceront normalement à 08:00
      } else {
        // Vol normal (arrivée avant 22h) - générer les activités post-arrivée normalement

      // Transfert aéroport → centre-ville/hôtel
      const transferStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
      const transferEnd = new Date(transferStart.getTime() + 40 * 60 * 1000);

      // Heure de check-in de l'hôtel
      const hotelCheckInTime = accommodation?.checkInTime || '15:00';
      const [checkInHour, checkInMin] = hotelCheckInTime.split(':').map(Number);

      // FLUX OPTIMISÉ: Aéroport → Centre-ville → Activités → Check-in hôtel
      // Si on arrive avant l'heure de check-in, on fait des activités en attendant

      const transferItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Transfert Aéroport → Centre-ville',
        type: 'transport',
        startTime: transferStart,
        endTime: transferEnd,
      });
      if (transferItem) {
        // LOCATION TRACKING: Atterrissage = arrivé à destination (activités possibles)
        const arrivalTimeStr = formatScheduleTime(transferEnd);
        locationTracker.landFlight(preferences.destination, arrivalTimeStr);
        items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
          description: preferences.carRental ? 'Récupérez votre voiture de location.' : 'Taxi ou transports en commun. Déposez vos bagages à l\'hôtel (bagagerie) si possible.',
          locationName: `${destAirport.name} → Centre-ville`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
        }));
      }

      // Avancer le curseur après le transfert
      scheduler.advanceTo(transferEnd);

      // Calculer l'heure de check-in de l'hôtel
      const actualCheckInTime = new Date(date);
      actualCheckInTime.setHours(checkInHour, checkInMin, 0, 0);

      // Calculer le temps disponible avant le check-in
      const timeBeforeCheckInMs = actualCheckInTime.getTime() - transferEnd.getTime();
      const hoursBeforeCheckIn = timeBeforeCheckInMs / (1000 * 60 * 60);

      // === CONSIGNE À BAGAGES (vol) ===
      const flightArrivalTimeStr = `${transferEnd.getHours().toString().padStart(2, '0')}:${transferEnd.getMinutes().toString().padStart(2, '0')}`;
      const flightNeedsStorage = preferences.durationDays > 1 && needsLuggageStorage(flightArrivalTimeStr, hotelCheckInTime);

      if (flightNeedsStorage && hoursBeforeCheckIn >= 1.5) {
        try {
          const flightStorages = prefetchedLuggageStorages ?? await searchLuggageStorage(preferences.destination, { latitude: cityCenter.lat, longitude: cityCenter.lng });
          const flightBestStorage = selectBestStorage(flightStorages, { latitude: cityCenter.lat, longitude: cityCenter.lng });

          if (flightBestStorage) {
            const flightLuggageDropStart = scheduler.getCurrentTime();
            const flightLuggageDropEnd = new Date(flightLuggageDropStart.getTime() + 15 * 60 * 1000);
            const flightLuggageDropItem = scheduler.addItem({
              id: generateId(),
              title: '🧳 Dépôt bagages en consigne',
              type: 'activity',
              duration: 15,
              travelTime: 10,
            });
            if (flightLuggageDropItem) {
              items.push(schedulerItemToTripItem(flightLuggageDropItem, dayNumber, orderIndex++, {
                description: `${flightBestStorage.name} — ${flightBestStorage.pricePerDay}€/jour${flightBestStorage.notes ? ` | ${flightBestStorage.notes}` : ''}`,
                locationName: flightBestStorage.address,
                latitude: flightBestStorage.latitude || cityCenter.lat,
                longitude: flightBestStorage.longitude || cityCenter.lng,
                estimatedCost: flightBestStorage.pricePerDay * preferences.groupSize,
                bookingUrl: flightBestStorage.bookingUrl,
              }));
            }

            // Récupération bagages avant check-in
            const flightLuggagePickupStart = new Date(actualCheckInTime.getTime() - 30 * 60 * 1000);
            if (flightLuggagePickupStart > flightLuggageDropEnd) {
              const flightLuggagePickupItem = scheduler.insertFixedItem({
                id: generateId(),
                title: '🧳 Récupération bagages',
                type: 'activity',
                startTime: flightLuggagePickupStart,
                endTime: new Date(flightLuggagePickupStart.getTime() + 15 * 60 * 1000),
              });
              if (flightLuggagePickupItem) {
                items.push(schedulerItemToTripItem(flightLuggagePickupItem, dayNumber, orderIndex++, {
                  description: `Récupérez vos bagages à ${flightBestStorage.name} avant le check-in`,
                  locationName: flightBestStorage.address,
                  latitude: flightBestStorage.latitude || cityCenter.lat,
                  longitude: flightBestStorage.longitude || cityCenter.lng,
                }));
              }
            }
          }
        } catch (err) {
          console.warn(`[Jour ${dayNumber}] 🧳 Erreur recherche consigne (vol):`, err instanceof Error ? err.message : err);
        }
      }

      // NOTE: Le dépôt de bagages à l'hôtel est géré directement dans le bloc check-in
      // (ligne ~335) avec le titre conditionnel "Dépôt bagages" vs "Check-in"
      // On ne crée plus d'item "Déposer bagages" séparé pour éviter les doublons

      // Si on a du temps avant le check-in (> 1h30), faire des activités
      if (hoursBeforeCheckIn >= 1.5) {
        // Déjeuner si on est dans la plage horaire (11h - 14h)
        // CORRECTION: l'ancienne condition (currentHour >= 11 && currentMin >= 30) était vraie
        // pour 15h30, 18h45, etc. car >= 11 est vrai pour toute heure ≥ 11
        const currentHour = transferEnd.getHours();
        const canDoLunch = currentHour >= 11 && currentHour < 14;

        if (canDoLunch && hoursBeforeCheckIn >= 2.5) {
          const lunchItem = scheduler.addItem({
            id: generateId(),
            title: 'Déjeuner',
            type: 'restaurant',
            duration: 75,
            travelTime: 15,
            minStartTime: parseTime(date, '11:30'),  // Pas de déjeuner avant 11h30
            maxEndTime: parseTime(date, '14:30'),     // Pas de déjeuner après 14h30
          });
          if (lunchItem) {
            if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
              items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
                title: 'Déjeuner pique-nique / maison',
                description: 'Repas préparé avec les courses | Option économique',
                locationName: `Centre-ville, ${preferences.destination}`,
                latitude: accommodation?.latitude || lastCoords.lat,
                longitude: accommodation?.longitude || lastCoords.lng,
                estimatedCost: 8 * (preferences.groupSize || 1),
              }));
            } else {
              // Rechercher un restaurant proche de la position actuelle
              lastCoords = getLastItemCoords(items, cityCenter);
              const restaurant = hasPrefetchedRestaurant('lunch')
                ? getPrefetchedRestaurant('lunch')
                : await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
              const restaurantCoords = {
                lat: restaurant?.latitude || lastCoords.lat,
                lng: restaurant?.longitude || lastCoords.lng,
              };
              if (!restaurant?.latitude || !restaurant?.longitude) {
                console.warn(`[TripDay] ⚠️ Restaurant "${restaurant?.name || 'unknown'}" sans coordonnées — utilise position actuelle`);
              }
              const restaurantGoogleMapsUrl = getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

              items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
                title: restaurant?.name || 'Déjeuner',
                description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Découvrez la cuisine locale',
                locationName: restaurant?.address || `Centre-ville, ${preferences.destination}`,
                latitude: restaurantCoords.lat,
                longitude: restaurantCoords.lng,
                estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
                rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
                googleMapsPlaceUrl: restaurantGoogleMapsUrl,
              }));
              lastCoords = restaurantCoords;
            }
          }
        }

        // Activités en attendant le check-in (jusqu'à 30min avant)
        const checkInBuffer = new Date(actualCheckInTime.getTime() - 30 * 60 * 1000);

        for (const attraction of attractions) {
          // Vérifier qu'on a le temps avant le check-in
          const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
          const activityEndTime = new Date(scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration + 15) * 60 * 1000);

          if (activityEndTime > checkInBuffer) {
            break;
          }

          // ANTI-DOUBLON: Skip si déjà utilisée
          if (tripUsedAttractionIds.has(attraction.id)) {
            continue;
          }

          const openTimeJ1 = parseTime(date, attraction.openingHours.open);
          const closeTimeJ1 = parseTime(date, attraction.openingHours.close);

          const activityItem = scheduler.addItem({
            id: generateId(),
            title: attraction.name,
            type: 'activity',
            duration: attraction.duration,
            travelTime,
            minStartTime: openTimeJ1,
            maxEndTime: closeTimeJ1,
          });

          if (activityItem) {
            tripUsedAttractionIds.add(attraction.id);
            const attractionCoords = {
              lat: attraction.latitude || cityCenter.lat,
              lng: attraction.longitude || cityCenter.lng,
            };
            if (!attraction.latitude || !attraction.longitude) {
              console.warn(`[TripDay] ⚠️ Attraction "${attraction.name}" sans coordonnées vérifiées — utilise cityCenter`);
            }
            items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
              description: attraction.description,
              locationName: `${attraction.name}, ${preferences.destination}`,
              latitude: attractionCoords.lat,
              longitude: attractionCoords.lng,
              estimatedCost: attraction.estimatedCost * preferences.groupSize,
              rating: attraction.rating ? Math.round(attraction.rating * 10) / 10 : undefined,
              bookingUrl: attraction.bookingUrl,
              dataReliability: attraction.dataReliability || 'estimated',
            }));
            lastCoords = attractionCoords;
          }
        }
      }

      // Check-in hôtel - à l'heure officielle ou maintenant si on est déjà en retard
      const hotelCheckinStart = scheduler.getCurrentTime() > actualCheckInTime ? scheduler.getCurrentTime() : actualCheckInTime;
      const hotelCheckinEnd = new Date(hotelCheckinStart.getTime() + 20 * 60 * 1000);
      const hotelName = accommodation?.name || 'Hébergement';
      const hotelItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-in ${hotelName}`,
        type: 'hotel',
        startTime: hotelCheckinStart,
        endTime: hotelCheckinEnd,
      });
      if (hotelItem) {
        // tripStartDate est déjà normalisé au début de la fonction
        const hotelCheckOutDate = new Date(tripStartDate);
        hotelCheckOutDate.setDate(hotelCheckOutDate.getDate() + preferences.durationDays - 1);
        const hotelBookingUrl = getAccommodationBookingUrl(accommodation, preferences.destination, tripStartDate, hotelCheckOutDate);

        items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
          description: accommodation ? `${accommodation.stars ? accommodation.stars + '⭐ | ' : ''}${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
          bookingUrl: hotelBookingUrl,
        }));
        if (!accommodation?.latitude) {
          console.warn(`[TripDay] ⚠️ Hébergement sans coordonnées vérifiées`);
        }
      }

      // Avancer le curseur après le check-in hôtel
      scheduler.advanceTo(hotelCheckinEnd);
      // Mettre à jour lastCoords à la position de l'hôtel
      lastCoords = {
        lat: accommodation?.latitude || cityCenter.lat,
        lng: accommodation?.longitude || cityCenter.lng,
      };

      } // Fin du bloc else (vol NON tardif)

    } else if (groundTransport) {
      // Transport terrestre — horaires réels si disponibles, sinon 08:00 + duration
      let transportStart: Date;
      let transportEnd: Date;
      if (groundTransport.transitLegs?.length) {
        const firstLeg = groundTransport.transitLegs[0];
        const lastLeg = groundTransport.transitLegs[groundTransport.transitLegs.length - 1];
        const realDep = new Date(firstLeg.departure);
        const realArr = new Date(lastLeg.arrival);
        transportStart = new Date(realDep.getTime() - 30 * 60 * 1000);
        transportEnd = realArr;
      } else {
        transportStart = parseTime(date, '08:00');
        transportEnd = new Date(transportStart.getTime() + groundTransport.totalDuration * 60 * 1000);
      }

      const modeIcons: Record<string, string> = { train: '🚄', bus: '🚌', car: '🚗', combined: '🔄' };
      const modeLabels: Record<string, string> = { train: 'Train', bus: 'Bus', car: 'Voiture', combined: 'Transport combiné' };

      const transportItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `${modeIcons[groundTransport.mode] || '🚊'} ${modeLabels[groundTransport.mode] || groundTransport.mode || 'Transport'} → ${preferences.destination}`,
        type: 'transport',
        startTime: transportStart,
        endTime: transportEnd,
        data: { transport: groundTransport },
      });
      if (transportItem) {
        // LOCATION TRACKING: Transport terrestre = en transit pendant le trajet
        locationTracker.boardFlight(preferences.origin, preferences.destination);
        items.push(schedulerItemToTripItem(transportItem, dayNumber, orderIndex++, {
          description: groundTransport.segments?.map(s => `${s.from} → ${s.to}`).join(' | ') + ` | ${groundTransport.totalPrice}€`,
          locationName: `${preferences.origin} → ${preferences.destination}`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: groundTransport.totalPrice,
          bookingUrl: groundTransport.bookingUrl,
          transitLegs: groundTransport.transitLegs,
          transitDataSource: groundTransport.dataSource,
          priceRange: groundTransport.priceRange,
        }));

        // LOCATION TRACKING: Arrivée = à destination (activités possibles)
        const arrivalTimeStr = formatScheduleTime(transportEnd);
        locationTracker.landFlight(preferences.destination, arrivalTimeStr);
      }

      // Check-in hôtel - IMPORTANT: ne pas programmer avant l'heure officielle de check-in
      const hotelCheckInTimeStr = accommodation?.checkInTime || '15:00';
      const [hotelCheckInHour, hotelCheckInMin] = hotelCheckInTimeStr.split(':').map(Number);
      const minCheckInTime = new Date(date);
      minCheckInTime.setHours(hotelCheckInHour || 15, hotelCheckInMin || 0, 0, 0);

      // Le check-in commence au plus tôt à l'heure officielle (généralement 14h-15h)
      const arrivalPlusBuffer = new Date(transportEnd.getTime() + 30 * 60 * 1000);
      const hotelStart = arrivalPlusBuffer > minCheckInTime ? arrivalPlusBuffer : minCheckInTime;
      const hotelEnd = new Date(hotelStart.getTime() + 20 * 60 * 1000);

      // === CONSIGNE À BAGAGES ===
      // Si arrivée > 2h30 avant check-in et voyage > 1 jour, proposer consigne.
      // Pour des gaps plus courts, on va directement à l'hôtel (bagagerie gratuite).
      const arrivalTimeForLuggage = `${transportEnd.getHours().toString().padStart(2, '0')}:${transportEnd.getMinutes().toString().padStart(2, '0')}`;
      const needsStorage = preferences.durationDays > 1 && needsLuggageStorage(arrivalTimeForLuggage, hotelCheckInTimeStr);

      if (needsStorage) {
        try {
          const storages = prefetchedLuggageStorages ?? await searchLuggageStorage(preferences.destination, { latitude: cityCenter.lat, longitude: cityCenter.lng });
          const bestStorage = selectBestStorage(storages, { latitude: cityCenter.lat, longitude: cityCenter.lng });

          if (bestStorage) {
            // Dépôt bagages (15min) juste après arrivée
            const luggageDropStart = new Date(transportEnd.getTime() + 15 * 60 * 1000);
            const luggageDropEnd = new Date(luggageDropStart.getTime() + 15 * 60 * 1000);
            const luggageDropItem = scheduler.insertFixedItem({
              id: generateId(),
              title: '🧳 Dépôt bagages en consigne',
              type: 'activity',
              startTime: luggageDropStart,
              endTime: luggageDropEnd,
            });
            if (luggageDropItem) {
              items.push(schedulerItemToTripItem(luggageDropItem, dayNumber, orderIndex++, {
                description: `${bestStorage.name} — ${bestStorage.pricePerDay}€/jour${bestStorage.notes ? ` | ${bestStorage.notes}` : ''}`,
                locationName: bestStorage.address,
                latitude: bestStorage.latitude || cityCenter.lat,
                longitude: bestStorage.longitude || cityCenter.lng,
                estimatedCost: bestStorage.pricePerDay * preferences.groupSize,
                bookingUrl: bestStorage.bookingUrl,
              }));
            }

            // Récupération bagages (15min) 30min avant check-in hôtel
            const luggagePickupStart = new Date(hotelStart.getTime() - 30 * 60 * 1000);
            const luggagePickupEnd = new Date(luggagePickupStart.getTime() + 15 * 60 * 1000);
            if (luggagePickupStart > luggageDropEnd) {
              const luggagePickupItem = scheduler.insertFixedItem({
                id: generateId(),
                title: '🧳 Récupération bagages',
                type: 'activity',
                startTime: luggagePickupStart,
                endTime: luggagePickupEnd,
              });
              if (luggagePickupItem) {
                items.push(schedulerItemToTripItem(luggagePickupItem, dayNumber, orderIndex++, {
                  description: `Récupérez vos bagages à ${bestStorage.name} avant le check-in`,
                  locationName: bestStorage.address,
                  latitude: bestStorage.latitude || cityCenter.lat,
                  longitude: bestStorage.longitude || cityCenter.lng,
                }));
              }
            }
          }
        } catch (err) {
          console.warn(`[Jour ${dayNumber}] 🧳 Erreur recherche consigne:`, err instanceof Error ? err.message : err);
        }
      }

      const hotelNameGround = accommodation?.name || 'Hébergement';
      const hotelItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Check-in ${hotelNameGround}`,
        type: 'hotel',
        startTime: hotelStart,
        endTime: hotelEnd,
      });
      if (hotelItem) {
        // tripStartDate est déjà normalisé au début de la fonction
        const hotelCheckOutDate3 = new Date(tripStartDate);
        hotelCheckOutDate3.setDate(hotelCheckOutDate3.getDate() + preferences.durationDays - 1);
        const hotelBookingUrl3 = getAccommodationBookingUrl(accommodation, preferences.destination, tripStartDate, hotelCheckOutDate3);

        items.push(schedulerItemToTripItem(hotelItem, dayNumber, orderIndex++, {
          description: accommodation ? `${accommodation.stars ? accommodation.stars + '⭐ | ' : ''}${accommodation.rating?.toFixed(1)}/10 | ${accommodation.pricePerNight}€/nuit` : 'Déposez vos affaires et installez-vous.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
          bookingUrl: hotelBookingUrl3,
        }));
        if (!accommodation?.latitude) {
          console.warn(`[TripDay] ⚠️ Hébergement sans coordonnées vérifiées`);
        }
      }

      // NE PAS avancer le curseur au check-in: laisser du temps pour des activités avant
      // Le scheduler les programmera naturellement entre l'arrivée et le check-in (fixed item)
      // Avancer juste après l'arrivée du transport + buffer
      const afterArrival = new Date(transportEnd.getTime() + 30 * 60 * 1000);
      if (afterArrival < hotelStart) {
        scheduler.advanceTo(afterArrival);
      } else {
        scheduler.advanceTo(hotelEnd);
      }
      // Mettre à jour lastCoords à la gare/arrivée pour les activités pré-check-in
      lastCoords = {
        lat: cityCenter.lat,
        lng: cityCenter.lng,
      };
    }
  }

  // === PROTECTION CRITIQUE: JOUR 1 - S'assurer que le curseur est APRÈS le transport ===
  // Si on a un transport le Jour 1, le curseur DOIT être après l'arrivée + check-in
  if (isFirstDay) {
    let minActivityStart: Date | null = null;

    if (outboundFlight) {
      const flightArrival = new Date(outboundFlight.arrivalTime);
      if (!isNaN(flightArrival.getTime())) {
        // Minimum: arrivée vol + 1h30 (transfert + check-in)
        minActivityStart = new Date(flightArrival.getTime() + 90 * 60 * 1000);
      }
    } else if (groundTransport) {
      // Transport terrestre: activités possibles dès l'arrivée + petit buffer
      // Le check-in hôtel est un fixed item, pas besoin d'attendre pour visiter
      const departureTime = parseTime(date, '08:00');
      const arrivalTime = new Date(departureTime.getTime() + groundTransport.totalDuration * 60 * 1000);
      minActivityStart = new Date(arrivalTime.getTime() + 15 * 60 * 1000); // 15min buffer après descente
    }

    if (minActivityStart) {
      const currentCursor = scheduler.getCurrentTime();
      if (currentCursor < minActivityStart) {
        scheduler.advanceTo(minActivityStart);
      } else {
      }
    }
  }

  // === ACTIVITÉS ET REPAS ===
  const currentHour = scheduler.getCurrentTime().getHours();
  const endHour = dayEnd.getHours();

  // Sur les jours suivants, réinitialiser au centre-ville (le petit-déjeuner mettra à jour vers l'hôtel)
  // Sur le jour 1 avec check-in hôtel, lastCoords est déjà à la position de l'hôtel
  if (!isFirstDay) {
    lastCoords = cityCenter;
  }

  // Petit-déjeuner (si avant 10h et pas jour 1 avec logistique)
  // Si l'hôtel inclut le petit-déjeuner, on prend le petit-dej à l'hôtel (gratuit)
  // Sinon, on cherche un restaurant pour le petit-déjeuner
  const hotelHasBreakfast = accommodation?.breakfastIncluded === true;

  // Dernier jour avec vol OU transport terrestre: calculer le checkout et forcer le breakfast avant
  let lastDayCheckoutTime: Date | null = null;
  let skipBreakfastLastDay = false;
  if (isLastDay && (returnFlight || groundTransport) && !isFirstDay) {
    if (returnFlight) {
      const flightDep = new Date(returnFlight.departureTime);
      const checkoutByFlight = new Date(flightDep.getTime() - 210 * 60 * 1000); // 3h30 avant vol
      const checkoutByStandard = parseTime(date, '12:00');
      lastDayCheckoutTime = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
    } else if (groundTransport) {
      // Transport terrestre: checkout = heure de l'hôtel (ou 10:00 par défaut)
      lastDayCheckoutTime = parseTime(date, accommodation?.checkOutTime || '10:00');
    }
    const checkoutH = lastDayCheckoutTime!.getHours();
    if (checkoutH < 8) {
      // Départ trop tôt: skip breakfast, pas le temps
      skipBreakfastLastDay = true;
    } else {
      // Forcer le breakfast tôt: au moins 1h avant checkout
      const latestBreakfastStart = new Date(lastDayCheckoutTime!.getTime() - 60 * 60 * 1000);
      const earlyBreakfastTime = parseTime(date, '07:00');
      const breakfastTarget = earlyBreakfastTime < latestBreakfastStart ? earlyBreakfastTime : latestBreakfastStart;
      if (scheduler.getCurrentTime() <= breakfastTarget) {
        scheduler.advanceTo(breakfastTarget);
      }
    }
  }

  if (currentHour < 10 && !isFirstDay && !skipBreakfastLastDay) {
    const breakfastItem = scheduler.addItem({
      id: generateId(),
      title: hotelHasBreakfast ? `Petit-déjeuner à l'hôtel` : 'Petit-déjeuner',
      type: hotelHasBreakfast ? 'hotel' : 'restaurant',
      duration: hotelHasBreakfast ? 30 : 45, // Plus rapide à l'hôtel
      travelTime: hotelHasBreakfast ? 0 : 10, // Pas de déplacement si à l'hôtel
    });

    if (breakfastItem) {
      if (hotelHasBreakfast) {
        // Petit-déjeuner à l'hôtel (inclus dans le prix)
        items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
          title: `Petit-déjeuner à l'hôtel`,
          description: `Inclus dans le prix de l'hôtel | ${accommodation?.name}`,
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
          estimatedCost: 0, // Inclus dans le prix de l'hôtel
        }));
        // Position reste à l'hôtel
        lastCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
      } else if (shouldSelfCater('breakfast', dayNumber, budgetStrategy, hotelHasBreakfast, preferences.durationDays, isDayTrip, groceriesDone)) {
        // Petit-déjeuner self_catered (courses/cuisine au logement)
        const accommodationCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
        items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
          title: 'Petit-déjeuner au logement',
          description: 'Courses au supermarché local | Repas préparé au logement',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodationCoords.lat,
          longitude: accommodationCoords.lng,
          estimatedCost: 7 * (preferences.groupSize || 1), // ~7€/pers
        }));
        lastCoords = accommodationCoords;
      } else {
        // Petit-déjeuner dans un restaurant externe - utiliser le pré-fetch
        const restaurant = prefetchedBreakfast;
        const restaurantCoords = {
          lat: restaurant?.latitude || lastCoords.lat,
          lng: restaurant?.longitude || lastCoords.lng,
        };
        if (!restaurant?.latitude || !restaurant?.longitude) {
          console.warn(`[TripDay] ⚠️ Restaurant "${restaurant?.name || 'unknown'}" sans coordonnées — utilise position actuelle`);
        }
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
        const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
          getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

        items.push(schedulerItemToTripItem(breakfastItem, dayNumber, orderIndex++, {
          title: restaurant?.name || 'Petit-déjeuner',
          description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Petit-déjeuner local',
          locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
          latitude: restaurantCoords.lat,
          longitude: restaurantCoords.lng,
          estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'breakfast') * preferences.groupSize,
          rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
          googleMapsUrl,
          googleMapsPlaceUrl: restaurantGoogleMapsUrl,
        }));
        lastCoords = restaurantCoords;
      }
    }
  }

  // Déterminer si le déjeuner est prévu pour cette journée
  const isDay1WithEarlyArrival = isFirstDay && groundTransport && !outboundFlight;
  const shouldHaveLunch = (!isFirstDay || isDay1WithEarlyArrival) && endHour >= 14;

  // Activites du matin - SEULEMENT si on est deja sur place (pas le jour 1)
  // Le jour 1, on arrive generalement l'apres-midi, donc pas d'activites matin
  const cursorHour = scheduler.getCurrentTime().getHours();
  const canDoMorningActivities = cursorHour < 12;

  // IMPORTANT: Utiliser le Set partagé au niveau du voyage pour éviter les doublons
  // tripUsedAttractionIds est passé en paramètre et partagé entre tous les jours

  // Compteur d'activités placées le matin — permet d'autoriser 1 activité longue (musée 2h+)
  // puis de bloquer les suivantes pour protéger le créneau déjeuner.
  // Déclaré ici (hors du if) pour être accessible dans le bloc remplissage de trous.
  let morningActivityCount = 0;

  if (canDoMorningActivities) {
    // Matin: optimiser l'ordre des attractions pour minimiser la distance totale
    // Nearest-neighbor itératif + 2-opt avec respect des contraintes horaires
    const lunchTimeMorning = parseTime(date, shouldHaveLunch ? '12:00' : '12:30');
    const mustSeeAttractions = attractions.filter(a => a.mustSee);
    const normalAttractions = attractions.filter(a => !a.mustSee);
    const optimizedMustSee = optimizeAttractionOrder(
      mustSeeAttractions, lastCoords, date, lunchTimeMorning, scheduler.getCurrentTime()
    );
    const optimizedNormal = optimizeAttractionOrder(
      normalAttractions, lastCoords, date, lunchTimeMorning, scheduler.getCurrentTime()
    );
    const morningAttractions = [...optimizedMustSee, ...optimizedNormal];

    for (const attraction of morningAttractions) {
      // ANTI-DOUBLON: Skip si déjà utilisée (dans n'importe quel jour du voyage)
      if (tripUsedAttractionIds.has(attraction.id)) {
        continue;
      }

      // LOCATION TRACKING: Vérifier que l'utilisateur est bien à destination
      // LOCATION TRACKING: Skip validation for day trips (attractions are in a different city by design)
      if (!isDayTrip) {
        const locationValidation = locationTracker.validateActivity({
          city: preferences.destination,
          name: attraction.name,
        });
        if (!locationValidation.valid) {
          continue;
        }
      }

      // LOGIQUE "1 ACTIVITÉ LONGUE LE MATIN":
      // - 1ère activité : peut aller jusqu'à 13:00 (ex: Rijksmuseum 10:20→12:50, déjeuner à 13:00)
      // - Activités suivantes : bloquées à 12:00 pour protéger le créneau déjeuner
      // Cela évite un matin vide ET un après-midi surchargé de 3 musées
      const morningDeadline = shouldHaveLunch
        ? parseTime(date, morningActivityCount === 0 ? '13:00' : '12:00')
        : parseTime(date, '12:30');

      // Verifier qu'on a le temps avant le deadline du matin
      if (scheduler.getCurrentTime().getTime() + 30 * 60 * 1000 + attraction.duration * 60 * 1000 > morningDeadline.getTime()) {
        // continue au lieu de break pour essayer les autres attractions (plus courtes)
        console.log(`[Jour ${dayNumber}] Skip "${attraction.name}" (matin): dépasse deadline (${attraction.duration}min)`);
        continue;
      }

    const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as any, attraction);
    const openTime = parseTime(date, attraction.openingHours.open);
    const closeTime = parseTime(date, attraction.openingHours.close);

    // MARGE DE SÉCURITÉ: On doit finir 30 min AVANT la fermeture (dernière entrée)
    const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

    // Calculer l'heure de debut reelle
    let actualStartTime = new Date(scheduler.getCurrentTime().getTime() + travelTime * 60 * 1000);
    if (actualStartTime < openTime && openTime >= scheduler.getCurrentTime()) {
      actualStartTime = new Date(openTime);
    }

    // Verifier que le lieu sera encore ouvert quand on aura fini (avec marge de 30min)
    const potentialEndTime = new Date(actualStartTime.getTime() + attraction.duration * 60 * 1000);
    if (potentialEndTime > safeCloseTime) {
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}" (matin): lieu fermé avant fin de visite`);
      continue;
    }

    // Budget check: skip if activity costs more than remaining budget
    // EXCEPTION: activités gratuites et must-see passent toujours
    const activityCost = (attraction.estimatedCost || 0) * (preferences.groupSize || 1);
    const isMustSee = (attraction as any).mustSee === true;
    if (activityCost > 0 && !isMustSee && budgetTracker && !budgetTracker.canAfford('activities', activityCost)) {
      console.warn(`[Jour ${dayNumber}] ⚠️ "${attraction.name}" skippée (matin): budget épuisé (coût: ${activityCost}€)`);
      continue;
    }

    // PROTECTION DÉJEUNER avec deadline dynamique:
    // 1ère activité → peut finir jusqu'à 13:00 | Suivantes → bloquées à 12:00
    const morningMaxEnd = shouldHaveLunch
      ? new Date(Math.min(closeTime.getTime(), morningDeadline.getTime()))
      : closeTime;

    const activityItem = scheduler.addItem({
      id: generateId(),
      title: attraction.name,
      type: 'activity',
      duration: attraction.duration,
      travelTime,
      minStartTime: openTime,
      maxEndTime: morningMaxEnd,
      data: { attraction },
    });

    if (activityItem) {
      morningActivityCount++;
      // Track spending
      if (activityCost > 0 && budgetTracker) {
        budgetTracker.spend('activities', activityCost);
      }
      tripUsedAttractionIds.add(attraction.id);
      console.log(`[Jour ${dayNumber}] ✅ "${attraction.name}" schedulée (matin, ${attraction.duration}min, ${activityCost}€)`);
      const attractionCoords = {
        lat: attraction.latitude || cityCenter.lat,
        lng: attraction.longitude || cityCenter.lng,
      };
      if (!attraction.latitude || !attraction.longitude) {
        console.warn(`[TripDay] ⚠️ Attraction "${attraction.name}" sans coordonnées vérifiées — utilise cityCenter`);
      }
      // Générer le lien Google Maps avec itinéraire depuis le point précédent
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, pickDirectionMode(lastCoords, attractionCoords));
      items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
        description: attraction.description,
        // IMPORTANT: locationName doit inclure le nom de l'attraction pour les liens d'itinéraire
        locationName: `${attraction.name}, ${preferences.destination}`,
        latitude: attractionCoords.lat,
        longitude: attractionCoords.lng,
        estimatedCost: attraction.estimatedCost * preferences.groupSize,
        rating: attraction.rating ? Math.round(attraction.rating * 10) / 10 : undefined,
        bookingUrl: attraction.bookingUrl,
        timeFromPrevious: travelTime,
        googleMapsUrl,
        dataReliability: attraction.dataReliability || 'estimated', // POI réel de SerpAPI
      }));
      lastCoords = attractionCoords;
    }
  }
  } // Fin du bloc canDoMorningActivities

  // === REMPLISSAGE DES TROUS AVANT LE DÉJEUNER ===
  // Si on a du temps libre avant le déjeuner (> 60min), essayer d'ajouter des attractions supplémentaires
  {
    const currentHourBeforeLunch = scheduler.getCurrentTime().getHours();
    const currentMinBeforeLunch = scheduler.getCurrentTime().getMinutes();
    // CORRECTION: Borne à 12:00 si shouldHaveLunch pour protéger le créneau déjeuner
    const gapFillMorningLimitH = shouldHaveLunch ? 12 : 12;
    const gapFillMorningLimitM = shouldHaveLunch ? 0 : 30;
    const timeBeforeLunchMin = gapFillMorningLimitH * 60 + gapFillMorningLimitM - (currentHourBeforeLunch * 60 + currentMinBeforeLunch);

    if (timeBeforeLunchMin > 60) {
      // Chercher des attractions pas encore utilisées : d'abord dans la sélection du jour, puis allAttractions
      const unusedFromDay = attractions.filter(a => !tripUsedAttractionIds.has(a.id));
      const unusedFromAll = allAttractions
        .filter(a => !tripUsedAttractionIds.has(a.id) && !attractions.some(da => da.id === a.id))
        .filter(a => {
          if (!a.latitude || !a.longitude) return true;
          const d = calculateDistance(lastCoords.lat, lastCoords.lng, a.latitude, a.longitude);
          return d < 5; // 5km proximity
        });
      const unusedAttractionsMorning = [...unusedFromDay, ...unusedFromAll];

      for (const attraction of unusedAttractionsMorning) {
        // Même logique "1 activité longue" que le bloc matin
        const gapFillDeadline = shouldHaveLunch
          ? parseTime(date, morningActivityCount === 0 ? '13:00' : '12:00')
          : parseTime(date, '12:30');

        const estimatedTravelTimeMorning = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
        const estimatedEndTimeMorning = new Date(scheduler.getCurrentTime().getTime() + (estimatedTravelTimeMorning + attraction.duration + 15) * 60 * 1000);

        if (estimatedEndTimeMorning > gapFillDeadline) {
          continue;
        }

        // Vérifier les horaires d'ouverture
        const openTimeMorning = parseTime(date, attraction.openingHours.open);
        const closeTimeMorning = parseTime(date, attraction.openingHours.close);
        const safeCloseTimeMorning = new Date(closeTimeMorning.getTime() - 30 * 60 * 1000);

        let actualStartTimeMorning = new Date(scheduler.getCurrentTime().getTime() + estimatedTravelTimeMorning * 60 * 1000);
        if (actualStartTimeMorning < openTimeMorning) {
          actualStartTimeMorning = openTimeMorning;
        }

        const potentialEndTimeMorning = new Date(actualStartTimeMorning.getTime() + attraction.duration * 60 * 1000);
        if (potentialEndTimeMorning > safeCloseTimeMorning || potentialEndTimeMorning > gapFillDeadline) {
          continue;
        }

        // PROTECTION DÉJEUNER: deadline dynamique selon morningActivityCount
        const gapFillMaxEnd = shouldHaveLunch
          ? new Date(Math.min(closeTimeMorning.getTime(), gapFillDeadline.getTime()))
          : closeTimeMorning;

        const activityItemMorning = scheduler.addItem({
          id: generateId(),
          title: attraction.name,
          type: 'activity',
          duration: attraction.duration,
          travelTime: estimatedTravelTimeMorning,
          minStartTime: openTimeMorning,
          maxEndTime: gapFillMaxEnd,
        });

        if (activityItemMorning) {
          morningActivityCount++;
          tripUsedAttractionIds.add(attraction.id);
          const attractionCoordsMorning = {
            lat: attraction.latitude || cityCenter.lat,
            lng: attraction.longitude || cityCenter.lng,
          };
          const googleMapsUrlMorning = generateGoogleMapsUrl(lastCoords, attractionCoordsMorning, pickDirectionMode(lastCoords, attractionCoordsMorning));

          items.push(schedulerItemToTripItem(activityItemMorning, dayNumber, orderIndex++, {
            description: attraction.description,
            locationName: `${attraction.name}, ${preferences.destination}`,
            latitude: attractionCoordsMorning.lat,
            longitude: attractionCoordsMorning.lng,
            estimatedCost: attraction.estimatedCost * preferences.groupSize,
            rating: attraction.rating ? Math.round(attraction.rating * 10) / 10 : undefined,
            bookingUrl: attraction.bookingUrl,
            timeFromPrevious: estimatedTravelTimeMorning,
            googleMapsUrl: googleMapsUrlMorning,
            dataReliability: attraction.dataReliability || 'estimated',
          }));
          lastCoords = attractionCoordsMorning;
        }
      }
    }
  }

  // Déjeuner — fenêtre flexible entre 12:00 et 13:30
  // Se cale juste après la dernière activité du matin (pas de trou inutile)
  let lunchWasInserted = false; // Track across all strategies
  if (shouldHaveLunch) {
    const lunchEarliest = parseTime(date, '12:00');
    const lunchLatest = parseTime(date, '13:30');
    const cursorNow = scheduler.getCurrentTime();
    // Le déjeuner commence au plus tôt à 12:00, ou juste après le curseur si on est déjà passé 12:00
    const lunchStartTime = cursorNow > lunchEarliest ? cursorNow : lunchEarliest;

    if (lunchStartTime <= lunchLatest) {
      const lunchDuration = 75; // 1h15
      const lunchEndTime = new Date(lunchStartTime.getTime() + lunchDuration * 60 * 1000);
      const lunchItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Déjeuner',
        type: 'restaurant',
        startTime: lunchStartTime,
        endTime: lunchEndTime,
      });

      if (lunchItem) {
        if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
          items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
            title: 'Déjeuner pique-nique / maison',
            description: 'Repas préparé avec les courses | Option économique',
            locationName: `Centre-ville, ${preferences.destination}`,
            latitude: accommodation?.latitude || lastCoords.lat,
            longitude: accommodation?.longitude || lastCoords.lng,
            estimatedCost: 8 * (preferences.groupSize || 1),
          }));
        } else {
          lastCoords = getLastItemCoords(items, cityCenter);
          const restaurant = hasPrefetchedRestaurant('lunch')
                  ? getPrefetchedRestaurant('lunch')
                  : await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
          const restaurantCoords = {
            lat: restaurant?.latitude || lastCoords.lat,
            lng: restaurant?.longitude || lastCoords.lng,
          };
          if (!restaurant?.latitude || !restaurant?.longitude) {
            console.warn(`[TripDay] ⚠️ Restaurant "${restaurant?.name || 'unknown'}" sans coordonnées — utilise position actuelle`);
          }
          const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
          const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
            getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

          items.push(schedulerItemToTripItem(lunchItem, dayNumber, orderIndex++, {
            title: restaurant?.name || 'Déjeuner',
            description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Déjeuner local',
            locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
            latitude: restaurantCoords.lat,
            longitude: restaurantCoords.lng,
            estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
            rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
            googleMapsUrl,
            googleMapsPlaceUrl: restaurantGoogleMapsUrl,
          }));
          lastCoords = restaurantCoords;
        }
        scheduler.advanceTo(lunchEndTime);
        lunchWasInserted = true;
      } else {
        // Fallback: insertFixedItem a échoué (conflit), essayer avec des créneaux alternatifs
        const fallbackSlots = ['12:15', '12:45', '13:15', '13:45', '14:00'];
        let lunchInserted = false;
        for (const slot of fallbackSlots) {
          const fallbackStart = parseTime(date, slot);
          const fallbackEnd = new Date(fallbackStart.getTime() + lunchDuration * 60 * 1000);
          // Rejeter si le déjeuner commencerait après 14:30
          if (fallbackStart > parseTime(date, '14:30')) break;
          const fallbackItem = scheduler.insertFixedItem({
            id: generateId(),
            title: 'Déjeuner',
            type: 'restaurant',
            startTime: fallbackStart,
            endTime: fallbackEnd,
          });
          if (fallbackItem) {
            if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
              items.push(schedulerItemToTripItem(fallbackItem, dayNumber, orderIndex++, {
                title: 'Déjeuner pique-nique / maison',
                description: 'Repas préparé avec les courses | Option économique',
                locationName: `Centre-ville, ${preferences.destination}`,
                latitude: accommodation?.latitude || lastCoords.lat,
                longitude: accommodation?.longitude || lastCoords.lng,
                estimatedCost: 8 * (preferences.groupSize || 1),
              }));
            } else {
              lastCoords = getLastItemCoords(items, cityCenter);
              const restaurant = hasPrefetchedRestaurant('lunch')
                ? getPrefetchedRestaurant('lunch')
                : await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
              const restaurantCoords = {
                lat: restaurant?.latitude || lastCoords.lat,
                lng: restaurant?.longitude || lastCoords.lng,
              };
              const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
              const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
                getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);
              items.push(schedulerItemToTripItem(fallbackItem, dayNumber, orderIndex++, {
                title: restaurant?.name || 'Déjeuner',
                description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Déjeuner local',
                locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
                latitude: restaurantCoords.lat,
                longitude: restaurantCoords.lng,
                estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
                rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
                googleMapsUrl,
                googleMapsPlaceUrl: restaurantGoogleMapsUrl,
              }));
              lastCoords = restaurantCoords;
            }
            scheduler.advanceTo(fallbackEnd);
            lunchInserted = true;
            lunchWasInserted = true;
            break;
          }
        }
        if (!lunchInserted) {
          // Dernier recours: addItem() cursor-based avec minStartTime 12:00
          const cursorLunchItem = scheduler.addItem({
            id: generateId(),
            title: 'Déjeuner',
            type: 'restaurant',
            duration: lunchDuration,
            travelTime: 10,
            minStartTime: parseTime(date, '12:00'),
            maxEndTime: parseTime(date, '14:30'),  // Le lunch ne peut PAS finir après 14:30
          });
          if (cursorLunchItem) {
            const cursorLunchEnd = cursorLunchItem.slot.end;
            // Rejeter si le déjeuner commence après 14:30
            if (cursorLunchItem.slot.start <= parseTime(date, '14:30')) {
              if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
                items.push(schedulerItemToTripItem(cursorLunchItem, dayNumber, orderIndex++, {
                  title: 'Déjeuner pique-nique / maison',
                  description: 'Repas préparé avec les courses | Option économique',
                  locationName: `Centre-ville, ${preferences.destination}`,
                  latitude: accommodation?.latitude || lastCoords.lat,
                  longitude: accommodation?.longitude || lastCoords.lng,
                  estimatedCost: 8 * (preferences.groupSize || 1),
                }));
              } else {
                lastCoords = getLastItemCoords(items, cityCenter);
                const restaurant = hasPrefetchedRestaurant('lunch')
                  ? getPrefetchedRestaurant('lunch')
                  : await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
                const restaurantCoords = {
                  lat: restaurant?.latitude || lastCoords.lat,
                  lng: restaurant?.longitude || lastCoords.lng,
                };
                const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
                const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
                  getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);
                items.push(schedulerItemToTripItem(cursorLunchItem, dayNumber, orderIndex++, {
                  title: restaurant?.name || 'Déjeuner',
                  description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Déjeuner local',
                  locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
                  latitude: restaurantCoords.lat,
                  longitude: restaurantCoords.lng,
                  estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
                  rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
                  googleMapsUrl,
                  googleMapsPlaceUrl: restaurantGoogleMapsUrl,
                }));
                lastCoords = restaurantCoords;
              }
              lunchWasInserted = true;
            } else {
              console.warn(`[Jour ${dayNumber}] ⚠️ Stratégie 3: Lunch placé à ${formatScheduleTime(cursorLunchItem.slot.start)} — rejeté (après 14:30)`);
            }
          } else {
            console.warn(`[Jour ${dayNumber}] ⚠️ Stratégie 3: scheduler.addItem a échoué pour le déjeuner`);
          }
        }
      }
    } else {
      console.warn(`[Jour ${dayNumber}] ⚠️ Stratégie 1: lunchStartTime (${formatScheduleTime(lunchStartTime)}) > 13:30 — skip`);
    }
  }

  // === DERNIER RECOURS DÉJEUNER ===
  // Si shouldHaveLunch mais aucun déjeuner n'a été inséré par les 3 stratégies,
  // forcer l'insertion au cursor actuel tant qu'il est avant 15:30
  if (shouldHaveLunch && !lunchWasInserted) {
    const lastResortLimit = parseTime(date, '15:30');
    if (scheduler.getCurrentTime() < lastResortLimit) {
      const lastResortLunch = scheduler.addItem({
        id: generateId(),
        title: 'Déjeuner',
        type: 'restaurant',
        duration: 60, // Réduit à 1h en dernier recours
        travelTime: 5,
        minStartTime: parseTime(date, '12:00'),  // Pas de déjeuner avant 12h
        maxEndTime: parseTime(date, '15:30'),     // Limite étendue en dernier recours
      });
      // CORRECTION: Rejeter si le lunch commence après 14:30 — forcer le passage au fallback ultime
      // qui réorganise les activités pour faire de la place au lunch à 13:00
      if (lastResortLunch && lastResortLunch.slot.start < parseTime(date, '14:30')) {
        if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
          items.push(schedulerItemToTripItem(lastResortLunch, dayNumber, orderIndex++, {
            title: 'Déjeuner pique-nique / maison',
            description: 'Repas préparé avec les courses | Option économique',
            locationName: `Centre-ville, ${preferences.destination}`,
            latitude: accommodation?.latitude || lastCoords.lat,
            longitude: accommodation?.longitude || lastCoords.lng,
            estimatedCost: 8 * (preferences.groupSize || 1),
          }));
        } else {
          const restaurant = hasPrefetchedRestaurant('lunch')
            ? getPrefetchedRestaurant('lunch')
            : await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
          const restaurantCoords = {
            lat: restaurant?.latitude || lastCoords.lat,
            lng: restaurant?.longitude || lastCoords.lng,
          };
          const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
          const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
            getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);
          items.push(schedulerItemToTripItem(lastResortLunch, dayNumber, orderIndex++, {
            title: restaurant?.name || 'Déjeuner',
            description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Déjeuner local',
            locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
            latitude: restaurantCoords.lat,
            longitude: restaurantCoords.lng,
            estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
            rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
            googleMapsUrl,
            googleMapsPlaceUrl: restaurantGoogleMapsUrl,
          }));
          lastCoords = restaurantCoords;
        }
        lunchWasInserted = true;
      } else {
        console.warn(`[Jour ${dayNumber}] ⚠️ Stratégie 4: Lunch rejeté (slot trop tard ou échec scheduler)`);
      }
    } else {
      console.warn(`[Jour ${dayNumber}] ⚠️ Stratégie 4: curseur déjà à ${formatScheduleTime(scheduler.getCurrentTime())} (> 15:30) — skip`);
    }
  }

  // === FALLBACK ULTIME DÉJEUNER ===
  // Si malgré toutes les stratégies le déjeuner n'est pas inséré, le forcer directement dans items
  // Cela ne doit JAMAIS arriver en production — c'est un filet de sécurité
  if (shouldHaveLunch && !lunchWasInserted) {
    console.error(`[Jour ${dayNumber}] ❌ CRITIQUE: Déjeuner non inséré par le scheduler — forçage direct`);
    // Trouver le meilleur créneau: juste après la dernière activité du matin, ou 13:00 par défaut
    const existingItemsByTime = [...items].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    let forcedStart = '13:00';
    let forcedEnd = '14:00';
    // Chercher un item qui finit entre 11:30 et 14:00 — placer le lunch juste après
    for (const it of existingItemsByTime) {
      if (it.endTime && it.endTime >= '11:30' && it.endTime <= '14:00') {
        const [eh, em] = it.endTime.split(':').map(Number);
        const startMin = eh * 60 + em + 10; // 10min de battement
        forcedStart = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
        const endMin = startMin + 60;
        forcedEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      }
    }
    // Décaler les items de l'après-midi qui chevauchent le créneau lunch
    const lunchStartMin = parseInt(forcedStart.split(':')[0]) * 60 + parseInt(forcedStart.split(':')[1]);
    const lunchEndMin = parseInt(forcedEnd.split(':')[0]) * 60 + parseInt(forcedEnd.split(':')[1]);
    for (const it of items) {
      if (!it.startTime || !it.endTime) continue;
      const [sh, sm] = it.startTime.split(':').map(Number);
      const [eeh, eem] = it.endTime.split(':').map(Number);
      const itStart = sh * 60 + sm;
      const itEnd = eeh * 60 + eem;
      // Si cet item chevauche le créneau lunch et commence après 12:00, le décaler
      if (itStart >= lunchStartMin - 10 && itStart < lunchEndMin && sh >= 12) {
        const shift = lunchEndMin - itStart + 10;
        const newStart = itStart + shift;
        const newEnd = itEnd + shift;
        it.startTime = `${String(Math.floor(newStart / 60)).padStart(2, '0')}:${String(newStart % 60).padStart(2, '0')}`;
        it.endTime = `${String(Math.floor(newEnd / 60)).padStart(2, '0')}:${String(newEnd % 60).padStart(2, '0')}`;
      }
    }
    if (shouldSelfCater('lunch', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
      items.push({
        id: generateId(), dayNumber, orderIndex: orderIndex++,
        startTime: forcedStart, endTime: forcedEnd, type: 'restaurant',
        title: 'Déjeuner pique-nique / maison',
        description: 'Repas préparé avec les courses | Option économique',
        locationName: `Centre-ville, ${preferences.destination}`,
        latitude: accommodation?.latitude || lastCoords.lat,
        longitude: accommodation?.longitude || lastCoords.lng,
        estimatedCost: 8 * (preferences.groupSize || 1),
      } as TripItem);
    } else {
      const restaurant = await findRestaurantForMeal('lunch', cityCenter, preferences, dayNumber, lastCoords);
      const restaurantCoords = {
        lat: restaurant?.latitude || lastCoords.lat,
        lng: restaurant?.longitude || lastCoords.lng,
      };
      items.push({
        id: generateId(), dayNumber, orderIndex: orderIndex++,
        startTime: forcedStart, endTime: forcedEnd, type: 'restaurant',
        title: restaurant?.name || 'Déjeuner',
        description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Déjeuner local',
        locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
        latitude: restaurantCoords.lat,
        longitude: restaurantCoords.lng,
        estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * preferences.groupSize,
        rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
      } as TripItem);
      lastCoords = restaurantCoords;
    }
    lunchWasInserted = true;
  }

  // Activités de l'après-midi
  // Optimiser l'ordre pour minimiser la distance totale (nearest-neighbor + 2-opt)
  const dinnerTimeAfternoon = parseTime(date, '19:30');
  const afternoonEnd = endHour >= 20 ? dinnerTimeAfternoon : dayEnd;
  const afternoonAttractions = optimizeAttractionOrder(
    [...attractions], lastCoords, date, afternoonEnd, scheduler.getCurrentTime()
  );

  for (const attraction of afternoonAttractions) {
    // ANTI-DOUBLON: Skip si déjà utilisée dans n'importe quel jour du voyage
    if (tripUsedAttractionIds.has(attraction.id)) {
      continue;
    }

    // LOCATION TRACKING: Vérifier que l'utilisateur est bien à destination
    const locationValidation = locationTracker.validateActivity({
      city: preferences.destination,
      name: attraction.name,
    });
    if (!locationValidation.valid) {
      continue;
    }

    // Vérifier qu'on a le temps avant le dîner (19:30) ou la fin de journée
    const dinnerTime = parseTime(date, '19:30');
    const maxTime = endHour >= 20 ? dinnerTime : dayEnd;

    if (scheduler.getCurrentTime().getTime() + 30 * 60 * 1000 + attraction.duration * 60 * 1000 > maxTime.getTime()) {
      // CORRIGÉ: continue au lieu de break pour essayer les autres attractions (plus courtes)
      continue;
    }

    const travelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as any, attraction);
    const openTime = parseTime(date, attraction.openingHours.open);
    const closeTime = parseTime(date, attraction.openingHours.close);

    // MARGE DE SÉCURITÉ: On doit finir 30 min AVANT la fermeture (dernière entrée)
    const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

    // Calculer l'heure de debut reelle (meme logique que le scheduler)
    let actualStartTime = new Date(scheduler.getCurrentTime().getTime() + travelTime * 60 * 1000);
    // Si on arrive avant l'ouverture, on attend
    if (actualStartTime < openTime && openTime >= scheduler.getCurrentTime()) {
      actualStartTime = new Date(openTime);
    }

    // GUARD: Si on arrive APRÈS la fermeture, skip immédiatement
    if (actualStartTime >= closeTime) {
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}" (après-midi): arrive après fermeture`);
      continue;
    }

    // Calculer l'heure de fin reelle
    const potentialEndTime = new Date(actualStartTime.getTime() + attraction.duration * 60 * 1000);

    // Vérifier que le lieu sera encore ouvert quand on aura fini (avec marge de 30min)
    if (potentialEndTime > safeCloseTime) {
      console.log(`[Jour ${dayNumber}] Skip "${attraction.name}" (après-midi): lieu fermé avant fin de visite`);
      continue;
    }

    // Budget check: skip if activity costs more than remaining budget
    // EXCEPTION: activités gratuites et must-see passent toujours
    const activityCostPM = (attraction.estimatedCost || 0) * (preferences.groupSize || 1);
    const isMustSeePM = (attraction as any).mustSee === true;
    if (activityCostPM > 0 && !isMustSeePM && budgetTracker && !budgetTracker.canAfford('activities', activityCostPM)) {
      console.warn(`[Jour ${dayNumber}] ⚠️ "${attraction.name}" skippée (après-midi): budget épuisé (coût: ${activityCostPM}€)`);
      continue;
    }

    const activityItem = scheduler.addItem({
      id: generateId(),
      title: attraction.name,
      type: 'activity',
      duration: attraction.duration,
      travelTime,
      minStartTime: openTime,
      maxEndTime: closeTime,
      data: { attraction },
    });

    if (activityItem) {
      // Track spending
      if (activityCostPM > 0 && budgetTracker) {
        budgetTracker.spend('activities', activityCostPM);
      }
      tripUsedAttractionIds.add(attraction.id);
      console.log(`[Jour ${dayNumber}] ✅ "${attraction.name}" schedulée (après-midi, ${attraction.duration}min, ${activityCostPM}€)`);
      const attractionCoords = {
        lat: attraction.latitude || cityCenter.lat,
        lng: attraction.longitude || cityCenter.lng,
      };
      if (!attraction.latitude || !attraction.longitude) {
        console.warn(`[TripDay] ⚠️ Attraction "${attraction.name}" sans coordonnées vérifiées — utilise cityCenter`);
      }
      // Générer le lien Google Maps avec itinéraire depuis le point précédent
      const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, pickDirectionMode(lastCoords, attractionCoords));
      items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
        description: attraction.description,
        // IMPORTANT: locationName doit inclure le nom de l'attraction pour les liens d'itinéraire
        locationName: `${attraction.name}, ${preferences.destination}`,
        latitude: attractionCoords.lat,
        longitude: attractionCoords.lng,
        estimatedCost: attraction.estimatedCost * preferences.groupSize,
        rating: attraction.rating ? Math.round(attraction.rating * 10) / 10 : undefined,
        bookingUrl: attraction.bookingUrl,
        timeFromPrevious: travelTime,
        googleMapsUrl,
        dataReliability: attraction.dataReliability || 'estimated', // POI réel de SerpAPI
      }));
      lastCoords = attractionCoords;
    }
  }

  // === REMPLISSAGE DES TROUS AVANT LE DÎNER ===
  // Si on a du temps libre avant le dîner (> 60min), essayer d'ajouter des attractions supplémentaires
  // Prendre des attractions qui n'ont pas encore été utilisées dans le voyage
  // CORRIGÉ: Seuil de 60min au lieu de 90min pour éviter les trous d'1h+
  // Borne effective pour le gap-fill: min(dayEnd, 19:00) — respecte le dernier jour
  const gapFillBoundary = dayEnd < parseTime(date, '19:00') ? dayEnd : parseTime(date, '19:00');
  const timeBeforeBoundaryMs = gapFillBoundary.getTime() - scheduler.getCurrentTime().getTime();
  const timeBeforeDinnerMin = timeBeforeBoundaryMs / (1000 * 60);

  if (timeBeforeDinnerMin > 60) {
    // Smart gap filling: use allAttractions but filter by proximity + diversity
    const dayTypes = new Set(attractions.filter(a => tripUsedAttractionIds.has(a.id)).map(a => a.type));
    const dayHasReligious = attractions.some(a => tripUsedAttractionIds.has(a.id) && /church|cathedral|basilica|chapel|mosque|synagogue|temple|shrine/i.test(a.name));

    // Compute centroid of day's placed attractions for proximity filter
    const placedAttractions = attractions.filter(a => tripUsedAttractionIds.has(a.id) && a.latitude && a.longitude);
    const centroid = placedAttractions.length > 0 ? {
      lat: placedAttractions.reduce((s, a) => s + a.latitude, 0) / placedAttractions.length,
      lng: placedAttractions.reduce((s, a) => s + a.longitude, 0) / placedAttractions.length,
    } : cityCenter;

    let gapFillAdded = 0;
    const MAX_GAP_FILL = 3; // Allow up to 3 gap-fill attractions to avoid large empty blocks
    const PROXIMITY_KM = 5; // 5km radius from day's centroid (covers most city neighborhoods)
    const unusedAttractions = allAttractions.filter(a => {
      if (tripUsedAttractionIds.has(a.id)) return false;
      // Proximity: within ~5km of day's centroid (or last placed coords)
      if (a.latitude && a.longitude) {
        const refPoint = lastCoords.lat !== cityCenter.lat ? lastCoords : centroid;
        const dlat = (a.latitude - refPoint.lat) * 111;
        const dlng = (a.longitude - refPoint.lng) * 111 * Math.cos(refPoint.lat * Math.PI / 180);
        if (Math.sqrt(dlat * dlat + dlng * dlng) > PROXIMITY_KM) return false;
      }
      // No religious if day already has one
      if (dayHasReligious && /church|cathedral|basilica|chapel|mosque|synagogue|temple|shrine/i.test(a.name)) return false;
      return true;
    });

    if (unusedAttractions.length > 0) {
      // Sort by distance to last coords (nearest first) for optimal gap filling
      unusedAttractions.sort((a, b) => {
        const distA = calculateDistance(lastCoords.lat, lastCoords.lng, a.latitude || 0, a.longitude || 0);
        const distB = calculateDistance(lastCoords.lat, lastCoords.lng, b.latitude || 0, b.longitude || 0);
        return distA - distB;
      });
      for (const attraction of unusedAttractions) {
        if (gapFillAdded >= MAX_GAP_FILL) break;
        // Vérifier qu'on a le temps avant la borne (min(dayEnd, 19:00))
        const estimatedTravelTime = estimateTravelTime({ latitude: lastCoords.lat, longitude: lastCoords.lng } as Attraction, attraction);
        const estimatedEndTime = new Date(scheduler.getCurrentTime().getTime() + (estimatedTravelTime + attraction.duration + 15) * 60 * 1000);

        if (estimatedEndTime > gapFillBoundary) {
          // CORRIGÉ: continue au lieu de break pour essayer les autres attractions (plus courtes)
          continue;
        }

        // Vérifier les horaires d'ouverture
        const openTime = parseTime(date, attraction.openingHours.open);
        const closeTime = parseTime(date, attraction.openingHours.close);
        const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

        let actualStartTime = new Date(scheduler.getCurrentTime().getTime() + estimatedTravelTime * 60 * 1000);
        if (actualStartTime < openTime) {
          actualStartTime = openTime;
        }

        // GUARD: Si on arrive APRÈS la fermeture, skip immédiatement
        if (actualStartTime >= closeTime) {
          continue;
        }

        const potentialEndTime = new Date(actualStartTime.getTime() + attraction.duration * 60 * 1000);
        if (potentialEndTime > safeCloseTime) {
          continue;
        }

        // Budget check for gap-fill activities
        const gapFillCost = (attraction.estimatedCost || 0) * (preferences.groupSize || 1);
        if (gapFillCost > 0 && budgetTracker && !budgetTracker.canAfford('activities', gapFillCost)) {
          continue;
        }

        const activityItem = scheduler.addItem({
          id: generateId(),
          title: attraction.name,
          type: 'activity',
          duration: attraction.duration,
          travelTime: estimatedTravelTime,
          minStartTime: openTime,
          maxEndTime: closeTime,
        });

        if (activityItem) {
          gapFillAdded++;
          if (gapFillCost > 0 && budgetTracker) {
            budgetTracker.spend('activities', gapFillCost);
          }
          tripUsedAttractionIds.add(attraction.id);
          const attractionCoords = {
            lat: attraction.latitude || cityCenter.lat,
            lng: attraction.longitude || cityCenter.lng,
          };
          if (!attraction.latitude || !attraction.longitude) {
            console.warn(`[TripDay] ⚠️ Attraction "${attraction.name}" sans coordonnées vérifiées — utilise cityCenter`);
          }
          const googleMapsUrl = generateGoogleMapsUrl(lastCoords, attractionCoords, pickDirectionMode(lastCoords, attractionCoords));

          items.push(schedulerItemToTripItem(activityItem, dayNumber, orderIndex++, {
            description: attraction.description,
            locationName: `${attraction.name}, ${preferences.destination}`,
            latitude: attractionCoords.lat,
            longitude: attractionCoords.lng,
            estimatedCost: attraction.estimatedCost * preferences.groupSize,
            rating: attraction.rating ? Math.round(attraction.rating * 10) / 10 : undefined,
            bookingUrl: attraction.bookingUrl,
            timeFromPrevious: estimatedTravelTime,
            googleMapsUrl,
            dataReliability: attraction.dataReliability || 'estimated',
          }));
          lastCoords = attractionCoords;
        }
      }
    } else {
    }
  }

  // Diner - TOUJOURS prévoir pour les jours intermédiaires si la journée finit assez tard
  const currentTimeForDinner = scheduler.getCurrentTime();
  const currentDinnerHour = currentTimeForDinner.getHours();

  // CORRECTION: On vérifie si la JOURNÉE doit avoir un dîner (endHour >= 20), pas si on est DÉJÀ à 19h
  // Cela évite le bug où le scheduler reste bloqué à 17h et ne propose jamais de dîner
  const daySupportsDinner = endHour >= 20; // Journée assez longue pour un dîner
  const canHaveDinner = scheduler.canFit(90, 15); // 90min diner + 15min trajet
  // CORRECTION: Pas de dîner après 22h — évite les horaires > 23:59
  const tooLateForDinner = currentTimeForDinner >= parseTime(date, '22:00');
  // Dernier jour: autoriser le dîner si la journée finit assez tard (vol/transport tard)
  const shouldAddDinner = daySupportsDinner && canHaveDinner && !tooLateForDinner;

  if (shouldAddDinner) {
    // Forcer le dîner à commencer à 19h minimum (pas avant, restaurants fermés + gens pas faim)
    const dinnerMinTime = parseTime(date, '19:00');
    const dinnerItem = scheduler.addItem({
      id: generateId(),
      title: 'Dîner',
      type: 'restaurant',
      duration: 90,
      travelTime: 15,
      minStartTime: dinnerMinTime, // FORCE 19h minimum
    });
    if (dinnerItem) {
      if (shouldSelfCater('dinner', dayNumber, budgetStrategy, false, preferences.durationDays, isDayTrip, groceriesDone)) {
        // Dîner self_catered : cuisine au logement
        const accommodationCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
        items.push(schedulerItemToTripItem(dinnerItem, dayNumber, orderIndex++, {
          title: 'Dîner au logement',
          description: 'Repas cuisiné au logement | Courses au supermarché local',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodationCoords.lat,
          longitude: accommodationCoords.lng,
          estimatedCost: 10 * (preferences.groupSize || 1), // ~10€/pers
        }));
        lastCoords = accommodationCoords;
      } else {
        lastCoords = getLastItemCoords(items, cityCenter);
        const restaurant = hasPrefetchedRestaurant('dinner')
          ? getPrefetchedRestaurant('dinner')
          : await findRestaurantForMeal('dinner', cityCenter, preferences, dayNumber, lastCoords);
        const restaurantCoords = {
          lat: restaurant?.latitude || lastCoords.lat,
          lng: restaurant?.longitude || lastCoords.lng,
        };
        if (!restaurant?.latitude || !restaurant?.longitude) {
          console.warn(`[TripDay] ⚠️ Restaurant "${restaurant?.name || 'unknown'}" sans coordonnées — utilise position actuelle`);
        }
        const googleMapsUrl = generateGoogleMapsUrl(lastCoords, restaurantCoords, pickDirectionMode(lastCoords, restaurantCoords));
        const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
          getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

        items.push(schedulerItemToTripItem(dinnerItem, dayNumber, orderIndex++, {
          title: restaurant?.name || 'Dîner',
          description: restaurant ? `${restaurant.cuisineTypes?.length ? restaurant.cuisineTypes.join(', ') + ' | ' : ''}⭐ ${restaurant.rating?.toFixed(1) || '?'}/5` : 'Dîner local',
          locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
          latitude: restaurantCoords.lat,
          longitude: restaurantCoords.lng,
          estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'dinner') * preferences.groupSize,
          rating: restaurant?.rating ? Math.round(restaurant.rating * 10) / 10 : undefined,
          googleMapsUrl,
          googleMapsPlaceUrl: restaurantGoogleMapsUrl,
        }));
        lastCoords = restaurantCoords;
      }
    }
  }

  // === APRÈS LE DÎNER ===
  // On ne génère plus d'activités génériques après le dîner ("Promenade digestive", "Glace artisanale")
  // Sauf si l'utilisateur a explicitement demandé "nightlife" - dans ce cas on ajoute UNE activité nocturne
  const currentTimeAfterDinnerCheck = scheduler.getCurrentTime();
  const hoursAfterDinner = currentTimeAfterDinnerCheck.getHours();
  // Activité nocturne UNIQUEMENT si nightlife demandé explicitement
  if (hasNightlife && !isLastDay && hoursAfterDinner >= 20 && hoursAfterDinner < 23) {
    const canFitNightlife = scheduler.canFit(90, 15);

    if (canFitNightlife) {
      // Note: Ces activités sont génériques mais acceptables car l'utilisateur a demandé "nightlife"
      // TODO: Remplacer par des vrais bars/clubs récupérés via SerpAPI
    }
  }

  // === DERNIER JOUR: LOGISTIQUE RETOUR ===
  if (isLastDay) {
    if (returnFlight) {
      const flightDeparture = new Date(returnFlight.departureTime);
      const flightArrival = new Date(returnFlight.arrivalTime);

      // Check-out hôtel — réutiliser le checkout pré-inséré si disponible
      const checkoutItem = checkoutAlreadyInserted ? earlyCheckoutItem : (() => {
        const checkoutByFlight = new Date(flightDeparture.getTime() - 210 * 60 * 1000);
        const checkoutByStandard = parseTime(date, '12:00');
        const checkoutStart = checkoutByFlight < checkoutByStandard ? checkoutByFlight : checkoutByStandard;
        const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
        const hotelNameCheckout = accommodation?.name || 'Hébergement';
        return scheduler.insertFixedItem({
          id: generateId(),
          title: `Check-out ${hotelNameCheckout}`,
          type: 'checkout',
          startTime: checkoutStart,
          endTime: checkoutEnd,
        });
      })();
      if (checkoutItem) {
        items.push(schedulerItemToTripItem(checkoutItem, dayNumber, orderIndex++, {
          description: 'Libérez votre hébergement.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
        }));
        if (!accommodation?.latitude) {
          console.warn(`[TripDay] ⚠️ Hébergement sans coordonnées vérifiées`);
        }
      }

      // Transfert hôtel → aéroport (2h avant vol)
      const transferEnd = new Date(flightDeparture.getTime() - 120 * 60 * 1000);
      const transferStart = new Date(transferEnd.getTime() - 40 * 60 * 1000); // 40min de trajet par défaut
      const transferItem = scheduler.insertFixedItem({
        id: generateId(),
        title: 'Transfert Hôtel → Aéroport',
        type: 'transport',
        startTime: transferStart,
        endTime: transferEnd,
      });
      if (transferItem) {
        items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
          description: preferences.carRental ? 'Rendez votre voiture.' : 'Taxi ou transports.',
          locationName: `Centre-ville → ${destAirport.name}`,
          latitude: destAirport.latitude,
          longitude: destAirport.longitude,
          estimatedCost: preferences.carRental ? 0 : 25 * Math.ceil(preferences.groupSize / 4),
        }));
      }

      // Vol retour
      // Utiliser les heures d'affichage si disponibles (heures locales de l'aéroport)
      const returnFlightStartTime = returnFlight.departureTimeDisplay || formatTime(flightDeparture);
      const returnFlightEndTime = returnFlight.arrivalTimeDisplay || formatTime(flightArrival);

      const flightItem = scheduler.insertFixedItem({
        id: generateId(),
        title: `Vol ${returnFlight.flightNumber} → ${preferences.origin}`,
        type: 'flight',
        startTime: flightDeparture,
        endTime: flightArrival,
        data: { flight: returnFlight, displayTimes: { start: returnFlightStartTime, end: returnFlightEndTime } },
      });
      if (flightItem) {
        // Utiliser l'URL de réservation du vol (Google Flights) si disponible
        const tripEndDateReturn = new Date(tripStartDate);
        tripEndDateReturn.setDate(tripEndDateReturn.getDate() + preferences.durationDays - 1);
        const returnFlightBookingUrl = returnFlight.bookingUrl || generateFlightLink(
          { origin: destAirport.code, destination: originAirport.code },
          { date: formatDateForUrl(tripEndDateReturn), passengers: preferences.groupSize }
        );

        // Créer l'item mais avec les heures d'affichage correctes
        // Afficher le prix par personne ET le prix total (avec protections NaN)
        const returnFlightPrice = returnFlight.price || 0;
        const returnGroupSize = preferences.groupSize || 1;
        const returnPricePerPerson = returnFlight.pricePerPerson || (returnFlightPrice > 0 ? Math.round(returnFlightPrice / returnGroupSize) : 0);
        const returnPriceDisplay = returnGroupSize > 1 && returnPricePerPerson > 0
          ? `${returnPricePerPerson}€/pers (${returnFlightPrice}€ total)`
          : returnFlightPrice > 0 ? `${returnFlightPrice}€` : 'Prix non disponible';
        const tripItem = schedulerItemToTripItem(flightItem, dayNumber, orderIndex++, {
          description: `${returnFlight.flightNumber} | ${formatFlightDuration(returnFlight.duration)} | ${returnFlight.stops === 0 ? 'Direct' : `${returnFlight.stops} escale(s)`} | ${returnPriceDisplay}`,
          locationName: `${destAirport.code} → ${originAirport.code}`,
          // Utiliser l'aéroport de départ (destination du voyage) pour le vol retour
          latitude: destAirport.latitude,
          longitude: destAirport.longitude,
          estimatedCost: returnFlight.price,
          bookingUrl: returnFlightBookingUrl,
        });
        // Override les heures avec les heures locales de l'aéroport
        tripItem.startTime = returnFlightStartTime;
        const isReturnOvernightDisplay = returnFlightEndTime < returnFlightStartTime;
        tripItem.endTime = isReturnOvernightDisplay ? `${returnFlightEndTime} (+1j)` : returnFlightEndTime;
        items.push(tripItem);
      }

      if (!flightItem) {
        // Forcer l'ajout du vol retour même si le scheduler ne peut pas l'insérer
        console.warn(`[Jour ${dayNumber}] ⚠️ Vol retour ${returnFlight.flightNumber} non inséré par le scheduler, ajout forcé`);
        const returnFlightPrice = returnFlight.price || 0;
        const returnGroupSize = preferences.groupSize || 1;
        const returnPricePerPerson = returnFlight.pricePerPerson || (returnFlightPrice > 0 ? Math.round(returnFlightPrice / returnGroupSize) : 0);
        const returnPriceDisplay = returnGroupSize > 1 && returnPricePerPerson > 0
          ? `${returnPricePerPerson}€/pers (${returnFlightPrice}€ total)`
          : returnFlightPrice > 0 ? `${returnFlightPrice}€` : 'Prix non disponible';
        const tripEndDateReturn = new Date(tripStartDate);
        tripEndDateReturn.setDate(tripEndDateReturn.getDate() + preferences.durationDays - 1);
        const returnFlightBookingUrl = returnFlight.bookingUrl || generateFlightLink(
          { origin: destAirport.code, destination: originAirport.code },
          { date: formatDateForUrl(tripEndDateReturn), passengers: preferences.groupSize }
        );
        const isReturnOvernightDisplay = returnFlightEndTime < returnFlightStartTime;
        items.push({
          id: generateId(),
          type: 'flight' as TripItemType,
          title: `Vol ${returnFlight.flightNumber} → ${preferences.origin}`,
          description: `${returnFlight.flightNumber} | ${formatFlightDuration(returnFlight.duration)} | ${returnFlight.stops === 0 ? 'Direct' : `${returnFlight.stops} escale(s)`} | ${returnPriceDisplay}`,
          startTime: returnFlightStartTime,
          endTime: isReturnOvernightDisplay ? `${returnFlightEndTime} (+1j)` : returnFlightEndTime,
          duration: returnFlight.duration,
          locationName: `${destAirport.code} → ${originAirport.code}`,
          // Utiliser l'aéroport de départ (destination du voyage) pour le vol retour
          latitude: destAirport.latitude,
          longitude: destAirport.longitude,
          estimatedCost: returnFlight.price,
          bookingUrl: returnFlightBookingUrl,
          dayNumber,
          orderIndex: orderIndex++,
        });
      }

      // Récupération parking - UNIQUEMENT si le vol retour arrive le MÊME JOUR
      // Pour les vols overnight (arrivée lendemain), le parking serait récupéré le lendemain
      if (parking) {
        const returnDepDay = new Date(flightDeparture.getFullYear(), flightDeparture.getMonth(), flightDeparture.getDate());
        const returnArrDay = new Date(flightArrival.getFullYear(), flightArrival.getMonth(), flightArrival.getDate());
        const isReturnOvernight = returnArrDay.getTime() > returnDepDay.getTime();

        if (!isReturnOvernight) {
          // Vol retour normal: récupération du parking le même jour
          const parkingStart = new Date(flightArrival.getTime() + 30 * 60 * 1000);
          const parkingEnd = new Date(parkingStart.getTime() + 30 * 60 * 1000);
          const parkingItem = scheduler.insertFixedItem({
            id: generateId(),
            title: `Récupération véhicule: ${parking.name}`,
            type: 'parking',
            startTime: parkingStart,
            endTime: parkingEnd,
            data: { parking },
          });
          if (parkingItem) {
            items.push(schedulerItemToTripItem(parkingItem, dayNumber, orderIndex++, {
              description: 'Navette et récupération de votre véhicule.',
              locationName: parking.address,
              latitude: parking.latitude,
              longitude: parking.longitude,
            }));
          }
        } else {
          // Vol retour overnight: le parking sera récupéré le lendemain (pas dans ce voyage)
        }
      }

    } else if (groundTransport) {
      // Check-out — réutiliser le checkout pré-inséré si disponible
      const checkoutItemGround = checkoutAlreadyInserted ? earlyCheckoutItem : (() => {
        const checkoutStart = parseTime(date, '10:00');
        const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
        const hotelNameCheckoutGround = accommodation?.name || 'Hébergement';
        return scheduler.insertFixedItem({
          id: generateId(),
          title: `Check-out ${hotelNameCheckoutGround}`,
          type: 'checkout',
          startTime: checkoutStart,
          endTime: checkoutEnd,
        });
      })();
      if (checkoutItemGround) {
        items.push(schedulerItemToTripItem(checkoutItemGround, dayNumber, orderIndex++, {
          description: 'Libérez votre hébergement.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
        }));
        // Update lastCoords to hotel position for post-checkout activities
        lastCoords = {
          lat: accommodation?.latitude || cityCenter.lat,
          lng: accommodation?.longitude || cityCenter.lng,
        };
      }

      // Transport retour — vérifier si les transitLegs correspondent au jour retour
      // Les transitLegs peuvent être ceux de l'aller (dates différentes), dans ce cas on utilise le timing estimé
      let transportStart: Date;
      let transportEnd: Date;
      const hasReturnDateLegs = groundTransport.transitLegs?.length &&
        (() => {
          const legDate = new Date(groundTransport.transitLegs![0].departure);
          return legDate.toDateString() === date.toDateString();
        })();
      if (hasReturnDateLegs) {
        const firstLeg = groundTransport.transitLegs![0];
        const lastLeg = groundTransport.transitLegs![groundTransport.transitLegs!.length - 1];
        const realDep = new Date(firstLeg.departure);
        const realArr = new Date(lastLeg.arrival);
        transportStart = new Date(realDep.getTime() - 30 * 60 * 1000);
        transportEnd = realArr;
      } else {
        transportStart = parseTime(date, '14:00');
        transportEnd = new Date(transportStart.getTime() + groundTransport.totalDuration * 60 * 1000);
      }

      // === TRANSFERT VERS LA GARE/STATION ===
      // Insérer un bloc transfert entre la dernière activité et le transport retour
      {
        const isTrainOrBus = groundTransport.mode === 'train' || groundTransport.mode === 'bus' || groundTransport.mode === 'combined';
        if (isTrainOrBus) {
          // Déterminer les coordonnées et le nom de la gare
          const stationCoords = cityCenter;
          let stationName = 'la gare';
          if (groundTransport.transitLegs?.length) {
            // Pour le retour, la gare de départ est la destination d'arrivée de l'aller (dernière leg)
            const lastLegOfOutbound = groundTransport.transitLegs[groundTransport.transitLegs.length - 1];
            if (lastLegOfOutbound.to) {
              stationName = lastLegOfOutbound.to;
            }
          }

          // Estimer le temps de trajet vers la gare
          const distToStation = calculateDistance(lastCoords.lat, lastCoords.lng, stationCoords.lat, stationCoords.lng);
          // Estimation: 3min/km en transport urbain, minimum 10min, max 45min
          const transferDuration = Math.max(10, Math.min(45, Math.round(distToStation * 3)));

          // Calculer les heures du transfert (arriver 30min avant le transport)
          const transferEndTime = transportStart;
          const transferStartTime = new Date(transferEndTime.getTime() - transferDuration * 60 * 1000);

          if (transferStartTime > scheduler.getCurrentTime()) {
            const transferItem = scheduler.insertFixedItem({
              id: generateId(),
              title: `Transfert vers ${stationName}`,
              type: 'transport',
              startTime: transferStartTime,
              endTime: transferEndTime,
            });
            if (transferItem) {
              const googleMapsUrl = generateGoogleMapsUrl(lastCoords, stationCoords, 'transit');
              items.push(schedulerItemToTripItem(transferItem, dayNumber, orderIndex++, {
                description: `${transferDuration} min | Rejoindre ${stationName} pour le départ`,
                locationName: `${preferences.destination} → ${stationName}`,
                latitude: stationCoords.lat,
                longitude: stationCoords.lng,
                googleMapsUrl,
              }));
              lastCoords = stationCoords;
            }
          }
        }
      }

      const modeIcons: Record<string, string> = { train: '🚄', bus: '🚌', car: '🚗', combined: '🔄' };
      const modeLabels: Record<string, string> = { train: 'Train', bus: 'Bus', car: 'Voiture', combined: 'Transport combiné' };

      // Si le transport retour a été pré-inséré au début, réutiliser le scheduler item
      const transportItem = returnTransportAlreadyInserted
        ? earlyReturnTransportItem
        : scheduler.insertFixedItem({
            id: generateId(),
            title: `${modeIcons[groundTransport.mode] || '🚊'} ${modeLabels[groundTransport.mode] || groundTransport.mode || 'Transport'} → ${preferences.origin}`,
            type: 'transport',
            startTime: transportStart,
            endTime: transportEnd,
            data: { transport: groundTransport },
          });
      if (transportItem) {
        // Generate return booking URL with correct direction and date
        // For combined transport, generate URL for the first bookable segment
        let returnBookingUrl = groundTransport.bookingUrl;
        if (groundTransport.mode === 'combined' && groundTransport.segments?.length) {
          // For combined, generate booking URL based on first segment mode
          const firstSeg = groundTransport.segments[0];
          if (firstSeg.mode === 'train') {
            returnBookingUrl = getTrainBookingUrl(preferences.destination, firstSeg.to || preferences.origin, preferences.groupSize, date);
          } else if (firstSeg.mode === 'ferry') {
            // Link to ferry operator if available
            const operator = firstSeg.operator?.toLowerCase() || '';
            if (operator.includes('corsica')) {
              returnBookingUrl = `https://www.corsica-linea.com/`;
            } else {
              returnBookingUrl = `https://www.directferries.fr/`;
            }
          }
        } else if (groundTransport.mode === 'train') {
          returnBookingUrl = getTrainBookingUrl(preferences.destination, preferences.origin, preferences.groupSize, date);
        } else if (groundTransport.mode === 'bus') {
          const dateStr = date ? date.toISOString().split('T')[0] : '';
          returnBookingUrl = `https://www.flixbus.fr/recherche?departureCity=${encodeURIComponent(preferences.destination)}&arrivalCity=${encodeURIComponent(preferences.origin)}${dateStr ? `&rideDate=${dateStr}` : ''}`;
        } else if (groundTransport.mode === 'car') {
          returnBookingUrl = `https://www.google.com/maps/dir/${encodeURIComponent(preferences.destination)}/${encodeURIComponent(preferences.origin)}`;
        }
        // Build detailed description with segments (like outbound)
        const returnSegmentsDesc = groundTransport.segments?.length
          ? groundTransport.segments.map(s => {
              const segMode = s.mode === 'train' ? '🚄' : s.mode === 'ferry' ? '⛴️' : s.mode === 'bus' ? '🚌' : s.mode === 'car' ? '🚗' : '🚊';
              const segOperator = s.operator ? ` (${s.operator})` : '';
              const segDuration = s.duration ? ` ${Math.floor(s.duration / 60)}h${s.duration % 60 > 0 ? String(s.duration % 60).padStart(2, '0') : ''}` : '';
              const segPrice = s.price ? ` ${s.price}€` : '';
              return `${segMode} ${s.to} → ${s.from}${segOperator}${segDuration}${segPrice}`;
            }).join(' puis ')
          : `${preferences.destination} → ${preferences.origin}`;
        const returnDescription = `${returnSegmentsDesc} | ${groundTransport.totalPrice}€ total`;

        items.push(schedulerItemToTripItem(transportItem, dayNumber, orderIndex++, {
          description: returnDescription,
          locationName: `${preferences.destination} → ${preferences.origin}`,
          latitude: cityCenter.lat,
          longitude: cityCenter.lng,
          estimatedCost: groundTransport.totalPrice,
          bookingUrl: returnBookingUrl,
          transitLegs: groundTransport.transitLegs?.length
            ? groundTransport.transitLegs.slice().reverse().map(leg => ({
                ...leg,
                from: leg.to,
                to: leg.from,
                departure: '',  // Timestamps de l'aller, pas valides pour le retour
                arrival: '',
              }))
            : undefined,
          transitDataSource: groundTransport.dataSource,
          priceRange: groundTransport.priceRange,
        }));
      }
    } else {
      // Pas de vol ni de transport retour → checkout simple à 11h
      // Check-out sans transport — réutiliser le checkout pré-inséré si disponible
      const checkoutItemFallback = checkoutAlreadyInserted ? earlyCheckoutItem : (() => {
        const checkoutStart = parseTime(date, '11:00');
        const checkoutEnd = new Date(checkoutStart.getTime() + 30 * 60 * 1000);
        const hotelNameFallback = accommodation?.name || 'Hébergement';
        return scheduler.insertFixedItem({
          id: generateId(),
          title: `Check-out ${hotelNameFallback}`,
          type: 'checkout',
          startTime: checkoutStart,
          endTime: checkoutEnd,
        });
      })();
      if (checkoutItemFallback) {
        items.push(schedulerItemToTripItem(checkoutItemFallback, dayNumber, orderIndex++, {
          description: 'Libérez votre hébergement.',
          locationName: getHotelLocationName(accommodation, preferences.destination),
          latitude: accommodation?.latitude || cityCenter.lat,
          longitude: accommodation?.longitude || cityCenter.lng,
        }));
      }
    }
  }

  // === CORRECTION AUTOMATIQUE DES CONFLITS ===
  // Étape 1: Pour le Jour 1 avec vol ALLER, supprimer toute activité non-logistique
  // Le jour 1 avec vol = uniquement logistique (trajet aéroport, parking, checkin, vol, transfert arrivée, hôtel)
  // Pas de restaurant ni d'activité car:
  // - On ne peut pas faire d'activités à destination AVANT d'y arriver
  // - On ne veut pas programmer d'activités à l'ORIGINE avant le départ
  if (isFirstDay && outboundFlight) {
    const flightDep = new Date(outboundFlight.departureTime);
    const flightArr = new Date(outboundFlight.arrivalTime);
    const depDay = new Date(flightDep.getFullYear(), flightDep.getMonth(), flightDep.getDate());
    const arrDay = new Date(flightArr.getFullYear(), flightArr.getMonth(), flightArr.getDate());
    const isOvernight = arrDay.getTime() > depDay.getTime();

    // Pour TOUS les vols du jour 1 (overnight ou pas), supprimer les items non-logistique
    // AVANT le trajet vers l'aéroport (on ne veut pas de restaurant à l'origine avant le départ)
    // Calculer l'heure de départ effective (trajet vers aéroport ou 2h avant vol)
    const airportArrivalTime = new Date(flightDep.getTime() - 2 * 60 * 60 * 1000); // 2h avant le vol

    // Supprimer tous les restaurants et activités du jour 1 qui sont AVANT le trajet vers l'aéroport
    // Garder uniquement: transport, parking, checkin, flight, hotel
    const protectedTypes = ['flight', 'transport', 'checkin', 'parking', 'hotel', 'checkout'];
    const allSchedulerItems = scheduler.getItems();
    let itemsRemoved = 0;

    for (const item of allSchedulerItems) {
      // Supprimer si c'est un restaurant ou une activité (pas de la logistique)
      if (!protectedTypes.includes(item.type)) {
        // Supprimer si AVANT le départ vers l'aéroport (on est encore à l'origine)
        if (item.slot.start < airportArrivalTime) {
          itemsRemoved++;
        }
        // OU supprimer si APRÈS le vol mais AVANT l'arrivée réelle + transfert (impossible d'être là)
        else if (!isOvernight) {
          // Vol court: vérifier que l'item est APRÈS l'arrivée + transfert
          const minActivityTime = new Date(flightArr.getTime() + 90 * 60 * 1000); // arrivée + 1h30
          if (item.slot.start < minActivityTime) {
            itemsRemoved++;
          }
        }
      }
    }

    // Appliquer les suppressions via removeItemsBefore avec une heure très tardive pour les non-logistique
    // Alternative: utiliser la logique existante mais avec l'heure de départ vers l'aéroport
    if (!isOvernight) {
      const arrivalTime = new Date(outboundFlight.arrivalTime);
      const minActivityTime = new Date(arrivalTime.getTime() + 90 * 60 * 1000); // arrivée + 1h30
      scheduler.removeItemsBefore(minActivityTime, protectedTypes);
    } else {
      // Vol overnight: le jour 1 ne contient QUE la logistique de départ
      // Supprimer TOUT ce qui n'est pas logistique car on n'arrive que le lendemain
      scheduler.removeItemsBefore(new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000), protectedTypes);
    }
  }

  // Étape 2: Supprimer les items en conflit (chevauchements)
  scheduler.removeConflicts();

  // Validation finale (devrait être propre maintenant)
  const validation = scheduler.validate();
  if (!validation.valid) {
    console.error(`[Jour ${dayNumber}] CONFLITS RESTANTS (ne devrait pas arriver):`);
    validation.conflicts.forEach(c => console.error(`  - ${c.item1} vs ${c.item2}`));
  }

  // Debug
  scheduler.debug();

  // Reconstruire la liste des items à partir du scheduler (certains ont été supprimés)
  const validItemIds = new Set(scheduler.getItems().map(i => i.id));
  let filteredItems = items.filter(item => validItemIds.has(item.id));

  // === FILTRE DE SÉCURITÉ: Supprimer les activités/restaurants après le transport retour ===
  if (isLastDay && groundTransport && returnTransportAlreadyInserted) {
    const returnItem = filteredItems.find(i => i.type === 'transport' && i.title.includes('→'));
    if (returnItem?.startTime) {
      const returnStartMinutes = parseTime(date, returnItem.startTime).getTime();
      const protectedTypes = new Set(['transport', 'flight', 'hotel', 'checkin', 'checkout', 'parking']);
      const beforeFilter = filteredItems.length;
      filteredItems = filteredItems.filter(i => {
        if (protectedTypes.has(i.type)) return true;
        const itemStartMinutes = parseTime(date, i.startTime).getTime();
        if (itemStartMinutes >= returnStartMinutes) {
          return false;
        }
        return true;
      });
    }
  }

  // === FILTRE SANITY: Rejeter les items avec horaires > 23:59 ===
  // Ceinture de sécurité: si un item a été inséré avec des horaires invalides (minuit+), le supprimer
  // Double vérification: comparaison Date ET vérification textuelle des heures
  const dayEndGuard = parseTime(date, '23:59');
  const beforeSanity = filteredItems.length;
  filteredItems = filteredItems.filter(item => {
    // Les transports/vols peuvent légitimement dépasser minuit (vol de nuit, train de nuit)
    if (item.type === 'transport' || item.type === 'flight') return true;

    // Vérification textuelle: heures >= 24 sont toujours invalides (ex: "24:42", "25:13")
    const startHour = parseInt(item.startTime.split(':')[0], 10);
    const endHour = parseInt(item.endTime.split(':')[0], 10);
    if (startHour >= 24 || endHour >= 24) {
      console.warn(`[Jour ${dayNumber}] ⚠ Suppression "${item.title}" (${item.startTime}-${item.endTime}): heure >= 24 invalide`);
      return false;
    }

    // Vérification Date: endTime > 23:59
    const itemEnd = parseTime(date, item.endTime);
    if (itemEnd > dayEndGuard) {
      console.warn(`[Jour ${dayNumber}] ⚠ Suppression "${item.title}" (${item.startTime}-${item.endTime}): dépasse 23:59`);
      return false;
    }

    // Vérification supplémentaire: startTime > 23:00 pour les non-restaurants (dîner OK jusqu'à 23h)
    const itemStart = parseTime(date, item.startTime);
    const lateGuard = parseTime(date, '23:00');
    if (itemStart > lateGuard && item.type !== 'restaurant') {
      console.warn(`[Jour ${dayNumber}] ⚠ Suppression "${item.title}" (${item.startTime}): commence après 23:00 (type: ${item.type})`);
      return false;
    }

    return true;
  });
  // === ENRICHIR LES ITEMS AVEC DONNÉES DE TRANSIT ===
  // Au lieu de créer des blocs "Trajet vers X" séparés, on enrichit chaque item
  // avec distanceFromPrevious, transportToPrevious, timeFromPrevious.
  // Le frontend ItineraryConnector affiche déjà ces données comme petits connecteurs bleus.
  await enrichItemsWithTransitData(filteredItems, date, dayNumber);

  // Trier par heure de début
  const sortedItems = filteredItems.sort((a, b) => {
    const aTime = parseTime(date, a.startTime).getTime();
    const bTime = parseTime(date, b.startTime).getTime();
    return aTime - bTime;
  });

  // Ré-indexer les orderIndex
  sortedItems.forEach((item, idx) => { item.orderIndex = idx; });

  // Vérification minimum activités par jour (3 activités sauf jour arrivée/départ)
  const activityCount = sortedItems.filter(i => i.type === 'activity').length;
  const isTransitDay = isFirstDay || isLastDay;
  if (!isTransitDay && activityCount < 3) {
    console.warn(`[Jour ${dayNumber}] ⚠️ Seulement ${activityCount} activités (minimum recommandé: 3)`);
  }

  // Post-traitement: corriger les labels de repas selon l'heure effective
  const itemsToRemove = new Set<number>();
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    if (item.type === 'restaurant') {
      const hour = parseInt(item.startTime.split(':')[0] || '12', 10);
      // "Déjeuner" planifié après 15h → supprimer (un déjeuner à 15h+ est toujours anormal)
      if (item.title === 'Déjeuner' && hour >= 15) {
        console.warn(`[Jour ${dayNumber}] ⚠️ Déjeuner placé à ${item.startTime} — suppression (horaire invalide, >= 15h)`);
        itemsToRemove.add(i);
      }
      // "Déjeuner" avec un nom de restaurant planifié après 16h → supprimer aussi
      if (item.title !== 'Déjeuner' && item.title !== 'Dîner' && item.type === 'restaurant' && hour >= 16 && hour < 19) {
        // C'est un restaurant de déjeuner avec un nom spécifique, placé trop tard
        // On le laisse, le dîner sera à 19h+
      }
      // "Dîner" planifié avant 17h → renommer en "Déjeuner"
      if (item.title === 'Dîner' && hour < 17 && hour >= 11) {
        item.title = 'Déjeuner';
      }
      // Vérifier les horaires d'ouverture depuis la description (pattern "de Xh à Yh" ou "Xh-Yh")
      if (item.description) {
        const closingMatch = item.description.match(/(?:de\s+\d+h\s*(?:\d+)?\s*(?:à|a)\s*|jusqu'à\s*)(\d+)h\s*(\d+)?/i);
        if (closingMatch) {
          const closingHour = parseInt(closingMatch[1], 10);
          if (hour >= closingHour) {
            console.warn(`[Jour ${dayNumber}] ⚠️ "${item.title}" planifié à ${item.startTime} mais ferme à ${closingHour}h — suppression`);
            itemsToRemove.add(i);
          }
        }
      }
    }
  }
  // Supprimer les items marqués (restaurants hors horaires)
  const finalItems = itemsToRemove.size > 0
    ? sortedItems.filter((_, idx) => !itemsToRemove.has(idx))
    : sortedItems;
  if (itemsToRemove.size > 0) {
    finalItems.forEach((item, idx) => { item.orderIndex = idx; });
  }

  return { items: finalItems.length > 0 ? finalItems : sortedItems, lateFlightForNextDay };

}

/**
 * Post-processing: enrichit les items existants avec les données de transit
 * (distanceFromPrevious, transportToPrevious, timeFromPrevious).
 *
 * Au lieu de créer des blocs "Trajet vers X" séparés qui polluaient la timeline,
 * on enrichit chaque item. Le frontend ItineraryConnector affiche ces données
 * comme de petits connecteurs bleus cliquables entre les cartes.
 *
 * Utilise Google Directions API (avec fallback) pour les distances > 100m.
 * Batching: 4 appels simultanés max, 200ms entre batches.
 */
async function enrichItemsWithTransitData(
  items: TripItem[],
  date: Date,
  dayNumber: number,
): Promise<void> {
  // Trier par startTime pour traiter dans l'ordre chronologique
  const sorted = [...items].sort((a, b) => {
    const aTime = parseTime(date, a.startTime).getTime();
    const bTime = parseTime(date, b.startTime).getTime();
    return aTime - bTime;
  });

  // Types à exclure des paires (déjà des transports ou logistique)
  const skipTypes = new Set(['transport', 'flight', 'checkin', 'checkout', 'parking', 'luggage']);

  // Filtrer les items avec coordonnées et non-logistique
  const transitableItems = sorted.filter(item =>
    !skipTypes.has(item.type) && item.latitude && item.longitude
  );

  // Collecter les paires qui nécessitent un enrichissement transit
  const pairs: Array<{ prev: TripItem; next: TripItem; distance: number }> = [];

  for (let i = 0; i < transitableItems.length - 1; i++) {
    const prev = transitableItems[i];
    const next = transitableItems[i + 1];

    const distance = calculateDistance(prev.latitude!, prev.longitude!, next.latitude!, next.longitude!);

    // Seulement si distance > 100m (0.1 km)
    if (distance > 0.1) {
      pairs.push({ prev, next, distance });
    }
  }

  if (pairs.length === 0) return;

  // Batch les appels getDirections (4 simultanés max)
  const BATCH_SIZE = 4;

  for (let batchStart = 0; batchStart < pairs.length; batchStart += BATCH_SIZE) {
    const batch = pairs.slice(batchStart, batchStart + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async ({ prev, next, distance }) => {
        try {
          const mode = distance > 3 ? 'transit' : 'walking';
          const directions = await getDirections({
            from: { lat: prev.latitude!, lng: prev.longitude! },
            to: { lat: next.latitude!, lng: next.longitude! },
            mode,
          });
          return { prev, next, distance, directions, mode };
        } catch {
          // Fallback: estimation basée sur la distance
          const estimatedDuration = Math.max(5, Math.round(distance * 3)); // ~3min/km
          const mode = distance > 1 ? 'transit' : 'walking';
          return {
            prev, next, distance, mode,
            directions: {
              duration: estimatedDuration,
              distance,
              steps: [],
              transitLines: [],
              googleMapsUrl: generateGoogleMapsUrl(
                { lat: prev.latitude!, lng: prev.longitude! },
                { lat: next.latitude!, lng: next.longitude! },
                mode === 'transit' ? 'transit' : 'walking'
              ),
              source: 'estimated' as const,
            },
          };
        }
      })
    );

    for (const { next, distance, directions, mode } of results) {
      // Seulement si le trajet > 2 min (pas de micro-déplacements)
      if (directions.duration < 2) continue;

      // Enrichir l'item NEXT avec les données de transit
      next.distanceFromPrevious = Math.round(distance * 10) / 10; // Arrondi 1 décimale
      next.timeFromPrevious = Math.round(directions.duration);
      next.transportToPrevious = mode === 'walking' ? 'walk' : distance > 10 ? 'car' : 'public';

      // Mettre à jour le googleMapsUrl si pas déjà défini ou si on a un meilleur itinéraire
      if (!next.googleMapsUrl || next.googleMapsUrl === '') {
        next.googleMapsUrl = directions.googleMapsUrl;
      }

    }

    // Pause entre les batches (200ms) pour ne pas surcharger les APIs
    if (batchStart + BATCH_SIZE < pairs.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

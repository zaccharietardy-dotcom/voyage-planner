/**
 * Validateur de coherence logique pour les itineraires de voyage
 *
 * Verifie que l'ordre des evenements est logique:
 * - Jour 1: Vol -> Transfert aeroport->hotel -> Check-in hotel -> Activites
 * - Jours intermediaires: Petit-dej -> Activites matin -> Dejeuner -> Activites apres-midi -> Diner
 * - Dernier jour: Check-out -> Activites -> Transfert hotel->aeroport -> Vol retour
 *
 * Detecte automatiquement les incoherences et les corrige
 */

import { TripItem, TripDay, Trip } from '../types';

// Types d'erreurs de coherence
export type CoherenceErrorType =
  | 'ACTIVITY_BEFORE_ARRIVAL'        // Activite avant d'etre arrive
  | 'ACTIVITY_BEFORE_HOTEL_CHECKIN'  // Activite avant le check-in hotel
  | 'ACTIVITY_AFTER_HOTEL_CHECKOUT'  // Activite apres le check-out (si vol apres)
  | 'TRANSFER_AFTER_ACTIVITY'        // Transfert aeroport-hotel APRES une activite
  | 'FLIGHT_AFTER_ACTIVITY_DAY1'     // Vol aller apres une activite (jour 1)
  | 'CHECKIN_BEFORE_TRANSFER'        // Check-in hotel avant le transfert
  | 'CHECKOUT_AFTER_TRANSFER'        // Check-out apres le transfert vers aeroport
  | 'MEAL_WRONG_ORDER'               // Repas dans le mauvais ordre (diner avant dejeuner)
  | 'DUPLICATE_ATTRACTION'           // Meme attraction plusieurs fois
  | 'OVERLAP'                        // Chevauchement horaire
  | 'ILLOGICAL_SEQUENCE'             // Sequence illogique generale
  | 'ACTIVITY_IMPOSSIBLE_HOUR'       // Activite a une heure impossible (00:00-06:59)
  | 'GENERIC_ACTIVITY';              // Activite generique inventee (pas un vrai POI)

export interface CoherenceError {
  type: CoherenceErrorType;
  dayNumber: number;
  message: string;
  items: TripItem[];
  severity: 'critical' | 'warning';
  autoFixable: boolean;
}

export interface CoherenceResult {
  valid: boolean;
  errors: CoherenceError[];
  warnings: CoherenceError[];
  fixedTrip?: Trip;
}

/**
 * Ordre logique attendu pour le Jour 1 (arrivee)
 */
const DAY1_LOGICAL_ORDER = [
  'parking',      // Optionnel: parking a l'aeroport d'origine
  'checkin',      // Enregistrement a l'aeroport
  'flight',       // Vol aller
  'transport',    // Transfert aeroport -> hotel
  'hotel',        // Check-in hotel
  // Puis activites/restaurants
];

/**
 * Ordre logique attendu pour le dernier jour (depart)
 */
const LAST_DAY_LOGICAL_ORDER = [
  // D'abord activites/restaurants
  'checkout',     // Check-out hotel
  'transport',    // Transfert hotel -> aeroport
  'flight',       // Vol retour
  'parking',      // Optionnel: recuperation voiture
];

/**
 * Valide la coherence logique d'un voyage complet
 */
export function validateTripCoherence(trip: Trip): CoherenceResult {
  const errors: CoherenceError[] = [];
  const warnings: CoherenceError[] = [];

  const totalDays = trip.days.length;

  for (const day of trip.days) {
    const isFirstDay = day.dayNumber === 1;
    const isLastDay = day.dayNumber === totalDays;

    // Valider la journee
    const dayErrors = validateDayCoherence(day, isFirstDay, isLastDay);
    errors.push(...dayErrors.filter(e => e.severity === 'critical'));
    warnings.push(...dayErrors.filter(e => e.severity === 'warning'));
  }

  // Verifier les attractions en double sur tout le voyage
  const duplicateErrors = checkDuplicateAttractions(trip);
  errors.push(...duplicateErrors.filter(e => e.severity === 'critical'));
  warnings.push(...duplicateErrors.filter(e => e.severity === 'warning'));

  const result: CoherenceResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  // Si des erreurs sont trouvees, essayer de corriger automatiquement
  if (!result.valid) {
    console.log(`[CoherenceValidator] ${errors.length} erreurs detectees, tentative de correction...`);
    const fixedTrip = autoFixTrip(trip, errors);
    result.fixedTrip = fixedTrip;
  }

  return result;
}

/**
 * Valide la coherence d'une journee
 */
function validateDayCoherence(
  day: TripDay,
  isFirstDay: boolean,
  isLastDay: boolean
): CoherenceError[] {
  const errors: CoherenceError[] = [];
  const items = [...day.items].sort((a, b) => {
    return parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime);
  });

  if (isFirstDay) {
    errors.push(...validateFirstDay(day.dayNumber, items));
  }

  if (isLastDay) {
    errors.push(...validateLastDay(day.dayNumber, items));
  }

  // Verifier les chevauchements
  errors.push(...checkOverlaps(day.dayNumber, items));

  // Verifier l'ordre des repas
  errors.push(...checkMealOrder(day.dayNumber, items));

  // Verifier les horaires realistes (pas d'activites entre 00:00 et 06:59)
  errors.push(...checkRealisticHours(day.dayNumber, items));

  // Verifier les activites generiques
  errors.push(...checkGenericActivities(day.dayNumber, items));

  return errors;
}

/**
 * Liste des activites generiques a detecter et supprimer
 * Ces activites sont inventees et n'ont pas de valeur reelle pour l'utilisateur
 */
const GENERIC_ACTIVITY_PATTERNS = [
  /^pause caf[eé]/i,
  /^shopping local/i,
  /^quartier historique/i,
  /^point de vue/i,
  /^promenade digestive/i,
  /^glace artisanale/i,
  /^parc et jardins/i,
  /^march[eé] de /i,
  /^place centrale/i,
  /^galerie d'art locale/i,
  /^librairie-caf[eé]/i,
  /^ap[eé]ritif local/i,
  /^promenade nocturne/i,
  /^bar [àa] /i,  // Bar à cocktails, Bar à tapas, etc.
  /^rooftop bar/i,
  /^jazz club/i,
];

/**
 * Verifie si une activite est generique (inventee)
 */
function isGenericActivity(title: string): boolean {
  return GENERIC_ACTIVITY_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Detecte les activites generiques inventees
 */
function checkGenericActivities(dayNumber: number, items: TripItem[]): CoherenceError[] {
  const errors: CoherenceError[] = [];

  for (const item of items) {
    if (item.type !== 'activity') continue;

    if (isGenericActivity(item.title)) {
      errors.push({
        type: 'GENERIC_ACTIVITY',
        dayNumber,
        message: `"${item.title}" est une activite generique inventee - pas un vrai lieu`,
        items: [item],
        severity: 'critical',
        autoFixable: true,
      });
    }
  }

  return errors;
}

/**
 * Verifie que les activites sont a des heures realistes
 * Pas d'activites touristiques entre 00:00 et 06:59 (sauf logistique)
 */
function checkRealisticHours(dayNumber: number, items: TripItem[]): CoherenceError[] {
  const errors: CoherenceError[] = [];
  const logisticsTypes = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'hotel', 'luggage'];

  for (const item of items) {
    // Ignorer les elements logistiques (peuvent etre tot le matin)
    if (logisticsTypes.includes(item.type)) continue;

    const startMinutes = parseTimeToMinutes(item.startTime);
    const startHour = Math.floor(startMinutes / 60);

    // Activites entre 00:00 et 06:59 sont suspectes
    if (startHour >= 0 && startHour < 7) {
      errors.push({
        type: 'ACTIVITY_IMPOSSIBLE_HOUR',
        dayNumber,
        message: `"${item.title}" planifiee a ${item.startTime} - heure impossible pour une activite touristique`,
        items: [item],
        severity: 'critical',
        autoFixable: true,
      });
    }
  }

  return errors;
}

/**
 * Valide le premier jour (arrivee)
 * Gere les cas: avion, train, bus, voiture
 */
function validateFirstDay(dayNumber: number, items: TripItem[]): CoherenceError[] {
  const errors: CoherenceError[] = [];

  // Trouver les elements cles
  const flight = items.find(i => i.type === 'flight');

  // Transport principal (vol OU train/bus)
  const mainTransport = items.find(i =>
    i.type === 'flight' ||
    (i.type === 'transport' && isMainTransport(i.title))
  );

  // Transfert secondaire (aeroport->hotel ou gare->hotel)
  const transferToHotel = items.find(i =>
    i.type === 'transport' &&
    !isMainTransport(i.title) &&
    (i.title.toLowerCase().includes('hotel') || i.title.toLowerCase().includes('hébergement'))
  );

  const hotelCheckin = items.find(i => i.type === 'hotel');
  const activities = items.filter(i => i.type === 'activity');

  // === CAS AVEC VOL ===
  if (flight) {
    // Verifier que le vol est AVANT le transfert aeroport->hotel
    if (transferToHotel) {
      const flightEnd = parseTimeToMinutes(flight.endTime);
      const transferStart = parseTimeToMinutes(transferToHotel.startTime);
      if (transferStart < flightEnd) {
        errors.push({
          type: 'TRANSFER_AFTER_ACTIVITY',
          dayNumber,
          message: `Transfert aeroport->hotel (${transferToHotel.startTime}) planifie AVANT la fin du vol (${flight.endTime})`,
          items: [flight, transferToHotel],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }

    // Verifier que les activites sont APRES le vol (si pas d'hotel/transfert trouve)
    if (!hotelCheckin && !transferToHotel) {
      const flightEnd = parseTimeToMinutes(flight.endTime);
      for (const activity of activities) {
        const activityStart = parseTimeToMinutes(activity.startTime);
        // Ajouter 30 min minimum apres le vol
        if (activityStart < flightEnd + 30) {
          errors.push({
            type: 'ACTIVITY_BEFORE_ARRIVAL',
            dayNumber,
            message: `Activite "${activity.title}" (${activity.startTime}) planifiee trop tot apres le vol (atterrissage: ${flight.endTime})`,
            items: [flight, activity],
            severity: 'critical',
            autoFixable: true,
          });
        }
      }
    }
  }

  // === CAS AVEC TRAIN/BUS (pas de vol) ===
  if (!flight && mainTransport) {
    const transportEnd = parseTimeToMinutes(mainTransport.endTime);

    // Si pas de check-in hotel, verifier que les activites sont apres le transport
    if (!hotelCheckin) {
      for (const activity of activities) {
        const activityStart = parseTimeToMinutes(activity.startTime);
        // Ajouter 30 min minimum apres l'arrivee
        if (activityStart < transportEnd + 30) {
          errors.push({
            type: 'ACTIVITY_BEFORE_ARRIVAL',
            dayNumber,
            message: `Activite "${activity.title}" (${activity.startTime}) planifiee trop tot apres l'arrivee du ${getTransportLabel(mainTransport.title)} (${mainTransport.endTime})`,
            items: [mainTransport, activity],
            severity: 'critical',
            autoFixable: true,
          });
        }
      }
    }
  }

  // === VERIFICATION DU TRANSFERT -> HOTEL ===
  if (transferToHotel && hotelCheckin) {
    const transferEnd = parseTimeToMinutes(transferToHotel.endTime);
    const checkinStart = parseTimeToMinutes(hotelCheckin.startTime);
    if (checkinStart < transferEnd) {
      errors.push({
        type: 'CHECKIN_BEFORE_TRANSFER',
        dayNumber,
        message: `Check-in hotel (${hotelCheckin.startTime}) planifie AVANT la fin du transfert (${transferToHotel.endTime})`,
        items: [transferToHotel, hotelCheckin],
        severity: 'critical',
        autoFixable: true,
      });
    }
  }

  // === VERIFICATION DES ACTIVITES ===
  // NOTE: Cette fonction ne s'exécute QUE pour le Jour 1 (premier jour)
  // Sur le Jour 1, il est NORMAL d'avoir des activités AVANT le check-in
  // si le voyageur arrive tôt le matin (ex: vol 8h, check-in 15h → 6h de libre)
  // On ne signale une erreur que si l'activité est AVANT l'arrivée à destination

  // Pour le Jour 1: vérifier que les activités sont APRÈS l'arrivée (vol ou transport)
  const arrivalItem = flight || transferToHotel;
  if (arrivalItem) {
    const arrivalEnd = parseTimeToMinutes(arrivalItem.endTime);
    for (const activity of activities) {
      const activityStart = parseTimeToMinutes(activity.startTime);
      if (activityStart < arrivalEnd) {
        errors.push({
          type: 'ACTIVITY_BEFORE_ARRIVAL',
          dayNumber,
          message: `Activite "${activity.title}" (${activity.startTime}) planifiee AVANT l'arrivee (${arrivalItem.endTime})`,
          items: [arrivalItem, activity],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }
  }

  // === VERIFICATION DE L'ORDRE GLOBAL ===
  // Trouver le dernier element logistique avant les activites
  const allLogistics = items.filter(i =>
    i.type === 'flight' || i.type === 'transport' || i.type === 'hotel' || i.type === 'checkin' || i.type === 'parking'
  ).sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));

  // Trouver la premiere activite
  const firstActivity = activities.sort((a, b) =>
    parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  )[0];

  if (firstActivity && allLogistics.length > 0) {
    const firstActivityStart = parseTimeToMinutes(firstActivity.startTime);

    // Verifier qu'aucune logistique n'est planifiee APRES le debut de la premiere activite
    // EXCEPTION: Sur le Jour 1, le check-in hôtel PEUT être après les activités
    // (le voyageur fait des activités en attendant l'heure du check-in)
    for (const logistic of allLogistics) {
      const logisticStart = parseTimeToMinutes(logistic.startTime);
      // Sauf enregistrement aeroport (checkin) qui est AVANT le vol
      if (logistic.type === 'checkin') continue;
      // Sauf check-in hôtel sur le Jour 1 (activités possibles avant)
      if (logistic.type === 'hotel' && dayNumber === 1) continue;

      if (logisticStart > firstActivityStart && logistic.type !== 'parking') {
        errors.push({
          type: 'ILLOGICAL_SEQUENCE',
          dayNumber,
          message: `Sequence illogique: "${logistic.title}" (${logistic.startTime}) planifie APRES l'activite "${firstActivity.title}" (${firstActivity.startTime})`,
          items: [firstActivity, logistic],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }
  }

  return errors;
}

/**
 * Determine si c'est un transport principal (train, bus longue distance) ou un transfert local
 */
function isMainTransport(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    lower.includes('train') ||
    lower.includes('tgv') ||
    lower.includes('bus') && (lower.includes('→') || lower.includes('->')) ||
    lower.includes('voiture') && (lower.includes('→') || lower.includes('->')) ||
    lower.includes('flixbus') ||
    lower.includes('blablacar') ||
    lower.includes('ouigo') ||
    lower.includes('sncf')
  );
}

/**
 * Extrait le type de transport du titre
 */
function getTransportLabel(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('train') || lower.includes('tgv') || lower.includes('ouigo')) return 'train';
  if (lower.includes('bus') || lower.includes('flixbus')) return 'bus';
  if (lower.includes('voiture')) return 'voiture';
  return 'transport';
}

/**
 * Valide le dernier jour (depart)
 * Gere les cas: avion, train, bus, voiture
 */
function validateLastDay(dayNumber: number, items: TripItem[]): CoherenceError[] {
  const errors: CoherenceError[] = [];

  // Trouver les elements cles
  const flight = items.find(i => i.type === 'flight');
  const checkout = items.find(i => i.type === 'checkout');

  // Transport de retour (vol OU train/bus)
  const returnTransport = items.find(i =>
    i.type === 'flight' ||
    (i.type === 'transport' && isMainTransport(i.title))
  );

  // Transfert vers aeroport/gare
  const transferToStation = items.find(i =>
    i.type === 'transport' &&
    !isMainTransport(i.title) &&
    (i.title.toLowerCase().includes('aeroport') ||
     i.title.toLowerCase().includes('airport') ||
     i.title.toLowerCase().includes('gare') ||
     i.title.toLowerCase().includes('station'))
  );

  const activities = items.filter(i => i.type === 'activity');

  // === VERIFICATION DU CHECKOUT ===
  if (checkout) {
    // Verifier que les activites sont AVANT le checkout
    const checkoutStart = parseTimeToMinutes(checkout.startTime);
    for (const activity of activities) {
      const activityEnd = parseTimeToMinutes(activity.endTime);
      if (activityEnd > checkoutStart) {
        errors.push({
          type: 'ACTIVITY_AFTER_HOTEL_CHECKOUT',
          dayNumber,
          message: `Activite "${activity.title}" (fin: ${activity.endTime}) se termine APRES le debut du check-out (${checkout.startTime})`,
          items: [activity, checkout],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }

    // Verifier que le checkout est AVANT le transfert vers aeroport/gare
    if (transferToStation) {
      const checkoutEnd = parseTimeToMinutes(checkout.endTime);
      const transferStart = parseTimeToMinutes(transferToStation.startTime);
      if (checkoutEnd > transferStart) {
        errors.push({
          type: 'CHECKOUT_AFTER_TRANSFER',
          dayNumber,
          message: `Check-out (${checkout.endTime}) se termine APRES le debut du transfert (${transferToStation.startTime})`,
          items: [checkout, transferToStation],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }
  }

  // === CAS AVEC VOL ===
  if (flight) {
    // Verifier que le vol est APRES le transfert vers l'aeroport
    if (transferToStation) {
      const transferEnd = parseTimeToMinutes(transferToStation.endTime);
      const flightStart = parseTimeToMinutes(flight.startTime);
      if (flightStart < transferEnd) {
        errors.push({
          type: 'ILLOGICAL_SEQUENCE',
          dayNumber,
          message: `Vol (${flight.startTime}) planifie AVANT la fin du transfert vers l'aeroport (${transferToStation.endTime})`,
          items: [transferToStation, flight],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }
  }

  // === CAS AVEC TRAIN/BUS (pas de vol) ===
  if (!flight && returnTransport && returnTransport.type === 'transport') {
    // Verifier que le transport de retour est apres le checkout
    if (checkout) {
      const checkoutEnd = parseTimeToMinutes(checkout.endTime);
      const transportStart = parseTimeToMinutes(returnTransport.startTime);
      if (transportStart < checkoutEnd) {
        errors.push({
          type: 'ILLOGICAL_SEQUENCE',
          dayNumber,
          message: `${getTransportLabel(returnTransport.title)} de retour (${returnTransport.startTime}) planifie AVANT la fin du check-out (${checkout.endTime})`,
          items: [checkout, returnTransport],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }

    // Verifier que les activites sont AVANT le transport de retour
    const transportStart = parseTimeToMinutes(returnTransport.startTime);
    for (const activity of activities) {
      const activityEnd = parseTimeToMinutes(activity.endTime);
      // Ajouter 30 min de marge avant le depart
      if (activityEnd > transportStart - 30) {
        errors.push({
          type: 'ACTIVITY_AFTER_HOTEL_CHECKOUT',
          dayNumber,
          message: `Activite "${activity.title}" (fin: ${activity.endTime}) se termine trop pres du depart du ${getTransportLabel(returnTransport.title)} (${returnTransport.startTime})`,
          items: [activity, returnTransport],
          severity: 'warning',
          autoFixable: true,
        });
      }
    }
  }

  return errors;
}

/**
 * Verifie les chevauchements horaires
 */
function checkOverlaps(dayNumber: number, items: TripItem[]): CoherenceError[] {
  const errors: CoherenceError[] = [];

  for (let i = 0; i < items.length - 1; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];

      const aStart = parseTimeToMinutes(a.startTime);
      const aEnd = parseTimeToMinutes(a.endTime);
      const bStart = parseTimeToMinutes(b.startTime);
      const bEnd = parseTimeToMinutes(b.endTime);

      // Chevauchement si a.start < b.end ET b.start < a.end
      if (aStart < bEnd && bStart < aEnd) {
        errors.push({
          type: 'OVERLAP',
          dayNumber,
          message: `Chevauchement: "${a.title}" (${a.startTime}-${a.endTime}) et "${b.title}" (${b.startTime}-${b.endTime})`,
          items: [a, b],
          severity: 'critical',
          autoFixable: true,
        });
      }
    }
  }

  return errors;
}

/**
 * Verifie l'ordre des repas
 */
function checkMealOrder(dayNumber: number, items: TripItem[]): CoherenceError[] {
  const errors: CoherenceError[] = [];

  const meals = items.filter(i => i.type === 'restaurant');
  const mealTimes: { [key: string]: number } = {};

  for (const meal of meals) {
    const title = meal.title.toLowerCase();
    const startTime = parseTimeToMinutes(meal.startTime);

    if (title.includes('petit') || title.includes('breakfast')) {
      mealTimes['breakfast'] = startTime;
    } else if (title.includes('dejeuner') || title.includes('lunch')) {
      mealTimes['lunch'] = startTime;
    } else if (title.includes('diner') || title.includes('dinner')) {
      mealTimes['dinner'] = startTime;
    }
  }

  // Verifier l'ordre: petit-dej < dejeuner < diner
  if (mealTimes['breakfast'] && mealTimes['lunch'] && mealTimes['breakfast'] > mealTimes['lunch']) {
    errors.push({
      type: 'MEAL_WRONG_ORDER',
      dayNumber,
      message: 'Petit-dejeuner planifie APRES le dejeuner',
      items: meals.filter(m => m.title.toLowerCase().includes('petit') || m.title.toLowerCase().includes('dejeuner')),
      severity: 'warning',
      autoFixable: true,
    });
  }

  if (mealTimes['lunch'] && mealTimes['dinner'] && mealTimes['lunch'] > mealTimes['dinner']) {
    errors.push({
      type: 'MEAL_WRONG_ORDER',
      dayNumber,
      message: 'Dejeuner planifie APRES le diner',
      items: meals.filter(m => m.title.toLowerCase().includes('dejeuner') || m.title.toLowerCase().includes('diner')),
      severity: 'warning',
      autoFixable: true,
    });
  }

  return errors;
}

/**
 * Verifie les attractions en double sur tout le voyage
 */
function checkDuplicateAttractions(trip: Trip): CoherenceError[] {
  const errors: CoherenceError[] = [];
  const seenAttractions: Map<string, { dayNumber: number; item: TripItem }> = new Map();

  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'activity') continue;

      // Normaliser le nom pour la comparaison
      const normalizedName = item.title.toLowerCase().trim();

      if (seenAttractions.has(normalizedName)) {
        const previous = seenAttractions.get(normalizedName)!;
        errors.push({
          type: 'DUPLICATE_ATTRACTION',
          dayNumber: day.dayNumber,
          message: `Attraction "${item.title}" apparait en double (jour ${previous.dayNumber} et jour ${day.dayNumber})`,
          items: [previous.item, item],
          severity: 'warning',
          autoFixable: true,
        });
      } else {
        seenAttractions.set(normalizedName, { dayNumber: day.dayNumber, item });
      }
    }
  }

  return errors;
}

/**
 * Corrige automatiquement les erreurs detectees
 */
function autoFixTrip(trip: Trip, errors: CoherenceError[]): Trip {
  // Cloner le voyage pour ne pas modifier l'original
  const fixedTrip = JSON.parse(JSON.stringify(trip)) as Trip;

  for (const error of errors) {
    if (!error.autoFixable) continue;

    console.log(`[AutoFix] Correction: ${error.type} - ${error.message}`);

    switch (error.type) {
      case 'ACTIVITY_BEFORE_HOTEL_CHECKIN':
      case 'ACTIVITY_BEFORE_ARRIVAL':
        fixActivityTiming(fixedTrip, error);
        break;

      case 'OVERLAP':
        fixOverlap(fixedTrip, error);
        break;

      case 'TRANSFER_AFTER_ACTIVITY':
      case 'CHECKIN_BEFORE_TRANSFER':
      case 'CHECKOUT_AFTER_TRANSFER':
      case 'ILLOGICAL_SEQUENCE':
        fixLogisticsOrder(fixedTrip, error);
        break;

      case 'DUPLICATE_ATTRACTION':
        removeDuplicate(fixedTrip, error);
        break;

      case 'MEAL_WRONG_ORDER':
        fixMealOrder(fixedTrip, error);
        break;

      case 'ACTIVITY_IMPOSSIBLE_HOUR':
      case 'GENERIC_ACTIVITY':
        // Supprimer les activites a heures impossibles et les activites generiques
        removeInvalidActivity(fixedTrip, error);
        break;
    }
  }

  // Re-trier tous les items par heure apres les corrections
  for (const day of fixedTrip.days) {
    day.items.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
    // Recalculer les orderIndex
    day.items.forEach((item, index) => {
      item.orderIndex = index;
    });
  }

  return fixedTrip;
}

/**
 * Corrige le timing d'une activite planifiee trop tot
 */
function fixActivityTiming(trip: Trip, error: CoherenceError): void {
  const day = trip.days.find(d => d.dayNumber === error.dayNumber);
  if (!day) return;

  // Trouver le point de reference (check-in hotel ou fin du vol)
  const referenceItem = error.items.find(i => i.type === 'hotel' || i.type === 'flight');
  const activityItem = error.items.find(i => i.type === 'activity');

  if (!referenceItem || !activityItem) return;

  const referenceEnd = parseTimeToMinutes(referenceItem.endTime);
  const activityDuration = parseTimeToMinutes(activityItem.endTime) - parseTimeToMinutes(activityItem.startTime);

  // Reprogrammer l'activite apres le point de reference + temps de trajet
  const newStartMinutes = referenceEnd + 30; // 30 min de trajet
  const newEndMinutes = newStartMinutes + activityDuration;

  // VALIDATION: verifier que l'activite rentre dans la journee (avant 23:00)
  const MAX_END_TIME = 23 * 60; // 23:00
  if (newEndMinutes > MAX_END_TIME) {
    console.log(`[AutoFix] Activite "${activityItem.title}" ne peut pas etre replanifiee (finirait a ${Math.floor(newEndMinutes/60)}:${newEndMinutes%60})`);
    // Supprimer l'activite car elle ne rentre pas dans la journee
    const index = day.items.findIndex(i => i.id === activityItem.id);
    if (index !== -1) {
      day.items.splice(index, 1);
      console.log(`[AutoFix] Activite "${activityItem.title}" supprimee (pas assez de temps)`);
    }
    return;
  }

  // Mettre a jour l'item dans le day
  const itemToFix = day.items.find(i => i.id === activityItem.id);
  if (itemToFix) {
    itemToFix.startTime = minutesToTime(newStartMinutes);
    itemToFix.endTime = minutesToTime(newEndMinutes);
    console.log(`[AutoFix] Activite "${activityItem.title}" deplacee a ${itemToFix.startTime}-${itemToFix.endTime}`);
  }
}

/**
 * Corrige un chevauchement en decalant le second item
 */
function fixOverlap(trip: Trip, error: CoherenceError): void {
  const day = trip.days.find(d => d.dayNumber === error.dayNumber);
  if (!day) return;

  const [item1, item2] = error.items;
  const item1End = parseTimeToMinutes(item1.endTime);
  const item2Duration = parseTimeToMinutes(item2.endTime) - parseTimeToMinutes(item2.startTime);

  // Decaler item2 apres item1
  const newStart = item1End + 15; // 15 min de marge
  const newEnd = newStart + item2Duration;

  // VALIDATION: verifier que l'item rentre dans la journee (avant 23:00)
  const MAX_END_TIME = 23 * 60; // 23:00
  if (newEnd > MAX_END_TIME) {
    console.log(`[AutoFix] "${item2.title}" ne peut pas etre decale (finirait a ${Math.floor(newEnd/60)}:${newEnd%60})`);
    // Si c'est une activite, la supprimer
    if (item2.type === 'activity') {
      const index = day.items.findIndex(i => i.id === item2.id);
      if (index !== -1) {
        day.items.splice(index, 1);
        console.log(`[AutoFix] Activite "${item2.title}" supprimee (pas assez de temps)`);
      }
    }
    return;
  }

  const itemToFix = day.items.find(i => i.id === item2.id);
  if (itemToFix) {
    itemToFix.startTime = minutesToTime(newStart);
    itemToFix.endTime = minutesToTime(newEnd);
    console.log(`[AutoFix] "${item2.title}" decale a ${itemToFix.startTime}-${itemToFix.endTime}`);
  }
}

/**
 * Corrige l'ordre de la logistique (vol, transfert, hotel)
 * Fonctionne pour avion, train, bus, voiture
 */
function fixLogisticsOrder(trip: Trip, error: CoherenceError): void {
  const day = trip.days.find(d => d.dayNumber === error.dayNumber);
  if (!day) return;

  const totalDays = trip.days.length;
  const isFirstDay = day.dayNumber === 1;
  const isLastDay = day.dayNumber === totalDays;

  // Reconstruire l'ordre logique
  const logistics = day.items.filter(i =>
    ['flight', 'transport', 'hotel', 'checkin', 'checkout', 'parking'].includes(i.type)
  );
  const nonLogistics = day.items.filter(i =>
    !['flight', 'transport', 'hotel', 'checkin', 'checkout', 'parking'].includes(i.type)
  );

  // Trier la logistique selon l'ordre logique (en passant le titre pour distinguer les transports)
  if (isFirstDay) {
    // Ordre: parking -> checkin -> flight/train -> transfert local -> hotel
    logistics.sort((a, b) => {
      const orderA = getFirstDayLogisticsOrder(a.type, a.title);
      const orderB = getFirstDayLogisticsOrder(b.type, b.title);
      return orderA - orderB;
    });
  } else if (isLastDay) {
    // Ordre: checkout -> transfert local -> flight/train -> parking
    logistics.sort((a, b) => {
      const orderA = getLastDayLogisticsOrder(a.type, a.title);
      const orderB = getLastDayLogisticsOrder(b.type, b.title);
      return orderA - orderB;
    });
  }

  // Recalculer les horaires de la logistique
  // PROTECTION: Si un item a une heure avant 05:00, c'est probablement une erreur de calcul
  // (ex: trajet Caen → Paris qui débute à 22:38 la veille mais s'affiche le jour même)
  // On utilise 08:00 comme heure minimale de départ pour la logistique
  const MIN_LOGISTICS_START = 5 * 60; // 05:00 en minutes
  let rawStart = parseTimeToMinutes(logistics[0]?.startTime || '08:00');
  // Si l'heure de départ est avant 05:00 (ex: 00:30, 03:00), c'est suspect
  // Cela peut arriver si un trajet traverse minuit et que l'heure est mal calculée
  let cursor = rawStart < MIN_LOGISTICS_START ? parseTimeToMinutes('08:00') : rawStart;

  for (const item of logistics) {
    const duration = parseTimeToMinutes(item.endTime) - parseTimeToMinutes(item.startTime);
    // Protection contre les durées négatives (item qui traverse minuit)
    const safeDuration = duration >= 0 ? duration : Math.min(120, Math.abs(duration));
    item.startTime = minutesToTime(cursor);
    item.endTime = minutesToTime(cursor + safeDuration);
    cursor += safeDuration;
  }

  // S'assurer que les activites sont APRES l'ARRIVEE (jour 1)
  // IMPORTANT: Sur le Jour 1, les activités peuvent être AVANT le check-in hôtel!
  // Le voyageur arrive tôt (ex: 9h30), le check-in est à 15h → il a 5h30 pour faire des activités
  // La "logistique d'arrivée" est le TRANSFERT (aéroport→centre-ville), PAS le check-in hôtel
  if (isFirstDay) {
    // Trouver le transfert d'arrivée (pas le check-in hôtel)
    const arrivalLogistic = logistics.find(l =>
      l.type === 'transport' &&
      (l.title.toLowerCase().includes('aéroport') ||
       l.title.toLowerCase().includes('gare') ||
       l.title.toLowerCase().includes('transfert'))
    ) || logistics.find(l => l.type === 'flight');

    // NE PAS décaler les activités après le check-in - elles peuvent être avant!
    // On vérifie seulement qu'elles sont après l'ARRIVÉE (transfert ou vol)
    if (arrivalLogistic) {
      const arrivalEnd = parseTimeToMinutes(arrivalLogistic.endTime);
      const activities = nonLogistics.filter(i => i.type === 'activity');

      for (const item of activities) {
        const activityStart = parseTimeToMinutes(item.startTime);
        // Si l'activité commence AVANT l'arrivée, la décaler juste après
        if (activityStart < arrivalEnd) {
          const duration = parseTimeToMinutes(item.endTime) - parseTimeToMinutes(item.startTime);
          item.startTime = minutesToTime(arrivalEnd + 15);
          item.endTime = minutesToTime(arrivalEnd + 15 + duration);
          console.log(`[AutoFix] Activite "${item.title}" decalee apres arrivee: ${item.startTime}-${item.endTime}`);
        }
      }
    }
    // NOTE: On ne supprime plus les activités qui sont avant le check-in!
  }

  // S'assurer que les activites sont AVANT la logistique de depart (dernier jour)
  if (isLastDay && logistics.length > 0) {
    const firstLogistic = logistics[0];
    const logisticStart = parseTimeToMinutes(firstLogistic.startTime);
    const activitiesInDay = nonLogistics.filter(i => i.type === 'activity');
    const MIN_START_TIME = 8 * 60; // 08:00
    const activitiesToRemove: string[] = [];

    // Si une activite depasse le debut de la logistique, la decaler avant
    for (const activity of activitiesInDay) {
      const activityEnd = parseTimeToMinutes(activity.endTime);
      if (activityEnd > logisticStart - 30) {
        // Decaler l'activite plus tot
        const duration = parseTimeToMinutes(activity.endTime) - parseTimeToMinutes(activity.startTime);
        const newEnd = logisticStart - 30;
        const newStart = newEnd - duration;

        // VALIDATION: verifier que l'activite peut etre decalee (pas avant 8h)
        if (newStart < MIN_START_TIME) {
          console.log(`[AutoFix] Activite "${activity.title}" ne peut pas etre decalee (commencerait a ${Math.floor(newStart/60)}:${newStart%60})`);
          activitiesToRemove.push(activity.id);
          continue;
        }

        activity.startTime = minutesToTime(newStart);
        activity.endTime = minutesToTime(newEnd);
      }
    }

    // Supprimer les activites qui ne rentrent pas
    for (const id of activitiesToRemove) {
      const index = day.items.findIndex(i => i.id === id);
      if (index !== -1) {
        const removed = day.items.splice(index, 1)[0];
        console.log(`[AutoFix] Activite "${removed.title}" supprimee (pas assez de temps le dernier jour)`);
      }
    }
  }

  console.log(`[AutoFix] Ordre logistique corrige pour le jour ${day.dayNumber}`);
}

/**
 * Supprime une attraction en double
 */
function removeDuplicate(trip: Trip, error: CoherenceError): void {
  // Garder la premiere occurrence, supprimer les autres
  const [firstItem, duplicateItem] = error.items;
  const day = trip.days.find(d => d.dayNumber === error.dayNumber);
  if (!day) return;

  const index = day.items.findIndex(i => i.id === duplicateItem.id);
  if (index !== -1) {
    day.items.splice(index, 1);
    console.log(`[AutoFix] Attraction en double "${duplicateItem.title}" supprimee du jour ${day.dayNumber}`);
  }
}

/**
 * Supprime une activite invalide (heure impossible ou generique)
 */
function removeInvalidActivity(trip: Trip, error: CoherenceError): void {
  const day = trip.days.find(d => d.dayNumber === error.dayNumber);
  if (!day) return;

  for (const item of error.items) {
    const index = day.items.findIndex(i => i.id === item.id);
    if (index !== -1) {
      day.items.splice(index, 1);
      const reason = error.type === 'GENERIC_ACTIVITY'
        ? 'activite generique'
        : 'heure impossible';
      console.log(`[AutoFix] "${item.title}" supprimee (${reason}) du jour ${day.dayNumber}`);
    }
  }
}

/**
 * Corrige l'ordre des repas
 */
function fixMealOrder(trip: Trip, error: CoherenceError): void {
  const day = trip.days.find(d => d.dayNumber === error.dayNumber);
  if (!day) return;

  const meals = day.items.filter(i => i.type === 'restaurant');

  // Definir les plages horaires standard
  const mealTimes: { [key: string]: { start: number; end: number } } = {
    breakfast: { start: 8 * 60, end: 9 * 60 + 30 },
    lunch: { start: 12 * 60 + 30, end: 14 * 60 },
    dinner: { start: 19 * 60 + 30, end: 21 * 60 },
  };

  for (const meal of meals) {
    const title = meal.title.toLowerCase();
    let mealType: string | null = null;

    if (title.includes('petit') || title.includes('breakfast')) mealType = 'breakfast';
    else if (title.includes('dejeuner') || title.includes('lunch')) mealType = 'lunch';
    else if (title.includes('diner') || title.includes('dinner')) mealType = 'dinner';

    if (mealType && mealTimes[mealType]) {
      const duration = parseTimeToMinutes(meal.endTime) - parseTimeToMinutes(meal.startTime);
      meal.startTime = minutesToTime(mealTimes[mealType].start);
      meal.endTime = minutesToTime(mealTimes[mealType].start + duration);
    }
  }

  console.log(`[AutoFix] Ordre des repas corrige pour le jour ${day.dayNumber}`);
}

// ============================================
// Fonctions utilitaires
// ============================================

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  // VALIDATION: une journee ne peut pas depasser 23:59 (1439 minutes)
  const MAX_MINUTES = 23 * 60 + 59; // 23:59
  const MIN_MINUTES = 0; // 00:00

  // Clamper les valeurs invalides
  if (minutes < MIN_MINUTES) {
    console.warn(`[minutesToTime] Valeur negative (${minutes}), forcee a 00:00`);
    minutes = MIN_MINUTES;
  }
  if (minutes > MAX_MINUTES) {
    console.warn(`[minutesToTime] Depassement de 24h (${minutes} min = ${Math.floor(minutes/60)}h${minutes%60}), forcee a 23:59`);
    minutes = MAX_MINUTES;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function getFirstDayLogisticsOrder(type: string, title: string = ''): number {
  // Pour le premier jour:
  // Ordre logique: trajet vers aeroport -> parking -> checkin -> flight -> transfert local -> hotel
  // Avec train/bus: transport principal -> transfert local -> hotel

  const isMainTransportItem = isMainTransport(title);
  const lowerTitle = title.toLowerCase();

  // Detecter si c'est un trajet VERS l'aeroport (ex: "Trajet Caen → Paris")
  // Ces trajets doivent venir en PREMIER, avant le parking
  const isTransferToAirport = type === 'transport' && !isMainTransportItem &&
    (lowerTitle.includes('trajet') || lowerTitle.includes('navette')) &&
    (lowerTitle.includes('→') || lowerTitle.includes('->'));

  // Detecter si c'est un transfert DEPUIS l'aeroport (ex: "Transfert Aéroport → Centre")
  const isTransferFromAirport = type === 'transport' && !isMainTransportItem &&
    (lowerTitle.includes('aéroport') || lowerTitle.includes('aeroport') || lowerTitle.includes('airport'));

  if (isTransferToAirport) return 0; // Avant tout (trajet domicile → aeroport)
  if (type === 'parking') return 1;
  if (type === 'checkin') return 2;
  if (type === 'flight') return 3;
  if (type === 'transport' && isMainTransportItem) return 3; // Meme niveau que vol
  if (isTransferFromAirport) return 4; // Transfert depuis l'aeroport
  if (type === 'transport' && !isMainTransportItem) return 4; // Autres transferts locaux
  if (type === 'hotel') return 5;
  if (type === 'luggage') return 4.5; // Bagages entre transfert et hotel

  return 99;
}

function getLastDayLogisticsOrder(type: string, title: string = ''): number {
  // Pour le dernier jour:
  // checkout -> transfert local -> flight/transport principal -> parking

  const isMainTransportItem = isMainTransport(title);

  if (type === 'checkout') return 1;
  if (type === 'transport' && !isMainTransportItem) return 2; // Transfert local
  if (type === 'flight') return 3;
  if (type === 'transport' && isMainTransportItem) return 3; // Meme niveau que vol
  if (type === 'parking') return 4;

  return 99;
}

/**
 * Fonction principale pour valider et corriger un voyage
 * A appeler apres la generation du voyage
 *
 * IMPORTANT: Trie TOUJOURS les items par heure, meme si le voyage est valide.
 * Cela garantit que l'affichage est toujours chronologique.
 */
export function validateAndFixTrip(trip: Trip): Trip {
  console.log('\n=== Validation de coherence du voyage ===');

  // TOUJOURS trier les items par heure (avant et apres validation)
  const sortedTrip = JSON.parse(JSON.stringify(trip)) as Trip;
  for (const day of sortedTrip.days) {
    day.items.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
    day.items.forEach((item, index) => {
      item.orderIndex = index;
    });
  }

  const result = validateTripCoherence(sortedTrip);

  if (result.valid) {
    console.log('Voyage valide! Aucune incoherence detectee.');
    return sortedTrip;  // Retourner la version triee
  }

  console.log(`${result.errors.length} erreur(s) critique(s) detectee(s):`);
  for (const error of result.errors) {
    console.log(`  - [${error.type}] ${error.message}`);
  }

  if (result.warnings.length > 0) {
    console.log(`${result.warnings.length} avertissement(s):`);
    for (const warning of result.warnings) {
      console.log(`  - [${warning.type}] ${warning.message}`);
    }
  }

  if (result.fixedTrip) {
    // Re-valider apres correction
    const revalidation = validateTripCoherence(result.fixedTrip);
    if (revalidation.valid) {
      console.log('Voyage corrige avec succes!');
      return result.fixedTrip;
    } else {
      console.warn('Certaines erreurs n\'ont pas pu etre corrigees automatiquement:');
      for (const error of revalidation.errors) {
        console.warn(`  - [${error.type}] ${error.message}`);
      }
      return result.fixedTrip; // Retourner quand meme la version partiellement corrigee
    }
  }

  return trip;
}

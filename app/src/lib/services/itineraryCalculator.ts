import { TripDay, TripItem } from '@/lib/types';
import type { Attraction } from './attractions';
import { DEFAULT_TIME_CONFIG, TimeCalculationConfig } from '@/lib/types/collaboration';
import { getMealTimes } from './destinationData';

/**
 * Recalcule tous les horaires d'un itinéraire après un déplacement
 */
export function recalculateTimes(
  days: TripDay[],
  config: TimeCalculationConfig = DEFAULT_TIME_CONFIG
): TripDay[] {
  return days.map((day) => ({
    ...day,
    items: recalculateDayTimes(day.items, config),
  }));
}

/**
 * Recalcule les horaires d'une journée
 */
function recalculateDayTimes(
  items: TripItem[],
  config: TimeCalculationConfig
): TripItem[] {
  if (items.length === 0) return items;

  const result: TripItem[] = [];
  let currentTime = parseTime(items[0].startTime);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const duration = item.duration || config.defaultDurations[item.type] || 60;

    const startTime = formatTime(currentTime);
    const endTime = formatTime(currentTime + duration);

    result.push({
      ...item,
      startTime,
      endTime,
    });

    // Calculer temps de transport vers prochaine activité
    if (i < items.length - 1) {
      const nextItem = items[i + 1];
      const transportTime = estimateTransportTime(item, nextItem, config);
      currentTime += duration + transportTime;
    } else {
      currentTime += duration;
    }
  }

  return result;
}

/**
 * Estime le temps de transport entre deux items
 */
function estimateTransportTime(
  from: TripItem,
  to: TripItem,
  config: TimeCalculationConfig
): number {
  // Si coordonnées manquantes, utiliser le buffer par défaut
  if (!from.latitude || !from.longitude || !to.latitude || !to.longitude) {
    return config.transportBuffer;
  }

  const distance = calculateDistance(
    from.latitude,
    from.longitude,
    to.latitude,
    to.longitude
  );

  // Temps en minutes basé sur la vitesse moyenne
  const timeMinutes = (distance / config.averageSpeedKmH) * 60;

  // Minimum = buffer, maximum = 2h de transport
  return Math.min(Math.max(config.transportBuffer, Math.round(timeMinutes)), 120);
}

/**
 * Calcule la distance entre deux points (formule Haversine)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Rayon de la Terre en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parse une heure au format "HH:MM" en minutes depuis minuit
 */
function parseTime(time: string | undefined | null): number {
  if (!time || typeof time !== 'string') return 9 * 60; // default 09:00
  const [hours, minutes] = time.split(':').map(Number);
  return (isNaN(hours) ? 9 : hours) * 60 + (isNaN(minutes!) ? 0 : minutes!);
}

/**
 * Formate des minutes depuis minuit en "HH:MM"
 */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Déplace un item d'un jour/position à un autre
 */
export function moveItem(
  days: TripDay[],
  fromDayIndex: number,
  fromItemIndex: number,
  toDayIndex: number,
  toItemIndex: number
): TripDay[] {
  const newDays = days.map((day) => ({
    ...day,
    items: [...day.items],
  }));

  // Extraire l'item
  const [movedItem] = newDays[fromDayIndex].items.splice(fromItemIndex, 1);

  if (!movedItem) return days;

  // Mettre à jour le numéro de jour
  movedItem.dayNumber = toDayIndex + 1;

  // Insérer à la nouvelle position
  // Si on déplace dans le même jour vers une position supérieure, ajuster l'index
  if (fromDayIndex === toDayIndex && toItemIndex > fromItemIndex) {
    newDays[toDayIndex].items.splice(toItemIndex - 1, 0, movedItem);
  } else {
    newDays[toDayIndex].items.splice(toItemIndex, 0, movedItem);
  }

  // Mettre à jour les orderIndex
  newDays.forEach((day) => {
    day.items.forEach((item, idx) => {
      item.orderIndex = idx;
    });
  });

  return newDays;
}

/**
 * Trouve un item par son ID dans tous les jours
 */
export function findItemById(
  days: TripDay[],
  itemId: string
): { dayIndex: number; itemIndex: number; item: TripItem } | null {
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const itemIndex = days[dayIndex].items.findIndex((item) => item.id === itemId);
    if (itemIndex !== -1) {
      return {
        dayIndex,
        itemIndex,
        item: days[dayIndex].items[itemIndex],
      };
    }
  }
  return null;
}

/**
 * Trouve le jour et la position de drop basé sur l'ID over
 */
export function findDropPosition(
  days: TripDay[],
  overId: string
): { dayIndex: number; itemIndex: number } | null {
  // Vérifier si overId est un ID de jour (format: "day-X")
  if (overId.startsWith('day-')) {
    const dayIndex = parseInt(overId.replace('day-', ''), 10) - 1;
    if (dayIndex >= 0 && dayIndex < days.length) {
      return { dayIndex, itemIndex: days[dayIndex].items.length };
    }
  }

  // Sinon, chercher l'item
  const found = findItemById(days, overId);
  if (found) {
    return { dayIndex: found.dayIndex, itemIndex: found.itemIndex };
  }

  return null;
}

/**
 * Vérifie si un item est un transport verrouillé (non déplaçable/supprimable)
 */
export function isLockedItem(item: TripItem): boolean {
  return item.type === 'transport' || item.type === 'flight';
}

/**
 * Vérifie si un jour contient des items critiques (transport, checkin, checkout, flight)
 * qui le rendent non-permutable
 */
export function isDayLocked(day: TripDay): boolean {
  return day.items.some(
    (item) =>
      item.type === 'checkin' ||
      item.type === 'checkout' ||
      item.type === 'flight' ||
      item.type === 'transport'
  );
}

/**
 * Permute deux jours entiers (swap)
 */
export function swapDays(
  days: TripDay[],
  dayIndexA: number,
  dayIndexB: number
): TripDay[] {
  if (dayIndexA < 0 || dayIndexB < 0 || dayIndexA >= days.length || dayIndexB >= days.length) {
    return days;
  }
  // Don't swap locked days (contain transport/checkin/checkout/flight)
  if (isDayLocked(days[dayIndexA]) || isDayLocked(days[dayIndexB])) {
    return days;
  }
  const newDays = days.map((day) => ({ ...day, items: [...day.items] }));
  // Swap the items and themes but keep dayNumber and date in place
  const tempItems = newDays[dayIndexA].items;
  const tempTheme = newDays[dayIndexA].theme;
  const tempNarrative = newDays[dayIndexA].dayNarrative;

  newDays[dayIndexA].items = newDays[dayIndexB].items;
  newDays[dayIndexA].theme = newDays[dayIndexB].theme;
  newDays[dayIndexA].dayNarrative = newDays[dayIndexB].dayNarrative;

  newDays[dayIndexB].items = tempItems;
  newDays[dayIndexB].theme = tempTheme;
  newDays[dayIndexB].dayNarrative = tempNarrative;

  // Update dayNumber on items
  newDays.forEach((day, idx) => {
    day.items.forEach((item) => {
      item.dayNumber = idx + 1;
    });
  });

  return newDays;
}

/**
 * Déplace un item d'une position dans le même jour (haut/bas)
 */
export function moveItemInDay(
  days: TripDay[],
  dayIndex: number,
  fromIndex: number,
  direction: 'up' | 'down'
): TripDay[] {
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= days[dayIndex].items.length) return days;

  const newDays = days.map((day) => ({ ...day, items: [...day.items] }));
  const items = newDays[dayIndex].items;

  // Swap
  [items[fromIndex], items[toIndex]] = [items[toIndex], items[fromIndex]];

  // Update orderIndex
  items.forEach((item, idx) => { item.orderIndex = idx; });

  return newDays;
}

/**
 * Supprime un item d'un jour
 */
export function removeItem(
  days: TripDay[],
  dayIndex: number,
  itemIndex: number
): TripDay[] {
  const newDays = days.map((day) => ({ ...day, items: [...day.items] }));
  newDays[dayIndex].items.splice(itemIndex, 1);
  newDays[dayIndex].items.forEach((item, idx) => { item.orderIndex = idx; });
  return newDays;
}

/**
 * Ajoute un item à un jour
 */
export function addItem(
  days: TripDay[],
  dayIndex: number,
  item: TripItem
): TripDay[] {
  const newDays = days.map((day) => ({ ...day, items: [...day.items] }));
  item.dayNumber = dayIndex + 1;
  item.orderIndex = newDays[dayIndex].items.length;
  newDays[dayIndex].items.push(item);
  return newDays;
}

/**
 * Insère un nouveau jour dans l'itinéraire après le jour indiqué.
 * Renumérate tous les jours, recalcule les dates, et crée un jour avec repas par défaut.
 *
 * @param days - Les jours actuels
 * @param afterDayNumber - Insérer APRÈS ce numéro de jour (ex: 2 = entre jour 2 et 3)
 * @param startDate - Date de début du voyage
 * @param accommodation - Hébergement (pour coordonnées et calcul de coût)
 */
/**
 * Score une attraction pour le classement
 */
function scoreAttraction(a: Attraction): number {
  let score = 0;
  score += (a.rating || 0) * 10;                          // Max 50
  score += a.mustSee ? 30 : 0;                            // Must-see bonus
  score += Math.min(15, (a.reviewCount || 0) / 350);      // Fame bonus
  if (a.estimatedCost === 0) score += 5;                   // Free bonus
  return score;
}

/**
 * Convertit une Attraction en TripItem
 */
function attractionToTripItem(
  attraction: Attraction,
  dayNumber: number,
  startTime: string,
  endTime: string,
  orderIndex: number
): TripItem {
  return {
    id: crypto.randomUUID(),
    dayNumber,
    startTime,
    endTime,
    type: 'activity',
    title: attraction.name,
    description: attraction.description || attraction.tips || '',
    locationName: attraction.name,
    latitude: attraction.latitude,
    longitude: attraction.longitude,
    orderIndex,
    estimatedCost: attraction.estimatedCost || 0,
    duration: attraction.duration || 90,
    rating: attraction.rating,
    bookingUrl: attraction.bookingUrl,
    googleMapsPlaceUrl: attraction.googleMapsUrl,
    imageUrl: attraction.imageUrl,
    dataReliability: attraction.dataReliability || 'verified',
  };
}

/**
 * Récupère les activités inutilisées du pool, triées par score
 */
export function getUnusedAttractions(
  pool: Attraction[],
  days: TripDay[]
): Attraction[] {
  // Collecter les noms d'activités déjà utilisées (normalisés)
  const usedNames = new Set<string>();
  const usedIds = new Set<string>();

  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity') {
        usedNames.add(item.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        if (item.id) usedIds.add(item.id);
      }
    }
  }

  // Filtrer et trier
  return pool
    .filter(a => {
      if (usedIds.has(a.id)) return false;
      const normalizedName = a.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      // Vérifier correspondance partielle (ex: "Louvre" match "Musée du Louvre")
      for (const used of usedNames) {
        if (normalizedName.includes(used) || used.includes(normalizedName)) return false;
      }
      return true;
    })
    .sort((a, b) => scoreAttraction(b) - scoreAttraction(a));
}

export function insertDay(
  days: TripDay[],
  afterDayNumber: number,
  startDate: Date,
  accommodation?: { name?: string; latitude?: number; longitude?: number; pricePerNight?: number } | null,
  attractionPool?: Attraction[],
  destination?: string
): TripDay[] {
  // Validation
  if (days.length < 2) return days; // Voyage trop court
  if (afterDayNumber < 1 || afterDayNumber > days.length) return days;

  // Get local meal times for this destination
  const localMealTimes = destination ? getMealTimes(destination) : { breakfast: '09:00', lunch: '12:30', dinner: '19:30' };

  const newDays: TripDay[] = structuredClone(days);

  // Coordonnées par défaut (hôtel ou centre approximatif du trip)
  const defaultLat = accommodation?.latitude || days[0]?.items?.[0]?.latitude || 0;
  const defaultLng = accommodation?.longitude || days[0]?.items?.[0]?.longitude || 0;
  const locationName = accommodation?.name || 'Centre-ville';

  const newDayNumber = afterDayNumber + 1; // Temporaire, sera recalculé

  // Sélectionner les activités depuis le pool (si disponible)
  const unusedAttractions = attractionPool
    ? getUnusedAttractions(attractionPool, days)
    : [];

  // Construire les items du jour
  const items: TripItem[] = [];
  let orderIdx = 0;

  // Petit-déjeuner (local meal time)
  const bfStart = parseTime(localMealTimes.breakfast);
  items.push({
    id: crypto.randomUUID(),
    dayNumber: newDayNumber,
    startTime: localMealTimes.breakfast,
    endTime: formatTime(bfStart + 45),
    type: 'restaurant',
    title: 'Petit-déjeuner',
    description: 'Petit-déjeuner libre',
    locationName,
    latitude: defaultLat,
    longitude: defaultLng,
    orderIndex: orderIdx++,
    estimatedCost: 10,
    duration: 45,
    dataReliability: 'generated',
  });

  // Activité 1 (matin) — depuis le pool ou temps libre
  const activity1Start = bfStart + 60; // 1h after breakfast
  const activity1StartStr = formatTime(activity1Start);
  if (unusedAttractions.length >= 1) {
    const a = unusedAttractions[0];
    const duration = Math.min(a.duration || 90, 120); // Max 2h
    const endMinutes = activity1Start + duration;
    items.push(attractionToTripItem(a, newDayNumber, activity1StartStr, formatTime(endMinutes), orderIdx++));
  } else {
    items.push({
      id: crypto.randomUUID(),
      dayNumber: newDayNumber,
      startTime: activity1StartStr,
      endTime: formatTime(activity1Start + 120),
      type: 'activity',
      title: 'Temps libre / Exploration',
      description: 'Profitez de cette journée libre pour explorer à votre rythme',
      locationName,
      latitude: defaultLat,
      longitude: defaultLng,
      orderIndex: orderIdx++,
      duration: 120,
      dataReliability: 'generated',
    });
  }

  // Déjeuner (local meal time)
  const lunchStart = parseTime(localMealTimes.lunch);
  items.push({
    id: crypto.randomUUID(),
    dayNumber: newDayNumber,
    startTime: localMealTimes.lunch,
    endTime: formatTime(lunchStart + 75),
    type: 'restaurant',
    title: 'Déjeuner',
    description: 'Déjeuner libre',
    locationName,
    latitude: defaultLat,
    longitude: defaultLng,
    orderIndex: orderIdx++,
    estimatedCost: 15,
    duration: 75,
    dataReliability: 'generated',
  });

  // Activité 2 (début après-midi) — depuis le pool ou temps libre
  const activity2Start = lunchStart + 90; // 1h30 after lunch start
  const activity2StartStr = formatTime(activity2Start);
  if (unusedAttractions.length >= 2) {
    const a = unusedAttractions[1];
    const duration = Math.min(a.duration || 90, 120);
    const endMinutes = activity2Start + duration;
    items.push(attractionToTripItem(a, newDayNumber, activity2StartStr, formatTime(endMinutes), orderIdx++));
  } else {
    items.push({
      id: crypto.randomUUID(),
      dayNumber: newDayNumber,
      startTime: activity2StartStr,
      endTime: formatTime(activity2Start + 120),
      type: 'activity',
      title: 'Temps libre',
      description: 'Après-midi libre',
      locationName,
      latitude: defaultLat,
      longitude: defaultLng,
      orderIndex: orderIdx++,
      duration: 120,
      dataReliability: 'generated',
    });
  }

  // Activité 3 (fin après-midi) — seulement si pool assez fourni
  const activity3Start = activity2Start + 150; // ~2h30 after activity 2 start
  const activity3StartStr = formatTime(activity3Start);
  if (unusedAttractions.length >= 3) {
    const a = unusedAttractions[2];
    const duration = Math.min(a.duration || 60, 90); // Max 1h30
    const endMinutes = activity3Start + duration;
    items.push(attractionToTripItem(a, newDayNumber, activity3StartStr, formatTime(endMinutes), orderIdx++));
  }

  // Dîner (local meal time)
  const dinnerStart = parseTime(localMealTimes.dinner);
  items.push({
    id: crypto.randomUUID(),
    dayNumber: newDayNumber,
    startTime: localMealTimes.dinner,
    endTime: formatTime(dinnerStart + 90),
    type: 'restaurant',
    title: 'Dîner',
    description: 'Dîner libre',
    locationName,
    latitude: defaultLat,
    longitude: defaultLng,
    orderIndex: orderIdx++,
    estimatedCost: 25,
    duration: 90,
    dataReliability: 'generated',
  });

  // Déterminer le thème du jour
  const hasPoolActivities = unusedAttractions.length >= 1 && attractionPool;
  const activityNames = unusedAttractions.slice(0, 3).map(a => a.name);
  const theme = hasPoolActivities
    ? activityNames.length <= 2
      ? activityNames.join(' & ')
      : `${activityNames[0]} & plus`
    : 'Journée libre';

  const narrative = hasPoolActivities
    ? `Découvrez ${activityNames.join(', ')} — activités sélectionnées parmi les mieux notées de la destination.`
    : 'Une journée libre pour explorer à votre rythme, découvrir des coins cachés ou simplement vous détendre.';

  const newDay: TripDay = {
    dayNumber: newDayNumber,
    date: new Date(), // Sera recalculé
    items,
    theme,
    dayNarrative: narrative,
  };

  // Insérer le nouveau jour à la bonne position
  newDays.splice(afterDayNumber, 0, newDay);

  // Renuméroter tous les jours et recalculer les dates
  const baseDate = new Date(startDate);
  for (let i = 0; i < newDays.length; i++) {
    newDays[i].dayNumber = i + 1;

    // Recalculer la date
    const dayDate = new Date(baseDate);
    dayDate.setDate(baseDate.getDate() + i);
    dayDate.setHours(12, 0, 0, 0);
    newDays[i].date = dayDate;

    // Mettre à jour dayNumber de tous les items
    for (const item of newDays[i].items) {
      item.dayNumber = i + 1;
    }
  }

  return newDays;
}

/**
 * Génère une description pour un déplacement
 */
export function generateMoveDescription(
  item: TripItem,
  fromDayNumber: number,
  toDayNumber: number,
  toPosition: number
): string {
  if (fromDayNumber === toDayNumber) {
    return `Déplacer "${item.title}" en position ${toPosition + 1}`;
  }
  return `Déplacer "${item.title}" du jour ${fromDayNumber} au jour ${toDayNumber}`;
}

// Meal windows for quality flag detection
const MEAL_WINDOWS: Record<string, { start: number; end: number }> = {
  breakfast: { start: 7 * 60, end: 10 * 60 },         // 07:00 - 10:00
  lunch:     { start: 11 * 60 + 30, end: 14 * 60 + 30 }, // 11:30 - 14:30
  dinner:    { start: 18 * 60 + 30, end: 22 * 60 },    // 18:30 - 22:00
};

/**
 * Détecte si un restaurant tombe en dehors de sa fenêtre repas attendue.
 * Retourne un flag descriptif ou null.
 */
function checkMealWindowFlag(item: TripItem, startMinutes: number): string | null {
  if (item.type !== 'restaurant') return null;

  // Déterminer le type de repas à partir du mealType ou du titre
  let mealType: string | undefined = item.mealType;
  if (!mealType) {
    const titleLower = item.title.toLowerCase();
    if (titleLower.includes('petit-déjeuner') || titleLower.includes('breakfast') || titleLower.includes('brunch')) {
      mealType = 'breakfast';
    } else if (titleLower.includes('déjeuner') || titleLower.includes('lunch')) {
      mealType = 'lunch';
    } else if (titleLower.includes('dîner') || titleLower.includes('dinner') || titleLower.includes('souper')) {
      mealType = 'dinner';
    }
  }

  if (!mealType || !MEAL_WINDOWS[mealType]) return null;

  const window = MEAL_WINDOWS[mealType];
  if (startMinutes < window.start || startMinutes > window.end) {
    return `meal_outside_window:${mealType}:${formatTime(startMinutes)}`;
  }
  return null;
}

/**
 * Recalcul en cascade à partir d'un item modifié.
 * Ne touche que les items APRÈS le point de changement dans le même jour.
 * Propage: startTime = prevEndTime + travelTime, endTime = startTime + duration.
 * Ajoute des qualityFlags si un restaurant tombe hors fenêtre repas.
 */
export function cascadeRecalculate(
  days: TripDay[],
  changedItemId: string,
  changeType: 'move' | 'duration' | 'delete' | 'add'
): TripDay[] {
  // Trouver l'item modifié
  const found = findItemById(days, changedItemId);
  if (!found) return days;

  const { dayIndex, itemIndex } = found;
  const config = DEFAULT_TIME_CONFIG;

  // Deep clone des jours pour immutabilité
  const newDays: TripDay[] = days.map((day) => ({
    ...day,
    items: day.items.map((item) => ({ ...item, qualityFlags: item.qualityFlags ? [...item.qualityFlags] : undefined })),
  }));

  const dayItems = newDays[dayIndex].items;

  // Déterminer le point de départ de la cascade
  // Pour 'delete', on commence à itemIndex (l'item suivant a pris cette position)
  // Pour les autres, on commence à itemIndex + 1 (l'item modifié est déjà correct)
  const cascadeStart = changeType === 'delete' ? itemIndex : itemIndex + 1;

  if (cascadeStart >= dayItems.length) return newDays;

  // Calculer le temps de fin de l'item précédent la cascade
  let prevItem: TripItem;
  if (cascadeStart > 0) {
    prevItem = dayItems[cascadeStart - 1];
  } else {
    // Cas delete du premier item: le suivant garde son heure
    return newDays;
  }

  let currentTime = parseTime(prevItem.endTime);

  // Propager les horaires en cascade
  for (let i = cascadeStart; i < dayItems.length; i++) {
    const item = dayItems[i];

    // Calculer le temps de transport depuis l'item précédent
    const prev = dayItems[i - 1];
    const transportTime = estimateTransportTime(prev, item, config);

    const startMinutes = currentTime + transportTime;
    const duration = item.duration || config.defaultDurations[item.type] || 60;
    const endMinutes = startMinutes + duration;

    item.startTime = formatTime(startMinutes);
    item.endTime = formatTime(endMinutes);

    // Vérifier la fenêtre repas pour les restaurants
    const mealFlag = checkMealWindowFlag(item, startMinutes);
    if (mealFlag) {
      if (!item.qualityFlags) item.qualityFlags = [];
      // Retirer un ancien flag meal_outside_window s'il existe
      item.qualityFlags = item.qualityFlags.filter((f) => !f.startsWith('meal_outside_window:'));
      item.qualityFlags.push(mealFlag);
    } else if (item.qualityFlags) {
      // Nettoyer un ancien flag si le repas est maintenant dans la fenêtre
      item.qualityFlags = item.qualityFlags.filter((f) => !f.startsWith('meal_outside_window:'));
      if (item.qualityFlags.length === 0) item.qualityFlags = undefined;
    }

    currentTime = endMinutes;
  }

  return newDays;
}

import { TripDay, TripItem } from '@/lib/types';
import type { Attraction } from './attractions';
import { DEFAULT_TIME_CONFIG, TimeCalculationConfig } from '@/lib/types/collaboration';

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
  attractionPool?: Attraction[]
): TripDay[] {
  // Validation
  if (days.length < 2) return days; // Voyage trop court
  if (afterDayNumber < 1 || afterDayNumber > days.length) return days;

  const newDays: TripDay[] = JSON.parse(JSON.stringify(days));

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

  // Petit-déjeuner
  items.push({
    id: crypto.randomUUID(),
    dayNumber: newDayNumber,
    startTime: '09:00',
    endTime: '09:45',
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
  if (unusedAttractions.length >= 1) {
    const a = unusedAttractions[0];
    const duration = Math.min(a.duration || 90, 120); // Max 2h
    const endMinutes = 600 + duration; // 10:00 + duration
    const endH = Math.floor(endMinutes / 60).toString().padStart(2, '0');
    const endM = (endMinutes % 60).toString().padStart(2, '0');
    items.push(attractionToTripItem(a, newDayNumber, '10:00', `${endH}:${endM}`, orderIdx++));
  } else {
    items.push({
      id: crypto.randomUUID(),
      dayNumber: newDayNumber,
      startTime: '10:00',
      endTime: '12:00',
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

  // Déjeuner
  items.push({
    id: crypto.randomUUID(),
    dayNumber: newDayNumber,
    startTime: '12:30',
    endTime: '13:45',
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
  if (unusedAttractions.length >= 2) {
    const a = unusedAttractions[1];
    const duration = Math.min(a.duration || 90, 120);
    const endMinutes = 870 + duration; // 14:30 + duration
    const endH = Math.floor(endMinutes / 60).toString().padStart(2, '0');
    const endM = (endMinutes % 60).toString().padStart(2, '0');
    items.push(attractionToTripItem(a, newDayNumber, '14:30', `${endH}:${endM}`, orderIdx++));
  } else {
    items.push({
      id: crypto.randomUUID(),
      dayNumber: newDayNumber,
      startTime: '14:30',
      endTime: '16:30',
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
  if (unusedAttractions.length >= 3) {
    const a = unusedAttractions[2];
    const duration = Math.min(a.duration || 60, 90); // Max 1h30
    const endMinutes = 1020 + duration; // 17:00 + duration
    const endH = Math.floor(endMinutes / 60).toString().padStart(2, '0');
    const endM = (endMinutes % 60).toString().padStart(2, '0');
    items.push(attractionToTripItem(a, newDayNumber, '17:00', `${endH}:${endM}`, orderIdx++));
  }

  // Dîner
  items.push({
    id: crypto.randomUUID(),
    dayNumber: newDayNumber,
    startTime: '19:30',
    endTime: '21:00',
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

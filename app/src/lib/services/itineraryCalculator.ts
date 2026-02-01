import { TripDay, TripItem } from '@/lib/types';
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

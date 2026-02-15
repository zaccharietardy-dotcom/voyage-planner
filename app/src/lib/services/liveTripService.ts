import { Trip, TripItem, TripDay, LiveTimelineEvent } from '@/lib/types';

/**
 * Service pour gérer les voyages en cours (Live Trip Mode)
 * Détecte si un voyage est actuellement en cours et fournit des données en temps réel
 */

/**
 * Vérifie si un voyage est actuellement en cours
 * Un voyage est live si la date du jour est entre startDate et endDate
 */
export function isLiveTrip(trip: Trip): boolean {
  if (!trip.preferences?.startDate || !trip.preferences?.durationDays) {
    return false;
  }

  const now = new Date();
  const startDate = new Date(trip.preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + trip.preferences.durationDays);

  // Réinitialiser les heures pour comparer seulement les dates
  now.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  return now >= startDate && now < endDate;
}

/**
 * Obtient le numéro du jour actuel (1-based)
 */
export function getCurrentDayNumber(trip: Trip): number | null {
  if (!isLiveTrip(trip)) {
    return null;
  }

  const now = new Date();
  const startDate = new Date(trip.preferences.startDate);

  now.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff + 1; // 1-based
}

/**
 * Parse une heure au format "HH:mm" et retourne le nombre de minutes depuis minuit
 */
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Obtient l'activité en cours basée sur l'heure actuelle
 */
export function getCurrentActivity(trip: Trip): TripItem | null {
  const currentDayNumber = getCurrentDayNumber(trip);
  if (!currentDayNumber) {
    return null;
  }

  const currentDay = trip.days?.find((day) => day.dayNumber === currentDayNumber);
  if (!currentDay?.items) {
    return null;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Trouver l'activité en cours
  for (const item of currentDay.items) {
    const startMinutes = parseTimeToMinutes(item.startTime);
    const endMinutes = parseTimeToMinutes(item.endTime);

    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
      return item;
    }
  }

  return null;
}

/**
 * Obtient la prochaine activité à venir
 */
export function getNextActivity(trip: Trip): TripItem | null {
  const currentDayNumber = getCurrentDayNumber(trip);
  if (!currentDayNumber) {
    return null;
  }

  const currentDay = trip.days?.find((day) => day.dayNumber === currentDayNumber);
  if (!currentDay?.items) {
    return null;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Trouver la prochaine activité du jour
  const sortedItems = [...currentDay.items].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  );

  for (const item of sortedItems) {
    const startMinutes = parseTimeToMinutes(item.startTime);
    if (startMinutes > currentMinutes) {
      return item;
    }
  }

  // Si aucune activité aujourd'hui, chercher dans le jour suivant
  const nextDay = trip.days?.find((day) => day.dayNumber === currentDayNumber + 1);
  if (nextDay?.items && nextDay.items.length > 0) {
    const sortedNextDayItems = [...nextDay.items].sort(
      (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
    );
    return sortedNextDayItems[0];
  }

  return null;
}

/**
 * Obtient le temps restant en minutes avant la prochaine activité
 */
export function getTimeUntilNext(trip: Trip): number | null {
  const nextActivity = getNextActivity(trip);
  if (!nextActivity) {
    return null;
  }

  const currentDayNumber = getCurrentDayNumber(trip);
  const nextActivityDay = trip.days?.find((day) =>
    day.items?.some((item) => item.id === nextActivity.id)
  );

  if (!nextActivityDay) {
    return null;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const nextStartMinutes = parseTimeToMinutes(nextActivity.startTime);

  // Si l'activité est demain
  if (nextActivityDay.dayNumber > (currentDayNumber || 0)) {
    const minutesUntilMidnight = 24 * 60 - currentMinutes;
    return minutesUntilMidnight + nextStartMinutes;
  }

  return nextStartMinutes - currentMinutes;
}

/**
 * Obtient la progression du jour en cours
 */
export function getDayProgress(trip: Trip): {
  currentDay: number;
  totalDays: number;
  percentComplete: number;
} | null {
  const currentDayNumber = getCurrentDayNumber(trip);
  if (!currentDayNumber) {
    return null;
  }

  const totalDays = trip.preferences?.durationDays || 0;
  const percentComplete = Math.min(100, Math.round(((currentDayNumber - 1) / totalDays) * 100));

  return {
    currentDay: currentDayNumber,
    totalDays,
    percentComplete,
  };
}

/**
 * Génère la timeline complète pour aujourd'hui
 */
export function getTripTimeline(trip: Trip): LiveTimelineEvent[] {
  const currentDayNumber = getCurrentDayNumber(trip);
  if (!currentDayNumber) {
    return [];
  }

  const currentDay = trip.days?.find((day) => day.dayNumber === currentDayNumber);
  if (!currentDay?.items) {
    return [];
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const timeline: LiveTimelineEvent[] = currentDay.items.map((item) => {
    const startMinutes = parseTimeToMinutes(item.startTime);
    const endMinutes = parseTimeToMinutes(item.endTime);

    let status: 'completed' | 'in_progress' | 'upcoming';
    if (currentMinutes >= endMinutes) {
      status = 'completed';
    } else if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
      status = 'in_progress';
    } else {
      status = 'upcoming';
    }

    // Déterminer le type
    let type: 'activity' | 'transport' | 'meal' | 'free_time';
    if (item.type === 'restaurant') {
      type = 'meal';
    } else if (item.type === 'transport' || item.type === 'flight') {
      type = 'transport';
    } else if (item.type === 'free_time') {
      type = 'free_time';
    } else {
      type = 'activity';
    }

    return {
      id: item.id,
      type,
      title: item.title,
      startTime: item.startTime,
      endTime: item.endTime,
      status,
      activity: item,
    };
  });

  // Trier par heure de début
  timeline.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));

  return timeline;
}

/**
 * Obtient les statistiques du jour actuel
 */
export function getDayStats(trip: Trip): {
  activitiesRemaining: number;
  totalDistance: number;
  estimatedWalkingTime: number;
} | null {
  const currentDayNumber = getCurrentDayNumber(trip);
  if (!currentDayNumber) {
    return null;
  }

  const currentDay = trip.days?.find((day) => day.dayNumber === currentDayNumber);
  if (!currentDay?.items) {
    return null;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const remainingItems = currentDay.items.filter((item) => {
    const startMinutes = parseTimeToMinutes(item.startTime);
    return startMinutes > currentMinutes;
  });

  const totalDistance = remainingItems.reduce((sum, item) => {
    return sum + (item.distanceFromPrevious || 0);
  }, 0);

  const estimatedWalkingTime = remainingItems.reduce((sum, item) => {
    return sum + (item.timeFromPrevious || 0);
  }, 0);

  return {
    activitiesRemaining: remainingItems.length,
    totalDistance: Math.round(totalDistance * 10) / 10, // 1 décimale
    estimatedWalkingTime: Math.round(estimatedWalkingTime),
  };
}

/**
 * Vérifie si une activité est imminente (dans les N minutes)
 */
export function isActivityImminent(trip: Trip, minutesThreshold: number = 15): boolean {
  const timeUntilNext = getTimeUntilNext(trip);
  return timeUntilNext !== null && timeUntilNext <= minutesThreshold && timeUntilNext > 0;
}

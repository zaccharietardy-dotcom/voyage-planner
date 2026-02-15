import { Trip, LiveNotification } from '@/lib/types';
import {
  isLiveTrip,
  getCurrentDayNumber,
  getTripTimeline,
  getDayProgress,
} from './liveTripService';

/**
 * Service pour générer les notifications programmées pour les voyages en cours
 * Ne crée PAS directement les notifications - retourne seulement la liste
 * des notifications qui devraient être envoyées
 */

/**
 * Génère toutes les notifications qui devraient être envoyées aujourd'hui
 */
export function getUpcomingNotifications(trip: Trip): LiveNotification[] {
  if (!isLiveTrip(trip)) {
    return [];
  }

  const notifications: LiveNotification[] = [];
  const now = new Date();

  // 1. Morning briefing (8h00)
  const morningBriefing = generateMorningBriefing(trip, now);
  if (morningBriefing) {
    notifications.push(morningBriefing);
  }

  // 2. Notifications d'activités
  const activityNotifications = generateActivityNotifications(trip, now);
  notifications.push(...activityNotifications);

  // 3. Notifications de transport
  const transportNotifications = generateTransportReminders(trip, now);
  notifications.push(...transportNotifications);

  return notifications;
}

/**
 * Génère le briefing matinal (8h00)
 */
function generateMorningBriefing(trip: Trip, now: Date): LiveNotification | null {
  const currentDayNumber = getCurrentDayNumber(trip);
  if (!currentDayNumber) {
    return null;
  }

  const briefingTime = new Date(now);
  briefingTime.setHours(8, 0, 0, 0);

  // Ne pas envoyer si déjà passé aujourd'hui
  if (now > briefingTime) {
    return null;
  }

  const dayProgress = getDayProgress(trip);
  const timeline = getTripTimeline(trip);
  const activitiesCount = timeline.filter((e) => e.type === 'activity').length;

  const destination = trip.preferences?.destination || 'votre destination';

  return {
    id: `morning-briefing-${currentDayNumber}`,
    type: 'morning_briefing',
    title: `Jour ${currentDayNumber} à ${destination}`,
    body: `Bonjour ! Vous avez ${activitiesCount} activités prévues aujourd'hui. Bon voyage !`,
    scheduledAt: briefingTime,
  };
}

/**
 * Génère les notifications d'activités (15 min avant début, 5 min avant fin)
 */
function generateActivityNotifications(trip: Trip, now: Date): LiveNotification[] {
  const notifications: LiveNotification[] = [];
  const timeline = getTripTimeline(trip);

  for (const event of timeline) {
    if (!event.activity || event.status === 'completed') {
      continue;
    }

    // Notification 15 min avant le début
    const startTime = parseTimeToDate(event.startTime, now);
    const notificationStart = new Date(startTime.getTime() - 15 * 60 * 1000);

    if (notificationStart > now) {
      notifications.push({
        id: `activity-starting-${event.id}`,
        type: 'activity_starting',
        title: 'Activité à venir',
        body: `${event.title} commence dans 15 minutes`,
        scheduledAt: notificationStart,
        activityId: event.id,
      });
    }

    // Notification 5 min avant la fin (pour les activités longues)
    if (event.activity.duration && event.activity.duration > 30) {
      const endTime = parseTimeToDate(event.endTime, now);
      const notificationEnd = new Date(endTime.getTime() - 5 * 60 * 1000);

      if (notificationEnd > now) {
        notifications.push({
          id: `activity-ending-${event.id}`,
          type: 'activity_ending',
          title: 'Fin de l\'activité',
          body: `${event.title} se termine dans 5 minutes`,
          scheduledAt: notificationEnd,
          activityId: event.id,
        });
      }
    }
  }

  return notifications;
}

/**
 * Génère les rappels de transport (quand partir)
 */
function generateTransportReminders(trip: Trip, now: Date): LiveNotification[] {
  const notifications: LiveNotification[] = [];
  const timeline = getTripTimeline(trip);

  for (let i = 0; i < timeline.length - 1; i++) {
    const currentEvent = timeline[i];
    const nextEvent = timeline[i + 1];

    if (!currentEvent.activity || !nextEvent.activity) {
      continue;
    }

    // Si le prochain événement nécessite du transport
    const travelTime = nextEvent.activity.timeFromPrevious || 0;
    if (travelTime > 10) {
      // Seulement si >10 min de trajet
      const currentEndTime = parseTimeToDate(currentEvent.endTime, now);
      const reminderTime = new Date(currentEndTime.getTime() - 5 * 60 * 1000);

      if (reminderTime > now) {
        const transportMode = getTransportModeLabel(nextEvent.activity.transportToPrevious);
        notifications.push({
          id: `transport-reminder-${nextEvent.id}`,
          type: 'transport_reminder',
          title: 'Temps de se déplacer',
          body: `Partez dans 5 minutes vers ${nextEvent.title} (${travelTime} min ${transportMode})`,
          scheduledAt: reminderTime,
          activityId: nextEvent.id,
        });
      }
    }
  }

  return notifications;
}

/**
 * Parse une heure "HH:mm" et retourne un objet Date pour aujourd'hui
 */
function parseTimeToDate(timeStr: string, referenceDate: Date): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(referenceDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Retourne le label du mode de transport
 */
function getTransportModeLabel(mode?: string): string {
  switch (mode) {
    case 'walk':
      return 'à pied';
    case 'car':
      return 'en voiture';
    case 'public':
      return 'en transport';
    case 'taxi':
      return 'en taxi';
    default:
      return 'en transport';
  }
}

/**
 * Filtre les notifications pour les prochaines N heures
 */
export function getNotificationsInNextHours(
  notifications: LiveNotification[],
  hours: number = 24
): LiveNotification[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return notifications.filter((notif) => {
    const scheduledTime = new Date(notif.scheduledAt);
    return scheduledTime > now && scheduledTime <= cutoff;
  });
}

/**
 * Retourne la prochaine notification à venir
 */
export function getNextNotification(trip: Trip): LiveNotification | null {
  const notifications = getUpcomingNotifications(trip);
  if (notifications.length === 0) {
    return null;
  }

  const now = new Date();
  const upcoming = notifications
    .filter((n) => new Date(n.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return upcoming[0] || null;
}

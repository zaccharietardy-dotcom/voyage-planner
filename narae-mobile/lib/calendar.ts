import * as Calendar from 'expo-calendar';
import { Platform, Alert, Linking } from 'react-native';
import type { Trip, TripDay, TripItem } from '@/lib/types/trip';

const CALENDAR_NAME = 'Narae Voyage';
const CALENDAR_COLOR = '#c5a059';

async function getOrCreateCalendar(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = calendars.find((c) => c.title === CALENDAR_NAME);
  if (existing) return existing.id;

  const defaultSource =
    Platform.OS === 'ios'
      ? calendars.find((c) => c.source?.name === 'iCloud')?.source ||
        calendars.find((c) => c.source?.name === 'Default')?.source ||
        calendars[0]?.source
      : { isLocalAccount: true, name: CALENDAR_NAME, type: Calendar.SourceType.LOCAL as any };

  if (!defaultSource) throw new Error('No calendar source available');

  return Calendar.createCalendarAsync({
    title: CALENDAR_NAME,
    color: CALENDAR_COLOR,
    entityType: Calendar.EntityTypes.EVENT,
    source: defaultSource as any,
    name: CALENDAR_NAME,
    ownerAccount: 'personal',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

function buildEventDate(day: TripDay, time: string): Date {
  const dayDate = day.date instanceof Date ? day.date : new Date(day.date);
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(dayDate);
  d.setHours(hours || 9, minutes || 0, 0, 0);
  return d;
}

export async function exportTripToAppleCalendar(trip: Trip): Promise<number> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Permission requise',
      'Autorisez l\'accès au calendrier dans Réglages > Narae Voyage',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réglages', onPress: () => Linking.openSettings() },
      ],
    );
    return 0;
  }

  const calendarId = await getOrCreateCalendar();
  let count = 0;

  for (const day of trip.days || []) {
    for (const item of day.items ?? []) {
      if (item.type === 'free_time') continue;
      if (!item.startTime || !item.endTime) continue;

      try {
        await Calendar.createEventAsync(calendarId, {
          title: item.title,
          startDate: buildEventDate(day, item.startTime),
          endDate: buildEventDate(day, item.endTime),
          location: item.locationName || undefined,
          notes: [
            item.description,
            item.bookingUrl ? `Réservation: ${item.bookingUrl}` : '',
            item.googleMapsPlaceUrl ? `Maps: ${item.googleMapsPlaceUrl}` : '',
          ].filter(Boolean).join('\n'),
          timeZone: 'Europe/Paris', // TODO: detect from destination
        });
        count++;
      } catch {
        // Skip individual event errors
      }
    }
  }

  return count;
}

// Google Calendar URL generator
export function getGoogleCalendarUrl(item: TripItem, day: TripDay): string {
  const dayDate = day.date instanceof Date ? day.date : new Date(day.date);
  const [startH, startM] = (item.startTime ?? '09:00').split(':').map(Number);
  const [endH, endM] = (item.endTime ?? '10:00').split(':').map(Number);

  const start = new Date(dayDate);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(dayDate);
  end.setHours(endH, endM, 0, 0);

  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: item.locationName || '',
    details: item.description || '',
  });

  return `https://calendar.google.com/calendar/render?${params}`;
}

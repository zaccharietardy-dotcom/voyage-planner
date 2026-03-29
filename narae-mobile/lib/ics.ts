import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Trip, TripDay } from '@/lib/types/trip';

function escapeICS(str: string): string {
  return str.replace(/[\\;,\n]/g, (c) => {
    if (c === '\n') return '\\n';
    return `\\${c}`;
  });
}

function formatICSDate(day: TripDay, time: string): string {
  const d = day.date instanceof Date ? day.date : new Date(day.date);
  const [h, m] = time.split(':').map(Number);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${date}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
}

export function generateICS(trip: Trip): string {
  const destination = trip.preferences?.destination || 'Voyage';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Narae Voyage//Trip Export//FR',
    `X-WR-CALNAME:${escapeICS(destination)} — Narae Voyage`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const day of trip.days || []) {
    for (const item of day.items) {
      if (item.type === 'free_time') continue;

      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${formatICSDate(day, item.startTime)}`);
      lines.push(`DTEND:${formatICSDate(day, item.endTime)}`);
      lines.push(`SUMMARY:${escapeICS(item.title)}`);

      if (item.locationName) lines.push(`LOCATION:${escapeICS(item.locationName)}`);
      if (item.latitude && item.longitude) lines.push(`GEO:${item.latitude};${item.longitude}`);

      const descParts = [
        item.description,
        item.rating ? `Note: ${item.rating}/5` : '',
        item.estimatedCost ? `Coût estimé: ${item.estimatedCost}€` : '',
        item.bookingUrl ? `Réservation: ${item.bookingUrl}` : '',
      ].filter(Boolean);

      if (descParts.length > 0) {
        lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`);
      }

      lines.push(`UID:narae-${trip.id}-${item.id}@naraevoyage.com`);
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export async function shareICSFile(trip: Trip): Promise<void> {
  const icsContent = generateICS(trip);
  const destination = trip.preferences?.destination || 'voyage';
  const filename = `narae-${destination.replace(/\s+/g, '-').toLowerCase()}.ics`;

  const file = new File(Paths.cache, filename);
  await file.write(icsContent);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/calendar',
      UTI: 'com.apple.ical.ics',
      dialogTitle: `Exporter ${destination}`,
    });
  }
}

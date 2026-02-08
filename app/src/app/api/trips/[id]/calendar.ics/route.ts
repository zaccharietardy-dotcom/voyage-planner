import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { Trip, TripDay, TripItem } from '@/lib/types';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Timezone lookup by destination name ──────────────────────────────
const DESTINATION_TIMEZONES: Record<string, string> = {
  // Europe
  'paris': 'Europe/Paris', 'lyon': 'Europe/Paris', 'marseille': 'Europe/Paris',
  'nice': 'Europe/Paris', 'bordeaux': 'Europe/Paris', 'strasbourg': 'Europe/Paris',
  'toulouse': 'Europe/Paris', 'nantes': 'Europe/Paris', 'lille': 'Europe/Paris',
  'london': 'Europe/London', 'edinburgh': 'Europe/London', 'manchester': 'Europe/London',
  'berlin': 'Europe/Berlin', 'munich': 'Europe/Berlin', 'hamburg': 'Europe/Berlin',
  'frankfurt': 'Europe/Berlin', 'cologne': 'Europe/Berlin',
  'rome': 'Europe/Rome', 'milan': 'Europe/Rome', 'florence': 'Europe/Rome',
  'venice': 'Europe/Rome', 'naples': 'Europe/Rome',
  'madrid': 'Europe/Madrid', 'barcelona': 'Europe/Madrid', 'seville': 'Europe/Madrid',
  'valencia': 'Europe/Madrid', 'malaga': 'Europe/Madrid',
  'amsterdam': 'Europe/Amsterdam', 'rotterdam': 'Europe/Amsterdam',
  'brussels': 'Europe/Brussels', 'bruges': 'Europe/Brussels',
  'lisbon': 'Europe/Lisbon', 'porto': 'Europe/Lisbon',
  'vienna': 'Europe/Vienna', 'salzburg': 'Europe/Vienna',
  'zurich': 'Europe/Zurich', 'geneva': 'Europe/Zurich', 'bern': 'Europe/Zurich',
  'prague': 'Europe/Prague',
  'budapest': 'Europe/Budapest',
  'warsaw': 'Europe/Warsaw', 'krakow': 'Europe/Warsaw',
  'dublin': 'Europe/Dublin',
  'copenhagen': 'Europe/Copenhagen',
  'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo',
  'helsinki': 'Europe/Helsinki',
  'athens': 'Europe/Athens', 'santorini': 'Europe/Athens', 'mykonos': 'Europe/Athens',
  'istanbul': 'Europe/Istanbul',
  'bucharest': 'Europe/Bucharest',
  'moscow': 'Europe/Moscow', 'saint petersburg': 'Europe/Moscow',
  // Asia
  'tokyo': 'Asia/Tokyo', 'kyoto': 'Asia/Tokyo', 'osaka': 'Asia/Tokyo',
  'seoul': 'Asia/Seoul', 'busan': 'Asia/Seoul',
  'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong',
  'taipei': 'Asia/Taipei',
  'singapore': 'Asia/Singapore',
  'bangkok': 'Asia/Bangkok', 'chiang mai': 'Asia/Bangkok', 'phuket': 'Asia/Bangkok',
  'bali': 'Asia/Makassar', 'jakarta': 'Asia/Jakarta',
  'hanoi': 'Asia/Ho_Chi_Minh', 'ho chi minh': 'Asia/Ho_Chi_Minh',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  'dubai': 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai',
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata',
  'kathmandu': 'Asia/Kathmandu',
  // Americas
  'new york': 'America/New_York', 'boston': 'America/New_York', 'miami': 'America/New_York',
  'washington': 'America/New_York', 'philadelphia': 'America/New_York', 'atlanta': 'America/New_York',
  'chicago': 'America/Chicago', 'houston': 'America/Chicago', 'dallas': 'America/Chicago',
  'denver': 'America/Denver', 'phoenix': 'America/Phoenix',
  'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles',
  'vancouver': 'America/Vancouver', 'toronto': 'America/Toronto', 'montreal': 'America/Toronto',
  'mexico city': 'America/Mexico_City', 'cancun': 'America/Cancun',
  'havana': 'America/Havana',
  'bogota': 'America/Bogota',
  'lima': 'America/Lima',
  'santiago': 'America/Santiago',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'rio de janeiro': 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo',
  // Africa
  'marrakech': 'Africa/Casablanca', 'casablanca': 'Africa/Casablanca', 'fes': 'Africa/Casablanca',
  'cairo': 'Africa/Cairo',
  'cape town': 'Africa/Johannesburg', 'johannesburg': 'Africa/Johannesburg',
  'nairobi': 'Africa/Nairobi',
  'dakar': 'Africa/Dakar',
  'tunis': 'Africa/Tunis',
  // Oceania
  'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne',
  'brisbane': 'Australia/Brisbane', 'perth': 'Australia/Perth',
  'auckland': 'Pacific/Auckland',
  // Islands
  'reykjavik': 'Atlantic/Reykjavik',
  'tenerife': 'Atlantic/Canary', 'gran canaria': 'Atlantic/Canary',
  'mauritius': 'Indian/Mauritius',
  'maldives': 'Indian/Maldives',
};

function getTimezoneForDestination(destination: string): string {
  const key = destination.toLowerCase().trim();
  if (DESTINATION_TIMEZONES[key]) return DESTINATION_TIMEZONES[key];
  // Try partial match
  for (const [city, tz] of Object.entries(DESTINATION_TIMEZONES)) {
    if (key.includes(city) || city.includes(key)) return tz;
  }
  return 'Europe/Paris';
}

// ── VTIMEZONE templates ──────────────────────────────────────────────
// Simplified VTIMEZONE definitions for common timezone regions
const VTIMEZONE_TEMPLATES: Record<string, string> = {
  'Europe/Paris': [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Europe/London': [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/London',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:BST',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Europe/Berlin': [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'America/New_York': [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'America/Los_Angeles': [
    'BEGIN:VTIMEZONE',
    'TZID:America/Los_Angeles',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0800',
    'TZOFFSETTO:-0700',
    'TZNAME:PDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0700',
    'TZOFFSETTO:-0800',
    'TZNAME:PST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'America/Chicago': [
    'BEGIN:VTIMEZONE',
    'TZID:America/Chicago',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0600',
    'TZOFFSETTO:-0500',
    'TZNAME:CDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0600',
    'TZNAME:CST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Asia/Tokyo': [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Asia/Shanghai': [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Asia/Dubai': [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Dubai',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0400',
    'TZOFFSETTO:+0400',
    'TZNAME:GST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Asia/Kolkata': [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Kolkata',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'TZNAME:IST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Asia/Bangkok': [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Bangkok',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0700',
    'TZOFFSETTO:+0700',
    'TZNAME:ICT',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
  'Australia/Sydney': [
    'BEGIN:VTIMEZONE',
    'TZID:Australia/Sydney',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+1000',
    'TZOFFSETTO:+1100',
    'TZNAME:AEDT',
    'DTSTART:19701004T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+1100',
    'TZOFFSETTO:+1000',
    'TZNAME:AEST',
    'DTSTART:19700405T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n'),
};

// Generate a generic VTIMEZONE for timezones not in templates
function generateGenericVtimezone(tzid: string): string {
  // For unknown timezones, use X-WR-TIMEZONE and skip VTIMEZONE
  // (most modern calendar apps handle this)
  return '';
}

function getVtimezone(tzid: string): string {
  return VTIMEZONE_TEMPLATES[tzid] || generateGenericVtimezone(tzid);
}

// ── ICS helpers ──────────────────────────────────────────────────────

function escapeIcal(str: string): string {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcalDate(date: Date | string, time: string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const [h, m] = (time || '09:00').split(':');
  return `${year}${month}${day}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

function toIcalTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

// RFC 5545: Lines longer than 75 octets must be folded
function foldLine(line: string): string {
  const MAX = 75;
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= MAX) return line;

  const parts: string[] = [];
  let start = 0;
  let isFirst = true;

  while (start < bytes.length) {
    const chunkMax = isFirst ? MAX : MAX - 1; // subsequent lines have a leading space
    let end = start + chunkMax;
    if (end >= bytes.length) {
      end = bytes.length;
    } else {
      // Don't break in the middle of a multi-byte character
      while (end > start && (bytes[end] & 0xC0) === 0x80) {
        end--;
      }
    }
    const chunk = bytes.subarray(start, end).toString('utf-8');
    parts.push(isFirst ? chunk : ' ' + chunk);
    start = end;
    isFirst = false;
  }

  return parts.join('\r\n');
}

function generateIcs(trip: Trip, destination: string): string {
  const timezone = getTimezoneForDestination(destination);
  const vtimezone = getVtimezone(timezone);
  const now = new Date();

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Voyage//Trip Planner//FR',
    `X-WR-CALNAME:Voyage - ${escapeIcal(destination)}`,
    `X-WR-TIMEZONE:${timezone}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  // Add VTIMEZONE component if available
  if (vtimezone) {
    lines.push(vtimezone);
  }

  for (const day of trip.days) {
    if (!day.date) continue;

    for (const item of day.items) {
      const startTime = item.startTime || '09:00';
      const endTime = item.endTime || (item.duration
        ? formatEndTime(startTime, item.duration)
        : '10:00');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${item.id}@voyage-planner`);
      lines.push(`DTSTART;TZID=${timezone}:${toIcalDate(day.date, startTime)}`);
      lines.push(`DTEND;TZID=${timezone}:${toIcalDate(day.date, endTime)}`);
      lines.push(`SUMMARY:${escapeIcal(item.title)}`);

      if (item.description) {
        lines.push(`DESCRIPTION:${escapeIcal(item.description)}`);
      }
      if (item.locationName) {
        lines.push(`LOCATION:${escapeIcal(item.locationName)}`);
      }
      if (item.latitude && item.longitude) {
        lines.push(`GEO:${item.latitude};${item.longitude}`);
      }
      if (item.googleMapsUrl) {
        lines.push(`URL:${item.googleMapsUrl}`);
      }

      lines.push(`CATEGORIES:${item.type}`);
      lines.push(`DTSTAMP:${toIcalTimestamp(now)}`);
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');

  // Apply line folding to each line, then join with CRLF
  return lines.map(foldLine).join('\r\n');
}

// Compute endTime from startTime + duration (minutes)
function formatEndTime(startTime: string, duration: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const totalMin = h * 60 + m + duration;
  const eh = Math.floor(totalMin / 60) % 24;
  const em = totalMin % 60;
  return `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = request.nextUrl.searchParams.get('token');
    const download = request.nextUrl.searchParams.get('download') === '1';

    const sc = getServiceClient();

    // Try to get authenticated user (optional - calendar can be accessed via token)
    let userId: string | null = null;
    try {
      const supabase = await createRouteHandlerClient();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id || null;
    } catch { /* not authenticated */ }

    // Fetch trip with service client (bypasses RLS)
    const { data: trip, error } = await sc
      .from('trips')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !trip) {
      return new NextResponse('Not Found', { status: 404 });
    }

    // Access check
    let hasAccess = false;

    if (trip.visibility === 'public') {
      hasAccess = true;
    } else if (token && trip.share_code === token) {
      hasAccess = true;
    } else if (userId) {
      if (trip.owner_id === userId) {
        hasAccess = true;
      } else {
        const { data: member } = await sc
          .from('trip_members')
          .select('id')
          .eq('trip_id', id)
          .eq('user_id', userId)
          .single();
        if (member) hasAccess = true;
      }
    }

    if (!hasAccess) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const tripData = trip.data as unknown as Trip;
    const destination = trip.destination || tripData?.preferences?.destination || 'Voyage';

    const ics = generateIcs(tripData, destination);

    const headers: Record<string, string> = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    };

    if (download) {
      const filename = `voyage-${destination.replace(/\s+/g, '-').toLowerCase()}.ics`;
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    return new NextResponse(ics, { headers });
  } catch (err) {
    console.error('Calendar export error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

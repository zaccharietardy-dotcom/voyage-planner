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
  return `${year}${month}${day}T${h}${m}00`;
}

function generateIcs(trip: Trip, destination: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Voyage//Trip Planner//FR',
    `X-WR-CALNAME:Voyage - ${escapeIcal(destination)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const day of trip.days) {
    if (!day.date) continue;

    for (const item of day.items) {
      const startTime = item.startTime || '09:00';
      const endTime = item.endTime || '10:00';

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${item.id}@voyage-planner`);
      lines.push(`DTSTART:${toIcalDate(day.date, startTime)}`);
      lines.push(`DTEND:${toIcalDate(day.date, endTime)}`);
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
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
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

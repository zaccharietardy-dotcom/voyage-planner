import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function generateShareCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// POST /api/trips/past - Create a past trip (journal style)
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();
    const { destination, destinationCoords, startDate, endDate, title } = body;

    if (!destination) {
      return NextResponse.json({ error: 'Destination requise' }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: 'Date de début requise' }, { status: 400 });
    }

    const startDateStr = typeof startDate === 'string' ? startDate.split('T')[0] : new Date().toISOString().split('T')[0];
    const endDateStr = endDate
      ? (typeof endDate === 'string' ? endDate.split('T')[0] : new Date().toISOString().split('T')[0])
      : startDateStr;

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const tripName = title || `Voyage à ${destination}`;
    const shareCode = generateShareCode();

    const insertData = {
      owner_id: user.id,
      name: tripName,
      title: tripName,
      destination,
      start_date: startDateStr,
      end_date: endDateStr,
      duration_days: durationDays,
      preferences: {
        tripType: 'past',
        destination,
        destinationCoords: destinationCoords || null,
      },
      data: {},
      share_code: shareCode,
      visibility: 'private' as const,
    };

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert(insertData)
      .select()
      .single();

    if (tripError) {
      console.error('[API/trips/past] Error:', tripError);
      return NextResponse.json({ error: tripError.message }, { status: 500 });
    }

    // Add creator as owner member
    await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'owner',
    });

    // Activity log (best effort)
    try {
      await supabase.from('activity_log').insert({
        trip_id: trip.id,
        user_id: user.id,
        action: 'trip_created',
        details: { destination: trip.destination, tripType: 'past' },
      });
    } catch { /* ignore */ }

    return NextResponse.json({ ...trip, userRole: 'owner' });
  } catch (error) {
    console.error('Error creating past trip:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

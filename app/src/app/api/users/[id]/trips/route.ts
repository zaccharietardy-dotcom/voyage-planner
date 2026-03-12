import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { isAcceptedCloseFriend } from '@/lib/server/closeFriends';
import { canViewTrip } from '@/lib/server/tripAccess';

// GET /api/users/[id]/trips - Get user's visible trips
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Own trips - show all
    if (user?.id === id) {
      const { data } = await supabase
        .from('trips')
        .select('id, title, name, destination, start_date, end_date, duration_days, visibility, created_at, data, preferences')
        .eq('owner_id', id)
        .order('created_at', { ascending: false });
      return NextResponse.json(data || []);
    }

    const isCloseFriend = user
      ? await isAcceptedCloseFriend(supabase, user.id, id)
      : false;

    const { data } = await supabase
      .from('trips')
      .select('id, title, name, destination, start_date, end_date, duration_days, visibility, created_at, preferences')
      .eq('owner_id', id)
      .order('created_at', { ascending: false });

    const visibleTrips = (data || []).filter((trip) =>
      canViewTrip(user?.id ?? null, id, trip.visibility, isCloseFriend, false)
    );

    return NextResponse.json(visibleTrips);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

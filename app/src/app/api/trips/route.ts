import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/trips - Liste tous les voyages de l'utilisateur
export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Récupérer les voyages où l'utilisateur est membre
    const { data: memberTrips, error: memberError } = await supabase
      .from('trip_members')
      .select('trip_id, role')
      .eq('user_id', user.id);

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const tripIds = memberTrips?.map((m) => m.trip_id) || [];

    if (tripIds.length === 0) {
      return NextResponse.json([]);
    }

    const { data: trips, error: tripsError } = await supabase
      .from('trips')
      .select('*')
      .in('id', tripIds)
      .order('created_at', { ascending: false });

    if (tripsError) {
      return NextResponse.json({ error: tripsError.message }, { status: 500 });
    }

    // Ajouter le rôle de l'utilisateur à chaque voyage
    const tripsWithRole = trips?.map((trip) => ({
      ...trip,
      userRole: memberTrips?.find((m) => m.trip_id === trip.id)?.role,
    }));

    return NextResponse.json(tripsWithRole || []);
  } catch (error) {
    console.error('Error fetching trips:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips - Créer un nouveau voyage
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const tripData = await request.json();

    // Créer le voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({
        owner_id: user.id,
        title: tripData.title || `Voyage à ${tripData.destination || tripData.preferences?.destination || 'Destination'}`,
        destination: tripData.destination || tripData.preferences?.destination || 'Destination',
        start_date: tripData.startDate || tripData.preferences?.startDate || new Date().toISOString().split('T')[0],
        duration_days: tripData.durationDays || tripData.preferences?.durationDays || 7,
        preferences: tripData.preferences || {},
        data: tripData,
      })
      .select()
      .single();

    if (tripError) {
      console.error('Error creating trip:', tripError);
      return NextResponse.json({ error: tripError.message }, { status: 500 });
    }

    // Ajouter le créateur comme membre owner
    const { error: memberError } = await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'owner',
    });

    if (memberError) {
      console.error('Error adding member:', memberError);
      // Le voyage a été créé, on continue
    }

    // Log d'activité
    await supabase.from('activity_log').insert({
      trip_id: trip.id,
      user_id: user.id,
      action: 'trip_created',
      details: { destination: trip.destination },
    });

    return NextResponse.json({ ...trip, userRole: 'owner' });
  } catch (error) {
    console.error('Error creating trip:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

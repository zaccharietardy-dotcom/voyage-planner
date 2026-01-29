import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Générer un code de partage unique (6 caractères alphanumériques)
function generateShareCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

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

    // Diagnostic logging
    console.log('[API/trips] Saving trip for user:', user.id);
    console.log('[API/trips] TripData keys:', Object.keys(tripData));

    // Extract and validate required fields
    const destination = tripData.destination || tripData.preferences?.destination;
    const startDate = tripData.startDate || tripData.preferences?.startDate;
    const durationDays = tripData.durationDays || tripData.preferences?.durationDays;

    console.log('[API/trips] Extracted fields:', { destination, startDate, durationDays });

    if (!destination) {
      console.error('[API/trips] Missing destination');
      return NextResponse.json({ error: 'Destination requise' }, { status: 400 });
    }

    if (!startDate) {
      console.error('[API/trips] Missing startDate');
      return NextResponse.json({ error: 'Date de départ requise' }, { status: 400 });
    }

    // Générer un code de partage unique
    const shareCode = generateShareCode();

    // Preparer les donnees pour l'insertion avec validation stricte
    // Note: Supabase table has both 'name' (required) and 'title' columns
    const tripName = tripData.title || tripData.name || `Voyage à ${destination}`;
    const insertData = {
      owner_id: user.id,
      name: tripName,
      title: tripName,
      destination: destination,
      start_date: typeof startDate === 'string' ? startDate.split('T')[0] : new Date().toISOString().split('T')[0],
      duration_days: durationDays || 7,
      preferences: tripData.preferences || {},
      data: tripData || {},
      share_code: shareCode,
    };

    console.log('[API/trips] Insert data:', JSON.stringify(insertData, null, 2).substring(0, 500));

    // Créer le voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert(insertData)
      .select()
      .single();

    if (tripError) {
      console.error('[API/trips] Error creating trip:', tripError);
      console.error('[API/trips] Error details:', { code: tripError.code, details: tripError.details, hint: tripError.hint });
      return NextResponse.json({ error: tripError.message, code: tripError.code }, { status: 500 });
    }

    console.log('[API/trips] Trip created successfully:', trip.id);

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

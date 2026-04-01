import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { sendEmail } from '@/lib/email/send';
import { tripReadyEmail } from '@/lib/email/templates';

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

    const serviceClient = getServiceClient();

    // Voyages propriétaires (exclure generator_ip de la réponse)
    const { data: ownedTrips, error: ownedTripsError } = await serviceClient
      .from('trips')
      .select('id, owner_id, name, title, destination, start_date, end_date, duration_days, preferences, data, share_code, visibility, created_at, updated_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (ownedTripsError) {
      return NextResponse.json({ error: ownedTripsError.message }, { status: 500 });
    }

    const ownedTripIds = new Set((ownedTrips || []).map((trip) => trip.id));

    // Voyages où l'utilisateur est invité/membre
    const { data: memberships, error: membershipsError } = await serviceClient
      .from('trip_members')
      .select('trip_id, role, joined_at')
      .eq('user_id', user.id);

    if (membershipsError) {
      return NextResponse.json({ error: membershipsError.message }, { status: 500 });
    }

    const membershipByTripId = new Map<string, { role: string; joined_at: string }>();
    for (const membership of memberships || []) {
      if (ownedTripIds.has(membership.trip_id)) continue;
      membershipByTripId.set(membership.trip_id, {
        role: membership.role,
        joined_at: membership.joined_at,
      });
    }

    // Type partiel pour les trips sans champs sensibles
    type TripWithoutSensitive = Omit<Database['public']['Tables']['trips']['Row'], 'generator_ip' | 'cloned_from' | 'clone_count'>;
    let invitedTrips: TripWithoutSensitive[] = [];
    const invitedTripIds = Array.from(membershipByTripId.keys());
    if (invitedTripIds.length > 0) {
      const { data: invitedRows, error: invitedTripsError } = await serviceClient
        .from('trips')
        .select('id, owner_id, name, title, destination, start_date, end_date, duration_days, preferences, data, share_code, visibility, created_at, updated_at')
        .in('id', invitedTripIds);

      if (invitedTripsError) {
        return NextResponse.json({ error: invitedTripsError.message }, { status: 500 });
      }
      invitedTrips = invitedRows || [];
    }

    const tripsWithRole = [
      ...(ownedTrips || []).map((trip) => ({
        ...trip,
        userRole: 'owner',
        isInvited: false,
      })),
      ...invitedTrips.map((trip) => {
        const membership = membershipByTripId.get(trip.id);
        return {
          ...trip,
          userRole: membership?.role || 'viewer',
          isInvited: true,
          member_joined_at: membership?.joined_at || null,
        };
      }),
    ].sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });

    return NextResponse.json(tripsWithRole);
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

    // Extract and validate required fields
    const destination = tripData.destination || tripData.preferences?.destination;
    const startDate = tripData.startDate || tripData.preferences?.startDate;
    const durationDays = tripData.durationDays || tripData.preferences?.durationDays;

    if (!destination) {
      return NextResponse.json({ error: 'Destination requise' }, { status: 400 });
    }

    if (!startDate) {
      return NextResponse.json({ error: 'Date de départ requise' }, { status: 400 });
    }

    // Générer un code de partage unique
    const shareCode = generateShareCode();

    // Preparer les donnees pour l'insertion avec validation stricte
    // Note: Supabase table has both 'name' (required) and 'title' columns
    const tripName = tripData.title || tripData.name || `Voyage à ${destination}`;
    // Calculer end_date à partir de start_date + duration_days
    const startDateStr = typeof startDate === 'string' ? startDate.split('T')[0] : new Date().toISOString().split('T')[0];
    const endDateObj = new Date(startDateStr);
    endDateObj.setDate(endDateObj.getDate() + (durationDays || 7) - 1);
    const endDateStr = endDateObj.toISOString().split('T')[0];

    // Capturer l'IP pour l'anti-abus multi-comptes
    const forwarded = request.headers.get('x-forwarded-for');
    const generatorIp = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;

    const insertData = {
      owner_id: user.id,
      name: tripName,
      title: tripName,
      destination: destination,
      start_date: startDateStr,
      end_date: endDateStr,
      duration_days: durationDays || 7,
      preferences: tripData.preferences || {},
      data: tripData || {},
      share_code: shareCode,
      ...(generatorIp && { generator_ip: generatorIp }),
    };

    // Créer le voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert(insertData)
      .select()
      .single();

    if (tripError) {
      console.error('[API/trips] Error creating trip:', tripError);
      return NextResponse.json(
        { error: 'Erreur lors de la création du voyage' },
        { status: 500 }
      );
    }

    // Ajouter le créateur comme membre owner
    await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'owner',
    });

    // Log d'activité (best effort, table may not exist)
    try {
      await supabase.from('activity_log').insert({
        trip_id: trip.id,
        user_id: user.id,
        action: 'trip_created',
        details: { destination: trip.destination },
      });
    } catch (e) {
      console.error('[trips] activity_log insert failed:', e);
    }

    // Send "trip ready" email (best effort, don't block response)
    // Only send if trip has actual content (days with items)
    const userEmail = user.email;
    const hasContent = trip.days && Array.isArray(trip.days) && trip.days.length > 0 && trip.days.some((d: any) => d.items?.length > 0);
    if (userEmail && hasContent) {
      const formattedDate = new Date(startDateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      const email = tripReadyEmail(trip.id, destination, formattedDate, durationDays || 7);
      sendEmail({ to: userEmail, ...email }).catch((e) => console.error('[trips] Trip ready email failed:', e));
    }

    // Exclure generator_ip de la réponse (donnée sensible pour anti-abus)
    const { generator_ip, ...tripWithoutIp } = trip;
    return NextResponse.json({ ...tripWithoutIp, userRole: 'owner' });
  } catch (error) {
    console.error('Error creating trip:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

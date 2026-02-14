import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

interface JoinByCodeRequest {
  code: string;
}

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

// POST /api/trips/join - Join a trip using share code (viewer-only)
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json() as JoinByCodeRequest;
    const code = body.code?.trim().toUpperCase();

    if (!code) {
      return NextResponse.json({ error: 'Code de partage requis' }, { status: 400 });
    }

    const serviceClient = getServiceClient();

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('id, title, destination, owner_id')
      .eq('share_code', code)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Ce lien de partage est invalide ou a expiré.' }, { status: 404 });
    }

    if (trip.owner_id === user.id) {
      return NextResponse.json({
        status: 'already_member',
        role: 'owner',
        trip: {
          id: trip.id,
          title: trip.title,
          destination: trip.destination,
        },
      });
    }

    const { data: existingMember } = await serviceClient
      .from('trip_members')
      .select('id, role')
      .eq('trip_id', trip.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingMember) {
      return NextResponse.json({
        status: 'already_member',
        role: existingMember.role,
        trip: {
          id: trip.id,
          title: trip.title,
          destination: trip.destination,
        },
      });
    }

    const { error: joinError } = await serviceClient.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'viewer',
    });

    if (joinError) {
      if (joinError.code === '23505') {
        return NextResponse.json({
          status: 'already_member',
          role: 'viewer',
          trip: {
            id: trip.id,
            title: trip.title,
            destination: trip.destination,
          },
        });
      }

      return NextResponse.json({ error: 'Impossible de rejoindre ce voyage.' }, { status: 500 });
    }

    await serviceClient.from('activity_log').insert({
      trip_id: trip.id,
      user_id: user.id,
      action: 'member_joined',
      details: { joinMethod: 'share_link' },
    });

    return NextResponse.json({
      status: 'joined',
      role: 'viewer',
      trip: {
        id: trip.id,
        title: trip.title,
        destination: trip.destination,
      },
    });
  } catch (error) {
    console.error('Error joining by share code:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

async function verifyAccess(supabase: any, tripId: string, userId: string) {
  const { data: member } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .single();
  if (member) return member;

  const { data: trip } = await supabase
    .from('trips')
    .select('owner_id')
    .eq('id', tripId)
    .eq('owner_id', userId)
    .single();
  if (trip) return { role: 'owner' };

  return null;
}

// GET /api/trips/[id]/settlements
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    if (!await verifyAccess(supabase, id, user.id)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { data: settlements, error } = await supabase
      .from('settlements')
      .select(`
        *,
        from_user:from_user_id (display_name, avatar_url),
        to_user:to_user_id (display_name, avatar_url)
      `)
      .eq('trip_id', id)
      .order('settled_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formatted = (settlements || []).map((s: any) => ({
      id: s.id,
      tripId: s.trip_id,
      fromUserId: s.from_user_id,
      fromName: s.from_user?.display_name || 'Utilisateur',
      toUserId: s.to_user_id,
      toName: s.to_user?.display_name || 'Utilisateur',
      amount: Number(s.amount),
      settledAt: s.settled_at,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Error fetching settlements:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips/[id]/settlements
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    if (!await verifyAccess(supabase, id, user.id)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const body = await request.json();
    const { fromUserId, toUserId, amount } = body;

    if (!fromUserId || !toUserId || !amount) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    const { data: settlement, error } = await supabase
      .from('settlements')
      .insert({
        trip_id: id,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: settlement.id }, { status: 201 });
  } catch (error) {
    console.error('Error creating settlement:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

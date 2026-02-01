import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// POST /api/trips/[id]/invite - Invite a user to a trip
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifi\u00e9' }, { status: 401 });
    }

    // Check that caller is owner
    const { data: trip } = await supabase
      .from('trips')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (!trip || trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propri\u00e9taire peut inviter' }, { status: 403 });
    }

    const { user_id, role = 'editor' } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'user_id requis' }, { status: 400 });
    }

    if (!['editor', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'R\u00f4le invalide' }, { status: 400 });
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from('trip_members')
      .select('id, role')
      .eq('trip_id', id)
      .eq('user_id', user_id)
      .single();

    if (existing) {
      // Update role if different
      if (existing.role !== role && existing.role !== 'owner') {
        await supabase
          .from('trip_members')
          .update({ role })
          .eq('id', existing.id);
      }
      return NextResponse.json({ message: 'Membre mis \u00e0 jour', role });
    }

    // Insert new member
    const { error: insertError } = await supabase.from('trip_members').insert({
      trip_id: id,
      user_id,
      role,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Activity log
    await supabase.from('activity_log').insert({
      trip_id: id,
      user_id: user.id,
      action: 'member_invited',
      details: { invited_user_id: user_id, role },
    });

    return NextResponse.json({ message: 'Invitation envoy\u00e9e', role });
  } catch (error) {
    console.error('Error inviting user:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

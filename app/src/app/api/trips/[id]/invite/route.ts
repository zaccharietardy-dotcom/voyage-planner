import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { notifyTripInvite } from '@/lib/services/notifications';

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
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Check that caller is owner
    const { data: trip } = await supabase
      .from('trips')
      .select('owner_id, destination')
      .eq('id', id)
      .single();

    if (!trip || trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut inviter' }, { status: 403 });
    }

    const { user_id, role = 'editor' } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'user_id requis' }, { status: 400 });
    }

    if (!['editor', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
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
      return NextResponse.json({ message: 'Membre mis à jour', role });
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

    // Send notification
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single();
    notifyTripInvite(user.id, user_id, profile?.display_name || 'Quelqu\'un', id, trip.destination || 'un voyage').catch(console.error);

    return NextResponse.json({ message: 'Invitation envoyée', role });
  } catch (error) {
    console.error('Error inviting user:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

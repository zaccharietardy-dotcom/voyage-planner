import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { MemberRoleUpdateRequest } from '@/lib/types/collaboration';

// PATCH /api/trips/[id]/members/[memberId] - Changer le rôle d'un membre (owner only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: tripId, memberId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('owner_id')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    if (trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut modifier les rôles' }, { status: 403 });
    }

    const body = await request.json() as MemberRoleUpdateRequest;

    if (body.role !== 'editor' && body.role !== 'viewer') {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
    }

    const { data: member, error: memberError } = await supabase
      .from('trip_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('trip_id', tripId)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
    }

    if (member.role === 'owner' || member.user_id === trip.owner_id) {
      return NextResponse.json({ error: 'Impossible de modifier le rôle du propriétaire' }, { status: 400 });
    }

    if (member.role === body.role) {
      return NextResponse.json({
        id: member.id,
        userId: member.user_id,
        role: member.role,
      });
    }

    const { data: updatedMember, error: updateError } = await supabase
      .from('trip_members')
      .update({ role: body.role })
      .eq('id', memberId)
      .eq('trip_id', tripId)
      .select('id, user_id, role')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabase.from('activity_log').insert({
      trip_id: tripId,
      user_id: user.id,
      action: 'member_role_changed',
      details: { targetUserId: updatedMember.user_id, newRole: updatedMember.role },
    });

    return NextResponse.json({
      id: updatedMember.id,
      userId: updatedMember.user_id,
      role: updatedMember.role,
    });
  } catch (error) {
    console.error('Error updating member role:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// PATCH /api/close-friends/[id] - Accept or reject close friend request
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format to prevent PostgREST injection via .or()
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'ID invalide' }, { status: 400 });
    }

    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { status } = await request.json();
    if (!['accepted', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Status invalide' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('close_friends')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', id)
      .eq('target_id', user.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Demande non trouvée' }, { status: 404 });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/close-friends/[id] - Remove close friend
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format to prevent PostgREST injection via .or()
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'ID invalide' }, { status: 400 });
    }

    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Note: user.id is from Supabase auth, safe for .or()
    const { error } = await supabase
      .from('close_friends')
      .delete()
      .eq('id', id)
      .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

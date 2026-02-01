import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// POST /api/close-friends - Send close friend request
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { target_id } = await request.json();
    if (!target_id) return NextResponse.json({ error: 'target_id requis' }, { status: 400 });
    if (target_id === user.id) return NextResponse.json({ error: 'Impossible' }, { status: 400 });

    const { data, error } = await supabase
      .from('close_friends')
      .insert({ requester_id: user.id, target_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Demande déjà envoyée' }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/close-friends - List close friend requests
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'received';

    if (type === 'received') {
      const { data } = await supabase
        .from('close_friends')
        .select(`
          id, status, created_at,
          requester:requester_id (id, display_name, avatar_url, username)
        `)
        .eq('target_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return NextResponse.json(data || []);
    } else {
      // List accepted close friends
      const { data } = await supabase
        .from('close_friends')
        .select(`
          id, status, created_at,
          requester:requester_id (id, display_name, avatar_url, username),
          target:target_id (id, display_name, avatar_url, username)
        `)
        .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`)
        .eq('status', 'accepted');
      return NextResponse.json(data || []);
    }
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

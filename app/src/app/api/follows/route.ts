import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// POST /api/follows - Follow a user
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { following_id } = await request.json();
    if (!following_id) return NextResponse.json({ error: 'following_id requis' }, { status: 400 });
    if (following_id === user.id) return NextResponse.json({ error: 'Impossible de se suivre soi-même' }, { status: 400 });

    const { data, error } = await supabase
      .from('follows')
      .insert({ follower_id: user.id, following_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Déjà suivi' }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/follows?type=followers|following - List followers or following
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'following';
    const userId = searchParams.get('user_id') || user.id;

    if (type === 'followers') {
      const { data, error } = await supabase
        .from('follows')
        .select(`
          id, created_at,
          follower:follower_id (id, display_name, avatar_url, username, bio)
        `)
        .eq('following_id', userId)
        .order('created_at', { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data || []);
    } else {
      const { data, error } = await supabase
        .from('follows')
        .select(`
          id, created_at,
          following:following_id (id, display_name, avatar_url, username, bio)
        `)
        .eq('follower_id', userId)
        .order('created_at', { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data || []);
    }
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

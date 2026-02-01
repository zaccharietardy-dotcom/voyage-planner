import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/users/[id] - Get user profile with follow status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Get profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, username, bio, is_public, followers_count, following_count, trips_count, created_at')
      .eq('id', id)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: 'Utilisateur non trouvé' }, { status: 404 });
    }

    let isFollowing = false;
    let isCloseFriend = false;

    if (user && user.id !== id) {
      const { data: follow } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', id)
        .single();
      isFollowing = !!follow;

      const { data: cf } = await supabase
        .from('close_friends')
        .select('id')
        .or(`and(requester_id.eq.${user.id},target_id.eq.${id}),and(requester_id.eq.${id},target_id.eq.${user.id})`)
        .eq('status', 'accepted')
        .single();
      isCloseFriend = !!cf;
    }

    return NextResponse.json({
      ...(profile as any),
      isFollowing,
      isCloseFriend,
      isOwnProfile: user?.id === id,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

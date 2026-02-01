import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/feed?tab=following|discover&page=1&limit=20
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'discover';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    if (tab === 'following' && !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    if (tab === 'following' && user) {
      // Get IDs of users we follow
      const { data: followData } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);

      const followingIds = followData?.map(f => f.following_id) || [];
      if (followingIds.length === 0) {
        return NextResponse.json({ trips: [], hasMore: false });
      }

      // Get close friend IDs
      const { data: cfData } = await supabase
        .from('close_friends')
        .select('requester_id, target_id')
        .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`)
        .eq('status', 'accepted');

      const closeFriendIds = new Set(
        cfData?.map(cf => cf.requester_id === user.id ? cf.target_id : cf.requester_id) || []
      );

      // Fetch trips from followed users
      const { data: trips, error } = await supabase
        .from('trips')
        .select(`
          id, title, name, destination, start_date, end_date, duration_days,
          visibility, created_at, preferences, data, owner_id,
          owner:owner_id (id, display_name, avatar_url, username)
        `)
        .in('owner_id', followingIds)
        .in('visibility', ['public', 'friends'])
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Filter: show 'friends' trips only if close friend
      const filteredTrips = trips?.filter((trip: any) => {
        if (trip.visibility === 'public') return true;
        if (trip.visibility === 'friends' && closeFriendIds.has(trip.owner_id)) return true;
        return false;
      }) || [];

      // Get like counts and user likes
      const tripIds = filteredTrips.map(t => t.id);
      const { data: likes } = tripIds.length > 0
        ? await supabase.from('trip_likes').select('trip_id').in('trip_id', tripIds)
        : { data: [] };
      const { data: userLikes } = tripIds.length > 0
        ? await supabase.from('trip_likes').select('trip_id').in('trip_id', tripIds).eq('user_id', user.id)
        : { data: [] };

      const likeCounts: Record<string, number> = {};
      likes?.forEach(l => { likeCounts[l.trip_id] = (likeCounts[l.trip_id] || 0) + 1; });
      const userLikedSet = new Set(userLikes?.map(l => l.trip_id) || []);

      const enrichedTrips = filteredTrips.map(trip => ({
        ...trip,
        likes_count: likeCounts[trip.id] || 0,
        user_liked: userLikedSet.has(trip.id),
      }));

      return NextResponse.json({
        trips: enrichedTrips,
        hasMore: (trips?.length || 0) >= limit,
      });
    }

    // Discover tab - all public trips
    const { data: trips, error } = await supabase
      .from('trips')
      .select(`
        id, title, name, destination, start_date, end_date, duration_days,
        visibility, created_at, preferences,
        owner:owner_id (id, display_name, avatar_url, username)
      `)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get like counts
    const tripIds = trips?.map(t => t.id) || [];
    const { data: likes } = tripIds.length > 0
      ? await supabase.from('trip_likes').select('trip_id').in('trip_id', tripIds)
      : { data: [] };

    const likeCounts: Record<string, number> = {};
    likes?.forEach(l => { likeCounts[l.trip_id] = (likeCounts[l.trip_id] || 0) + 1; });

    let userLikedSet = new Set<string>();
    if (user && tripIds.length > 0) {
      const { data: userLikes } = await supabase
        .from('trip_likes')
        .select('trip_id')
        .in('trip_id', tripIds)
        .eq('user_id', user.id);
      userLikedSet = new Set(userLikes?.map(l => l.trip_id) || []);
    }

    const enrichedTrips = trips?.map(trip => ({
      ...trip,
      likes_count: likeCounts[trip.id] || 0,
      user_liked: userLikedSet.has(trip.id),
    })) || [];

    return NextResponse.json({
      trips: enrichedTrips,
      hasMore: (trips?.length || 0) >= limit,
    });
  } catch (error) {
    console.error('Feed error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

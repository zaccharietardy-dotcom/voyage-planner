import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getAcceptedCloseFriendIds } from '@/lib/server/closeFriends';

// Service role client to bypass RLS for reading public trips
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface FeedTripRow {
  id: string;
  title: string | null;
  name: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  visibility: 'public' | 'friends' | 'private' | null;
  created_at: string;
  preferences: unknown;
  data?: unknown;
  owner_id: string;
}

interface FeedProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
}

interface FeedPhotoRow {
  trip_id: string;
  storage_path: string | null;
}

interface FeedLikeRow {
  trip_id: string;
}

// GET /api/feed?tab=following|discover&page=1&limit=20
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'discover';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const destination = searchParams.get('destination');
    const minDays = searchParams.get('minDays');
    const maxDays = searchParams.get('maxDays');
    const sort = searchParams.get('sort') || 'recent'; // 'recent' or 'trending'

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

      const closeFriendIds = await getAcceptedCloseFriendIds(supabase, user.id);

      // Fetch trips from followed users (use service client to bypass RLS)
      let followingQuery = serviceClient
        .from('trips')
        .select('id, title, name, destination, start_date, end_date, duration_days, visibility, created_at, preferences, data, owner_id')
        .in('owner_id', followingIds)
        .in('visibility', ['public', 'friends'])
        .order('created_at', { ascending: false });

      if (destination) followingQuery = followingQuery.ilike('destination', `%${destination}%`);
      if (minDays) followingQuery = followingQuery.gte('duration_days', parseInt(minDays));
      if (maxDays) followingQuery = followingQuery.lte('duration_days', parseInt(maxDays));

      followingQuery = followingQuery.range(offset, offset + limit - 1);
      const { data: trips, error } = await followingQuery;

      if (error) {
        console.error('Feed following error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const typedTrips: FeedTripRow[] = trips || [];

      // Fetch owner profiles separately
      const fOwnerIds = [...new Set(typedTrips.map((t) => t.owner_id).filter(Boolean))];
      const fOwnerMap: Record<string, FeedProfileRow> = {};
      if (fOwnerIds.length > 0) {
        const { data: profiles } = await serviceClient
          .from('profiles')
          .select('id, display_name, avatar_url, username')
          .in('id', fOwnerIds);
        const typedProfiles: FeedProfileRow[] = profiles || [];
        typedProfiles.forEach((p) => { fOwnerMap[p.id] = p; });
      }

      // Fetch first photo for each trip (cover image)
      const fPhotoMap: Record<string, string> = {};
      const fAllTripIds = typedTrips.map((t) => t.id);
      if (fAllTripIds.length > 0) {
        const { data: photos } = await serviceClient
          .from('trip_photos')
          .select('trip_id, storage_path')
          .in('trip_id', fAllTripIds)
          .order('created_at', { ascending: true });
        const typedPhotos: FeedPhotoRow[] = photos || [];
        typedPhotos.forEach((p) => {
          if (!fPhotoMap[p.trip_id] && p.storage_path) {
            const { data: urlData } = serviceClient.storage.from('trip-photos').getPublicUrl(p.storage_path);
            fPhotoMap[p.trip_id] = urlData?.publicUrl || '';
          }
        });
      }

      // Filter: public trips for everyone, friends trips for accepted close friends only
      const filteredTrips = typedTrips.filter((trip) => {
        if (trip.visibility === 'public') return true;
        if (trip.visibility === 'friends' && closeFriendIds.has(trip.owner_id)) return true;
        return false;
      }).map((t) => ({
        ...t,
        owner: fOwnerMap[t.owner_id] || { id: t.owner_id, display_name: null, avatar_url: null, username: null },
        cover_url: fPhotoMap[t.id] || null,
      }));

      // Get like counts and user likes
      const tripIds = filteredTrips.map(t => t.id);
      const { data: likes } = tripIds.length > 0
        ? await serviceClient.from('trip_likes').select('trip_id').in('trip_id', tripIds)
        : { data: [] };
      const { data: userLikes } = tripIds.length > 0
        ? await serviceClient.from('trip_likes').select('trip_id').in('trip_id', tripIds).eq('user_id', user.id)
        : { data: [] };

      const likeCounts: Record<string, number> = {};
      (likes as FeedLikeRow[] | null)?.forEach((l) => { likeCounts[l.trip_id] = (likeCounts[l.trip_id] || 0) + 1; });
      const userLikedSet = new Set((userLikes as FeedLikeRow[] | null)?.map((l) => l.trip_id) || []);

      const enrichedTrips = filteredTrips.map(trip => ({
        ...trip,
        likes_count: likeCounts[trip.id] || 0,
        user_liked: userLikedSet.has(trip.id),
        is_following: true,
      }));

      return NextResponse.json({
        trips: enrichedTrips,
        hasMore: typedTrips.length >= limit,
      });
    }

    // Discover tab - all public trips (exclude own trips, use service client to bypass RLS)
    let discoverQuery = serviceClient
      .from('trips')
      .select('id, title, name, destination, start_date, end_date, duration_days, visibility, created_at, preferences, owner_id')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false });

    if (user) discoverQuery = discoverQuery.neq('owner_id', user.id);
    if (destination) discoverQuery = discoverQuery.ilike('destination', `%${destination}%`);
    if (minDays) discoverQuery = discoverQuery.gte('duration_days', parseInt(minDays));
    if (maxDays) discoverQuery = discoverQuery.lte('duration_days', parseInt(maxDays));

    discoverQuery = discoverQuery.range(offset, offset + limit - 1);
    const { data: trips, error } = await discoverQuery;

    if (error) {
      console.error('Feed discover error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch owner profiles separately
    const typedTrips: FeedTripRow[] = trips || [];
    const ownerIds = [...new Set(typedTrips.map((t) => t.owner_id).filter(Boolean))];
    const ownerMap: Record<string, FeedProfileRow> = {};
    if (ownerIds.length > 0) {
      const { data: profiles } = await serviceClient
        .from('profiles')
        .select('id, display_name, avatar_url, username')
        .in('id', ownerIds);
      const typedProfiles: FeedProfileRow[] = profiles || [];
      typedProfiles.forEach((p) => { ownerMap[p.id] = p; });
    }

    // Fetch first photo for each trip (cover image)
    const photoMap: Record<string, string> = {};
    const allTripIds = typedTrips.map((t) => t.id);
    if (allTripIds.length > 0) {
      const { data: photos } = await serviceClient
        .from('trip_photos')
        .select('trip_id, storage_path')
        .in('trip_id', allTripIds)
        .order('created_at', { ascending: true });
      // Keep only the first photo per trip
      const typedPhotos: FeedPhotoRow[] = photos || [];
      typedPhotos.forEach((p) => {
        if (!photoMap[p.trip_id] && p.storage_path) {
          const { data: urlData } = serviceClient.storage.from('trip-photos').getPublicUrl(p.storage_path);
          photoMap[p.trip_id] = urlData?.publicUrl || '';
        }
      });
    }

    const tripsWithOwner = typedTrips.map((t) => ({
      ...t,
      owner: ownerMap[t.owner_id] || { id: t.owner_id, display_name: null, avatar_url: null, username: null },
      cover_url: photoMap[t.id] || null,
    }));

    // Get like counts
    const tripIds = tripsWithOwner.map(t => t.id);
    const { data: likes } = tripIds.length > 0
      ? await serviceClient.from('trip_likes').select('trip_id').in('trip_id', tripIds)
      : { data: [] };

    const likeCounts: Record<string, number> = {};
    (likes as FeedLikeRow[] | null)?.forEach((l) => { likeCounts[l.trip_id] = (likeCounts[l.trip_id] || 0) + 1; });

    let userLikedSet = new Set<string>();
    let followingSet = new Set<string>();
    if (user && tripIds.length > 0) {
      const { data: userLikes } = await serviceClient
        .from('trip_likes')
        .select('trip_id')
        .in('trip_id', tripIds)
        .eq('user_id', user.id);
      userLikedSet = new Set((userLikes as FeedLikeRow[] | null)?.map((l) => l.trip_id) || []);

      if (ownerIds.length > 0) {
        const { data: follows } = await serviceClient
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id)
          .in('following_id', ownerIds);
        followingSet = new Set((follows as { following_id: string }[] | null)?.map((f) => f.following_id) || []);
      }
    }

    let enrichedTrips = tripsWithOwner.map((trip) => ({
      ...trip,
      likes_count: likeCounts[trip.id] || 0,
      user_liked: userLikedSet.has(trip.id),
      is_following: followingSet.has(trip.owner_id),
    }));

    // Sort by trending (likes weighted + recency bonus)
    if (sort === 'trending') {
      enrichedTrips = enrichedTrips.sort((a, b) => {
        const ageA = (Date.now() - new Date(a.created_at).getTime()) / 3600000;
        const ageB = (Date.now() - new Date(b.created_at).getTime()) / 3600000;
        const scoreA = (a.likes_count * 3) + (100 / (ageA + 1));
        const scoreB = (b.likes_count * 3) + (100 / (ageB + 1));
        return scoreB - scoreA;
      });
    }

    return NextResponse.json({
      trips: enrichedTrips,
      hasMore: tripsWithOwner.length >= limit,
    });
  } catch (error) {
    console.error('Feed error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const destination = searchParams.get('destination');
    const minDays = searchParams.get('minDays');
    const maxDays = searchParams.get('maxDays');

    const offset = (page - 1) * limit;

    // Build query for public trips
    let query = supabase
      .from('trips')
      .select(`
        id,
        owner_id,
        title,
        destination,
        start_date,
        duration_days,
        data,
        visibility,
        created_at,
        updated_at,
        profiles!trips_owner_id_fkey (
          id,
          display_name,
          avatar_url
        )
      `)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (destination) {
      query = query.ilike('destination', `%${destination}%`);
    }
    if (minDays) {
      query = query.gte('duration_days', parseInt(minDays));
    }
    if (maxDays) {
      query = query.lte('duration_days', parseInt(maxDays));
    }

    const { data: trips, error } = await query;

    if (error) {
      console.error('Error fetching public trips:', error);
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des voyages' },
        { status: 500 }
      );
    }

    // Get likes and comments counts for each trip
    const tripIds = trips?.map(t => t.id) || [];

    const [likesResult, commentsResult] = await Promise.all([
      supabase
        .from('trip_likes')
        .select('trip_id')
        .in('trip_id', tripIds),
      supabase
        .from('trip_comments')
        .select('trip_id')
        .in('trip_id', tripIds),
    ]);

    // Count likes and comments per trip
    const likesCountMap: Record<string, number> = {};
    const commentsCountMap: Record<string, number> = {};

    (likesResult.data || []).forEach(like => {
      likesCountMap[like.trip_id] = (likesCountMap[like.trip_id] || 0) + 1;
    });

    (commentsResult.data || []).forEach(comment => {
      commentsCountMap[comment.trip_id] = (commentsCountMap[comment.trip_id] || 0) + 1;
    });

    // Get current user's likes
    const { data: { user } } = await supabase.auth.getUser();
    let userLikes: string[] = [];

    if (user) {
      const { data: userLikesData } = await supabase
        .from('trip_likes')
        .select('trip_id')
        .eq('user_id', user.id)
        .in('trip_id', tripIds);

      userLikes = (userLikesData || []).map(l => l.trip_id);
    }

    // Format response
    const formattedTrips = trips?.map(trip => {
      // Handle duration_days - it might be in the column or in data JSON
      const tripData = trip.data as Record<string, unknown> | null;
      const durationDays = trip.duration_days ||
        (tripData?.durationDays as number) ||
        (tripData?.preferences as { durationDays?: number })?.durationDays ||
        1;

      return {
        id: trip.id,
        owner_id: trip.owner_id,
        title: trip.title || trip.destination,
        destination: trip.destination,
        start_date: trip.start_date,
        duration_days: durationDays,
        data: trip.data,
        visibility: trip.visibility,
        created_at: trip.created_at,
        updated_at: trip.updated_at,
        owner_name: (trip.profiles as { display_name?: string })?.display_name || null,
        owner_avatar: (trip.profiles as { avatar_url?: string })?.avatar_url || null,
        likes_count: likesCountMap[trip.id] || 0,
        comments_count: commentsCountMap[trip.id] || 0,
        is_liked: userLikes.includes(trip.id),
      };
    });

    return NextResponse.json({
      trips: formattedTrips,
      page,
      limit,
      hasMore: (trips?.length || 0) === limit,
    });
  } catch (error) {
    console.error('Error in GET /api/explore:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}

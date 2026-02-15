import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();

    // Get authenticated user
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch trip count (owned trips only)
    const { count: tripCount } = await supabase
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    // Fetch country count (unique destinations from trips)
    const { data: destinationTrips } = await supabase
      .from('trips')
      .select('destination')
      .eq('user_id', id);

    const uniqueCountries = new Set(
      (destinationTrips || []).map((t: { destination?: string }) => {
        // Extract country from destination string (simple heuristic)
        const parts = t.destination?.split(',') || [];
        return parts[parts.length - 1]?.trim() || t.destination;
      })
    );
    const countryCount = uniqueCountries.size;

    // Fetch follower count
    const { count: followerCount } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', id);

    // Fetch like count (total likes received on trips)
    const { data: allTrips } = await supabase
      .from('trips')
      .select('id')
      .eq('user_id', id);

    const tripIds = (allTrips || []).map((t: { id?: string }) => t.id).filter((id): id is string => !!id);
    const { count: likeCount } = tripIds.length > 0
      ? await supabase
          .from('trip_likes')
          .select('trip_id', { count: 'exact', head: true })
          .in('trip_id', tripIds)
      : { count: 0 };

    // Fetch comment count (comments written by user)
    const { count: commentCount } = await supabase
      .from('trip_comments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    // Fetch photo count (from trip_photos)
    const { count: photoCount } = await supabase
      .from('trip_photos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    // Fetch review count (placeholder - implement when review system exists)
    const reviewCount = 0;

    // Calculate XP (basic formula)
    const totalXp =
      (tripCount || 0) * 100 + // 100 XP per trip
      (followerCount || 0) * 20 + // 20 XP per follower
      (likeCount || 0) * 10 + // 10 XP per like
      (commentCount || 0) * 15 + // 15 XP per comment
      (photoCount || 0) * 5 + // 5 XP per photo
      (reviewCount || 0) * 50; // 50 XP per review

    // Calculate level
    const calculateLevel = (xp: number): number => {
      let level = 1;
      while (getXpForLevel(level + 1) <= xp) {
        level++;
      }
      return level;
    };

    const getXpForLevel = (level: number): number => {
      if (level === 1) return 0;
      return Math.floor(100 * Math.pow(level - 1, 1.5));
    };

    const level = calculateLevel(totalXp);

    // Calculate streak (simplified - last 30 days of logins)
    // In production, you'd track login dates in a separate table
    const currentStreak = 0; // Placeholder
    const longestStreak = 0; // Placeholder

    // Get earned badges (placeholder - will be stored in user_preferences.earned_badges or separate table)
    // For now, return empty array since the column doesn't exist yet
    const badges: string[] = [];

    // Get member since date
    const memberSince = profile.created_at || new Date().toISOString();

    const stats = {
      tripCount: tripCount || 0,
      countryCount,
      reviewCount,
      photoCount: photoCount || 0,
      followerCount: followerCount || 0,
      likeCount: likeCount || 0,
      commentCount: commentCount || 0,
      totalXp,
      level,
      currentStreak,
      longestStreak,
      badges,
      memberSince,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user stats' },
      { status: 500 }
    );
  }
}

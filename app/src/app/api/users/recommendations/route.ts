import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/users/recommendations?limit=5
export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '5');
    const sc = getServiceClient();

    // Get who I already follow
    const { data: myFollows } = await sc
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);
    const followingIds = new Set(myFollows?.map(f => f.following_id) || []);
    followingIds.add(user.id); // Exclude self

    // Get my destinations
    const { data: myTrips } = await sc
      .from('trips')
      .select('destination')
      .eq('owner_id', user.id);
    const myDestinations = myTrips?.map(t => t.destination?.toLowerCase()).filter(Boolean) || [];

    // Strategy 1: Users with same destinations (most relevant)
    let candidateScores: Record<string, number> = {};

    if (myDestinations.length > 0) {
      const { data: similarTrips } = await sc
        .from('trips')
        .select('owner_id, destination')
        .not('owner_id', 'in', `(${[...followingIds].join(',')})`)
        .eq('visibility', 'public');

      similarTrips?.forEach((t: any) => {
        if (followingIds.has(t.owner_id)) return;
        const dest = t.destination?.toLowerCase();
        if (myDestinations.some(d => dest?.includes(d) || d?.includes(dest))) {
          candidateScores[t.owner_id] = (candidateScores[t.owner_id] || 0) + 5;
        } else {
          candidateScores[t.owner_id] = (candidateScores[t.owner_id] || 0) + 1;
        }
      });
    }

    // Strategy 2: Friends of friends
    const followingArray = [...(myFollows?.map(f => f.following_id) || [])];
    if (followingArray.length > 0) {
      const { data: fof } = await sc
        .from('follows')
        .select('following_id')
        .in('follower_id', followingArray)
        .not('following_id', 'in', `(${[...followingIds].join(',')})`);

      fof?.forEach((f: any) => {
        if (!followingIds.has(f.following_id)) {
          candidateScores[f.following_id] = (candidateScores[f.following_id] || 0) + 3;
        }
      });
    }

    // Strategy 3: Popular users (fallback)
    const { data: popularUsers } = await sc
      .from('profiles')
      .select('id, followers_count')
      .not('id', 'in', `(${[...followingIds].join(',')})`)
      .order('followers_count', { ascending: false })
      .limit(20);

    popularUsers?.forEach((p: any) => {
      if (!followingIds.has(p.id)) {
        candidateScores[p.id] = (candidateScores[p.id] || 0) + Math.min(p.followers_count || 0, 10);
      }
    });

    // Sort by score and take top N
    const topIds = Object.entries(candidateScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    if (topIds.length === 0) return NextResponse.json([]);

    // Fetch profiles
    const { data: profiles } = await sc
      .from('profiles')
      .select('id, display_name, avatar_url, username, bio')
      .in('id', topIds);

    // Get trip count for each
    const recommended = await Promise.all((profiles || []).map(async (p: any) => {
      const { count } = await sc
        .from('trips')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', p.id)
        .eq('visibility', 'public');

      return {
        ...p,
        trips_count: count || 0,
        score: candidateScores[p.id] || 0,
      };
    }));

    // Sort by score
    recommended.sort((a, b) => b.score - a.score);

    return NextResponse.json(recommended);
  } catch (error) {
    console.error('Recommendations error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

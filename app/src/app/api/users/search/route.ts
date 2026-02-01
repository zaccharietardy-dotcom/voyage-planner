import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const query = request.nextUrl.searchParams.get('q');
  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  const searchTerm = `%${query}%`;

  const { data: profiles, error } = await (supabase
    .from('profiles') as any)
    .select('id, display_name, avatar_url, username, bio')
    .or(`display_name.ilike.${searchTerm},username.ilike.${searchTerm}`)
    .neq('id', user?.id || '')
    .limit(20) as { data: any[] | null; error: any };

  if (error) {
    console.error('Search error:', error);
    return NextResponse.json([]);
  }

  // Enrich with follow status if user is authenticated
  if (user && profiles && profiles.length > 0) {
    const profileIds = profiles.map(p => p.id);
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id)
      .in('following_id', profileIds);

    const followingSet = new Set(follows?.map(f => f.following_id) || []);

    const enriched = profiles.map(p => ({
      ...p,
      isFollowing: followingSet.has(p.id),
    }));

    return NextResponse.json(enriched);
  }

  return NextResponse.json(profiles?.map(p => ({ ...p, isFollowing: false })) || []);
}

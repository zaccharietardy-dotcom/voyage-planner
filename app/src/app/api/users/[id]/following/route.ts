import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/users/[id]/following - List users that [id] follows
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const sc = getServiceClient();

    // Get who this user follows
    const { data: follows } = await sc
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (!follows || follows.length === 0) return NextResponse.json([]);

    const followingIds = follows.map(f => f.following_id);

    // Get their profiles
    const { data: profiles } = await sc
      .from('profiles')
      .select('id, display_name, avatar_url, username')
      .in('id', followingIds);

    return NextResponse.json(profiles || []);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

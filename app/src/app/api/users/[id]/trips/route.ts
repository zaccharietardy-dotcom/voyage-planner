import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/users/[id]/trips - Get user's visible trips
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Own trips - show all
    if (user?.id === id) {
      const { data } = await supabase
        .from('trips')
        .select('id, title, name, destination, start_date, end_date, duration_days, visibility, created_at, data, preferences')
        .eq('owner_id', id)
        .order('created_at', { ascending: false });
      return NextResponse.json(data || []);
    }

    // Check if follower (following this user)
    let isFollowing = false;
    if (user) {
      const { data: follow } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', id)
        .single();
      isFollowing = !!follow;
    }

    // Build visibility filter - followers can see 'friends' trips
    const visibilities: ('public' | 'friends' | 'private')[] = ['public'];
    if (isFollowing) visibilities.push('friends');

    const { data } = await supabase
      .from('trips')
      .select('id, title, name, destination, start_date, end_date, duration_days, visibility, created_at, preferences')
      .eq('owner_id', id)
      .in('visibility', visibilities)
      .order('created_at', { ascending: false });

    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

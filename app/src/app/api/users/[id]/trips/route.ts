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

    // Check if close friend
    let isCloseFriend = false;
    if (user) {
      const { data: cf } = await supabase
        .from('close_friends')
        .select('id')
        .or(`and(requester_id.eq.${user.id},target_id.eq.${id}),and(requester_id.eq.${id},target_id.eq.${user.id})`)
        .eq('status', 'accepted')
        .single();
      isCloseFriend = !!cf;
    }

    // Build visibility filter
    const visibilities: ('public' | 'friends' | 'private')[] = ['public'];
    if (isCloseFriend) visibilities.push('friends');

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

import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await params;
  const supabase = await createRouteHandlerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: votes, error } = await supabase
    .from('activity_votes')
    .select('*')
    .eq('trip_id', tripId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ votes: votes || [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await params;
  const supabase = await createRouteHandlerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { itemId, vote } = body; // vote: 'want' | 'skip' | null (to remove vote)

  if (!itemId) return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });

  if (vote === null) {
    // Remove vote
    await supabase
      .from('activity_votes')
      .delete()
      .eq('trip_id', tripId)
      .eq('item_id', itemId)
      .eq('user_id', user.id);
  } else {
    // Upsert vote
    const { error } = await supabase
      .from('activity_votes')
      .upsert({
        trip_id: tripId,
        item_id: itemId,
        user_id: user.id,
        vote,
      }, { onConflict: 'trip_id,item_id,user_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return updated counts
  const { data: votes } = await supabase
    .from('activity_votes')
    .select('*')
    .eq('trip_id', tripId)
    .eq('item_id', itemId);

  return NextResponse.json({
    itemId,
    wantCount: (votes || []).filter(v => v.vote === 'want').length,
    skipCount: (votes || []).filter(v => v.vote === 'skip').length,
    userVote: vote,
  });
}

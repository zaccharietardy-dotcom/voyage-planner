import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

// Toggle like on a trip
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      );
    }

    // Check if trip exists and is public
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, visibility')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: 'Voyage non trouvé' },
        { status: 404 }
      );
    }

    if (trip.visibility !== 'public') {
      return NextResponse.json(
        { error: 'Ce voyage n\'est pas public' },
        { status: 403 }
      );
    }

    // Check if already liked
    const { data: existingLike } = await supabase
      .from('trip_likes')
      .select('id')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .single();

    if (existingLike) {
      // Unlike
      const { error: deleteError } = await supabase
        .from('trip_likes')
        .delete()
        .eq('id', existingLike.id);

      if (deleteError) {
        console.error('Error unliking:', deleteError);
        return NextResponse.json(
          { error: 'Erreur lors du retrait du like' },
          { status: 500 }
        );
      }

      return NextResponse.json({ liked: false });
    } else {
      // Like
      const { error: insertError } = await supabase
        .from('trip_likes')
        .insert({
          trip_id: tripId,
          user_id: user.id,
        });

      if (insertError) {
        console.error('Error liking:', insertError);
        return NextResponse.json(
          { error: 'Erreur lors de l\'ajout du like' },
          { status: 500 }
        );
      }

      return NextResponse.json({ liked: true });
    }
  } catch (error) {
    console.error('Error in POST /api/trips/[id]/like:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}

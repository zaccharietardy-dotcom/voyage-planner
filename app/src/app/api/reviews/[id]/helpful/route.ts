import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/reviews/[id]/helpful - Mark review as helpful
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: reviewId } = await params;
    const supabase = await createRouteHandlerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const serviceClient = getServiceClient();

    // Check if review exists
    const { data: review, error: reviewError } = await serviceClient
      .from('place_reviews')
      .select('id, helpful_count')
      .eq('id', reviewId)
      .maybeSingle();

    if (reviewError || !review) {
      return NextResponse.json({ error: 'Avis non trouvé' }, { status: 404 });
    }

    // Check if user already marked as helpful
    const { data: existing } = await serviceClient
      .from('review_helpful')
      .select('id')
      .eq('review_id', reviewId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      // Toggle off - remove helpful vote
      await serviceClient
        .from('review_helpful')
        .delete()
        .eq('id', existing.id);

      await serviceClient
        .from('place_reviews')
        .update({ helpful_count: Math.max(0, review.helpful_count - 1) })
        .eq('id', reviewId);

      return NextResponse.json({ helpful: false, count: Math.max(0, review.helpful_count - 1) });
    } else {
      // Add helpful vote
      await serviceClient
        .from('review_helpful')
        .insert({ review_id: reviewId, user_id: user.id });

      await serviceClient
        .from('place_reviews')
        .update({ helpful_count: review.helpful_count + 1 })
        .eq('id', reviewId);

      return NextResponse.json({ helpful: true, count: review.helpful_count + 1 });
    }
  } catch (error) {
    console.error('Error in POST /api/reviews/[id]/helpful:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

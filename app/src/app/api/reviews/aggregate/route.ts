import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ReviewRow {
  rating: number;
  title: string;
  content: string;
  helpful_count: number;
  created_at: string;
}

// GET /api/reviews/aggregate?placeId=xxx - Get aggregate stats for a place
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get('placeId');

    if (!placeId) {
      return NextResponse.json({ error: 'placeId required' }, { status: 400 });
    }

    const serviceClient = getServiceClient();

    const { data: reviews, error } = await serviceClient
      .from('place_reviews')
      .select('rating, title, content, helpful_count, created_at')
      .eq('place_id', placeId);

    if (error) {
      console.error('Error fetching reviews aggregate:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const typedReviews: ReviewRow[] = reviews || [];

    if (typedReviews.length === 0) {
      return NextResponse.json({
        placeId,
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        topReview: null,
      });
    }

    // Calculate average
    const totalRating = typedReviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalRating / typedReviews.length;

    // Rating distribution
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    typedReviews.forEach((r) => {
      ratingDistribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
    });

    // Top review (most helpful)
    const sorted = [...typedReviews].sort((a, b) => b.helpful_count - a.helpful_count);
    const topReview = sorted[0]
      ? {
          title: sorted[0].title,
          content: sorted[0].content.slice(0, 150) + '...',
          rating: sorted[0].rating,
          helpfulCount: sorted[0].helpful_count,
        }
      : null;

    return NextResponse.json({
      placeId,
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews: typedReviews.length,
      ratingDistribution,
      topReview,
    });
  } catch (error) {
    console.error('Error in GET /api/reviews/aggregate:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

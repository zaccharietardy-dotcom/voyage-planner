import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ReviewRow {
  id: string;
  user_id: string;
  place_id: string;
  trip_id: string | null;
  activity_title: string;
  city: string;
  rating: number;
  title: string;
  content: string;
  tips: string | null;
  photos: string[] | null;
  visit_date: string | null;
  helpful_count: number;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

function normalizePlace(activityTitle: string, city: string): string {
  // Normalize to create a consistent place_id from activity title + city
  const normalized = `${activityTitle}-${city}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '') // Keep only alphanumeric, spaces, hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .trim();
  return normalized;
}

// GET /api/reviews - Fetch reviews for a place, city, or user
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get('placeId');
    const city = searchParams.get('city');
    const userId = searchParams.get('userId');
    const sortBy = searchParams.get('sortBy') || 'recent'; // recent, helpful, rating_high, rating_low
    const rating = searchParams.get('rating'); // Filter by rating (1-5)

    const serviceClient = getServiceClient();

    // Build query
    let query = serviceClient
      .from('place_reviews')
      .select('*')
      .order('created_at', { ascending: false });

    if (placeId) {
      query = query.eq('place_id', placeId);
    } else if (city) {
      query = query.eq('city', city);
    } else if (userId) {
      query = query.eq('user_id', userId);
    } else {
      return NextResponse.json({ error: 'placeId, city, or userId required' }, { status: 400 });
    }

    if (rating) {
      const ratingNum = parseInt(rating);
      if (ratingNum >= 1 && ratingNum <= 5) {
        query = query.eq('rating', ratingNum);
      }
    }

    // Apply sorting
    if (sortBy === 'helpful') {
      query = query.order('helpful_count', { ascending: false });
    } else if (sortBy === 'rating_high') {
      query = query.order('rating', { ascending: false });
    } else if (sortBy === 'rating_low') {
      query = query.order('rating', { ascending: true });
    }

    const { data: reviews, error } = await query;

    if (error) {
      console.error('Error fetching reviews:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch profiles for all review authors
    const typedReviews: ReviewRow[] = reviews || [];
    const userIds = [...new Set(typedReviews.map((r) => r.user_id))];
    const profileMap: Record<string, ProfileRow> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await serviceClient
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds);
      (profiles as ProfileRow[] | null)?.forEach((p) => {
        profileMap[p.id] = p;
      });
    }

    // Enrich reviews with author data
    const enriched = typedReviews.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: profileMap[r.user_id]?.display_name || 'Voyageur',
      userAvatar: profileMap[r.user_id]?.avatar_url || null,
      placeId: r.place_id,
      tripId: r.trip_id,
      activityTitle: r.activity_title,
      city: r.city,
      rating: r.rating,
      title: r.title,
      content: r.content,
      tips: r.tips,
      photos: r.photos,
      visitDate: r.visit_date,
      helpfulCount: r.helpful_count,
      createdAt: r.created_at,
      isVerifiedVisit: !!r.trip_id,
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Error in GET /api/reviews:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/reviews - Create a new review
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();
    const {
      placeId,
      tripId,
      activityTitle,
      city,
      rating,
      title,
      content,
      photos,
      visitDate,
      tips,
    } = body;

    // Validation
    if (!activityTitle || !city || !rating || !title || !content) {
      return NextResponse.json(
        { error: 'activityTitle, city, rating, title, and content are required' },
        { status: 400 }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'rating must be between 1 and 5' }, { status: 400 });
    }

    if (content.length < 50) {
      return NextResponse.json({ error: 'Le contenu doit faire au moins 50 caractères' }, { status: 400 });
    }

    const serviceClient = getServiceClient();

    // Generate normalized place_id if not provided
    const finalPlaceId = placeId || normalizePlace(activityTitle, city);

    // Check if user already reviewed this place
    const { data: existing } = await serviceClient
      .from('place_reviews')
      .select('id')
      .eq('user_id', user.id)
      .eq('place_id', finalPlaceId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'Vous avez déjà laissé un avis pour ce lieu' },
        { status: 409 }
      );
    }

    let verifiedTripId: string | null = null;
    if (tripId) {
      const { data: trip } = await serviceClient
        .from('trips')
        .select('id, owner_id')
        .eq('id', tripId)
        .maybeSingle();

      if (!trip) {
        return NextResponse.json(
          { error: 'tripId invalide ou non accessible' },
          { status: 403 }
        );
      }

      const isOwner = trip.owner_id === user.id;
      if (!isOwner) {
        const { data: member } = await serviceClient
          .from('trip_members')
          .select('id')
          .eq('trip_id', tripId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!member) {
          return NextResponse.json(
            { error: 'tripId invalide ou non accessible' },
            { status: 403 }
          );
        }
      }

      verifiedTripId = tripId;
    }

    // Create review
    const { data: review, error } = await serviceClient
      .from('place_reviews')
      .insert({
        user_id: user.id,
        place_id: finalPlaceId,
        trip_id: verifiedTripId,
        activity_title: activityTitle,
        city,
        rating,
        title: title.trim(),
        content: content.trim(),
        tips: tips?.trim() || null,
        photos: photos || null,
        visit_date: visitDate || null,
        helpful_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating review:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get author profile
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', user.id)
      .single();

    return NextResponse.json({
      ...review,
      userName: profile?.display_name || 'Voyageur',
      userAvatar: profile?.avatar_url || null,
      isVerifiedVisit: !!verifiedTripId,
    });
  } catch (error) {
    console.error('Error in POST /api/reviews:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

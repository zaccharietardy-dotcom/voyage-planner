import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { notifyComment, notifyReply } from '@/lib/services/notifications';
import { isAcceptedCloseFriend } from '@/lib/server/closeFriends';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface TripAccessRow {
  id: string;
  owner_id: string;
  destination: string | null;
  visibility: 'public' | 'friends' | 'private' | null;
}

interface CommentRow {
  id: string;
  trip_id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
}

async function canAccessTripComments(
  trip: TripAccessRow,
  userId: string | null,
  supabase: Awaited<ReturnType<typeof createRouteHandlerClient>>,
  serviceClient: ReturnType<typeof getServiceClient>
): Promise<boolean> {
  if (trip.visibility === 'public') return true;
  if (!userId) return false;
  if (trip.owner_id === userId) return true;

  const { data: member } = await serviceClient
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (member) return true;

  if (trip.visibility === 'friends') {
    return isAcceptedCloseFriend(supabase, userId, trip.owner_id);
  }

  return false;
}

// GET /api/trips/[id]/comments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const serviceClient = getServiceClient();

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('id, owner_id, destination, visibility')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const hasAccess = await canAccessTripComments(trip as TripAccessRow, user?.id || null, supabase, serviceClient);
    if (!hasAccess) {
      return NextResponse.json(
        { error: user ? 'Accès refusé' : 'Non authentifié' },
        { status: user ? 403 : 401 }
      );
    }

    const { data: comments, error } = await serviceClient
      .from('trip_comments')
      .select('id, trip_id, user_id, content, parent_id, created_at, updated_at')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch profiles for all comment authors
    const typedComments: CommentRow[] = comments || [];
    const userIds = [...new Set(typedComments.map((c) => c.user_id))];
    const profileMap: Record<string, ProfileRow> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await serviceClient
        .from('profiles')
        .select('id, display_name, avatar_url, username')
        .in('id', userIds);
      (profiles as ProfileRow[] | null)?.forEach((p) => { profileMap[p.id] = p; });
    }

    const enriched = typedComments.map((c) => ({
      ...c,
      author: profileMap[c.user_id] || { id: c.user_id, display_name: null, avatar_url: null, username: null },
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips/[id]/comments
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { content, parent_id } = await request.json();
    if (!content?.trim()) return NextResponse.json({ error: 'Contenu requis' }, { status: 400 });

    const serviceClient = getServiceClient();

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('id, owner_id, destination, visibility')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const canComment = await canAccessTripComments(trip as TripAccessRow, user.id, supabase, serviceClient);
    if (!canComment) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    if (parent_id) {
      const { data: parentComment, error: parentError } = await serviceClient
        .from('trip_comments')
        .select('id')
        .eq('id', parent_id)
        .eq('trip_id', tripId)
        .maybeSingle();

      if (parentError || !parentComment) {
        return NextResponse.json({ error: 'Commentaire parent invalide' }, { status: 400 });
      }
    }

    const { data: comment, error } = await serviceClient
      .from('trip_comments')
      .insert({
        trip_id: tripId,
        user_id: user.id,
        content: content.trim(),
        parent_id: parent_id || null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get commenter name and trip info for notifications
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single();

    const commenterName = profile?.display_name || 'Quelqu\'un';

    // Notify trip owner
    if (trip?.owner_id && !parent_id) {
      notifyComment(user.id, trip.owner_id, commenterName, tripId, trip.destination || '').catch(console.error);
    }

    // Notify parent comment author (for replies)
    if (parent_id) {
      const { data: parentComment } = await serviceClient
        .from('trip_comments')
        .select('user_id')
        .eq('id', parent_id)
        .single();
      if (parentComment?.user_id) {
        notifyReply(user.id, parentComment.user_id, commenterName, tripId).catch(console.error);
      }
    }

    return NextResponse.json({
      ...comment,
      author: { id: user.id, display_name: profile?.display_name, avatar_url: null, username: null },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

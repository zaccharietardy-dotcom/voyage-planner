import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/trips/[id]/photos - List trip photos
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check trip access
    const { data: trip } = await supabase
      .from('trips')
      .select('id, owner_id, visibility')
      .eq('id', id)
      .single();

    if (!trip) return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });

    const isMember = user ? await checkMembership(supabase, id, user.id) : false;
    const isOwner = user?.id === trip.owner_id;

    // If private and not a member, deny
    if (trip.visibility === 'private' && !isMember) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    let query = supabase
      .from('trip_photos')
      .select('*')
      .eq('trip_id', id)
      .order('day_number', { ascending: true })
      .order('created_at', { ascending: true });

    // Non-members only see public photos
    if (!isMember) {
      query = query.eq('visibility', 'public');
    }

    const { data: photos, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(photos || []);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips/[id]/photos - Upload photo metadata (file uploaded to Supabase Storage separately)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const isMember = await checkMembership(supabase, id, user.id);
    if (!isMember) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const body = await request.json();

    const { data, error } = await supabase
      .from('trip_photos')
      .insert({
        trip_id: id,
        user_id: user.id,
        storage_path: body.storage_path,
        thumbnail_path: body.thumbnail_path,
        caption: body.caption,
        latitude: body.latitude,
        longitude: body.longitude,
        location_name: body.location_name,
        day_number: body.day_number,
        visibility: body.visibility || 'public',
        media_type: body.media_type || 'image',
        width: body.width,
        height: body.height,
        file_size: body.file_size,
        taken_at: body.taken_at,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

async function checkMembership(supabase: any, tripId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('trip_members')
    .select('id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .single();
  return !!data;
}

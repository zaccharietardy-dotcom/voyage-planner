import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Admin client for storage operations (bypasses RLS)
function getStorageClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Ensure bucket exists
async function ensureBucket(admin: any) {
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b: any) => b.name === 'trip-photos');
  if (!exists) {
    await admin.storage.createBucket('trip-photos', {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/*', 'video/*'],
    });
  }
}

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

// POST /api/trips/[id]/photos - Upload photo file + metadata
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

    const contentType = request.headers.get('content-type') || '';

    // Handle FormData (file upload)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'Fichier requis' }, { status: 400 });
      }

      const admin = getStorageClient();
      await ensureBucket(admin);

      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `${id}/${Date.now()}.${ext}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await admin.storage
        .from('trip-photos')
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('[Photos] Storage upload error:', uploadError);
        return NextResponse.json({ error: 'Erreur upload: ' + uploadError.message }, { status: 500 });
      }

      // Insert metadata
      const caption = formData.get('caption') as string || '';
      const visibility = ((formData.get('visibility') as string) || 'public') as 'public' | 'private';
      const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null;
      const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null;
      const locationName = formData.get('location_name') as string || null;
      const dayNumber = formData.get('day_number') ? parseInt(formData.get('day_number') as string) : null;
      const mediaType: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';

      const { data, error } = await supabase
        .from('trip_photos')
        .insert({
          trip_id: id,
          user_id: user.id,
          storage_path: storagePath,
          caption,
          latitude,
          longitude,
          location_name: locationName,
          day_number: dayNumber,
          visibility,
          media_type: mediaType,
          file_size: file.size,
        })
        .select()
        .single();

      if (error) {
        console.error('[Photos] DB insert error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json(data);
    }

    // Handle JSON (legacy: metadata only, file already uploaded)
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
    console.error('[Photos] Error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

async function checkMembership(supabase: any, tripId: string, userId: string): Promise<boolean> {
  // Check trip_members
  const { data: member } = await supabase
    .from('trip_members')
    .select('id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .single();
  if (member) return true;

  // Also check if user is the trip owner
  const { data: trip } = await supabase
    .from('trips')
    .select('owner_id')
    .eq('id', tripId)
    .single();
  return trip?.owner_id === userId;
}

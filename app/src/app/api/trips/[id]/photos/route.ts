import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isAcceptedCloseFriend } from '@/lib/server/closeFriends';
import { signManyObjectUrls } from '@/lib/server/mediaUrl';
import { canEditTrip, canViewTrip } from '@/lib/server/tripAccess';
import type { Database } from '@/lib/supabase/types';
import type { MemberRole } from '@/lib/types/collaboration';

type TripVisibility = 'public' | 'friends' | 'private' | null;
type TripPhotoRow = Database['public']['Tables']['trip_photos']['Row'];

// Admin client for storage + DB operations (bypasses RLS)
function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Ensure bucket exists in private mode
async function ensureBucket(serviceClient: ReturnType<typeof getServiceClient>) {
  const { data: buckets } = await serviceClient.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === 'trip-photos');
  if (!exists) {
    await serviceClient.storage.createBucket('trip-photos', {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/*', 'video/*'],
    });
  }
}

async function getMemberRole(
  serviceClient: ReturnType<typeof getServiceClient>,
  tripId: string,
  userId: string
): Promise<MemberRole | null> {
  const { data: member } = await serviceClient
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!member) return null;
  if (member.role === 'owner' || member.role === 'editor' || member.role === 'viewer') {
    return member.role;
  }
  return null;
}

function withSignedPhotoFields(photo: TripPhotoRow, signedMap: Record<string, { signedUrl: string; expiresAt: string }>) {
  const signedOriginal = photo.storage_path ? signedMap[photo.storage_path] : null;
  const signedThumb = photo.thumbnail_path ? signedMap[photo.thumbnail_path] : null;

  return {
    ...photo,
    signed_url: signedOriginal?.signedUrl || null,
    signed_thumbnail_url: signedThumb?.signedUrl || signedOriginal?.signedUrl || null,
    url_expires_at: signedOriginal?.expiresAt || signedThumb?.expiresAt || null,
  };
}

// GET /api/trips/[id]/photos - List trip photos
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check trip access
    const { data: trip } = await serviceClient
      .from('trips')
      .select('id, owner_id, visibility')
      .eq('id', id)
      .maybeSingle();

    if (!trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const isOwner = Boolean(user && trip.owner_id === user.id);
    const memberRole = user && !isOwner
      ? await getMemberRole(serviceClient, id, user.id)
      : null;
    const isMember = isOwner || Boolean(memberRole);

    const isCloseFriend = user && !isMember && trip.visibility === 'friends'
      ? await isAcceptedCloseFriend(supabase, user.id, trip.owner_id)
      : false;

    const canRead = canViewTrip(
      user?.id ?? null,
      trip.owner_id,
      trip.visibility as TripVisibility,
      isCloseFriend,
      isMember
    );

    if (!canRead) {
      return NextResponse.json(
        { error: user ? 'Accès refusé' : 'Non authentifié' },
        { status: user ? 403 : 401 }
      );
    }

    let query = serviceClient
      .from('trip_photos')
      .select('*')
      .eq('trip_id', id)
      .order('day_number', { ascending: true })
      .order('created_at', { ascending: true });

    // Non-members and non-owners see only public photos.
    if (!isMember) {
      query = query.eq('visibility', 'public');
    }

    const { data: photos, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const typedPhotos: TripPhotoRow[] = photos || [];
    const signedMap = await signManyObjectUrls(
      'trip-photos',
      typedPhotos.flatMap((photo) => [photo.storage_path, photo.thumbnail_path])
    );

    return NextResponse.json(typedPhotos.map((photo) => withSignedPhotoFields(photo, signedMap)));
  } catch (error) {
    console.error('[Photos] GET error:', error);
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
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { data: trip } = await serviceClient
      .from('trips')
      .select('id, owner_id')
      .eq('id', id)
      .maybeSingle();

    if (!trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const isOwner = trip.owner_id === user.id;
    const memberRole = isOwner
      ? 'owner'
      : await getMemberRole(serviceClient, id, user.id);

    if (!canEditTrip(memberRole)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';

    // Handle FormData (file upload)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'Fichier requis' }, { status: 400 });
      }

      await ensureBucket(serviceClient);

      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await serviceClient.storage
        .from('trip-photos')
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('[Photos] Storage upload error:', uploadError);
        return NextResponse.json({ error: `Erreur upload: ${uploadError.message}` }, { status: 500 });
      }

      // Insert metadata
      const caption = (formData.get('caption') as string) || '';
      const visibility = ((formData.get('visibility') as string) || 'public') as 'public' | 'private';
      const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null;
      const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null;
      const locationName = (formData.get('location_name') as string) || null;
      const dayNumber = formData.get('day_number') ? parseInt(formData.get('day_number') as string, 10) : null;
      const mediaType: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';

      const { data, error } = await serviceClient
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

      if (error || !data) {
        console.error('[Photos] DB insert error:', error);
        return NextResponse.json({ error: error?.message || 'Erreur base de données' }, { status: 500 });
      }

      const signedMap = await signManyObjectUrls('trip-photos', [data.storage_path, data.thumbnail_path]);
      return NextResponse.json(withSignedPhotoFields(data, signedMap));
    }

    // Handle JSON (legacy: metadata only, file already uploaded)
    const body = await request.json() as {
      storage_path?: string;
      thumbnail_path?: string | null;
      caption?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      location_name?: string | null;
      day_number?: number | null;
      visibility?: 'public' | 'private';
      media_type?: 'image' | 'video';
      width?: number | null;
      height?: number | null;
      file_size?: number | null;
      taken_at?: string | null;
    };

    if (!body.storage_path) {
      return NextResponse.json({ error: 'storage_path requis' }, { status: 400 });
    }

    const { data, error } = await serviceClient
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

    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'Erreur base de données' }, { status: 500 });
    }

    const signedMap = await signManyObjectUrls('trip-photos', [data.storage_path, data.thumbnail_path]);
    return NextResponse.json(withSignedPhotoFields(data, signedMap));
  } catch (error) {
    console.error('[Photos] Error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

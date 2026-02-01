import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// PATCH /api/trips/[id]/photos/[photoId] - Update photo
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  try {
    const { id, photoId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await request.json();
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.caption !== undefined) updates.caption = body.caption;
    if (body.visibility !== undefined) updates.visibility = body.visibility;
    if (body.location_name !== undefined) updates.location_name = body.location_name;
    if (body.latitude !== undefined) updates.latitude = body.latitude;
    if (body.longitude !== undefined) updates.longitude = body.longitude;

    const { data, error } = await supabase
      .from('trip_photos')
      .update(updates)
      .eq('id', photoId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Photo non trouvée' }, { status: 404 });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/trips/[id]/photos/[photoId] - Delete photo
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  try {
    const { id, photoId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Get photo to delete from storage
    const { data: photo } = await supabase
      .from('trip_photos')
      .select('storage_path, thumbnail_path')
      .eq('id', photoId)
      .eq('user_id', user.id)
      .single();

    if (!photo) return NextResponse.json({ error: 'Photo non trouvée' }, { status: 404 });

    // Delete from storage
    const paths = [photo.storage_path, photo.thumbnail_path].filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabase.storage.from('trip-photos').remove(paths);
    }

    // Delete record
    const { error } = await supabase
      .from('trip_photos')
      .delete()
      .eq('id', photoId)
      .eq('user_id', user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

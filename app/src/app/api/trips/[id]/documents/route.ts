import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'text/plain',
];

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

// GET /api/trips/[id]/documents - List documents
export async function GET(
  _request: Request,
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

    // Check access
    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id, data')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Check if user is owner or member
    const isOwner = trip.owner_id === user.id;
    if (!isOwner) {
      const { data: member } = await serviceClient
        .from('trip_members')
        .select('role')
        .eq('trip_id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!member) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
      }
    }

    const tripData = trip.data as any;
    const documents = tripData?.documents?.items || [];

    return NextResponse.json({ documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips/[id]/documents - Upload document
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

    // Check access
    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id, data')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Only owner or editors can upload
    const isOwner = trip.owner_id === user.id;
    if (!isOwner) {
      const { data: member } = await serviceClient
        .from('trip_members')
        .select('role')
        .eq('trip_id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!member || member.role === 'viewer') {
        return NextResponse.json({ error: 'Seuls les propriétaires et éditeurs peuvent ajouter des documents' }, { status: 403 });
      }
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const documentType = formData.get('type') as string;
    const notes = formData.get('notes') as string | null;
    const linkedActivityId = formData.get('linkedActivityId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }

    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Fichier trop volumineux (max 10MB)' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Type de fichier non autorisé (PDF, JPG, PNG, TXT uniquement)' }, { status: 400 });
    }

    const tripData = trip.data as any;
    const documents = tripData?.documents?.items || [];

    const storagePath = `${id}/${Date.now()}-${file.name}`;
    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('trip-documents')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase Storage upload failed:', uploadError);
      return NextResponse.json(
        {
          error: 'Service de stockage temporairement indisponible',
          code: 'STORAGE_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    const { data: urlData } = supabase.storage
      .from('trip-documents')
      .getPublicUrl(storagePath);

    const fileUrl = urlData.publicUrl;

    // Create document metadata
    const newDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      name: file.name,
      type: documentType,
      fileUrl,
      fileSize: file.size,
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.id,
      notes: notes || undefined,
      linkedActivityId: linkedActivityId || undefined,
    };

    documents.push(newDocument);

    // Update trip data
    const newData = {
      ...tripData,
      documents: {
        items: documents,
      },
    };

    const { error: updateError } = await supabase
      .from('trips')
      .update({
        data: newData as any,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      // Cleanup uploaded file if update fails
      await supabase.storage.from('trip-documents').remove([storagePath]);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ document: newDocument });
  } catch (error) {
    console.error('Error uploading document:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/trips/[id]/documents?documentId=xxx
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json({ error: 'documentId manquant' }, { status: 400 });
    }

    const supabase = await createRouteHandlerClient();
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Check access
    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id, data')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Only owner or editors can delete
    const isOwner = trip.owner_id === user.id;
    if (!isOwner) {
      const { data: member } = await serviceClient
        .from('trip_members')
        .select('role')
        .eq('trip_id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!member || member.role === 'viewer') {
        return NextResponse.json({ error: 'Seuls les propriétaires et éditeurs peuvent supprimer des documents' }, { status: 403 });
      }
    }

    const tripData = trip.data as any;
    const documents = tripData?.documents?.items || [];
    const document = documents.find((d: any) => d.id === documentId);

    if (!document) {
      return NextResponse.json({ error: 'Document non trouvé' }, { status: 404 });
    }

    // Delete from storage if it's a Supabase URL (not base64)
    if (document.fileUrl && !document.fileUrl.startsWith('data:')) {
      try {
        const fileName = document.fileUrl.split('/').pop();
        if (fileName) {
          await supabase.storage.from('trip-documents').remove([`${id}/${fileName}`]);
        }
      } catch (storageError) {
        console.warn('Failed to delete file from storage:', storageError);
        // Continue anyway to remove metadata
      }
    }

    // Remove from documents array
    const updatedDocuments = documents.filter((d: any) => d.id !== documentId);

    const newData = {
      ...tripData,
      documents: {
        items: updatedDocuments,
      },
    };

    const { error: updateError } = await supabase
      .from('trips')
      .update({
        data: newData as any,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

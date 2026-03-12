import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { MemberRole } from '@/lib/types/collaboration';
import { signManyObjectUrls } from '@/lib/server/mediaUrl';
import { canEditTrip } from '@/lib/server/tripAccess';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'text/plain',
];

const DOCUMENT_TYPES = [
  'flight_ticket',
  'hotel_booking',
  'activity_ticket',
  'insurance',
  'visa',
  'passport',
  'other',
] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number];

interface StoredDocument {
  id: string;
  name: string;
  type: DocumentType;
  fileUrl?: string;
  storagePath?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedAt: string;
  uploadedBy?: string;
  notes?: string;
  linkedActivityId?: string;
  urlExpiresAt?: string;
}

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

async function ensureDocumentsBucket(serviceClient: ReturnType<typeof getServiceClient>) {
  const { data: buckets } = await serviceClient.storage.listBuckets();
  const exists = buckets?.some((bucket) => bucket.name === 'trip-documents');
  if (!exists) {
    await serviceClient.storage.createBucket('trip-documents', {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });
  }
}

function normalizeDocumentType(type: string | null): DocumentType {
  if (type && DOCUMENT_TYPES.includes(type as DocumentType)) {
    return type as DocumentType;
  }
  return 'other';
}

function extractStoragePathFromUrl(fileUrl: string, bucket: string): string | null {
  if (!fileUrl || fileUrl.startsWith('data:')) {
    return null;
  }

  try {
    const parsed = new URL(fileUrl);
    const marker = `/${bucket}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }
    const extracted = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    return extracted || null;
  } catch {
    return null;
  }
}

function getCanonicalStoragePath(doc: StoredDocument): string | null {
  if (doc.storagePath) {
    return doc.storagePath;
  }

  if (doc.fileUrl) {
    return extractStoragePathFromUrl(doc.fileUrl, 'trip-documents');
  }

  return null;
}

function getDocumentsFromTripData(tripData: unknown): StoredDocument[] {
  const data = (tripData || {}) as { documents?: { items?: StoredDocument[] } };
  return data.documents?.items || [];
}

function buildStoredDocumentPayload(doc: StoredDocument): StoredDocument {
  const storagePath = getCanonicalStoragePath(doc);

  return {
    id: doc.id,
    name: doc.name,
    type: normalizeDocumentType(doc.type),
    storagePath: storagePath || undefined,
    // Keep legacy URLs only when no canonical path can be recovered.
    fileUrl: storagePath ? undefined : doc.fileUrl,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    uploadedAt: doc.uploadedAt,
    uploadedBy: doc.uploadedBy,
    notes: doc.notes,
    linkedActivityId: doc.linkedActivityId,
  };
}

function toApiDocument(
  doc: StoredDocument,
  signedByPath: Record<string, { signedUrl: string; expiresAt: string }>
): StoredDocument {
  const storagePath = getCanonicalStoragePath(doc);
  const signed = storagePath ? signedByPath[storagePath] : null;

  return {
    ...doc,
    storagePath: storagePath || undefined,
    fileUrl: signed?.signedUrl || doc.fileUrl,
    urlExpiresAt: signed?.expiresAt ?? undefined,
  };
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

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id, data')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const isOwner = trip.owner_id === user.id;
    const memberRole = isOwner ? 'owner' : await getMemberRole(serviceClient, id, user.id);

    if (!memberRole) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const documents = getDocumentsFromTripData(trip.data);
    const storagePaths = documents
      .map((doc) => getCanonicalStoragePath(doc))
      .filter((path): path is string => Boolean(path));

    const signedByPath = await signManyObjectUrls('trip-documents', storagePaths);
    const apiDocuments = documents.map((doc) => toApiDocument(doc, signedByPath));

    return NextResponse.json({ documents: apiDocuments });
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

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id, data')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const isOwner = trip.owner_id === user.id;
    const memberRole = isOwner ? 'owner' : await getMemberRole(serviceClient, id, user.id);

    if (!canEditTrip(memberRole)) {
      return NextResponse.json(
        { error: 'Seuls les propriétaires et éditeurs peuvent ajouter des documents' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const documentType = normalizeDocumentType((formData.get('type') as string) || null);
    const notes = (formData.get('notes') as string) || null;
    const linkedActivityId = (formData.get('linkedActivityId') as string) || null;

    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }

    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Fichier trop volumineux (max 10MB)' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Type de fichier non autorisé (PDF, JPG, PNG, TXT uniquement)' },
        { status: 400 }
      );
    }

    const tripData = trip.data as unknown;
    const existingDocuments = getDocumentsFromTripData(tripData).map((doc) => buildStoredDocumentPayload(doc));

    await ensureDocumentsBucket(serviceClient);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await serviceClient.storage
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

    // Persist canonical storage path only (signed URL is generated per request)
    const newStoredDocument: StoredDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      name: file.name,
      type: documentType,
      storagePath,
      fileSize: file.size,
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.id,
      notes: notes || undefined,
      linkedActivityId: linkedActivityId || undefined,
    };

    const documentsToPersist = [...existingDocuments, newStoredDocument];

    const newData = {
      ...(tripData as Record<string, unknown>),
      documents: {
        items: documentsToPersist,
      },
    };

    const { error: updateError } = await serviceClient
      .from('trips')
      .update({
        data: newData as unknown as Database['public']['Tables']['trips']['Update']['data'],
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      await serviceClient.storage.from('trip-documents').remove([storagePath]);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const signedByPath = await signManyObjectUrls('trip-documents', [storagePath]);
    const apiDocument = toApiDocument(newStoredDocument, signedByPath);

    return NextResponse.json({ document: apiDocument });
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

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id, data')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    const isOwner = trip.owner_id === user.id;
    const memberRole = isOwner ? 'owner' : await getMemberRole(serviceClient, id, user.id);

    if (!canEditTrip(memberRole)) {
      return NextResponse.json(
        { error: 'Seuls les propriétaires et éditeurs peuvent supprimer des documents' },
        { status: 403 }
      );
    }

    const tripData = trip.data as unknown;
    const documents = getDocumentsFromTripData(tripData).map((doc) => buildStoredDocumentPayload(doc));
    const document = documents.find((doc) => doc.id === documentId);

    if (!document) {
      return NextResponse.json({ error: 'Document non trouvé' }, { status: 404 });
    }

    const storagePath = getCanonicalStoragePath(document);
    if (storagePath) {
      try {
        await serviceClient.storage.from('trip-documents').remove([storagePath]);
      } catch (storageError) {
        console.warn('Failed to delete file from storage:', storageError);
      }
    }

    const updatedDocuments = documents.filter((doc) => doc.id !== documentId);

    const newData = {
      ...(tripData as Record<string, unknown>),
      documents: {
        items: updatedDocuments,
      },
    };

    const { error: updateError } = await serviceClient
      .from('trips')
      .update({
        data: newData as unknown as Database['public']['Tables']['trips']['Update']['data'],
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

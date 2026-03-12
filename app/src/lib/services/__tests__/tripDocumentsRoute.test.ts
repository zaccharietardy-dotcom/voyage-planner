import { POST } from '@/app/api/trips/[id]/documents/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/server/mediaUrl', () => ({
  signManyObjectUrls: jest.fn().mockResolvedValue({}),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const createClientMock = createClient as jest.Mock;

function createMultipartRequest(file: File): Request {
  const formData = new FormData();
  formData.set('file', file);
  formData.set('type', 'other');
  formData.set('notes', 'Security test');

  return new Request('http://localhost/api/trips/trip-1/documents', {
    method: 'POST',
    body: formData,
  });
}

function buildServiceClient(options: { ownerId: string; uploadError: { message: string } | null }) {
  const { ownerId, uploadError } = options;

  const updateEqMock = jest.fn().mockResolvedValue({ error: null });
  const updateMock = jest.fn(() => ({ eq: updateEqMock }));
  const uploadMock = jest.fn().mockResolvedValue({ error: uploadError });

  const tripSelectQuery = {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { owner_id: ownerId, data: {} },
      error: null,
    }),
  };

  const client = {
    storage: {
      listBuckets: jest.fn().mockResolvedValue({ data: [{ name: 'trip-documents' }] }),
      createBucket: jest.fn().mockResolvedValue({}),
      from: jest.fn(() => ({
        upload: uploadMock,
        remove: jest.fn().mockResolvedValue({}),
      })),
    },
    from: jest.fn((table: string) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnValue(tripSelectQuery),
          update: updateMock,
        };
      }

      if (table === 'trip_members') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    client,
    updateMock,
    uploadMock,
  };
}

function buildRouteClient() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  };
}

describe('/api/trips/[id]/documents POST hardening', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it('uploads via storage and persists canonical storagePath (not data URL)', async () => {
    const serviceClient = buildServiceClient({ ownerId: 'user-1', uploadError: null });

    createClientMock.mockReturnValue(serviceClient.client);
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient());

    const request = createMultipartRequest(
      new File(['hello world'], 'test.txt', { type: 'text/plain' })
    );

    const response = await POST(request as any, {
      params: Promise.resolve({ id: 'trip-1' }),
    } as any);

    expect(response.status).toBe(200);
    expect(serviceClient.updateMock).toHaveBeenCalledTimes(1);

    const updatedPayload = (serviceClient.updateMock.mock.calls as any[][])[0][0];
    const persistedDoc = updatedPayload?.data?.documents?.items?.[0];

    expect(typeof persistedDoc?.storagePath).toBe('string');
    expect(persistedDoc.storagePath.startsWith('trip-1/')).toBe(true);
    expect(persistedDoc?.fileUrl).toBeUndefined();
  });

  it('returns 503 and code STORAGE_UNAVAILABLE when storage upload fails', async () => {
    const serviceClient = buildServiceClient({
      ownerId: 'user-1',
      uploadError: { message: 'bucket not found' },
    });

    createClientMock.mockReturnValue(serviceClient.client);
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient());

    const request = createMultipartRequest(
      new File(['hello world'], 'test.txt', { type: 'text/plain' })
    );

    const response = await POST(request as any, {
      params: Promise.resolve({ id: 'trip-1' }),
    } as any);

    expect(response.status).toBe(503);
    expect(serviceClient.updateMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.code).toBe('STORAGE_UNAVAILABLE');
  });
});

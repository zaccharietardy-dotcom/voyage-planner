import { POST } from '@/app/api/trips/[id]/documents/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const createClientMock = createClient as jest.Mock;

function createMultipartRequest(file: File): Request {
  const formData = new FormData();
  formData.set('file', file);
  formData.set('type', 'receipt');
  formData.set('notes', 'Security test');

  return new Request('http://localhost/api/trips/trip-1/documents', {
    method: 'POST',
    body: formData,
  });
}

function buildServiceClient(ownerId: string) {
  const tripQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { owner_id: ownerId, data: {} },
      error: null,
    }),
  };

  const memberQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null }),
  };

  return {
    from: jest.fn((table: string) => {
      if (table === 'trips') return tripQuery;
      if (table === 'trip_members') return memberQuery;
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function buildSupabaseRouteClient(uploadResult: { error: any }) {
  const updateEqMock = jest.fn().mockResolvedValue({ error: null });
  const updateMock = jest.fn(() => ({ eq: updateEqMock }));
  const removeMock = jest.fn().mockResolvedValue({});
  const getPublicUrlMock = jest.fn(() => ({
    data: { publicUrl: 'https://cdn.example.com/trip-documents/trip-1/test.txt' },
  }));
  const uploadMock = jest.fn().mockResolvedValue(uploadResult);

  const client = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
      }),
    },
    storage: {
      from: jest.fn(() => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
        remove: removeMock,
      })),
    },
    from: jest.fn((table: string) => {
      if (table === 'trips') {
        return {
          update: updateMock,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    client,
    updateMock,
    updateEqMock,
    uploadMock,
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

  it('uploads via storage and never persists base64 data URLs', async () => {
    const serviceClient = buildServiceClient('user-1');
    const routeClient = buildSupabaseRouteClient({ error: null });

    createClientMock.mockReturnValue(serviceClient);
    createRouteHandlerClientMock.mockResolvedValue(routeClient.client);

    const request = createMultipartRequest(
      new File(['hello world'], 'test.txt', { type: 'text/plain' })
    );

    const response = await POST(request as any, {
      params: Promise.resolve({ id: 'trip-1' }),
    } as any);

    expect(response.status).toBe(200);
    expect(routeClient.updateMock).toHaveBeenCalledTimes(1);
    const updatedPayload = (routeClient.updateMock.mock.calls as any[][])[0][0];
    const persistedFileUrl = updatedPayload?.data?.documents?.items?.[0]?.fileUrl;
    expect(typeof persistedFileUrl).toBe('string');
    expect(persistedFileUrl.startsWith('data:')).toBe(false);
  });

  it('returns 503 and code STORAGE_UNAVAILABLE when storage upload fails', async () => {
    const serviceClient = buildServiceClient('user-1');
    const routeClient = buildSupabaseRouteClient({
      error: { message: 'bucket not found' },
    });

    createClientMock.mockReturnValue(serviceClient);
    createRouteHandlerClientMock.mockResolvedValue(routeClient.client);

    const request = createMultipartRequest(
      new File(['hello world'], 'test.txt', { type: 'text/plain' })
    );

    const response = await POST(request as any, {
      params: Promise.resolve({ id: 'trip-1' }),
    } as any);

    expect(response.status).toBe(503);
    expect(routeClient.updateMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.code).toBe('STORAGE_UNAVAILABLE');
  });
});

import { GET } from '@/app/api/trips/[id]/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getEditorUserIds } from '@/lib/server/collaboration';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/server/closeFriends', () => ({
  isAcceptedCloseFriend: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/lib/server/collaboration', () => ({
  formatProposalForApi: jest.fn((proposal: unknown) => proposal),
  getEditorUserIds: jest.fn().mockResolvedValue([]),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const createClientMock = createClient as jest.Mock;
const getEditorUserIdsMock = getEditorUserIds as jest.Mock;

function buildRouteClient(userId: string | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: userId ? { id: userId } : null,
        },
      }),
    },
  };
}

function buildServiceClient(options: {
  trip: Record<string, unknown>;
  memberRole?: 'owner' | 'editor' | 'viewer' | null;
  memberRows?: unknown[];
  proposalRows?: unknown[];
}) {
  const { trip, memberRole = null, memberRows = [], proposalRows = [] } = options;

  return {
    from: jest.fn((table: string) => {
      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: trip, error: null }),
            }),
          }),
        };
      }

      if (table === 'trip_members') {
        return {
          select: jest.fn((selection: string) => {
            if (selection === 'role') {
              return {
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: memberRole ? { role: memberRole } : null,
                    }),
                  }),
                }),
              };
            }

            return {
              eq: jest.fn().mockResolvedValue({ data: memberRows }),
            };
          }),
        };
      }

      if (table === 'proposals') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: proposalRows }),
            }),
          }),
        };
      }

      if (table === 'votes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('/api/trips/[id] redaction policy', () => {
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

  it('redacts data.documents for unauthenticated public viewers', async () => {
    const trip = {
      id: 'trip-1',
      owner_id: 'owner-1',
      name: 'Paris',
      title: 'Paris',
      destination: 'Paris',
      start_date: '2026-02-10',
      end_date: '2026-02-12',
      duration_days: 3,
      preferences: {},
      data: {
        itinerary: { days: 3 },
        documents: {
          items: [{ id: 'doc-1', fileUrl: 'https://cdn.example.com/doc.pdf' }],
        },
      },
      share_code: 'secret-share',
      visibility: 'public',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    };

    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient(null));
    createClientMock.mockReturnValue(buildServiceClient({ trip }));

    const response = await GET(new Request('http://localhost/api/trips/trip-1'), {
      params: Promise.resolve({ id: 'trip-1' }),
    } as any);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.share_code).toBe('');
    expect(payload.data.documents).toBeUndefined();
    expect(payload.data.itinerary).toEqual({ days: 3 });
  });

  it('keeps owner view intact (documents + share_code visible)', async () => {
    const trip = {
      id: 'trip-1',
      owner_id: 'owner-1',
      name: 'Paris',
      title: 'Paris',
      destination: 'Paris',
      start_date: '2026-02-10',
      end_date: '2026-02-12',
      duration_days: 3,
      preferences: {},
      data: {
        documents: {
          items: [{ id: 'doc-1', fileUrl: 'https://cdn.example.com/doc.pdf' }],
        },
      },
      share_code: 'secret-share',
      visibility: 'public',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    };

    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient('owner-1'));
    createClientMock.mockReturnValue(buildServiceClient({ trip, memberRows: [], proposalRows: [] }));

    const response = await GET(new Request('http://localhost/api/trips/trip-1'), {
      params: Promise.resolve({ id: 'trip-1' }),
    } as any);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.share_code).toBe('secret-share');
    expect(payload.data.documents.items).toHaveLength(1);
    expect(getEditorUserIdsMock).toHaveBeenCalledWith(expect.any(Object), 'trip-1');
  });
});

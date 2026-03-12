import { GET } from '@/app/api/feed/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/server/closeFriends', () => ({
  getAcceptedCloseFriendIds: jest.fn().mockResolvedValue(new Set<string>()),
}));

jest.mock('@/lib/server/mediaUrl', () => ({
  signManyObjectUrls: jest.fn().mockResolvedValue({}),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const createClientMock = createClient as jest.Mock;

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

function buildServiceClient() {
  const tripRows = [
    {
      id: 'trip-1',
      title: 'Trip title',
      name: 'Trip name',
      destination: 'Paris',
      start_date: '2026-02-10',
      end_date: '2026-02-12',
      duration_days: 3,
      visibility: 'public',
      created_at: '2026-02-01T00:00:00.000Z',
      preferences: { pace: 'slow' },
      owner_id: 'owner-1',
      data: { documents: { items: [{ id: 'doc-1' }] } },
    },
  ];

  const tripsQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue({ data: tripRows, error: null }),
  };

  const tripPhotosEqMock = jest.fn().mockReturnValue({
    order: jest.fn().mockResolvedValue({ data: [] }),
  });

  return {
    from: jest.fn((table: string) => {
      if (table === 'trips') {
        return tripsQuery;
      }

      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ id: 'owner-1', display_name: 'Owner', avatar_url: null, username: 'owner' }],
            }),
          }),
        };
      }

      if (table === 'trip_photos') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: tripPhotosEqMock,
            }),
          }),
        };
      }

      if (table === 'trip_likes') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: [] }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    __tripPhotosEqMock: tripPhotosEqMock,
  };
}

describe('/api/feed payload sanitization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not expose trips.data in discover feed items', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient(null));
    const serviceClient = buildServiceClient();
    createClientMock.mockReturnValue(serviceClient);

    const response = await GET(new Request('http://localhost/api/feed?tab=discover&page=1&limit=20'));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.trips).toHaveLength(1);
    expect(payload.trips[0].data).toBeUndefined();
    expect(payload.trips[0].destination).toBe('Paris');
    expect(serviceClient.__tripPhotosEqMock).toHaveBeenCalledWith('visibility', 'public');
  });
});

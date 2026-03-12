import { GET } from '@/app/api/users/[id]/trips/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { isAcceptedCloseFriend } from '@/lib/server/closeFriends';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@/lib/server/closeFriends', () => ({
  isAcceptedCloseFriend: jest.fn(),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const isAcceptedCloseFriendMock = isAcceptedCloseFriend as jest.Mock;

function buildClient(userId: string | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: jest.fn((table: string) => {
      if (table !== 'trips') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [
                { id: 'trip-public', visibility: 'public' },
                { id: 'trip-friends', visibility: 'friends' },
                { id: 'trip-private', visibility: 'private' },
              ],
            }),
          }),
        }),
      };
    }),
  };
}

describe('/api/users/[id]/trips visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only public trips for anonymous viewers', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildClient(null));
    isAcceptedCloseFriendMock.mockResolvedValue(false);

    const response = await GET(new Request('http://localhost/api/users/owner/trips'), {
      params: Promise.resolve({ id: 'owner' }),
    } as any);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.map((trip: { id: string }) => trip.id)).toEqual(['trip-public']);
  });

  it('allows friends visibility only for accepted close friends', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildClient('viewer-1'));
    isAcceptedCloseFriendMock.mockResolvedValue(true);

    const response = await GET(new Request('http://localhost/api/users/owner/trips'), {
      params: Promise.resolve({ id: 'owner' }),
    } as any);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.map((trip: { id: string }) => trip.id)).toEqual(['trip-public', 'trip-friends']);
  });
});

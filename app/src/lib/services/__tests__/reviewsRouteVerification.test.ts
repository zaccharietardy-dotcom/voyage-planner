import { POST } from '@/app/api/reviews/route';
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

function buildRouteClient(userId: string) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: userId } },
      }),
    },
  };
}

function buildServiceClient(options: {
  tripOwnerId?: string | null;
  memberExists?: boolean;
}) {
  const { tripOwnerId = null, memberExists = false } = options;

  const placeReviewInsertSingle = jest.fn().mockResolvedValue({
    data: {
      id: 'review-1',
      user_id: 'user-1',
      place_id: 'some-place',
      trip_id: tripOwnerId ? 'trip-1' : null,
      activity_title: 'Louvre',
      city: 'Paris',
      rating: 5,
      title: 'Excellent',
      content: 'x'.repeat(60),
      helpful_count: 0,
    },
    error: null,
  });

  return {
    from: jest.fn((table: string) => {
      if (table === 'place_reviews') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: placeReviewInsertSingle,
            }),
          }),
        };
      }

      if (table === 'trips') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: tripOwnerId ? { id: 'trip-1', owner_id: tripOwnerId } : null,
              }),
            }),
          }),
        };
      }

      if (table === 'trip_members') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: memberExists ? { id: 'member-1' } : null }),
              }),
            }),
          }),
        };
      }

      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { display_name: 'User', avatar_url: null },
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function buildRequest(tripId?: string) {
  return new Request('http://localhost/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      placeId: 'louvre-paris',
      tripId,
      activityTitle: 'Louvre',
      city: 'Paris',
      rating: 5,
      title: 'Excellent',
      content: 'x'.repeat(60),
    }),
  });
}

describe('/api/reviews POST verified trip checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects tripId when user is not owner or member', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient('user-1'));
    createClientMock.mockReturnValue(buildServiceClient({ tripOwnerId: 'owner-2', memberExists: false }));

    const response = await POST(buildRequest('trip-1') as any);
    expect(response.status).toBe(403);
  });

  it('accepts tripId when user owns the trip and marks verified visit', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient('user-1'));
    createClientMock.mockReturnValue(buildServiceClient({ tripOwnerId: 'user-1' }));

    const response = await POST(buildRequest('trip-1') as any);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isVerifiedVisit).toBe(true);
  });
});

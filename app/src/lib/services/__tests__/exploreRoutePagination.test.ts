import { GET } from '@/app/api/explore/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;

function buildSupabaseClient() {
  const rangeMock = jest.fn();
  const query: Record<string, any> = {
    data: [],
    error: null,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockImplementation((from: number, to: number) => {
      rangeMock(from, to);
      return query;
    }),
    ilike: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
  };

  return {
    from: jest.fn((table: string) => {
      if (table === 'trips') return query;
      if (table === 'trip_likes' || table === 'trip_comments') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: [] }),
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
    },
    __rangeMock: rangeMock,
  };
}

describe('/api/explore pagination guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid limit format', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildSupabaseClient());

    const response = await GET(
      new Request('http://localhost/api/explore?page=1&limit=abc') as any
    );

    expect(response.status).toBe(400);
  });

  it('clamps high limit to 50', async () => {
    const supabase = buildSupabaseClient();
    createRouteHandlerClientMock.mockResolvedValue(supabase);

    const response = await GET(
      new Request('http://localhost/api/explore?page=1&limit=500') as any
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.limit).toBe(50);
    expect(supabase.__rangeMock).toHaveBeenCalledWith(0, 49);
  });
});

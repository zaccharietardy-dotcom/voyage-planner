import { POST } from '@/app/api/reviews/[id]/helpful/route';
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

function buildRouteClient(userId: string | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  };
}

describe('/api/reviews/[id]/helpful atomic toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns rpc result payload {helpful,count}', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient('user-1'));
    createClientMock.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({
        data: [{ helpful: true, helpful_count: 7 }],
        error: null,
      }),
    });

    const response = await POST(new Request('http://localhost/api/reviews/rev-1/helpful') as any, {
      params: Promise.resolve({ id: 'rev-1' }),
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ helpful: true, count: 7 });
  });

  it('returns 404 when rpc reports missing review', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient('user-1'));
    createClientMock.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'REVIEW_NOT_FOUND' },
      }),
    });

    const response = await POST(new Request('http://localhost/api/reviews/rev-404/helpful') as any, {
      params: Promise.resolve({ id: 'rev-404' }),
    } as any);

    expect(response.status).toBe(404);
  });
});

import { POST } from '@/app/api/trips/join/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/server/rateLimit';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@/lib/server/rateLimit', () => ({
  checkRateLimit: jest.fn(),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const checkRateLimitMock = checkRateLimit as jest.Mock;

function buildRouteClient(userId: string | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  };
}

describe('/api/trips/join rate-limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createRouteHandlerClientMock.mockResolvedValue(buildRouteClient('user-1'));
    checkRateLimitMock.mockReturnValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 3600_000,
    });
  });

  it('returns 429 when per-user limit is exceeded', async () => {
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 120_000,
    });

    const response = await POST(
      new Request('http://localhost/api/trips/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ABC123' }),
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });

  it('returns 400 when share code format is invalid', async () => {
    const response = await POST(
      new Request('http://localhost/api/trips/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'abc' }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('invalide');
  });
});

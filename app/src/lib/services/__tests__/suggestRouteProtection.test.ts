import { POST } from '@/app/api/suggest/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';
import { checkAndIncrementRateLimit } from '@/lib/server/dbRateLimit';
import { generateDurationSuggestion } from '@/lib/services/suggestions';

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@/lib/server/billingEntitlements', () => ({
  deriveBillingState: jest.fn(),
  fetchEntitlementsForUser: jest.fn(),
}));

jest.mock('@/lib/server/dbRateLimit', () => ({
  checkAndIncrementRateLimit: jest.fn(),
}));

jest.mock('@/lib/services/suggestions', () => ({
  generateDurationSuggestion: jest.fn(),
  generateDestinationSuggestions: jest.fn(),
}));

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const deriveBillingStateMock = deriveBillingState as jest.Mock;
const fetchEntitlementsForUserMock = fetchEntitlementsForUser as jest.Mock;
const checkAndIncrementRateLimitMock = checkAndIncrementRateLimit as jest.Mock;
const generateDurationSuggestionMock = generateDurationSuggestion as jest.Mock;

function buildSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: jest.fn((table: string) => {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                subscription_status: 'free',
                subscription_ends_at: null,
              },
            }),
          }),
        }),
      };
    }),
    rpc: jest.fn(),
  };
}

describe('/api/suggest auth and rate-limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchEntitlementsForUserMock.mockResolvedValue([]);
    deriveBillingStateMock.mockReturnValue({ status: 'free' });
    checkAndIncrementRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 29,
      retryAfterSeconds: 0,
      resetAt: '2026-03-13T00:00:00.000Z',
    });
    generateDurationSuggestionMock.mockResolvedValue({
      optimal: 4,
      minimum: 3,
      maximum: 6,
      reasoning: 'test',
      highlights: { 3: 'x' },
    });
  });

  it('returns 401 when unauthenticated', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildSupabaseClient(null));

    const response = await POST(
      new Request('http://localhost/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'duration', destination: 'Paris' }),
      }) as any
    );

    expect(response.status).toBe(401);
    expect(checkAndIncrementRateLimitMock).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when rate limit is exceeded', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildSupabaseClient('user-1'));
    checkAndIncrementRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
      resetAt: '2026-03-13T01:00:00.000Z',
    });

    const response = await POST(
      new Request('http://localhost/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'duration', destination: 'Paris' }),
      }) as any
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
  });

  it('returns 400 when durationDays is outside allowed bounds', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildSupabaseClient('user-1'));

    const response = await POST(
      new Request('http://localhost/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'destination',
          query: 'Japan',
          durationDays: 45,
        }),
      }) as any
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('durationDays');
  });

  it('returns duration suggestions when authenticated and under limits', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildSupabaseClient('user-1'));

    const response = await POST(
      new Request('http://localhost/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'duration',
          destination: '  Paris  ',
          activities: ['culture'],
        }),
      }) as any
    );

    expect(response.status).toBe(200);
    expect(generateDurationSuggestionMock).toHaveBeenCalledWith(
      'Paris',
      expect.objectContaining({ activities: ['culture'] })
    );
  });
});

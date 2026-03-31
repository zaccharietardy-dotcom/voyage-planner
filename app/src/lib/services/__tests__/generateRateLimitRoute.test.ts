import { POST } from '@/app/api/generate/route';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';
import { checkAndIncrementRateLimit } from '@/lib/server/dbRateLimit';

jest.mock('@/lib/pipeline', () => ({
  generateTripV2: jest.fn(),
}));

jest.mock('@/lib/services/cityNormalization', () => ({
  normalizeCity: jest.fn(),
}));

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

const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;
const deriveBillingStateMock = deriveBillingState as jest.Mock;
const fetchEntitlementsForUserMock = fetchEntitlementsForUser as jest.Mock;
const checkAndIncrementRateLimitMock = checkAndIncrementRateLimit as jest.Mock;

function buildSupabaseClient() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
      }),
    },
    from: jest.fn((table: string) => {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                subscription_status: 'active',
                subscription_ends_at: null,
                extra_trips: 0,
              },
            }),
          }),
        }),
      };
    }),
  };
}

describe('/api/generate DB-backed rate limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 429 with Retry-After when hourly limit is exceeded', async () => {
    createRouteHandlerClientMock.mockResolvedValue(buildSupabaseClient());
    fetchEntitlementsForUserMock.mockResolvedValue({});
    deriveBillingStateMock.mockReturnValue({ status: 'pro' });
    checkAndIncrementRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
      resetAt: '2026-03-12T12:00:00.000Z',
    });

    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: 'Paris',
          destination: 'Rome',
          startDate: '2026-04-01',
          durationDays: 5,
          transport: 'optimal',
          carRental: false,
          groupSize: 2,
          groupType: 'couple',
          budgetLevel: 'moderate',
          activities: ['culture', 'gastronomy'],
          dietary: ['none'],
        }),
      }) as any
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(checkAndIncrementRateLimitMock).toHaveBeenCalled();
  });
});

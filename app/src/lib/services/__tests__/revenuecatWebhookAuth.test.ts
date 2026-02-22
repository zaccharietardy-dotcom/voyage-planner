import { upsertBillingEntitlement } from '@/lib/server/billingEntitlements';
import { POST } from '@/app/api/billing/revenuecat/webhook/route';

jest.mock('@/lib/server/billingEntitlements', () => ({
  upsertBillingEntitlement: jest.fn(),
}));

const eqMock = jest.fn().mockResolvedValue({});
const updateMock = jest.fn(() => ({ eq: eqMock }));
const fromMock = jest.fn(() => ({ update: updateMock }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: fromMock,
  })),
}));

describe('RevenueCat webhook auth hardening', () => {
  const originalSecret = process.env.REVENUECAT_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REVENUECAT_WEBHOOK_SECRET = 'rc-secret';
  });

  afterAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = originalSecret;
  });

  function createRequest(authorization?: string): Request {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (authorization) {
      headers.authorization = authorization;
    }

    return new Request('http://localhost/api/billing/revenuecat/webhook', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: {
          type: 'INITIAL_PURCHASE',
          store: 'APP_STORE',
          app_user_id: 'user-123',
          expiration_at: '2030-01-01T00:00:00.000Z',
        },
      }),
    });
  }

  it('returns 503 when webhook secret is missing', async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;

    const response = await POST(createRequest('Bearer anything') as any);
    expect(response.status).toBe(503);
    expect(upsertBillingEntitlement).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer token does not match', async () => {
    const response = await POST(createRequest('Bearer wrong-secret') as any);
    expect(response.status).toBe(401);
    expect(upsertBillingEntitlement).not.toHaveBeenCalled();
  });

  it('returns 401 when secret is not provided as Bearer token', async () => {
    const response = await POST(createRequest('rc-secret') as any);
    expect(response.status).toBe(401);
    expect(upsertBillingEntitlement).not.toHaveBeenCalled();
  });

  it('accepts valid bearer token and keeps business flow', async () => {
    const response = await POST(createRequest('Bearer rc-secret') as any);
    expect(response.status).toBe(200);
    expect(upsertBillingEntitlement).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});

import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { resolveRequestAuth } from '@/lib/server/requestAuth';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(),
}));

jest.mock('@/lib/runtime-config', () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SITE_URL: 'https://naraevoyage.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  }),
}));

const createClientMock = createClient as jest.Mock;
const createRouteHandlerClientMock = createRouteHandlerClient as jest.Mock;

const originalFetch = global.fetch;

function buildBearerClient(userId: string | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : new Error('invalid token'),
      }),
    },
  };
}

function mockFetchForBearer(success: boolean, userId = 'bearer-user') {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/auth/v1/user')) {
      return Promise.resolve({
        ok: success,
        status: success ? 200 : 401,
        json: () => Promise.resolve(success ? { id: userId, email: `${userId}@test.com` } : { error: 'invalid' }),
        text: () => Promise.resolve(JSON.stringify(success ? { id: userId, email: `${userId}@test.com` } : { error: 'invalid' })),
      });
    }
    return originalFetch(url);
  });
}

describe('resolveRequestAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('falls back to cookie auth when no bearer token is provided', async () => {
    createRouteHandlerClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'cookie-user' } },
        }),
      },
    });

    const result = await resolveRequestAuth(
      new Request('http://localhost/api/test'),
    );

    expect(result.authMethod).toBe('cookie');
    expect(result.user?.id).toBe('cookie-user');
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('authenticates with bearer token when provided', async () => {
    mockFetchForBearer(true);
    createClientMock.mockReturnValue(buildBearerClient('bearer-user'));

    const result = await resolveRequestAuth(
      new Request('http://localhost/api/test', {
        headers: {
          Authorization: 'Bearer access-token',
        },
      }),
    );

    expect(result.authMethod).toBe('bearer');
    expect(result.user?.id).toBe('bearer-user');
    expect(createRouteHandlerClientMock).not.toHaveBeenCalled();
  });

  it('gives bearer auth priority over cookies when both are present', async () => {
    mockFetchForBearer(true);
    createClientMock.mockReturnValue(buildBearerClient('bearer-user'));
    createRouteHandlerClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'cookie-user' } },
        }),
      },
    });

    const result = await resolveRequestAuth(
      new Request('http://localhost/api/test', {
        headers: {
          Authorization: 'Bearer access-token',
          Cookie: 'sb=1',
        },
      }),
    );

    expect(result.authMethod).toBe('bearer');
    expect(result.user?.id).toBe('bearer-user');
    expect(createRouteHandlerClientMock).not.toHaveBeenCalled();
  });

  it('falls back to cookies when bearer auth is invalid', async () => {
    mockFetchForBearer(false);
    createClientMock.mockReturnValue(buildBearerClient(null));
    createRouteHandlerClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'cookie-user' } },
        }),
      },
    });

    const result = await resolveRequestAuth(
      new Request('http://localhost/api/test', {
        headers: {
          Authorization: 'Bearer invalid-token',
          Cookie: 'sb=1',
        },
      }),
    );

    expect(result.authMethod).toBe('cookie');
    expect(result.user?.id).toBe('cookie-user');
    expect(createRouteHandlerClientMock).toHaveBeenCalled();
  });
});

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn(),
    },
  },
}));

import { supabase } from '@/lib/supabase/client';
import { fetchWithAuth, getAuthHeaders, getValidSession } from '@/lib/api/client';

const mockSupabase = supabase as unknown as {
  auth: {
    getSession: jest.Mock;
    refreshSession: jest.Mock;
  };
};

describe('mobile API auth helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('refreshes an expired session before building auth headers', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'expired-token',
          expires_at: Math.floor(Date.now() / 1000) - 30,
        },
      },
    });
    mockSupabase.auth.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'fresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });

    await expect(getAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer fresh-token',
    });
  });

  it('refreshes before the first authenticated request and retries once after a 401', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-a',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockSupabase.auth.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-b',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true });

    const response = await fetchWithAuth('https://naraevoyage.com/api/generate/preflight');

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://naraevoyage.com/api/generate/preflight',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-b' },
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://naraevoyage.com/api/generate/preflight',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-b' },
      }),
    );
  });

  it('returns null when the session cannot be refreshed', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
    mockSupabase.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('refresh failed'),
    });

    await expect(getValidSession({ forceRefresh: true })).resolves.toBeNull();
  });
});

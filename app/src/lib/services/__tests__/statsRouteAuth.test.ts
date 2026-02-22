import { NextResponse } from 'next/server';
import { DELETE, GET } from '@/app/api/stats/route';
import { requireAdmin } from '@/lib/server/adminAuth';

jest.mock('@/lib/server/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

const requireAdminMock = requireAdmin as jest.Mock;

describe('/api/stats admin access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    requireAdminMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }),
    });

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns stats payload for admin', async () => {
    requireAdminMock.mockResolvedValueOnce({
      ok: true,
      user: { id: 'admin-id', email: 'admin@example.com' },
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toHaveProperty('usage.totalRequests');
    expect(payload).toHaveProperty('cost.estimatedUSD');
  });

  it('returns 403 on DELETE for non-admin', async () => {
    requireAdminMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Accès administrateur requis' }, { status: 403 }),
    });

    const response = await DELETE();
    expect(response.status).toBe(403);
  });

  it('allows DELETE for admin', async () => {
    requireAdminMock.mockResolvedValueOnce({
      ok: true,
      user: { id: 'admin-id', email: 'admin@example.com' },
    });

    const response = await DELETE();
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toHaveProperty('message', 'Statistiques réinitialisées');
  });
});

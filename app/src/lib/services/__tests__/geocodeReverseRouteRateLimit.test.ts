import { GET } from '@/app/api/geocode/reverse/route';
import { checkRateLimit } from '@/lib/server/rateLimit';

jest.mock('@/lib/server/rateLimit', () => ({
  checkRateLimit: jest.fn(),
}));

const checkRateLimitMock = checkRateLimit as jest.Mock;

describe('/api/geocode/reverse rate-limit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkRateLimitMock.mockReturnValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60_000,
    });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 20_000,
    });

    const response = await GET(
      new Request('http://localhost/api/geocode/reverse?lat=48.8566&lng=2.3522') as any
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });

  it('returns geocoded payload when request is valid', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          display_name: 'Paris, France',
          address: { city: 'Paris', country: 'France' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await GET(
      new Request('http://localhost/api/geocode/reverse?lat=48.8566&lng=2.3522') as any
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.city).toBe('Paris');
    expect(payload.country).toBe('France');
    fetchMock.mockRestore();
  });
});

import { GET } from '@/app/api/place-photo/route';
import { checkRateLimit } from '@/lib/server/rateLimit';

jest.mock('@/lib/server/rateLimit', () => ({
  checkRateLimit: jest.fn(),
}));

const checkRateLimitMock = checkRateLimit as jest.Mock;

function buildNextRequest(url: string) {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as any;
}

describe('/api/place-photo rate-limit', () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    checkRateLimitMock.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    });
  });

  afterAll(() => {
    process.env.GOOGLE_PLACES_API_KEY = originalKey;
  });

  it('returns 429 with Retry-After when rate limit is exceeded', async () => {
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 20_000,
    });

    const response = await GET(
      new Request('http://localhost/api/place-photo?photo_reference=test-ref') as any
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });

  it('returns 400 for too long photo_reference', async () => {
    const longReference = 'a'.repeat(2001);
    const response = await GET(
      buildNextRequest(`http://localhost/api/place-photo?photo_reference=${longReference}`)
    );

    expect(response.status).toBe(400);
  });

  it('proxies image response when request is valid', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('image-bytes', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const response = await GET(
      buildNextRequest('http://localhost/api/place-photo?photo_reference=abc123&maxwidth=500')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});

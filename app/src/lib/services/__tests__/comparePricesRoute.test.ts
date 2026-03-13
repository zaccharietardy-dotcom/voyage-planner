import { POST } from '@/app/api/compare-prices/route';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { compareHotelPrices } from '@/lib/services/priceComparator';

jest.mock('@/lib/server/rateLimit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/services/priceComparator', () => ({
  compareHotelPrices: jest.fn(),
  compareFlightPrices: jest.fn(),
  compareActivityPrices: jest.fn(),
  getTripCostSummary: jest.fn(),
}));

const checkRateLimitMock = checkRateLimit as jest.Mock;
const compareHotelPricesMock = compareHotelPrices as jest.Mock;

describe('/api/compare-prices hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkRateLimitMock.mockReturnValue({
      allowed: true,
      remaining: 11,
      resetAt: Date.now() + 60_000,
    });
    compareHotelPricesMock.mockResolvedValue([{ hotelName: 'A' }]);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const response = await POST(
      new Request('http://localhost/api/compare-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'hotel', params: {} }),
      }) as any
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });

  it('returns 400 when adults is invalid', async () => {
    const response = await POST(
      new Request('http://localhost/api/compare-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'hotel',
          params: { city: 'Paris', checkIn: '2026-05-01', checkOut: '2026-05-03', adults: '2' },
        }),
      }) as any
    );

    expect(response.status).toBe(400);
  });

  it('uses cache for semantically identical hotel requests', async () => {
    const requestA = new Request('http://localhost/api/compare-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'hotel',
        params: { city: 'Paris', checkIn: '2026-05-01', checkOut: '2026-05-03', adults: 2 },
      }),
    });
    const requestB = new Request('http://localhost/api/compare-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'hotel',
        params: { checkOut: '2026-05-03', adults: 2, checkIn: '2026-05-01', city: 'Paris' },
      }),
    });

    const first = await POST(requestA as any);
    const second = await POST(requestB as any);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondPayload = await second.json();
    expect(secondPayload.cached).toBe(true);
    expect(compareHotelPricesMock).toHaveBeenCalledTimes(1);
  });
});

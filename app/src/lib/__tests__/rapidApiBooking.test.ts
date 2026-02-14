import { searchHotelsWithBookingApi } from '../services/rapidApiBooking';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => 'upstream error',
  } as unknown as Response;
}

describe('rapidApiBooking', () => {
  const originalFetch = global.fetch;
  const originalRapidApiKey = process.env.RAPIDAPI_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.RAPIDAPI_KEY = originalRapidApiKey;
    jest.restoreAllMocks();
  });

  it('falls back to direct booking slug when getHotelDetails fails', async () => {
    process.env.RAPIDAPI_KEY = 'test-key';

    const fetchMock = jest.fn()
      // searchDestination
      .mockResolvedValueOnce(jsonResponse({
        data: [{ dest_id: '-2140479', dest_type: 'city' }],
      }))
      // searchHotels
      .mockResolvedValueOnce(jsonResponse({
        data: {
          hotels: [
            {
              hotel_id: 123,
              property: {
                id: 123,
                name: 'Hotel V Nesplein Amsterdam',
                city: 'Amsterdam',
                countryCode: 'nl',
                address: 'Nes 1, Amsterdam',
                latitude: 52.3722,
                longitude: 4.8922,
                reviewScore: 8.8,
                reviewCount: 1240,
                propertyClass: 4,
                checkin: { fromTime: '15:00' },
                checkout: { untilTime: '11:00' },
                distanceFromCenter: '0.5',
                priceBreakdown: { grossPrice: { value: 480 } },
              },
            },
          ],
        },
      }))
      // getHotelDetails -> fail => fallback direct
      .mockResolvedValueOnce(errorResponse(500));

    global.fetch = fetchMock as unknown as typeof fetch;

    const hotels = await searchHotelsWithBookingApi(
      'Amsterdam',
      '2026-08-10',
      '2026-08-12',
      { guests: 2, limit: 1 }
    );

    expect(hotels).toHaveLength(1);
    expect(hotels[0].bookingUrl).toContain('booking.com/hotel/nl/');
    expect(hotels[0].bookingUrl).toContain('checkin=2026-08-10');
    expect(hotels[0].bookingUrl).toContain('checkout=2026-08-12');
    expect(hotels[0].bookingUrl).not.toContain('searchresults.html');
  });
});

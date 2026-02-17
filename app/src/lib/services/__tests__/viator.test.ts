import {
  getViatorProductCoordinates,
  getViatorProductCoordinatesBulk,
  isViatorGenericPrivateTourCandidate,
  isViatorLowRelevanceCandidate,
  scoreViatorPlusValue,
} from '../viator';

describe('viator quality scoring', () => {
  it('gives strong plus-value score to high-quality guided entries', () => {
    const assessment = scoreViatorPlusValue({
      title: 'Louvre Museum Skip the Line Guided Tour',
      description: 'Small group expert guide with priority access',
      rating: 4.8,
      reviewCount: 2400,
      price: 89,
      freeCancellation: true,
      instantConfirmation: true,
    });

    expect(assessment.score).toBeGreaterThanOrEqual(4);
    expect(assessment.reasons).toContain('has_clear_operational_benefit');
  });

  it('flags photoshoot-style activities as low relevance', () => {
    expect(
      isViatorLowRelevanceCandidate(
        'Private Eiffel Tower Photoshoot',
        'Professional photographer for social media session'
      )
    ).toBe(true);

    const assessment = scoreViatorPlusValue({
      title: 'Private Eiffel Tower Photoshoot',
      description: 'Professional photographer and social media reels',
      rating: 4.2,
      reviewCount: 19,
      price: 160,
    });

    expect(assessment.score).toBeLessThan(0);
    expect(assessment.reasons).toContain('low_relevance_pattern');
  });

  it('penalizes generic customized private tours', () => {
    expect(
      isViatorGenericPrivateTourCandidate(
        'Visite privée personnalisée de Tokyo',
        'Customized private walking tour with local insights'
      )
    ).toBe(true);

    const assessment = scoreViatorPlusValue({
      title: 'Visite privée personnalisée de Tokyo',
      description: 'Customized private walking tour with local insights',
      rating: 4.8,
      reviewCount: 1200,
      price: 95,
    });

    expect(assessment.reasons).toContain('generic_private_tour');
    expect(assessment.score).toBeLessThan(2);
  });
});

describe('viator coordinates resolution', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.VIATOR_API_KEY;

  beforeEach(() => {
    process.env.VIATOR_API_KEY = 'test-viator-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.VIATOR_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  it('resolves direct coordinates from products/bulk in a single call', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [
          {
            productCode: 'P-DIRECT-1',
            logistics: {
              start: {
                location: {
                  latitude: 35.6895,
                  longitude: 139.6917,
                },
              },
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const coords = await getViatorProductCoordinates('P-DIRECT-1', { lat: 35.68, lng: 139.76 });

    expect(coords).toEqual({ lat: 35.6895, lng: 139.6917, source: 'place' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/products/bulk');
  });

  it('resolves meeting-point coordinates through locations/bulk references', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          products: [
            {
              productCode: 'P-REF-1',
              logistics: {
                start: {
                  location: {
                    ref: 'LOC-12345',
                  },
                },
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          locations: [
            {
              ref: 'LOC-12345',
              coordinates: {
                latitude: 48.8575,
                longitude: 2.2946,
              },
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const byCode = await getViatorProductCoordinatesBulk(['P-REF-1'], { lat: 48.8566, lng: 2.3522 });

    expect(byCode.get('P-REF-1')).toEqual({ lat: 48.8575, lng: 2.2946, source: 'place' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/products/bulk');
    expect(fetchMock.mock.calls[1][0]).toContain('/locations/bulk');
  });

  it('accepts encoded LOC references from booking answers and resolves coordinates', async () => {
    const encodedRef = 'LOC-o0AXCzJAfhQKyY6kX6udtN+qYQl7f0pd/K2R7E+sF0M=';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          products: [
            {
              productCode: 'P-REF-ENC-1',
              bookingQuestionAnswers: [
                {
                  question: 'PICKUP_POINT',
                  unit: 'LOCATION_REFERENCE',
                  answer: encodedRef,
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          locations: [
            {
              reference: encodedRef,
              coordinates: {
                lat: 35.6895,
                lng: 139.6917,
              },
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const byCode = await getViatorProductCoordinatesBulk(['P-REF-ENC-1'], { lat: 35.6762, lng: 139.6503 });

    expect(byCode.get('P-REF-ENC-1')).toEqual({ lat: 35.6895, lng: 139.6917, source: 'place' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/locations/bulk');
  });

  it('falls back to availability schedules when product payload has no location refs', async () => {
    const encodedRef = 'LOC-Q2hhbmdlTWVldGluZ1BvaW50LzEyMw==';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          products: [
            {
              productCode: 'P-SCHEDULE-1',
              title: 'Schedule fallback product',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bookingQuestionAnswers: [
            {
              question: 'PICKUP_POINT',
              unit: 'LOCATION_REFERENCE',
              answer: encodedRef,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          locations: [
            {
              reference: encodedRef,
              coordinates: {
                latitude: 35.671,
                longitude: 139.764,
              },
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const byCode = await getViatorProductCoordinatesBulk(['P-SCHEDULE-1'], { lat: 35.6762, lng: 139.6503 });

    expect(byCode.get('P-SCHEDULE-1')).toEqual({ lat: 35.671, lng: 139.764, source: 'place' });
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/availability/schedules/P-SCHEDULE-1'))).toBe(true);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/locations/bulk'))).toBe(true);
  });
});

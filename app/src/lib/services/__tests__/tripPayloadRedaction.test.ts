import { redactTripDataForLimitedViewer } from '@/lib/server/tripRedaction';
import { toFeedTripPublicPayload } from '@/lib/server/feedTripSanitizer';

describe('trip payload redaction', () => {
  it('removes documents from trip data for limited viewers', () => {
    const input = {
      itinerary: { days: 3 },
      documents: {
        items: [{ id: 'doc-1', fileUrl: 'https://example.com/doc.pdf' }],
      },
    };

    const result = redactTripDataForLimitedViewer(input) as Record<string, unknown>;
    expect(result.documents).toBeUndefined();
    expect(result.itinerary).toEqual({ days: 3 });
  });

  it('does not crash on non-object trip data', () => {
    expect(redactTripDataForLimitedViewer(null)).toBeNull();
    expect(redactTripDataForLimitedViewer('text')).toBe('text');
    expect(redactTripDataForLimitedViewer([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('never exposes raw data field in feed mapping', () => {
    const mapped = toFeedTripPublicPayload({
      id: 'trip-1',
      title: 'Trip',
      name: 'Trip',
      destination: 'Paris',
      start_date: '2026-02-01',
      end_date: '2026-02-03',
      duration_days: 3,
      visibility: 'public',
      created_at: '2026-02-01T00:00:00.000Z',
      preferences: { pace: 'balanced' },
      owner_id: 'owner-1',
      data: { secret: true },
    } as any);

    expect((mapped as any).data).toBeUndefined();
    expect(mapped.owner_id).toBe('owner-1');
    expect(mapped.destination).toBe('Paris');
  });
});

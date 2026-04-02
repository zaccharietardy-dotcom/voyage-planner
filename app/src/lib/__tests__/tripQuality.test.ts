import { getTripQualitySummary } from '@/lib/trip-quality';
import type { Trip } from '@/lib/types';

function buildTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip-1',
    createdAt: new Date('2026-04-01T09:00:00Z'),
    updatedAt: new Date('2026-04-01T09:00:00Z'),
    preferences: {
      origin: 'Paris',
      destination: 'Rome',
      startDate: new Date('2026-05-01T00:00:00Z'),
      durationDays: 3,
      transport: 'train',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'medium',
      activities: ['culture'],
      dietary: [],
      mustSee: '',
    },
    days: [
      {
        dayNumber: 1,
        date: new Date('2026-05-01T00:00:00Z'),
        items: [
          {
            id: 'item-1',
            dayNumber: 1,
            startTime: '09:00',
            endTime: '10:00',
            type: 'activity',
            title: 'Colisée',
            description: 'Visite',
            locationName: 'Rome',
            latitude: 41.89,
            longitude: 12.49,
            orderIndex: 0,
            bookingUrl: 'https://example.com/ticket',
            qualityFlags: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('getTripQualitySummary', () => {
  it('returns a healthy summary for a fully linked itinerary', () => {
    const summary = getTripQualitySummary(
      buildTrip({
        qualityMetrics: { score: 92, invariantsPassed: true, violations: [] },
      }),
    );

    expect(summary.status).toBe('healthy');
    expect(summary.bookingCoveragePercent).toBe(100);
    expect(summary.reviewPoints[0]).toMatch(/aucun signal bloquant/i);
  });

  it('flags missing booking links, fallbacks, and contract violations', () => {
    const summary = getTripQualitySummary(
      buildTrip({
        contractViolations: ['P0.3: Day 1 has no dinner'],
        qualityWarnings: ['restaurant selection degraded'],
        qualityMetrics: { score: 68, invariantsPassed: false, violations: ['P0.3'] },
        days: [
          {
            dayNumber: 1,
            date: new Date('2026-05-01T00:00:00Z'),
            items: [
              {
                id: 'item-1',
                dayNumber: 1,
                startTime: '09:00',
                endTime: '10:00',
                type: 'activity',
                title: 'Colisée',
                description: 'Visite',
                locationName: 'Rome',
                latitude: 41.89,
                longitude: 12.49,
                orderIndex: 0,
                qualityFlags: ['city_fallback'],
                selectionSource: 'fallback',
                dataReliability: 'estimated',
                geoConfidence: 'low',
              },
            ],
          },
        ],
      }),
    );

    expect(summary.status).toBe('critical');
    expect(summary.contractViolationCount).toBe(1);
    expect(summary.itemsMissingBookingInfo).toBe(1);
    expect(summary.fallbackCount).toBe(1);
    expect(summary.lowConfidenceCount).toBe(1);
    expect(summary.reviewPoints.join(' ')).toMatch(/sans lien exploitable/i);
  });
});

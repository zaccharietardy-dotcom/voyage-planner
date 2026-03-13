import type { Trip } from '../../../src/lib/types';
import {
  collectMissingMustSee,
  resolveRunComposition,
  selectDirectProfiles,
  selectSuggestionSpecs,
} from '../run-geo-campaign';

describe('run-geo-campaign helpers', () => {
  it('resolves explicit 2 direct + 1 suggestion composition for mini campaign', () => {
    const composition = resolveRunComposition(3, 2, 1);
    expect(composition.expectedDirectRuns).toBe(2);
    expect(composition.expectedSuggestionRuns).toBe(1);
  });

  it('throws when direct + suggestion exceeds max-runs', () => {
    expect(() => resolveRunComposition(3, 2, 2)).toThrow(/exceeds max-runs/i);
  });

  it('computes must-see coverage from attractionPool must-see IDs', () => {
    const trip = {
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-03-01T00:00:00.000Z'),
          items: [
            {
              id: 'must-1',
              dayNumber: 1,
              type: 'activity',
              title: 'Must One',
              description: 'Must One',
              locationName: 'Must One',
              startTime: '09:00',
              endTime: '10:00',
              latitude: 48.8566,
              longitude: 2.3522,
              orderIndex: 0,
              estimatedCost: 0,
            },
          ],
          isDayTrip: false,
        },
      ],
      attractionPool: [
        { id: 'must-1', name: 'Must One', mustSee: true },
        { id: 'must-2', name: 'Must Two', mustSee: true },
      ],
    } as unknown as Trip;

    const missing = collectMissingMustSee(trip, []);
    expect(missing).toEqual(['Must Two']);
  });

  it('falls back to parser logs when must-see warning is present', () => {
    const trip = {
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-03-01T00:00:00.000Z'),
          items: [],
          isDayTrip: false,
        },
      ],
      attractionPool: [],
    } as unknown as Trip;

    const missing = collectMissingMustSee(trip, [
      '[Pipeline V2] ⚠️ MUST-SEES MISSING FROM SCHEDULE: "A", "B"',
    ]);
    expect(missing.sort()).toEqual(['A', 'B']);
  });

  it('pins mini campaign direct runs to geo-direct-02 and geo-direct-08', () => {
    const profiles = [
      { id: 'geo-direct-01', groupType: 'solo', budgetLevel: 'economic', transport: 'train', activities: ['culture'], durationDays: 3, origin: 'Lyon' },
      { id: 'geo-direct-02', groupType: 'couple', budgetLevel: 'comfort', transport: 'plane', activities: ['culture'], durationDays: 5, origin: 'Paris' },
      { id: 'geo-direct-08', groupType: 'friends', budgetLevel: 'moderate', transport: 'optimal', activities: ['nightlife'], durationDays: 4, origin: 'Toulouse' },
    ] as any;
    const selected = selectDirectProfiles(profiles, 3, 2, 1);
    expect(selected.map((profile: any) => profile.id)).toEqual(['geo-direct-02', 'geo-direct-08']);
  });

  it('pins mini campaign suggestion to gastronomy query', () => {
    const specs = [
      {
        query: 'Je veux faire un break de 3 jours en Europe',
        context: { origin: 'Lyon', budgetLevel: 'moderate', groupType: 'solo', activities: ['culture'] },
      },
      {
        query: 'Je veux un city-break gastronomie pas cher depuis Lyon',
        context: { origin: 'Lyon', budgetLevel: 'economic', groupType: 'solo', activities: ['gastronomy'] },
      },
    ] as any;
    const selected = selectSuggestionSpecs(specs, 3, 2, 1);
    expect(selected).toHaveLength(1);
    expect(selected[0].query).toBe('Je veux un city-break gastronomie pas cher depuis Lyon');
  });
});

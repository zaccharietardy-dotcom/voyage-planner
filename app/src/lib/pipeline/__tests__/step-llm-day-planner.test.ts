import { buildPlannerCatalog, __test__ } from '../step-llm-day-planner';
import type { ActivityCluster, DayTripPack, ScoredActivity } from '../types';
import type { Restaurant } from '../../types';

function makeActivity(overrides: Partial<ScoredActivity> & Pick<ScoredActivity, 'id' | 'name'>): ScoredActivity {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type || 'culture',
    description: overrides.description || overrides.name,
    duration: overrides.duration ?? 90,
    estimatedCost: overrides.estimatedCost ?? 15,
    latitude: overrides.latitude ?? 48.8566,
    longitude: overrides.longitude ?? 2.3522,
    rating: overrides.rating ?? 4.5,
    mustSee: overrides.mustSee ?? false,
    bookingRequired: overrides.bookingRequired ?? false,
    openingHours: overrides.openingHours || { open: '09:00', close: '18:00' },
    score: overrides.score ?? 20,
    source: overrides.source || 'google_places',
    reviewCount: overrides.reviewCount ?? 1000,
    protectedReason: overrides.protectedReason,
    openingHoursByDay: overrides.openingHoursByDay,
    ...overrides,
  };
}

function makeCluster(dayNumber: number, activities: ScoredActivity[], overrides: Partial<ActivityCluster> = {}): ActivityCluster {
  return {
    dayNumber,
    activities,
    centroid: {
      lat: activities.reduce((sum, activity) => sum + activity.latitude, 0) / activities.length,
      lng: activities.reduce((sum, activity) => sum + activity.longitude, 0) / activities.length,
    },
    totalIntraDistance: 0,
    ...overrides,
  };
}

describe('step-llm-day-planner', () => {
  it('builds a catalog with fixed must-sees and typed candidates', () => {
    const fixed = makeActivity({ id: 'ms-1', name: 'Mont Saint-Michel', mustSee: true, source: 'mustsee' });
    const movable = makeActivity({ id: 'act-2', name: 'Atelier local', mustSee: false, source: 'google_places' });
    const clusters: ActivityCluster[] = [
      makeCluster(1, [fixed, movable], { isDayTrip: false }),
    ];
    const restaurants: Restaurant[] = [{
      id: 'r-1',
      name: 'Crêperie test',
      address: 'Saint-Malo',
      latitude: 48.648,
      longitude: -2.025,
      rating: 4.4,
      reviewCount: 123,
      priceLevel: 2,
      cuisineTypes: ['creperie'],
      dietaryOptions: ['none'],
      openingHours: {} as any,
    }];

    const catalog = buildPlannerCatalog(clusters, restaurants, [] as DayTripPack[], 'Bretagne', 'spread');
    const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
    expect(activityCandidates.length).toBe(2);

    const fixedCandidate = activityCandidates.find((candidate) => candidate.sourceId === 'ms-1');
    expect(fixedCandidate?.fixedDayNumber).toBe(1);
    expect(fixedCandidate?.kind).toBe('iconic');

    const movableCandidate = activityCandidates.find((candidate) => candidate.sourceId === 'act-2');
    expect(movableCandidate?.fixedDayNumber).toBeUndefined();
    expect(movableCandidate?.kind).toBe('local_gem');

    const restCandidate = catalog.candidates.find((candidate) => candidate.type === 'restaurant');
    expect(restCandidate).toBeDefined();
  });

  it('normalizes hints, ignores unknown IDs, and keeps fixed activities on their day', () => {
    const fixed = makeActivity({ id: 'fix-1', name: 'Fixed Must See', mustSee: true, source: 'mustsee' });
    const movableA = makeActivity({ id: 'mov-a', name: 'Movable A', mustSee: false, source: 'google_places', latitude: 48.86, longitude: 2.35 });
    const movableB = makeActivity({ id: 'mov-b', name: 'Movable B', mustSee: false, source: 'google_places', latitude: 48.87, longitude: 2.34 });

    const clusters: ActivityCluster[] = [
      makeCluster(1, [fixed, movableA]),
      makeCluster(2, [movableB]),
    ];
    const catalog = buildPlannerCatalog(clusters, [], [] as DayTripPack[], 'Bretagne', 'spread');

    const fixedCandidateId = catalog.candidates.find((candidate) => candidate.sourceId === 'fix-1')?.candidateId;
    const movableCandidateId = catalog.candidates.find((candidate) => candidate.sourceId === 'mov-b')?.candidateId;
    expect(fixedCandidateId).toBeDefined();
    expect(movableCandidateId).toBeDefined();

    const parsed = __test__.parseDayHints(JSON.stringify({
      days: [
        // Try to move fixed item to day 2 and include unknown ID
        { dayNumber: 2, candidateIds: [fixedCandidateId, movableCandidateId, 'act:unknown'] },
      ],
    }));
    expect(parsed).not.toBeNull();

    const rebuilt = __test__.rebuildClustersFromHints(parsed!, catalog, clusters);
    expect(rebuilt.invalidCandidateRefs).toContain('act:unknown');
    expect(rebuilt.groundingRate).toBeLessThan(1);
    expect(rebuilt.unknownIdRate).toBeGreaterThan(0);

    const day1Ids = new Set(rebuilt.clusters[0].activities.map((activity) => activity.id));
    const day2Ids = new Set(rebuilt.clusters[1].activities.map((activity) => activity.id));

    // Fixed activity must stay in day 1 despite hint request.
    expect(day1Ids.has('fix-1')).toBe(true);
    // Known movable ID should remain scheduled.
    expect(day2Ids.has('mov-b') || day1Ids.has('mov-b')).toBe(true);
    // No day should be empty after fallback fill.
    expect(rebuilt.clusters.every((cluster) => cluster.activities.length > 0)).toBe(true);
  });

  it('uses strict JSON parsing for day hints', () => {
    const invalidWrapped = 'Voici le plan:\\n{\"days\":[{\"dayNumber\":1,\"candidateIds\":[\"act:abc\"]}]}';
    expect(__test__.parseDayHints(invalidWrapped)).toBeNull();

    const strictJson = '{"days":[{"dayNumber":1,"candidateIds":["act:abc"],"theme":"test"}]}';
    const parsed = __test__.parseDayHints(strictJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.days[0].dayNumber).toBe(1);
  });

  it('computes an adaptive feasible ratio band for skewed catalogs', () => {
    const iconic = Array.from({ length: 5 }, (_, idx) => makeActivity({
      id: `iconic-${idx + 1}`,
      name: `Iconic ${idx + 1}`,
      mustSee: true,
      source: 'mustsee',
      latitude: 48.85 + idx * 0.001,
      longitude: 2.35 + idx * 0.001,
    }));
    const local = makeActivity({
      id: 'local-1',
      name: 'Pepite locale',
      mustSee: false,
      source: 'google_places',
      latitude: 48.861,
      longitude: 2.349,
    });
    const catalog = buildPlannerCatalog([makeCluster(1, [...iconic, local])], [], [] as DayTripPack[], 'Bretagne', 'spread');
    const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
    const band = __test__.computeFeasibleRatioBand(activityCandidates);
    expect(band.catalogIconicRatio).toBeCloseTo(0.833, 2);
    expect(band.lower).toBeCloseTo(0.733, 2);
    expect(band.upper).toBe(0.8);
  });

  it('applies constrained drops and keeps llm_locked routing', () => {
    const fixed = makeActivity({ id: 'fix-1', name: 'Anchor fixe', mustSee: true, source: 'mustsee', latitude: 48.8, longitude: -2.0 });
    const movablesDay1 = Array.from({ length: 4 }, (_, idx) => makeActivity({
      id: `d1-m-${idx + 1}`,
      name: `Movable D1 ${idx + 1}`,
      latitude: 48.81 + idx * 0.002,
      longitude: -2.01 + idx * 0.002,
    }));
    const movablesDay2 = Array.from({ length: 4 }, (_, idx) => makeActivity({
      id: `d2-m-${idx + 1}`,
      name: `Movable D2 ${idx + 1}`,
      latitude: 48.90 + idx * 0.002,
      longitude: -2.11 + idx * 0.002,
    }));

    const clusters: ActivityCluster[] = [
      makeCluster(1, [fixed, ...movablesDay1]),
      makeCluster(2, [...movablesDay2]),
    ];
    const catalog = buildPlannerCatalog(clusters, [], [] as DayTripPack[], 'Bretagne', 'spread');
    const fixedCandidateId = catalog.candidates.find((candidate) => candidate.sourceId === 'fix-1')?.candidateId;
    expect(fixedCandidateId).toBeDefined();

    const parsed = __test__.parseDayHints(JSON.stringify({
      days: [
        {
          dayNumber: 1,
          candidateIds: [fixedCandidateId].filter((value): value is string => Boolean(value)),
          dropCandidateIds: movablesDay1
            .map((a) => catalog.candidates.find((c) => c.sourceId === a.id)?.candidateId)
            .filter((value): value is string => Boolean(value)),
        },
        { dayNumber: 2, candidateIds: [] },
      ],
    }));
    expect(parsed).not.toBeNull();

    const rebuilt = __test__.rebuildClustersFromHints(parsed!, catalog, clusters);
    expect(rebuilt.requestedDropCount).toBeGreaterThan(0);
    expect(rebuilt.acceptedDropCount).toBeLessThanOrEqual(1); // floor(15% of 8 movables) => 1
    expect(rebuilt.clusters.every((cluster) => cluster.activities.length >= 2)).toBe(true);
    expect(rebuilt.clusters.every((cluster) => cluster.routingPolicy === 'llm_locked')).toBe(true);

    const day1Ids = new Set(rebuilt.clusters[0].activities.map((activity) => activity.id));
    expect(day1Ids.has('fix-1')).toBe(true);
  });
});

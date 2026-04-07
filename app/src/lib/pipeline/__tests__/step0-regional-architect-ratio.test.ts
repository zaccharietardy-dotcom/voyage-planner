import {
  computeBlueprintRatio,
  enforceBlueprintRatio,
  type RegionalBlueprint,
  type RegionalDayAnchor,
} from '../step0-regional-architect';

function makeBlueprint(dayAnchors: RegionalDayAnchor[]): RegionalBlueprint {
  return {
    mode: 'road_trip',
    hubs: [
      { city: 'Saint-Malo', days: 2 },
      { city: 'Brest', days: 2 },
    ],
    dayAnchors,
    confidence: 0.7,
    source: 'gemini',
    cacheKey: 'test-blueprint',
    createdAt: '2026-01-01T00:00:00.000Z',
    ratioTarget: {
      iconic: 0.6,
      localGem: 0.4,
      minIconic: 0.55,
      maxIconic: 0.65,
    },
    ratioActual: { iconic: 1, localGem: 0 },
    diagnostics: {
      validationLatencyMs: 0,
      providerCallBreakdown: {},
      parallelismStats: {
        scheduled: 0,
        deduped: 0,
        settled: 0,
        fulfilled: 0,
        rejected: 0,
        retries: 0,
        maxInFlight: 0,
        maxInFlightByProvider: {},
      },
      ratioRegenerationCount: 0,
      ratioAutoAdjustments: 0,
    },
  };
}

describe('regional architect ratio enforcer', () => {
  it('rebalances a blueprint with too many iconic items', () => {
    const blueprint = makeBlueprint([
      {
        dayNumber: 1,
        stayCity: 'Saint-Malo',
        zone: 'Intra-muros',
        poiCandidates: [
          { name: 'Remparts', kind: 'iconic' },
          { name: 'Grand Bé', kind: 'iconic' },
          { name: 'Port', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
      {
        dayNumber: 2,
        stayCity: 'Saint-Malo',
        zone: 'Cancale',
        poiCandidates: [
          { name: 'Cancale Port', kind: 'iconic' },
          { name: 'Marché', kind: 'iconic' },
          { name: 'Pointe du Grouin', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
      {
        dayNumber: 3,
        stayCity: 'Brest',
        zone: 'Centre',
        poiCandidates: [
          { name: 'Recouvrance', kind: 'iconic' },
          { name: 'Ateliers des Capucins', kind: 'iconic' },
          { name: 'Port de plaisance', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
      {
        dayNumber: 4,
        stayCity: 'Brest',
        zone: 'Crozon',
        poiCandidates: [
          { name: 'Pointe de Pen-Hir', kind: 'iconic' },
          { name: 'Camaret', kind: 'iconic' },
          { name: 'Tas de Pois', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
    ]);

    const { blueprint: enforced, adjustments } = enforceBlueprintRatio(blueprint);
    const ratio = computeBlueprintRatio(enforced);

    expect(adjustments).toBeGreaterThan(0);
    expect(ratio.iconic).toBeGreaterThanOrEqual(0.55);
    expect(ratio.iconic).toBeLessThanOrEqual(0.65);
    expect(
      enforced.dayAnchors.every((anchor) =>
        anchor.poiCandidates.some((candidate) => candidate.kind === 'local_gem')
      )
    ).toBe(true);
  });

  it('rebalances a blueprint with too many local gems while keeping at least one gem/day', () => {
    const blueprint = makeBlueprint([
      {
        dayNumber: 1,
        stayCity: 'Dinan',
        zone: 'Centre historique',
        poiCandidates: [
          { name: 'Rue du Jerzual', kind: 'local_gem' },
          { name: 'Port de Dinan', kind: 'local_gem' },
          { name: 'Château de Dinan', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
      {
        dayNumber: 2,
        stayCity: 'Dinan',
        zone: 'Rance',
        poiCandidates: [
          { name: 'Chemin de halage', kind: 'local_gem' },
          { name: 'Bords de Rance', kind: 'local_gem' },
          { name: 'Basilique Saint-Sauveur', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
      {
        dayNumber: 3,
        stayCity: 'Lannion',
        zone: 'Côte de Granit Rose',
        poiCandidates: [
          { name: 'Ploumanac’h', kind: 'local_gem' },
          { name: 'Sentier des douaniers', kind: 'local_gem' },
          { name: 'Phare de Mean Ruz', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
      {
        dayNumber: 4,
        stayCity: 'Lannion',
        zone: 'Perros-Guirec',
        poiCandidates: [
          { name: 'Plage de Trestraou', kind: 'local_gem' },
          { name: 'Village de pêcheurs', kind: 'local_gem' },
          { name: 'Oratoire de Saint-Guirec', kind: 'iconic' },
        ],
        resolvedPois: [],
      },
    ]);

    const { blueprint: enforced, adjustments } = enforceBlueprintRatio(blueprint);
    const ratio = computeBlueprintRatio(enforced);

    expect(adjustments).toBeGreaterThan(0);
    expect(ratio.iconic).toBeGreaterThanOrEqual(0.55);
    expect(ratio.iconic).toBeLessThanOrEqual(0.65);
    expect(
      enforced.dayAnchors.every((anchor) =>
        anchor.poiCandidates.filter((candidate) => candidate.kind === 'local_gem').length >= 1
      )
    ).toBe(true);
  });
});

import type { DestinationSuggestion } from '@/lib/types';
import { __suggestionsTestables } from '@/lib/services/suggestions';

const { inferSuggestionIntent, enforceSuggestionQuality } = __suggestionsTestables;

describe('suggestions warm-swim quality guards', () => {
  it('detects warm swim intent from beach + summer query', () => {
    const intent = inferSuggestionIntent('je veux me baigner en ete avec des plages', {
      activities: ['beach', 'wellness'],
      budgetLevel: 'moderate',
      durationDays: 4,
    });

    expect(intent.wantsBeach).toBe(true);
    expect(intent.wantsSummer).toBe(true);
    expect(intent.wantsWarmSwim).toBe(true);
  });

  it('filters cold-water suggestions and backfills to 4 ideas', () => {
    const raw: DestinationSuggestion[] = [
      {
        title: 'Achill Head : immersion totale plage et nature',
        type: 'single_city',
        stages: [{ city: 'Achill Island', days: 4 }],
        highlights: ['Plages sauvages', 'Randonnée côtière', 'Eaux fraîches'],
        description: 'Séjour côtier en Irlande.',
        estimatedBudget: '500-700€',
        bestSeason: 'Juin à septembre',
      },
      {
        title: 'Achill version 2',
        type: 'single_city',
        stages: [{ city: 'Achill Island', days: 4 }],
        highlights: ['Duplicate', 'Duplicate', 'Duplicate'],
        description: 'Variante du même lieu.',
        estimatedBudget: '520-720€',
        bestSeason: 'Juin à septembre',
      },
    ];

    const fixed = enforceSuggestionQuality(raw, 'plage ete je veux me baigner', {
      activities: ['beach', 'nature'],
      budgetLevel: 'economic',
      durationDays: 4,
      origin: 'Paris',
    });

    expect(fixed).toHaveLength(4);
    expect(fixed.every((s) => !/achill|ireland|irlande/i.test(`${s.title} ${s.stages[0]?.city || ''}`))).toBe(true);
    const primaryCities = new Set(fixed.map((s) => (s.stages[0]?.city || '').toLowerCase()));
    expect(primaryCities.size).toBe(4);
  });
});


import { generateDestinationSuggestions } from '../src/lib/services/suggestions';
import { generateTripV2 } from '../src/lib/pipeline';
import { loadEnvLocal } from './debug-pipeline/generate-trip';
import type { TripPreferences } from '../src/lib/types';

loadEnvLocal('/Users/zak/voyage-planner/app/.env.local');

(async () => {
  const query = 'Je ne sais pas où aller, je veux un voyage solo culture et food en mars';
  const suggestions = await generateDestinationSuggestions(query, {
    origin: 'Palaiseau',
    groupType: 'solo',
    budgetLevel: 'moderate',
  });

  if (!suggestions.length) {
    console.log(JSON.stringify({ ok: false, reason: 'no_suggestions' }));
    process.exit(0);
  }

  const selected = suggestions[0];
  const durationDays = selected.stages.reduce((sum, s) => sum + s.days, 0);

  const prefs: TripPreferences = {
    origin: 'Palaiseau',
    destination: selected.stages[0].city,
    startDate: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000),
    durationDays,
    transport: 'optimal',
    carRental: false,
    groupSize: 1,
    groupType: 'solo',
    budgetLevel: 'moderate',
    activities: ['culture', 'gastronomy'],
    dietary: ['none'],
    mustSee: '',
    tripMode: 'precise',
    cityPlan: selected.stages.map((s) => ({ city: s.city, days: s.days })),
  };

  const started = Date.now();
  const trip = await generateTripV2(prefs);
  const durationMs = Date.now() - started;

  const longhaulCount = trip.days
    .flatMap((d) => d.items)
    .filter((i) => i.type === 'transport' && i.transportRole === 'longhaul').length;

  const output = {
    ok: true,
    suggestion: {
      title: selected.title,
      type: selected.type,
      stages: selected.stages,
    },
    generation: {
      destination: trip.preferences.destination,
      daysRequested: prefs.durationDays,
      daysGenerated: trip.days.length,
      totalItems: trip.days.reduce((sum, d) => sum + d.items.length, 0),
      totalEstimatedCost: trip.totalEstimatedCost,
      durationSec: Number((durationMs / 1000).toFixed(1)),
      longhaulCount,
    },
  };

  console.log(JSON.stringify(output, null, 2));
})();

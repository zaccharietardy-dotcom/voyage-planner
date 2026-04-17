import { buildCatalog, CatalogTooSparseError } from '../src/lib/pipeline-v4/catalog';
import { designTrip } from '../src/lib/pipeline-v4/llm-trip-designer';
import type { TripPreferences } from '../src/lib/types';

const preferences: TripPreferences = {
  origin: 'Paris',
  destination: 'Florence',
  startDate: new Date('2026-06-15'),
  durationDays: 3,
  groupSize: 2,
  groupType: 'couple' as any,
  transport: 'train' as any,
  carRental: false,
  budgetLevel: 'mid' as any,
  activities: ['culture', 'food'] as any,
  dietary: [] as any,
};

async function main() {
  console.log('=== Phase 1: buildCatalog ===');
  const t0 = Date.now();
  try {
    const { catalog, stats } = await buildCatalog(preferences, (label) => console.log('  >', label));
    console.log(`catalog built in ${Date.now() - t0}ms`);
    console.log('stats:', JSON.stringify(stats, null, 2));
    console.log('cities:', Object.keys(catalog));
    for (const [slug, city] of Object.entries(catalog)) {
      console.log(`  ${slug}: attractions=${city.attractions.length} restaurants=${city.restaurants.length} breakfast=${city.breakfast.length} bars=${city.bars.length}`);
      console.log(`    first attraction: ${city.attractions[0]?.alias} "${city.attractions[0]?.name}" rating=${city.attractions[0]?.rating}`);
      console.log(`    first restaurant: ${city.restaurants[0]?.alias} "${city.restaurants[0]?.name}" cuisines=${city.restaurants[0]?.cuisines?.join(',')}`);
    }

    console.log('\n=== Phase 2: designTrip with catalog ===');
    const t1 = Date.now();
    const { design, latencyMs, parseAttempts } = await designTrip(
      preferences,
      (label) => console.log('  >', label),
      catalog,
    );
    console.log(`design completed in ${Date.now() - t1}ms (gemini ${latencyMs}ms, parseAttempts=${parseAttempts})`);
    console.log(`days=${design.days.length} hubs=${design.hubs.length}`);

    let withAlias = 0;
    let withoutAlias = 0;
    let totalItems = 0;
    for (const day of design.days) {
      for (const item of day.items) {
        totalItems += 1;
        if (item.catalogAlias) withAlias += 1;
        else withoutAlias += 1;
      }
    }
    const groundingRate = totalItems > 0 ? withAlias / totalItems : 0;
    console.log(`items total=${totalItems} withCatalogAlias=${withAlias} withoutAlias=${withoutAlias} groundingRate=${(groundingRate * 100).toFixed(1)}%`);
    console.log('\nDay 1 items:');
    for (const item of design.days[0]?.items || []) {
      console.log(`  - ${item.type} ${item.startTime} (${item.duration}m) alias=${item.catalogAlias || '—'} "${item.name}"`);
    }
  } catch (err) {
    if (err instanceof CatalogTooSparseError) {
      console.error('CATALOG TOO SPARSE:', err.message);
      process.exit(2);
    }
    console.error('smoke failed:', err);
    process.exit(1);
  }
}

main();

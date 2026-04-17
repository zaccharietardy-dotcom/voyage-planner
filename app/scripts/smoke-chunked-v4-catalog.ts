import { createInitialChunkStageState, runChunkStage } from '../src/app/api/generate/chunkedOrchestrator';
import type { TripPreferences } from '../src/lib/types';

const preferences = {
  origin: 'Paris',
  destination: 'Florence',
  startDate: new Date('2026-06-15'),
  durationDays: 3,
  groupSize: 2,
  groupType: 'couple' as any,
  transport: 'train' as any,
  carRental: false,
  budgetLevel: 'moderate' as any,
  activities: ['culture', 'food'] as any,
  dietary: [] as any,
} as unknown as TripPreferences;

async function main() {
  console.log('=== Initial state ===');
  const state = createInitialChunkStageState(preferences);
  console.log('  stage:', state.stage);
  console.log('  catalog flag:', process.env.PIPELINE_V4_CATALOG || '(off)');

  let current = state;
  let iterations = 0;
  const t0 = Date.now();

  while (current.stage !== 'done' && iterations < 50) {
    iterations += 1;
    console.log(`\n--- iter ${iterations} | stage=${current.stage} ---`);
    try {
      const result = await runChunkStage(current, { stageBudgetMs: 60_000 });
      current = result.stageState;
      if (result.status === 'question') {
        const defaultOpt = result.question?.options.find((o) => o.isDefault) || result.question?.options[0];
        console.log(`  auto-answering question ${result.question?.questionId} with "${defaultOpt?.id}"`);
        // Simulate auto-default answer
        if (current.pendingQuestion && defaultOpt) {
          current.pendingQuestion.selectedOptionId = defaultOpt.id;
          current.pendingQuestion.answeredAt = new Date().toISOString();
          current.pendingQuestion.autoDefault = true;
        }
      }
    } catch (err) {
      console.error('  stage error:', err);
      throw err;
    }
  }

  const totalMs = Date.now() - t0;
  console.log(`\n=== DONE in ${iterations} iterations, ${totalMs}ms ===`);
  console.log('  final stage:', current.stage);

  const trip = current.artifacts.builtTrip;
  if (!trip) {
    console.error('  NO TRIP BUILT');
    process.exit(1);
  }

  console.log('\n=== Trip summary ===');
  console.log('  days:', trip.days.length);
  for (const day of trip.days) {
    console.log(`\n  Day ${day.dayNumber} (${day.theme || '—'})`);
    for (const item of day.items) {
      const reliab = (item as any).dataReliability || '—';
      const src = (item as any).geoSource || '—';
      console.log(`    ${item.startTime} ${item.type.padEnd(12)} "${item.title}" [${reliab}/${src}]`);
    }
  }

  console.log('\n=== Transport items (KEY BUSINESS CHECK) ===');
  const allItems = trip.days.flatMap((d) => d.items);
  const flights = allItems.filter((i) => i.type === 'flight');
  const transports = allItems.filter((i) => i.type === 'transport');
  const checkins = allItems.filter((i) => i.type === 'checkin');
  console.log('  flights:', flights.length, flights.map((f) => ({ day: f.dayNumber, title: f.title, booking: (f as any).bookingUrl?.slice(0, 60), aviasales: (f as any).aviasalesUrl?.slice(0, 60) })));
  console.log('  transport:', transports.length, transports.map((t) => ({ day: t.dayNumber, title: t.title, booking: (t as any).bookingUrl?.slice(0, 60) })));
  console.log('  checkins:', checkins.length, checkins.map((c) => ({ day: c.dayNumber, title: c.title })));

  console.log('\n=== Grounding ===');
  const catalogMode = !!current.artifacts.catalog;
  console.log('  catalog mode:', catalogMode);
  if (catalogMode) {
    console.log('  catalog stats:', current.artifacts.catalogStats);
  }
  const items = allItems.filter((i) => i.type === 'activity' || i.type === 'restaurant' || i.type === 'bar');
  const verified = items.filter((i) => (i as any).dataReliability === 'verified');
  console.log(`  items: ${items.length}, verified: ${verified.length} (${items.length ? ((verified.length / items.length) * 100).toFixed(0) : 0}%)`);

  console.log('\n=== Contracts quick check ===');
  for (const day of trip.days) {
    const hasLunch = day.items.some((i) => (i as any).mealType === 'lunch');
    const hasDinner = day.items.some((i) => (i as any).mealType === 'dinner');
    console.log(`  Day ${day.dayNumber}: lunch=${hasLunch} dinner=${hasDinner}`);
  }
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});

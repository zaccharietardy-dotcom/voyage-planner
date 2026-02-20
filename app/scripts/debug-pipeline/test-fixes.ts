#!/usr/bin/env npx tsx
/**
 * Test des 7 fixes pipeline - Generate trips and export JSON for verification
 */
import { loadEnvLocal, generateTripRun, saveResult, assertRequiredEnv, getEnvHealth } from './generate-trip';

loadEnvLocal();

import { TripPreferences } from '../../src/lib/types';

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

const LYON_MILAN: TripPreferences = {
  origin: 'Lyon',
  destination: 'Milan',
  startDate: futureDate(3),
  durationDays: 5,
  transport: 'optimal',
  carRental: false,
  groupSize: 1,
  groupType: 'solo',
  budgetLevel: 'moderate',
  activities: ['culture', 'gastronomy'],
  dietary: ['none'],
  mustSee: 'Duomo, La Scala',
  tripMode: 'precise',
  cityPlan: [{ city: 'Milan', days: 5 }],
};

const PARIS_ROME: TripPreferences = {
  origin: 'Paris',
  destination: 'Rome',
  startDate: futureDate(5),
  durationDays: 4,
  transport: 'optimal',
  carRental: false,
  groupSize: 2,
  groupType: 'couple',
  budgetLevel: 'moderate',
  activities: ['culture', 'gastronomy'],
  dietary: ['none'],
  mustSee: 'Colisée, Vatican',
  tripMode: 'precise',
  cityPlan: [{ city: 'Rome', days: 4 }],
};

async function main() {
  assertRequiredEnv(['ANTHROPIC_API_KEY']);
  console.log('🔑 ENV:', getEnvHealth());

  const scenario = process.argv[2] || 'lyon-milan';

  if (scenario === 'lyon-milan') {
    console.log('\n🧪 Test: Lyon → Milan 5j (train scenario for Fix 1/2/3/4/5)');
    const result = await generateTripRun('lyon-milan-5d-test', LYON_MILAN);
    const filepath = saveResult(result, { outDir: __dirname + '/results/test-fixes' });
    console.log(`\n📁 Result: ${filepath}`);
  } else if (scenario === 'paris-rome') {
    console.log('\n🧪 Test: Paris → Rome 4j');
    const result = await generateTripRun('paris-rome-4d-test', PARIS_ROME);
    const filepath = saveResult(result, { outDir: __dirname + '/results/test-fixes' });
    console.log(`\n📁 Result: ${filepath}`);
  } else if (scenario === 'both') {
    console.log('\n🧪 Running both tests sequentially...');

    const r1 = await generateTripRun('lyon-milan-5d-test', LYON_MILAN);
    saveResult(r1, { outDir: __dirname + '/results/test-fixes' });

    const r2 = await generateTripRun('paris-rome-4d-test', PARIS_ROME);
    saveResult(r2, { outDir: __dirname + '/results/test-fixes' });
  }
}

main().catch(console.error);

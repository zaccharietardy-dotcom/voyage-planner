#!/usr/bin/env npx tsx
/**
 * Stress-test Gemini 2.5 Flash: 10 voyages très variés
 * Durée, destination, thème, groupe, budget — tout change.
 *
 * Usage:
 *   npx tsx scripts/debug-pipeline/stress-test-gemini.ts
 *   npx tsx scripts/debug-pipeline/stress-test-gemini.ts 3   # run scenario #3 only
 */
import { loadEnvLocal, generateTripRun, saveResult, assertRequiredEnv, getEnvHealth } from './generate-trip';

loadEnvLocal();

import { TripPreferences } from '../../src/lib/types';

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

// ============================================
// 10 scenarios très variés
// ============================================

const SCENARIOS: Array<{ id: string; label: string; prefs: TripPreferences }> = [
  // 1. Court séjour week-end — 2 jours, solo backpacker
  {
    id: 'amsterdam-weekend-2d',
    label: 'Amsterdam 2j solo backpacker nightlife',
    prefs: {
      origin: 'Bruxelles',
      destination: 'Amsterdam',
      startDate: futureDate(4),
      durationDays: 2,
      transport: 'optimal',
      carRental: false,
      groupSize: 1,
      groupType: 'solo',
      budgetLevel: 'economic',
      activities: ['nightlife', 'culture'],
      dietary: ['none'],
      mustSee: 'Rijksmuseum',
      tripMode: 'precise',
      cityPlan: [{ city: 'Amsterdam', days: 2 }],
    },
  },

  // 2. Long trip — 7 jours, couple luxe
  {
    id: 'tokyo-7d-luxury',
    label: 'Tokyo 7j couple luxury culture+gastro',
    prefs: {
      origin: 'Paris',
      destination: 'Tokyo',
      startDate: futureDate(10),
      durationDays: 7,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'luxury',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Senso-ji, Shibuya, Meiji Shrine',
      tripMode: 'precise',
      cityPlan: [{ city: 'Tokyo', days: 7 }],
    },
  },

  // 3. Famille avec enfants — 4 jours, activités nature
  {
    id: 'barcelona-family-4d',
    label: 'Barcelone 4j famille+enfants nature+beach',
    prefs: {
      origin: 'Lyon',
      destination: 'Barcelona',
      startDate: futureDate(7),
      durationDays: 4,
      transport: 'optimal',
      carRental: false,
      groupSize: 4,
      groupType: 'family_with_kids',
      budgetLevel: 'moderate',
      activities: ['beach', 'nature', 'culture'],
      dietary: ['none'],
      mustSee: 'Sagrada Familia, Park Güell',
      tripMode: 'precise',
      cityPlan: [{ city: 'Barcelona', days: 4 }],
    },
  },

  // 4. Trip très court — 3 jours, amis aventure
  {
    id: 'lisbon-adventure-3d',
    label: 'Lisbonne 3j amis aventure+gastro',
    prefs: {
      origin: 'Marseille',
      destination: 'Lisbon',
      startDate: futureDate(5),
      durationDays: 3,
      transport: 'optimal',
      carRental: false,
      groupSize: 5,
      groupType: 'friends',
      budgetLevel: 'economic',
      activities: ['adventure', 'gastronomy'],
      dietary: ['vegetarian'],
      mustSee: 'Torre de Belém, Alfama',
      tripMode: 'precise',
      cityPlan: [{ city: 'Lisbon', days: 3 }],
    },
  },

  // 5. Wellness trip — 6 jours, couple détente
  {
    id: 'bali-wellness-6d',
    label: 'Bali 6j couple wellness+nature',
    prefs: {
      origin: 'Paris',
      destination: 'Bali',
      startDate: futureDate(14),
      durationDays: 6,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'comfort',
      activities: ['wellness', 'nature'],
      dietary: ['vegan'],
      mustSee: 'Ubud Rice Terraces, Tanah Lot',
      tripMode: 'precise',
      cityPlan: [{ city: 'Bali', days: 6 }],
    },
  },

  // 6. City break shopping — 3 jours, amies
  {
    id: 'london-shopping-3d',
    label: 'Londres 3j amis shopping+culture',
    prefs: {
      origin: 'Paris',
      destination: 'London',
      startDate: futureDate(3),
      durationDays: 3,
      transport: 'optimal',
      carRental: false,
      groupSize: 3,
      groupType: 'friends',
      budgetLevel: 'comfort',
      activities: ['shopping', 'culture'],
      dietary: ['none'],
      mustSee: 'British Museum, Tower of London',
      tripMode: 'precise',
      cityPlan: [{ city: 'London', days: 3 }],
    },
  },

  // 7. Long trip nature — 5 jours, solo aventurier
  {
    id: 'reykjavik-nature-5d',
    label: 'Reykjavik 5j solo nature+adventure economic',
    prefs: {
      origin: 'Paris',
      destination: 'Reykjavik',
      startDate: futureDate(8),
      durationDays: 5,
      transport: 'optimal',
      carRental: false,
      groupSize: 1,
      groupType: 'solo',
      budgetLevel: 'economic',
      activities: ['nature', 'adventure'],
      dietary: ['none'],
      mustSee: 'Blue Lagoon, Golden Circle',
      tripMode: 'precise',
      cityPlan: [{ city: 'Reykjavik', days: 5 }],
    },
  },

  // 8. Gastro trip court — 2 jours, couple
  {
    id: 'naples-gastro-2d',
    label: 'Naples 2j couple gastro+culture moderate',
    prefs: {
      origin: 'Rome',
      destination: 'Naples',
      startDate: futureDate(3),
      durationDays: 2,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'moderate',
      activities: ['gastronomy', 'culture'],
      dietary: ['none'],
      mustSee: 'Pompei, Spaccanapoli',
      tripMode: 'precise',
      cityPlan: [{ city: 'Naples', days: 2 }],
    },
  },

  // 9. Famille sans enfants — 4 jours, confort
  {
    id: 'prague-culture-4d',
    label: 'Prague 4j famille culture+gastro comfort',
    prefs: {
      origin: 'Berlin',
      destination: 'Prague',
      startDate: futureDate(6),
      durationDays: 4,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'family_without_kids',
      budgetLevel: 'comfort',
      activities: ['culture', 'gastronomy'],
      dietary: ['gluten_free'],
      mustSee: 'Prague Castle, Charles Bridge',
      tripMode: 'precise',
      cityPlan: [{ city: 'Prague', days: 4 }],
    },
  },

  // 10. Long trip exotique — 7 jours, amis beach+nightlife
  {
    id: 'marrakech-7d-friends',
    label: 'Marrakech 7j amis culture+adventure economic',
    prefs: {
      origin: 'Paris',
      destination: 'Marrakech',
      startDate: futureDate(12),
      durationDays: 7,
      transport: 'optimal',
      carRental: false,
      groupSize: 6,
      groupType: 'friends',
      budgetLevel: 'economic',
      activities: ['culture', 'adventure', 'gastronomy'],
      dietary: ['halal'],
      mustSee: 'Jardin Majorelle, Médina, Jemaa el-Fna',
      tripMode: 'precise',
      cityPlan: [{ city: 'Marrakech', days: 7 }],
    },
  },
];

// ============================================
// Main
// ============================================

interface ScenarioResult {
  id: string;
  label: string;
  score: number | null;
  activities: number;
  meals: number;
  items: number;
  days: number;
  llmTimeMs: number;
  totalTimeMs: number;
  enrichments: number;
  sanitized: number;
  error: string | null;
  filepath: string | null;
}

async function main() {
  assertRequiredEnv(['GOOGLE_AI_API_KEY']);
  console.log('🔑 ENV:', getEnvHealth());

  const singleIdx = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const scenariosToRun = singleIdx !== null
    ? [SCENARIOS[singleIdx - 1]].filter(Boolean)
    : SCENARIOS;

  if (scenariosToRun.length === 0) {
    console.error(`❌ Scenario #${singleIdx} not found (1-${SCENARIOS.length})`);
    process.exit(1);
  }

  console.log(`\n🚀 Running ${scenariosToRun.length} scenarios with Gemini 2.5 Flash\n`);

  const results: ScenarioResult[] = [];
  const outDir = __dirname + '/results/stress-test-gemini';

  for (let i = 0; i < scenariosToRun.length; i++) {
    const s = scenariosToRun[i];
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📍 [${i + 1}/${scenariosToRun.length}] ${s.label}`);
    console.log(`${'='.repeat(70)}\n`);

    const startTime = Date.now();
    try {
      const result = await generateTripRun(s.id, s.prefs);
      const filepath = saveResult(result, { outDir });
      const elapsed = Date.now() - startTime;

      // Extract metrics from console output
      const trip = result.trip;
      const totalItems = trip?.days?.reduce((sum: number, d: any) => sum + (d.items?.length || 0), 0) || 0;
      const totalActivities = trip?.days?.reduce((sum: number, d: any) =>
        sum + (d.items?.filter((it: any) => it.type === 'activity').length || 0), 0) || 0;
      const totalMeals = trip?.days?.reduce((sum: number, d: any) =>
        sum + (d.items?.filter((it: any) => it.type === 'restaurant').length || 0), 0) || 0;

      results.push({
        id: s.id,
        label: s.label,
        score: trip?.qualityScore || null,
        activities: totalActivities,
        meals: totalMeals,
        items: totalItems,
        days: trip?.days?.length || 0,
        llmTimeMs: 0, // captured in logs
        totalTimeMs: elapsed,
        enrichments: 0,
        sanitized: 0,
        error: null,
        filepath,
      });
      console.log(`\n✅ ${s.id}: score=${trip?.qualityScore}/100, ${totalItems} items, ${(elapsed / 1000).toFixed(1)}s`);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      results.push({
        id: s.id,
        label: s.label,
        score: null,
        activities: 0,
        meals: 0,
        items: 0,
        days: 0,
        llmTimeMs: 0,
        totalTimeMs: elapsed,
        enrichments: 0,
        sanitized: 0,
        error: err.message || String(err),
        filepath: null,
      });
      console.error(`\n❌ ${s.id}: FAILED in ${(elapsed / 1000).toFixed(1)}s — ${err.message}`);
    }
  }

  // Summary table
  console.log(`\n\n${'='.repeat(90)}`);
  console.log('📊 SUMMARY — Gemini 2.5 Flash Stress Test');
  console.log(`${'='.repeat(90)}`);
  console.log(
    'Scenario'.padEnd(35) +
    'Score'.padStart(6) +
    'Act'.padStart(5) +
    'Meals'.padStart(6) +
    'Items'.padStart(6) +
    'Days'.padStart(5) +
    'Time'.padStart(8) +
    'Status'.padStart(10)
  );
  console.log('-'.repeat(90));

  let successCount = 0;
  let totalScore = 0;

  for (const r of results) {
    const status = r.error ? '❌ FAIL' : '✅ OK';
    const scoreStr = r.score ? `${r.score}` : '--';
    const timeStr = `${(r.totalTimeMs / 1000).toFixed(0)}s`;

    console.log(
      r.label.slice(0, 34).padEnd(35) +
      scoreStr.padStart(6) +
      String(r.activities).padStart(5) +
      String(r.meals).padStart(6) +
      String(r.items).padStart(6) +
      String(r.days).padStart(5) +
      timeStr.padStart(8) +
      status.padStart(10)
    );

    if (r.score) {
      successCount++;
      totalScore += r.score;
    }
  }

  console.log('-'.repeat(90));
  const avgScore = successCount > 0 ? (totalScore / successCount).toFixed(1) : '--';
  console.log(`\n📈 ${successCount}/${results.length} succeeded, average score: ${avgScore}/100`);
  console.log(`📁 Results saved to: ${outDir}\n`);
}

main().catch(console.error);

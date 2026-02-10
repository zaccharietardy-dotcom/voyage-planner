/**
 * Pipeline V2 — Remote Quality Test Suite
 *
 * Calls the production API (Vercel) to generate trips with all APIs configured,
 * then analyzes the resulting JSON for quality issues.
 *
 * Usage:
 *   npx tsx scripts/test-pipeline-remote.ts
 *   npx tsx scripts/test-pipeline-remote.ts --scenario 0
 */

import { calculateDistance } from '../src/lib/services/geocoding';
import type { Trip, TripItem } from '../src/lib/types';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_API_URL || 'https://naraevoyage.com';

// ============================================
// Test Scenarios
// ============================================

interface TestScenario {
  name: string;
  body: Record<string, any>;
}

const TEST_SCENARIOS: TestScenario[] = [
  // 0. Court-courrier train
  {
    name: 'Lyon → Paris, 3j, train, couple, culture+gastro',
    body: {
      origin: 'Lyon',
      destination: 'Paris',
      startDate: '2025-03-15',
      durationDays: 3,
      transport: 'train',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'comfort',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Tour Eiffel, Louvre, Montmartre',
    },
  },
  // 1. International avion, famille
  {
    name: 'Paris → Barcelone, 5j, avion, famille',
    body: {
      origin: 'Paris',
      destination: 'Barcelona',
      startDate: '2025-06-20',
      durationDays: 5,
      transport: 'plane',
      carRental: false,
      groupSize: 4,
      groupType: 'family_with_kids',
      budgetLevel: 'moderate',
      activities: ['beach', 'culture'],
      dietary: ['none'],
      mustSee: 'Sagrada Familia, Parc Güell',
    },
  },
  // 2. Paris → Amsterdam train
  {
    name: 'Paris → Amsterdam, 3j, train, solo',
    body: {
      origin: 'Paris',
      destination: 'Amsterdam',
      startDate: '2025-04-10',
      durationDays: 3,
      transport: 'train',
      carRental: false,
      groupSize: 1,
      groupType: 'solo',
      budgetLevel: 'economic',
      activities: ['culture', 'nightlife'],
      dietary: ['none'],
      mustSee: 'Anne Frank House, Vondelpark, Rijksmuseum',
    },
  },
  // 3. Marrakech avion, luxe
  {
    name: 'Paris → Marrakech, 4j, avion, couple, luxe',
    body: {
      origin: 'Paris',
      destination: 'Marrakech',
      startDate: '2025-11-15',
      durationDays: 4,
      transport: 'plane',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'luxury',
      activities: ['culture', 'wellness'],
      dietary: ['halal'],
      mustSee: 'Jardin Majorelle, Médina',
    },
  },
  // 4. Rome train, amis
  {
    name: 'Lyon → Rome, 4j, train, amis',
    body: {
      origin: 'Lyon',
      destination: 'Rome',
      startDate: '2025-09-05',
      durationDays: 4,
      transport: 'train',
      carRental: false,
      groupSize: 4,
      groupType: 'friends',
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Colisée, Vatican, Fontaine de Trevi',
    },
  },
  // 5. Weekend court bus
  {
    name: 'Bruxelles → Amsterdam, 2j, bus, couple',
    body: {
      origin: 'Brussels',
      destination: 'Amsterdam',
      startDate: '2025-05-03',
      durationDays: 2,
      transport: 'bus',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'economic',
      activities: ['shopping', 'gastronomy'],
      dietary: ['vegetarian'],
      mustSee: '',
    },
  },
];

// ============================================
// Quality Analysis
// ============================================

interface QualityIssue {
  severity: 'critical' | 'major' | 'minor';
  category: string;
  dayNumber?: number;
  message: string;
}

function analyzeTrip(trip: Trip, body: Record<string, any>): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (!trip.days || trip.days.length === 0) {
    issues.push({ severity: 'critical', category: 'structure', message: 'Aucun jour généré' });
    return issues;
  }

  const numDays = body.durationDays || 3;

  if (trip.days.length !== numDays) {
    issues.push({
      severity: 'major', category: 'structure',
      message: `${trip.days.length} jours générés au lieu de ${numDays}`,
    });
  }

  // Transport mode check
  if (body.transport && body.transport !== 'optimal') {
    const selectedMode = trip.selectedTransport?.mode;
    if (selectedMode && selectedMode !== body.transport) {
      issues.push({
        severity: 'critical', category: 'transport',
        message: `Transport "${body.transport}" demandé mais "${selectedMode}" sélectionné`,
      });
    }
  }

  // Must-see check
  if (body.mustSee && body.mustSee.trim()) {
    const mustSees = body.mustSee.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    const allItemNames = trip.days.flatMap(d => d.items.map(i => i.title.toLowerCase()));
    const pool = trip.attractionPool?.map(a => (a as any).name?.toLowerCase()) || [];

    for (const ms of mustSees) {
      const inSchedule = allItemNames.some(name => name.includes(ms) || ms.includes(name));
      const inPool = pool.some(name => name && (name.includes(ms) || ms.includes(name)));

      if (!inSchedule && !inPool) {
        issues.push({
          severity: 'major', category: 'must-see',
          message: `Must-see "${ms}" absent du planning ET du pool`,
        });
      } else if (!inSchedule && inPool) {
        issues.push({
          severity: 'major', category: 'must-see',
          message: `Must-see "${ms}" dans le pool mais PAS dans le planning`,
        });
      }
    }
  }

  // Per-day analysis
  for (const day of trip.days) {
    const dayNum = day.dayNumber;
    const isFirst = dayNum === 1;
    const isLast = dayNum === numDays;
    const items = day.items;
    const activities = items.filter(i => i.type === 'activity');
    const restaurants = items.filter(i => i.type === 'restaurant');
    const transports = items.filter(i => i.type === 'transport' || i.type === 'flight');

    // Empty day
    if (activities.length === 0 && !day.isDayTrip) {
      const hasTransportOnly = transports.length > 0;
      if (!isFirst || !hasTransportOnly) {
        issues.push({
          severity: 'critical', category: 'empty-day', dayNumber: dayNum,
          message: `J${dayNum}: 0 activités (items: ${items.map(i => `${i.type}[${i.title.slice(0, 30)}]`).join(', ')})`,
        });
      }
    }

    // Meal checks
    const hasBreakfast = restaurants.some(r => r.title.toLowerCase().includes('petit-déjeuner') || r.title.toLowerCase().includes('breakfast'));
    const hasLunch = restaurants.some(r => r.title.toLowerCase().includes('déjeuner') && !r.title.toLowerCase().includes('petit'));
    const hasDinner = restaurants.some(r => r.title.toLowerCase().includes('dîner') || r.title.toLowerCase().includes('dinner'));

    // Check first item time for breakfast skip logic
    const firstHour = items[0]?.startTime ? parseInt(items[0].startTime.split(':')[0]) : 9;

    if (!hasBreakfast && !isFirst && firstHour < 10) {
      issues.push({ severity: 'major', category: 'meals', dayNumber: dayNum, message: `J${dayNum}: pas de petit-déjeuner` });
    }

    if (!hasLunch && activities.length >= 2) {
      issues.push({ severity: 'major', category: 'meals', dayNumber: dayNum, message: `J${dayNum}: pas de déjeuner (${activities.length} activités)` });
    }

    if (!hasDinner && !isLast && activities.length >= 1) {
      issues.push({ severity: 'minor', category: 'meals', dayNumber: dayNum, message: `J${dayNum}: pas de dîner` });
    }

    // Breakfast quality check
    const breakfastItems = restaurants.filter(r => r.title.toLowerCase().includes('petit-déjeuner'));
    for (const bf of breakfastItems) {
      const name = (bf.restaurant?.name || bf.title || '').toLowerCase();
      const badKeywords = ['steakhouse', 'steak', 'grill', 'bbq', 'sushi', 'kebab', 'burger', 'pizza'];
      if (badKeywords.some(k => name.includes(k))) {
        issues.push({
          severity: 'major', category: 'restaurant-quality', dayNumber: dayNum,
          message: `J${dayNum}: petit-déjeuner dans "${bf.restaurant?.name || bf.title}" (inapproprié)`,
        });
      }
    }

    // Time coherence
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const startH = parseInt(item.startTime?.split(':')[0] || '0');

      // Outdoor activity after 21h
      if (item.type === 'activity' && startH >= 21) {
        const name = item.title.toLowerCase();
        const isOutdoor = ['park', 'parc', 'jardin', 'garden', 'viewpoint', 'zoo', 'plage', 'beach'].some(k => name.includes(k));
        if (isOutdoor) {
          issues.push({
            severity: 'critical', category: 'opening-hours', dayNumber: dayNum,
            message: `J${dayNum}: "${item.title}" à ${item.startTime} (fermé la nuit)`,
          });
        }
      }

      // Travel time feasibility
      if (i > 0) {
        const prev = items[i - 1];
        if (prev.latitude && prev.longitude && item.latitude && item.longitude &&
            prev.latitude !== 0 && item.latitude !== 0) {
          const dist = calculateDistance(prev.latitude, prev.longitude, item.latitude, item.longitude);

          const prevEndParts = (prev.endTime || '').split(':').map(Number);
          const currStartParts = (item.startTime || '').split(':').map(Number);

          if (prevEndParts.length === 2 && currStartParts.length === 2) {
            const gapMin = (currStartParts[0] * 60 + currStartParts[1]) - (prevEndParts[0] * 60 + prevEndParts[1]);

            let minTravel = 5;
            if (dist > 1) minTravel = Math.round(dist * 4);
            if (dist > 15) minTravel = Math.round((dist / 50) * 60);

            if (gapMin < minTravel && gapMin >= 0 && dist > 5) {
              issues.push({
                severity: 'major', category: 'travel-time', dayNumber: dayNum,
                message: `J${dayNum}: "${prev.title.slice(0, 25)}" → "${item.title.slice(0, 25)}" = ${dist.toFixed(1)}km en ${gapMin}min (min: ${minTravel}min)`,
              });
            }
          }
        }
      }
    }

    // Transport items on first/last day
    if (isFirst && transports.length === 0 && body.transport !== 'car') {
      issues.push({
        severity: 'minor', category: 'transport', dayNumber: dayNum,
        message: `J1: pas de transport aller`,
      });
    }
    if (isLast && transports.length === 0 && body.transport !== 'car') {
      issues.push({
        severity: 'minor', category: 'transport', dayNumber: dayNum,
        message: `J${dayNum} (dernier): pas de transport retour`,
      });
    }

    // Transit return date check
    for (const t of transports) {
      if (t.transitLegs && Array.isArray(t.transitLegs)) {
        for (const leg of t.transitLegs as any[]) {
          if (leg.departure && isLast) {
            const legDate = new Date(leg.departure);
            const dayDate = new Date(body.startDate);
            dayDate.setDate(dayDate.getDate() + dayNum - 1);

            if (legDate.toDateString() !== dayDate.toDateString()) {
              issues.push({
                severity: 'major', category: 'transit-dates', dayNumber: dayNum,
                message: `J${dayNum}: transit date ${legDate.toDateString()} ≠ ${dayDate.toDateString()}`,
              });
            }
          }
        }
      }
    }
  }

  // Hotel
  if (!trip.accommodation && numDays > 1) {
    issues.push({ severity: 'major', category: 'accommodation', message: 'Pas d\'hôtel' });
  }

  // Cost
  if (trip.totalEstimatedCost === 0) {
    issues.push({ severity: 'minor', category: 'cost', message: 'Coût total = 0€' });
  }

  return issues;
}

// ============================================
// API Client
// ============================================

async function generateTripRemote(body: Record<string, any>): Promise<{ trip: Trip; durationMs: number }> {
  const t0 = Date.now();

  const response = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  // Parse SSE stream
  const text = await response.text();
  const lines = text.split('\n');

  let trip: Trip | null = null;
  let error: string | null = null;

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6);
    try {
      const data = JSON.parse(jsonStr);
      if (data.status === 'done' && data.trip) {
        trip = data.trip;
      } else if (data.status === 'error') {
        error = data.error;
      }
    } catch {
      // Partial JSON or keepalive
    }
  }

  if (error) throw new Error(`API error: ${error}`);
  if (!trip) throw new Error('No trip in response');

  return { trip, durationMs: Date.now() - t0 };
}

// ============================================
// Report
// ============================================

function printReport(name: string, idx: number, trip: Trip, issues: QualityIssue[], durationMs: number): void {
  const criticals = issues.filter(i => i.severity === 'critical');
  const majors = issues.filter(i => i.severity === 'major');
  const minors = issues.filter(i => i.severity === 'minor');
  const status = criticals.length > 0 ? '❌ FAIL' : majors.length > 0 ? '⚠️ WARN' : '✅ PASS';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${status}  Scenario #${idx}: ${name}`);
  console.log(`   ${trip.days.length} jours, ${trip.days.reduce((s, d) => s + d.items.length, 0)} items, ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`   Transport: ${trip.selectedTransport?.mode || 'aucun'} | Hôtel: ${trip.accommodation?.name || 'aucun'}`);
  console.log(`   Coût: ${trip.totalEstimatedCost}€`);

  if (issues.length === 0) {
    console.log('   Aucun problème!');
  } else {
    if (criticals.length > 0) {
      console.log(`\n   🔴 CRITIQUES (${criticals.length}):`);
      criticals.forEach(i => console.log(`      - ${i.message}`));
    }
    if (majors.length > 0) {
      console.log(`\n   🟠 MAJEURS (${majors.length}):`);
      majors.forEach(i => console.log(`      - ${i.message}`));
    }
    if (minors.length > 0) {
      console.log(`\n   🟡 MINEURS (${minors.length}):`);
      minors.forEach(i => console.log(`      - ${i.message}`));
    }
  }

  console.log(`\n   📅 Résumé par jour:`);
  for (const day of trip.days) {
    const acts = day.items.filter(i => i.type === 'activity');
    const meals = day.items.filter(i => i.type === 'restaurant');
    const mealTypes = meals.map(m => {
      const t = m.title.toLowerCase();
      if (t.includes('petit-déjeuner')) return '🥐';
      if (t.includes('déjeuner') && !t.includes('petit')) return '🍽️';
      if (t.includes('dîner')) return '🌙';
      return '🍴';
    });
    const trans = day.items.filter(i => i.type === 'transport' || i.type === 'flight');
    const transStr = trans.length > 0 ? ` | 🚆${trans.length}` : '';
    const firstTime = day.items[0]?.startTime || '?';
    const lastTime = day.items[day.items.length - 1]?.endTime || '?';

    console.log(`      J${day.dayNumber}: ${acts.length} act, ${mealTypes.join('')}${transStr} | ${firstTime}-${lastTime} | ${(day.theme || '').slice(0, 40)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let indices: number[];

  if (args.includes('--all')) {
    indices = TEST_SCENARIOS.map((_, i) => i);
  } else if (args.includes('--scenario')) {
    const idx = parseInt(args[args.indexOf('--scenario') + 1]);
    indices = [idx];
  } else {
    // Default: 3 diverse scenarios
    indices = [0, 2, 3];
  }

  console.log(`\n🧪 Pipeline V2 Remote Quality Test`);
  console.log(`   API: ${BASE_URL}`);
  console.log(`   Scenarios: ${indices.join(', ')}`);
  console.log('='.repeat(70));

  const results: { name: string; idx: number; issues: QualityIssue[]; durationMs: number }[] = [];

  for (const idx of indices) {
    const scenario = TEST_SCENARIOS[idx];
    console.log(`\n⏳ [${idx}] ${scenario.name}...`);

    try {
      const { trip, durationMs } = await generateTripRemote(scenario.body);

      const issues = analyzeTrip(trip, scenario.body);
      printReport(scenario.name, idx, trip, issues, durationMs);

      // Save JSON
      const outDir = path.join(__dirname, '..', 'test-results');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `remote-${idx}-${scenario.body.destination.toLowerCase().replace(/\s+/g, '-')}.json`);
      fs.writeFileSync(outFile, JSON.stringify({
        _meta: { scenario: scenario.name, idx, durationMs, issues },
        trip,
      }, null, 2));
      console.log(`   💾 ${path.relative(process.cwd(), outFile)}`);

      results.push({ name: scenario.name, idx, issues, durationMs });
    } catch (error) {
      console.error(`\n❌ Scenario #${idx} CRASHED: ${error instanceof Error ? error.message : error}`);
      results.push({
        name: scenario.name, idx, durationMs: 0,
        issues: [{ severity: 'critical', category: 'crash', message: String(error) }],
      });
    }
  }

  // Summary
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('📊 SYNTHÈSE');
  console.log(`${'═'.repeat(70)}`);

  let tc = 0, tm = 0, tmi = 0;
  for (const r of results) {
    tc += r.issues.filter(i => i.severity === 'critical').length;
    tm += r.issues.filter(i => i.severity === 'major').length;
    tmi += r.issues.filter(i => i.severity === 'minor').length;
    const s = r.issues.some(i => i.severity === 'critical') ? '❌' : r.issues.some(i => i.severity === 'major') ? '⚠️' : '✅';
    console.log(`  ${s} [${r.idx}] ${r.name} — ${r.issues.length} issues (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  console.log(`\n  Total: 🔴${tc} 🟠${tm} 🟡${tmi} | Temps: ${(results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(1)}s`);

  // Category breakdown
  const cats = new Map<string, number>();
  for (const r of results) for (const i of r.issues) cats.set(i.category, (cats.get(i.category) || 0) + 1);
  if (cats.size > 0) {
    console.log(`\n  Par catégorie:`);
    for (const [cat, count] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat}: ${count}x`);
    }
  }

  process.exit(tc > 0 ? 1 : 0);
}

main();

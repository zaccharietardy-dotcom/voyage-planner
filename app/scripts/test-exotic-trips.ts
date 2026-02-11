/**
 * Pipeline V2 — Exotic Trip Quality Test
 *
 * Tests diverse destinations: Chinese cities, regional France, budget trips, etc.
 * Generates trips, exports JSONs, and provides detailed quality critique.
 *
 * Usage:
 *   npx tsx scripts/test-exotic-trips.ts
 *   npx tsx scripts/test-exotic-trips.ts --scenario 0
 *   npx tsx scripts/test-exotic-trips.ts --all
 */

import { calculateDistance } from '../src/lib/services/geocoding';
import type { Trip, TripItem } from '../src/lib/types';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_API_URL || 'https://naraevoyage.com';

// ============================================
// Test Scenarios — Exotic & Regional
// ============================================

interface TestScenario {
  name: string;
  body: Record<string, any>;
  expectedTraits?: string[]; // things we expect to see
}

const TEST_SCENARIOS: TestScenario[] = [
  // 0. Rome 4j couple economic — regression test (les bugs qu'on a fixés)
  {
    name: 'Paris → Rome, 4j, avion, couple, economic',
    body: {
      origin: 'Paris',
      destination: 'Rome',
      startDate: '2025-07-10',
      durationDays: 4,
      transport: 'plane',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'economic',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Colisée, Vatican, Fontaine de Trevi',
    },
    expectedTraits: [
      'Viator GPS ≠ city-center (P1 fix)',
      'Chapelle Sixtine + Vatican dedupliqués (P4 fix)',
      'Jour 1 pas de trou 6h (P5 fix)',
      'Petit-déj/déj libre visible (P6 fix)',
    ],
  },
  // 1. Chengdu 5j amis culture+gastro — ville chinoise
  {
    name: 'Paris → Chengdu, 5j, avion, amis, culture+gastro',
    body: {
      origin: 'Paris',
      destination: 'Chengdu',
      startDate: '2025-10-01',
      durationDays: 5,
      transport: 'plane',
      carRental: false,
      groupSize: 3,
      groupType: 'friends',
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy', 'nature'],
      dietary: ['none'],
      mustSee: 'Giant Panda Base, Jinli Ancient Street',
    },
    expectedTraits: [
      'AI must-sees generated (no curated DB for Chengdu)',
      'GPS resolved for attractions',
      'Sichuan cuisine restaurants',
    ],
  },
  // 2. Colmar 3j famille — France régionale
  {
    name: 'Lyon → Colmar, 3j, train, famille, culture',
    body: {
      origin: 'Lyon',
      destination: 'Colmar',
      startDate: '2025-12-05',
      durationDays: 3,
      transport: 'train',
      carRental: false,
      groupSize: 4,
      groupType: 'family_with_kids',
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Marché de Noël, Petite Venise',
    },
    expectedTraits: [
      'Small city — fewer attractions but quality',
      'Christmas market activities',
      'Alsatian cuisine',
    ],
  },
  // 3. Kunming 4j couple aventure — Chine régionale (Yunnan)
  {
    name: 'Paris → Kunming, 4j, avion, couple, aventure+nature',
    body: {
      origin: 'Paris',
      destination: 'Kunming',
      startDate: '2025-04-15',
      durationDays: 4,
      transport: 'plane',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'moderate',
      activities: ['nature', 'adventure', 'culture'],
      dietary: ['none'],
      mustSee: 'Stone Forest, Green Lake Park',
    },
    expectedTraits: [
      'AI must-sees for lesser-known city',
      'Nature/adventure activities prioritized',
      'GPS resolution chain tested',
    ],
  },
  // 4. Porto 3j solo budget — backpacker
  {
    name: 'Paris → Porto, 3j, avion, solo, economic',
    body: {
      origin: 'Paris',
      destination: 'Porto',
      startDate: '2025-05-20',
      durationDays: 3,
      transport: 'plane',
      carRental: false,
      groupSize: 1,
      groupType: 'solo',
      budgetLevel: 'economic',
      activities: ['culture', 'gastronomy', 'nightlife'],
      dietary: ['none'],
      mustSee: 'Livraria Lello, Ribeira, Tour des Clérigos',
    },
    expectedTraits: [
      'Self-catered meal placeholders (economic)',
      'Solo-friendly activities',
      'Port wine tasting?',
    ],
  },
  // 5. Guilin 4j famille nature — Chine profonde
  {
    name: 'Paris → Guilin, 4j, avion, famille, nature',
    body: {
      origin: 'Paris',
      destination: 'Guilin',
      startDate: '2025-09-10',
      durationDays: 4,
      transport: 'plane',
      carRental: false,
      groupSize: 4,
      groupType: 'family_with_kids',
      budgetLevel: 'moderate',
      activities: ['nature', 'culture', 'adventure'],
      dietary: ['none'],
      mustSee: 'Li River, Reed Flute Cave',
    },
    expectedTraits: [
      'Nature-heavy itinerary',
      'Possible day-trip detection (Li River cruise)',
      'AI must-sees for Guilin',
    ],
  },
  // 6. Annecy 2j weekend couple — micro ville française
  {
    name: 'Lyon → Annecy, 2j, car, couple, nature+gastro',
    body: {
      origin: 'Lyon',
      destination: 'Annecy',
      startDate: '2025-06-14',
      durationDays: 2,
      transport: 'car',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'comfort',
      activities: ['nature', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Lac d\'Annecy, Vieille Ville',
    },
    expectedTraits: [
      'Short trip — compact schedule',
      'Car transport (no flights/trains)',
      'Lake activities',
    ],
  },
  // 7. Xi'an 5j couple culture — Chine historique
  {
    name: 'Paris → Xi\'an, 5j, avion, couple, culture',
    body: {
      origin: 'Paris',
      destination: 'Xi\'an',
      startDate: '2025-10-20',
      durationDays: 5,
      transport: 'plane',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Terracotta Army, City Wall, Muslim Quarter',
    },
    expectedTraits: [
      'Terracotta Army as day-trip (30km from center)',
      'AI must-sees for Xi\'an',
      'Muslim Quarter food street',
    ],
  },
];

// ============================================
// Quality Analysis (enhanced)
// ============================================

interface QualityIssue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  category: string;
  dayNumber?: number;
  message: string;
}

function analyzeTrip(trip: Trip, body: Record<string, any>, expectedTraits?: string[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (!trip.days || trip.days.length === 0) {
    issues.push({ severity: 'critical', category: 'structure', message: 'Aucun jour généré' });
    return issues;
  }

  const numDays = body.durationDays || 3;

  // Day count
  if (trip.days.length !== numDays) {
    issues.push({
      severity: 'major', category: 'structure',
      message: `${trip.days.length} jours générés au lieu de ${numDays}`,
    });
  }

  // Transport mode
  if (body.transport && body.transport !== 'optimal' && body.transport !== 'car') {
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
        issues.push({ severity: 'major', category: 'must-see', message: `Must-see "${ms}" absent du planning ET du pool` });
      } else if (!inSchedule && inPool) {
        issues.push({ severity: 'major', category: 'must-see', message: `Must-see "${ms}" dans le pool mais PAS dans le planning` });
      } else if (inSchedule) {
        issues.push({ severity: 'info', category: 'must-see', message: `✓ Must-see "${ms}" présent dans le planning` });
      }
    }
  }

  // GPS quality — check for city-center clustering (P1 regression)
  const allActivities = trip.days.flatMap(d => d.items.filter(i => i.type === 'activity'));
  const gpsGroups = new Map<string, string[]>();
  for (const act of allActivities) {
    if (act.latitude && act.longitude && act.latitude !== 0) {
      const key = `${act.latitude.toFixed(3)},${act.longitude.toFixed(3)}`;
      if (!gpsGroups.has(key)) gpsGroups.set(key, []);
      gpsGroups.get(key)!.push(act.title);
    }
  }
  for (const [coords, names] of gpsGroups) {
    if (names.length >= 3) {
      issues.push({
        severity: 'major', category: 'gps-clustering',
        message: `${names.length} activités au même GPS (${coords}): ${names.slice(0, 4).join(', ')}`,
      });
    }
  }

  // Zero GPS check
  const zeroGPS = allActivities.filter(a => !a.latitude || !a.longitude || (a.latitude === 0 && a.longitude === 0));
  if (zeroGPS.length > 0) {
    issues.push({
      severity: 'major', category: 'gps-missing',
      message: `${zeroGPS.length} activités sans GPS: ${zeroGPS.map(a => a.title).slice(0, 3).join(', ')}`,
    });
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
      if (!(isFirst && hasTransportOnly) && !(isLast && hasTransportOnly)) {
        issues.push({
          severity: 'critical', category: 'empty-day', dayNumber: dayNum,
          message: `J${dayNum}: 0 activités (items: ${items.map(i => `${i.type}[${i.title.slice(0, 25)}]`).join(', ')})`,
        });
      }
    }

    // Too few activities on non-travel days
    if (activities.length === 1 && !isFirst && !isLast) {
      issues.push({
        severity: 'major', category: 'sparse-day', dayNumber: dayNum,
        message: `J${dayNum}: seulement 1 activité ("${activities[0].title}")`,
      });
    }

    // Meal checks
    const hasBreakfast = restaurants.some(r => r.title.toLowerCase().includes('petit-déjeuner') || r.title.toLowerCase().includes('breakfast'));
    const hasLunch = restaurants.some(r => {
      const t = r.title.toLowerCase();
      return (t.includes('déjeuner') || t.includes('lunch')) && !t.includes('petit');
    });
    const hasDinner = restaurants.some(r => r.title.toLowerCase().includes('dîner') || r.title.toLowerCase().includes('dinner'));

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

    // Day 1 gap check (P5 regression)
    if (isFirst && activities.length > 0) {
      const firstActivity = activities[0];
      const firstActHour = parseInt(firstActivity.startTime?.split(':')[0] || '0');
      const dayStart = firstHour;
      const gap = firstActHour - dayStart;
      if (gap > 3) {
        issues.push({
          severity: 'major', category: 'day1-gap', dayNumber: 1,
          message: `J1: trou de ${gap}h avant première activité (${dayStart}h → ${firstActHour}h "${firstActivity.title}")`,
        });
      }
    }

    // Time coherence — overlaps
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const curr = items[i];
      const prevEnd = parseTimeMin(prev.endTime);
      const currStart = parseTimeMin(curr.startTime);
      if (prevEnd > currStart + 5) { // 5min tolerance
        issues.push({
          severity: 'major', category: 'time-overlap', dayNumber: dayNum,
          message: `J${dayNum}: "${prev.title.slice(0, 20)}" (fin ${prev.endTime}) chevauche "${curr.title.slice(0, 20)}" (début ${curr.startTime})`,
        });
      }
    }

    // Travel time feasibility
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const curr = items[i];
      if (prev.latitude && prev.longitude && curr.latitude && curr.longitude &&
          prev.latitude !== 0 && curr.latitude !== 0) {
        const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        const gapMin = parseTimeMin(curr.startTime) - parseTimeMin(prev.endTime);
        const minTravel = dist > 15 ? Math.round((dist / 50) * 60) : dist > 1 ? Math.round(dist * 4) : 5;

        if (gapMin < minTravel && gapMin >= 0 && dist > 5) {
          issues.push({
            severity: 'major', category: 'travel-time', dayNumber: dayNum,
            message: `J${dayNum}: "${prev.title.slice(0, 20)}" → "${curr.title.slice(0, 20)}" = ${dist.toFixed(1)}km en ${gapMin}min (min: ${minTravel}min)`,
          });
        }
      }
    }

    // Duplicate activities same day (P4 regression)
    const actNames = activities.map(a => a.title.toLowerCase());
    for (let i = 0; i < actNames.length; i++) {
      for (let j = i + 1; j < actNames.length; j++) {
        if (actNames[i].includes(actNames[j]) || actNames[j].includes(actNames[i])) {
          issues.push({
            severity: 'major', category: 'duplicate', dayNumber: dayNum,
            message: `J${dayNum}: doublon potentiel "${activities[i].title}" + "${activities[j].title}"`,
          });
        }
      }
    }
  }

  // Hotel
  if (!trip.accommodation && numDays > 1) {
    issues.push({ severity: 'major', category: 'accommodation', message: 'Pas d\'hôtel' });
  }

  // Cost sanity
  if (trip.totalEstimatedCost === 0) {
    issues.push({ severity: 'minor', category: 'cost', message: 'Coût total = 0€' });
  }
  if (trip.totalEstimatedCost > 10000 && body.budgetLevel === 'economic') {
    issues.push({ severity: 'major', category: 'cost', message: `Coût ${trip.totalEstimatedCost}€ pour budget économique` });
  }

  // Alternative activities
  const altCount = (trip as any).alternativeActivities?.length || 0;
  issues.push({
    severity: 'info', category: 'alternatives',
    message: `${altCount} activités alternatives disponibles`,
  });

  return issues;
}

function parseTimeMin(time: string | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
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
// Pretty Report
// ============================================

function printDetailedReport(name: string, idx: number, trip: Trip, issues: QualityIssue[], durationMs: number, body: Record<string, any>): void {
  const criticals = issues.filter(i => i.severity === 'critical');
  const majors = issues.filter(i => i.severity === 'major');
  const minors = issues.filter(i => i.severity === 'minor');
  const infos = issues.filter(i => i.severity === 'info');
  const status = criticals.length > 0 ? '❌ FAIL' : majors.length > 0 ? '⚠️ WARN' : '✅ PASS';

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${status}  Scenario #${idx}: ${name}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`   ⏱️  Temps: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`   📅 ${trip.days.length} jours, ${trip.days.reduce((s, d) => s + d.items.length, 0)} items total`);
  console.log(`   🏨 Hôtel: ${trip.accommodation?.name || 'aucun'} ${trip.accommodation?.pricePerNight ? `(${trip.accommodation.pricePerNight}€/nuit)` : ''}`);
  console.log(`   🚆 Transport: ${trip.selectedTransport?.mode || trip.outboundFlight ? 'avion' : 'aucun'}`);
  console.log(`   💰 Coût total: ${trip.totalEstimatedCost}€ (budget: ${body.budgetLevel})`);

  if (trip.costBreakdown) {
    const cb = trip.costBreakdown;
    console.log(`      └─ Vols: ${cb.flights}€ | Héberg: ${cb.accommodation}€ | Repas: ${cb.food}€ | Activités: ${cb.activities}€ | Transport: ${cb.transport}€`);
  }

  // Day breakdown
  console.log(`\n   📋 Planning détaillé:`);
  for (const day of trip.days) {
    const acts = day.items.filter(i => i.type === 'activity');
    const meals = day.items.filter(i => i.type === 'restaurant');
    const trans = day.items.filter(i => i.type === 'transport' || i.type === 'flight');
    const freeTime = day.items.filter(i => i.type === 'free_time');
    const checkin = day.items.filter(i => i.type === 'checkin' || i.type === 'checkout');

    const firstTime = day.items[0]?.startTime || '?';
    const lastTime = day.items[day.items.length - 1]?.endTime || '?';

    const dayTrip = day.isDayTrip ? ' 🚗 DAY-TRIP' : '';
    console.log(`\n      ── J${day.dayNumber}: ${day.theme || 'Sans thème'}${dayTrip} (${firstTime}-${lastTime}) ──`);

    for (const item of day.items) {
      const icon = item.type === 'activity' ? '🎯' :
                   item.type === 'restaurant' ? '🍽️' :
                   item.type === 'flight' ? '✈️' :
                   item.type === 'transport' ? '🚆' :
                   item.type === 'checkin' ? '🏨' :
                   item.type === 'checkout' ? '🧳' :
                   item.type === 'free_time' ? '☕' : '📌';

      const gps = item.latitude && item.longitude && item.latitude !== 0
        ? ` [${item.latitude.toFixed(3)},${item.longitude.toFixed(3)}]`
        : ' [NO GPS]';

      const cost = item.estimatedCost ? ` ${item.estimatedCost}€` : '';
      const reliability = (item as any).dataReliability ? ` (${(item as any).dataReliability})` : '';
      const travel = item.timeFromPrevious ? ` ← ${item.timeFromPrevious}min` : '';

      console.log(`         ${item.startTime}-${item.endTime} ${icon} ${item.title.slice(0, 50)}${cost}${gps}${reliability}${travel}`);
    }
  }

  // Issues
  if (criticals.length > 0 || majors.length > 0 || minors.length > 0) {
    console.log(`\n   🔍 Problèmes détectés:`);
    if (criticals.length > 0) {
      console.log(`      🔴 CRITIQUES (${criticals.length}):`);
      criticals.forEach(i => console.log(`         - ${i.message}`));
    }
    if (majors.length > 0) {
      console.log(`      🟠 MAJEURS (${majors.length}):`);
      majors.forEach(i => console.log(`         - ${i.message}`));
    }
    if (minors.length > 0) {
      console.log(`      🟡 MINEURS (${minors.length}):`);
      minors.forEach(i => console.log(`         - ${i.message}`));
    }
  }

  if (infos.length > 0) {
    console.log(`\n   ℹ️  Notes:`);
    infos.forEach(i => console.log(`      - ${i.message}`));
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  let indices: number[];

  if (args.includes('--all')) {
    indices = TEST_SCENARIOS.map((_, i) => i);
  } else if (args.includes('--scenario')) {
    const idx = parseInt(args[args.indexOf('--scenario') + 1]);
    indices = [idx];
  } else {
    // Default: run a diverse subset (Rome regression + 2 Chinese + 1 regional + 1 budget)
    indices = [0, 1, 4, 2, 6];
  }

  console.log(`\n🌍 Pipeline V2 — Exotic Trip Quality Test`);
  console.log(`   API: ${BASE_URL}`);
  console.log(`   Scenarios: ${indices.map(i => `[${i}] ${TEST_SCENARIOS[i]?.name}`).join('\n              ')}`);
  console.log(`${'═'.repeat(80)}`);

  const results: { name: string; idx: number; issues: QualityIssue[]; durationMs: number; trip?: Trip }[] = [];

  for (const idx of indices) {
    const scenario = TEST_SCENARIOS[idx];
    if (!scenario) { console.error(`Scenario #${idx} not found`); continue; }

    console.log(`\n⏳ Generating [${idx}] ${scenario.name}...`);

    try {
      const { trip, durationMs } = await generateTripRemote(scenario.body);
      const issues = analyzeTrip(trip, scenario.body, scenario.expectedTraits);

      printDetailedReport(scenario.name, idx, trip, issues, durationMs, scenario.body);

      // Save JSON
      const outDir = path.join(__dirname, '..', 'test-results');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const dest = scenario.body.destination.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const outFile = path.join(outDir, `exotic-${idx}-${dest}.json`);
      fs.writeFileSync(outFile, JSON.stringify({
        _meta: {
          scenario: scenario.name,
          idx,
          durationMs,
          issueCount: { critical: issues.filter(i => i.severity === 'critical').length, major: issues.filter(i => i.severity === 'major').length, minor: issues.filter(i => i.severity === 'minor').length },
          expectedTraits: scenario.expectedTraits,
          issues,
        },
        trip,
      }, null, 2));
      console.log(`\n   💾 Saved: ${path.relative(process.cwd(), outFile)}`);

      results.push({ name: scenario.name, idx, issues, durationMs, trip });
    } catch (error) {
      console.error(`\n❌ Scenario #${idx} CRASHED: ${error instanceof Error ? error.message : error}`);
      results.push({
        name: scenario.name, idx, durationMs: 0,
        issues: [{ severity: 'critical', category: 'crash', message: String(error) }],
      });
    }
  }

  // ============================================
  // Final Summary
  // ============================================
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('📊 SYNTHÈSE GLOBALE');
  console.log(`${'═'.repeat(80)}`);

  let tc = 0, tm = 0, tmi = 0;
  for (const r of results) {
    tc += r.issues.filter(i => i.severity === 'critical').length;
    tm += r.issues.filter(i => i.severity === 'major').length;
    tmi += r.issues.filter(i => i.severity === 'minor').length;
    const s = r.issues.some(i => i.severity === 'critical') ? '❌' : r.issues.some(i => i.severity === 'major') ? '⚠️' : '✅';
    console.log(`  ${s} [${r.idx}] ${r.name} — ${(r.durationMs / 1000).toFixed(1)}s — 🔴${r.issues.filter(i=>i.severity==='critical').length} 🟠${r.issues.filter(i=>i.severity==='major').length} 🟡${r.issues.filter(i=>i.severity==='minor').length}`);
  }

  console.log(`\n  Total: 🔴${tc} critiques | 🟠${tm} majeurs | 🟡${tmi} mineurs`);
  console.log(`  Temps total: ${(results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(1)}s`);

  // Category breakdown
  const cats = new Map<string, number>();
  for (const r of results) {
    for (const i of r.issues) {
      if (i.severity !== 'info') {
        cats.set(i.category, (cats.get(i.category) || 0) + 1);
      }
    }
  }
  if (cats.size > 0) {
    console.log(`\n  Par catégorie:`);
    for (const [cat, count] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat}: ${count}x`);
    }
  }

  console.log(`\n${'═'.repeat(80)}\n`);

  process.exit(tc > 0 ? 1 : 0);
}

main();

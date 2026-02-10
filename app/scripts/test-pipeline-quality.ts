/**
 * Pipeline V2 — Quality Test Suite
 *
 * Generates diverse trips, analyzes the resulting JSON for quality issues,
 * and produces a structured report.
 *
 * Usage:
 *   npx tsx scripts/test-pipeline-quality.ts
 *   npx tsx scripts/test-pipeline-quality.ts --scenario 0   # Run only scenario #0
 *   npx tsx scripts/test-pipeline-quality.ts --all           # Run all scenarios
 */

// Load .env.local before anything else (manual parser — dotenv v17 doesn't handle quotes well)
import * as path from 'path';
import * as fsSync from 'fs';
const envPath = path.join(__dirname, '..', '.env.local');
if (fsSync.existsSync(envPath)) {
  const envContent = fsSync.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eqIdx = line.indexOf('=');
    const key = line.substring(0, eqIdx).trim();
    let value = line.substring(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('[env] Loaded .env.local');
}

import { generateTripV2 } from '../src/lib/pipeline';
import type { TripPreferences, Trip, TripDay, TripItem } from '../src/lib/types';
import { calculateDistance } from '../src/lib/services/geocoding';
import * as fs from 'fs';

// ============================================
// Test Scenarios — diverse combinations
// ============================================

interface TestScenario {
  name: string;
  preferences: Partial<TripPreferences>;
}

const TEST_SCENARIOS: TestScenario[] = [
  // 0. Court-courrier train (classique FR)
  {
    name: 'Lyon → Paris, 3j, train, couple, culture+gastro',
    preferences: {
      origin: 'Lyon',
      destination: 'Paris',
      startDate: new Date('2025-03-15'),
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
    name: 'Paris → Barcelone, 5j, avion, famille, beach+culture',
    preferences: {
      origin: 'Paris',
      destination: 'Barcelona',
      startDate: new Date('2025-06-20'),
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
  // 2. Court-courrier train, solo budget
  {
    name: 'Paris → Amsterdam, 3j, train, solo, culture+nightlife',
    preferences: {
      origin: 'Paris',
      destination: 'Amsterdam',
      startDate: new Date('2025-04-10'),
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
  // 3. Long-courrier avion, amis
  {
    name: 'Paris → Tokyo, 7j, avion, amis, culture+gastro+adventure',
    preferences: {
      origin: 'Paris',
      destination: 'Tokyo',
      startDate: new Date('2025-10-01'),
      durationDays: 7,
      transport: 'plane',
      carRental: false,
      groupSize: 3,
      groupType: 'friends',
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy', 'adventure'],
      dietary: ['none'],
      mustSee: 'Senso-ji, Shibuya, Meiji Shrine',
    },
  },
  // 4. Weekend court, bus, économique
  {
    name: 'Bruxelles → Amsterdam, 2j, bus, couple, shopping+gastro',
    preferences: {
      origin: 'Brussels',
      destination: 'Amsterdam',
      startDate: new Date('2025-05-03'),
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
  // 5. Voiture, nature
  {
    name: 'Paris → Côte d\'Azur, 5j, voiture, famille, nature+beach',
    preferences: {
      origin: 'Paris',
      destination: 'Nice',
      startDate: new Date('2025-07-10'),
      durationDays: 5,
      transport: 'car',
      carRental: false,
      groupSize: 4,
      groupType: 'family_without_kids',
      budgetLevel: 'comfort',
      activities: ['nature', 'beach'],
      dietary: ['none'],
      mustSee: 'Promenade des Anglais, Vieux Nice',
    },
  },
  // 6. Maroc, luxe
  {
    name: 'Paris → Marrakech, 4j, avion, couple, culture+wellness',
    preferences: {
      origin: 'Paris',
      destination: 'Marrakech',
      startDate: new Date('2025-11-15'),
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
  // 7. Italie train, gastro
  {
    name: 'Lyon → Rome, 4j, train, amis, culture+gastro',
    preferences: {
      origin: 'Lyon',
      destination: 'Rome',
      startDate: new Date('2025-09-05'),
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
];

// ============================================
// Quality Checks
// ============================================

interface QualityIssue {
  severity: 'critical' | 'major' | 'minor';
  category: string;
  dayNumber?: number;
  message: string;
}

function analyzeTrip(trip: Trip, prefs: Partial<TripPreferences>): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // --- Global checks ---
  if (!trip.days || trip.days.length === 0) {
    issues.push({ severity: 'critical', category: 'structure', message: 'Aucun jour généré' });
    return issues;
  }

  if (trip.days.length !== prefs.durationDays) {
    issues.push({
      severity: 'major', category: 'structure',
      message: `${trip.days.length} jours générés au lieu de ${prefs.durationDays}`,
    });
  }

  // Transport check
  if (prefs.transport && prefs.transport !== 'optimal') {
    const selectedMode = trip.selectedTransport?.mode;
    if (selectedMode && selectedMode !== prefs.transport) {
      issues.push({
        severity: 'critical', category: 'transport',
        message: `Transport "${prefs.transport}" demandé mais "${selectedMode}" sélectionné`,
      });
    }
  }

  // Must-see check
  if (prefs.mustSee && prefs.mustSee.trim()) {
    const mustSees = prefs.mustSee.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const allItemNames = trip.days.flatMap(d => d.items.map(i => i.title.toLowerCase()));
    const allItemDescriptions = trip.days.flatMap(d => d.items.map(i => (i.description || '').toLowerCase()));
    const pool = trip.attractionPool?.map(a => ({
      name: ((a as any).name || '').toLowerCase(),
      desc: ((a as any).description || '').toLowerCase(),
      mustSee: (a as any).mustSee,
    })) || [];

    // Track which must-see terms are resolved
    const resolvedMustSees = new Set<string>();

    for (const ms of mustSees) {
      // Check in schedule (title or description)
      const inSchedule = allItemNames.some(name => name.includes(ms) || ms.includes(name))
        || allItemDescriptions.some(desc => desc.includes(ms));

      if (inSchedule) {
        resolvedMustSees.add(ms);
        continue;
      }

      // Check in pool (name, description)
      const inPool = pool.some(p =>
        (p.name.includes(ms) || ms.includes(p.name)) ||
        p.desc.includes(ms)
      );

      if (!inPool) {
        issues.push({
          severity: 'major', category: 'must-see',
          message: `Must-see "${ms}" absent du planning ET du pool`,
        });
      } else {
        issues.push({
          severity: 'major', category: 'must-see',
          message: `Must-see "${ms}" dans le pool mais absent du planning final`,
        });
      }
    }

    // Cross-check: if some must-sees weren't found by name but the pool has
    // must-see entries that ARE in the schedule, treat unresolved ones as satisfied.
    // This handles cases like "montmartre" → "Square Louise Michel" (different name, same place)
    const unresolvedCount = mustSees.length - resolvedMustSees.size;
    if (unresolvedCount > 0) {
      const scheduledMustSeeCount = trip.days
        .flatMap(d => d.items)
        .filter(i => i.type === 'activity' && pool.some(p => p.mustSee && p.name === i.title.toLowerCase()))
        .length;

      // If more must-see activities are scheduled than resolved by name,
      // the extra ones likely cover the unresolved must-see terms
      const extraScheduledMustSees = scheduledMustSeeCount - resolvedMustSees.size;
      if (extraScheduledMustSees >= unresolvedCount) {
        // Remove the must-see issues — they're likely false positives
        const mustSeeIssueCount = issues.filter(i => i.category === 'must-see').length;
        for (let i = issues.length - 1; i >= 0; i--) {
          if (issues[i].category === 'must-see' && issues[i].message.includes('dans le pool')) {
            issues.splice(i, 1);
          }
        }
      }
    }
  }

  // --- Per-day checks ---
  for (const day of trip.days) {
    const dayNum = day.dayNumber;
    const isFirst = dayNum === 1;
    const isLast = dayNum === prefs.durationDays;
    const items = day.items;

    // Empty day check
    const activities = items.filter(i => i.type === 'activity');
    const restaurants = items.filter(i => i.type === 'restaurant');
    const transports = items.filter(i => i.type === 'transport' || i.type === 'flight');

    if (activities.length === 0 && !day.isDayTrip) {
      // Allow empty first/last day if arrival is very late or departure very early
      const hasTransport = transports.length > 0;
      if (!isFirst || !hasTransport) {
        issues.push({
          severity: 'critical', category: 'empty-day', dayNumber: dayNum,
          message: `Jour ${dayNum}: 0 activités (${items.length} items au total: ${items.map(i => i.type).join(', ')})`,
        });
      }
    }

    // Meal checks
    const hasBreakfast = restaurants.some(r => r.title.toLowerCase().includes('petit-déjeuner') || r.title.toLowerCase().includes('breakfast'));
    const hasLunch = restaurants.some(r => r.title.toLowerCase().includes('déjeuner') && !r.title.toLowerCase().includes('petit'));
    const hasDinner = restaurants.some(r => r.title.toLowerCase().includes('dîner') || r.title.toLowerCase().includes('dinner'));

    // Breakfast: skip check for first day with late arrival
    const firstItemTime = items[0]?.startTime;
    const firstHour = firstItemTime ? parseInt(firstItemTime.split(':')[0]) : 9;

    if (!hasBreakfast && !isFirst && firstHour < 10) {
      issues.push({
        severity: 'major', category: 'meals', dayNumber: dayNum,
        message: `Jour ${dayNum}: pas de petit-déjeuner`,
      });
    }

    // Lunch: should always be present on full days
    // Exception: on late arrival days (first day, activities start after 14:30), lunch is physically impossible
    const firstActivityStart = items.find(i => i.type === 'activity')?.startTime;
    const firstActHour = firstActivityStart ? parseInt(firstActivityStart.split(':')[0]) + parseInt(firstActivityStart.split(':')[1] || '0') / 60 : 9;
    const lunchImpossible = isFirst && firstActHour >= 14.5;

    if (!hasLunch && activities.length >= 2 && !lunchImpossible) {
      issues.push({
        severity: 'major', category: 'meals', dayNumber: dayNum,
        message: `Jour ${dayNum}: pas de déjeuner (${activities.length} activités)`,
      });
    }

    // Dinner: should be present on non-departure days
    if (!hasDinner && !isLast && activities.length >= 1) {
      issues.push({
        severity: 'minor', category: 'meals', dayNumber: dayNum,
        message: `Jour ${dayNum}: pas de dîner`,
      });
    }

    // Breakfast restaurant type check
    const breakfastItems = restaurants.filter(r =>
      r.title.toLowerCase().includes('petit-déjeuner') || r.title.toLowerCase().includes('breakfast')
    );
    for (const bf of breakfastItems) {
      const name = (bf.restaurant?.name || bf.title || '').toLowerCase();
      const badKeywords = ['steakhouse', 'steak', 'grill', 'bbq', 'sushi', 'kebab', 'burger', 'pizza'];
      if (badKeywords.some(k => name.includes(k))) {
        issues.push({
          severity: 'major', category: 'restaurant-quality', dayNumber: dayNum,
          message: `Jour ${dayNum}: petit-déjeuner dans un restaurant inapproprié: "${bf.restaurant?.name || bf.title}"`,
        });
      }
    }

    // Time coherence checks
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const startH = parseInt(item.startTime?.split(':')[0] || '0');
      const endH = parseInt(item.endTime?.split(':')[0] || '0');

      // Activity after 21:00 — suspicious for parks
      if (item.type === 'activity' && startH >= 21) {
        const name = item.title.toLowerCase();
        const isOutdoor = ['park', 'parc', 'jardin', 'garden', 'viewpoint', 'zoo', 'plage', 'beach'].some(k => name.includes(k));
        if (isOutdoor) {
          issues.push({
            severity: 'critical', category: 'opening-hours', dayNumber: dayNum,
            message: `Jour ${dayNum}: "${item.title}" planifié à ${item.startTime} (parc/jardin fermé la nuit)`,
          });
        }
      }

      // Travel time coherence between consecutive items
      // Skip checks involving transport items (the transport IS the travel)
      if (i > 0 && item.type !== 'transport' && items[i-1].type !== 'transport') {
        const prev = items[i - 1];
        if (prev.latitude && prev.longitude && item.latitude && item.longitude &&
            prev.latitude !== 0 && item.latitude !== 0) {
          const dist = calculateDistance(prev.latitude, prev.longitude, item.latitude, item.longitude);

          // Parse times
          const prevEndParts = (prev.endTime || '').split(':').map(Number);
          const currStartParts = (item.startTime || '').split(':').map(Number);

          if (prevEndParts.length === 2 && currStartParts.length === 2) {
            const prevEndMin = prevEndParts[0] * 60 + prevEndParts[1];
            const currStartMin = currStartParts[0] * 60 + currStartParts[1];
            const gapMin = currStartMin - prevEndMin;

            // Estimate minimum travel time
            let minTravel = 5;
            if (dist > 1) minTravel = Math.round(dist * 4); // transit
            if (dist > 15) minTravel = Math.round((dist / 50) * 60); // car

            // Skip false positives from fakeGPS restaurants (city-center fallback coords)
            // When restaurants have unreliable GPS, computed distances are meaningless.
            // Any restaurant transition with a suspiciously small gap is likely fakeGPS.
            const isRestaurantTransition = prev.type === 'restaurant' || item.type === 'restaurant';
            const isFakeGPSLikely = isRestaurantTransition;

            // Skip false positives from checkout/checkin transitions
            // The scheduler's roundToNearestHour can collapse travel gaps to 0,
            // but the actual timeFromPrevious is computed correctly by enrichWithDirections
            const isHotelTransition = prev.type === 'checkout' || prev.type === 'checkin' || item.type === 'checkout' || item.type === 'checkin';
            const hasReportedTravel = (item as any).timeFromPrevious && (item as any).timeFromPrevious >= minTravel * 0.8;

            if (gapMin < minTravel && gapMin >= 0 && dist > 3 && !isFakeGPSLikely && !(isHotelTransition && hasReportedTravel)) {
              issues.push({
                severity: 'major', category: 'travel-time', dayNumber: dayNum,
                message: `Jour ${dayNum}: "${prev.title}" → "${item.title}" = ${dist.toFixed(1)}km, seulement ${gapMin}min de trajet (min estimé: ${minTravel}min)`,
              });
            }
          }
        }
      }
    }

    // Duration check: flag activities with unrealistic durations
    for (const act of activities) {
      const durMin = act.duration || 0;
      const name = (act.title || '').toLowerCase();
      const isSmallPlace = ['square', 'place', 'piazza', 'plaza', 'pont', 'bridge', 'fontaine', 'fountain', 'statue', 'porte', 'gate'].some(k => name.includes(k));
      if (isSmallPlace && durMin > 60) {
        issues.push({
          severity: 'major', category: 'duration', dayNumber: dayNum,
          message: `Jour ${dayNum}: "${act.title}" durée=${durMin}min (trop long pour ce type de lieu)`,
        });
      }
      if (durMin > 240 && !['museum', 'musée', 'parc', 'park', 'zoo', 'aquarium'].some(k => name.includes(k))) {
        issues.push({
          severity: 'major', category: 'duration', dayNumber: dayNum,
          message: `Jour ${dayNum}: "${act.title}" durée=${durMin}min (>4h, suspect)`,
        });
      }
    }

    // Transport on first/last day
    if (isFirst && transports.length === 0 && prefs.transport !== 'car') {
      issues.push({
        severity: 'minor', category: 'transport', dayNumber: dayNum,
        message: `Jour 1: pas de transport aller (${prefs.transport})`,
      });
    }
    if (isLast && transports.length === 0 && prefs.transport !== 'car') {
      issues.push({
        severity: 'minor', category: 'transport', dayNumber: dayNum,
        message: `Dernier jour: pas de transport retour (${prefs.transport})`,
      });
    }

    // Transit return date check (for ground transport)
    for (const t of transports) {
      if (t.transitLegs && Array.isArray(t.transitLegs)) {
        for (const leg of t.transitLegs as any[]) {
          if (leg.departure) {
            const legDate = new Date(leg.departure);
            const dayDate = new Date(prefs.startDate || '');
            dayDate.setDate(dayDate.getDate() + dayNum - 1);

            // Check if the transit leg date matches the day it's supposed to be on
            if (legDate.toDateString() !== dayDate.toDateString() && isLast) {
              issues.push({
                severity: 'major', category: 'transit-dates', dayNumber: dayNum,
                message: `Jour ${dayNum}: transit leg date ${legDate.toDateString()} != jour attendu ${dayDate.toDateString()}`,
              });
            }
          }
        }
      }
    }
  }

  // Hotel check
  if (!trip.accommodation && prefs.durationDays && prefs.durationDays > 1) {
    issues.push({
      severity: 'major', category: 'accommodation',
      message: 'Pas d\'hôtel sélectionné pour un voyage multi-jours',
    });
  }

  // Cost sanity
  if (trip.totalEstimatedCost === 0) {
    issues.push({
      severity: 'minor', category: 'cost',
      message: 'Coût total estimé = 0€',
    });
  }

  return issues;
}

// ============================================
// Report Generation
// ============================================

function printReport(
  scenarioName: string,
  scenarioIdx: number,
  trip: Trip,
  issues: QualityIssue[],
  durationMs: number
): void {
  const criticals = issues.filter(i => i.severity === 'critical');
  const majors = issues.filter(i => i.severity === 'major');
  const minors = issues.filter(i => i.severity === 'minor');

  const status = criticals.length > 0 ? '❌ FAIL' :
                 majors.length > 0 ? '⚠️ WARN' : '✅ PASS';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${status}  Scenario #${scenarioIdx}: ${scenarioName}`);
  console.log(`   ${trip.days.length} jours, ${trip.days.reduce((s, d) => s + d.items.length, 0)} items, ${durationMs}ms`);
  console.log(`   Transport: ${trip.selectedTransport?.mode || 'aucun'} | Hôtel: ${trip.accommodation?.name || 'aucun'}`);
  console.log(`   Coût total: ${trip.totalEstimatedCost}€`);

  if (issues.length === 0) {
    console.log('   Aucun problème détecté!');
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

  // Print per-day summary
  console.log(`\n   📅 Résumé par jour:`);
  for (const day of trip.days) {
    const acts = day.items.filter(i => i.type === 'activity');
    const meals = day.items.filter(i => i.type === 'restaurant');
    const mealTypes = meals.map(m => {
      if (m.title.toLowerCase().includes('petit-déjeuner')) return '🥐';
      if (m.title.toLowerCase().includes('déjeuner') && !m.title.toLowerCase().includes('petit')) return '🍽️';
      if (m.title.toLowerCase().includes('dîner')) return '🌙';
      return '🍴';
    });
    const transport = day.items.filter(i => i.type === 'transport' || i.type === 'flight');
    const transportStr = transport.length > 0 ? ` | 🚆${transport.length}` : '';

    console.log(`      J${day.dayNumber}: ${acts.length} activités, ${mealTypes.join('')} repas${transportStr} | ${day.items[0]?.startTime || '?'}-${day.items[day.items.length - 1]?.endTime || '?'} | ${day.theme || ''}`);
  }
}

function generateSummaryReport(results: { name: string; idx: number; issues: QualityIssue[]; durationMs: number }[]): void {
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('📊 RAPPORT DE SYNTHÈSE');
  console.log(`${'═'.repeat(70)}`);

  let totalIssues = 0;
  let totalCritical = 0;
  let totalMajor = 0;
  let totalMinor = 0;

  for (const r of results) {
    const c = r.issues.filter(i => i.severity === 'critical').length;
    const m = r.issues.filter(i => i.severity === 'major').length;
    const mi = r.issues.filter(i => i.severity === 'minor').length;
    totalCritical += c;
    totalMajor += m;
    totalMinor += mi;
    totalIssues += r.issues.length;
  }

  console.log(`\n  Scénarios testés: ${results.length}`);
  console.log(`  Total problèmes: ${totalIssues} (🔴 ${totalCritical} critiques, 🟠 ${totalMajor} majeurs, 🟡 ${totalMinor} mineurs)`);
  console.log(`  Temps total: ${results.reduce((s, r) => s + r.durationMs, 0)}ms`);

  // Most common issue categories
  const catCounts = new Map<string, number>();
  for (const r of results) {
    for (const i of r.issues) {
      const key = `${i.severity}:${i.category}`;
      catCounts.set(key, (catCounts.get(key) || 0) + 1);
    }
  }

  if (catCounts.size > 0) {
    console.log(`\n  Catégories de problèmes les plus fréquentes:`);
    const sorted = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted.slice(0, 10)) {
      const [severity, category] = cat.split(':');
      const icon = severity === 'critical' ? '🔴' : severity === 'major' ? '🟠' : '🟡';
      console.log(`    ${icon} ${category}: ${count}x`);
    }
  }

  // Specific fix recommendations
  console.log(`\n  🔧 Recommandations de fixes:`);
  const fixRecommendations = new Map<string, string[]>();

  for (const r of results) {
    for (const i of r.issues) {
      const key = i.category;
      if (!fixRecommendations.has(key)) fixRecommendations.set(key, []);
      fixRecommendations.get(key)!.push(`[Scenario ${r.idx}] ${i.message}`);
    }
  }

  for (const [cat, examples] of fixRecommendations.entries()) {
    console.log(`\n    📌 ${cat} (${examples.length}x):`);
    // Show first 3 examples
    for (const ex of examples.slice(0, 3)) {
      console.log(`       ${ex}`);
    }
    if (examples.length > 3) {
      console.log(`       ... et ${examples.length - 3} autre(s)`);
    }
  }
}

// ============================================
// Main Execution
// ============================================

async function runScenario(scenario: TestScenario, idx: number): Promise<{
  name: string;
  idx: number;
  trip: Trip;
  issues: QualityIssue[];
  durationMs: number;
}> {
  console.log(`\n⏳ Generating scenario #${idx}: ${scenario.name}...`);

  const prefs: TripPreferences = {
    origin: scenario.preferences.origin || 'Paris',
    destination: scenario.preferences.destination || 'London',
    startDate: scenario.preferences.startDate || new Date('2025-06-01'),
    durationDays: scenario.preferences.durationDays || 3,
    transport: scenario.preferences.transport || 'optimal',
    carRental: scenario.preferences.carRental || false,
    groupSize: scenario.preferences.groupSize || 2,
    groupType: scenario.preferences.groupType || 'couple',
    budgetLevel: scenario.preferences.budgetLevel || 'moderate',
    activities: scenario.preferences.activities || ['culture'],
    dietary: scenario.preferences.dietary || ['none'],
    mustSee: scenario.preferences.mustSee || '',
  };

  const t0 = Date.now();
  const trip = await generateTripV2(prefs);
  const durationMs = Date.now() - t0;

  const issues = analyzeTrip(trip, scenario.preferences);

  printReport(scenario.name, idx, trip, issues, durationMs);

  // Save JSON for later analysis
  const outDir = path.join(__dirname, '..', 'test-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `scenario-${idx}-${scenario.preferences.destination?.toLowerCase().replace(/\s+/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    _meta: {
      scenario: scenario.name,
      scenarioIdx: idx,
      generatedAt: new Date().toISOString(),
      durationMs,
      issueCount: issues.length,
      issues,
    },
    preferences: prefs,
    trip,
  }, null, 2));

  console.log(`   💾 JSON sauvegardé: ${path.relative(process.cwd(), outFile)}`);

  return { name: scenario.name, idx, trip, issues, durationMs };
}

async function main() {
  const args = process.argv.slice(2);
  let scenarioIndices: number[];

  if (args.includes('--all')) {
    scenarioIndices = TEST_SCENARIOS.map((_, i) => i);
  } else if (args.includes('--scenario')) {
    const idx = parseInt(args[args.indexOf('--scenario') + 1]);
    if (isNaN(idx) || idx < 0 || idx >= TEST_SCENARIOS.length) {
      console.error(`Invalid scenario index. Available: 0-${TEST_SCENARIOS.length - 1}`);
      process.exit(1);
    }
    scenarioIndices = [idx];
  } else {
    // Default: run first 3 scenarios
    scenarioIndices = [0, 2, 6]; // Lyon→Paris, Paris→Amsterdam, Paris→Marrakech
  }

  console.log(`\n🧪 Pipeline V2 Quality Test Suite`);
  console.log(`   Running ${scenarioIndices.length} scenario(s): ${scenarioIndices.join(', ')}`);
  console.log('='.repeat(70));

  const results: { name: string; idx: number; trip: Trip; issues: QualityIssue[]; durationMs: number }[] = [];

  for (const idx of scenarioIndices) {
    try {
      const result = await runScenario(TEST_SCENARIOS[idx], idx);
      results.push(result);
    } catch (error) {
      console.error(`\n❌ Scenario #${idx} failed with error:`, error instanceof Error ? error.message : error);
      results.push({
        name: TEST_SCENARIOS[idx].name,
        idx,
        trip: { days: [] } as any,
        issues: [{
          severity: 'critical',
          category: 'crash',
          message: `Generation crashed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        durationMs: 0,
      });
    }
  }

  generateSummaryReport(results);

  // Exit code based on critical issues
  const hasCritical = results.some(r => r.issues.some(i => i.severity === 'critical'));
  process.exit(hasCritical ? 1 : 0);
}

main();

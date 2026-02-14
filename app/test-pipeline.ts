/**
 * Multi-city test script: generate trips and audit restaurants + hotel routes.
 * Usage: npx tsx test-pipeline.ts [city]
 * Examples: npx tsx test-pipeline.ts rome
 *           npx tsx test-pipeline.ts all
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { generateTripV2 } from './src/lib/pipeline/index';
import type { TripPreferences } from './src/lib/types';

const TESTS: Record<string, TripPreferences> = {
  rome: {
    origin: 'Paris',
    destination: 'Rome',
    startDate: new Date('2026-03-10T08:00:00.000Z'),
    durationDays: 4,
    groupSize: 4,
    groupType: 'family_with_kids',
    transport: 'plane',
    carRental: false,
    budgetLevel: 'moderate',
    activities: ['culture', 'gastronomy'],
    dietary: ['none'],
    mustSee: 'Colisée, Vatican, Fontaine de Trevi',
  },
  barcelona: {
    origin: 'Paris',
    destination: 'Barcelona',
    startDate: new Date('2026-04-01T06:00:00.000Z'),
    durationDays: 2,
    groupSize: 1,
    groupType: 'solo',
    transport: 'plane',
    carRental: false,
    budgetLevel: 'economic',
    activities: ['adventure', 'culture'],
    dietary: ['none'],
    mustSee: 'Sagrada Familia, Park Güell',
  },
  tokyo: {
    origin: 'Paris',
    destination: 'Tokyo',
    startDate: new Date('2026-05-15T10:00:00.000Z'),
    durationDays: 5,
    groupSize: 2,
    groupType: 'couple',
    transport: 'plane',
    carRental: false,
    budgetLevel: 'luxury',
    activities: ['culture', 'gastronomy', 'nightlife'],
    dietary: ['none'],
    mustSee: 'Senso-ji, Meiji Shrine, Shibuya Crossing',
  },
  marrakech: {
    origin: 'Paris',
    destination: 'Marrakech',
    startDate: new Date('2026-03-20T09:00:00.000Z'),
    durationDays: 3,
    groupSize: 4,
    groupType: 'friends',
    transport: 'plane',
    carRental: false,
    budgetLevel: 'moderate',
    activities: ['culture', 'adventure'],
    dietary: ['none'],
    mustSee: 'Jemaa el-Fna, Jardin Majorelle',
  },
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function analyzeTrip(trip: any, city: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ANALYSIS: ${city.toUpperCase()}`);
  console.log(`${'='.repeat(60)}\n`);

  // Find hotel
  const checkinItem = trip.days.flatMap((d: any) => d.items).find((i: any) => i.type === 'checkin');
  const hotelLat = checkinItem?.latitude;
  const hotelLng = checkinItem?.longitude;
  const hotelName = checkinItem?.title?.replace('Check-in ', '') || '?';

  console.log(`HOTEL: ${hotelName} (${hotelLat?.toFixed(5)}, ${hotelLng?.toFixed(5)})`);

  // Per-day analysis
  let totalProblems = 0;
  let totalRestaurants = 0;
  let realRestaurants = 0;
  let placeholderRestaurants = 0;

  for (const day of trip.days) {
    console.log(`\n--- Day ${day.dayNumber} (${day.theme || '?'}) ---`);

    // Track hotel-to-first and last-to-hotel distances
    const activities = day.items.filter((i: any) => i.type === 'activity');
    const firstActivity = activities[0];
    const lastActivity = activities[activities.length - 1];

    if (hotelLat && hotelLng && firstActivity?.latitude) {
      const distToFirst = haversine(hotelLat, hotelLng, firstActivity.latitude, firstActivity.longitude);
      console.log(`  Hotel → first activity (${firstActivity.title}): ${distToFirst.toFixed(2)}km`);
    }
    if (hotelLat && hotelLng && lastActivity?.latitude) {
      const distFromLast = haversine(lastActivity.latitude, lastActivity.longitude, hotelLat, hotelLng);
      console.log(`  Last activity (${lastActivity.title}) → Hotel: ${distFromLast.toFixed(2)}km`);
    }

    // Schedule timeline
    for (const item of day.items) {
      const dist = item.distanceFromPrevious ? `${item.distanceFromPrevious.toFixed(2)}km` : '-';
      console.log(`  ${item.startTime}-${item.endTime} [${item.type}] ${item.title} (dist=${dist})`);
    }

    // Restaurant audit
    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i];
      if (item.type !== 'restaurant') continue;
      totalRestaurants++;

      const isPlaceholder = !item.restaurant ||
        item.restaurant.name?.includes('proximité') ||
        item.restaurant.name?.includes('proximite') ||
        item.id?.startsWith('self-');

      if (isPlaceholder) {
        placeholderRestaurants++;
        console.log(`  ❌ PLACEHOLDER: ${item.title}`);
        totalProblems++;
      } else {
        realRestaurants++;
        const cuisines = item.restaurant?.cuisineTypes?.join(', ') || '?';
        const altCount = item.restaurantAlternatives?.length || 0;
        console.log(`  ✅ REAL: ${item.title} | cuisines: ${cuisines} | alts: ${altCount}`);
      }

      // Distance check
      if (item.distanceFromPrevious && item.distanceFromPrevious > 1.5) {
        console.log(`    ⚠️ Restaurant ${item.distanceFromPrevious.toFixed(1)}km from previous!`);
        totalProblems++;
      }

      // Cuisine diversity
      if (item.restaurantAlternatives?.length >= 2 && item.restaurant?.cuisineTypes) {
        const allCuisines = [item.restaurant, ...item.restaurantAlternatives]
          .map((r: any) => r.cuisineTypes?.[0] || 'unknown');
        const unique = new Set(allCuisines);
        if (unique.size === 1) {
          console.log(`    ⚠️ No cuisine diversity: all ${allCuisines.length} are "${allCuisines[0]}"`);
          totalProblems++;
        }
      }
    }

    // Hotel return route audit
    const lastItem = day.items[day.items.length - 1];
    if (lastItem && lastItem.type !== 'transport' && lastItem.type !== 'checkout' && hotelLat && hotelLng && lastItem.latitude) {
      const distToHotel = haversine(lastItem.latitude, lastItem.longitude, hotelLat, hotelLng);
      if (distToHotel > 5) {
        console.log(`  ⚠️ Last item "${lastItem.title}" is ${distToHotel.toFixed(1)}km from hotel — long return!`);
        totalProblems++;
      }
    }
  }

  // Must-see audit
  const mustSeePool = (trip.attractionPool || []).filter((a: any) => a.mustSee);
  const scheduledIds = new Set(trip.days.flatMap((d: any) => d.items.filter((i: any) => i.type === 'activity').map((i: any) => i.id)));
  const missingMustSees = mustSeePool.filter((a: any) => !scheduledIds.has(a.id));

  console.log(`\n  SUMMARY:`);
  console.log(`    Restaurants: ${realRestaurants}/${totalRestaurants} real (${placeholderRestaurants} placeholders)`);
  console.log(`    Must-sees: ${mustSeePool.length - missingMustSees.length}/${mustSeePool.length} scheduled`);
  if (missingMustSees.length > 0) {
    console.log(`    ❌ Missing must-sees: ${missingMustSees.map((a: any) => a.name).join(', ')}`);
    totalProblems += missingMustSees.length;
  }
  console.log(`    Problems: ${totalProblems}`);

  return { city, totalProblems, realRestaurants, totalRestaurants, placeholderRestaurants, missingMustSees: missingMustSees.length };
}

async function main() {
  const target = process.argv[2] || 'all';
  const citiesToTest = target === 'all' ? Object.keys(TESTS) : [target];

  const results: any[] = [];
  const fs = await import('fs');

  for (const city of citiesToTest) {
    const prefs = TESTS[city];
    if (!prefs) {
      console.error(`Unknown city: ${city}. Available: ${Object.keys(TESTS).join(', ')}`);
      continue;
    }

    console.log(`\n${'#'.repeat(60)}`);
    console.log(`  GENERATING: ${city.toUpperCase()} (${prefs.durationDays} days, ${prefs.groupType})`);
    console.log(`${'#'.repeat(60)}\n`);

    try {
      const t0 = Date.now();
      const trip = await generateTripV2(prefs);
      const elapsed = Date.now() - t0;
      console.log(`\n[TEST] ${city} generated in ${(elapsed / 1000).toFixed(1)}s`);

      const result = analyzeTrip(trip, city);
      results.push({ ...result, elapsed });

      fs.writeFileSync(`/tmp/test-trip-${city}.json`, JSON.stringify(trip, null, 2));
      console.log(`[TEST] JSON written to /tmp/test-trip-${city}.json`);
    } catch (err) {
      console.error(`[TEST] ❌ ${city} FAILED:`, err);
      results.push({ city, error: String(err) });
    }
  }

  // Final summary
  if (results.length > 1) {
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('  FINAL SUMMARY — ALL CITIES');
    console.log(`${'='.repeat(60)}\n`);
    for (const r of results) {
      if (r.error) {
        console.log(`  ❌ ${r.city}: FAILED — ${r.error}`);
      } else {
        const status = r.totalProblems === 0 ? '✅' : r.totalProblems <= 3 ? '⚠️' : '❌';
        console.log(`  ${status} ${r.city}: ${r.realRestaurants}/${r.totalRestaurants} real restaurants, ${r.totalProblems} problems, ${(r.elapsed / 1000).toFixed(1)}s`);
      }
    }
  }
}

main().catch(console.error);

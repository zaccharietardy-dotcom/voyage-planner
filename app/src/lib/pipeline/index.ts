/**
 * Pipeline V2 — Main Orchestrator
 *
 * Replaces the old ai.ts pipeline (1400+ lines, 13 sequential phases, 3-5 min)
 * with a clean 7-step approach: parallel fetch → algorithmic organization → single Claude call.
 *
 * Target: 20-40s per trip generation.
 */

import type { Trip, TripPreferences, Flight } from '../types';
import type { ActivityCluster, ScoredActivity } from './types';
import { fetchAllData } from './step1-fetch';
import { scoreAndSelectActivities } from './step2-score';
import { clusterActivities } from './step3-cluster';
import { assignRestaurants } from './step4-restaurants';
import { selectHotelByBarycenter } from './step5-hotel';
import { balanceDaysWithClaude } from './step6-balance';
import { assembleTripSchedule } from './step7-assemble';

/**
 * Generate a trip using Pipeline V2.
 */
export async function generateTripV2(preferences: TripPreferences): Promise<Trip> {
  const T0 = Date.now();

  // Step 1: Fetch all data in parallel (~5-10s)
  console.log('[Pipeline V2] === Step 1: Fetching data... ===');
  const data = await fetchAllData(preferences);
  console.log(`[Pipeline V2] Step 1 done in ${Date.now() - T0}ms`);

  // Step 2: Score & select activities (~0ms)
  console.log('[Pipeline V2] === Step 2: Scoring activities... ===');
  const selectedActivities = scoreAndSelectActivities(data, preferences);
  console.log(`[Pipeline V2] Step 2: ${selectedActivities.length} activities selected (from ${
    data.googlePlacesAttractions.length + data.serpApiAttractions.length + data.overpassAttractions.length + data.viatorActivities.length
  } total)`);

  // Step 3: Geographic clustering (~0ms)
  console.log('[Pipeline V2] === Step 3: Clustering... ===');
  const clusters = clusterActivities(selectedActivities, preferences.durationDays, data.destCoords);

  // Rebalance: first/last day get fewer activities based on flight times
  rebalanceClustersForFlights(clusters, data.outboundFlight, data.returnFlight, preferences.durationDays);

  console.log(`[Pipeline V2] Step 3: ${clusters.length} clusters created`);
  for (const c of clusters) {
    console.log(`[Pipeline V2]   Day ${c.dayNumber}: ${c.activities.map(a => a.name).join(', ')} (${c.totalIntraDistance.toFixed(1)}km intra)`);
  }

  // Step 5: Hotel selection (~0ms) — before restaurants, need hotel coords
  console.log('[Pipeline V2] === Step 5: Selecting hotel... ===');
  const hotel = selectHotelByBarycenter(
    clusters,
    data.bookingHotels,
    preferences.budgetLevel,
    data.budgetStrategy?.accommodationBudgetPerNight
  );

  const accommodationCoords = hotel
    ? { lat: hotel.latitude, lng: hotel.longitude }
    : data.destCoords;

  // Step 4: Restaurant assignment (~0ms)
  console.log('[Pipeline V2] === Step 4: Assigning restaurants... ===');
  const meals = assignRestaurants(
    clusters,
    data.tripAdvisorRestaurants,
    data.serpApiRestaurants,
    preferences,
    data.budgetStrategy,
    accommodationCoords
  );
  const assignedCount = meals.filter(m => m.restaurant).length;
  console.log(`[Pipeline V2] Step 4: ${assignedCount}/${meals.length} meals assigned restaurants`);

  // Step 6: Claude day balancing (~10-15s)
  console.log('[Pipeline V2] === Step 6: Claude balancing... ===');
  const T6 = Date.now();
  const bestTransport = data.transportOptions?.find(t => t.recommended) || data.transportOptions?.[0] || null;
  const plan = await balanceDaysWithClaude(clusters, meals, hotel, bestTransport, preferences);
  console.log(`[Pipeline V2] Step 6 done in ${Date.now() - T6}ms — "${plan.dayOrderReason}"`);

  // Step 7: Schedule assembly (~2-5s)
  console.log('[Pipeline V2] === Step 7: Assembling schedule... ===');
  const trip = await assembleTripSchedule(
    plan, clusters, meals, hotel,
    { outbound: data.outboundFlight, return: data.returnFlight },
    bestTransport, preferences, data
  );

  const totalTime = Date.now() - T0;
  console.log(`[Pipeline V2] ✅ Trip generated in ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
  console.log(`[Pipeline V2]   ${trip.days.length} days, ${trip.days.reduce((s, d) => s + d.items.length, 0)} items total`);

  return trip;
}

/**
 * Rebalance cluster sizes based on available hours per day.
 * First day (late arrival) and last day (early departure) get fewer activities.
 * If a day has 0 usable hours, merge its activities with the nearest full day.
 */
function rebalanceClustersForFlights(
  clusters: ActivityCluster[],
  outboundFlight: Flight | null,
  returnFlight: Flight | null,
  numDays: number
): void {
  if (clusters.length < 2) return;

  // Detect day-trip clusters (single-activity clusters with far-off locations)
  const isDayTrip = clusters.map(c => c.activities.length === 1);

  // Estimate available hours per day
  const getAvailableHours = (c: ActivityCluster, ci: number): number => {
    if (isDayTrip[ci]) return 12;

    const isFirst = c.dayNumber === 1;
    const isLast = c.dayNumber === numDays;
    let available = 12;

    if (isFirst && outboundFlight) {
      const arrHour = outboundFlight.arrivalTimeDisplay
        ? parseInt(outboundFlight.arrivalTimeDisplay.split(':')[0], 10)
        : new Date(outboundFlight.arrivalTime).getHours();
      available = Math.max(0, 22 - (arrHour + 1.5));
    }

    if (isLast && returnFlight) {
      const depHour = returnFlight.departureTimeDisplay
        ? parseInt(returnFlight.departureTimeDisplay.split(':')[0], 10)
        : new Date(returnFlight.departureTime).getHours();
      available = Math.max(0, depHour - 3 - 8);
    }

    return available;
  };

  const hoursPerDay = clusters.map((c, ci) => getAvailableHours(c, ci));

  // Max activities per day (~1.5h per activity)
  const maxPerDay = hoursPerDay.map(h => Math.max(0, Math.floor(h / 1.5)));

  // Phase 1: Empty days — merge activities into nearest non-day-trip day with capacity
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    if (maxPerDay[ci] > 0) continue; // Day has time, skip

    // This day has no usable time — move ALL its activities to the nearest full day
    const cluster = clusters[ci];
    while (cluster.activities.length > 0) {
      // Find nearest non-day-trip, non-zero day
      let bestTarget = -1;
      let bestScore = -Infinity;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti] || maxPerDay[ti] === 0) continue;
        const capacity = maxPerDay[ti] - clusters[ti].activities.length;
        if (capacity > bestScore) {
          bestScore = capacity;
          bestTarget = ti;
        }
      }
      if (bestTarget === -1) break; // No receiver at all — accept the loss

      const moved = cluster.activities.pop()!;
      clusters[bestTarget].activities.push(moved);
    }
  }

  // Phase 2: Overfull days — trim to max capacity
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;

    const cluster = clusters[ci];
    const maxCount = maxPerDay[ci];
    if (maxCount === 0) continue; // Already emptied

    while (cluster.activities.length > maxCount) {
      // Find a receiver with remaining capacity
      let bestTarget = -1;
      let bestCapacity = -Infinity;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        const capacity = maxPerDay[ti] - clusters[ti].activities.length;
        if (capacity > bestCapacity) {
          bestCapacity = capacity;
          bestTarget = ti;
        }
      }
      if (bestTarget === -1 || bestCapacity <= 0) break;

      // Move the last activity (least important)
      const moved = cluster.activities.pop()!;
      clusters[bestTarget].activities.push(moved);
    }
  }

  // Log rebalancing result
  console.log(`[Pipeline V2] Rebalanced clusters: ${clusters.map((c, i) =>
    `Day ${c.dayNumber}: ${c.activities.length} activities (${hoursPerDay[i].toFixed(1)}h avail, max ${maxPerDay[i]})`
  ).join(', ')}`);
}

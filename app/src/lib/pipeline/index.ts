/**
 * Pipeline V2 — Main Orchestrator
 *
 * Replaces the old ai.ts pipeline (1400+ lines, 13 sequential phases, 3-5 min)
 * with a clean 7-step approach: parallel fetch → algorithmic organization → single Claude call.
 *
 * Target: 20-40s per trip generation.
 */

import type { Trip, TripPreferences, Flight, TransportOptionSummary } from '../types';
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

  // Resolve best transport early (needed for clustering rebalancing and scheduling)
  // IMPORTANT: Respect user's transport preference (train, bus, car, plane)
  // If user chose a specific mode, select that mode even if another is "recommended"
  let bestTransport: TransportOptionSummary | null = null;
  if (preferences.transport && preferences.transport !== 'optimal' && data.transportOptions?.length) {
    bestTransport = data.transportOptions.find(t => t.mode === preferences.transport) || null;
    if (!bestTransport) {
      console.warn(`[Pipeline V2] Transport mode "${preferences.transport}" requested but not available, falling back to recommended`);
      bestTransport = data.transportOptions.find(t => t.recommended) || data.transportOptions[0] || null;
    } else {
      console.log(`[Pipeline V2] Using user-preferred transport: ${bestTransport.mode} (${bestTransport.totalDuration}min, €${bestTransport.totalPrice})`);
    }
  } else {
    bestTransport = data.transportOptions?.find(t => t.recommended) || data.transportOptions?.[0] || null;
  }

  // Step 3: Geographic clustering (~0ms)
  console.log('[Pipeline V2] === Step 3: Clustering... ===');
  const clusters = clusterActivities(selectedActivities, preferences.durationDays, data.destCoords);

  // Rebalance: first/last day get fewer activities based on flight/transport times
  rebalanceClustersForFlights(clusters, data.outboundFlight, data.returnFlight, preferences.durationDays, bestTransport);

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
  numDays: number,
  transport?: TransportOptionSummary | null
): void {
  if (clusters.length < 2) return;

  const isGroundTransport = transport && transport.mode !== 'plane';

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
    } else if (isFirst && isGroundTransport) {
      // Ground transport: estimate arrival hour
      let arrHour = 8 + Math.ceil((transport!.totalDuration || 120) / 60);
      if (transport!.transitLegs?.length) {
        const lastLeg = transport!.transitLegs[transport!.transitLegs.length - 1];
        arrHour = new Date(lastLeg.arrival).getHours();
      }
      available = Math.max(0, 22 - (arrHour + 1));
    }

    if (isLast && returnFlight) {
      const depHour = returnFlight.departureTimeDisplay
        ? parseInt(returnFlight.departureTimeDisplay.split(':')[0], 10)
        : new Date(returnFlight.departureTime).getHours();
      available = Math.max(0, depHour - 3 - 8);
    } else if (isLast && isGroundTransport) {
      // Ground transport return: estimate departure around 14:00-16:00
      // Note: transitLegs have outbound dates, so we use the hour only as a rough guide
      // For return, we estimate a comfortable afternoon departure
      const depHour = 15; // Default: leave at 15:00, giving morning for activities
      available = Math.max(0, depHour - 1 - 8); // available = 6h (8:00 to 14:00)
    }

    return available;
  };

  const hoursPerDay = clusters.map((c, ci) => getAvailableHours(c, ci));

  // Max activities per day (~1.5h per activity)
  const maxPerDay = hoursPerDay.map(h => Math.max(0, Math.floor(h / 1.5)));

  // Phase 1: Empty days — merge activities into nearest non-day-trip day with capacity
  // BUT: ensure the day keeps at least its must-sees if it has ANY usable time
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
  // IMPORTANT: Never move must-see activities — they must stay in the schedule
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;

    const cluster = clusters[ci];
    const maxCount = maxPerDay[ci];
    if (maxCount === 0) continue; // Already emptied

    while (cluster.activities.length > maxCount) {
      // Find the last NON-must-see activity to move
      let moveIdx = -1;
      for (let ai = cluster.activities.length - 1; ai >= 0; ai--) {
        if (!cluster.activities[ai].mustSee) {
          moveIdx = ai;
          break;
        }
      }
      // If all remaining are must-sees, stop — keep them all even if over capacity
      if (moveIdx === -1) break;

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

      // Move the non-must-see activity
      const [moved] = cluster.activities.splice(moveIdx, 1);
      clusters[bestTarget].activities.push(moved);
    }
  }

  // Phase 3: Ensure no cluster has 0 activities unless it's truly impossible
  // Days with available time but 0 activities should steal from overfull neighbours
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    if (clusters[ci].activities.length > 0) continue;
    if (maxPerDay[ci] === 0) continue; // No time available, skip

    // This day has available hours but no activities — steal from the fullest cluster
    const slotsToFill = Math.min(maxPerDay[ci], 2); // Fill at least 1-2 activities
    for (let s = 0; s < slotsToFill; s++) {
      let bestSource = -1;
      let bestCount = 0;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        // Only steal from clusters that have more than their minimum (don't empty them)
        const nonMustSees = clusters[ti].activities.filter(a => !a.mustSee).length;
        if (nonMustSees > 1 && clusters[ti].activities.length > bestCount) {
          bestCount = clusters[ti].activities.length;
          bestSource = ti;
        }
      }
      if (bestSource === -1) break;

      // Move the lowest-scored non-must-see from the source
      const source = clusters[bestSource];
      const moveIdx = source.activities.findIndex(a => !a.mustSee);
      if (moveIdx === -1) break;

      // Pick lowest score among non-must-sees
      let worstIdx = -1;
      let worstScore = Infinity;
      for (let ai = 0; ai < source.activities.length; ai++) {
        if (source.activities[ai].mustSee) continue;
        if (source.activities[ai].score < worstScore) {
          worstScore = source.activities[ai].score;
          worstIdx = ai;
        }
      }
      if (worstIdx === -1) break;

      const [moved] = source.activities.splice(worstIdx, 1);
      clusters[ci].activities.push(moved);
    }
  }

  // Log rebalancing result
  console.log(`[Pipeline V2] Rebalanced clusters: ${clusters.map((c, i) =>
    `Day ${c.dayNumber}: ${c.activities.length} activities (${hoursPerDay[i].toFixed(1)}h avail, max ${maxPerDay[i]})`
  ).join(', ')}`);
}

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
import { calculateDistance } from '../services/geocoding';
import { OUTDOOR_ACTIVITY_KEYWORDS } from './utils/constants';

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
  const mustSeeCount = selectedActivities.filter(a => a.mustSee).length;
  console.log(`[Pipeline V2] Step 2: ${selectedActivities.length} activities selected (${mustSeeCount} must-sees) from ${
    data.googlePlacesAttractions.length + data.serpApiAttractions.length + data.overpassAttractions.length + data.viatorActivities.length
  } total`);
  console.log(`[Pipeline V2] Must-sees: ${selectedActivities.filter(a => a.mustSee).map(a => `"${a.name}" (${a.score.toFixed(1)})`).join(', ')}`);

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

  // Final must-see audit: check which must-sees made it into the schedule
  const poolMustSees = (trip.attractionPool || []).filter(a => a.mustSee);
  const scheduledActivityIds = new Set(trip.days.flatMap(d => d.items.filter(i => i.type === 'activity').map(i => i.id)));
  const missingMustSees = poolMustSees.filter(a => !scheduledActivityIds.has(a.id));

  if (missingMustSees.length > 0) {
    console.error(`[Pipeline V2] ⚠️ MUST-SEES MISSING FROM SCHEDULE: ${missingMustSees.map(a => `"${a.name}"`).join(', ')}`);
    // Show what IS on each day for diagnosis
    for (const day of trip.days) {
      const activities = day.items.filter(i => i.type === 'activity');
      console.error(`[Pipeline V2]   Day ${day.dayNumber}: ${activities.map(i => i.title).join(', ') || '(no activities)'}`);
    }
  } else {
    console.log(`[Pipeline V2] ✅ All ${poolMustSees.length} must-sees are in the schedule`);
  }

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

  // Detect day-trip clusters: single-activity cluster whose activity is far (>20km)
  // from the average centroid of all other clusters. A single-activity cluster near
  // the city center is NOT a day trip — it's just an underpopulated day.
  const avgCentroid = clusters.length > 1
    ? {
        lat: clusters.reduce((s, c) => s + c.centroid.lat, 0) / clusters.length,
        lng: clusters.reduce((s, c) => s + c.centroid.lng, 0) / clusters.length,
      }
    : clusters[0].centroid;
  const isDayTrip = clusters.map(c => {
    if (c.activities.length !== 1) return false;
    const a = c.activities[0];
    const dist = calculateDistance(a.latitude, a.longitude, avgCentroid.lat, avgCentroid.lng);
    return dist > 20; // >20km from city = genuine day trip
  });

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
      available = Math.max(0, 22 - (arrHour + 1)); // 1h transfer (consistent with step7-assemble)
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

  // Max activities per day: account for actual activity durations when available
  // Subtract meal overhead (~3h for 3 meals) from available hours
  const maxPerDay = hoursPerDay.map((h, ci) => {
    const mealHours = 3; // breakfast 45min + lunch 60min + dinner 75min
    const effectiveHours = Math.max(0, h - mealHours);
    // Use actual durations if cluster is already assigned
    const cluster = clusters[ci];
    if (cluster && cluster.activities.length > 0) {
      const avgDuration = cluster.activities.reduce((s, a) => s + (a.duration || 60), 0) / cluster.activities.length;
      const avgPerActivity = avgDuration / 60 + 0.33; // activity duration + ~20min travel/buffer
      return Math.max(0, Math.floor(effectiveHours / avgPerActivity));
    }
    return Math.max(0, Math.floor(effectiveHours / 1.5));
  });

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

  // Phase 2: Duration-aware rebalancing
  // Move activities (including must-sees) from overcrowded days to days with capacity.
  // Uses actual activity durations + meal/travel overhead for realistic capacity estimation.
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];
    const availMinutes = hoursPerDay[ci] * 60;
    const mealOverhead = 180; // ~3h for 3 meals

    // Keep moving activities until the day fits
    let iterations = 0;
    while (iterations++ < 20) {
      const totalDuration = cluster.activities.reduce((sum, a) => sum + (a.duration || 60), 0);
      const travelOverhead = cluster.activities.length * 20;
      if (totalDuration + travelOverhead + mealOverhead <= availMinutes) break;

      // Try to move a non-must-see first
      let moveIdx = -1;
      let worstScore = Infinity;
      for (let ai = 0; ai < cluster.activities.length; ai++) {
        if (!cluster.activities[ai].mustSee && cluster.activities[ai].score < worstScore) {
          worstScore = cluster.activities[ai].score;
          moveIdx = ai;
        }
      }

      // If no non-must-sees left, move the longest must-see to a day with more capacity
      if (moveIdx === -1) {
        let longestIdx = -1;
        let longestDur = 0;
        for (let ai = 0; ai < cluster.activities.length; ai++) {
          if ((cluster.activities[ai].duration || 60) > longestDur) {
            longestDur = cluster.activities[ai].duration || 60;
            longestIdx = ai;
          }
        }
        moveIdx = longestIdx;
      }

      if (moveIdx === -1) break;

      const toMove = cluster.activities[moveIdx];

      // Find the day with the most remaining capacity (in minutes) that can fit this activity
      let bestTarget = -1;
      let bestRemainingMin = -Infinity;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        const targetAvail = hoursPerDay[ti] * 60;
        const targetUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60), 0) + clusters[ti].activities.length * 20 + mealOverhead;
        const remaining = targetAvail - targetUsed;
        if (remaining > bestRemainingMin && remaining >= (toMove.duration || 60) + 20) {
          bestRemainingMin = remaining;
          bestTarget = ti;
        }
      }

      if (bestTarget === -1) break; // No day can fit this activity

      const [moved] = cluster.activities.splice(moveIdx, 1);
      clusters[bestTarget].activities.push(moved);
      if (moved.mustSee) {
        console.log(`[Pipeline V2] Moved must-see "${moved.name}" (${moved.duration}min) from Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber} (${Math.round(bestRemainingMin)}min remaining)`);
      }
    }
  }

  // Phase 2b: Must-see audit — ensure no day is overloaded with must-sees
  // If a day has more must-see duration than available time, move excess to days with capacity
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];
    const mustSeesInCluster = cluster.activities.filter(a => a.mustSee);
    if (mustSeesInCluster.length <= 1) continue; // Single must-see always fits

    const availMinutes = hoursPerDay[ci] * 60;
    const mealOverhead = 180;
    const mustSeeDuration = mustSeesInCluster.reduce((sum, a) => sum + (a.duration || 60), 0);
    const travelOverhead = mustSeesInCluster.length * 20;

    if (mustSeeDuration + travelOverhead + mealOverhead <= availMinutes) continue; // Fits fine

    // Too many must-sees for this day — move lowest-scored excess to day with most capacity
    const sortedMustSees = [...mustSeesInCluster].sort((a, b) => a.score - b.score);
    let minutesToFree = mustSeeDuration + travelOverhead + mealOverhead - availMinutes;

    for (const mustSee of sortedMustSees) {
      if (minutesToFree <= 0) break;

      // Find day with most remaining capacity that can fit this must-see
      let bestTarget = -1;
      let bestRemaining = -Infinity;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        const targetAvail = hoursPerDay[ti] * 60;
        const targetUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60), 0)
          + clusters[ti].activities.length * 20 + mealOverhead;
        const remaining = targetAvail - targetUsed;
        if (remaining > bestRemaining && remaining >= (mustSee.duration || 60) + 20) {
          bestRemaining = remaining;
          bestTarget = ti;
        }
      }

      if (bestTarget === -1) continue; // No day can fit this must-see

      const idx = cluster.activities.findIndex(a => a.id === mustSee.id);
      if (idx !== -1) {
        const [moved] = cluster.activities.splice(idx, 1);
        clusters[bestTarget].activities.push(moved);
        minutesToFree -= (mustSee.duration || 60) + 20;
        console.log(`[Pipeline V2] Must-see audit: moved "${mustSee.name}" (${mustSee.duration}min) from Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber}`);
      }
    }
  }

  // Phase 2c: Outdoor must-see scheduling check
  // Outdoor activities (parks, gardens) have an implicit closing time (~19:30).
  // If a must-see outdoor is on a day that starts late (arrival day),
  // move it to a full day where it can be visited before closing.
  // Use the shared outdoor keyword list (single source of truth)

  // Estimate the earliest start hour for each day
  const startHourPerDay = clusters.map((c, ci) => {
    const isFirst = c.dayNumber === 1;
    const isLast = c.dayNumber === numDays;
    if (isFirst && outboundFlight) {
      const arrHour = outboundFlight.arrivalTimeDisplay
        ? parseInt(outboundFlight.arrivalTimeDisplay.split(':')[0], 10)
        : new Date(outboundFlight.arrivalTime).getHours();
      return arrHour + 1; // +1h transfer
    }
    if (isFirst && isGroundTransport) {
      let arrHour = 8 + Math.ceil((transport!.totalDuration || 120) / 60);
      if (transport!.transitLegs?.length) {
        const lastLeg = transport!.transitLegs[transport!.transitLegs.length - 1];
        arrHour = new Date(lastLeg.arrival).getHours();
      }
      return arrHour + 1;
    }
    return 9; // Full day starts at 9:00
  });

  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];
    const dayStart = startHourPerDay[ci];

    // Skip days that start early enough (before 14:00) — outdoor activities fit fine
    if (dayStart <= 14) continue;

    // Check for outdoor must-sees on this late-starting day
    for (let ai = cluster.activities.length - 1; ai >= 0; ai--) {
      const a = cluster.activities[ai];
      if (!a.mustSee) continue;

      const nameLC = (a.name || '').toLowerCase();
      const typeLC = (a.type || '').toLowerCase();
      const isOutdoor = OUTDOOR_ACTIVITY_KEYWORDS.some(k => nameLC.includes(k) || typeLC.includes(k));
      if (!isOutdoor) continue;

      // This outdoor must-see is on a late day — move to the earliest-starting day with capacity
      let bestTarget = -1;
      let bestStartHour = 24;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        if (startHourPerDay[ti] >= dayStart) continue; // Not better
        const targetAvail = hoursPerDay[ti] * 60;
        const targetUsed = clusters[ti].activities.reduce((s, act) => s + (act.duration || 60), 0)
          + clusters[ti].activities.length * 20 + 180;
        const remaining = targetAvail - targetUsed;
        if (remaining >= (a.duration || 60) + 20 && startHourPerDay[ti] < bestStartHour) {
          bestStartHour = startHourPerDay[ti];
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1) {
        const [moved] = cluster.activities.splice(ai, 1);
        clusters[bestTarget].activities.push(moved);
        console.log(`[Pipeline V2] Phase 2c: moved outdoor must-see "${moved.name}" from Day ${cluster.dayNumber} (starts ${dayStart}h) → Day ${clusters[bestTarget].dayNumber} (starts ${startHourPerDay[bestTarget]}h)`);
      }
    }
  }

  // Phase 3: Ensure no cluster has 0 activities unless it's truly impossible
  // Days with available time but 0 activities should steal from overfull neighbours
  // Uses 3 passes with decreasing constraints to maximize success
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    if (clusters[ci].activities.length > 0) continue;
    if (maxPerDay[ci] === 0) continue; // No time available, skip

    // Prefer short activities for short days (arrival/departure)
    const availMinutes = hoursPerDay[ci] * 60;
    const slotsToFill = Math.min(maxPerDay[ci], 2);

    for (let s = 0; s < slotsToFill; s++) {
      let bestSource = -1;
      let bestIdx = -1;

      // PASS 1: Steal non-must-see from clusters with >1 non-must-see
      {
        let bestCount = 0;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          const nonMustSees = clusters[ti].activities.filter(a => !a.mustSee).length;
          if (nonMustSees > 1 && clusters[ti].activities.length > bestCount) {
            bestCount = clusters[ti].activities.length;
            bestSource = ti;
          }
        }
      }

      // PASS 2: If PASS 1 failed and target still has 0 activities,
      // steal from clusters with >=1 non-must-see AND >=2 total activities
      if (bestSource === -1 && clusters[ci].activities.length === 0) {
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          const nonMustSees = clusters[ti].activities.filter(a => !a.mustSee).length;
          if (nonMustSees >= 1 && clusters[ti].activities.length >= 2) {
            bestSource = ti;
            break;
          }
        }
      }

      // PASS 3: Last resort — steal a must-see from a cluster with >=3 activities
      if (bestSource === -1 && clusters[ci].activities.length === 0) {
        let worstMustSeeScore = Infinity;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          if (clusters[ti].activities.length < 3) continue;
          for (let ai = 0; ai < clusters[ti].activities.length; ai++) {
            const a = clusters[ti].activities[ai];
            // Prefer short activities that fit the available time
            if ((a.duration || 60) + 20 > availMinutes) continue;
            if (a.score < worstMustSeeScore) {
              worstMustSeeScore = a.score;
              bestSource = ti;
              bestIdx = ai;
            }
          }
        }
        if (bestSource !== -1 && bestIdx !== -1) {
          const [moved] = clusters[bestSource].activities.splice(bestIdx, 1);
          clusters[ci].activities.push(moved);
          console.log(`[Pipeline V2] Phase 3 PASS 3: moved "${moved.name}" from Day ${clusters[bestSource].dayNumber} → empty Day ${clusters[ci].dayNumber}`);
          continue; // Next slot
        }
      }

      if (bestSource === -1) break;

      // For PASS 1 & 2: pick the best-fitting non-must-see (shortest for short days)
      const source = clusters[bestSource];
      let worstIdx = -1;
      let bestFitScore = Infinity;
      for (let ai = 0; ai < source.activities.length; ai++) {
        if (source.activities[ai].mustSee) continue;
        const dur = source.activities[ai].duration || 60;
        // For short days (<4h), prefer shorter activities; otherwise pick lowest score
        const fitScore = availMinutes < 240
          ? dur // prefer shortest
          : source.activities[ai].score; // prefer lowest-scored
        if (fitScore < bestFitScore) {
          bestFitScore = fitScore;
          worstIdx = ai;
        }
      }
      if (worstIdx === -1) break;

      const [moved] = source.activities.splice(worstIdx, 1);
      clusters[ci].activities.push(moved);
    }
  }

  // Phase 4: Must-see distribution check
  // Verify must-sees are spread across days. If a short day (arrival/departure) holds a
  // must-see that won't fit timewise, move it to a full day, evicting if needed.
  const allMustSees = clusters.flatMap(c => c.activities.filter(a => a.mustSee));
  const mustSeeIds = new Set(allMustSees.map(a => a.id));

  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];
    const availMin = hoursPerDay[ci] * 60;
    const totalDuration = cluster.activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + 180;

    // If this day is overloaded and has must-sees, ensure must-sees survive by moving non-must-sees out
    if (totalDuration > availMin) {
      const overflowMin = totalDuration - availMin;
      const nonMustSees = cluster.activities
        .filter(a => !a.mustSee)
        .sort((a, b) => a.score - b.score); // lowest score first

      let freedMin = 0;
      for (const nm of nonMustSees) {
        if (freedMin >= overflowMin) break;

        // Find a day that can absorb this activity
        let bestTarget = -1;
        let bestRemaining = -Infinity;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          const tAvail = hoursPerDay[ti] * 60;
          const tUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + 180;
          const remaining = tAvail - tUsed;
          if (remaining > bestRemaining && remaining >= (nm.duration || 60) + 20) {
            bestRemaining = remaining;
            bestTarget = ti;
          }
        }

        if (bestTarget !== -1) {
          const idx = cluster.activities.findIndex(a => a.id === nm.id);
          if (idx !== -1) {
            const [moved] = cluster.activities.splice(idx, 1);
            clusters[bestTarget].activities.push(moved);
            freedMin += (moved.duration || 60) + 20;
            console.log(`[Pipeline V2] Phase 4: moved non-must-see "${moved.name}" from overloaded Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber} to protect must-sees`);
          }
        }
      }
    }
  }

  // Also check: if any must-see is orphaned (not in any cluster), inject it
  const allClusterActivityIds = new Set(clusters.flatMap(c => c.activities.map(a => a.id)));
  const missingMustSees = allMustSees.filter(a => !allClusterActivityIds.has(a.id));

  for (const mustSee of missingMustSees) {
    // Find the day with the most remaining capacity
    let bestDay = -1;
    let bestRemaining = -Infinity;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (isDayTrip[ci]) continue;
      const availMin = hoursPerDay[ci] * 60;
      const usedMin = clusters[ci].activities.reduce((s, a) => s + (a.duration || 60), 0)
        + clusters[ci].activities.length * 20 + 180;
      const remaining = availMin - usedMin;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestDay = ci;
      }
    }

    if (bestDay === -1) continue;

    // If there's enough room, just add
    if (bestRemaining >= (mustSee.duration || 60) + 20) {
      clusters[bestDay].activities.push(mustSee);
      console.log(`[Pipeline V2] Phase 4: injected missing must-see "${mustSee.name}" into Day ${clusters[bestDay].dayNumber} (${Math.round(bestRemaining)}min remaining)`);
    } else {
      // Not enough room — evict the lowest-scored non-must-see from this day
      const nonMustSees = clusters[bestDay].activities
        .filter(a => !a.mustSee)
        .sort((a, b) => a.score - b.score);
      if (nonMustSees.length > 0) {
        const evictIdx = clusters[bestDay].activities.findIndex(a => a.id === nonMustSees[0].id);
        if (evictIdx !== -1) {
          const [evicted] = clusters[bestDay].activities.splice(evictIdx, 1);
          clusters[bestDay].activities.push(mustSee);
          console.log(`[Pipeline V2] Phase 4: evicted "${evicted.name}" (score=${evicted.score.toFixed(1)}) to inject must-see "${mustSee.name}" into Day ${clusters[bestDay].dayNumber}`);
        }
      }
    }
  }

  // Phase 5: FINAL must-see guarantee
  // After all rebalancing, verify EVERY must-see is on a day where it can physically fit.
  // If a must-see is on a short day (arrival/departure) that's too full, move it to the
  // fullest-capacity day, evicting a non-must-see if needed.
  // This is the LAST line of defense before step6 (Claude) and step7 (assembly).
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];
    const availMin = hoursPerDay[ci] * 60;
    const mealOverhead = 180;

    // Check each must-see on this day
    for (let ai = cluster.activities.length - 1; ai >= 0; ai--) {
      const activity = cluster.activities[ai];
      if (!activity.mustSee) continue;

      // Calculate total duration of THIS day including this must-see
      const totalDuration = cluster.activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + mealOverhead;

      // If the day can't fit all its activities, check if moving this must-see helps
      if (totalDuration <= availMin) continue; // Day fits fine

      // This day is overloaded with this must-see in it.
      // Find a better day: one with more remaining capacity that can fit this must-see
      let bestTarget = -1;
      let bestRemaining = -Infinity;

      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        const tAvail = hoursPerDay[ti] * 60;
        const tUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + mealOverhead;
        const remaining = tAvail - tUsed;
        if (remaining > bestRemaining && remaining >= (activity.duration || 60) + 20) {
          bestRemaining = remaining;
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1) {
        // Move must-see to a day with capacity
        const [moved] = cluster.activities.splice(ai, 1);
        clusters[bestTarget].activities.push(moved);
        console.log(`[Pipeline V2] Phase 5: moved must-see "${moved.name}" from overloaded Day ${cluster.dayNumber} (${availMin}min avail, ${totalDuration}min needed) → Day ${clusters[bestTarget].dayNumber} (${Math.round(bestRemaining)}min remaining)`);
      } else {
        // No day has enough room — evict the lowest-scored non-must-see from the best day
        // to make room for this must-see
        let evictDay = -1;
        let evictRemaining = -Infinity;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          const tAvail = hoursPerDay[ti] * 60;
          const tUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + mealOverhead;
          const remaining = tAvail - tUsed;
          // Check if this day has at least one non-must-see we can evict
          const hasNonMustSee = clusters[ti].activities.some(a => !a.mustSee);
          if (hasNonMustSee && remaining > evictRemaining) {
            evictRemaining = remaining;
            evictDay = ti;
          }
        }

        if (evictDay !== -1) {
          // Find the lowest-scored non-must-see on the eviction day
          const evictTarget = clusters[evictDay].activities
            .filter(a => !a.mustSee)
            .sort((a, b) => a.score - b.score)[0];

          if (evictTarget) {
            const evictIdx = clusters[evictDay].activities.findIndex(a => a.id === evictTarget.id);
            if (evictIdx !== -1) {
              clusters[evictDay].activities.splice(evictIdx, 1);
              const [moved] = cluster.activities.splice(ai, 1);
              clusters[evictDay].activities.push(moved);
              console.log(`[Pipeline V2] Phase 5: evicted "${evictTarget.name}" (score=${evictTarget.score.toFixed(1)}) from Day ${clusters[evictDay].dayNumber}, injected must-see "${moved.name}" (score=${moved.score.toFixed(1)})`);
            }
          }
        }
      }
    }
  }

  // Phase 6: Fatigue balancing
  // Limit heavy activities (≥90min) to max 2 per day. This prevents exhausting
  // days like "Vatican 3h + Palais Valentini 2h + Château St-Ange 70min".
  // Move lowest-scored heavy non-must-see to the day with fewest heavy activities.
  const MAX_HEAVY_PER_DAY = 2;
  const HEAVY_THRESHOLD_MIN = 90;

  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];
    const heavyActivities = cluster.activities.filter(a => (a.duration || 60) >= HEAVY_THRESHOLD_MIN);

    if (heavyActivities.length <= MAX_HEAVY_PER_DAY) continue;

    // Too many heavy activities — move the lowest-scored non-must-see heavy ones
    const moveCandidates = heavyActivities
      .filter(a => !a.mustSee)
      .sort((a, b) => a.score - b.score);

    let toMove = heavyActivities.length - MAX_HEAVY_PER_DAY;
    for (const candidate of moveCandidates) {
      if (toMove <= 0) break;

      // Find the day with the fewest heavy activities that has capacity
      let bestTarget = -1;
      let fewestHeavy = Infinity;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        const targetHeavy = clusters[ti].activities.filter(a => (a.duration || 60) >= HEAVY_THRESHOLD_MIN).length;
        const tAvail = hoursPerDay[ti] * 60;
        const tUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + 180;
        const remaining = tAvail - tUsed;
        if (targetHeavy < fewestHeavy && remaining >= (candidate.duration || 60) + 20) {
          fewestHeavy = targetHeavy;
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1 && fewestHeavy < MAX_HEAVY_PER_DAY) {
        const idx = cluster.activities.findIndex(a => a.id === candidate.id);
        if (idx !== -1) {
          const [moved] = cluster.activities.splice(idx, 1);
          clusters[bestTarget].activities.push(moved);
          toMove--;
          console.log(`[Pipeline V2] Phase 6: moved heavy activity "${moved.name}" (${moved.duration}min) from Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber} (fatigue balancing)`);
        }
      }
    }
  }

  // Log rebalancing result with must-see details
  console.log(`[Pipeline V2] Rebalanced clusters: ${clusters.map((c, i) =>
    `Day ${c.dayNumber}: ${c.activities.length} activities [${c.activities.filter(a => a.mustSee).length} must-sees] (${hoursPerDay[i].toFixed(1)}h avail, max ${maxPerDay[i]})`
  ).join(', ')}`);

  // Log all must-sees placement
  const allMustSeesAfter = clusters.flatMap(c => c.activities.filter(a => a.mustSee));
  console.log(`[Pipeline V2] Must-sees after rebalancing: ${allMustSeesAfter.map(a => `"${a.name}" (score=${a.score.toFixed(1)})`).join(', ')}`);
  for (const c of clusters) {
    const ms = c.activities.filter(a => a.mustSee);
    if (ms.length > 0) {
      console.log(`[Pipeline V2]   Day ${c.dayNumber}: ${ms.map(a => a.name).join(', ')}`);
    }
  }
}

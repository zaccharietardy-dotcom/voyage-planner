/**
 * Pipeline V2 — Main Orchestrator
 *
 * Replaces the old ai.ts pipeline (1400+ lines, 13 sequential phases, 3-5 min)
 * with a clean 7-step approach: parallel fetch → algorithmic organization → single Claude call.
 *
 * Target: 20-40s per trip generation.
 */

import type { Trip, TripPreferences, Flight, TransportOptionSummary, Restaurant } from '../types';
import type { ActivityCluster, CityDensityProfile, MealAssignment, ScoredActivity } from './types';
import { fetchAllData } from './step1-fetch';
import { scoreAndSelectActivities } from './step2-score';
import { clusterActivities, computeCityDensityProfile } from './step3-cluster';
import { assignRestaurants } from './step4-restaurants';
import { selectHotelByBarycenter } from './step5-hotel';
import { balanceDaysWithClaude } from './step6-balance';
import { assembleTripSchedule } from './step7-assemble';
import { calculateDistance } from '../services/geocoding';
import { searchRestaurantsWithSerpApi } from '../services/serpApiPlaces';
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
  const densityProfile = computeCityDensityProfile(selectedActivities, preferences.durationDays);
  const clusters = clusterActivities(selectedActivities, preferences.durationDays, data.destCoords, densityProfile);

  // Rebalance: first/last day get fewer activities based on flight/transport times
  rebalanceClustersForFlights(
    clusters,
    data.outboundFlight,
    data.returnFlight,
    preferences.durationDays,
    bestTransport,
    data.destCoords,
    densityProfile
  );

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
  const supplementalRestaurants = await fetchSupplementalRestaurantsForSparseAreas(
    preferences.destination,
    clusters,
    accommodationCoords,
    [...data.tripAdvisorRestaurants, ...data.serpApiRestaurants]
  );
  let serpRestaurantsForAssignment = deduplicateRestaurantsByNameAndCoords([
    ...data.serpApiRestaurants,
    ...supplementalRestaurants,
  ]);
  if (supplementalRestaurants.length > 0) {
    console.log(
      `[Pipeline V2] Step 4: supplemental API restaurants fetched=${supplementalRestaurants.length}, total SerpAPI pool=${serpRestaurantsForAssignment.length}`
    );
  }

  let restaurantResult = assignRestaurants(
    clusters,
    data.tripAdvisorRestaurants,
    serpRestaurantsForAssignment,
    preferences,
    data.budgetStrategy,
    accommodationCoords,
    hotel
  );
  let meals = restaurantResult.meals;
  let restaurantGeoPool = restaurantResult.restaurantGeoPool;
  const missingMeals = meals.filter(m => !m.restaurant);
  if (missingMeals.length > 0) {
    const targetedRestaurants = await fetchTargetedRestaurantsForMissingMeals(
      preferences.destination,
      missingMeals
    );
    if (targetedRestaurants.length > 0) {
      serpRestaurantsForAssignment = deduplicateRestaurantsByNameAndCoords([
        ...serpRestaurantsForAssignment,
        ...targetedRestaurants,
      ]);
      const retryResult = assignRestaurants(
        clusters,
        data.tripAdvisorRestaurants,
        serpRestaurantsForAssignment,
        preferences,
        data.budgetStrategy,
        accommodationCoords,
        hotel
      );
      meals = retryResult.meals;
      restaurantGeoPool = retryResult.restaurantGeoPool;
      const remainingMissing = meals.filter(m => !m.restaurant).length;
      console.log(
        `[Pipeline V2] Step 4 retry: targeted API fetched=${targetedRestaurants.length}, missing meals ${missingMeals.length} -> ${remainingMissing}`
      );
    }
  }
  const assignedCount = meals.filter(m => m.restaurant).length;
  console.log(`[Pipeline V2] Step 4: ${assignedCount}/${meals.length} meals assigned restaurants (pool=${restaurantGeoPool.length})`);

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
    bestTransport, preferences, data,
    restaurantGeoPool
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
 * Build geographically meaningful anchors where meals are likely to happen.
 * We query around these anchors when the initial restaurant pool is sparse.
 */
function buildRestaurantAnchors(
  clusters: ActivityCluster[],
  accommodationCoords: { lat: number; lng: number }
): { lat: number; lng: number; label: string }[] {
  const raw: { lat: number; lng: number; label: string }[] = [];

  raw.push({ lat: accommodationCoords.lat, lng: accommodationCoords.lng, label: 'hotel' });

  for (const cluster of clusters) {
    raw.push({ lat: cluster.centroid.lat, lng: cluster.centroid.lng, label: `day-${cluster.dayNumber}-centroid` });
    const first = cluster.activities[0];
    const last = cluster.activities[cluster.activities.length - 1];
    if (first) raw.push({ lat: first.latitude, lng: first.longitude, label: `day-${cluster.dayNumber}-first` });
    if (last) raw.push({ lat: last.latitude, lng: last.longitude, label: `day-${cluster.dayNumber}-last` });
  }

  const seen = new Set<string>();
  const deduped: { lat: number; lng: number; label: string }[] = [];
  for (const a of raw) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    const key = `${a.lat.toFixed(2)},${a.lng.toFixed(2)}`; // ~1km dedup
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  // Keep request volume bounded.
  return deduped.slice(0, 8);
}

function hasRestaurantCoords(r: Restaurant): boolean {
  return Boolean(r.latitude && r.longitude && r.latitude !== 0 && r.longitude !== 0);
}

function countRestaurantsNear(
  restaurants: Restaurant[],
  anchor: { lat: number; lng: number },
  radiusKm: number
): number {
  let count = 0;
  for (const r of restaurants) {
    if (!hasRestaurantCoords(r)) continue;
    const d = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
    if (d <= radiusKm) count++;
  }
  return count;
}

function deduplicateRestaurantsByNameAndCoords(restaurants: Restaurant[]): Restaurant[] {
  const normalizeName = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

  const map = new Map<string, Restaurant>();
  for (const r of restaurants) {
    const coordsKey = hasRestaurantCoords(r)
      ? `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`
      : 'no-coords';
    const key = `${normalizeName(r.name)}|${coordsKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, r);
      continue;
    }

    const existingScore = (existing.reviewCount || 0) * (existing.rating || 0);
    const currentScore = (r.reviewCount || 0) * (r.rating || 0);
    if (currentScore > existingScore) {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}

function buildMissingMealTargets(
  missingMeals: MealAssignment[]
): Array<{ lat: number; lng: number; mealType: 'breakfast' | 'lunch' | 'dinner' }> {
  const dedup = new Map<string, { lat: number; lng: number; mealType: 'breakfast' | 'lunch' | 'dinner' }>();
  for (const meal of missingMeals) {
    const { referenceCoords } = meal;
    if (!Number.isFinite(referenceCoords.lat) || !Number.isFinite(referenceCoords.lng)) continue;
    const key = `${meal.mealType}|${referenceCoords.lat.toFixed(3)},${referenceCoords.lng.toFixed(3)}`;
    if (!dedup.has(key)) {
      dedup.set(key, {
        lat: referenceCoords.lat,
        lng: referenceCoords.lng,
        mealType: meal.mealType,
      });
    }
  }

  // Keep latency and quota predictable.
  return Array.from(dedup.values()).slice(0, 6);
}

async function fetchTargetedRestaurantsForMissingMeals(
  destination: string,
  missingMeals: MealAssignment[]
): Promise<Restaurant[]> {
  const targets = buildMissingMealTargets(missingMeals);
  if (targets.length === 0) return [];

  console.log(
    `[Pipeline V2] Step 4 retry prefetch: missing meals=${missingMeals.length}, targets=${targets.length}`
  );

  const results = await Promise.allSettled(
    targets.map(target =>
      searchRestaurantsWithSerpApi(destination, {
        latitude: target.lat,
        longitude: target.lng,
        mealType: target.mealType,
        limit: 25,
      })
    )
  );

  const supplemental: Restaurant[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      supplemental.push(...r.value);
    }
  }

  return deduplicateRestaurantsByNameAndCoords(supplemental);
}

/**
 * Patch API coverage gaps: if some anchors have too few nearby restaurants in the current pool,
 * fetch additional SerpAPI results around those anchors.
 */
async function fetchSupplementalRestaurantsForSparseAreas(
  destination: string,
  clusters: ActivityCluster[],
  accommodationCoords: { lat: number; lng: number },
  existingRestaurants: Restaurant[]
): Promise<Restaurant[]> {
  const anchors = buildRestaurantAnchors(clusters, accommodationCoords);
  const existingWithCoords = existingRestaurants.filter(hasRestaurantCoords);

  // Sparse if fewer than 3 restaurants in a ~3.2km radius.
  const sparseAnchors = anchors.filter(a => countRestaurantsNear(existingWithCoords, a, 3.2) < 3);
  if (sparseAnchors.length === 0) {
    return [];
  }

  // Keep API usage controlled.
  const targets = sparseAnchors.slice(0, 4);
  console.log(
    `[Pipeline V2] Step 4 prefetch: sparse anchors=${targets.length}/${anchors.length} (${targets.map(t => t.label).join(', ')})`
  );

  const responses = await Promise.allSettled(
    targets.map(anchor =>
      searchRestaurantsWithSerpApi(destination, {
        latitude: anchor.lat,
        longitude: anchor.lng,
        limit: 25,
      })
    )
  );

  const supplemental: Restaurant[] = [];
  for (const res of responses) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      supplemental.push(...res.value);
    }
  }

  return deduplicateRestaurantsByNameAndCoords(supplemental);
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
  transport?: TransportOptionSummary | null,
  destCoords?: { lat: number; lng: number },
  densityProfile?: CityDensityProfile
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

  // Dynamic meal overhead: arrival/departure days have fewer meals
  const computeMealOverheadMin = (ci: number): number => {
    const cluster = clusters[ci];
    const isFirst = cluster.dayNumber === 1;
    const isLast = cluster.dayNumber === numDays;
    const h = hoursPerDay[ci];
    // Short day (arrival or departure) → fewer meals
    if (isFirst && h < 8) return 75;   // dinner only (~75min)
    if (isLast && h < 8) return 60;    // lunch only (~60min)
    // Full day: breakfast 30min + lunch 60min + dinner 75min = 165min
    return 165;
  };

  // Max activities per day: account for actual activity durations when available
  // Subtract meal overhead from available hours (dynamic per day type)
  const maxPerDay = hoursPerDay.map((h, ci) => {
    const mealHours = computeMealOverheadMin(ci) / 60;
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

  const computeClusterGeo = (cluster: ActivityCluster): void => {
    if (cluster.activities.length === 0) return;
    const lat = cluster.activities.reduce((s, a) => s + a.latitude, 0) / cluster.activities.length;
    const lng = cluster.activities.reduce((s, a) => s + a.longitude, 0) / cluster.activities.length;
    cluster.centroid = { lat, lng };

    let intra = 0;
    for (let i = 0; i < cluster.activities.length - 1; i++) {
      const a = cluster.activities[i];
      const b = cluster.activities[i + 1];
      intra += calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
    }
    cluster.totalIntraDistance = intra;
  };

  const dayUsedMinutes = (idx: number): number =>
    clusters[idx].activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + computeMealOverheadMin(idx);

  const dayRemainingMinutes = (idx: number): number =>
    hoursPerDay[idx] * 60 - dayUsedMinutes(idx);

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
    const mealOverhead = computeMealOverheadMin(ci);

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

  // Phase 7: Type diversity balancing
  // Prevent days with >2 activities of the same broad category (4 museums = exhausting).
  // Swap lowest-scored excess same-type non-must-see with another day.
  const DIVERSITY_CATEGORIES: Record<string, string[]> = {
    culture: ['museum', 'musée', 'museo', 'gallery', 'galerie', 'galleria', 'palace', 'palais', 'palazzo',
              'cathedral', 'cathédrale', 'church', 'église', 'chiesa', 'basilica', 'basilique',
              'castle', 'château', 'monument', 'temple', 'mosque', 'synagogue', 'historic'],
    nature: ['park', 'parc', 'garden', 'jardin', 'botanical', 'botanique', 'beach', 'plage',
             'viewpoint', 'belvédère', 'trail', 'randonnée', 'zoo', 'promenade'],
    nightlife: ['bar', 'pub', 'club', 'nightlife', 'cocktail', 'brewery', 'karaoke'],
  };

  function getActivityCategory(a: ScoredActivity): string {
    const text = `${(a.name || '').toLowerCase()} ${(a.type || '').toLowerCase()}`;
    for (const [cat, keywords] of Object.entries(DIVERSITY_CATEGORIES)) {
      if (keywords.some(k => text.includes(k))) return cat;
    }
    return 'other';
  }

  const MAX_SAME_CATEGORY_PER_DAY = 2;

  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    const cluster = clusters[ci];

    // Count activities per category
    const catCounts = new Map<string, ScoredActivity[]>();
    for (const a of cluster.activities) {
      const cat = getActivityCategory(a);
      if (!catCounts.has(cat)) catCounts.set(cat, []);
      catCounts.get(cat)!.push(a);
    }

    for (const [cat, catActivities] of catCounts) {
      if (cat === 'other') continue;
      if (catActivities.length <= MAX_SAME_CATEGORY_PER_DAY) continue;

      // Too many of this category — move lowest-scored non-must-see
      const swapCandidates = catActivities
        .filter(a => !a.mustSee)
        .sort((a, b) => a.score - b.score);

      let toMove = catActivities.length - MAX_SAME_CATEGORY_PER_DAY;
      for (const candidate of swapCandidates) {
        if (toMove <= 0) break;

        // Find target day with fewest of this category AND capacity
        let bestTarget = -1;
        let fewestCat = Infinity;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          const targetCatCount = clusters[ti].activities.filter(a => getActivityCategory(a) === cat).length;
          const tAvail = hoursPerDay[ti] * 60;
          const tUsed = clusters[ti].activities.reduce((s, a) => s + (a.duration || 60) + 20, 0) + 180;
          const remaining = tAvail - tUsed;
          if (targetCatCount < fewestCat && remaining >= (candidate.duration || 60) + 20) {
            fewestCat = targetCatCount;
            bestTarget = ti;
          }
        }

        if (bestTarget !== -1 && fewestCat < MAX_SAME_CATEGORY_PER_DAY) {
          const idx = cluster.activities.findIndex(a => a.id === candidate.id);
          if (idx !== -1) {
            const [moved] = cluster.activities.splice(idx, 1);
            clusters[bestTarget].activities.push(moved);
            toMove--;
            console.log(`[Pipeline V2] Phase 7: moved "${moved.name}" (${cat}) from Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber} (type diversity)`);
          }
        }
      }
    }
  }

  // Phase 7b: Strict must-see zone consolidation
  // Group nearby must-sees (same neighborhood) onto a single day whenever possible.
  // This avoids splitting key zones (e.g. Vatican) across multiple days.
  // Keep this radius tight to form true "same neighborhood" groups,
  // not broad city-center chains.
  const MUST_SEE_GROUP_KM = clusters.length >= 4 ? 1.4 : 1.8;

  const findActivityDay = (activityId: string): number =>
    clusters.findIndex(c => c.activities.some(a => a.id === activityId));

  const ensureCapacityOnDay = (targetIdx: number, neededMin: number, protectedIds: Set<string>): boolean => {
    let remaining = dayRemainingMinutes(targetIdx);
    if (remaining >= neededMin) return true;

    let deficit = neededMin - remaining;
    const evictables = [...clusters[targetIdx].activities]
      .filter(a => !a.mustSee && !protectedIds.has(a.id))
      .sort((a, b) => a.score - b.score);

    for (const evict of evictables) {
      const evictMin = (evict.duration || 60) + 20;
      let bestReceiver = -1;
      let bestReceiverRemaining = -Infinity;

      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === targetIdx || isDayTrip[ti]) continue;
        const receiverRemaining = dayRemainingMinutes(ti);
        if (receiverRemaining < evictMin) continue;
        if (receiverRemaining > bestReceiverRemaining) {
          bestReceiverRemaining = receiverRemaining;
          bestReceiver = ti;
        }
      }

      if (bestReceiver === -1) continue;

      const evictIdx = clusters[targetIdx].activities.findIndex(a => a.id === evict.id);
      if (evictIdx === -1) continue;

      const [movedEvict] = clusters[targetIdx].activities.splice(evictIdx, 1);
      clusters[bestReceiver].activities.push(movedEvict);
      computeClusterGeo(clusters[targetIdx]);
      computeClusterGeo(clusters[bestReceiver]);

      deficit -= evictMin;
      if (deficit <= 0) return true;
    }

    remaining = dayRemainingMinutes(targetIdx);
    return remaining >= neededMin;
  };

  const mustSeeNodes = clusters.flatMap((cluster) =>
    cluster.activities
      .filter(a => a.mustSee)
      .map(a => ({ activity: a }))
  );

  if (mustSeeNodes.length >= 2) {
    const adjacency = new Map<string, Set<string>>();
    for (const node of mustSeeNodes) adjacency.set(node.activity.id, new Set());

    for (let i = 0; i < mustSeeNodes.length; i++) {
      for (let j = i + 1; j < mustSeeNodes.length; j++) {
        const a = mustSeeNodes[i].activity;
        const b = mustSeeNodes[j].activity;
        const dist = calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
        if (dist <= MUST_SEE_GROUP_KM) {
          adjacency.get(a.id)?.add(b.id);
          adjacency.get(b.id)?.add(a.id);
        }
      }
    }

    const visited = new Set<string>();
    const groups: string[][] = [];

    for (const node of mustSeeNodes) {
      const startId = node.activity.id;
      if (visited.has(startId)) continue;

      const queue = [startId];
      visited.add(startId);
      const component: string[] = [];

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        for (const next of adjacency.get(current) || []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }

      if (component.length >= 2) groups.push(component);
    }

    groups.sort((a, b) => b.length - a.length);

    for (const groupIdsArr of groups) {
      const groupIds = new Set(groupIdsArr);
      const involvedDays = Array.from(
        new Set(groupIdsArr.map(id => findActivityDay(id)).filter(idx => idx >= 0))
      ).filter(idx => !isDayTrip[idx] && hoursPerDay[idx] > 0);

      if (involvedDays.length <= 1) continue;

      let targetIdx = involvedDays[0];
      let targetScore = -Infinity;
      for (const di of involvedDays) {
        const alreadyThere = clusters[di].activities.filter(a => groupIds.has(a.id)).length;
        const shortDayPenalty = hoursPerDay[di] < 7 ? 400 : 0;
        const score = alreadyThere * 1000 + dayRemainingMinutes(di) - shortDayPenalty;
        if (score > targetScore) {
          targetScore = score;
          targetIdx = di;
        }
      }

      for (const activityId of groupIdsArr) {
        const sourceIdx = findActivityDay(activityId);
        if (sourceIdx === -1 || sourceIdx === targetIdx) continue;
        if (isDayTrip[sourceIdx]) continue;
        if (clusters[sourceIdx].activities.length <= 1 && hoursPerDay[sourceIdx] >= 6) continue;

        const activity = clusters[sourceIdx].activities.find(a => a.id === activityId);
        if (!activity) continue;

        const neededMin = (activity.duration || 60) + 20;
        const canFit = ensureCapacityOnDay(targetIdx, neededMin, groupIds);
        if (!canFit) continue;

        const moveIdx = clusters[sourceIdx].activities.findIndex(a => a.id === activityId);
        if (moveIdx === -1) continue;

        const [moved] = clusters[sourceIdx].activities.splice(moveIdx, 1);
        clusters[targetIdx].activities.push(moved);
        computeClusterGeo(clusters[sourceIdx]);
        computeClusterGeo(clusters[targetIdx]);

        console.log(
          `[Pipeline V2] Phase 7b: consolidated must-see "${moved.name}" Day ${clusters[sourceIdx].dayNumber} → Day ${clusters[targetIdx].dayNumber} ` +
          `(zone<=${MUST_SEE_GROUP_KM}km)`
        );
      }
    }
  }

  // Phase 8: Geographic KNN smoothing
  // Reassign obvious geographic outliers to the nearest day cluster (if capacity allows).
  // This prevents "aller-retour" patterns where a day contains activities that are
  // significantly closer to another day's centroid.
  for (const c of clusters) computeClusterGeo(c);

  for (let iter = 0; iter < 3; iter++) {
    let movedAny = false;

    for (let ci = 0; ci < clusters.length; ci++) {
      if (isDayTrip[ci]) continue;
      if (clusters[ci].activities.length <= 1) continue;

      const source = clusters[ci];
      const candidates = [...source.activities]
        .filter(a => !a.mustSee)
        .sort((a, b) => {
          const da = calculateDistance(a.latitude, a.longitude, source.centroid.lat, source.centroid.lng);
          const db = calculateDistance(b.latitude, b.longitude, source.centroid.lat, source.centroid.lng);
          return db - da; // largest outlier first
        });

      for (const activity of candidates) {
        const srcDist = calculateDistance(activity.latitude, activity.longitude, source.centroid.lat, source.centroid.lng);
        const requiredMin = (activity.duration || 60) + 20;

        let bestTarget = -1;
        let bestTargetDist = Infinity;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          if (dayRemainingMinutes(ti) < requiredMin) continue;

          const targetDist = calculateDistance(
            activity.latitude,
            activity.longitude,
            clusters[ti].centroid.lat,
            clusters[ti].centroid.lng
          );
          if (targetDist < bestTargetDist) {
            bestTargetDist = targetDist;
            bestTarget = ti;
          }
        }

        if (bestTarget === -1) continue;

        // Move only if there is a clear geographic win.
        const improvementKm = srcDist - bestTargetDist;
        if (improvementKm < 3) continue;

        const idx = source.activities.findIndex(a => a.id === activity.id);
        if (idx === -1) continue;
        const [moved] = source.activities.splice(idx, 1);
        clusters[bestTarget].activities.push(moved);
        computeClusterGeo(source);
        computeClusterGeo(clusters[bestTarget]);
        movedAny = true;

        console.log(
          `[Pipeline V2] Phase 8: moved outlier "${moved.name}" Day ${source.dayNumber} → Day ${clusters[bestTarget].dayNumber} ` +
          `(improvement ${improvementKm.toFixed(1)}km, ${srcDist.toFixed(1)}→${bestTargetDist.toFixed(1)}km)`
        );
        break; // Re-evaluate source cluster after each move
      }
    }

    if (!movedAny) break;
  }

  // Phase 8b: Enforce per-day geographic cohesion ("city zones per day")
  // Goal: avoid days that zigzag across distant neighborhoods.
  // We move far outliers from a day to the geographically closest day that has capacity.
  for (const c of clusters) computeClusterGeo(c);

  // Use density profile for adaptive cohesion radius (1.5x cluster radius as post-processing tolerance)
  const cohesionMaxRadiusKm = densityProfile
    ? densityProfile.maxClusterRadius * 1.5
    : (clusters.length <= 3 ? 3.2 : clusters.length === 4 ? 3.6 : 3.8);
  const minCohesionGainKm = densityProfile?.densityCategory === 'dense' ? 0.3 : 0.5;
  for (let iter = 0; iter < 5; iter++) {
    let movedAny = false;

    for (let ci = 0; ci < clusters.length; ci++) {
      if (isDayTrip[ci]) continue;
      const source = clusters[ci];
      if (source.activities.length <= 2) continue;

      const sourceCandidates = [...source.activities]
        .filter(a => !a.mustSee)
        .map(a => ({
          activity: a,
          dist: calculateDistance(a.latitude, a.longitude, source.centroid.lat, source.centroid.lng),
        }))
        .filter(x => x.dist > cohesionMaxRadiusKm)
        .sort((a, b) => b.dist - a.dist); // farthest first

      for (const candidate of sourceCandidates) {
        const activity = candidate.activity;
        const srcDist = candidate.dist;
        const requiredMin = (activity.duration || 60) + 20;

        let bestTarget = -1;
        let bestTargetDist = Infinity;
        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || isDayTrip[ti]) continue;
          if (dayRemainingMinutes(ti) < requiredMin) continue;

          const targetDist = calculateDistance(
            activity.latitude,
            activity.longitude,
            clusters[ti].centroid.lat,
            clusters[ti].centroid.lng
          );
          if (targetDist < bestTargetDist) {
            bestTargetDist = targetDist;
            bestTarget = ti;
          }
        }

        if (bestTarget === -1) continue;
        // Require a clear gain to avoid noisy shuffling.
        if (bestTargetDist + minCohesionGainKm >= srcDist) continue;

        const idx = source.activities.findIndex(a => a.id === activity.id);
        if (idx === -1) continue;

        const [moved] = source.activities.splice(idx, 1);
        clusters[bestTarget].activities.push(moved);
        computeClusterGeo(source);
        computeClusterGeo(clusters[bestTarget]);
        movedAny = true;

        console.log(
          `[Pipeline V2] Phase 8b: moved "${moved.name}" Day ${source.dayNumber} → Day ${clusters[bestTarget].dayNumber} ` +
          `(cohesion ${srcDist.toFixed(1)}→${bestTargetDist.toFixed(1)}km, max=${cohesionMaxRadiusKm}km)`
        );
        break; // Re-evaluate this source day after each move
      }
    }

    if (!movedAny) break;
  }

  // Optional lightweight zone ordering around city center (if known): keep day sequence coherent by geography.
  // This keeps "day neighborhoods" flowing around the city instead of jumping back and forth.
  if (destCoords && clusters.length >= 4) {
    const first = clusters[0];
    const last = clusters[clusters.length - 1];
    const middle = clusters.slice(1, -1);
    const withAngle = middle.map(c => ({
      cluster: c,
      angle: Math.atan2(c.centroid.lat - destCoords.lat, c.centroid.lng - destCoords.lng),
    }));
    withAngle.sort((a, b) => a.angle - b.angle);
    const reordered = [first, ...withAngle.map(x => x.cluster), last];
    for (let i = 0; i < reordered.length; i++) reordered[i].dayNumber = i + 1;
    clusters.splice(0, clusters.length, ...reordered);
    console.log('[Pipeline V2] Phase 8c: reordered middle days by city-zone angle');
  }

  // Phase 9: Reorder middle days by proximity (fallback when no city-center anchor is available).
  // For trips with 4+ days this reduces A→B→A day patterns.
  if (clusters.length >= 4 && !destCoords) {
    const first = clusters[0];
    const middle = clusters.slice(1, -1);
    const last = clusters[clusters.length - 1];

    const orderedMiddle: ActivityCluster[] = [];
    const remaining = [...middle];
    let curLat = first.centroid.lat;
    let curLng = first.centroid.lng;

    while (remaining.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = calculateDistance(curLat, curLng, remaining[i].centroid.lat, remaining[i].centroid.lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      const next = remaining.splice(nearestIdx, 1)[0];
      orderedMiddle.push(next);
      curLat = next.centroid.lat;
      curLng = next.centroid.lng;
    }

    const reordered = [first, ...orderedMiddle, last];
    for (let i = 0; i < reordered.length; i++) reordered[i].dayNumber = i + 1;
    clusters.splice(0, clusters.length, ...reordered);
    console.log('[Pipeline V2] Phase 9: reordered middle days by nearest-neighbor centroids');
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

/**
 * Pipeline V2 — Main Orchestrator
 *
 * Replaces the old ai.ts pipeline (1400+ lines, 13 sequential phases, 3-5 min)
 * with a clean 7-step approach: parallel fetch → algorithmic organization → single Claude call.
 *
 * Target: 20-40s per trip generation.
 */

import type { Trip, TripPreferences, Flight, TransportOptionSummary, Restaurant } from '../types';
import type { ActivityCluster, CityDensityProfile, MealAssignment, ScoredActivity, OnPipelineEvent, FetchedData } from './types';
export type { PipelineEvent, OnPipelineEvent } from './types';
import { fetchAllData } from './step1-fetch';
import { scoreAndSelectActivities } from './step2-score';
import { clusterActivities, computeCityDensityProfile } from './step3-cluster';
import { assignRestaurants } from './step4-restaurants';
import { selectHotelByBarycenter } from './step5-hotel';
import { balanceDays, balanceDaysWithClaude } from './step6-balance';
import { assembleTripSchedule } from './step7-assemble';
import { validateAndFixTrip } from './step8-validate';
import { calculateDistance } from '../services/geocoding';
import { searchRestaurantsWithSerpApi } from '../services/serpApiPlaces';
import { diffSerpApiUsage, getSerpApiUsageSnapshot } from '../services/apiUsageTracker';
import {
  accommodationHasKitchen,
  budgetStrategyRequestsSelfCatering,
  sanitizeBudgetStrategyForKitchen,
  stripSelfCateredFallbacks,
} from './utils/accommodation';
import { isDuplicateActivityCandidate } from './utils/activityDedup';

// ---------------------------------------------------------------------------
// Pipeline V2 LLM — New imports
// ---------------------------------------------------------------------------
import { prepareDataForLLM } from './step2-prepare-llm';
import { planWithClaude } from './step3-llm-plan';
import { assembleFromLLMPlan } from './step4-assemble-llm';

// ---------------------------------------------------------------------------
// Pipeline Event System — emit helper
// ---------------------------------------------------------------------------
function emit(onEvent: OnPipelineEvent | undefined, partial: Omit<import('./types').PipelineEvent, 'timestamp'>) {
  onEvent?.({ ...partial, timestamp: Date.now() });
}

/**
 * Generate a trip — routes to LLM or Algorithmic pipeline based on PIPELINE_VERSION env var.
 */
export async function generateTripV2(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const version = process.env.PIPELINE_VERSION || 'v2-llm';

  if (version === 'v2-llm') {
    console.log('[Pipeline V2] Using LLM pipeline (Claude as primary planner)');
    return generateTripV2LLM(preferences, onEvent);
  }

  console.log('[Pipeline V2] Using algorithmic pipeline (legacy)');
  return generateTripV2Algorithmic(preferences, onEvent);
}

/**
 * Pipeline V2 LLM — Claude Sonnet as primary trip planner.
 * Steps: fetchData → prepareForLLM → planWithClaude → assembleTrip → validate
 */
async function generateTripV2LLM(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const T0 = Date.now();

  // Step 1: Fetch all data in parallel (UNCHANGED from algorithmic pipeline)
  console.log('[Pipeline V2 LLM] === Step 1: Fetching data... ===');
  emit(onEvent, { type: 'step_start', step: 1, stepName: 'Fetching data' });
  const data = await fetchAllData(preferences, onEvent);
  const step1Ms = Date.now() - T0;
  console.log(`[Pipeline V2 LLM] Step 1 done in ${step1Ms}ms`);
  emit(onEvent, { type: 'step_done', step: 1, stepName: 'Fetching data', durationMs: step1Ms });

  // Resolve transport (same logic as algorithmic pipeline)
  let bestTransport: TransportOptionSummary | null = null;
  if (preferences.transport && preferences.transport !== 'optimal' && data.transportOptions?.length) {
    bestTransport = data.transportOptions.find(t => t.mode === preferences.transport) || null;
    if (!bestTransport) {
      bestTransport = data.transportOptions.find(t => t.recommended) || data.transportOptions[0] || null;
    }
  } else {
    bestTransport = data.transportOptions?.find(t => t.recommended) || data.transportOptions?.[0] || null;
  }

  // Step 2: Select hotel + prepare data for LLM
  console.log('[Pipeline V2 LLM] === Step 2: Preparing data for Claude... ===');
  emit(onEvent, { type: 'step_start', step: 2, stepName: 'Preparing data for Claude' });
  const T2 = Date.now();

  // Select hotel using existing barycenter logic (need minimal clusters for hotel selection)
  // We'll use a simple approach: compute centroid from all activities
  const allAttractions = [
    ...data.googlePlacesAttractions,
    ...data.serpApiAttractions,
    ...data.viatorActivities,
    ...data.mustSeeAttractions,
  ].filter(a => a.latitude && a.longitude);

  // Build minimal single-cluster for hotel selection
  const centroid = allAttractions.length > 0
    ? {
        lat: allAttractions.reduce((s, a) => s + a.latitude, 0) / allAttractions.length,
        lng: allAttractions.reduce((s, a) => s + a.longitude, 0) / allAttractions.length,
      }
    : data.destCoords;

  const minimalCluster: ActivityCluster = {
    dayNumber: 1,
    activities: [],
    centroid,
    totalIntraDistance: 0,
  };

  const hotel = selectHotelByBarycenter(
    [minimalCluster],
    data.bookingHotels,
    preferences.budgetLevel,
    undefined,
    preferences.durationDays,
    { destination: preferences.destination }
  );

  if (hotel) {
    console.log(`[Pipeline V2 LLM] Hotel selected: "${hotel.name}" (${hotel.rating}★, €${hotel.pricePerNight}/night)`);
  } else {
    console.warn('[Pipeline V2 LLM] No hotel selected from pool');
  }

  const llmInput = prepareDataForLLM(data, preferences, hotel, bestTransport, data.outboundFlight, data.returnFlight);
  console.log(`[Pipeline V2 LLM] Step 2 done in ${Date.now() - T2}ms`);
  emit(onEvent, { type: 'step_done', step: 2, stepName: 'Preparing data for Claude', durationMs: Date.now() - T2,
    detail: `${llmInput.activities.length} activities, ${llmInput.restaurants.length} restaurants, ${Object.keys(llmInput.distances).length} distance pairs` });

  // Step 3: Claude planning
  console.log('[Pipeline V2 LLM] === Step 3: Claude planning... ===');
  emit(onEvent, { type: 'step_start', step: 3, stepName: 'Claude planning' });
  const T3 = Date.now();
  const llmPlan = await planWithClaude(llmInput);
  const step3Ms = Date.now() - T3;
  console.log(`[Pipeline V2 LLM] Step 3 done in ${step3Ms}ms — ${llmPlan.days.length} days planned`);
  emit(onEvent, { type: 'step_done', step: 3, stepName: 'Claude planning', durationMs: step3Ms,
    detail: `${llmPlan.days.length} days, ${llmPlan.days.reduce((s, d) => s + d.items.length, 0)} items` });

  // Step 4: Assemble Trip from LLM plan
  console.log('[Pipeline V2 LLM] === Step 4: Assembling trip... ===');
  emit(onEvent, { type: 'step_start', step: 4, stepName: 'Assembling trip' });
  const T4 = Date.now();
  const trip = await assembleFromLLMPlan(llmPlan, llmInput, data, preferences, hotel, bestTransport, onEvent);
  const step4Ms = Date.now() - T4;
  console.log(`[Pipeline V2 LLM] Step 4 done in ${step4Ms}ms`);
  emit(onEvent, { type: 'step_done', step: 4, stepName: 'Assembling trip', durationMs: step4Ms });

  // Step 5: Light validation
  console.log('[Pipeline V2 LLM] === Step 5: Validating... ===');
  emit(onEvent, { type: 'step_start', step: 5, stepName: 'Validating trip' });
  const T5 = Date.now();
  const validated = validateAndFixTrip(trip);
  console.log(`[Pipeline V2 LLM] Step 5 done in ${Date.now() - T5}ms — score: ${validated.score}/100`);
  emit(onEvent, { type: 'step_done', step: 5, stepName: 'Validating trip', durationMs: Date.now() - T5,
    detail: `Score: ${validated.score}/100, warnings: ${validated.warnings.length}` });

  const totalMs = Date.now() - T0;
  console.log(`[Pipeline V2 LLM] === Total pipeline time: ${totalMs}ms ===`);

  // validateAndFixTrip modifies trip in-place, just return it
  return trip;
}

/**
 * Pipeline V2 Algorithmic — Original 8-step pipeline (archived, still functional).
 */
async function generateTripV2Algorithmic(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const T0 = Date.now();
  const serpApiUsageStart = getSerpApiUsageSnapshot();

  // Step 1: Fetch all data in parallel (~5-10s)
  console.log('[Pipeline V2] === Step 1: Fetching data... ===');
  emit(onEvent, { type: 'step_start', step: 1, stepName: 'Fetching data' });
  const data = await fetchAllData(preferences, onEvent);
  const step1Ms = Date.now() - T0;
  console.log(`[Pipeline V2] Step 1 done in ${step1Ms}ms`);
  emit(onEvent, { type: 'step_done', step: 1, stepName: 'Fetching data', durationMs: step1Ms });

  // Step 2: Score & select activities (~0ms)
  console.log('[Pipeline V2] === Step 2: Scoring activities... ===');
  emit(onEvent, { type: 'step_start', step: 2, stepName: 'Scoring activities' });
  const T2 = Date.now();
  const selectedActivities = scoreAndSelectActivities(data, preferences);
  const mustSeeCount = selectedActivities.filter(a => a.mustSee).length;
  const totalRaw = data.googlePlacesAttractions.length + data.serpApiAttractions.length + data.overpassAttractions.length + data.viatorActivities.length;
  console.log(`[Pipeline V2] Step 2: ${selectedActivities.length} activities selected (${mustSeeCount} must-sees) from ${totalRaw} total`);
  console.log(`[Pipeline V2] Must-sees: ${selectedActivities.filter(a => a.mustSee).map(a => `"${a.name}" (${a.score.toFixed(1)})`).join(', ')}`);
  emit(onEvent, { type: 'step_done', step: 2, stepName: 'Scoring activities', durationMs: Date.now() - T2, detail: `${selectedActivities.length} selected (${mustSeeCount} must-sees) from ${totalRaw}` });

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
  emit(onEvent, { type: 'step_start', step: 3, stepName: 'Geographic clustering' });
  const T3 = Date.now();
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

  // Post-rebalance must-see guarantee: ensure no must-see was lost during rebalancing
  const clusterActivityIds = new Set(clusters.flatMap(c => c.activities.map(a => a.id)));
  const lostMustSees = selectedActivities.filter(a => a.mustSee && !clusterActivityIds.has(a.id));
  for (const mustSee of lostMustSees) {
    // Find cluster with most remaining capacity
    let bestTarget = -1;
    let bestRemaining = -Infinity;
    for (let ci = 0; ci < clusters.length; ci++) {
      const used = clusters[ci].activities.reduce((s, a) => s + (a.duration || 60), 0) + clusters[ci].activities.length * 20 + 180;
      // Estimate hours per day: ~8h for full days, less for first/last
      const isFirst = clusters[ci].dayNumber === 1;
      const isLast = clusters[ci].dayNumber === preferences.durationDays;
      const estHours = (isFirst || isLast) ? 5 : 8;
      const remaining = estHours * 60 - used;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestTarget = ci;
      }
    }

    if (bestTarget !== -1) {
      // If no room, evict the lowest-scored non-must-see
      if (bestRemaining < (mustSee.duration || 60) + 20) {
        const candidates = clusters[bestTarget].activities
          .filter(a => !a.mustSee)
          .sort((a, b) => a.score - b.score);
        if (candidates.length > 0) {
          const evictIdx = clusters[bestTarget].activities.findIndex(a => a.id === candidates[0].id);
          if (evictIdx !== -1) {
            const evicted = clusters[bestTarget].activities.splice(evictIdx, 1)[0];
            console.log(`[Pipeline V2] Must-see guarantee: evicted "${evicted.name}" to make room for "${mustSee.name}"`);
          }
        }
      }
      clusters[bestTarget].activities.push(mustSee);
      console.log(`[Pipeline V2] Must-see guarantee: injected "${mustSee.name}" into Day ${clusters[bestTarget].dayNumber}`);
    }
  }

  // Post-rebalance audit: detect dropped activities and recover them into sparse days
  const postRebalanceIds = new Set(clusters.flatMap(c => c.activities.map(a => a.id)));
  const droppedActivities = selectedActivities.filter(a => !a.mustSee && !postRebalanceIds.has(a.id));
  if (droppedActivities.length > 0) {
    console.warn(`[Pipeline V2] ⚠ ${droppedActivities.length} activities lost during rebalancing: ${droppedActivities.map(a => `"${a.name}"`).join(', ')}`);
    for (const dropped of droppedActivities) {
      let bestTarget = -1;
      let fewestActivities = Infinity;
      for (let ci = 0; ci < clusters.length; ci++) {
        const count = clusters[ci].activities.length;
        if (count < fewestActivities) {
          fewestActivities = count;
          bestTarget = ci;
        }
      }
      if (bestTarget !== -1 && fewestActivities < 3) {
        clusters[bestTarget].activities.push(dropped);
        console.log(`[Pipeline V2] Recovered dropped "${dropped.name}" → Day ${clusters[bestTarget].dayNumber} (had ${fewestActivities} activities)`);
      }
    }
  }

  console.log(`[Pipeline V2] Step 3: ${clusters.length} clusters created`);
  for (const c of clusters) {
    console.log(`[Pipeline V2]   Day ${c.dayNumber}: ${c.activities.map(a => a.name).join(', ')} (${c.totalIntraDistance.toFixed(1)}km intra)`);
  }
  emit(onEvent, { type: 'step_done', step: 3, stepName: 'Geographic clustering', durationMs: Date.now() - T3, detail: `${clusters.length} clusters` });

  // Step 5: Hotel selection (~0ms) — before restaurants, need hotel coords
  console.log('[Pipeline V2] === Step 5: Selecting hotel... ===');
  emit(onEvent, { type: 'step_start', step: 5, stepName: 'Hotel selection' });
  let hotel = selectHotelByBarycenter(
    clusters,
    data.bookingHotels,
    preferences.budgetLevel,
    data.budgetStrategy?.accommodationBudgetPerNight,
    preferences.durationDays,
    { destination: preferences.destination }
  );

  const hotelSupportsKitchen = accommodationHasKitchen(hotel);
  const budgetStrategySelfCateringRequested = budgetStrategyRequestsSelfCatering(data.budgetStrategy);
  const budgetStrategySanitization = sanitizeBudgetStrategyForKitchen(data.budgetStrategy, hotelSupportsKitchen);
  const budgetStrategyForMeals = (budgetStrategySanitization.strategy || data.budgetStrategy);
  if (budgetStrategySanitization.adjusted && hotel) {
    hotel = {
      ...hotel,
      qualityFlags: Array.from(new Set([...(hotel.qualityFlags || []), 'self_catering_disabled_no_kitchen'])),
    };
    console.log('[Pipeline V2] Self-catered meals disabled: selected accommodation has no kitchen');
  } else if (budgetStrategySelfCateringRequested && hotelSupportsKitchen) {
    console.log('[Pipeline V2] Self-catered meals enabled: accommodation kitchen detected');
  }

  const accommodationCoords = hotel
    ? { lat: hotel.latitude, lng: hotel.longitude }
    : data.destCoords;
  emit(onEvent, { type: 'step_done', step: 5, stepName: 'Hotel selection', durationMs: 0, detail: hotel ? `${hotel.name}` : 'No hotel found' });

  // Step 4: Restaurant assignment (~0ms)
  console.log('[Pipeline V2] === Step 4: Assigning restaurants... ===');
  emit(onEvent, { type: 'step_start', step: 4, stepName: 'Restaurant assignment' });
  const T4 = Date.now();
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

  const restaurantResult = assignRestaurants(
    clusters,
    data.tripAdvisorRestaurants,
    serpRestaurantsForAssignment,
    preferences,
    budgetStrategyForMeals,
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
      // Collect all restaurant IDs from first pass
      const firstPassUsedIds = new Set<string>();
      for (const m of meals) {
        if (m.restaurant?.id) firstPassUsedIds.add(m.restaurant.id);
        for (const alt of (m.restaurantAlternatives || [])) {
          if (alt.id) firstPassUsedIds.add(alt.id);
        }
      }
      const retryResult = assignRestaurants(
        clusters,
        data.tripAdvisorRestaurants,
        serpRestaurantsForAssignment,
        preferences,
        budgetStrategyForMeals,
        accommodationCoords,
        hotel,
        firstPassUsedIds
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
  emit(onEvent, { type: 'step_done', step: 4, stepName: 'Restaurant assignment', durationMs: Date.now() - T4, detail: `${assignedCount}/${meals.length} meals assigned` });

  // Step 4b: Balanced budget re-optimization (max 3 passes)
  // Priority order: transport -> accommodation -> meals.
  const budgetAdjusted = await rebalanceSelectionsForBalancedBudget({
    preferences,
    data,
    budgetStrategyForMeals,
    clusters,
    selectedActivities,
    bestTransport,
    hotel,
    meals,
    serpRestaurantsForAssignment,
  });
  bestTransport = budgetAdjusted.transport;
  hotel = budgetAdjusted.hotel;
  meals = budgetAdjusted.meals;
  restaurantGeoPool = budgetAdjusted.restaurantGeoPool;
  if (budgetAdjusted.notes.length > 0) {
    console.log(`[Pipeline V2] Budget balancing: ${budgetAdjusted.notes.join(' | ')}`);
  }

  // Step 6: LLM day balancing (~10-15s)
  const llmName = process.env.USE_GEMINI_BALANCE === 'true' ? 'Gemini Flash' : 'Claude AI';
  console.log(`[Pipeline V2] === Step 6: ${llmName} balancing... ===`);
  emit(onEvent, { type: 'step_start', step: 6, stepName: `${llmName} balancing` });
  emit(onEvent, { type: 'api_call', step: 6, label: llmName });
  const T6 = Date.now();
  const plan = await balanceDays(clusters, meals, hotel, bestTransport, preferences, data);
  const step6Ms = Date.now() - T6;
  console.log(`[Pipeline V2] Step 6 done in ${step6Ms}ms — "${plan.dayOrderReason}"`);
  emit(onEvent, { type: 'api_done', step: 6, label: llmName, durationMs: step6Ms });
  emit(onEvent, { type: 'step_done', step: 6, stepName: `${llmName} balancing`, durationMs: step6Ms, detail: plan.dayOrderReason });

  // Step 6b: Weather-aware day permutation (~0ms)
  // Swap outdoor-heavy days with indoor-heavy days when rain is forecast
  weatherPermuteClusters(clusters, data.weatherForecasts, preferences.durationDays, onEvent);

  // Step 7: Schedule assembly (~2-5s)
  console.log('[Pipeline V2] === Step 7: Assembling schedule... ===');
  emit(onEvent, { type: 'step_start', step: 7, stepName: 'Schedule assembly' });
  const T7 = Date.now();
  const trip = await assembleTripSchedule(
    plan, clusters, meals, hotel,
    { outbound: data.outboundFlight, return: data.returnFlight },
    bestTransport, preferences, data,
    restaurantGeoPool,
    onEvent
  );
  const step7Ms = Date.now() - T7;
  emit(onEvent, { type: 'step_done', step: 7, stepName: 'Schedule assembly', durationMs: step7Ms });

  // Step 8: Post-generation validation (~0ms)
  console.log('[Pipeline V2] === Step 8: Quality validation... ===');
  emit(onEvent, { type: 'step_start', step: 8, stepName: 'Quality validation' });
  const validationResult = validateAndFixTrip(trip);
  console.log(`[Pipeline V2] Step 8: Quality score ${validationResult.score}/100 (${validationResult.warnings.length} warnings, ${validationResult.autoFixes.length} auto-fixes)`);
  const serpApiUsageDelta = diffSerpApiUsage(serpApiUsageStart, getSerpApiUsageSnapshot());
  trip.apiUsage = { serpApi: serpApiUsageDelta };
  console.log(`[Pipeline V2] SerpAPI usage: ${serpApiUsageDelta.totalRequests} request(s) this generation`);
  emit(onEvent, { type: 'step_done', step: 8, stepName: 'Quality validation', durationMs: 0, detail: `Score ${validationResult.score}/100 (${validationResult.warnings.length} warnings)` });

  const totalTime = Date.now() - T0;
  console.log(`[Pipeline V2] ✅ Trip generated in ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
  console.log(`[Pipeline V2]   ${trip.days.length} days, ${trip.days.reduce((s, d) => s + d.items.length, 0)} items total`);
  emit(onEvent, { type: 'info', detail: `Trip generated in ${(totalTime / 1000).toFixed(1)}s — ${trip.days.length} days, ${trip.days.reduce((s, d) => s + d.items.length, 0)} items` });

  // Final must-see audit: check which must-sees made it into the schedule
  const poolMustSees = (trip.attractionPool || []).filter(a => a.mustSee);
  const scheduledActivityIds = new Set(trip.days.flatMap(d => d.items.filter(i => i.type === 'activity').map(i => i.id)));
  const scheduledActivityList = trip.days.flatMap(d =>
    d.items.filter((i: any) => i.type === 'activity').map((i: any) => ({
      id: i.id, name: i.title || '', latitude: i.latitude || 0, longitude: i.longitude || 0,
    }))
  );
  const missingMustSees = poolMustSees.filter(a => {
    if (scheduledActivityIds.has(a.id)) return false;
    // Also check name-similarity dedup: e.g. "La Cène" (osm) vs "La Cène de Léonard de Vinci" (mustsee)
    const candidate = { id: a.id, name: a.name || '', latitude: a.latitude || 0, longitude: a.longitude || 0 };
    const isSimilarToScheduled = scheduledActivityList.some(existing =>
      isDuplicateActivityCandidate(candidate, existing)
    );
    if (isSimilarToScheduled) return false;
    return true;
  });

  if (missingMustSees.length > 0) {
    console.warn(`[Pipeline V2] ⚠️ MUST-SEES MISSING FROM SCHEDULE: ${missingMustSees.map(a => `"${a.name}"`).join(', ')}`);

    // Helper functions for must-see recovery
    const msTimeToMin = (t: string): number => {
      const [h, m] = t.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const msMinToHHMM = (min: number): string => {
      const clamped = Math.max(0, Math.min(1439, min));
      const h = Math.floor(clamped / 60);
      const m = Math.round(clamped % 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    for (const missing of missingMustSees) {
      // Find the day with most non-must-see activities (most room to evict)
      let bestDayIdx = -1;
      let bestEvictableCount = 0;
      for (let di = 0; di < trip.days.length; di++) {
        const dayActivities = trip.days[di].items.filter(
          (i: any) => i.type === 'activity' && !i.mustSee
        );
        if (dayActivities.length > bestEvictableCount) {
          bestEvictableCount = dayActivities.length;
          bestDayIdx = di;
        }
      }

      if (bestDayIdx >= 0 && bestEvictableCount > 0) {
        const targetDay = trip.days[bestDayIdx];
        // Find lowest-rated non-must-see activity to evict
        const evictCandidates = targetDay.items
          .filter((i: any) => i.type === 'activity' && !i.mustSee)
          .sort((a: any, b: any) => (a.rating || 0) - (b.rating || 0));

        if (evictCandidates.length > 0) {
          const evicted = evictCandidates[0];
          const evictIdx = targetDay.items.findIndex((i: any) => i.id === evicted.id);
          if (evictIdx >= 0) {
            const startMinutes = msTimeToMin(evicted.startTime);
            const requestedDuration = missing.duration || 90;

            targetDay.items.splice(evictIdx, 1);
            console.warn(
              `[Pipeline V2] Must-see recovery: evicted "${evicted.title}" from Day ${targetDay.dayNumber}`
            );

            // Calculate the real available gap after eviction to prevent overlaps
            const sortedAfterEvict = [...targetDay.items].sort(
              (a: any, b: any) => (a.startTime || '').localeCompare(b.startTime || '')
            );
            const nextItem = sortedAfterEvict.find(
              (i: any) => msTimeToMin(i.startTime) > startMinutes
            );
            const prevItem = [...sortedAfterEvict].reverse().find(
              (i: any) => msTimeToMin(i.endTime || i.startTime) <= startMinutes
            );

            // Constrain to available gap: [prevEnd..nextStart]
            const gapStart = prevItem ? Math.max(startMinutes, msTimeToMin(prevItem.endTime)) : startMinutes;
            const gapEnd = nextItem ? msTimeToMin(nextItem.startTime) : 23 * 60;
            const availableMinutes = gapEnd - gapStart - 15; // 15min buffer before next item
            const duration = Math.min(requestedDuration, Math.max(45, availableMinutes));

            if (duration >= 45) {
              targetDay.items.push({
                id: missing.id,
                dayNumber: targetDay.dayNumber,
                type: 'activity' as const,
                title: missing.name,
                description: missing.description || missing.name,
                locationName: missing.name,
                latitude: missing.latitude || 0,
                longitude: missing.longitude || 0,
                startTime: msMinToHHMM(gapStart),
                endTime: msMinToHHMM(gapStart + duration),
                duration,
                orderIndex: targetDay.items.length,
                estimatedCost: missing.estimatedCost || 0,
                mustSee: true,
                rating: missing.rating,
                reviewCount: missing.reviewCount,
                dataReliability: 'verified' as const,
              } as any);

              // Re-sort and re-index
              targetDay.items.sort((a: any, b: any) => (a.startTime || '').localeCompare(b.startTime || ''));
              targetDay.items.forEach((item: any, idx: number) => { item.orderIndex = idx; });

              console.warn(
                `[Pipeline V2] Must-see recovery: injected "${missing.name}" into Day ${targetDay.dayNumber} at ${msMinToHHMM(gapStart)} (${duration}min, gap=${availableMinutes + 15}min)`
              );
            } else {
              console.warn(
                `[Pipeline V2] Must-see recovery: gap too small (${availableMinutes + 15}min) for "${missing.name}" on Day ${targetDay.dayNumber} — skipping`
              );
            }
          }
        }
      }
    }

    // Final cross-day dedup safety net after must-see recovery
    const globalDedup: Array<{ id: string; name: string; latitude: number; longitude: number }> = [];
    for (const day of trip.days) {
      const before = day.items.length;
      day.items = day.items.filter((item: any) => {
        if (item.type !== 'activity') return true;
        const candidate = { id: item.id, name: item.title || '', latitude: item.latitude || 0, longitude: item.longitude || 0 };
        const isDup = globalDedup.some(existing => isDuplicateActivityCandidate(candidate, existing));
        if (isDup) {
          console.log(`[Pipeline V2] Final safety dedup: removed "${item.title}" from Day ${day.dayNumber}`);
          return false;
        }
        globalDedup.push(candidate);
        return true;
      });
      if (day.items.length < before) {
        day.items.forEach((item: any, idx: number) => { item.orderIndex = idx; });
      }
    }

    // Log final state for diagnosis
    for (const day of trip.days) {
      const activities = day.items.filter((i: any) => i.type === 'activity');
      console.log(`[Pipeline V2]   Day ${day.dayNumber}: ${activities.map((i: any) => i.title).join(', ') || '(no activities)'}`);
    }
  } else {
    console.log(`[Pipeline V2] ✅ All ${poolMustSees.length} must-sees are in the schedule`);
  }

  return trip;
}

// ---------------------------------------------------------------------------
// Weather-aware day permutation
// ---------------------------------------------------------------------------
// WMO weather codes ≥ 51 = rain/drizzle/snow/storms (bad for outdoor)
const RAINY_WMO_THRESHOLD = 51;

/**
 * Swap outdoor-heavy clusters to dry days and indoor-heavy clusters to rainy days.
 * Only swaps "full" days (not first/last which have transport constraints).
 * Mutates `clusters` in place by swapping their `dayNumber` assignments.
 */
function weatherPermuteClusters(
  clusters: ActivityCluster[],
  weatherForecasts: FetchedData['weatherForecasts'],
  durationDays: number,
  onEvent?: OnPipelineEvent
): void {
  if (!weatherForecasts || weatherForecasts.length === 0 || clusters.length < 3) {
    return; // Need weather data and at least 3 days to have swappable middle days
  }

  // Build weather map: dayNumber → weatherCode
  // weatherForecasts[0] = day 1, etc.
  const weatherByDay = new Map<number, number>();
  for (let i = 0; i < weatherForecasts.length; i++) {
    const wf = weatherForecasts[i];
    const code = wf.weatherCode ?? 0;
    weatherByDay.set(i + 1, code);
  }

  // Compute outdoor ratio per cluster
  type DayInfo = {
    cluster: ActivityCluster;
    outdoorRatio: number;
    isRainy: boolean;
    dayNumber: number;
    isSwappable: boolean; // false for first/last day
  };

  const dayInfos: DayInfo[] = clusters.map(c => {
    const total = c.activities.length;
    if (total === 0) return { cluster: c, outdoorRatio: 0.5, isRainy: false, dayNumber: c.dayNumber, isSwappable: false };
    const outdoorCount = c.activities.filter(a => a.isOutdoor === true).length;
    const outdoorRatio = outdoorCount / total;
    const wCode = weatherByDay.get(c.dayNumber) ?? 0;
    const isRainy = wCode >= RAINY_WMO_THRESHOLD;
    const isSwappable = c.dayNumber > 1 && c.dayNumber < durationDays; // Skip first/last
    return { cluster: c, outdoorRatio, isRainy, dayNumber: c.dayNumber, isSwappable };
  });

  // Find problematic pairs: rainy+outdoor day ↔ dry+indoor day
  let swapCount = 0;
  const swapped = new Set<number>(); // dayNumbers already swapped

  for (const rainyDay of dayInfos) {
    if (!rainyDay.isRainy || !rainyDay.isSwappable || swapped.has(rainyDay.dayNumber)) continue;
    if (rainyDay.outdoorRatio < 0.5) continue; // Already mostly indoor, no need to swap

    // Find a dry day with more indoor activities to swap with
    let bestSwap: DayInfo | null = null;
    let bestScore = 0;

    for (const dryDay of dayInfos) {
      if (dryDay.isRainy || !dryDay.isSwappable || swapped.has(dryDay.dayNumber)) continue;
      if (dryDay.dayNumber === rainyDay.dayNumber) continue;
      if (dryDay.outdoorRatio >= rainyDay.outdoorRatio) continue; // Not helpful

      // Score = how much improvement we get: rainyDay.outdoor - dryDay.outdoor
      const improvement = rainyDay.outdoorRatio - dryDay.outdoorRatio;
      if (improvement > bestScore) {
        bestScore = improvement;
        bestSwap = dryDay;
      }
    }

    if (bestSwap && bestScore >= 0.2) {
      // Swap dayNumbers between clusters
      const tempDay = rainyDay.cluster.dayNumber;
      rainyDay.cluster.dayNumber = bestSwap.cluster.dayNumber;
      bestSwap.cluster.dayNumber = tempDay;

      swapped.add(rainyDay.dayNumber);
      swapped.add(bestSwap.dayNumber);
      swapCount++;

      console.log(
        `[Pipeline V2] Weather swap: Day ${tempDay} (${(rainyDay.outdoorRatio * 100).toFixed(0)}% outdoor, rainy) ↔ Day ${bestSwap.dayNumber} (${(bestSwap.outdoorRatio * 100).toFixed(0)}% outdoor, dry)`
      );
    }
  }

  if (swapCount > 0) {
    emit(onEvent, {
      type: 'info',
      detail: `Weather permutation: ${swapCount} day swap(s) — outdoor activities moved to dry days`,
    });
  } else {
    console.log('[Pipeline V2] Weather permutation: no swaps needed');
  }
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

type BudgetRebalanceResult = {
  transport: TransportOptionSummary | null;
  hotel: ReturnType<typeof selectHotelByBarycenter>;
  meals: MealAssignment[];
  restaurantGeoPool: Restaurant[];
  notes: string[];
};

function estimateMealCost(meal: MealAssignment): number {
  if (meal.restaurant) {
    const level = meal.restaurant.priceLevel || 2;
    return level * 15;
  }
  if (meal.fallbackMode === 'self_catered') {
    if (meal.mealType === 'dinner') return 10;
    if (meal.mealType === 'lunch') return 8;
    return 6;
  }
  return 0;
}

function estimateProjectedTotalCost(args: {
  transport: TransportOptionSummary | null;
  hotel: ReturnType<typeof selectHotelByBarycenter>;
  selectedActivities: ScoredActivity[];
  meals: MealAssignment[];
  durationDays: number;
}): number {
  const roundTripTransport = args.transport ? (args.transport.totalPrice || 0) * 2 : 0;
  const nights = Math.max(1, args.durationDays - 1);
  const hotelCost = args.hotel
    ? (args.hotel.totalPrice || (args.hotel.pricePerNight || 0) * nights)
    : 0;
  const activitiesCost = args.selectedActivities.reduce((sum, activity) => sum + Math.max(0, activity.estimatedCost || 0), 0);
  const mealsCost = args.meals.reduce((sum, meal) => sum + estimateMealCost(meal), 0);

  return roundTripTransport + hotelCost + activitiesCost + mealsCost;
}

function pickCheaperTransportOption(
  current: TransportOptionSummary | null,
  options: TransportOptionSummary[]
): TransportOptionSummary | null {
  if (!options.length) return current;
  const sortedByPrice = [...options].sort((a, b) => (a.totalPrice || Infinity) - (b.totalPrice || Infinity));
  if (!current) return sortedByPrice[0] || null;

  const durationLimit = Math.max((current.totalDuration || 0) * 1.5, current.totalDuration + 120);
  const cheaperCandidate = sortedByPrice.find((option) =>
    option.totalPrice < current.totalPrice
    && option.totalDuration <= durationLimit
  );
  return cheaperCandidate || current;
}

function selectCheaperMealAlternatives(meals: MealAssignment[]): { meals: MealAssignment[]; changed: number } {
  let changed = 0;
  const updated = meals.map((meal) => {
    if (!meal.restaurant || !meal.restaurantAlternatives?.length) return meal;
    const currentPriceLevel = meal.restaurant.priceLevel || 2;
    const sortedAlternatives = [...meal.restaurantAlternatives]
      .filter((alt) => !!alt)
      .sort((a, b) => (a.priceLevel || 4) - (b.priceLevel || 4));
    const cheaper = sortedAlternatives.find((alt) => (alt.priceLevel || 4) < currentPriceLevel);
    if (!cheaper) return meal;
    changed += 1;
    return {
      ...meal,
      restaurant: cheaper,
      restaurantAlternatives: [meal.restaurant, ...sortedAlternatives.filter((alt) => alt.id !== cheaper.id)].slice(0, 3),
    };
  });
  return { meals: updated, changed };
}

export function selectSelfCateredMealsForBudget(
  meals: MealAssignment[],
  requiredReduction: number
): { meals: MealAssignment[]; changed: number; estimatedSavings: number } {
  if (!Number.isFinite(requiredReduction) || requiredReduction <= 0) {
    return { meals, changed: 0, estimatedSavings: 0 };
  }

  const candidates = meals
    .map((meal, index) => {
      if (!meal.restaurant) return null;
      const currentCost = estimateMealCost(meal);
      const selfCateredCost = estimateMealCost({ ...meal, restaurant: null, fallbackMode: 'self_catered' });
      const savings = Math.max(0, currentCost - selfCateredCost);
      if (savings <= 0) return null;
      // Favor expensive lunch/dinner first.
      const priority = meal.mealType === 'dinner' ? 2 : meal.mealType === 'lunch' ? 1 : 0;
      return { index, meal, savings, priority };
    })
    .filter((value): value is { index: number; meal: MealAssignment; savings: number; priority: number } => !!value)
    .sort((a, b) => {
      if (b.savings !== a.savings) return b.savings - a.savings;
      return b.priority - a.priority;
    });

  if (candidates.length === 0) {
    return { meals, changed: 0, estimatedSavings: 0 };
  }

  let changed = 0;
  let estimatedSavings = 0;
  const nextMeals = [...meals];
  for (const candidate of candidates) {
    if (estimatedSavings >= requiredReduction) break;
    const alternatives = [
      candidate.meal.restaurant!,
      ...(candidate.meal.restaurantAlternatives || []),
    ].filter(Boolean);
    nextMeals[candidate.index] = {
      ...candidate.meal,
      restaurant: null,
      fallbackMode: 'self_catered',
      restaurantAlternatives: alternatives.slice(0, 3),
    };
    changed += 1;
    estimatedSavings += candidate.savings;
  }

  return { meals: nextMeals, changed, estimatedSavings };
}

function pickAggressiveBudgetHotelFallback(
  currentHotel: ReturnType<typeof selectHotelByBarycenter>,
  candidates: ReturnType<typeof selectHotelByBarycenter>[]
): ReturnType<typeof selectHotelByBarycenter> {
  if (!currentHotel || !Array.isArray(candidates) || candidates.length === 0) return currentHotel;
  const currentPrice = currentHotel.pricePerNight || Number.POSITIVE_INFINITY;
  const cheaper = candidates
    .filter((hotel): hotel is NonNullable<typeof hotel> => !!hotel && (hotel.pricePerNight || 0) > 0 && hotel.id !== currentHotel.id)
    .sort((a, b) => (a.pricePerNight || Number.POSITIVE_INFINITY) - (b.pricePerNight || Number.POSITIVE_INFINITY))
    .find((hotel) => (hotel.pricePerNight || Number.POSITIVE_INFINITY) < currentPrice);
  if (!cheaper) return currentHotel;

  return {
    ...cheaper,
    qualityFlags: Array.from(new Set([...(cheaper.qualityFlags || []), 'budget_fallback_hotel_suggestion'])),
  };
}

async function rebalanceSelectionsForBalancedBudget(args: {
  preferences: TripPreferences;
  data: FetchedData;
  budgetStrategyForMeals: FetchedData['budgetStrategy'];
  clusters: ActivityCluster[];
  selectedActivities: ScoredActivity[];
  bestTransport: TransportOptionSummary | null;
  hotel: ReturnType<typeof selectHotelByBarycenter>;
  meals: MealAssignment[];
  serpRestaurantsForAssignment: Restaurant[];
}): Promise<BudgetRebalanceResult> {
  const notes: string[] = [];
  const totalBudget = args.data.resolvedBudget?.totalBudget || 0;
  if (totalBudget <= 0) {
    return {
      transport: args.bestTransport,
      hotel: args.hotel,
      meals: args.meals,
      restaurantGeoPool: deduplicateRestaurantsByNameAndCoords(args.serpRestaurantsForAssignment),
      notes,
    };
  }

  const toleranceCap = totalBudget * 1.12;
  let currentTransport = args.bestTransport;
  let currentHotel = args.hotel;
  let currentMeals = args.meals;
  let currentRestaurantPool = deduplicateRestaurantsByNameAndCoords(args.serpRestaurantsForAssignment);

  let kitchenAvailable = accommodationHasKitchen(currentHotel);
  const initialSelfCateredCleanup = stripSelfCateredFallbacks(currentMeals, kitchenAvailable);
  if (initialSelfCateredCleanup.changed > 0) {
    currentMeals = initialSelfCateredCleanup.meals;
    notes.push(`self-catered removed x${initialSelfCateredCleanup.changed} (no kitchen)`);
  }

  for (let pass = 0; pass < 3; pass++) {
    const projected = estimateProjectedTotalCost({
      transport: currentTransport,
      hotel: currentHotel,
      selectedActivities: args.selectedActivities,
      meals: currentMeals,
      durationDays: args.preferences.durationDays,
    });
    if (projected <= toleranceCap) break;

    if (pass === 0) {
      const cheaperTransport = pickCheaperTransportOption(currentTransport, args.data.transportOptions || []);
      if (cheaperTransport && (!currentTransport || cheaperTransport.id !== currentTransport.id)) {
        notes.push(`transport ${(currentTransport?.mode || 'none')}->${cheaperTransport.mode}`);
        currentTransport = cheaperTransport;
      }
      continue;
    }

    if (pass === 1) {
      const currentHotelPrice = currentHotel?.pricePerNight || (args.data.budgetStrategy?.accommodationBudgetPerNight || 0);
      const hotelBudgetTarget = currentHotelPrice > 0
        ? currentHotelPrice * 0.9
        : args.data.budgetStrategy?.accommodationBudgetPerNight;
      const cheaperHotel = selectHotelByBarycenter(
        args.clusters,
        args.data.bookingHotels,
        args.preferences.budgetLevel,
        hotelBudgetTarget,
        args.preferences.durationDays,
        { destination: args.preferences.destination }
      );
      if (cheaperHotel && currentHotel && cheaperHotel.id !== currentHotel.id && cheaperHotel.pricePerNight < currentHotel.pricePerNight) {
        currentHotel = cheaperHotel;
        notes.push(`hotel ${currentHotel.name}`);
        kitchenAvailable = accommodationHasKitchen(currentHotel);

        const accommodationCoords = { lat: currentHotel.latitude, lng: currentHotel.longitude };
        const reassigned = assignRestaurants(
          args.clusters,
          args.data.tripAdvisorRestaurants,
          currentRestaurantPool,
          args.preferences,
          args.budgetStrategyForMeals,
          accommodationCoords,
          currentHotel
        );
        currentMeals = reassigned.meals;
        currentRestaurantPool = reassigned.restaurantGeoPool;

        const sanitizedMeals = stripSelfCateredFallbacks(currentMeals, kitchenAvailable);
        if (sanitizedMeals.changed > 0) {
          currentMeals = sanitizedMeals.meals;
          notes.push(`self-catered removed x${sanitizedMeals.changed} (no kitchen)`);
        }
      }
      continue;
    }

    const mealRebalance = selectCheaperMealAlternatives(currentMeals);
    if (mealRebalance.changed > 0) {
      currentMeals = mealRebalance.meals;
      notes.push(`meals downgraded x${mealRebalance.changed}`);
    }
  }

  let projected = estimateProjectedTotalCost({
    transport: currentTransport,
    hotel: currentHotel,
    selectedActivities: args.selectedActivities,
    meals: currentMeals,
    durationDays: args.preferences.durationDays,
  });

  if (projected > toleranceCap) {
    if (kitchenAvailable) {
      const selfCatered = selectSelfCateredMealsForBudget(currentMeals, projected - toleranceCap);
      if (selfCatered.changed > 0) {
        currentMeals = selfCatered.meals;
        notes.push(`self-catered meal suggestions x${selfCatered.changed}`);
        projected = estimateProjectedTotalCost({
          transport: currentTransport,
          hotel: currentHotel,
          selectedActivities: args.selectedActivities,
          meals: currentMeals,
          durationDays: args.preferences.durationDays,
        });
      }
    } else {
      notes.push('self-catered skipped (no kitchen)');
    }
  }

  if (projected > toleranceCap) {
    const fallbackHotel = pickAggressiveBudgetHotelFallback(currentHotel, args.data.bookingHotels || []);
    if (fallbackHotel && currentHotel && fallbackHotel.id !== currentHotel.id) {
      currentHotel = fallbackHotel;
      notes.push(`hotel budget fallback ${fallbackHotel.name}`);
      kitchenAvailable = accommodationHasKitchen(currentHotel);

      const accommodationCoords = { lat: currentHotel.latitude, lng: currentHotel.longitude };
      const reassigned = assignRestaurants(
        args.clusters,
        args.data.tripAdvisorRestaurants,
        currentRestaurantPool,
        args.preferences,
        args.budgetStrategyForMeals,
        accommodationCoords,
        currentHotel
      );
      currentMeals = reassigned.meals;
      currentRestaurantPool = reassigned.restaurantGeoPool;

      const sanitizedMeals = stripSelfCateredFallbacks(currentMeals, kitchenAvailable);
      if (sanitizedMeals.changed > 0) {
        currentMeals = sanitizedMeals.meals;
        notes.push(`self-catered removed x${sanitizedMeals.changed} (no kitchen)`);
      }

      const postHotelProjected = estimateProjectedTotalCost({
        transport: currentTransport,
        hotel: currentHotel,
        selectedActivities: args.selectedActivities,
        meals: currentMeals,
        durationDays: args.preferences.durationDays,
      });
      if (postHotelProjected > toleranceCap) {
        if (kitchenAvailable) {
          const selfCatered = selectSelfCateredMealsForBudget(currentMeals, postHotelProjected - toleranceCap);
          if (selfCatered.changed > 0) {
            currentMeals = selfCatered.meals;
            notes.push(`self-catered meal suggestions x${selfCatered.changed} (post-hotel)`);
          }
        } else {
          notes.push('self-catered skipped (post-hotel, no kitchen)');
        }
      }
    }
  }

  return {
    transport: currentTransport,
    hotel: currentHotel,
    meals: currentMeals,
    restaurantGeoPool: currentRestaurantPool,
    notes,
  };
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
  const PIPELINE_GEO_STRICT = !['0', 'false', 'off'].includes(
    String(process.env.PIPELINE_GEO_STRICT || 'true').toLowerCase()
  );

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

  const getAirportPreDepartureLeadMinutes = (flight: Flight): number => {
    const airportText = `${flight.departureAirport || ''} ${flight.departureAirportCode || ''}`.toLowerCase();
    const needsExtraMargin = /international|intl|orly|charles|gaulle|fiumicino|heathrow|gatwick|schiphol|barajas|frankfurt/.test(airportText);
    return needsExtraMargin ? 120 : 90;
  };

  const getLocalTimeMinutes = (displayTime?: string, isoTime?: string): number => {
    if (displayTime && /^([01]?\d|2[0-3]):([0-5]\d)$/.test(displayTime)) {
      const [h, m] = displayTime.split(':').map(Number);
      return h * 60 + m;
    }
    if (isoTime) {
      const d = new Date(isoTime);
      if (Number.isFinite(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    return 0;
  };

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
      const arrMin = outboundFlight.arrivalTimeDisplay
        ? parseInt(outboundFlight.arrivalTimeDisplay.split(':')[1] || '0', 10) / 60
        : new Date(outboundFlight.arrivalTime).getMinutes() / 60;
      // Realistic start: arrHour + 1h transfer
      // For early arrivals (before 16:00), travelers can do activities before check-in
      // (e.g., drop bags at hotel, explore nearby, then check-in later)
      const transferEnd = arrHour + arrMin + 1.5; // 1.5h for airport transfer + settling
      // Only apply check-in floor if arrival is very early (before 11:00)
      // Otherwise, use actual arrival time to allow afternoon activities
      const effectiveStart = transferEnd < 11 ? 13 : transferEnd;
      available = Math.max(0, 22 - effectiveStart);
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
      const depMinutes = getLocalTimeMinutes(returnFlight.departureTimeDisplay, returnFlight.departureTime);
      const airportLeadMinutes = getAirportPreDepartureLeadMinutes(returnFlight);
      available = Math.max(0, ((depMinutes - airportLeadMinutes) / 60) - 8);
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
  const dayGeoSpreadCapKm = hoursPerDay.map((h) => (h <= 6 ? 6.5 : h <= 8 ? 8.5 : 11));

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

  const routeCostKm = (activities: ScoredActivity[]): number => {
    if (activities.length <= 1) return 0;
    let total = 0;
    for (let i = 0; i < activities.length - 1; i++) {
      total += calculateDistance(
        activities[i].latitude,
        activities[i].longitude,
        activities[i + 1].latitude,
        activities[i + 1].longitude
      );
    }
    return total;
  };

  const maxRadiusKm = (activities: ScoredActivity[]): number => {
    if (activities.length <= 1) return 0;
    const centroid = {
      lat: activities.reduce((sum, act) => sum + act.latitude, 0) / activities.length,
      lng: activities.reduce((sum, act) => sum + act.longitude, 0) / activities.length,
    };
    return activities.reduce((max, act) => {
      const dist = calculateDistance(act.latitude, act.longitude, centroid.lat, centroid.lng);
      return Math.max(max, dist);
    }, 0);
  };

  const moveDegradesRouteCost = (sourceIdx: number, targetIdx: number, activity: ScoredActivity): boolean => {
    const sourceBefore = clusters[sourceIdx].activities;
    const targetBefore = clusters[targetIdx].activities;
    const sourceAfter = sourceBefore.filter((a) => a.id !== activity.id);
    const targetAfter = [...targetBefore, activity];

    const beforeCost = routeCostKm(sourceBefore) + routeCostKm(targetBefore);
    const afterCost = routeCostKm(sourceAfter) + routeCostKm(targetAfter);

    return afterCost > beforeCost + 0.25;
  };

  const moveExceedsGeoCap = (targetIdx: number, activity: ScoredActivity): boolean => {
    const projected = [...clusters[targetIdx].activities, activity];
    return maxRadiusKm(projected) > dayGeoSpreadCapKm[targetIdx];
  };

  const combinedRouteCostDeltaKm = (sourceIdx: number, targetIdx: number, activity: ScoredActivity): number => {
    const sourceBefore = clusters[sourceIdx].activities;
    const targetBefore = clusters[targetIdx].activities;
    const sourceAfter = sourceBefore.filter((a) => a.id !== activity.id);
    const targetAfter = [...targetBefore, activity];
    const beforeCost = routeCostKm(sourceBefore) + routeCostKm(targetBefore);
    const afterCost = routeCostKm(sourceAfter) + routeCostKm(targetAfter);
    return afterCost - beforeCost;
  };

  const dayTemporalOverloadMinutes = (idx: number): number => {
    const availableMin = Math.max(0, hoursPerDay[idx] * 60);
    const usedMin = dayUsedMinutes(idx);
    return Math.max(0, usedMin - availableMin);
  };

  const canMoveBetweenDaysGeoSafe = (
    sourceIdx: number,
    targetIdx: number,
    activity: ScoredActivity
  ): boolean => {
    if (sourceIdx === targetIdx) return false;
    if (!clusters[sourceIdx] || !clusters[targetIdx]) return false;
    if (!clusters[sourceIdx].activities.some((a) => a.id === activity.id)) return false;
    if (!activity.latitude || !activity.longitude) return true;

    const sourceCentroid = clusters[sourceIdx].centroid;
    const targetCentroid = clusters[targetIdx].centroid;
    const sourceDist = calculateDistance(activity.latitude, activity.longitude, sourceCentroid.lat, sourceCentroid.lng);
    const targetDist = calculateDistance(activity.latitude, activity.longitude, targetCentroid.lat, targetCentroid.lng);
    const routeDeltaKm = combinedRouteCostDeltaKm(sourceIdx, targetIdx, activity);

    if (!activity.mustSee) {
      // Relax constraints when the SOURCE day is overloaded AND the target is nearly empty,
      // but never separate activities that are geographically close neighbors in the source cluster.
      const sourceOverloadMin = dayTemporalOverloadMinutes(sourceIdx);
      const targetIsNearlySparse = clusters[targetIdx].activities.length <= 1;
      const sourceIsOverloaded = sourceOverloadMin >= 30;

      if (targetIsNearlySparse && sourceIsOverloaded) {
        // Before allowing a relaxed move, check that the activity is NOT tightly coupled
        // geographically to another activity in the source cluster (< 400m apart).
        // This prevents splitting e.g. Tour Eiffel and Champs de Mars across different days.
        const hasCloseNeighborInSource = clusters[sourceIdx].activities.some(
          (a) =>
            a.id !== activity.id
            && a.latitude && a.longitude
            && calculateDistance(activity.latitude!, activity.longitude!, a.latitude, a.longitude) < 0.4
        );
        if (hasCloseNeighborInSource) {
          // Fall through to default strict constraints — don't separate geo-coupled POIs
          if (routeDeltaKm > 0.25) return false;
          if (moveExceedsGeoCap(targetIdx, activity)) return false;
          if (targetDist >= sourceDist - 0.01) return false;
          return true;
        }
        // Relaxed move: allow up to 1.0 km route delta for isolated activities
        if (routeDeltaKm > 1.0) return false;
        if (moveExceedsGeoCap(targetIdx, activity)) return false;
        return true;
      }

      // Second tier: target is critically sparse (< 3 activities) and source has surplus (> 4)
      const targetIsCriticallySparse = clusters[targetIdx].activities.length < 3;
      const sourceHasSurplus = clusters[sourceIdx].activities.length > 4;

      if (targetIsCriticallySparse && sourceHasSurplus) {
        // Protect geo-coupled POIs (< 400m apart) — keep strict for those
        const hasCloseNeighborInSource = clusters[sourceIdx].activities.some(
          (a) =>
            a.id !== activity.id
            && a.latitude && a.longitude
            && calculateDistance(activity.latitude!, activity.longitude!, a.latitude, a.longitude) < 0.4
        );
        if (hasCloseNeighborInSource) {
          if (routeDeltaKm > 0.25) return false;
          if (moveExceedsGeoCap(targetIdx, activity)) return false;
          if (targetDist >= sourceDist - 0.01) return false;
          return true;
        }
        // Moderately relaxed: 0.6km route delta (between strict 0.25 and full relax 1.0)
        if (routeDeltaKm > 0.6) return false;
        if (moveExceedsGeoCap(targetIdx, activity)) return false;
        return true;
      }

      // Default strict constraints
      if (routeDeltaKm > 0.25) return false;
      if (moveExceedsGeoCap(targetIdx, activity)) return false;
      if (targetDist >= sourceDist - 0.01) return false;
      return true;
    }

    // Must-see moves are allowed only for real source overload,
    // with bounded geographic degradation.
    if (dayTemporalOverloadMinutes(sourceIdx) < 30) return false;
    if (routeDeltaKm > 0.9) return false;
    if (moveExceedsGeoCap(targetIdx, activity)) return false;

    const extremeJumpKm = Math.max(6.5, sourceDist + 2.5);
    if (targetDist > extremeJumpKm) return false;
    return true;
  };

  for (const cluster of clusters) {
    computeClusterGeo(cluster);
  }

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
      computeClusterGeo(cluster);
      computeClusterGeo(clusters[bestTarget]);
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
        if (remaining > bestRemainingMin && remaining >= (toMove.duration || 60) + 20 && canMoveBetweenDaysGeoSafe(ci, ti, toMove)) {
          bestRemainingMin = remaining;
          bestTarget = ti;
        }
      }

      if (bestTarget === -1) break; // No day can fit this activity

      const [moved] = cluster.activities.splice(moveIdx, 1);
      clusters[bestTarget].activities.push(moved);
      computeClusterGeo(cluster);
      computeClusterGeo(clusters[bestTarget]);
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
        if (remaining > bestRemaining && remaining >= (mustSee.duration || 60) + 20 && canMoveBetweenDaysGeoSafe(ci, ti, mustSee)) {
          bestRemaining = remaining;
          bestTarget = ti;
        }
      }

      if (bestTarget === -1) continue; // No day can fit this must-see

      const idx = cluster.activities.findIndex(a => a.id === mustSee.id);
      if (idx !== -1) {
        const [moved] = cluster.activities.splice(idx, 1);
        clusters[bestTarget].activities.push(moved);
        computeClusterGeo(cluster);
        computeClusterGeo(clusters[bestTarget]);
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

      if (!a.isOutdoor) continue;

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
        if (
          remaining >= (a.duration || 60) + 20
          && startHourPerDay[ti] < bestStartHour
          && canMoveBetweenDaysGeoSafe(ci, ti, a)
        ) {
          bestStartHour = startHourPerDay[ti];
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1) {
        const [moved] = cluster.activities.splice(ai, 1);
        clusters[bestTarget].activities.push(moved);
        computeClusterGeo(cluster);
        computeClusterGeo(clusters[bestTarget]);
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
            if (!canMoveBetweenDaysGeoSafe(ti, ci, a)) continue;
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
          computeClusterGeo(clusters[bestSource]);
          computeClusterGeo(clusters[ci]);
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
        if (!canMoveBetweenDaysGeoSafe(bestSource, ci, source.activities[ai])) continue;
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
      computeClusterGeo(source);
      computeClusterGeo(clusters[ci]);
    }
  }

  // Phase 3b: Ensure no full day has fewer than 3 activities (sparse day rescue at cluster level).
  // Unlike Phase 3 which only targets 0-activity days, this fills days with 1-2 activities.
  // Boundary days with limited time (< 6h) are exempted.
  for (let ci = 0; ci < clusters.length; ci++) {
    if (isDayTrip[ci]) continue;
    if (clusters[ci].activities.length >= 3) continue;
    if (maxPerDay[ci] === 0) continue;

    // Skip boundary days with limited time
    if (hoursPerDay[ci] < 6) continue;

    const deficit = 3 - clusters[ci].activities.length;

    for (let s = 0; s < deficit; s++) {
      // Find best donor: largest cluster with non-must-see activities to spare
      let bestSource = -1;
      let bestSourceSize = 0;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || isDayTrip[ti]) continue;
        const nonMustSees = clusters[ti].activities.filter(a => !a.mustSee).length;
        if (nonMustSees >= 1 && clusters[ti].activities.length > 3 && clusters[ti].activities.length > bestSourceSize) {
          bestSourceSize = clusters[ti].activities.length;
          bestSource = ti;
        }
      }

      if (bestSource === -1) break;

      // Pick the best-fitting non-must-see from donor using geo-safety check
      const source = clusters[bestSource];
      let bestIdx = -1;
      let bestFitScore = -Infinity;

      for (let ai = 0; ai < source.activities.length; ai++) {
        if (source.activities[ai].mustSee) continue;
        if (!canMoveBetweenDaysGeoSafe(bestSource, ci, source.activities[ai])) continue;

        // Prefer activities closer to target centroid
        const distToTarget = calculateDistance(
          source.activities[ai].latitude, source.activities[ai].longitude,
          clusters[ci].centroid.lat, clusters[ci].centroid.lng
        );
        const fitScore = -distToTarget; // Closer is better
        if (fitScore > bestFitScore) {
          bestFitScore = fitScore;
          bestIdx = ai;
        }
      }

      if (bestIdx === -1) break;

      const [moved] = source.activities.splice(bestIdx, 1);
      clusters[ci].activities.push(moved);
      computeClusterGeo(source);
      computeClusterGeo(clusters[ci]);
      console.log(`[Pipeline V2] Phase 3b: moved "${moved.name}" from Day ${clusters[bestSource].dayNumber} (${source.activities.length} left) → sparse Day ${clusters[ci].dayNumber} (${clusters[ci].activities.length} now)`);
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
          if (remaining > bestRemaining && remaining >= (nm.duration || 60) + 20 && canMoveBetweenDaysGeoSafe(ci, ti, nm)) {
            bestRemaining = remaining;
            bestTarget = ti;
          }
        }

        if (bestTarget !== -1) {
          const idx = cluster.activities.findIndex(a => a.id === nm.id);
          if (idx !== -1) {
            const [moved] = cluster.activities.splice(idx, 1);
            clusters[bestTarget].activities.push(moved);
            computeClusterGeo(cluster);
            computeClusterGeo(clusters[bestTarget]);
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
        if (remaining > bestRemaining && remaining >= (activity.duration || 60) + 20 && canMoveBetweenDaysGeoSafe(ci, ti, activity)) {
          bestRemaining = remaining;
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1) {
        // Move must-see to a day with capacity
        const [moved] = cluster.activities.splice(ai, 1);
        clusters[bestTarget].activities.push(moved);
        computeClusterGeo(cluster);
        computeClusterGeo(clusters[bestTarget]);
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
              if (!canMoveBetweenDaysGeoSafe(ci, evictDay, activity)) continue;
              clusters[evictDay].activities.splice(evictIdx, 1);
              const [moved] = cluster.activities.splice(ai, 1);
              clusters[evictDay].activities.push(moved);
              computeClusterGeo(cluster);
              computeClusterGeo(clusters[evictDay]);
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
        if (
          targetHeavy < fewestHeavy
          && remaining >= (candidate.duration || 60) + 20
          && canMoveBetweenDaysGeoSafe(ci, ti, candidate)
        ) {
          fewestHeavy = targetHeavy;
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1 && fewestHeavy < MAX_HEAVY_PER_DAY) {
        const idx = cluster.activities.findIndex(a => a.id === candidate.id);
        if (idx !== -1) {
          const [moved] = cluster.activities.splice(idx, 1);
          clusters[bestTarget].activities.push(moved);
          computeClusterGeo(cluster);
          computeClusterGeo(clusters[bestTarget]);
          toMove--;
          console.log(`[Pipeline V2] Phase 6: moved heavy activity "${moved.name}" (${moved.duration}min) from Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber} (fatigue balancing)`);
        }
      }
    }
  }

  // Phase 6b: Composite day-load balancing (time + travel + fatigue)
  // Smooths over-dense days by moving low-impact activities to lighter days.
  // Soft caps are used (not hard caps) to avoid dropping must-sees.
  const dayLoadScore = (idx: number): number => {
    const activities = clusters[idx].activities;
    const totalDurationMin = activities.reduce((sum, a) => sum + (a.duration || 60), 0) + computeMealOverheadMin(idx);
    const travelMin = Math.round(routeCostKm(activities) * 14);
    const heavyCount = activities.filter((a) => (a.duration || 60) >= 90).length;
    const longLegCount = Math.max(0, activities.length - 1);
    return totalDurationMin + travelMin + heavyCount * 40 + longLegCount * 8;
  };

  const getDayLoadSoftCap = (idx: number): number => {
    const cluster = clusters[idx];
    const isBoundaryDay = cluster.dayNumber === 1 || cluster.dayNumber === numDays;
    const baseCap = isBoundaryDay ? 500 : 560;
    const availabilityCap = Math.max(360, Math.round(hoursPerDay[idx] * 60 - 20));
    return Math.min(baseCap, availabilityCap);
  };

  const getDayLoadOverage = (idx: number): number => dayLoadScore(idx) - getDayLoadSoftCap(idx);

  const findBestDayLoadMoveTarget = (
    sourceIdx: number,
    candidate: ScoredActivity
  ): { targetIdx: number; gain: number } | null => {
    const requiredMin = (candidate.duration || 60) + 20;
    const sourceBefore = dayLoadScore(sourceIdx);
    const sourceOverBefore = Math.max(0, getDayLoadOverage(sourceIdx));
    let best: { targetIdx: number; gain: number } | null = null;

    for (let ti = 0; ti < clusters.length; ti++) {
      if (ti === sourceIdx || isDayTrip[ti]) continue;
      if (dayRemainingMinutes(ti) < requiredMin) continue;
      if (!canMoveBetweenDaysGeoSafe(sourceIdx, ti, candidate)) continue;

      const sourceBeforeActivities = clusters[sourceIdx].activities;
      const targetBeforeActivities = clusters[ti].activities;
      const sourceAfterActivities = sourceBeforeActivities.filter((a) => a.id !== candidate.id);
      const targetAfterActivities = [...targetBeforeActivities, candidate];

      const sourceAfterLoad = (() => {
        const totalDurationMin = sourceAfterActivities.reduce((sum, a) => sum + (a.duration || 60), 0) + computeMealOverheadMin(sourceIdx);
        const travelMin = Math.round(routeCostKm(sourceAfterActivities) * 14);
        const heavyCount = sourceAfterActivities.filter((a) => (a.duration || 60) >= 90).length;
        const longLegCount = Math.max(0, sourceAfterActivities.length - 1);
        return totalDurationMin + travelMin + heavyCount * 40 + longLegCount * 8;
      })();
      const targetAfterLoad = (() => {
        const totalDurationMin = targetAfterActivities.reduce((sum, a) => sum + (a.duration || 60), 0) + computeMealOverheadMin(ti);
        const travelMin = Math.round(routeCostKm(targetAfterActivities) * 14);
        const heavyCount = targetAfterActivities.filter((a) => (a.duration || 60) >= 90).length;
        const longLegCount = Math.max(0, targetAfterActivities.length - 1);
        return totalDurationMin + travelMin + heavyCount * 40 + longLegCount * 8;
      })();

      const sourceOverAfter = Math.max(0, sourceAfterLoad - getDayLoadSoftCap(sourceIdx));
      const targetOverAfter = Math.max(0, targetAfterLoad - getDayLoadSoftCap(ti));

      // Keep receiving day close to comfort cap.
      if (targetAfterLoad > getDayLoadSoftCap(ti) + 40) continue;

      const overageGain = sourceOverBefore - (sourceOverAfter + targetOverAfter);
      const rawLoadGain = sourceBefore - sourceAfterLoad;
      const gain = overageGain * 3 + rawLoadGain;
      if (gain < 30) continue;

      if (!best || gain > best.gain) {
        best = { targetIdx: ti, gain };
      }
    }

    return best;
  };

  for (let iter = 0; iter < 12; iter++) {
    let sourceIdx = -1;
    let targetIdx = -1;
    let maxLoad = -Infinity;
    let minLoad = Infinity;

    for (let ci = 0; ci < clusters.length; ci++) {
      if (isDayTrip[ci]) continue;
      const load = dayLoadScore(ci);
      if (load > maxLoad) {
        maxLoad = load;
        sourceIdx = ci;
      }
      if (load < minLoad) {
        minLoad = load;
        targetIdx = ci;
      }
    }

    if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) break;
    if (maxLoad - minLoad < 120) break;

    const source = clusters[sourceIdx];
    const moveCandidate = source.activities
      .filter((a) => !a.mustSee)
      .sort((a, b) => (a.score - b.score) || ((a.duration || 60) - (b.duration || 60)))[0];

    if (!moveCandidate) break;
    if (dayRemainingMinutes(targetIdx) < (moveCandidate.duration || 60) + 20) break;
    if (!canMoveBetweenDaysGeoSafe(sourceIdx, targetIdx, moveCandidate)) break;

    const moveIdx = source.activities.findIndex((a) => a.id === moveCandidate.id);
    if (moveIdx === -1) break;

    const [moved] = source.activities.splice(moveIdx, 1);
    clusters[targetIdx].activities.push(moved);
    computeClusterGeo(source);
    computeClusterGeo(clusters[targetIdx]);

    console.log(
      `[Pipeline V2] Phase 6b: moved \"${moved.name}\" Day ${clusters[sourceIdx].dayNumber} → Day ${clusters[targetIdx].dayNumber} `
      + `(load ${Math.round(maxLoad)}→${Math.round(dayLoadScore(sourceIdx))}, ${Math.round(minLoad)}→${Math.round(dayLoadScore(targetIdx))})`
    );
  }

  // Phase 6c: Soft day-load cap enforcement (fatigue first, no hard cut).
  // Move only non-must-sees and only when the global overload decreases.
  for (let iter = 0; iter < 20; iter++) {
    let sourceIdx = -1;
    let worstOverage = 0;

    for (let ci = 0; ci < clusters.length; ci++) {
      if (isDayTrip[ci]) continue;
      const overage = getDayLoadOverage(ci);
      if (overage > worstOverage) {
        worstOverage = overage;
        sourceIdx = ci;
      }
    }

    if (sourceIdx === -1 || worstOverage < 45) break;

    const source = clusters[sourceIdx];
    const candidates = source.activities
      .filter((activity) => !activity.mustSee)
      .sort((a, b) => {
        const scoreDelta = (a.score - b.score);
        if (scoreDelta !== 0) return scoreDelta;
        const durationDelta = (b.duration || 60) - (a.duration || 60);
        if (durationDelta !== 0) return durationDelta;
        const aOutlier = calculateDistance(a.latitude, a.longitude, source.centroid.lat, source.centroid.lng);
        const bOutlier = calculateDistance(b.latitude, b.longitude, source.centroid.lat, source.centroid.lng);
        return bOutlier - aOutlier;
      });

    let movedAny = false;
    for (const candidate of candidates) {
      const target = findBestDayLoadMoveTarget(sourceIdx, candidate);
      if (!target) continue;

      const moveIdx = source.activities.findIndex((activity) => activity.id === candidate.id);
      if (moveIdx === -1) continue;
      const [moved] = source.activities.splice(moveIdx, 1);
      clusters[target.targetIdx].activities.push(moved);
      computeClusterGeo(source);
      computeClusterGeo(clusters[target.targetIdx]);

      console.log(
        `[Pipeline V2] Phase 6c: moved "${moved.name}" Day ${source.dayNumber} → Day ${clusters[target.targetIdx].dayNumber} `
        + `(overage ${Math.round(worstOverage)}min, gain=${Math.round(target.gain)})`
      );
      movedAny = true;
      break;
    }

    if (!movedAny) break;
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
    experiential: ['cooking class', 'cours de cuisine', 'food tour', 'wine tasting',
                   'dégustation', 'degustation', 'tasting', 'atelier cuisine',
                   'atelier culinaire', 'wine tour', 'beer tasting'],
  };

  function getActivityCategory(a: ScoredActivity): string {
    const text = `${(a.name || '').toLowerCase()} ${(a.type || '').toLowerCase()}`;
    for (const [cat, keywords] of Object.entries(DIVERSITY_CATEGORIES)) {
      if (keywords.some(k => text.includes(k))) return cat;
    }
    return 'other';
  }

  const MAX_SAME_CATEGORY_PER_DAY = 2;
  const MAX_EXPERIENTIAL_PER_DAY = 1;

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
      const maxForCat = cat === 'experiential' ? MAX_EXPERIENTIAL_PER_DAY : MAX_SAME_CATEGORY_PER_DAY;
      if (catActivities.length <= maxForCat) continue;

      // Too many of this category — move lowest-scored non-must-see
      const swapCandidates = catActivities
        .filter(a => !a.mustSee)
        .sort((a, b) => a.score - b.score);

      let toMove = catActivities.length - maxForCat;
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
          if (
            targetCatCount < fewestCat
            && remaining >= (candidate.duration || 60) + 20
            && canMoveBetweenDaysGeoSafe(ci, ti, candidate)
          ) {
            fewestCat = targetCatCount;
            bestTarget = ti;
          }
        }

        if (bestTarget !== -1 && fewestCat < maxForCat) {
          const idx = cluster.activities.findIndex(a => a.id === candidate.id);
          if (idx !== -1) {
            const [moved] = cluster.activities.splice(idx, 1);
            clusters[bestTarget].activities.push(moved);
            computeClusterGeo(cluster);
            computeClusterGeo(clusters[bestTarget]);
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
        if (!canMoveBetweenDaysGeoSafe(targetIdx, ti, evict)) continue;
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
        if (!canMoveBetweenDaysGeoSafe(sourceIdx, targetIdx, activity)) continue;

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
        if (improvementKm < 1.8) continue;
        if (PIPELINE_GEO_STRICT && (moveDegradesRouteCost(ci, bestTarget, activity) || moveExceedsGeoCap(bestTarget, activity))) {
          continue;
        }

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

  // Use density profile for adaptive cohesion radius (slightly tighter to reduce zigzag days).
  const cohesionMaxRadiusKm = densityProfile
    ? densityProfile.maxClusterRadius * 1.35
    : (clusters.length <= 3 ? 3.2 : clusters.length === 4 ? 3.6 : 3.8);
  const minCohesionGainKm = densityProfile?.densityCategory === 'dense' ? 0.2 : 0.4;
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
        if (PIPELINE_GEO_STRICT && (moveDegradesRouteCost(ci, bestTarget, activity) || moveExceedsGeoCap(bestTarget, activity))) {
          continue;
        }

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

  // Phase 10: Last-day proximity filter
  // On the departure day, far-from-center activities are problematic: the traveler
  // needs to be near the hotel/station to catch their transport.
  // Move activities > 4km from the city center to earlier days when possible.
  // Skip this phase if we have no city-center anchor.
  if (destCoords && numDays >= 2) {
    const LAST_DAY_MAX_KM = 4;
    const lastDayIdx = clusters.findIndex(c => c.dayNumber === numDays);

    if (lastDayIdx !== -1 && !isDayTrip[lastDayIdx]) {
      const lastCluster = clusters[lastDayIdx];
      // Iterate in reverse so splice indices stay valid
      for (let ai = lastCluster.activities.length - 1; ai >= 0; ai--) {
        const activity = lastCluster.activities[ai];
        const distFromCenter = calculateDistance(
          activity.latitude,
          activity.longitude,
          destCoords.lat,
          destCoords.lng
        );

        if (distFromCenter <= LAST_DAY_MAX_KM) continue; // Close enough — keep on last day

        // Activity is too far from center for the departure day.
        // Attempt 1: find an earlier non-last, non-day-trip day to SWAP with a closer activity.
        let swapped = false;
        let bestSwapSource = -1;
        let bestSwapIdx = -1;
        let bestSwapDist = Infinity; // distance from center of the replacement activity

        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === lastDayIdx || isDayTrip[ti]) continue;
          if (clusters[ti].dayNumber >= numDays) continue; // Only earlier days

          for (let bi = 0; bi < clusters[ti].activities.length; bi++) {
            const candidate = clusters[ti].activities[bi];
            if (candidate.mustSee) continue; // Never swap a must-see in here

            // The candidate would replace the far activity on the last day.
            // It should be closer to the city center than the current activity.
            const candidateDist = calculateDistance(
              candidate.latitude,
              candidate.longitude,
              destCoords.lat,
              destCoords.lng
            );
            if (candidateDist >= distFromCenter) continue; // Not an improvement

            // Duration compatibility: the swap should not overload either day.
            const lastDayRemaining = dayRemainingMinutes(lastDayIdx);
            const sourceDayRemaining = dayRemainingMinutes(ti);
            const durationDelta = (candidate.duration || 60) - (activity.duration || 60);
            // If swapping would make last day overflow or source day underflow badly, skip.
            if (lastDayRemaining - durationDelta < 0) continue;
            if (sourceDayRemaining + durationDelta < 0) continue;

            if (candidateDist < bestSwapDist) {
              bestSwapDist = candidateDist;
              bestSwapSource = ti;
              bestSwapIdx = bi;
            }
          }
        }

        if (bestSwapSource !== -1 && bestSwapIdx !== -1) {
          // Execute the swap
          const [farActivity] = lastCluster.activities.splice(ai, 1);
          const [nearActivity] = clusters[bestSwapSource].activities.splice(bestSwapIdx, 1);
          lastCluster.activities.push(nearActivity);
          clusters[bestSwapSource].activities.push(farActivity);
          computeClusterGeo(lastCluster);
          computeClusterGeo(clusters[bestSwapSource]);
          swapped = true;
          console.log(
            `[Pipeline V2] Phase 10: swapped far activity "${farActivity.name}" ` +
            `(${distFromCenter.toFixed(1)}km from center) off last day ` +
            `with "${nearActivity.name}" (${bestSwapDist.toFixed(1)}km from center) ` +
            `from Day ${clusters[bestSwapSource].dayNumber}`
          );
        }

        if (swapped) continue;

        // Attempt 2: no swap found — move the far activity to the earlier day with the most gap.
        let bestTargetIdx = -1;
        let bestTargetRemaining = -Infinity;

        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === lastDayIdx || isDayTrip[ti]) continue;
          if (clusters[ti].dayNumber >= numDays) continue; // Only earlier days

          const remaining = dayRemainingMinutes(ti);
          const neededMin = (activity.duration || 60) + 20;
          if (remaining >= neededMin && remaining > bestTargetRemaining) {
            bestTargetRemaining = remaining;
            bestTargetIdx = ti;
          }
        }

        if (bestTargetIdx !== -1) {
          const [moved] = lastCluster.activities.splice(ai, 1);
          clusters[bestTargetIdx].activities.push(moved);
          computeClusterGeo(lastCluster);
          computeClusterGeo(clusters[bestTargetIdx]);
          console.log(
            `[Pipeline V2] Phase 10: moved far activity "${moved.name}" ` +
            `(${distFromCenter.toFixed(1)}km from center) off last day ` +
            `→ Day ${clusters[bestTargetIdx].dayNumber} (${Math.round(bestTargetRemaining)}min gap)`
          );
        } else {
          console.log(
            `[Pipeline V2] Phase 10: could not relocate "${activity.name}" ` +
            `(${distFromCenter.toFixed(1)}km from center) — no earlier day with capacity`
          );
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

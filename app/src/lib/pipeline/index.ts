/**
 * Pipeline V2 — Main Orchestrator
 *
 * Replaces the old ai.ts pipeline (1400+ lines, 13 sequential phases, 3-5 min)
 * with a clean 7-step approach: parallel fetch → algorithmic organization → single Claude call.
 *
 * Target: 20-40s per trip generation.
 */

import type { Trip, TripPreferences, TransportOptionSummary, Restaurant } from '../types';
import type { ActivityCluster, OnPipelineEvent } from './types';
export type { PipelineEvent, OnPipelineEvent } from './types';
import { fetchAllData } from './step1-fetch';
import { scoreAndSelectActivities } from './step2-score';
import { batchFetchWikipediaSummaries, getWikiLanguageForDestination } from '../services/wikipedia';
import { clusterActivities, computeCityDensityProfile } from './step3-cluster';
import { selectTieredHotels, selectTopHotelsByBarycenter } from './step5-hotel';
import { validateAndFixTrip } from './step8-validate';
import { calculateDistance } from '../services/geocoding';

// ---------------------------------------------------------------------------
// V2 Algorithmic pipeline — moved to legacy file
// ---------------------------------------------------------------------------
import { generateTripV2Algorithmic } from './legacy/v2-algorithmic';
export { selectSelfCateredMealsForBudget } from './legacy/v2-algorithmic';

// ---------------------------------------------------------------------------
// Pipeline V2 LLM — New imports
// ---------------------------------------------------------------------------
import { prepareDataForLLM } from './step2-prepare-llm';
import { planWithLLM } from './step3-llm-plan';
import { assembleFromLLMPlan, computeDistancesForDay, addOutboundTransportItem, addReturnTransportItem } from './step4-assemble-llm';
import { mergeDayTripDaysWithLLMPlan } from './utils/day-trip-builder';
import { fixRestaurantOutliers } from './step7-assemble';
import { isAppropriateForMeal, isBreakfastSpecialized, getCuisineFamily } from './step4-restaurants';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';

// ---------------------------------------------------------------------------
// Pipeline V3 — New imports
// ---------------------------------------------------------------------------
import { anchorTransport } from './step4-anchor-transport';
import { timeToMin } from './utils/time';
import { computeTravelTimes } from './step7b-travel-times';
import { enrichRestaurantPool } from './step8-place-restaurants';
import { unifiedScheduleV3Days } from './step8910-unified-schedule';
import { validateContracts } from './step11-contracts';
import { decorateTrip } from './step12-decorate';

// ---------------------------------------------------------------------------
// Pipeline Event System — emit helper
// ---------------------------------------------------------------------------
function emit(onEvent: OnPipelineEvent | undefined, partial: Omit<import('./types').PipelineEvent, 'timestamp'>) {
  onEvent?.({ ...partial, timestamp: Date.now() });
}

/** Resolve best transport option based on user preference + available options */
function resolveBestTransport(
  preferences: TripPreferences,
  transportOptions?: TransportOptionSummary[]
): TransportOptionSummary | null {
  if (preferences.transport && preferences.transport !== 'optimal' && transportOptions?.length) {
    const preferred = transportOptions.find(t => t.mode === preferences.transport);
    if (preferred) return preferred;
  }
  return transportOptions?.find(t => t.recommended) || transportOptions?.[0] || null;
}

/**
 * Generate a trip — routes to V3, LLM, or Algorithmic pipeline based on PIPELINE_VERSION env var.
 */
export async function generateTripV2(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const version = process.env.PIPELINE_VERSION || 'v3';

  if (version === 'v3') {
    console.log('[Pipeline V3] Using V3 pipeline (deterministic 12-step)');
    // Check for multi-city
    if (preferences.cityPlan && preferences.cityPlan.length > 1) {
      return generateTripV3MultiCity(preferences, onEvent);
    }
    return generateTripV3(preferences, onEvent);
  }

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

  // Resolve transport
  const bestTransport = resolveBestTransport(preferences, data.transportOptions);

  // Step 2: Select hotel + prepare data for LLM
  console.log('[Pipeline V2 LLM] === Step 2: Preparing data for LLM... ===');
  emit(onEvent, { type: 'step_start', step: 2, stepName: 'Preparing data for LLM' });
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

  const tieredHotels = selectTieredHotels(
    [minimalCluster],
    data.bookingHotels,
    preferences.budgetLevel,
    undefined,
    preferences.durationDays,
    { destination: preferences.destination, destCoords: data.destCoords }
  );

  const hotel = tieredHotels.length > 0 ? tieredHotels[0] : null; // Tier 1 = most central

  if (hotel) {
    console.log(`[Pipeline V2 LLM] Hotel selected: "${hotel.name}" (${hotel.rating}★, €${hotel.pricePerNight}/night, ${hotel.distanceToCenter}km, tier: ${hotel.distanceTier})`);
    console.log(`[Pipeline V2 LLM] ${tieredHotels.length} tiered hotels: ${tieredHotels.map(h => `${h.distanceTier}="${h.name}" (${h.distanceToCenter}km)`).join(', ')}`);
  } else {
    console.warn('[Pipeline V2 LLM] No hotel selected from pool');
  }

  const { llmInput, prePlannedDayTripDays, reservedDayNumbers } = await prepareDataForLLM(data, preferences, hotel, bestTransport, data.outboundFlight, data.returnFlight);
  console.log(`[Pipeline V2 LLM] Step 2 done in ${Date.now() - T2}ms`);
  emit(onEvent, { type: 'step_done', step: 2, stepName: 'Preparing data for LLM', durationMs: Date.now() - T2,
    detail: `${llmInput.activities.length} activities, ${llmInput.restaurants.length} restaurants, ${prePlannedDayTripDays.length} day-trip day(s) pre-planned` });

  // Step 3: LLM planning (Claude or Gemini based on LLM_PLANNER_MODEL env)
  const plannerModel = process.env.LLM_PLANNER_MODEL || 'claude-sonnet-4-6';
  console.log(`[Pipeline V2 LLM] === Step 3: LLM planning (${plannerModel})... ===`);
  emit(onEvent, { type: 'step_start', step: 3, stepName: `LLM planning (${plannerModel})` });
  const T3 = Date.now();
  const llmPlan = await planWithLLM(llmInput);
  const step3Ms = Date.now() - T3;
  console.log(`[Pipeline V2 LLM] Step 3 done in ${step3Ms}ms — ${llmPlan.days.length} days planned`);
  emit(onEvent, { type: 'step_done', step: 3, stepName: `LLM planning (${plannerModel})`, durationMs: step3Ms,
    detail: `${llmPlan.days.length} days, ${llmPlan.days.reduce((s, d) => s + d.items.length, 0)} items` });

  // Step 3b: Merge pre-planned day-trip days with LLM plan
  if (prePlannedDayTripDays.length > 0) {
    llmPlan.days = mergeDayTripDaysWithLLMPlan(llmPlan, prePlannedDayTripDays, reservedDayNumbers, preferences.durationDays);
    console.log(`[Pipeline V2 LLM] Step 3b: Merged ${prePlannedDayTripDays.length} pre-planned day-trip day(s) — total ${llmPlan.days.length} days`);
  }

  // Step 4: Assemble Trip from LLM plan
  console.log('[Pipeline V2 LLM] === Step 4: Assembling trip... ===');
  emit(onEvent, { type: 'step_start', step: 4, stepName: 'Assembling trip' });
  const T4 = Date.now();
  const trip = await assembleFromLLMPlan(llmPlan, llmInput, data, preferences, hotel, bestTransport, onEvent, tieredHotels);
  const step4Ms = Date.now() - T4;
  console.log(`[Pipeline V2 LLM] Step 4 done in ${step4Ms}ms`);
  emit(onEvent, { type: 'step_done', step: 4, stepName: 'Assembling trip', durationMs: step4Ms });

  // Step 4b: Fix restaurant outliers (swap far restaurants for nearby ones)
  console.log('[Pipeline V2 LLM] === Step 4b: Fixing restaurant proximity... ===');
  const T4b = Date.now();
  const restaurantPool: Restaurant[] = [
    ...(data.tripAdvisorRestaurants || []),
    ...(data.serpApiRestaurants || []),
    ...Object.values(data.dayTripRestaurants || {}).flat(),
  ];

  // For day-trip days, fix restaurants using day-trip destination as anchor
  // For city days, use hotel as anchor
  const dayTripDays = trip.days.filter(d => d.isDayTrip && d.dayTripDestination);
  const cityDays = trip.days.filter(d => !d.isDayTrip);

  // Fix city days (standard behavior)
  const fixStats = await fixRestaurantOutliers(
    cityDays,
    restaurantPool,
    preferences.destination,
    {
      allowApiFallback: true,
      breakfastMaxKm: 0.5,
      mealMaxKm: 0.3,
      hotelCoords: hotel ? { latitude: hotel.latitude, longitude: hotel.longitude } : undefined,
    }
  );

  // Fix day-trip days using day-trip destination pool and coordinates
  for (const dtDay of dayTripDays) {
    const dtName = dtDay.dayTripDestination!;
    const dtRestaurants = data.dayTripRestaurants?.[dtName] || [];
    const dtSuggestion = data.dayTripSuggestions?.find(s => (s.destination || s.name) === dtName);
    const dtCoords = dtSuggestion
      ? { latitude: dtSuggestion.latitude, longitude: dtSuggestion.longitude }
      : undefined;

    if (dtRestaurants.length > 0) {
      await fixRestaurantOutliers(
        [dtDay],
        dtRestaurants,
        dtName,
        {
          allowApiFallback: false, // don't make extra API calls for day trips
          breakfastMaxKm: 2.0,    // more lenient for day trips
          mealMaxKm: 1.5,
          hotelCoords: dtCoords,
        }
      );
    }
  }

  // Recalculate distances after restaurant swaps (coordinates may have changed)
  for (const day of trip.days) {
    computeDistancesForDay(day);
  }

  console.log(`[Pipeline V2 LLM] Step 4b: ${fixStats.replaced} restaurants swapped, ${fixStats.flaggedFallback} kept as fallback (${Date.now() - T4b}ms)`);

  // Step 4c: Populate restaurant alternatives (2-3 suggestions per meal)
  console.log('[Pipeline V2 LLM] === Step 4c: Populating restaurant alternatives... ===');
  const T4c = Date.now();
  await populateRestaurantAlternatives(trip.days, restaurantPool, preferences.destination);
  console.log(`[Pipeline V2 LLM] Step 4c done in ${Date.now() - T4c}ms`);

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

// ---------------------------------------------------------------------------
// LLM Pipeline: Populate restaurant alternatives (2 diverse suggestions per meal)
// Reuses logic from step7-assemble section 13c but as a standalone function.
// ---------------------------------------------------------------------------
import type { TripDay } from '../types';

const ALT_SEARCH_RADIUS_KM = 1.5;
const TARGET_ALTS = 2;

async function populateRestaurantAlternatives(
  days: TripDay[],
  pool: Restaurant[],
  destination: string
): Promise<void> {
  // Build global used set (avoid suggesting a restaurant that's already used elsewhere)
  const globalUsedIds = new Set<string>();
  const globalUsedNames = new Set<string>();
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'restaurant' && item.restaurant) {
        globalUsedIds.add(item.restaurant.id || item.id);
        if (item.restaurant.name) globalUsedNames.add(item.restaurant.name);
      }
    }
  }

  let totalAltsAdded = 0;
  let apiCallCount = 0;

  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'restaurant') continue;
      if (!item.restaurant) continue;
      if (!item.latitude || !item.longitude || item.latitude === 0) continue;

      const currentAlts = item.restaurantAlternatives || [];
      if (currentAlts.length >= TARGET_ALTS) continue;

      // Determine meal type from title (consistent with fixRestaurantOutliers)
      const title = item.title || '';
      const mealType: 'breakfast' | 'lunch' | 'dinner' =
        title.includes('Petit-déjeuner') ? 'breakfast' :
        title.includes('Déjeuner') ? 'lunch' : 'dinner';

      const refLat = item.latitude;
      const refLng = item.longitude;
      const primaryFamily = getCuisineFamily(item.restaurant);
      const currentAltIds = new Set(currentAlts.map((a: Restaurant) => a.id));
      const usedFamilies = new Set<string>([primaryFamily, ...currentAlts.map((a: Restaurant) => getCuisineFamily(a))]);

      // Search pool for candidates within radius
      const candidates: { r: Restaurant; dist: number; family: string }[] = [];
      for (const r of pool) {
        if (r.id === (item.restaurant.id || item.id)) continue;
        if (currentAltIds.has(r.id)) continue;
        if (globalUsedIds.has(r.id) || globalUsedNames.has(r.name)) continue;
        if (!r.latitude || !r.longitude) continue;
        if (!isAppropriateForMeal(r, mealType)) continue;
        if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
        const dist = calculateDistance(refLat, refLng, r.latitude, r.longitude);
        if (dist <= ALT_SEARCH_RADIUS_KM) {
          candidates.push({ r, dist, family: getCuisineFamily(r) });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);

      const newAlts: Restaurant[] = [...currentAlts];

      // Pass 1: pick diverse cuisines first
      for (const c of candidates) {
        if (newAlts.length >= TARGET_ALTS) break;
        if (!usedFamilies.has(c.family)) {
          newAlts.push(c.r);
          usedFamilies.add(c.family);
        }
      }
      // Pass 2: fill remaining with closest
      for (const c of candidates) {
        if (newAlts.length >= TARGET_ALTS) break;
        if (!newAlts.some((a: Restaurant) => a.id === c.r.id)) {
          newAlts.push(c.r);
        }
      }

      // If pool didn't have enough, try SerpAPI (max 3 API calls total)
      if (newAlts.length < TARGET_ALTS && apiCallCount < 3) {
        try {
          apiCallCount++;
          const apiResults = await searchRestaurantsNearbyWithFallback(
            { lat: refLat, lng: refLng },
            destination,
            { mealType, maxDistance: 1500, limit: 5 }
          );
          if (apiResults.length > 0) pool.push(...apiResults);
          for (const r of apiResults) {
            if (newAlts.length >= TARGET_ALTS) break;
            if (r.id === (item.restaurant.id || item.id)) continue;
            if (newAlts.some((a: Restaurant) => a.id === r.id)) continue;
            if (globalUsedNames.has(r.name)) continue;
            if (!r.latitude || !r.longitude) continue;
            if (!isAppropriateForMeal(r, mealType)) continue;
            if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
            const dist = calculateDistance(refLat, refLng, r.latitude, r.longitude);
            if (dist <= ALT_SEARCH_RADIUS_KM) {
              newAlts.push(r);
            }
          }
        } catch {
          // Non-blocking: keep what we have
        }
      }

      if (newAlts.length > currentAlts.length) {
        item.restaurantAlternatives = newAlts.slice(0, TARGET_ALTS);
        totalAltsAdded += newAlts.length - currentAlts.length;
      }
    }
  }

  console.log(`[Pipeline V2 LLM] Restaurant alternatives: ${totalAltsAdded} alternatives added`);
}

// ============================================
// Pipeline V3 — Deterministic Trip Generation
// ============================================

/**
 * Pipeline V3 — Deterministic Trip Generation
 *
 * 12-step pipeline:
 *   1. fetchAllData()          — Parallel API calls
 *   2. scoreAndSelectActivities() — Score, dedup, select top N
 *   3. selectTopHotelsByBarycenter() — Hotel near activity centroid
 *   4. anchorTransport()       — Compute time windows from flights/transport
 *   5. (day trips handled in clustering)
 *   6. clusterActivities()     — Geographic clustering per day
 *   7. (routing done inside clustering with 2-opt)
 *   7b. computeTravelTimes()   — Selective Directions API calls
 *   8+9+10. unifiedScheduleV3Days() — Unified scheduler: activities + restaurants in-situ + repair
 *   11. validateContracts()    — Quality scoring and contract validation
 *   12. decorateTrip()         — Optional LLM decoration (OFF by default)
 */
export async function generateTripV3(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const startTime = Date.now();
  const stageTimes: Record<string, number> = {};

  // Step 1: Fetch all data
  let t = Date.now();
  onEvent?.({ type: 'step_start', step: 1, stepName: 'Fetching data', timestamp: Date.now() });
  let data: Awaited<ReturnType<typeof fetchAllData>>;
  try {
    data = await fetchAllData(preferences, onEvent);
  } catch (err) {
    console.error('[Pipeline V3] Step 1 failed:', err);
    throw new Error(`[Pipeline V3] Data fetch failed: ${(err as Error).message}`);
  }
  stageTimes['fetch'] = Date.now() - t;
  onEvent?.({ type: 'step_done', step: 1, stepName: 'Fetching data', durationMs: stageTimes['fetch'], timestamp: Date.now() });

  // Step 2: Score and rank activities
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 2, stepName: 'Scoring activities', timestamp: Date.now() });
  const selectedActivities = scoreAndSelectActivities(data, preferences);
  const allActivities = selectedActivities; // For repair pass
  stageTimes['score'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 2: ${selectedActivities.length} activities selected`);
  onEvent?.({ type: 'step_done', step: 2, stepName: 'Scoring activities', durationMs: stageTimes['score'], timestamp: Date.now() });

  // Step 2b: Enrich descriptions with Wikipedia (async, 5s timeout, cached 30 days)
  try {
    const activitiesWithoutDesc = selectedActivities.filter(a => !a.description);
    if (activitiesWithoutDesc.length > 0) {
      const wikiLang = getWikiLanguageForDestination(preferences.destination);
      const wikiNames = activitiesWithoutDesc.map(a => a.name);
      const wikiResults = await Promise.race([
        batchFetchWikipediaSummaries(wikiNames, wikiLang),
        new Promise<Map<string, null>>((resolve) => setTimeout(() => resolve(new Map()), 5000)),
      ]);
      let enriched = 0;
      for (const act of activitiesWithoutDesc) {
        const wiki = wikiResults.get(act.name);
        if (wiki?.extract) {
          act.description = wiki.extract;
          enriched++;
        }
      }
      console.log(`[Pipeline V3] Step 2b: Wikipedia enriched ${enriched}/${activitiesWithoutDesc.length} descriptions`);
    }
  } catch (err) {
    console.warn(`[Pipeline V3] Step 2b: Wikipedia enrichment failed (non-critical):`, err);
  }

  // Step 2c: Resolve transport BEFORE anchoring time windows
  const bestTransport = resolveBestTransport(preferences, data.transportOptions);

  // Synthetic return transport: 17:00 departure (matches addReturnTransportItem hardcoded departure)
  const syntheticReturnTransport: TransportOptionSummary | null = bestTransport?.transitLegs?.length
    ? {
        ...bestTransport,
        transitLegs: [{
          ...bestTransport.transitLegs[0],
          departure: '17:00',
          arrival: '23:00',
          from: preferences.destination || '',
          to: preferences.origin || '',
        }],
      }
    : null;

  // Anchor transport (time windows) — computed BEFORE clustering so clusters
  // know how much time is available on each day (first/last day compressed)
  t = Date.now();
  const timeWindows = anchorTransport(
    preferences.durationDays,
    data.outboundFlight || null,
    data.returnFlight || null,
    bestTransport,           // inbound: Day 1 arrival constraint
    syntheticReturnTransport // outbound: Last day departure constraint
  );
  stageTimes['anchor-transport'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 2c: Time windows anchored`);

  // Step 3: Cluster by day
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 3, stepName: 'Clustering', timestamp: Date.now() });
  const densityProfile = computeCityDensityProfile(selectedActivities, preferences.durationDays);
  const PACE_FACTOR: Record<string, number> = {
    relaxed: 0.65,
    moderate: 1.0,
    intensive: 1.3,
  };
  const paceFactor = PACE_FACTOR[preferences.pace || 'moderate'] || 1.0;

  const clusters = clusterActivities(
    selectedActivities,
    preferences.durationDays,
    data.destCoords,
    densityProfile,
    preferences.startDate.toISOString().split('T')[0],
    timeWindows,
    paceFactor
  );
  stageTimes['cluster'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 3: ${clusters.length} clusters created`);
  onEvent?.({ type: 'step_done', step: 3, stepName: 'Clustering', durationMs: stageTimes['cluster'], timestamp: Date.now() });

  // Step 4: Select hotel (3 tiers)
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 4, stepName: 'Hotel selection', timestamp: Date.now() });
  const hotels = selectTopHotelsByBarycenter(
    clusters,
    data.bookingHotels || [],
    preferences.budgetLevel || 'medium',
    undefined,
    preferences.durationDays,
    { destination: preferences.destination },
    3
  );
  const hotel = hotels[0] || null;
  const hotelCoords = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : data.destCoords;
  stageTimes['hotel'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 4: Hotel selected: ${hotel?.name || 'none'}`);
  onEvent?.({ type: 'step_done', step: 4, stepName: 'Hotel selection', durationMs: stageTimes['hotel'], timestamp: Date.now() });

  // Step 5: Time windows already computed at Step 2c (before clustering)

  // Step 6: Compute travel times (selective Directions API)
  t = Date.now();
  const directionsMode = (process.env.PIPELINE_DIRECTIONS_MODE || 'selective') as 'selective' | 'all' | 'off';
  onEvent?.({ type: 'step_start', step: 6, stepName: 'Computing travel times', timestamp: Date.now() });
  let travelTimes: Awaited<ReturnType<typeof computeTravelTimes>>;
  try {
    travelTimes = await computeTravelTimes(clusters, hotelCoords, directionsMode);
  } catch (err) {
    console.error('[Pipeline V3] Step 6 failed:', err);
    throw new Error(`[Pipeline V3] Travel times computation failed: ${(err as Error).message}`);
  }
  stageTimes['travel-times'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 6: Travel times computed (${directionsMode} mode)`);
  onEvent?.({ type: 'step_done', step: 6, stepName: 'Computing travel times', durationMs: stageTimes['travel-times'], timestamp: Date.now() });

  // Step 7: Enrich restaurant pool (async, extracted from step8)
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 7, stepName: 'Enriching restaurant pool', timestamp: Date.now() });
  const allRestaurants = [
    ...(data.tripAdvisorRestaurants || []),
    ...(data.serpApiRestaurants || []),
  ];
  let enrichedRestaurants: Restaurant[];
  try {
    enrichedRestaurants = await enrichRestaurantPool(clusters, allRestaurants, preferences.destination);
  } catch (err) {
    console.error('[Pipeline V3] Step 7 failed:', err);
    throw new Error(`[Pipeline V3] Restaurant pool enrichment failed: ${(err as Error).message}`);
  }
  stageTimes['restaurants'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 7: Restaurant pool enriched (${enrichedRestaurants.length} restaurants)`);
  onEvent?.({ type: 'step_done', step: 7, stepName: 'Enriching restaurant pool', durationMs: stageTimes['restaurants'], timestamp: Date.now() });

  // Step 8+9+10: Unified schedule (replaces placeRestaurants + assembleV3Days + repairPass)
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 8, stepName: 'Unified scheduling', timestamp: Date.now() });
  const repairResult = unifiedScheduleV3Days(
    clusters, travelTimes, timeWindows, hotel, preferences, data,
    enrichedRestaurants, allActivities, data.destCoords
  );
  stageTimes['schedule'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 8: Unified schedule built with ${repairResult.days.length} days, ${repairResult.repairs.length} repairs`);
  onEvent?.({ type: 'step_done', step: 8, stepName: 'Unified scheduling', durationMs: stageTimes['schedule'], timestamp: Date.now() });

  // Step 10: Validate contracts
  t = Date.now();
  const startDateStr = preferences.startDate.toISOString().split('T')[0];
  const mustSeeActivitiesForContracts = selectedActivities.filter(a => a.mustSee);
  const mustSeeIds = new Set(mustSeeActivitiesForContracts.map(a => a.id));
  const contractResult = validateContracts(
    repairResult.days,
    startDateStr,
    mustSeeIds,
    data.destCoords,
    mustSeeActivitiesForContracts.map(a => ({ id: a.id, name: a.name })),
    timeWindows
  );
  stageTimes['contracts'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 10: Quality score ${contractResult.score}/100, Invariants: ${contractResult.invariantsPassed ? 'PASSED' : 'FAILED'}`);

  const contractsModeRaw = (process.env.PIPELINE_CONTRACTS_MODE || 'warn').toLowerCase();
  const contractsMode: 'strict' | 'warn' = contractsModeRaw === 'warn' ? 'warn' : 'strict';
  const unresolvedRepairViolations = repairResult.unresolvedViolations.map(v => `REPAIR: ${v}`);
  const combinedContractViolations = [...unresolvedRepairViolations, ...contractResult.violations];
  if (contractsMode === 'strict' && combinedContractViolations.length > 0) {
    const violationPreview = combinedContractViolations.slice(0, 5).join(' | ');
    throw new Error(
      `[Pipeline V3] Contract validation failed with ${combinedContractViolations.length} violation(s). ` +
      `Set PIPELINE_CONTRACTS_MODE=warn to return degraded output. ` +
      `Preview: ${violationPreview}`
    );
  }

  // Step 11: Decorate (optional)
  t = Date.now();
  const useLLMDecor = process.env.PIPELINE_LLM_DECOR === 'on';
  const decorResult = await decorateTrip(
    repairResult.days,
    preferences.destination || '',
    useLLMDecor
  );
  stageTimes['decorate'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 11: Decoration complete (LLM: ${decorResult.usedLLM})`);

  // Step 11b: Inject transport items (outbound + return) into day schedule
  if (decorResult.days.length > 0) {
    const day1 = decorResult.days[0];
    const lastDay = decorResult.days[decorResult.days.length - 1];
    const transportFallbackCoords = hotel
      ? { lat: hotel.latitude, lng: hotel.longitude }
      : data.destCoords;

    addOutboundTransportItem(day1, data.outboundFlight || null, bestTransport, preferences, transportFallbackCoords);
    addReturnTransportItem(lastDay, data.returnFlight || null, bestTransport, preferences, transportFallbackCoords);
    console.log(`[Pipeline V3] Step 11b: Transport items injected (mode: ${bestTransport?.mode || 'none'})`);

    // Post-injection safety: remove items past return flight on last day
    const returnFlightItem = lastDay.items.find(i => i.type === 'flight');
    if (returnFlightItem) {
      const flightStartMin = timeToMin(returnFlightItem.startTime || '23:59');
      const cutoffMin = flightStartMin - 150; // 2h30 before flight
      const beforeCount = lastDay.items.length;
      lastDay.items = lastDay.items.filter(item => {
        if (item.type === 'flight' || item.type === 'checkout') return true;
        const startMin = timeToMin(item.startTime || '00:00');
        if (startMin >= cutoffMin) return false;
        if (item.endTime && timeToMin(item.endTime) > cutoffMin) return false;
        return true;
      });
      if (lastDay.items.length < beforeCount) {
        lastDay.items.forEach((item, idx) => { item.orderIndex = idx; });
        console.log(`[Pipeline V3] Post-injection sweep: removed ${beforeCount - lastDay.items.length} items past departure on Day ${lastDay.dayNumber}`);
      }
    }

    // Post-injection: remove items before arrival on first activity day
    const arrivalFlightItem = day1.items.find(i => i.type === 'flight');
    if (arrivalFlightItem && arrivalFlightItem.endTime) {
      const arrivalMin = timeToMin(arrivalFlightItem.endTime);
      const activityStartMin = arrivalMin + 90; // 90min buffer after arrival
      const beforeCount2 = day1.items.length;
      day1.items = day1.items.filter(item => {
        if (item.type === 'flight') return true;
        const startMin = timeToMin(item.startTime || '00:00');
        if (startMin < activityStartMin && item.type !== 'checkin') return false;
        return true;
      });
      if (day1.items.length < beforeCount2) {
        day1.items.forEach((item, idx) => { item.orderIndex = idx; });
        console.log(`[Pipeline V3] Post-injection sweep: removed ${beforeCount2 - day1.items.length} pre-arrival items on Day ${day1.dayNumber}`);
      }
    }
  }

  // Build final Trip object
  const trip: Trip = {
    id: crypto.randomUUID?.() || `trip-${Date.now()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    preferences,
    days: decorResult.days.map((day, idx) => ({
      ...day,
      date: new Date(new Date(preferences.startDate).getTime() + idx * 86400000),
    })),
    accommodation: hotel ? {
      id: hotel.id || '',
      name: hotel.name || '',
      type: hotel.type || 'hotel',
      address: hotel.address || '',
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      rating: hotel.rating,
      reviewCount: hotel.reviewCount || 0,
      pricePerNight: hotel.pricePerNight,
      currency: hotel.currency || 'EUR',
      amenities: hotel.amenities || [],
      checkInTime: hotel.checkInTime || '15:00',
      checkOutTime: hotel.checkOutTime || '11:00',
      bookingUrl: hotel.bookingUrl,
      photos: hotel.photos,
      breakfastIncluded: hotel.breakfastIncluded,
    } : undefined,
    accommodationOptions: hotels.slice(0, 3).map((h: import('../types').Accommodation) => ({
      id: h.id || '',
      name: h.name || '',
      type: h.type || 'hotel',
      address: h.address || '',
      latitude: h.latitude,
      longitude: h.longitude,
      rating: h.rating,
      reviewCount: h.reviewCount || 0,
      pricePerNight: h.pricePerNight,
      currency: h.currency || 'EUR',
      amenities: h.amenities || [],
      checkInTime: h.checkInTime || '15:00',
      checkOutTime: h.checkOutTime || '11:00',
      bookingUrl: h.bookingUrl,
      photos: h.photos,
      breakfastIncluded: h.breakfastIncluded,
    })),
    outboundFlight: data.outboundFlight || undefined,
    returnFlight: data.returnFlight || undefined,
    transportOptions: data.transportOptions || [],
    attractionPool: allActivities,
    budgetStrategy: data.budgetStrategy,
  };

  // V3 pipeline metadata (fields are typed on Trip)
  trip.pipelineVersion = 'v3';
  trip.stageDurationsMs = stageTimes;
  trip.qualityMetrics = {
    score: contractResult.score,
    invariantsPassed: contractResult.invariantsPassed,
    violations: combinedContractViolations,
  };
  trip.qualityWarnings = [
    ...contractResult.qualityWarnings,
    ...repairResult.unresolvedViolations.map(v => `Repair unresolved: ${v}`),
  ];
  trip.contractViolations = combinedContractViolations;

  const totalTime = Date.now() - startTime;
  console.log(`[Pipeline V3] Trip generated in ${totalTime}ms`);
  console.log(`  Stage times: ${Object.entries(stageTimes).map(([k, v]) => `${k}=${v}ms`).join(', ')}`);
  console.log(`  Quality: ${contractResult.score}/100, Invariants: ${contractResult.invariantsPassed ? 'PASSED' : 'FAILED'}`);

  onEvent?.({ type: 'info', label: 'complete', detail: 'Trip generation complete!', timestamp: Date.now() });

  return trip;
}

/**
 * Multi-city trip generation.
 * Runs V3 independently for each city segment, then connects them.
 */
export async function generateTripV3MultiCity(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const cityPlan = preferences.cityPlan;
  if (!cityPlan || cityPlan.length <= 1) {
    return generateTripV3(preferences, onEvent);
  }

  console.log(`[Pipeline V3] Multi-city trip: ${cityPlan.map(c => `${c.city} (${c.days}d)`).join(' → ')}`);

  const segments: Trip[] = [];
  const currentDate = new Date(preferences.startDate || new Date());

  for (let i = 0; i < cityPlan.length; i++) {
    const city = cityPlan[i];

    const cityPrefs: TripPreferences = {
      ...preferences,
      destination: city.city,
      durationDays: city.days,
      startDate: new Date(currentDate),
    };

    onEvent?.({
      type: 'info',
      label: 'multi-city',
      detail: `Planning ${city.city} (${city.days} days)...`,
      timestamp: Date.now(),
    });

    const segment = await generateTripV3(cityPrefs, onEvent);
    segments.push(segment);

    // Advance date
    currentDate.setDate(currentDate.getDate() + city.days);
  }

  // Merge segments into one trip
  const mergedDays: import('../types/trip').TripDay[] = [];
  let dayOffset = 0;

  for (const segment of segments) {
    for (const day of segment.days) {
      mergedDays.push({
        ...day,
        dayNumber: day.dayNumber + dayOffset,
        items: day.items.map(item => ({
          ...item,
          dayNumber: item.dayNumber + dayOffset,
        })),
      });
    }
    dayOffset += segment.days.length;
  }

  // Build merged Trip
  const mergedTrip: Trip = {
    ...segments[0], // Base from first segment
    days: mergedDays,
    preferences: {
      ...preferences,
      durationDays: preferences.durationDays,
      destination: cityPlan.map(c => c.city).join(' → '),
    },
  };

  // Merge quality metrics (fields are typed on Trip)
  mergedTrip.pipelineVersion = 'v3-multi';
  mergedTrip.qualityMetrics = {
    score: Math.round(segments.reduce((s, seg) => s + (seg.qualityMetrics?.score || 0), 0) / segments.length),
    invariantsPassed: segments.every(s => s.qualityMetrics?.invariantsPassed ?? true),
    violations: segments.flatMap(s => s.qualityMetrics?.violations || []),
  };

  return mergedTrip;
}

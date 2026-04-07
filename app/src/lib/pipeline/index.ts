/**
 * Pipeline V3 — Main Orchestrator
 *
 * Deterministic 12-step pipeline for trip generation.
 * V2 (algorithmic + LLM) code paths have been removed.
 *
 * Steps:
 *   1. fetchAllData()             — Parallel API calls
 *   2. scoreAndSelectActivities() — Score, dedup, select top N
 *   3. clusterActivities()        — Geographic clustering per day
 *   4. selectTopHotelsByBarycenter() — Hotel near activity centroid
 *   5. anchorTransport()          — Compute time windows from flights/transport
 *   6. computeTravelTimes()       — Selective Directions API calls
 *   7. enrichRestaurantPool()     — Restaurant pool enrichment
 *   8+9+10. unifiedScheduleV3Days() — Unified scheduler
 *   11. validateContracts()       — Quality scoring and contract validation
 *   12. decorateTrip()            — Optional LLM decoration
 */

import type { Trip, TripPreferences, TransportOptionSummary, Restaurant, Accommodation } from '../types';
import type { PipelineQuestion } from '../types/pipelineQuestions';
import type {
  ActivityCluster,
  FetchedData,
  OnPipelineEvent,
  PipelineMapSnapshot,
  ScoredActivity,
  DayTripPack,
  CityDensityProfile,
} from './types';
import type { DayTimeWindow } from './step4-anchor-transport';
export type { PipelineEvent, OnPipelineEvent, FetchedData, PipelineMapSnapshot } from './types';

// ---------------------------------------------------------------------------
// AskUser — pause/resume callback for pipeline smart questions
// ---------------------------------------------------------------------------
export type AskUserFn = (question: Omit<PipelineQuestion, 'sessionId'>) => Promise<string>;

export interface GenerateTripV2Options {
  askUser?: AskUserFn;
  onSnapshot?: (snapshot: PipelineMapSnapshot) => void;
}
import { fetchAllData } from './step1-fetch';
import { scoreAndSelectActivities } from './step2-score';
import { batchFetchWikipediaSummaries, getWikiLanguageForDestination } from '../services/wikipedia';
import { clusterActivities, computeCityDensityProfile } from './step3-cluster';
import { selectTieredHotels, selectTopHotelsByBarycenter } from './step5-hotel';
import { calculateDistance } from '../services/geocoding';
import { addOutboundTransportItem, addReturnTransportItem } from './utils/transport-items';
import { isAppropriateForMeal, isBreakfastSpecialized, getCuisineFamily } from './step4-restaurants';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';
import { anchorTransport } from './step4-anchor-transport';
import { timeToMin, minToTime } from './utils/time';
import { computeTravelTimes } from './step7b-travel-times';
import { enrichRestaurantPool } from './step8-place-restaurants';
import { unifiedScheduleV3Days } from './step8910-unified-schedule';
import { validateContracts } from './step11-contracts';
import { geoReorderScheduledDay } from './utils/geo-reorder';
import { decorateTrip } from './step12-decorate';
import { llmReviewTrip, applyLLMCorrections } from './step13-llm-review';
import { getDestinationIntel, resolveDestination, type DestinationIntel } from './step0-destination-intel';
import { applyTrustLayer } from './trust-layer';
import { buildDayTripPacks } from './day-trip-pack';
import { optimizeClusterRouting } from './intra-day-router';
import { stripPlanningMetaFromDays } from './planning-meta';
import { rebalanceClustersWithLLM, type LLMRebalanceResult } from './step3b-llm-rebalance';
import { detectQuestions, applyQuestionAnswers, detectPreFetchQuestions, applyEffects } from './questionDetectors';
import type { DestinationAnalysis } from './step0-destination-intel';
import { buildClusteredMapSnapshot, buildFetchedMapSnapshot } from './snapshots';

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

type ArrivalFatigueRole = 'standard' | 'long_haul';

function inferArrivalFatigueRole(
  outboundFlight: { duration?: number; stops?: number } | null,
  timeWindows: Array<{ dayNumber: number; activityStartTime: string }>
): ArrivalFatigueRole {
  const day1 = timeWindows.find((window) => window.dayNumber === 1);
  const lateArrival = day1 ? timeToMin(day1.activityStartTime) >= 14 * 60 : false;
  if ((outboundFlight?.duration || 0) >= 8 * 60) return 'long_haul';
  if ((outboundFlight?.stops || 0) >= 2) return 'long_haul';
  if (lateArrival) return 'long_haul';
  return 'standard';
}

function normalizePlannerText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferPoiFamilyFromItem(item: { title?: string; description?: string; type?: string }): string {
  const text = normalizePlannerText(`${item.title || ''} ${item.description || ''} ${item.type || ''}`);
  if (/basilica|basilique|church|eglise|église|cathedral|cathedrale|cathédrale/.test(text)) return 'church_basilica';
  if (/column|colonne|memorial|monument a|monument à/.test(text)) return 'column_memorial';
  if (/(^| )park( |$)|parc|garden|jardin/.test(text)) return 'generic_park';
  if (/piazza|square|place /.test(text)) return 'generic_square';
  return 'other';
}

function resolveItemHoursForDate(item: any, dayDate: Date): { open: string; close: string } | null | undefined {
  const dayKey = dayDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const byDay = item.openingHoursByDay?.[dayKey];
  if (byDay === null) return null;
  if (byDay?.open && byDay?.close) return { open: byDay.open, close: byDay.close };
  if (item.openingHours?.open && item.openingHours?.close) return { open: item.openingHours.open, close: item.openingHours.close };
  return undefined;
}

function pruneTemporalImpossibleItems(days: any[], startDate: Date): number {
  let removed = 0;
  for (const day of days) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + day.dayNumber - 1);
    const before = day.items.length;
    day.items = day.items.filter((item: any) => {
      if (item.type !== 'activity') return true;
      const hours = resolveItemHoursForDate(item, dayDate);
      if (hours === null) return false;
      if (!hours) return true;
      const openMin = timeToMin(hours.open);
      const closeMin = hours.close === '00:00' && hours.open !== '00:00' ? 24 * 60 : timeToMin(hours.close);
      const startMin = timeToMin(item.startTime || '00:00');
      const endMin = timeToMin(item.endTime || item.startTime || '00:00');
      return startMin >= openMin && endMin <= closeMin;
    });
    if (day.items.length !== before) {
      day.items.forEach((item: any, index: number) => { item.orderIndex = index; });
      removed += before - day.items.length;
    }
  }
  return removed;
}

function countSparseFullCityDays(
  days: any[],
  dayRoles: Array<{ dayNumber: number; role: string }> = []
): number {
  const roleByDay = new Map(dayRoles.map((slot) => [slot.dayNumber, slot.role]));
  return days.filter((day) => {
    const role =
      roleByDay.get(day.dayNumber)
      || day.items?.find((item: any) => item.planningMeta?.plannerRole)?.planningMeta?.plannerRole
      || (day.isDayTrip ? 'day_trip' : 'full_city');
    if (role !== 'full_city') return false;
    return day.items.filter((item: any) => item.type === 'activity').length <= 1;
  }).length;
}

function countSameFamilyOverload(
  days: any[],
  dayRoles: Array<{ dayNumber: number; role: string }> = []
): number {
  const roleByDay = new Map(dayRoles.map((slot) => [slot.dayNumber, slot.role]));
  let overload = 0;
  for (const day of days) {
    const role =
      roleByDay.get(day.dayNumber)
      || day.items?.find((item: any) => item.planningMeta?.plannerRole)?.planningMeta?.plannerRole
      || (day.isDayTrip ? 'day_trip' : 'full_city');
    if (role !== 'full_city') continue;
    const counts = new Map<string, number>();
    for (const item of day.items || []) {
      if (item.type !== 'activity') continue;
      const family = inferPoiFamilyFromItem(item);
      if (family === 'other') continue;
      counts.set(family, (counts.get(family) || 0) + 1);
    }
    for (const [family, count] of counts) {
      if ((family === 'church_basilica' || family === 'column_memorial' || family === 'generic_park' || family === 'generic_square') && count > 1) {
        overload += count - 1;
      }
    }
  }
  return overload;
}

function countArrivalFatigueViolations(
  days: any[],
  hotel: { latitude: number; longitude: number } | null,
  arrivalFatigueRole: ArrivalFatigueRole
): number {
  if (arrivalFatigueRole !== 'long_haul' || days.length === 0) return 0;
  const anchor = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;
  let violations = 0;
  for (const item of days[0].items || []) {
    if (item.type !== 'activity') continue;
    const text = normalizePlannerText(`${item.title || ''} ${item.description || ''}`);
    if (/disney|theme park|amusement|water park|universal/.test(text)) {
      violations++;
      continue;
    }
    if ((item.duration || 0) > 60) {
      violations++;
      continue;
    }
    if (anchor && calculateDistance(item.latitude, item.longitude, anchor.lat, anchor.lng) > 2) {
      violations++;
    }
  }
  return violations;
}

/**
 * Generate a trip — routes to V3 single-city or multi-city.
 */
export async function generateTripV2(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  v2Options?: GenerateTripV2Options,
): Promise<Trip> {
  let regionAnalysis: DestinationAnalysis | null = null;

  // Step 0a: Region resolver — classify destination, resolve regions to cities
  if (!preferences.cityPlan && preferences.travelStyle !== 'single_base') {
    try {
      regionAnalysis = await resolveDestination(preferences);
      if (regionAnalysis) {
        if (regionAnalysis.inputType !== 'city' && regionAnalysis.resolvedCities.length > 1) {
          preferences.cityPlan = regionAnalysis.resolvedCities.map(c => ({
            city: c.name,
            days: c.stayDuration,
          }));
          console.log(`[Pipeline] Region resolved to cityPlan: ${preferences.cityPlan.map(c => `${c.city} (${c.days}j)`).join(', ')}`);
        } else if (regionAnalysis.resolvedCities.length === 1) {
          preferences.destination = regionAnalysis.resolvedCities[0].name;
          console.log(`[Pipeline] Destination resolved to: ${preferences.destination}`);
        }
      }
    } catch (e) {
      console.warn('[Pipeline] Region resolver failed, continuing with original destination:', e);
    }
  }

  // Step 0b: Pre-fetch LLM questions — contextual questions before the main pipeline
  let cachedIntel: DestinationIntel | null = null;
  if (v2Options?.askUser) {
    try {
      cachedIntel = await getDestinationIntel(preferences.destination, preferences);
      const preFetchQuestions = await detectPreFetchQuestions(preferences, regionAnalysis, cachedIntel);

      for (const q of preFetchQuestions) {
        emit(onEvent, { type: 'info', label: 'question', detail: q.title });
        const selectedOptionId = await v2Options.askUser(q as any);
        const selectedOption = q.options.find(o => o.id === selectedOptionId);
        if (selectedOption?.effect) {
          applyEffects(
            [{ questionId: q.questionId, selectedOptionId, effect: selectedOption.effect }],
            preferences,
          );
        }
      }

      // Si une question a changé le travelStyle, re-vérifier le routage
      if (preferences.travelStyle === 'road_trip' && !preferences.cityPlan && regionAnalysis?.resolvedCities) {
        preferences.cityPlan = regionAnalysis.resolvedCities.map(c => ({
          city: c.name,
          days: c.stayDuration,
        }));
      } else if (preferences.travelStyle === 'single_base' && preferences.cityPlan) {
        preferences.destination = preferences.cityPlan[0].city;
        preferences.cityPlan = undefined;
      }
    } catch (e) {
      console.warn('[Pipeline] Pre-fetch questions failed, continuing:', e);
    }
  }

  if (preferences.cityPlan && preferences.cityPlan.length > 1) {
    return generateTripV3MultiCity(preferences, onEvent, v2Options);
  }
  return generateTripV3(
    preferences,
    onEvent,
    { onSnapshot: v2Options?.onSnapshot, cachedIntel },
    v2Options?.askUser,
  );
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
export interface GenerateTripV3Options {
  /** Pre-loaded fixture data — skips step 1 fetch when provided */
  fixtureData?: FetchedData;
  /** Callback to capture FetchedData after step 1 (for fixture recording) */
  onFetchedData?: (data: FetchedData) => void;
  /** Lightweight cartographic snapshot for streaming clients */
  onSnapshot?: (snapshot: PipelineMapSnapshot) => void;
  /** Pre-fetched destination intel — avoids double LLM call when already resolved in generateTripV2 */
  cachedIntel?: DestinationIntel | null;
}

export async function generateTripV3(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  options?: GenerateTripV3Options,
  askUser?: AskUserFn,
): Promise<Trip> {
  const startTime = Date.now();
  const stageTimes: Record<string, number> = {};

  // Step 1: Fetch all data (or use fixture)
  let t = Date.now();
  let data: FetchedData;
  if (options?.fixtureData) {
    data = options.fixtureData;
    stageTimes['fetch'] = 0;
    console.log('[Pipeline V3] Step 1: Using fixture data (no API calls)');
    onEvent?.({ type: 'step_done', step: 1, stepName: 'Fetching data (fixture)', durationMs: 0, timestamp: Date.now() });
  } else {
    // Step 0: Destination Intelligence — use cached if available (from generateTripV2 pre-fetch)
    let destinationIntel: DestinationIntel | null = options?.cachedIntel !== undefined ? options.cachedIntel : null;
    if (!destinationIntel) {
      try {
        destinationIntel = await getDestinationIntel(preferences.destination, preferences);
      } catch (e) {
        console.warn('[Pipeline V3] Step 0 failed (non-blocking):', e);
      }
    } else {
      console.log('[Pipeline V3] Step 0: Using cached destination intel');
    }
    if (destinationIntel) {
      onEvent?.({ type: 'step_done', step: 0, stepName: 'Destination intelligence', durationMs: 0, timestamp: Date.now() } as any);
    }

    onEvent?.({ type: 'step_start', step: 1, stepName: 'Fetching data', timestamp: Date.now() });
    try {
      data = await fetchAllData(preferences, onEvent, destinationIntel);
    } catch (err) {
      console.error('[Pipeline V3] Step 1 failed:', err);
      throw new Error(`[Pipeline V3] Data fetch failed: ${(err as Error).message}`);
    }
    stageTimes['fetch'] = Date.now() - t;
    onEvent?.({ type: 'step_done', step: 1, stepName: 'Fetching data', durationMs: stageTimes['fetch'], timestamp: Date.now() });
  }

  // Notify caller with FetchedData (for fixture capture)
  options?.onFetchedData?.(data);
  options?.onSnapshot?.(buildFetchedMapSnapshot(data));

  // Step 2: Score and rank activities
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 2, stepName: 'Scoring activities', timestamp: Date.now() });
  const selectedActivities = scoreAndSelectActivities(data, preferences);
  const allActivities = selectedActivities; // For repair pass
  stageTimes['score'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 2: ${selectedActivities.length} activities selected`);
  onEvent?.({ type: 'step_done', step: 2, stepName: 'Scoring activities', durationMs: stageTimes['score'], timestamp: Date.now() });

  // Step 2a: Trust layer — enrich activities with confidence metadata (internal, no prod impact)
  applyTrustLayer(selectedActivities, data, data.destCoords);

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

  // Step 2c: Smart Questions — ask user between step 2 and clustering
  if (askUser) {
    const questions = detectQuestions(selectedActivities, data.dayTripSuggestions, preferences);
    const answers: Array<{ questionId: string; selectedOptionId: string }> = [];

    for (const q of questions) {
      emit(onEvent, { type: 'info', label: 'question', detail: q.title });
      const selectedOptionId = await askUser(q);
      answers.push({ questionId: q.questionId, selectedOptionId });
    }

    if (answers.length > 0) {
      applyQuestionAnswers(answers, selectedActivities, data);
      console.log(`[Pipeline V3] Smart Questions: ${answers.length} answered`);
    }
  }

  // Step 2d: Resolve transport BEFORE anchoring time windows
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

  // Step 2d: Build DayTripPacks (robust day trip validation + transport resolution)
  const { packs: dayTripPacks, cityActivities: activitiesAfterDayTrips, destinationMismatchCount } = buildDayTripPacks(
    selectedActivities, data, data.destCoords, preferences.durationDays
  );
  const arrivalFatigueRole = inferArrivalFatigueRole(data.outboundFlight, timeWindows);

  // Step 3: Cluster by day (hierarchical clustering)
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 3, stepName: 'Clustering', timestamp: Date.now() });
  const densityProfile = computeCityDensityProfile(activitiesAfterDayTrips, preferences.durationDays);

  const PACE_FACTOR: Record<string, number> = {
    relaxed: 0.65,
    moderate: 1.0,
    intensive: 1.3,
  };
  const paceFactor = PACE_FACTOR[preferences.pace || 'moderate'] || 1.0;

  const clusters: ActivityCluster[] = clusterActivities(
    activitiesAfterDayTrips,
    Math.max(1, preferences.durationDays - dayTripPacks.length),
    data.destCoords,
    densityProfile,
    preferences.startDate.toISOString().split('T')[0],
    timeWindows,
    paceFactor,
    {
      dayTripActivities: data.dayTripActivities,
      dayTripSuggestions: data.dayTripSuggestions,
    }
  );

  // Inject DayTripPack clusters (atomic, protected)
  for (const pack of dayTripPacks) {
    clusters.push({
      dayNumber: clusters.length + 1,
      activities: pack.activities,
      centroid: {
        lat: pack.activities.reduce((s, a) => s + a.latitude, 0) / pack.activities.length,
        lng: pack.activities.reduce((s, a) => s + a.longitude, 0) / pack.activities.length,
      },
      totalIntraDistance: 0,
      isFullDay: true,
      isDayTrip: true,
      dayTripDestination: pack.destination,
    });
  }

  // Re-number all clusters
  clusters.forEach((c, i) => { c.dayNumber = i + 1; });

  stageTimes['cluster'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 3: ${clusters.length} clusters created (${dayTripPacks.length} day trip packs)`);
  onEvent?.({ type: 'step_done', step: 3, stepName: 'Clustering', durationMs: stageTimes['cluster'], timestamp: Date.now() });

  const previewHotels = selectTopHotelsByBarycenter(
    clusters,
    data.bookingHotels || [],
    preferences.budgetLevel || 'medium',
    undefined,
    preferences.durationDays,
    { destination: preferences.destination },
    3,
  );
  options?.onSnapshot?.(buildClusteredMapSnapshot(clusters, previewHotels[0] || null, data));

  // Step 3b: LLM rebalance attempt
  const llmResult = await rebalanceClustersWithLLM(
    clusters, timeWindows, preferences, densityProfile
  );

  const pipelineCtx = {
    data, preferences, timeWindows, bestTransport, syntheticReturnTransport,
    allActivities, selectedActivities,
    densityProfile: { densityCategory: densityProfile.densityCategory },
    dayTripPacks, arrivalFatigueRole, destinationMismatchCount,
  };

  let trip: Trip;

  if (llmResult) {
    // Run both paths in parallel (no onEvent in helpers to avoid double-emitting)
    const [tripAlgo, tripLLM] = await Promise.all([
      runPipelineFromClusters(structuredClone(clusters), pipelineCtx),
      runPipelineFromClusters(llmResult.clusters, pipelineCtx),
    ]);

    const scoreAlgo = tripAlgo.qualityMetrics?.score ?? 0;
    const scoreLLM = tripLLM.qualityMetrics?.score ?? 0;
    console.log(`[Pipeline V3] A/B fork: algo=${scoreAlgo}/100 vs llm=${scoreLLM}/100`);

    if (scoreLLM > scoreAlgo) {
      trip = tripLLM;
      if (trip.plannerDiagnostics) {
        trip.plannerDiagnostics.llmRebalanceUsed = true;
        trip.plannerDiagnostics.llmRebalanceScore = scoreLLM;
        trip.plannerDiagnostics.algoScore = scoreAlgo;
        trip.plannerDiagnostics.llmRebalanceThemes = llmResult.themes;
        trip.plannerDiagnostics.llmRebalanceLatencyMs = llmResult.latencyMs;
      }
    } else {
      trip = tripAlgo;
      if (trip.plannerDiagnostics) {
        trip.plannerDiagnostics.llmRebalanceUsed = false;
        trip.plannerDiagnostics.llmRebalanceScore = scoreLLM;
        trip.plannerDiagnostics.algoScore = scoreAlgo;
        trip.plannerDiagnostics.llmRebalanceLatencyMs = llmResult.latencyMs;
      }
    }
  } else {
    // LLM failed, algo only
    trip = await runPipelineFromClusters(clusters, pipelineCtx);
    if (trip.plannerDiagnostics) {
      trip.plannerDiagnostics.llmRebalanceUsed = false;
      trip.plannerDiagnostics.llmRebalanceScore = null;
      trip.plannerDiagnostics.algoScore = trip.qualityMetrics?.score ?? 0;
      trip.plannerDiagnostics.llmRebalanceLatencyMs = 0;
    }
  }

  // Timing and cost logging
  const totalTime = Date.now() - startTime;
  const { getApiCostSummary } = await import('../services/apiCostGuard');
  const costSummary = getApiCostSummary();
  console.log(`[Pipeline V3] Trip generated in ${totalTime}ms`);
  console.log(`  Quality: ${trip.qualityMetrics?.score}/100`);
  console.log(`  LLM rebalance: ${trip.plannerDiagnostics?.llmRebalanceUsed ? 'WON' : 'algo won'}`);
  console.log(`  API cost: €${costSummary.totalEur.toFixed(2)} / €${costSummary.budget.toFixed(2)}`);

  onEvent?.({ type: 'info', label: 'complete', detail: 'Trip generation complete!', timestamp: Date.now() });

  return trip;
}

// ---------------------------------------------------------------------------
// runPipelineFromClusters — shared helper for A/B fork
// Runs step 3b (routing) through step 11 (decoration) and returns a Trip.
// ---------------------------------------------------------------------------

async function runPipelineFromClusters(
  clusters: ActivityCluster[],
  ctx: {
    data: FetchedData;
    preferences: TripPreferences;
    timeWindows: DayTimeWindow[];
    bestTransport: TransportOptionSummary | null;
    syntheticReturnTransport: TransportOptionSummary | null;
    allActivities: ScoredActivity[];
    selectedActivities: ScoredActivity[];
    densityProfile: { densityCategory: string };
    dayTripPacks: DayTripPack[];
    arrivalFatigueRole: ArrivalFatigueRole;
    destinationMismatchCount: number;
    onEvent?: OnPipelineEvent;
  }
): Promise<Trip> {
  const {
    data, preferences, timeWindows, bestTransport, syntheticReturnTransport,
    allActivities, selectedActivities, densityProfile, dayTripPacks,
    arrivalFatigueRole, destinationMismatchCount, onEvent,
  } = ctx;

  // Step 3b: Optimize intra-day routing (weighted NN + 2-opt)
  optimizeClusterRouting(clusters);

  // Step 4: Select hotel (3 tiers) — per-path since clusters differ
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
  console.log(`[Pipeline V3] Step 4: Hotel selected: ${hotel?.name || 'none'}`);

  // Step 6: Compute travel times (selective Directions API)
  const directionsMode = (process.env.PIPELINE_DIRECTIONS_MODE || 'selective') as 'selective' | 'all' | 'off';
  let travelTimes: Awaited<ReturnType<typeof computeTravelTimes>>;
  try {
    travelTimes = await computeTravelTimes(clusters, hotelCoords, directionsMode, preferences.startDate);
  } catch (err) {
    console.error('[Pipeline V3] Step 6 failed:', err);
    throw new Error(`[Pipeline V3] Travel times computation failed: ${(err as Error).message}`);
  }
  console.log(`[Pipeline V3] Step 6: Travel times computed (${directionsMode} mode)`);

  // Step 7: Enrich restaurant pool
  const allRestaurants = [
    ...(data.tripAdvisorRestaurants || []),
    ...(data.serpApiRestaurants || []),
  ];
  let enrichedRestaurants: Restaurant[];
  try {
    enrichedRestaurants = await enrichRestaurantPool(clusters, allRestaurants, preferences.destination, densityProfile.densityCategory as 'spread' | 'medium' | 'dense');
  } catch (err) {
    console.error('[Pipeline V3] Step 7 failed:', err);
    throw new Error(`[Pipeline V3] Restaurant pool enrichment failed: ${(err as Error).message}`);
  }
  console.log(`[Pipeline V3] Step 7: Restaurant pool enriched (${enrichedRestaurants.length} restaurants)`);

  // Budget-aware restaurant filtering: prefer restaurants within budget, fall back to all
  const maxPriceLevel = preferences.budgetLevel === 'economic' ? 2
    : preferences.budgetLevel === 'moderate' ? 3
    : 4; // comfort + luxury = all price levels
  let budgetFilteredRestaurants = enrichedRestaurants.filter(r => {
    if (!r.priceLevel) return true; // Keep restaurants without price data
    return r.priceLevel <= maxPriceLevel;
  });
  // Soft filter: if too few candidates after filtering, fall back to full pool
  const MIN_RESTAURANTS_FOR_SCHEDULER = 10;
  if (budgetFilteredRestaurants.length < MIN_RESTAURANTS_FOR_SCHEDULER) {
    console.log(`[Pipeline V3] Budget filter too aggressive (${budgetFilteredRestaurants.length} < ${MIN_RESTAURANTS_FOR_SCHEDULER}), using full pool`);
    budgetFilteredRestaurants = enrichedRestaurants;
  } else if (budgetFilteredRestaurants.length < enrichedRestaurants.length) {
    console.log(`[Pipeline V3] Budget filter: ${enrichedRestaurants.length} → ${budgetFilteredRestaurants.length} restaurants (max price level: ${maxPriceLevel})`);
  }

  // Step 8+9+10: Unified schedule
  const repairResult = unifiedScheduleV3Days(
    clusters,
    travelTimes,
    timeWindows,
    hotel,
    preferences,
    data,
    budgetFilteredRestaurants,
    allActivities,
    data.destCoords,
    { densityCategory: densityProfile.densityCategory as 'spread' | 'medium' | 'dense' },
  );
  console.log(`[Pipeline V3] Step 8: Unified schedule built with ${repairResult.days.length} days, ${repairResult.repairs.length} repairs`);

  const scheduledDays = repairResult.days;

  // Step 11b: Inject transport items (outbound + return) into day schedule
  if (scheduledDays.length > 0) {
    const day1 = scheduledDays[0];
    const lastDay = scheduledDays[scheduledDays.length - 1];
    const transportFallbackCoords = hotel
      ? { lat: hotel.latitude, lng: hotel.longitude }
      : data.destCoords;

    addOutboundTransportItem(day1, data.outboundFlight || null, bestTransport, preferences, transportFallbackCoords);
    addReturnTransportItem(lastDay, data.returnFlight || null, bestTransport, preferences, transportFallbackCoords);
    console.log(`[Pipeline V3] Step 11b: Transport items injected (mode: ${bestTransport?.mode || 'none'})`);

    // Post-injection safety: remove items past return transport on last day
    const returnFlightItem = lastDay.items.find(i =>
      i.type === 'flight' || (i.type === 'transport' && (i as any).transportDirection === 'return')
    );
    if (returnFlightItem) {
      const flightStartMin = timeToMin(returnFlightItem.startTime || '23:59');
      const isFlight = returnFlightItem.type === 'flight';
      const cutoffMin = flightStartMin - (isFlight ? 150 : 60); // 2h30 before flight, 1h before train/bus
      const beforeCount = lastDay.items.length;
      lastDay.items = lastDay.items.filter(item => {
        if (item.type === 'flight' || item.type === 'checkout') return true;
        if (item.type === 'transport' && (item as any).transportRole === 'longhaul') return true;
        const startMin = timeToMin(item.startTime || '00:00');
        if (startMin >= cutoffMin) {
          // Must-sees past departure cutoff are physically impossible — drop them
          console.warn(`[Pipeline V3] Post-injection sweep: removing "${item.title}" on Day ${lastDay.dayNumber} (starts at/after departure cutoff)`);
          return false;
        }
        if (item.endTime && timeToMin(item.endTime) > cutoffMin) {
          console.warn(`[Pipeline V3] Post-injection sweep: removing "${item.title}" on Day ${lastDay.dayNumber} (ends past departure cutoff)`);
          return false;
        }
        return true;
      });
      if (lastDay.items.length < beforeCount) {
        lastDay.items.forEach((item, idx) => { item.orderIndex = idx; });
        console.log(`[Pipeline V3] Post-injection sweep: removed ${beforeCount - lastDay.items.length} items past departure on Day ${lastDay.dayNumber}`);
      }
    }

    // Post-injection: remove items before arrival on first activity day
    const arrivalFlightItem = day1.items.find(i =>
      i.type === 'flight' || (i.type === 'transport' && (i as any).transportDirection === 'outbound')
    );
    if (arrivalFlightItem && arrivalFlightItem.endTime) {
      const arrivalMin = timeToMin(arrivalFlightItem.endTime);
      const activityStartMin = arrivalMin + 90; // 90min buffer after arrival
      const beforeCount2 = day1.items.length;
      day1.items = day1.items.filter(item => {
        if (item.type === 'flight') return true;
        if (item.type === 'transport' && (item as any).transportRole === 'longhaul') return true;
        const startMin = timeToMin(item.startTime || '00:00');
        if (startMin < activityStartMin) {
          // Reschedule checkin to after arrival instead of dropping it
          if (item.type === 'checkin') {
            item.startTime = minToTime(activityStartMin);
            item.endTime = minToTime(activityStartMin + 15);
            return true;
          }
          // Must-sees before arrival flight are physically impossible — drop them.
          // They'll be rescheduled to a valid day by ensureMustSees on next run.
          console.warn(`[Pipeline V3] Post-injection sweep: removing "${item.title}" on Day ${day1.dayNumber} (before arrival)`);
          return false;
        }
        return true;
      });
      if (day1.items.length < beforeCount2) {
        day1.items.forEach((item, idx) => { item.orderIndex = idx; });
        console.log(`[Pipeline V3] Post-injection sweep: removed ${beforeCount2 - day1.items.length} pre-arrival items on Day ${day1.dayNumber}`);
      }
    }
  }

  // Step 13: LLM Review (safety net) — Gemini 3 Flash reviews for logical errors
  if (process.env.PIPELINE_LLM_REVIEW === 'on') {
    try {
      const review = await llmReviewTrip(scheduledDays, preferences, timeWindows);
      if (review.corrections.length > 0) {
        const { applied, warnings } = applyLLMCorrections(scheduledDays, review.corrections);
        console.log(`[Pipeline V3] Step 13: LLM review — ${applied} fixes applied, ${warnings.length} warnings (confidence: ${review.confidence})`);
        onEvent?.({ step: 'llm-review', message: `${applied} fixes, ${warnings.length} warnings`, data: { applied, warnings } } as any);
      } else {
        console.log(`[Pipeline V3] Step 13: LLM review passed — no issues (confidence: ${review.confidence})`);
      }
    } catch (e) {
      console.warn('[Pipeline V3] Step 13: LLM review failed (non-blocking):', e);
    }
  }

  // Step 10b: Post-scheduler geographic reorder (reduce zigzag)
  // Swap activity time slots to minimize total travel distance per day
  {
    for (const day of scheduledDays) {
      const actCount = day.items.filter((i) => i.type === 'activity').length;
      if (actCount > 2) {
        // Pass departure end time so geo-reorder won't push activities past flight
        const tw = timeWindows.find(w => w.dayNumber === day.dayNumber);
        const depEnd = tw?.hasDepartureTransport ? tw.activityEndTime : undefined;
        day.items = geoReorderScheduledDay(
          day.items,
          hotel?.latitude,
          hotel?.longitude,
          depEnd,
        );
        // Re-assign orderIndex after reorder
        day.items.forEach((item, idx) => { item.orderIndex = idx; });
      }
    }
  }

  // Diagnostics computation
  const normalizePlannerName = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();

  const finalActivities = scheduledDays
    .flatMap((day) => day.items)
    .filter((item) => item.type === 'activity');
  const finalActivityIds = new Set(finalActivities.map((item) => item.id));
  const finalActivityNames = new Set(finalActivities.map((item) => normalizePlannerName(item.title || item.locationName || '')));
  const selectedProtectedMustSees = selectedActivities.filter(
    (activity) => activity.mustSee || activity.protectedReason === 'user_forced'
  );
  const missingProtectedMustSeeCount = selectedProtectedMustSees.filter((activity) => {
    const id = activity.id || activity.name;
    if (finalActivityIds.has(id)) return false;
    const normalizedName = normalizePlannerName(activity.name);
    return normalizedName.length === 0 || !finalActivityNames.has(normalizedName);
  }).length;

  const packDays = new Map<string, Set<number>>();
  let dayTripAtomicityBreakCount = 0;
  for (const day of scheduledDays) {
    const dayPackIds = new Set(
      day.items
        .map((item) => item.planningMeta?.sourcePackId)
        .filter((packId): packId is string => Boolean(packId))
    );

    for (const packId of dayPackIds) {
      if (!packDays.has(packId)) packDays.set(packId, new Set<number>());
      packDays.get(packId)!.add(day.dayNumber);
    }

    const isPlannerDayTrip = day.items.some((item) => item.planningMeta?.plannerRole === 'day_trip') || day.isDayTrip;
    if (!isPlannerDayTrip) continue;

    const contaminationCount = day.items.filter((item) =>
      item.type === 'activity' && !item.planningMeta?.sourcePackId
    ).length;
    dayTripAtomicityBreakCount += contaminationCount;
    if (dayPackIds.size === 0) dayTripAtomicityBreakCount++;
    if (dayPackIds.size > 1) dayTripAtomicityBreakCount += dayPackIds.size - 1;
  }
  for (const dayNumbers of packDays.values()) {
    if (dayNumbers.size > 1) dayTripAtomicityBreakCount += dayNumbers.size - 1;
  }
  const dayTripDestinationMismatchCount = destinationMismatchCount + scheduledDays.reduce((sum, day) => {
    const isPlannerDayTrip = day.items.some((item) => item.planningMeta?.plannerRole === 'day_trip') || day.isDayTrip;
    if (!isPlannerDayTrip) return sum;
    return sum + day.items.filter((item) => item.type === 'activity' && !item.planningMeta?.sourcePackId).length;
  }, 0);
  const sparseFullCityDayCount = countSparseFullCityDays(scheduledDays);
  const sameFamilyOverloadCount = countSameFamilyOverload(scheduledDays);
  const arrivalFatigueViolationCount = countArrivalFatigueViolations(scheduledDays, hotel, arrivalFatigueRole);
  const temporalImpossibleItemCount = repairResult.rescueDiagnostics?.temporalImpossibleItemCount ?? 0;

  // Step 10: Validate contracts
  const startDateStr = preferences.startDate.toISOString().split('T')[0];
  const mustSeeActivitiesForContracts = selectedActivities.filter(a => a.mustSee);
  const mustSeeIds = new Set(mustSeeActivitiesForContracts.map(a => a.id));
  const contractResult = validateContracts(
    scheduledDays,
    startDateStr,
    mustSeeIds,
    data.destCoords,
    mustSeeActivitiesForContracts.map(a => ({ id: a.id, name: a.name })),
    timeWindows,
    densityProfile.densityCategory as 'dense' | 'medium' | 'spread',
  );
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

  // Step 11: Decorate (optional, after final schedule stabilization)
  const useLLMDecor = process.env.PIPELINE_LLM_DECOR === 'on';
  const decorResult = await decorateTrip(
    scheduledDays,
    preferences.destination || '',
    useLLMDecor
  );
  console.log(`[Pipeline V3] Step 11: Decoration complete (LLM: ${decorResult.usedLLM})`);

  // Build final Trip object
  const publicDays = stripPlanningMetaFromDays(decorResult.days);
  const trip: Trip = {
    id: crypto.randomUUID?.() || `trip-${Date.now()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    preferences,
    days: publicDays.map((day, idx) => ({
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
    accommodationOptions: hotels.slice(0, 3).map((h: Accommodation) => ({
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

  // V3 pipeline metadata
  trip.pipelineVersion = 'v3';
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

  // Planner diagnostics — collect from geoDiagnostics on each day
  const zigzagTurnsTotal = repairResult.days.reduce(
    (sum, d) => sum + (d.geoDiagnostics?.zigzagTurns ?? 0), 0
  );
  const routeInefficiencyTotal = repairResult.days.reduce(
    (sum, d) => sum + (d.geoDiagnostics?.routeInefficiencyRatio ?? 0), 0
  );
  const criticalGeoCount = combinedContractViolations.filter(
    v => v.includes('P0.5') || v.includes('P0.6')
  ).length;

  trip.plannerDiagnostics = {
    plannerVersion: 'v3.0',
    beamUsed: false,
    beamFallbackUsed: false,
    dayTripPackCount: dayTripPacks.length,
    repairRejectedCount: repairResult.unresolvedViolations.length,
    zigzagTurnsTotal,
    routeInefficiencyTotal: Number(routeInefficiencyTotal.toFixed(2)),
    criticalGeoCount,
    contractsPassed: contractResult.invariantsPassed,
    rescueStage: 0,
    protectedBreakCount: repairResult.rescueDiagnostics?.protectedBreakCount ?? 0,
    lateMealReplacementCount: repairResult.rescueDiagnostics?.lateMealReplacementCount ?? 0,
    dayNumberMismatchCount: 0,
    dayTripEvictionCount: repairResult.rescueDiagnostics?.dayTripEvictionCount ?? 0,
    finalIntegrityFailures: repairResult.rescueDiagnostics?.finalIntegrityFailures ?? 0,
    orphanTransportCount: repairResult.rescueDiagnostics?.orphanTransportCount ?? 0,
    teleportLegCount: repairResult.rescueDiagnostics?.teleportLegCount ?? 0,
    staleNarrativeCount: repairResult.rescueDiagnostics?.staleNarrativeCount ?? 0,
    freeTimeOverBudgetCount: repairResult.rescueDiagnostics?.freeTimeOverBudgetCount ?? 0,
    mealFallbackCount: repairResult.rescueDiagnostics?.mealFallbackCount ?? 0,
    routeRebuildCount: repairResult.rescueDiagnostics?.routeRebuildCount ?? 0,
    restaurantRefetchMissCount: repairResult.rescueDiagnostics?.restaurantRefetchMissCount ?? 0,
    missingProtectedMustSeeCount,
    dayTripAtomicityBreakCount,
    arrivalFatigueViolationCount,
    temporalImpossibleItemCount,
    sparseFullCityDayCount,
    dayTripDestinationMismatchCount,
    sameFamilyOverloadCount,
  };

  // Calculate cost breakdown from actual scheduled items
  const costBreakdown = { flights: 0, accommodation: 0, food: 0, activities: 0, transport: 0, parking: 0, other: 0 };
  for (const day of trip.days) {
    for (const item of day.items) {
      const cost = Number(item.estimatedCost || 0);
      if (cost <= 0) continue;
      switch (item.type) {
        case 'flight': costBreakdown.flights += cost; break;
        case 'restaurant': costBreakdown.food += cost; break;
        case 'activity': costBreakdown.activities += cost; break;
        case 'transport': costBreakdown.transport += cost; break;
        case 'parking': costBreakdown.parking += cost; break;
        default: break;
      }
    }
  }
  if (hotel?.pricePerNight) {
    const nights = Math.max(1, preferences.durationDays - 1);
    costBreakdown.accommodation = hotel.pricePerNight * nights;
  }
  if (data.outboundFlight?.price && costBreakdown.flights === 0) {
    costBreakdown.flights += data.outboundFlight.price;
    if (data.returnFlight?.price) costBreakdown.flights += data.returnFlight.price;
  }
  trip.costBreakdown = costBreakdown;
  trip.totalEstimatedCost = Object.values(costBreakdown).reduce((s, v) => s + v, 0);

  for (const day of trip.days) {
    let actCost = 0, foodCost = 0, transCost = 0;
    for (const item of day.items) {
      const cost = Number(item.estimatedCost || 0);
      if (item.type === 'activity') actCost += cost;
      else if (item.type === 'restaurant') foodCost += cost;
      else if (item.type === 'transport') transCost += cost;
    }
    day.dailyBudget = { activities: actCost, food: foodCost, transport: transCost, total: actCost + foodCost + transCost };
  }

  console.log(`[Pipeline V3] Budget: ${trip.totalEstimatedCost}€ total (flights: ${costBreakdown.flights}€, hotel: ${costBreakdown.accommodation}€, food: ${costBreakdown.food}€, activities: ${costBreakdown.activities}€)`);

  return trip;
}

/**
 * Multi-city trip generation.
 * Runs V3 independently for each city segment, then connects them.
 */
export async function generateTripV3MultiCity(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  options?: GenerateTripV2Options,
): Promise<Trip> {
  const cityPlan = preferences.cityPlan;
  if (!cityPlan || cityPlan.length <= 1) {
    return generateTripV3(
      preferences,
      onEvent,
      { onSnapshot: options?.onSnapshot },
    );
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

    const segment = await generateTripV3(
      cityPrefs,
      onEvent,
      { onSnapshot: options?.onSnapshot },
    );
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

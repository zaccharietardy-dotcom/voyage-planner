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

import type { Trip, TripPreferences, TransportOptionSummary, Restaurant } from '../types';
import type { ActivityCluster, FetchedData, OnPipelineEvent } from './types';
export type { PipelineEvent, OnPipelineEvent, FetchedData } from './types';
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
import { decorateTrip } from './step12-decorate';
import { applyTrustLayer } from './trust-layer';
import { buildDayTripPacks } from './day-trip-pack';
import { optimizeClusterRouting } from './intra-day-router';
import { stripPlanningMetaFromDays } from './planning-meta';

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
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  if (preferences.cityPlan && preferences.cityPlan.length > 1) {
    return generateTripV3MultiCity(preferences, onEvent);
  }
  return generateTripV3(preferences, onEvent);
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
}

export async function generateTripV3(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  options?: GenerateTripV3Options
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
    onEvent?.({ type: 'step_start', step: 1, stepName: 'Fetching data', timestamp: Date.now() });
    try {
      data = await fetchAllData(preferences, onEvent);
    } catch (err) {
      console.error('[Pipeline V3] Step 1 failed:', err);
      throw new Error(`[Pipeline V3] Data fetch failed: ${(err as Error).message}`);
    }
    stageTimes['fetch'] = Date.now() - t;
    onEvent?.({ type: 'step_done', step: 1, stepName: 'Fetching data', durationMs: stageTimes['fetch'], timestamp: Date.now() });
  }

  // Notify caller with FetchedData (for fixture capture)
  options?.onFetchedData?.(data);

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

  // Step 3b: Optimize intra-day routing (weighted NN + 2-opt)
  {
    optimizeClusterRouting(clusters);
  }

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
    travelTimes = await computeTravelTimes(clusters, hotelCoords, directionsMode, preferences.startDate);
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
    clusters,
    travelTimes,
    timeWindows,
    hotel,
    preferences,
    data,
    enrichedRestaurants,
    allActivities,
    data.destCoords,
  );
  stageTimes['schedule'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 8: Unified schedule built with ${repairResult.days.length} days, ${repairResult.repairs.length} repairs`);
  onEvent?.({ type: 'step_done', step: 8, stepName: 'Unified scheduling', durationMs: stageTimes['schedule'], timestamp: Date.now() });

  let scheduledDays = repairResult.days;

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
          if (item.mustSee) {
            console.warn(`[Pipeline V3] Post-injection sweep: keeping must-see "${item.title}" on Day ${lastDay.dayNumber} despite departure cutoff`);
            return true;
          }
          return false;
        }
        if (item.endTime && timeToMin(item.endTime) > cutoffMin) {
          if (item.mustSee) {
            console.warn(`[Pipeline V3] Post-injection sweep: keeping must-see "${item.title}" on Day ${lastDay.dayNumber} despite end past departure cutoff`);
            return true;
          }
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
  t = Date.now();
  const startDateStr = preferences.startDate.toISOString().split('T')[0];
  const mustSeeActivitiesForContracts = selectedActivities.filter(a => a.mustSee);
  const mustSeeIds = new Set(mustSeeActivitiesForContracts.map(a => a.id));
  const contractResult = validateContracts(
    scheduledDays,
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

  // Step 11: Decorate (optional, after final schedule stabilization)
  t = Date.now();
  const useLLMDecor = process.env.PIPELINE_LLM_DECOR === 'on';
  const decorResult = await decorateTrip(
    scheduledDays,
    preferences.destination || '',
    useLLMDecor
  );
  stageTimes['decorate'] = Date.now() - t;
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

  const totalTime = Date.now() - startTime;
  const { getApiCostSummary } = await import('../services/apiCostGuard');
  const costSummary = getApiCostSummary();
  console.log(`[Pipeline V3] Trip generated in ${totalTime}ms`);
  console.log(`  Stage times: ${Object.entries(stageTimes).map(([k, v]) => `${k}=${v}ms`).join(', ')}`);
  console.log(`  Quality: ${contractResult.score}/100, Invariants: ${contractResult.invariantsPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  API cost: €${costSummary.totalEur.toFixed(2)} / €${costSummary.budget.toFixed(2)} — ${JSON.stringify(costSummary.calls)}`);

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

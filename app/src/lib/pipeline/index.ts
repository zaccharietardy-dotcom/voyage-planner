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
import type { TripDay, TripItem } from '../types/trip';
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
  runId?: string;
  enableRunTrace?: boolean;
  destinationRadiusKm?: number;
  destinationEnvelope?: DestinationEnvelope | null;
  travelStyleDecision?: TravelStyleDecision;
}
import { fetchAllData } from './step1-fetch';
import { scoreAndSelectActivities } from './step2-score';
import { batchFetchWikipediaSummaries, getWikiLanguageForDestination } from '../services/wikipedia';
import { clusterActivities, computeCityDensityProfile } from './step3-cluster';
import { selectTieredHotels, selectTopHotelsByBarycenter } from './step5-hotel';
import { calculateDistance } from '../services/geocoding';
import { resolveCoordinates } from '../services/coordsResolver';
import {
  buildDestinationEnvelope,
  getEnvelopeAdaptiveRadiusKm,
  isPointWithinDestinationEnvelope,
  type DestinationEnvelope,
} from '../services/destinationEnvelope';
import { addOutboundTransportItem, addReturnTransportItem } from './utils/transport-items';
import { isAppropriateForMeal, isBreakfastSpecialized, getCuisineFamily } from './step4-restaurants';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';
import { anchorTransport } from './step4-anchor-transport';
import { timeToMin, minToTime } from './utils/time';
import { computeMealEligibility } from './utils/meal-eligibility';
import { getDensityThresholds } from './utils/density-config';
import { computeTravelTimes } from './step7b-travel-times';
import { enrichRestaurantPool } from './step8-place-restaurants';
import { unifiedScheduleV3Days } from './step8910-unified-schedule';
import { createSelfMealFallbackItem } from './step9-schedule';
import { ensureMustSees, type RepairAction } from './step10-repair';
import { validateContracts } from './step11-contracts';
import { geoReorderScheduledDay } from './utils/geo-reorder';
import { decorateTrip } from './step12-decorate';
import { llmReviewTrip, applyLLMCorrections } from './step13-llm-review';
import { getDestinationIntel, resolveDestination, type DestinationIntel } from './step0-destination-intel';
import {
  planRegionalBlueprint,
  extractBlueprintMustSeeSeedItems,
  extractBlueprintMustSeeSeeds,
  type RegionalBlueprint,
} from './step0-regional-architect';
import { applyTrustLayer } from './trust-layer';
import { buildDayTripPacks } from './day-trip-pack';
import { optimizeClusterRouting } from './intra-day-router';
import { stripPlanningMetaFromDays } from './planning-meta';
import { rebalanceClustersWithLLM, type LLMRebalanceResult } from './step3b-llm-rebalance';
import { attemptClosedWorldDayPlanning } from './step-llm-day-planner';
import { detectQuestions, applyQuestionAnswers, detectPreFetchQuestions, applyEffects } from './questionDetectors';
import type { DestinationAnalysis } from './step0-destination-intel';
import { buildClusteredMapSnapshot, buildFetchedMapSnapshot } from './snapshots';
import { getApiCostSummary, resetApiCostTracker, setRunBudgetProfile } from '../services/apiCostGuard';
import {
  configureProviderQuotaGuard,
  isProviderQuotaStopError,
  reportProviderQuotaExceeded,
  resetProviderQuotaGuard,
} from '../services/providerQuotaGuard';
import { isProviderQuotaLikeError } from '../utils/quotaErrors';
import { isOpenAtTime } from './utils/opening-hours';
import {
  mergeValidationParallelismStats,
  mergeValidationProviderBreakdowns,
  runValidationTasks,
  type ValidationParallelismStats,
  type ValidationProviderCallStats,
} from './utils/validation-orchestrator';

// ---------------------------------------------------------------------------
// Pipeline Event System — emit helper
// ---------------------------------------------------------------------------
function emit(onEvent: OnPipelineEvent | undefined, partial: Omit<import('./types').PipelineEvent, 'timestamp'>) {
  onEvent?.({ ...partial, timestamp: Date.now() });
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveIntEnv(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildRunId(seed?: string): string {
  if (seed && seed.trim()) return seed.trim();
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
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

type ActivityMixKind = 'iconic' | 'local_gem';
type RatioFeasibleBand = { lower: number; upper: number; catalogIconicRatio: number };

function classifyActivityMixKind(activity: Pick<ScoredActivity, 'mustSee' | 'source' | 'protectedReason' | 'reviewCount' | 'rating'>): ActivityMixKind {
  if (
    activity.mustSee
    || activity.source === 'mustsee'
    || activity.protectedReason === 'must_see'
    || activity.protectedReason === 'user_forced'
  ) {
    return 'iconic';
  }
  const reviewCount = activity.reviewCount || 0;
  const rating = activity.rating || 0;
  if (reviewCount >= 600 && rating >= 4.4) return 'iconic';
  return 'local_gem';
}

function computeFinalActivityRatio(
  days: TripDay[],
  allActivities: ScoredActivity[],
): { iconic: number; localGem: number; total: number } {
  const byId = new Map(allActivities.map((activity) => [activity.id, activity]));
  const byName = new Map(allActivities.map((activity) => [normalizePlannerText(activity.name), activity]));
  let iconic = 0;
  let localGem = 0;

  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      const match = byId.get(item.id) || byName.get(normalizePlannerText(item.title || item.locationName || ''));
      const kind = match
        ? classifyActivityMixKind(match)
        : (item.mustSee ? 'iconic' : 'local_gem');
      if (kind === 'iconic') iconic++;
      else localGem++;
    }
  }

  const total = iconic + localGem;
  if (total === 0) {
    return { iconic: 0.6, localGem: 0.4, total: 0 };
  }
  return {
    iconic: Number((iconic / total).toFixed(3)),
    localGem: Number((localGem / total).toFixed(3)),
    total,
  };
}

function computeRealMealCoverage(days: TripDay[]): number {
  const mealItems = days.flatMap((day) =>
    day.items.filter((item) =>
      item.type === 'restaurant' && (item.mealType === 'lunch' || item.mealType === 'dinner')
    )
  );
  if (mealItems.length === 0) return 0;
  const realMeals = mealItems.filter((item) =>
    !item.qualityFlags?.includes('self_meal_fallback') && Boolean(item.restaurant)
  );
  return Number((realMeals.length / mealItems.length).toFixed(3));
}

function computeHubCoherenceScore(days: TripDay[]): number {
  const centroids: Array<{ lat: number; lng: number }> = [];
  for (const day of days) {
    const activities = day.items.filter((item) =>
      item.type === 'activity' && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
    );
    if (activities.length === 0) continue;
    centroids.push({
      lat: activities.reduce((sum, item) => sum + item.latitude, 0) / activities.length,
      lng: activities.reduce((sum, item) => sum + item.longitude, 0) / activities.length,
    });
  }
  if (centroids.length <= 1) return 1;
  let totalKm = 0;
  for (let i = 1; i < centroids.length; i++) {
    totalKm += calculateDistance(
      centroids[i - 1].lat,
      centroids[i - 1].lng,
      centroids[i].lat,
      centroids[i].lng,
    );
  }
  const avgKm = totalKm / (centroids.length - 1);
  const score = 1 - Math.max(0, avgKm - 40) / 220;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function mergeReasonCodeCounts(
  maps: Array<Record<string, number> | undefined>
): Record<string, number> | undefined {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [reasonCode, count] of Object.entries(map)) {
      merged[reasonCode] = (merged[reasonCode] || 0) + count;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function summarizePlannerAudit(
  plannerAudit: NonNullable<Trip['runTrace']>['llmAudit'] | undefined
): {
  plannerTimeoutCount: number;
  plannerTruncationCount: number;
  plannerFinishReasonCounts?: Record<string, number>;
} {
  let plannerTimeoutCount = 0;
  let plannerTruncationCount = 0;
  const plannerFinishReasonCounts: Record<string, number> = {};

  for (const entry of plannerAudit || []) {
    const finishReason = (entry.finishReason || '').trim();
    const finishKey = finishReason ? finishReason.toLowerCase() : '';
    if (finishKey) {
      plannerFinishReasonCounts[finishKey] = (plannerFinishReasonCounts[finishKey] || 0) + 1;
    }

    const failureReason = (entry.failureReason || '').toLowerCase();
    const timeoutLike = failureReason.includes('timeout') || entry.responseStatus === 408;
    if (timeoutLike) plannerTimeoutCount++;

    const truncationLike = finishKey.includes('max_tokens')
      || finishKey.includes('max_output_tokens')
      || finishKey.includes('length')
      || finishKey.includes('token_limit')
      || failureReason.includes('parse_truncated');
    if (truncationLike) plannerTruncationCount++;
  }

  return {
    plannerTimeoutCount,
    plannerTruncationCount,
    plannerFinishReasonCounts: Object.keys(plannerFinishReasonCounts).length
      ? plannerFinishReasonCounts
      : undefined,
  };
}

function enforceFinalActivityRatio(
  days: TripDay[],
  allActivities: ScoredActivity[],
  densityCategory: 'dense' | 'medium' | 'spread',
  ratioBand?: RatioFeasibleBand,
): { swaps: number; ratio: { iconic: number; localGem: number }; ratioFeasibleBand: RatioFeasibleBand } {
  const effectiveBand: RatioFeasibleBand = ratioBand || { lower: 0.55, upper: 0.65, catalogIconicRatio: 0.6 };
  const minIconic = effectiveBand.lower;
  const maxIconic = effectiveBand.upper;
  const maxSwapDistanceKm = densityCategory === 'spread' ? 25 : densityCategory === 'medium' ? 14 : 8;

  const byId = new Map(allActivities.map((activity) => [activity.id, activity]));
  const byName = new Map(allActivities.map((activity) => [normalizePlannerText(activity.name), activity]));

  const plannedIds = new Set<string>();
  const plannedNames = new Set<string>();
  const slots: Array<{
    day: TripDay;
    item: TripItem;
    kind: ActivityMixKind;
    source: ScoredActivity | null;
    replaceable: boolean;
  }> = [];

  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      const source = byId.get(item.id) || byName.get(normalizePlannerText(item.title || item.locationName || '')) || null;
      const kind = source
        ? classifyActivityMixKind(source)
        : (item.mustSee ? 'iconic' : 'local_gem');
      if (item.id) plannedIds.add(item.id);
      plannedNames.add(normalizePlannerText(item.title || item.locationName || ''));
      slots.push({
        day,
        item,
        kind,
        source,
        replaceable: !item.mustSee,
      });
    }
  }

  const current = computeFinalActivityRatio(days, allActivities);
  if (current.total < 4 || (current.iconic >= minIconic && current.iconic <= maxIconic)) {
    return { swaps: 0, ratio: { iconic: current.iconic, localGem: current.localGem }, ratioFeasibleBand: effectiveBand };
  }

  const neededKind: ActivityMixKind = current.iconic < minIconic ? 'iconic' : 'local_gem';
  const replaceKind: ActivityMixKind = neededKind === 'iconic' ? 'local_gem' : 'iconic';
  const targetRatio = effectiveBand.catalogIconicRatio || 0.6;
  const maxSwaps = Math.max(1, Math.ceil(Math.abs(current.iconic - targetRatio) * current.total));

  const pool = allActivities
    .filter((activity) => !plannedIds.has(activity.id) && !plannedNames.has(normalizePlannerText(activity.name)))
    .filter((activity) => classifyActivityMixKind(activity) === neededKind);

  const replaceSlots = slots.filter((slot) => slot.replaceable && slot.kind === replaceKind);
  let swaps = 0;

  for (const slot of replaceSlots) {
    if (swaps >= maxSwaps) break;
    const anchorLat = slot.item.latitude;
    const anchorLng = slot.item.longitude;
    const dayDate = slot.day.date;

    const candidateIndex = pool.findIndex((candidate) => {
      const distanceOk = Number.isFinite(anchorLat) && Number.isFinite(anchorLng)
        ? calculateDistance(anchorLat, anchorLng, candidate.latitude, candidate.longitude) <= maxSwapDistanceKm
        : true;
      if (!distanceOk) return false;
      if (!candidate.openingHours && !candidate.openingHoursByDay) return true;
      return isOpenAtTime(candidate, dayDate, slot.item.startTime, slot.item.endTime);
    });

    if (candidateIndex < 0) continue;
    const candidate = pool.splice(candidateIndex, 1)[0];

    slot.item.id = candidate.id || slot.item.id;
    slot.item.title = candidate.name;
    slot.item.locationName = candidate.name;
    slot.item.description = candidate.description || slot.item.description;
    slot.item.latitude = candidate.latitude;
    slot.item.longitude = candidate.longitude;
    slot.item.rating = candidate.rating;
    slot.item.reviewCount = candidate.reviewCount;
    slot.item.mustSee = candidate.mustSee;
    slot.item.openingHours = candidate.openingHours;
    slot.item.openingHoursByDay = candidate.openingHoursByDay;
    slot.item.geoSource = candidate.geoSource;
    slot.item.geoConfidence = candidate.geoConfidence;
    slot.item.qualityFlags = [...new Set([...(slot.item.qualityFlags || []), 'ratio_mix_swap'])];
    swaps++;
  }

  const ratio = computeFinalActivityRatio(days, allActivities);
  return {
    swaps,
    ratio: {
      iconic: ratio.iconic,
      localGem: ratio.localGem,
    },
    ratioFeasibleBand: effectiveBand,
  };
}

function injectFirstLastMileTransfers(day1: TripDay, lastDay: TripDay): void {
  const outboundLonghaulIndex = day1.items.findIndex((item) =>
    item.type === 'flight'
    || (item.type === 'transport' && item.transportRole === 'longhaul' && item.transportDirection === 'outbound')
  );
  if (outboundLonghaulIndex >= 0) {
    const longhaul = day1.items[outboundLonghaulIndex];
    const afterLonghaul = day1.items.slice(outboundLonghaulIndex + 1).find((item) =>
      item.type !== 'transport' && item.type !== 'flight'
    );
    if (longhaul.endTime && afterLonghaul?.startTime) {
      const startMin = timeToMin(longhaul.endTime);
      const endMin = timeToMin(afterLonghaul.startTime);
      const hasArrivalTransfer = day1.items.some((item) => item.type === 'transport' && item.transportRole === 'hotel_return');
      if (!hasArrivalTransfer && endMin - startMin >= 35) {
        const transferStart = minToTime(startMin + 10);
        const transferDuration = Math.max(20, Math.min(45, endMin - startMin - 15));
        const transferEnd = minToTime(timeToMin(transferStart) + transferDuration);
        const transferItem: TripItem = {
          id: `arrival-transfer-${day1.dayNumber}`,
          dayNumber: day1.dayNumber,
          startTime: transferStart,
          endTime: transferEnd,
          type: 'transport',
          title: 'Transfert arrivée',
          description: `Aéroport/Gare → ${afterLonghaul.locationName || 'hébergement'}`,
          locationName: afterLonghaul.locationName || 'Transfert local',
          latitude: afterLonghaul.latitude || longhaul.latitude || 0,
          longitude: afterLonghaul.longitude || longhaul.longitude || 0,
          orderIndex: outboundLonghaulIndex + 1,
          duration: transferDuration,
          transportMode: 'car',
          transportRole: 'hotel_return',
          transportDirection: 'outbound',
          transportTimeSource: 'estimated',
          estimatedCost: 0,
          qualityFlags: ['first_last_mile_visible'],
        };
        day1.items.splice(outboundLonghaulIndex + 1, 0, transferItem);
      }
    }
  }

  const returnLonghaulIndex = lastDay.items.findIndex((item) =>
    item.type === 'flight'
    || (item.type === 'transport' && item.transportRole === 'longhaul' && item.transportDirection === 'return')
  );
  if (returnLonghaulIndex >= 0) {
    const longhaul = lastDay.items[returnLonghaulIndex];
    const beforeLonghaul = [...lastDay.items.slice(0, returnLonghaulIndex)].reverse().find((item) =>
      item.type !== 'transport' && item.type !== 'flight'
    );
    if (longhaul.startTime && beforeLonghaul?.endTime) {
      const startMin = timeToMin(beforeLonghaul.endTime);
      const endMin = timeToMin(longhaul.startTime);
      const hasDepartureTransfer = lastDay.items.some((item) => item.type === 'transport' && item.transportRole === 'hotel_depart');
      if (!hasDepartureTransfer && endMin - startMin >= 35) {
        const transferDuration = Math.max(20, Math.min(45, endMin - startMin - 15));
        const transferEnd = minToTime(endMin - 10);
        const transferStart = minToTime(Math.max(startMin + 5, timeToMin(transferEnd) - transferDuration));
        const transferItem: TripItem = {
          id: `departure-transfer-${lastDay.dayNumber}`,
          dayNumber: lastDay.dayNumber,
          startTime: transferStart,
          endTime: transferEnd,
          type: 'transport',
          title: 'Transfert départ',
          description: `${beforeLonghaul.locationName || 'hébergement'} → Aéroport/Gare`,
          locationName: beforeLonghaul.locationName || 'Transfert local',
          latitude: beforeLonghaul.latitude || longhaul.latitude || 0,
          longitude: beforeLonghaul.longitude || longhaul.longitude || 0,
          orderIndex: returnLonghaulIndex,
          duration: Math.max(20, timeToMin(transferEnd) - timeToMin(transferStart)),
          transportMode: 'car',
          transportRole: 'hotel_depart',
          transportDirection: 'return',
          transportTimeSource: 'estimated',
          estimatedCost: 0,
          qualityFlags: ['first_last_mile_visible'],
        };
        lastDay.items.splice(returnLonghaulIndex, 0, transferItem);
      }
    }
  }

  day1.items.forEach((item, index) => { item.orderIndex = index; });
  lastDay.items.forEach((item, index) => { item.orderIndex = index; });
}

function enforceFinalRestaurantProximity(
  days: TripDay[],
  densityCategory: 'dense' | 'medium' | 'spread'
): number {
  const maxDistKm = getDensityThresholds(densityCategory).p02ContractDist;
  const anchorTypes = new Set(['activity', 'checkin', 'checkout', 'hotel']);
  let convertedToFallback = 0;

  for (const day of days) {
    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i];
      if (item.type !== 'restaurant') continue;
      if (item.qualityFlags?.includes('self_meal_fallback')) continue;
      if (item.mealType !== 'lunch' && item.mealType !== 'dinner') continue;
      if (!item.latitude || !item.longitude) continue;

      const anchors = day.items.filter(
        (candidate) => anchorTypes.has(candidate.type) && candidate.latitude && candidate.longitude
      );
      if (anchors.length === 0) continue;

      let nearestDist = Infinity;
      let nearestAnchor: TripItem | null = null;
      for (const anchor of anchors) {
        const dist = calculateDistance(
          item.latitude,
          item.longitude,
          anchor.latitude!,
          anchor.longitude!
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestAnchor = anchor;
        }
      }

      if (nearestDist <= maxDistKm) continue;

      const anchorCoords = nearestAnchor
        ? { lat: nearestAnchor.latitude!, lng: nearestAnchor.longitude! }
        : null;
      day.items[i] = createSelfMealFallbackItem(
        item.mealType,
        item.startTime || '12:30',
        item.duration || 75,
        day.dayNumber,
        item.orderIndex,
        anchorCoords
      );
      convertedToFallback++;
    }
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  return convertedToFallback;
}

function enforceFinalMealSemantics(days: TripDay[]): number {
  const anchorTypes = new Set(['activity', 'checkin', 'checkout', 'hotel']);
  let convertedToFallback = 0;

  for (const day of days) {
    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i];
      if (item.type !== 'restaurant') continue;
      if (item.qualityFlags?.includes('self_meal_fallback')) continue;
      if (item.mealType !== 'lunch' && item.mealType !== 'dinner') continue;

      const semanticCandidate = item.restaurant || ({
        id: item.id || `synthetic-meal-${day.dayNumber}-${i}`,
        name: `${item.title || ''} ${item.locationName || ''}`.trim() || 'Repas',
        address: item.locationName || item.title || 'Adresse inconnue',
        latitude: item.latitude || 0,
        longitude: item.longitude || 0,
        rating: item.rating || 0,
        reviewCount: item.reviewCount || 0,
        priceLevel: 2 as const,
        cuisineTypes: [],
        dietaryOptions: [],
        openingHours: {},
      });

      if (isAppropriateForMeal(semanticCandidate, item.mealType)) continue;

      const nearestAnchor = day.items
        .filter((candidate) =>
          anchorTypes.has(candidate.type)
          && Number.isFinite(candidate.latitude)
          && Number.isFinite(candidate.longitude)
        )
        .sort((left, right) => {
          const leftDist = calculateDistance(
            item.latitude || 0,
            item.longitude || 0,
            left.latitude || 0,
            left.longitude || 0,
          );
          const rightDist = calculateDistance(
            item.latitude || 0,
            item.longitude || 0,
            right.latitude || 0,
            right.longitude || 0,
          );
          return leftDist - rightDist;
        })[0];

      day.items[i] = createSelfMealFallbackItem(
        item.mealType,
        item.startTime || (item.mealType === 'lunch' ? '12:30' : '19:00'),
        item.duration || (item.mealType === 'lunch' ? 75 : 90),
        day.dayNumber,
        item.orderIndex,
        nearestAnchor
          ? { lat: nearestAnchor.latitude || 0, lng: nearestAnchor.longitude || 0 }
          : null,
      );
      convertedToFallback++;
    }
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  return convertedToFallback;
}

function findMealFallbackAnchor(day: TripDay, targetMin: number): { lat: number; lng: number } | null {
  const anchors = day.items
    .filter((item) =>
      Number.isFinite(item.latitude)
      && Number.isFinite(item.longitude)
      && (item.type === 'activity' || item.type === 'checkin' || item.type === 'checkout')
    )
    .map((item) => {
      const start = timeToMin(item.startTime || '00:00');
      const end = timeToMin(item.endTime || item.startTime || '00:00');
      const mid = (start + end) / 2;
      return {
        lat: item.latitude || 0,
        lng: item.longitude || 0,
        distance: Math.abs(mid - targetMin),
      };
    })
    .sort((left, right) => left.distance - right.distance);
  if (anchors.length === 0) return null;
  return { lat: anchors[0].lat, lng: anchors[0].lng };
}

function findMealSlotStart(
  day: TripDay,
  preferredMin: number,
  durationMin: number,
  windowStartMin: number,
  windowEndMin: number,
): number | null {
  const latestStart = windowEndMin - durationMin;
  if (latestStart < windowStartMin) return null;

  const clampedPreferred = Math.min(latestStart, Math.max(windowStartMin, preferredMin));
  const intervals = day.items
    .map((item) => ({
      start: timeToMin(item.startTime || '00:00'),
      end: timeToMin(item.endTime || item.startTime || '00:00'),
    }))
    .filter((slot) => slot.end > windowStartMin && slot.start < windowEndMin)
    .sort((left, right) => left.start - right.start);

  // Try preferred slot first.
  let overlaps = false;
  for (const slot of intervals) {
    if (clampedPreferred < slot.end && (clampedPreferred + durationMin) > slot.start) {
      overlaps = true;
      break;
    }
  }
  if (!overlaps) return clampedPreferred;

  // Find earliest available gap in window.
  let cursor = windowStartMin;
  for (const slot of intervals) {
    if (slot.start - cursor >= durationMin) {
      return cursor;
    }
    cursor = Math.max(cursor, slot.end);
  }
  if (windowEndMin - cursor >= durationMin) return cursor;

  return latestStart;
}

function enforceFinalMealCoverage(
  days: TripDay[],
  timeWindows: DayTimeWindow[],
): number {
  let insertedFallbackMeals = 0;
  const firstDayNumber = days[0]?.dayNumber;
  const lastDayNumber = days[days.length - 1]?.dayNumber;

  for (const day of days) {
    let hasLunch = false;
    let hasDinner = false;

    for (const item of day.items) {
      if (item.type !== 'restaurant') continue;
      const title = (item.title || '').toLowerCase();
      if (item.mealType === 'lunch' || (title.includes('déjeuner') && !title.includes('petit-déjeuner')) || title.includes('lunch')) {
        hasLunch = true;
      }
      if (item.mealType === 'dinner' || title.includes('dîner') || title.includes('diner') || title.includes('dinner')) {
        hasDinner = true;
      }
    }

    const tw = timeWindows.find((window) => window.dayNumber === day.dayNumber);
    const arrivalItem = day.items.find((item) =>
      ((day.dayNumber === firstDayNumber) && item.type === 'flight')
      || (item.type === 'transport' && item.transportDirection === 'outbound')
    );
    const departureItem = day.items.find((item) =>
      ((day.dayNumber === lastDayNumber) && item.type === 'flight')
      || (item.type === 'transport' && item.transportDirection === 'return')
    );
    const eligibility = computeMealEligibility({
      dayStartTime: tw?.activityStartTime || '00:00',
      dayEndTime: tw?.activityEndTime || '22:00',
      hasArrivalTransport: Boolean(tw?.hasArrivalTransport || arrivalItem),
      hasDepartureTransport: Boolean(tw?.hasDepartureTransport || departureItem),
      arrivalEndTime: arrivalItem?.endTime,
      departureStartTime: departureItem?.startTime,
    });
    if (!eligibility.hasUsableWindow) continue;

    const requiredMeals: Array<{ mealType: 'lunch' | 'dinner'; duration: number; preferred: number }> = [];
    if (eligibility.expectLunch && !hasLunch) {
      requiredMeals.push({ mealType: 'lunch', duration: 75, preferred: 12 * 60 + 45 });
    }
    if (eligibility.expectDinner && !hasDinner) {
      requiredMeals.push({ mealType: 'dinner', duration: 90, preferred: 19 * 60 });
    }

    for (const meal of requiredMeals) {
      const slotStart = findMealSlotStart(
        day,
        meal.preferred,
        meal.duration,
        eligibility.effectiveStartMin,
        eligibility.effectiveEndMin,
      );
      if (slotStart === null) continue;
      const anchor = findMealFallbackAnchor(day, slotStart);
      day.items.push(createSelfMealFallbackItem(
        meal.mealType,
        minToTime(slotStart),
        meal.duration,
        day.dayNumber,
        day.items.length,
        anchor,
      ));
      insertedFallbackMeals++;
    }

    day.items.sort((left, right) => timeToMin(left.startTime || '00:00') - timeToMin(right.startTime || '00:00'));
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  return insertedFallbackMeals;
}

function buildFallbackAccommodation(
  clusters: ActivityCluster[],
  destinationCoords: { lat: number; lng: number },
  destination: string,
  budgetLevel: TripPreferences['budgetLevel'],
): Accommodation {
  const points = clusters
    .flatMap((cluster) => cluster.activities)
    .filter((activity) => Number.isFinite(activity.latitude) && Number.isFinite(activity.longitude));

  const center = points.length > 0
    ? {
      lat: points.reduce((sum, activity) => sum + activity.latitude, 0) / points.length,
      lng: points.reduce((sum, activity) => sum + activity.longitude, 0) / points.length,
    }
    : destinationCoords;

  const estimatedNightlyRate = budgetLevel === 'economic'
    ? 65
    : budgetLevel === 'moderate'
      ? 120
      : budgetLevel === 'comfort'
        ? 185
        : 280;

  const destinationLabel = (destination || 'destination').trim() || 'destination';
  return {
    id: `fallback-hotel-${normalizePlannerText(destinationLabel).replace(/\s+/g, '-') || 'default'}`,
    name: `Hébergement central — ${destinationLabel}`,
    type: 'hotel',
    address: destinationLabel,
    latitude: center.lat,
    longitude: center.lng,
    rating: 4.2,
    reviewCount: 0,
    pricePerNight: estimatedNightlyRate,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    bookingUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destinationLabel)}&group_adults=2&no_rooms=1`,
    dataReliability: 'estimated',
    qualityFlags: ['hotel_synthetic_fallback'],
  };
}

function mergeMustSeeSeedsIntoPreferences(
  preferences: TripPreferences,
  seeds: string[],
): void {
  const normalizedExisting = new Set(
    (preferences.mustSee || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => normalizePlannerText(value))
  );
  const merged: string[] = (preferences.mustSee || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const seed of seeds) {
    const normalized = normalizePlannerText(seed);
    if (!normalized || normalizedExisting.has(normalized)) continue;
    merged.push(seed);
    normalizedExisting.add(normalized);
    if (merged.join(', ').length > 1800) break;
  }

  preferences.mustSee = merged.join(', ');
}

function mapResolutionSourceToGeoSource(
  source: string
): 'place' | 'known_product' | 'geocode' | 'city_fallback' {
  if (source === 'google_places') return 'place';
  if (source === 'cache') return 'place';
  return 'geocode';
}

interface ValidationDiagnosticsSnapshot {
  validationLatencyMs: number;
  providerCallBreakdown: Record<string, ValidationProviderCallStats>;
  parallelismStats: ValidationParallelismStats;
}

function emptyValidationDiagnosticsSnapshot(): ValidationDiagnosticsSnapshot {
  return {
    validationLatencyMs: 0,
    providerCallBreakdown: {},
    parallelismStats: {
      scheduled: 0,
      deduped: 0,
      settled: 0,
      fulfilled: 0,
      rejected: 0,
      retries: 0,
      maxInFlight: 0,
      maxInFlightByProvider: {},
    },
  };
}

type TravelStyleChoice = 'single_base' | 'road_trip';

interface TravelStyleDecision {
  source: 'user_explicit' | 'auto_scored' | 'user_question';
  scores: {
    single_base: number;
    road_trip: number;
    delta: number;
  };
  questionAsked: boolean;
  chosenStyle: TravelStyleChoice;
}

function computeTravelStyleDecision(
  preferences: TripPreferences,
  blueprint: RegionalBlueprint,
  analysis: DestinationAnalysis | null,
): TravelStyleDecision {
  if (preferences.travelStyle === 'single_base' || preferences.travelStyle === 'road_trip') {
    return {
      source: 'user_explicit',
      scores: {
        single_base: preferences.travelStyle === 'single_base' ? 1 : 0,
        road_trip: preferences.travelStyle === 'road_trip' ? 1 : 0,
        delta: 1,
      },
      questionAsked: false,
      chosenStyle: preferences.travelStyle,
    };
  }

  let singleBaseScore = 0.5;
  let roadTripScore = 0.5;
  const hubCount = blueprint.hubs.length;

  if (hubCount >= 3) roadTripScore += 0.45;
  else if (hubCount === 2) roadTripScore += 0.25;
  else singleBaseScore += 0.35;

  if (preferences.durationDays <= 4) singleBaseScore += 0.25;
  else if (preferences.durationDays >= 7) roadTripScore += 0.2;

  if (preferences.carRental || preferences.transport === 'car') roadTripScore += 0.15;
  if (preferences.groupType === 'family_with_kids') singleBaseScore += 0.1;

  const citiesWithCoords = (analysis?.resolvedCities || []).filter(
    (city): city is { name: string; stayDuration: number; highlights: string[]; coords: { lat: number; lng: number } } =>
      Boolean(city.coords && Number.isFinite(city.coords.lat) && Number.isFinite(city.coords.lng))
  );
  if (citiesWithCoords.length >= 2) {
    let maxDistance = 0;
    for (let i = 0; i < citiesWithCoords.length; i++) {
      for (let j = i + 1; j < citiesWithCoords.length; j++) {
        const dist = calculateDistance(
          citiesWithCoords[i].coords.lat,
          citiesWithCoords[i].coords.lng,
          citiesWithCoords[j].coords.lat,
          citiesWithCoords[j].coords.lng,
        );
        if (dist > maxDistance) maxDistance = dist;
      }
    }
    if (maxDistance >= 120) roadTripScore += 0.35;
    else if (maxDistance >= 60) roadTripScore += 0.2;
    else singleBaseScore += 0.15;
  }

  if ((blueprint.confidence || 0) < 0.45) singleBaseScore += 0.1;

  const total = Math.max(0.01, singleBaseScore + roadTripScore);
  const normalizedSingle = Number((singleBaseScore / total).toFixed(3));
  const normalizedRoad = Number((roadTripScore / total).toFixed(3));
  const delta = Number(Math.abs(normalizedRoad - normalizedSingle).toFixed(3));

  return {
    source: 'auto_scored',
    scores: {
      single_base: normalizedSingle,
      road_trip: normalizedRoad,
      delta,
    },
    questionAsked: false,
    chosenStyle: normalizedRoad >= normalizedSingle ? 'road_trip' : 'single_base',
  };
}

async function resolveTravelStyleDecision(
  decision: TravelStyleDecision,
  askUser: AskUserFn | undefined,
): Promise<TravelStyleDecision> {
  if (decision.source === 'user_explicit') return decision;
  if (decision.scores.delta >= 0.3 || !askUser) return decision;

  const recommended: TravelStyleChoice = decision.scores.road_trip >= decision.scores.single_base
    ? 'road_trip'
    : 'single_base';
  const selectedOptionId = await askUser({
    questionId: 'travel-style-gate',
    type: 'travel_style_gate',
    title: 'Style du voyage',
    prompt: 'Ton itinéraire est ambigu: tu préfères base unique ou road trip ?',
    options: [
      {
        id: 'single_base',
        label: 'Base unique (moins de déplacements)',
        emoji: '🏨',
        isDefault: recommended === 'single_base',
        effect: { type: 'set_travel_mode', value: 'single_base' },
      },
      {
        id: 'road_trip',
        label: 'Road trip (plus de variété)',
        emoji: '🚗',
        isDefault: recommended === 'road_trip',
        effect: { type: 'set_travel_mode', value: 'road_trip' },
      },
    ],
    timeoutMs: 30_000,
    metadata: {
      source: 'travel_style_decision_engine',
      scores: decision.scores,
    },
  });

  const chosenStyle: TravelStyleChoice = selectedOptionId === 'road_trip' ? 'road_trip' : 'single_base';
  return {
    ...decision,
    source: 'user_question',
    questionAsked: true,
    chosenStyle,
  };
}

function applyRegionalBlueprintToPreferences(
  preferences: TripPreferences,
  blueprint: RegionalBlueprint,
  chosenStyle: TravelStyleChoice,
): void {
  if (chosenStyle === 'road_trip' && blueprint.hubs.length > 1) {
    preferences.cityPlan = blueprint.hubs.map((hub) => ({ city: hub.city, days: hub.days }));
    preferences.travelStyle = 'road_trip';
  } else if (blueprint.hubs.length >= 1) {
    const primaryHub = [...blueprint.hubs].sort((a, b) => b.days - a.days)[0];
    preferences.destination = primaryHub?.city || preferences.destination;
    preferences.cityPlan = undefined;
    preferences.travelStyle = 'single_base';
  }
  const mustSeeSeeds = extractBlueprintMustSeeSeeds(blueprint);
  if (mustSeeSeeds.length > 0) {
    mergeMustSeeSeedsIntoPreferences(preferences, mustSeeSeeds);
  }
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

function plannerActivityKey(activity: ScoredActivity): string {
  return activity.id
    || activity.planningToken
    || normalizePlannerText(activity.name);
}

function plannedItemKey(item: TripItem): string {
  return item.id
    || item.planningMeta?.planningToken
    || normalizePlannerText(item.title || item.locationName || '');
}

function computeLlmOrderPreservedRate(
  clusters: ActivityCluster[],
  days: TripDay[],
): number | undefined {
  const lockedClusters = clusters.filter((cluster) => cluster.routingPolicy === 'llm_locked');
  if (lockedClusters.length === 0) return undefined;

  const dayByNumber = new Map(days.map((day) => [day.dayNumber, day]));
  let indexedPairs = 0;
  let indexedPreservedPairs = 0;

  for (const cluster of lockedClusters) {
    const day = dayByNumber.get(cluster.dayNumber);
    if (!day) continue;

    const llmOrderSequence = day.items
      .filter((item) => item.type === 'activity')
      .map((item) => item.planningMeta?.llmOrderIndex)
      .filter((value): value is number => Number.isFinite(value));

    if (llmOrderSequence.length <= 1) continue;

    for (let i = 0; i < llmOrderSequence.length - 1; i++) {
      for (let j = i + 1; j < llmOrderSequence.length; j++) {
        indexedPairs++;
        if (llmOrderSequence[i] <= llmOrderSequence[j]) {
          indexedPreservedPairs++;
        }
      }
    }
  }

  if (indexedPairs > 0) {
    return Number((indexedPreservedPairs / indexedPairs).toFixed(3));
  }

  let totalPairs = 0;
  let preservedPairs = 0;

  for (const cluster of lockedClusters) {
    const day = dayByNumber.get(cluster.dayNumber);
    if (!day) continue;

    const planned = cluster.activities.map((activity) => plannerActivityKey(activity)).filter((key) => key.length > 0);
    const final = day.items
      .filter((item) => item.type === 'activity')
      .map((item) => plannedItemKey(item))
      .filter((key) => key.length > 0);

    const plannedIndex = new Map<string, number>();
    for (let i = 0; i < planned.length; i++) plannedIndex.set(planned[i], i);
    const projected = final.filter((key) => plannedIndex.has(key));
    if (projected.length <= 1) continue;

    for (let i = 0; i < projected.length - 1; i++) {
      for (let j = i + 1; j < projected.length; j++) {
        totalPairs++;
        const left = plannedIndex.get(projected[i]) ?? 0;
        const right = plannedIndex.get(projected[j]) ?? 0;
        if (left <= right) preservedPairs++;
      }
    }
  }

  if (totalPairs === 0) return 1;
  return Number((preservedPairs / totalPairs).toFixed(3));
}

interface DestinationScopeEnforcementStats {
  outsideEnvelopeRejectCount: number;
  removedCount: number;
  recenteredCount: number;
  mealFallbackCount: number;
}

function inferMealTypeFromItem(item: TripItem): 'breakfast' | 'lunch' | 'dinner' {
  if (item.mealType === 'breakfast' || item.mealType === 'lunch' || item.mealType === 'dinner') {
    return item.mealType;
  }
  const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  if (text.includes('petit-dejeuner') || text.includes('petit-déjeuner') || text.includes('breakfast')) return 'breakfast';
  if (text.includes('diner') || text.includes('dîner') || text.includes('dinner')) return 'dinner';
  return 'lunch';
}

function enforceDestinationEnvelopeOnTimeline(
  days: TripDay[],
  envelope: DestinationEnvelope | null,
): DestinationScopeEnforcementStats {
  const stats: DestinationScopeEnforcementStats = {
    outsideEnvelopeRejectCount: 0,
    removedCount: 0,
    recenteredCount: 0,
    mealFallbackCount: 0,
  };
  if (!envelope) return stats;

  for (const day of days) {
    const normalizedItems: TripItem[] = [];
    for (const item of day.items) {
      if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
        normalizedItems.push(item);
        continue;
      }
      if (item.type === 'flight' || item.type === 'transport') {
        normalizedItems.push(item);
        continue;
      }

      const inside = isPointWithinDestinationEnvelope(
        { lat: item.latitude, lng: item.longitude },
        envelope,
        { extraBufferKm: 6 },
      );
      if (inside) {
        normalizedItems.push(item);
        continue;
      }

      stats.outsideEnvelopeRejectCount += 1;

      if (item.type === 'restaurant') {
        const fallback = createSelfMealFallbackItem(
          inferMealTypeFromItem(item),
          item.startTime,
          item.duration || Math.max(30, timeToMin(item.endTime) - timeToMin(item.startTime)),
          item.dayNumber,
          item.orderIndex,
          envelope.center,
        );
        fallback.id = `${item.id}-scope-fallback`;
        fallback.qualityFlags = Array.from(new Set([...(fallback.qualityFlags || []), 'geo_scope_filtered']));
        normalizedItems.push(fallback);
        stats.mealFallbackCount += 1;
        continue;
      }

      if (item.type === 'free_time' || item.type === 'checkin' || item.type === 'checkout' || item.type === 'hotel') {
        normalizedItems.push({
          ...item,
          latitude: envelope.center.lat,
          longitude: envelope.center.lng,
          title: item.type === 'free_time' ? 'Pause libre — Découverte locale' : item.title,
          description: item.type === 'free_time'
            ? 'Pause flexible: balade, café ou arrêt spontané à proximité.'
            : item.description,
          qualityFlags: Array.from(new Set([...(item.qualityFlags || []), 'geo_scope_recentered'])),
        });
        stats.recenteredCount += 1;
        continue;
      }

      stats.removedCount += 1;
    }

    day.items = normalizedItems.map((item, index) => ({
      ...item,
      orderIndex: index,
    }));
  }

  return stats;
}

function sanitizeGenericTimelineLabels(days: TripDay[]): number {
  let patched = 0;
  const genericPattern = /(exploration du quartier|explore the neighborhood|temps libre|free time)/i;
  for (const day of days) {
    day.items = day.items.map((item) => {
      if (!genericPattern.test(item.title || '')) return item;
      patched += 1;
      if (item.type === 'free_time') {
        return {
          ...item,
          title: 'Pause libre — Découverte locale',
          description: 'Pause flexible: balade, café ou arrêt spontané à proximité.',
        };
      }
      return {
        ...item,
        type: 'free_time',
        title: 'Pause libre — Découverte locale',
        description: 'Pause flexible: balade, café ou arrêt spontané à proximité.',
      };
    });
  }
  return patched;
}

function computeOriginDestinationDistanceKm(
  preferences: TripPreferences,
  destinationCoords: { lat: number; lng: number } | undefined,
): number {
  if (preferences.originCoords && destinationCoords) {
    return calculateDistance(
      preferences.originCoords.lat,
      preferences.originCoords.lng,
      destinationCoords.lat,
      destinationCoords.lng,
    );
  }
  const samePlace = normalizePlannerText(preferences.origin) === normalizePlannerText(preferences.destination);
  return samePlace ? 0 : 31;
}

function collectLonghaulCoverage(days: TripDay[]): {
  hasOutbound: boolean;
  hasReturn: boolean;
  outboundFallback: boolean;
  returnFallback: boolean;
  mode?: string;
} {
  let hasOutbound = false;
  let hasReturn = false;
  let outboundFallback = false;
  let returnFallback = false;
  let mode: string | undefined;

  for (const day of days) {
    for (const item of day.items) {
      const isLonghaul =
        item.type === 'flight'
        || (item.type === 'transport' && item.transportRole === 'longhaul');
      if (!isLonghaul) continue;
      const direction = item.type === 'flight'
        ? (day.dayNumber === 1 ? 'outbound' : 'return')
        : (item.transportDirection || undefined);
      if (direction === 'outbound') {
        hasOutbound = true;
        if (item.transportTimeSource === 'estimated_fallback' || item.selectionSource === 'fallback') {
          outboundFallback = true;
        }
      }
      if (direction === 'return') {
        hasReturn = true;
        if (item.transportTimeSource === 'estimated_fallback' || item.selectionSource === 'fallback') {
          returnFallback = true;
        }
      }
      if (!mode && item.transportMode) mode = item.transportMode;
      if (!mode && item.type === 'flight') mode = 'plane';
    }
  }

  return { hasOutbound, hasReturn, outboundFallback, returnFallback, mode };
}

/**
 * Generate a trip — routes to V3 single-city or multi-city.
 */
export async function generateTripV2(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  v2Options?: GenerateTripV2Options,
): Promise<Trip> {
  resetApiCostTracker();
  resetProviderQuotaGuard();
  configureProviderQuotaGuard({
    stopImmediate: true,
    requiredProviders: ['gemini', 'serpapi', 'google_places', 'google_maps'],
  });
  setRunBudgetProfile('dense');

  const requestedDestinationInput = preferences.destination;
  let regionAnalysis: DestinationAnalysis | null = null;
  let regionalBlueprint: RegionalBlueprint | null = null;
  let travelStyleDecision: TravelStyleDecision | undefined;

  // Step 0a: Region resolver — classify destination, resolve regions to cities.
  // Also run when cityPlan is a trivial mirror of destination (e.g. [{ city: "Bretagne", days: 5 }]).
  const hasSingleCityPlan = Array.isArray(preferences.cityPlan) && preferences.cityPlan.length === 1;
  const cityPlanMatchesDestination = hasSingleCityPlan
    && normalizePlannerText(preferences.cityPlan?.[0]?.city) === normalizePlannerText(preferences.destination);
  const shouldRunRegionResolver =
    (!preferences.cityPlan || cityPlanMatchesDestination)
    && preferences.travelStyle !== 'single_base';

  if (shouldRunRegionResolver) {
    try {
      regionAnalysis = await resolveDestination(preferences);
      if (regionAnalysis?.inputType && regionAnalysis.inputType !== 'city') {
        regionalBlueprint = await planRegionalBlueprint(preferences, { analysis: regionAnalysis });
        const baseDecision = computeTravelStyleDecision(preferences, regionalBlueprint, regionAnalysis);
        const resolvedDecision = await resolveTravelStyleDecision(baseDecision, v2Options?.askUser);
        travelStyleDecision = resolvedDecision;
        applyRegionalBlueprintToPreferences(preferences, regionalBlueprint, resolvedDecision.chosenStyle);
        if (resolvedDecision.chosenStyle === 'road_trip') {
          setRunBudgetProfile('spread');
        }
        console.log(
          `[Pipeline] Regional blueprint (${regionalBlueprint.source}): mode=${regionalBlueprint.mode}, chosen=${resolvedDecision.chosenStyle}, hubs=${regionalBlueprint.hubs.map((hub) => `${hub.city}(${hub.days}j)`).join(' → ')}`
        );
      } else if (regionAnalysis) {
        if (regionAnalysis.resolvedCities.length > 1) {
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
      if (isProviderQuotaStopError(e)) throw e;
      console.warn('[Pipeline] Region resolver failed, continuing with original destination:', e);
    }
  }

  if (!travelStyleDecision && (preferences.travelStyle === 'single_base' || preferences.travelStyle === 'road_trip')) {
    travelStyleDecision = {
      source: 'user_explicit',
      scores: {
        single_base: preferences.travelStyle === 'single_base' ? 1 : 0,
        road_trip: preferences.travelStyle === 'road_trip' ? 1 : 0,
        delta: 1,
      },
      questionAsked: false,
      chosenStyle: preferences.travelStyle,
    };
  }

  // Build a dynamic destination envelope (bbox + center) to keep items in-scope.
  const resolvedCityCoords = (regionAnalysis?.resolvedCities || [])
    .map((city) => city.coords)
    .filter((coords): coords is { lat: number; lng: number } => Boolean(coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)));
  const envelopeQuery =
    regionAnalysis?.inputType && regionAnalysis.inputType !== 'city'
      ? requestedDestinationInput
      : preferences.destination;
  let destinationEnvelope: DestinationEnvelope | null = v2Options?.destinationEnvelope || null;
  if (!destinationEnvelope) {
    destinationEnvelope = await buildDestinationEnvelope(envelopeQuery, {
      resolvedCityCoords,
      fallbackCenter: preferences.destinationCoords,
    });
  }

  // Compute destination radius from envelope first, then from resolved-city spread.
  let destinationRadiusKm: number | undefined = v2Options?.destinationRadiusKm;
  if (!destinationRadiusKm && destinationEnvelope) {
    destinationRadiusKm = getEnvelopeAdaptiveRadiusKm(destinationEnvelope);
  }
  if (regionAnalysis?.resolvedCities && regionAnalysis.resolvedCities.length >= 2) {
    const coords = regionAnalysis.resolvedCities
      .map(c => c.coords)
      .filter((c): c is { lat: number; lng: number } => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng));
    if (!destinationRadiusKm && coords.length >= 2) {
      const centerLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const centerLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
      const maxDist = Math.max(...coords.map(c => calculateDistance(centerLat, centerLng, c.lat, c.lng)));
      destinationRadiusKm = Math.max(30, maxDist * 1.5); // 1.5x margin for activities around outer cities
      console.log(`[Pipeline] Destination radius: ${destinationRadiusKm.toFixed(0)}km (from ${coords.length} resolved cities)`);
    }
  }
  if (destinationEnvelope) {
    console.log(
      `[Pipeline] Destination envelope: source=${destinationEnvelope.source}, confidence=${destinationEnvelope.confidence}, radius=${destinationEnvelope.radiusKm.toFixed(0)}km`
    );
  }

  if (preferences.travelStyle === 'road_trip' || (preferences.cityPlan?.length || 0) > 1) {
    setRunBudgetProfile('spread');
  } else if (preferences.durationDays >= 6) {
    setRunBudgetProfile('medium');
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
        if (regionalBlueprint?.hubs?.length) {
          preferences.cityPlan = regionalBlueprint.hubs.map((hub) => ({ city: hub.city, days: hub.days }));
        } else {
          preferences.cityPlan = regionAnalysis.resolvedCities.map(c => ({
            city: c.name,
            days: c.stayDuration,
          }));
        }
      } else if (preferences.travelStyle === 'single_base' && preferences.cityPlan) {
        preferences.destination = preferences.cityPlan[0].city;
        preferences.cityPlan = undefined;
      }
      if (preferences.travelStyle === 'road_trip' || (preferences.cityPlan?.length || 0) > 1) {
        setRunBudgetProfile('spread');
      }
    } catch (e) {
      if (isProviderQuotaStopError(e)) throw e;
      console.warn('[Pipeline] Pre-fetch questions failed, continuing:', e);
    }
  }

  if (preferences.cityPlan && preferences.cityPlan.length > 1) {
    return generateTripV3MultiCity(preferences, onEvent, {
      ...v2Options,
      destinationRadiusKm,
      destinationEnvelope,
      travelStyleDecision,
    });
  }
  return generateTripV3(
    preferences,
    onEvent,
    {
      onSnapshot: v2Options?.onSnapshot,
      cachedIntel,
      regionalBlueprint,
      runId: v2Options?.runId,
      enableRunTrace: v2Options?.enableRunTrace,
      destinationRadiusKm,
      destinationEnvelope,
      travelStyleDecision,
    },
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
  /** Optional regional blueprint (LLM architect) to seed must-sees and diagnostics */
  regionalBlueprint?: RegionalBlueprint | null;
  /** Stable trace id for one generation run */
  runId?: string;
  /** Force forensic trace payload in diagnostics */
  enableRunTrace?: boolean;
  /** Destination area radius in km (from bounding box). Used to adapt coord resolution max distance. */
  destinationRadiusKm?: number;
  /** Destination geographic envelope for strict in-destination filtering. */
  destinationEnvelope?: DestinationEnvelope | null;
  /** Travel style decision metadata (single base vs road trip). */
  travelStyleDecision?: TravelStyleDecision;
}

export async function generateTripV3(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  options?: GenerateTripV3Options,
  askUser?: AskUserFn,
): Promise<Trip> {
  const startTime = Date.now();
  const runId = buildRunId(options?.runId);
  const traceEnabled = options?.enableRunTrace !== false;
  const runTraceSteps: NonNullable<Trip['runTrace']>['steps'] = [];
  const runTraceFallbackReasons: string[] = [];
  const recordRunStep = (
    stepId: string,
    stepName: string,
    status: 'done' | 'fallback' | 'error',
    startedAt: number,
    reasonCode?: string,
    detail?: string,
  ) => {
    if (!traceEnabled) return;
    runTraceSteps.push({
      stepId,
      stepName,
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      reasonCode,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      detail,
    });
    if (reasonCode && status !== 'done') {
      runTraceFallbackReasons.push(reasonCode);
    }
  };
  const stageTimes: Record<string, number> = {};
  const apiCallTimings: Array<{ label: string; durationMs: number; status: 'ok' | 'error' }> = [];
  const wrappedOnEvent: OnPipelineEvent | undefined = onEvent
    ? (event) => {
        onEvent(event);
        if (event.type === 'api_done' && event.label) {
          apiCallTimings.push({
            label: event.label,
            durationMs: event.durationMs ?? 0,
            status: event.detail?.startsWith('ERROR') ? 'error' : 'ok',
          });
        }
      }
    : undefined;
  let destinationEnvelope: DestinationEnvelope | null = options?.destinationEnvelope || null;
  if (!destinationEnvelope) {
    destinationEnvelope = await buildDestinationEnvelope(preferences.destination, {
      fallbackCenter: preferences.destinationCoords,
    });
  }
  const effectiveDestinationRadiusKm =
    options?.destinationRadiusKm
    || (destinationEnvelope ? getEnvelopeAdaptiveRadiusKm(destinationEnvelope) : undefined);

  // Step 1: Fetch all data (or use fixture)
  let t = Date.now();
  let data: FetchedData;
  if (options?.fixtureData) {
    data = options.fixtureData;
    if (!destinationEnvelope && data.destinationEnvelope) {
      destinationEnvelope = data.destinationEnvelope;
    }
    stageTimes['fetch'] = 0;
    console.log('[Pipeline V3] Step 1: Using fixture data (no API calls)');
    onEvent?.({ type: 'step_done', step: 1, stepName: 'Fetching data (fixture)', durationMs: 0, timestamp: Date.now() });
    recordRunStep('step1_fetch', 'Fetching data', 'done', t, undefined, 'fixture_data');
  } else {
    // Step 0: Destination Intelligence — use cached if available (from generateTripV2 pre-fetch)
    let destinationIntel: DestinationIntel | null = options?.cachedIntel !== undefined ? options.cachedIntel : null;
    if (!destinationIntel) {
      try {
        destinationIntel = await getDestinationIntel(preferences.destination, preferences);
      } catch (e) {
        if (isProviderQuotaStopError(e)) throw e;
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
      data = await fetchAllData(preferences, wrappedOnEvent, destinationIntel, {
        destinationEnvelope,
        destinationRadiusKm: effectiveDestinationRadiusKm,
      });
      if (!destinationEnvelope && data.destinationEnvelope) {
        destinationEnvelope = data.destinationEnvelope;
      }
    } catch (err) {
      if (isProviderQuotaStopError(err)) throw err;
      console.error('[Pipeline V3] Step 1 failed:', err);
      recordRunStep('step1_fetch', 'Fetching data', 'error', t, 'fetch_failed', (err as Error)?.message || String(err));
      throw new Error(`[Pipeline V3] Data fetch failed: ${(err as Error).message}`);
    }
    stageTimes['fetch'] = Date.now() - t;
    onEvent?.({ type: 'step_done', step: 1, stepName: 'Fetching data', durationMs: stageTimes['fetch'], timestamp: Date.now() });
    recordRunStep('step1_fetch', 'Fetching data', 'done', t);
  }

  // Notify caller with FetchedData (for fixture capture)
  options?.onFetchedData?.(data);
  options?.onSnapshot?.(buildFetchedMapSnapshot(data));

  // Step 2: Score and rank activities
  t = Date.now();
  onEvent?.({ type: 'step_start', step: 2, stepName: 'Scoring activities', timestamp: Date.now() });
  const selectedActivities = scoreAndSelectActivities(data, preferences);
  let allActivities = [...selectedActivities]; // For repair pass
  let activeBlueprint: RegionalBlueprint | null = options?.regionalBlueprint || null;
  let sparseRescueValidation = emptyValidationDiagnosticsSnapshot();

  // Sparse pool activation: use regional architect as a blueprint seeding layer.
  const sparseThreshold = Math.max(12, preferences.durationDays * 3);
  const scheduleReadyCount = selectedActivities.filter((activity) =>
    (activity.duration || 0) >= 60
    && (activity.rating || 0) >= 3.8
    && (activity.score || 0) >= 12
  ).length;
  const qualitySparseThreshold = Math.max(8, preferences.durationDays * 2);
  const shouldTriggerSparseRescue =
    selectedActivities.length < sparseThreshold
    || scheduleReadyCount < qualitySparseThreshold;
  if (shouldTriggerSparseRescue) {
    const sparseRescueStart = Date.now();
    try {
      const sparseBlueprint = options?.regionalBlueprint || await planRegionalBlueprint(preferences, { forceForSparse: true });
      activeBlueprint = sparseBlueprint;
      const mustSeeSeedItems = extractBlueprintMustSeeSeedItems(sparseBlueprint, Math.max(12, preferences.durationDays * 4));
      const mustSeeSeeds = mustSeeSeedItems.map((seed) => seed.name);
      if (mustSeeSeeds.length > 0) {
        mergeMustSeeSeedsIntoPreferences(preferences, mustSeeSeeds);
      }

      const existingNames = new Set(selectedActivities.map((activity) => normalizePlannerText(activity.name)));
      const injectCandidates = mustSeeSeedItems
        .filter((seed) => !existingNames.has(normalizePlannerText(seed.name)))
        .slice(0, 24);

      const validationTasks = injectCandidates.map((seed) => ({
        key: `sparse-seed:${normalizePlannerText(seed.name)}`,
        provider: 'coords',
        run: () => resolveCoordinates(
          seed.name,
          preferences.destination,
          data.destCoords,
          'attraction',
          {
            allowPaidFallback: false,
            destinationEnvelope: destinationEnvelope || undefined,
            destinationRadiusKm: effectiveDestinationRadiusKm,
          }
        ),
      }));

      const validationResult = await runValidationTasks(validationTasks, {
        defaultConcurrency: 10,
        providerConcurrency: { coords: 10 },
        maxRetries: 2,
        baseBackoffMs: 180,
      });

      sparseRescueValidation = {
        validationLatencyMs: validationResult.latencyMs,
        providerCallBreakdown: validationResult.providerCallBreakdown,
        parallelismStats: validationResult.parallelismStats,
      };

      let injected = 0;
      for (const seed of injectCandidates) {
        if (injected >= 12) break;
        const key = `sparse-seed:${normalizePlannerText(seed.name)}`;
        const settled = validationResult.settledByKey.get(key);
        if (!settled || settled.status !== 'fulfilled' || !settled.value) continue;
        const resolved = settled.value;
        selectedActivities.push({
          id: `arch-${normalizePlannerText(seed.name).replace(/\s+/g, '-').slice(0, 48)}-${injected}`,
          name: seed.name,
          type: seed.kind === 'iconic' ? 'culture' : 'nature',
          description: seed.kind === 'iconic'
            ? "Incontournable recommande pour cette destination"
            : "Pepite locale recommandee pour une experience plus authentique",
          duration: 90,
          estimatedCost: 0,
          latitude: resolved.lat,
          longitude: resolved.lng,
          rating: seed.kind === 'iconic' ? 4.5 : 4.4,
          reviewCount: 200,
          mustSee: true,
          bookingRequired: false,
          openingHours: { open: '09:00', close: '18:00' },
          dataReliability: 'verified',
          geoSource: mapResolutionSourceToGeoSource(resolved.source),
          geoConfidence: 'high',
          source: 'mustsee',
          score: seed.kind === 'iconic' ? 34 : 31,
          protectedReason: 'user_forced',
        });
        existingNames.add(normalizePlannerText(seed.name));
        injected++;
      }

      if (injected > 0) {
        allActivities = [...selectedActivities];
        stageTimes['sparse-rescue'] = Date.now() - sparseRescueStart;
        console.log(`[Pipeline V3] Sparse pool rescue: +${injected} architect anchors injected (${selectedActivities.length}/${sparseThreshold}, quality=${scheduleReadyCount}/${qualitySparseThreshold}) in ${stageTimes['sparse-rescue']}ms`);
      }
    } catch (e) {
      if (isProviderQuotaStopError(e)) throw e;
      console.warn('[Pipeline V3] Sparse pool rescue failed (non-blocking):', e);
    }
  }

  stageTimes['score'] = Date.now() - t;
  console.log(`[Pipeline V3] Step 2: ${selectedActivities.length} activities selected`);
  onEvent?.({ type: 'step_done', step: 2, stepName: 'Scoring activities', durationMs: stageTimes['score'], timestamp: Date.now() });
  recordRunStep('step2_score', 'Scoring activities', 'done', t);

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
  if (densityProfile.densityCategory === 'spread') {
    setRunBudgetProfile('spread');
  } else if (densityProfile.densityCategory === 'medium') {
    setRunBudgetProfile('medium');
  } else {
    setRunBudgetProfile('dense');
  }

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
  recordRunStep('step3_cluster', 'Clustering', 'done', t);

  const previewHotels = selectTopHotelsByBarycenter(
    clusters,
    data.bookingHotels || [],
    preferences.budgetLevel || 'medium',
    undefined,
    preferences.durationDays,
    { destination: preferences.destination, destCoords: data.destCoords },
    3,
  );
  options?.onSnapshot?.(buildClusteredMapSnapshot(clusters, previewHotels[0] || null, data));

  const pipelineCtx: Parameters<typeof runPipelineFromClusters>[1] = {
    data, preferences, timeWindows, bestTransport, syntheticReturnTransport,
    allActivities, selectedActivities,
    densityProfile: { densityCategory: densityProfile.densityCategory },
    dayTripPacks, arrivalFatigueRole, destinationMismatchCount,
    destinationEnvelope,
    ratioFeasibleBand: undefined,
  };

  const forceClosedWorldPlanner =
    isTruthyEnvFlag(process.env.PIPELINE_FORCE_CLOSED_WORLD)
    || isTruthyEnvFlag(process.env.FORCE_CLOSED_WORLD_PLANNER);
  const closedWorldDisabled = isTruthyEnvFlag(process.env.PIPELINE_DISABLE_CLOSED_WORLD);
  const closedWorldGateEnabled = !closedWorldDisabled;
  if (forceClosedWorldPlanner) {
    console.log('[Pipeline V3] Closed-world planner force-enabled via env flag');
  }
  if (closedWorldDisabled) {
    console.log('[Pipeline V3] Closed-world planner disabled via env flag');
  }
  const closedWorldMeta: {
    enabled: boolean;
    used: boolean;
    fallbackReason?: string;
    providerUsed?: 'gemini' | 'anthropic' | 'gpt' | 'deterministic';
    providerFallback: boolean;
    groundingRate: number;
    unknownIdRate: number;
    parseAttempts: number;
    latencyMs: number;
    plannerBudgetMs: number;
    ratioIconicLocal?: { iconic: number; localGem: number };
    ratioFeasibleBand?: RatioFeasibleBand;
    requestedDropCount: number;
    acceptedDropCount: number;
    dropRecoveryCount: number;
    reasonCodeCounts?: Record<string, number>;
    plannerAudit: NonNullable<Trip['runTrace']>['llmAudit'];
    candidateDecisionEvents?: NonNullable<Trip['runTrace']>['candidateDecisions'];
  } = {
    enabled: closedWorldGateEnabled,
    used: false,
    providerFallback: false,
    groundingRate: 0,
    unknownIdRate: 0,
    parseAttempts: 0,
    latencyMs: 0,
    plannerBudgetMs: 0,
    requestedDropCount: 0,
    acceptedDropCount: 0,
    dropRecoveryCount: 0,
    plannerAudit: [],
  };

  let trip: Trip | null = null;

  if (closedWorldGateEnabled) {
    const defaultClosedWorldHardCapMs = 240_000; // 4min — leaves margin for scheduling within Vercel 5min limit
    const overrideHardCapMs = parsePositiveIntEnv(process.env.PIPELINE_HARD_CAP_MS);
    const closedWorldHardCapMs = overrideHardCapMs || defaultClosedWorldHardCapMs;
    const elapsedMs = Date.now() - startTime;
    const plannerProfileBudgetMs =
      forceClosedWorldPlanner
        ? 40_000
        : densityProfile.densityCategory === 'spread'
        ? 45_000
        : shouldTriggerSparseRescue
          ? 36_000
          : 28_000;
    const plannerReserveMs =
      forceClosedWorldPlanner
        ? 10_000
        : densityProfile.densityCategory === 'spread' || shouldTriggerSparseRescue
          ? 12_000
          : 26_000;
    const plannerBudgetMs = Math.max(0, Math.min(plannerProfileBudgetMs, closedWorldHardCapMs - elapsedMs - plannerReserveMs));
    closedWorldMeta.plannerBudgetMs = plannerBudgetMs;
    const minPlannerBudgetMs =
      forceClosedWorldPlanner || densityProfile.densityCategory === 'spread' || shouldTriggerSparseRescue
        ? 3_500
        : 4_000;
    if (elapsedMs >= closedWorldHardCapMs || plannerBudgetMs < minPlannerBudgetMs) {
      closedWorldMeta.fallbackReason = 'hard_cap_reached';
    } else {
      const catalogRestaurants = [
        ...(data.tripAdvisorRestaurants || []),
        ...(data.serpApiRestaurants || []),
      ];
      const plannerAttempt = await attemptClosedWorldDayPlanning({
        clusters,
        restaurants: catalogRestaurants,
        dayTripPacks,
        preferences,
        timeWindows,
        densityCategory: densityProfile.densityCategory as 'dense' | 'medium' | 'spread',
        maxPlannerLatencyMs: plannerBudgetMs,
        enableGptFallback: Boolean(process.env.OPENAI_API_KEY) && !isTruthyEnvFlag(process.env.PIPELINE_DISABLE_GPT_FALLBACK),
      });

      closedWorldMeta.groundingRate = plannerAttempt.groundingRate;
      closedWorldMeta.unknownIdRate = plannerAttempt.unknownIdRate;
      closedWorldMeta.parseAttempts = plannerAttempt.parseAttempts;
      closedWorldMeta.latencyMs = plannerAttempt.latencyMs;
      stageTimes['llm-planner'] = plannerAttempt.latencyMs;
      closedWorldMeta.providerUsed = plannerAttempt.providerUsed;
      closedWorldMeta.providerFallback = plannerAttempt.providerFallback;
      closedWorldMeta.reasonCodeCounts = plannerAttempt.reasonCodeCounts;
      closedWorldMeta.plannerAudit = plannerAttempt.plannerAudit;
      closedWorldMeta.candidateDecisionEvents = plannerAttempt.candidateDecisionEvents;

      if (plannerAttempt.result) {
        closedWorldMeta.ratioIconicLocal = plannerAttempt.result.hints.ratioIconicLocal;
        closedWorldMeta.ratioFeasibleBand = plannerAttempt.result.hints.ratioFeasibleBand;
        closedWorldMeta.requestedDropCount = plannerAttempt.result.hints.requestedDropCount;
        closedWorldMeta.acceptedDropCount = plannerAttempt.result.hints.acceptedDropCount;
        closedWorldMeta.dropRecoveryCount = plannerAttempt.result.hints.dropRecoveryCount;
        pipelineCtx.ratioFeasibleBand = plannerAttempt.result.hints.ratioFeasibleBand;
        try {
          const scheduleStartedAt = Date.now();
          const llmScheduledTrip = await runPipelineFromClusters(plannerAttempt.result.clusters, pipelineCtx);
          if (llmScheduledTrip.qualityMetrics?.invariantsPassed) {
            trip = llmScheduledTrip;
            closedWorldMeta.used = true;
            recordRunStep('deterministic_composer', 'Deterministic composer', 'done', scheduleStartedAt);

            // Inject LLM enrichments (themes, narratives, tips, route notes)
            const enrichments = plannerAttempt.result!.enrichments;
            if (enrichments && trip.days) {
              for (const day of trip.days) {
                if (enrichments.dayThemes[day.dayNumber]) {
                  day.theme = enrichments.dayThemes[day.dayNumber];
                }
                if (enrichments.dayNarratives[day.dayNumber]) {
                  day.dayNarrative = enrichments.dayNarratives[day.dayNumber];
                }
                const dayMealCtx = enrichments.mealContext[day.dayNumber];
                for (let i = 0; i < day.items.length; i++) {
                  const item = day.items[i];
                  // Activity tips by candidateId
                  if (item.type === 'activity' && item.id) {
                    const tip = enrichments.activityTips[item.id]
                      || enrichments.activityTips[`act:${normalizePlannerText(item.id).replace(/\s+/g, '-').slice(0, 64)}`];
                    if (tip) item.llmContextTip = tip;
                  }
                  // Meal context by mealType (not by restaurant ID — resto can be swapped)
                  if (item.type === 'restaurant' && item.mealType && dayMealCtx?.[item.mealType]) {
                    item.llmContextTip = dayMealCtx[item.mealType];
                  }
                  // Route notes between consecutive activities only
                  if (item.type === 'transport' && i > 0 && i < day.items.length - 1) {
                    const prev = day.items[i - 1];
                    const next = day.items[i + 1];
                    if (prev?.type === 'activity' && next?.type === 'activity' && prev.id && next.id) {
                      const routeKey = `${prev.id}->${next.id}`;
                      const note = enrichments.routeNotes[routeKey];
                      if (note) item.description = note;
                    }
                  }
                }
              }
            }

            if (trip.plannerDiagnostics) {
              trip.plannerDiagnostics.llmRebalanceUsed = false;
              trip.plannerDiagnostics.llmRebalanceScore = null;
              trip.plannerDiagnostics.algoScore = trip.qualityMetrics?.score ?? 0;
              trip.plannerDiagnostics.llmRebalanceLatencyMs = plannerAttempt.latencyMs;
            }
          } else {
            closedWorldMeta.fallbackReason = 'p0_blocking_after_llm_scheduler';
            recordRunStep('deterministic_composer', 'Deterministic composer', 'fallback', scheduleStartedAt, 'p0_blocking_after_llm_scheduler');
          }
        } catch (err) {
          if (isProviderQuotaStopError(err)) throw err;
          console.warn('[Pipeline V3] Closed-world scheduler failed, falling back:', err);
          closedWorldMeta.fallbackReason = 'llm_scheduler_runtime_error';
          recordRunStep('deterministic_composer', 'Deterministic composer', 'error', Date.now(), 'llm_scheduler_runtime_error', (err as Error)?.message || String(err));
        }
      } else {
        closedWorldMeta.fallbackReason = plannerAttempt.failureReason || 'llm_scheduler_failed';
      }
    }
  }

  if (closedWorldGateEnabled) {
    const plannerStartedAt = Date.now() - Math.max(0, closedWorldMeta.latencyMs);
    recordRunStep(
      'closed_world_planner',
      'Closed-world planner',
      closedWorldMeta.used ? 'done' : (closedWorldMeta.fallbackReason ? 'fallback' : 'done'),
      plannerStartedAt,
      closedWorldMeta.used ? undefined : closedWorldMeta.fallbackReason,
      closedWorldMeta.providerUsed ? `provider=${closedWorldMeta.providerUsed}` : undefined,
    );
  }

  if (!trip) {
    // Closed-world gate path: fallback must stay deterministic (no second LLM loop).
    if (closedWorldGateEnabled) {
      const scheduleStartedAt = Date.now();
      trip = await runPipelineFromClusters(clusters, pipelineCtx);
      recordRunStep('deterministic_composer', 'Deterministic composer', 'fallback', scheduleStartedAt, closedWorldMeta.fallbackReason || 'closed_world_fallback');
      if (trip.plannerDiagnostics) {
        trip.plannerDiagnostics.llmRebalanceUsed = false;
        trip.plannerDiagnostics.llmRebalanceScore = null;
        trip.plannerDiagnostics.algoScore = trip.qualityMetrics?.score ?? 0;
        trip.plannerDiagnostics.llmRebalanceLatencyMs = 0;
      }
    } else {
      // Legacy dense path: keep A/B LLM rebalance experiment.
      const scheduleStartedAt = Date.now();
      const llmResult = await rebalanceClustersWithLLM(
        clusters, timeWindows, preferences, densityProfile
      );

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
          recordRunStep('deterministic_composer', 'Deterministic composer', 'done', scheduleStartedAt);
          if (trip.plannerDiagnostics) {
            trip.plannerDiagnostics.llmRebalanceUsed = true;
            trip.plannerDiagnostics.llmRebalanceScore = scoreLLM;
            trip.plannerDiagnostics.algoScore = scoreAlgo;
            trip.plannerDiagnostics.llmRebalanceThemes = llmResult.themes;
            trip.plannerDiagnostics.llmRebalanceLatencyMs = llmResult.latencyMs;
          }
        } else {
          trip = tripAlgo;
          recordRunStep('deterministic_composer', 'Deterministic composer', 'done', scheduleStartedAt);
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
        recordRunStep('deterministic_composer', 'Deterministic composer', 'fallback', scheduleStartedAt, 'llm_rebalance_unavailable');
        if (trip.plannerDiagnostics) {
          trip.plannerDiagnostics.llmRebalanceUsed = false;
          trip.plannerDiagnostics.llmRebalanceScore = null;
          trip.plannerDiagnostics.algoScore = trip.qualityMetrics?.score ?? 0;
          trip.plannerDiagnostics.llmRebalanceLatencyMs = 0;
        }
      }
    }
  }

  const mergedProviderCallBreakdown = mergeValidationProviderBreakdowns([
    activeBlueprint?.diagnostics?.providerCallBreakdown,
    sparseRescueValidation.providerCallBreakdown,
  ]);
  const mergedParallelismStats = mergeValidationParallelismStats([
    activeBlueprint?.diagnostics?.parallelismStats,
    sparseRescueValidation.parallelismStats,
  ]);
  const freeTimeMinutesByDay = Object.fromEntries(
    trip.days.map((day) => {
      const minutes = day.items
        .filter((item) => item.type === 'free_time')
        .reduce((sum, item) => sum + (item.duration || Math.max(0, timeToMin(item.endTime) - timeToMin(item.startTime))), 0);
      return [String(day.dayNumber), minutes];
    })
  );
  const realMealCoverage = computeRealMealCoverage(trip.days);
  const hubCoherenceScore = computeHubCoherenceScore(trip.days);
  const plannerAuditStats = summarizePlannerAudit(closedWorldMeta.plannerAudit);
  const longhaulDistanceKm = computeOriginDestinationDistanceKm(preferences, data.destCoords);
  const longhaulRequired = longhaulDistanceKm > 30;
  const longhaulCoverage = collectLonghaulCoverage(trip.days);
  trip.generationDiagnostics = {
    validationLatencyMs:
      (activeBlueprint?.diagnostics?.validationLatencyMs || 0)
      + sparseRescueValidation.validationLatencyMs,
    runId,
    providerCallBreakdown: mergedProviderCallBreakdown,
    parallelismStats: mergedParallelismStats,
    plannerMode: closedWorldMeta.used ? 'llm_closed_world' : 'deterministic',
    llmSchedulerUsed: closedWorldMeta.used,
    fallbackReason: !closedWorldMeta.used ? closedWorldMeta.fallbackReason : undefined,
    groundingRate: closedWorldMeta.enabled ? closedWorldMeta.groundingRate : undefined,
    unknownIdRate: closedWorldMeta.enabled ? closedWorldMeta.unknownIdRate : undefined,
    parseAttempts: closedWorldMeta.enabled ? closedWorldMeta.parseAttempts : undefined,
    plannerBudgetMs: closedWorldMeta.enabled ? closedWorldMeta.plannerBudgetMs : undefined,
    plannerTimeoutRate: closedWorldMeta.enabled ? (closedWorldMeta.fallbackReason === 'planner_timeout' ? 1 : 0) : undefined,
    plannerTimeoutCount: closedWorldMeta.enabled ? plannerAuditStats.plannerTimeoutCount : undefined,
    plannerTruncationCount: closedWorldMeta.enabled ? plannerAuditStats.plannerTruncationCount : undefined,
    plannerFinishReasonCounts: closedWorldMeta.enabled ? plannerAuditStats.plannerFinishReasonCounts : undefined,
    closedWorldActivationRate: closedWorldMeta.enabled ? (closedWorldMeta.used ? 1 : 0) : undefined,
    geoFallbackUsed: data.geoFallbackUsed,
    geoScopeSource: destinationEnvelope?.source,
    outsideEnvelopeRejectCount: trip.plannerDiagnostics?.outsideEnvelopeRejectCount || 0,
    inspiredModeUsed: preferences.tripMode === 'inspired',
    travelStyleDecision: options?.travelStyleDecision,
    questionFlow: {
      askedCount: 0,
      autoDefaultCount: 0,
      postDraftAdjustUsed: false,
    },
    longhaulInjected: {
      required: longhaulRequired,
      outbound: longhaulCoverage.hasOutbound,
      return: longhaulCoverage.hasReturn,
      mode: longhaulCoverage.mode || 'unknown',
      source: longhaulCoverage.outboundFallback || longhaulCoverage.returnFallback ? 'fallback' : 'verified',
      distanceKm: Number(longhaulDistanceKm.toFixed(1)),
    },
    mealSemanticReplacements: trip.plannerDiagnostics?.mealSemanticReplacementCount || 0,
    llmOrderPreservedRate: trip.plannerDiagnostics?.llmOrderPreservedRate,
    requestedDropCount: closedWorldMeta.enabled ? closedWorldMeta.requestedDropCount : undefined,
    acceptedDropCount: closedWorldMeta.enabled ? closedWorldMeta.acceptedDropCount : undefined,
    dropRecoveryCount: closedWorldMeta.enabled ? closedWorldMeta.dropRecoveryCount : undefined,
    plannerProviderUsed: closedWorldMeta.used
      ? (closedWorldMeta.providerUsed || 'gemini')
      : (closedWorldMeta.enabled ? (closedWorldMeta.providerUsed || 'deterministic') : 'deterministic'),
    providerFallback: closedWorldMeta.enabled ? closedWorldMeta.providerFallback : undefined,
    hubCoherenceScore,
    reasonCodeCounts: closedWorldMeta.reasonCodeCounts,
    ratioFeasibleBand: closedWorldMeta.enabled ? closedWorldMeta.ratioFeasibleBand : undefined,
    freeTimeMinutesByDay,
    replacementCounts: {
      lateMealReplacementCount: trip.plannerDiagnostics?.lateMealReplacementCount || 0,
      mealFallbackCount: trip.plannerDiagnostics?.mealFallbackCount || 0,
      routeRebuildCount: trip.plannerDiagnostics?.routeRebuildCount || 0,
    },
  };

  const scheduledItems = trip.days.flatMap((day) => day.items);
  const validatedCount = scheduledItems.filter((item) =>
    Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
  ).length;
  const replacedCount =
    (trip.plannerDiagnostics?.lateMealReplacementCount || 0)
    + (trip.plannerDiagnostics?.mealFallbackCount || 0)
    + (trip.plannerDiagnostics?.routeRebuildCount || 0);
  const rejectedCount =
    (trip.contractViolations?.length || 0)
    + (trip.plannerDiagnostics?.finalIntegrityFailures || 0);
  const ratioComputed = computeFinalActivityRatio(trip.days, allActivities);
  const ratioIconicLocal = {
    iconic: ratioComputed.iconic,
    localGem: ratioComputed.localGem,
  };
  trip.reliabilitySummary = {
    validatedCount,
    replacedCount,
    rejectedCount,
    groundingRate: closedWorldMeta.enabled ? closedWorldMeta.groundingRate : undefined,
    ratioIconicLocal,
    ratioFeasibleBand: closedWorldMeta.enabled ? closedWorldMeta.ratioFeasibleBand : undefined,
    realMealCoverage,
    freeTimeMinutesByDay,
    hubConsistencyRate: hubCoherenceScore,
  };

  // Timing and cost logging
  const totalTime = Date.now() - startTime;
  const costSummary = getApiCostSummary();
  const runTrace: NonNullable<Trip['runTrace']> = {
    runId,
    startedAt: new Date(startTime).toISOString(),
    endedAt: new Date().toISOString(),
    status: trip.qualityMetrics?.invariantsPassed
      ? (closedWorldMeta.used ? 'done' : (closedWorldMeta.enabled ? 'fallback' : 'done'))
      : 'error',
    totalLatencyMs: totalTime,
    estimatedCostEur: costSummary.totalEur,
    fallbackReasons: Array.from(new Set(runTraceFallbackReasons)),
    steps: runTraceSteps,
    llmAudit: closedWorldMeta.plannerAudit,
    candidateDecisions: closedWorldMeta.candidateDecisionEvents?.slice(0, 600),
    reasonCodeCounts: closedWorldMeta.reasonCodeCounts,
  };
  if (traceEnabled) {
    trip.runTrace = runTrace;
    if (trip.generationDiagnostics) {
      trip.generationDiagnostics.runTrace = runTrace;
    }
  }

  console.log(`[Pipeline V3] Trip generated in ${totalTime}ms`);
  console.log(`  Quality: ${trip.qualityMetrics?.score}/100`);
  console.log(`  LLM planner: ${closedWorldMeta.used ? `used (${closedWorldMeta.providerUsed}, ${closedWorldMeta.latencyMs}ms)` : `fallback (${closedWorldMeta.fallbackReason})`}`);
  console.log(
    `  API cost: €${costSummary.totalEur.toFixed(2)} (profile=${costSummary.profile}, target=€${costSummary.targetEur.toFixed(2)}, burst=€${costSummary.burstCapEur.toFixed(2)}, hard=€${costSummary.budget.toFixed(2)})`
  );

  // Profiling: detailed API call timings sorted by duration
  if (apiCallTimings.length > 0) {
    const sorted = [...apiCallTimings].sort((a, b) => b.durationMs - a.durationMs);
    console.log(`  ── API call profiling (${sorted.length} calls) ──`);
    for (const call of sorted) {
      const statusIcon = call.status === 'ok' ? '✓' : '✗';
      console.log(`    ${statusIcon} ${call.label}: ${(call.durationMs / 1000).toFixed(1)}s`);
    }
    const totalApiMs = sorted.reduce((s, c) => s + c.durationMs, 0);
    console.log(`  ── Total API time (sequential): ${(totalApiMs / 1000).toFixed(1)}s, wall clock: ${(totalTime / 1000).toFixed(1)}s ──`);
  }

  // Stage timings summary
  const stageEntries = Object.entries(stageTimes).sort(([, a], [, b]) => b - a);
  if (stageEntries.length > 0) {
    console.log(`  ── Stage profiling ──`);
    for (const [stage, ms] of stageEntries) {
      console.log(`    ${stage}: ${(ms / 1000).toFixed(1)}s`);
    }
  }

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
    destinationEnvelope?: DestinationEnvelope | null;
    ratioFeasibleBand?: RatioFeasibleBand;
    onEvent?: OnPipelineEvent;
  }
): Promise<Trip> {
  const {
    data, preferences, timeWindows, bestTransport, syntheticReturnTransport,
    allActivities, selectedActivities, densityProfile, dayTripPacks,
    arrivalFatigueRole, destinationMismatchCount, destinationEnvelope, ratioFeasibleBand, onEvent,
  } = ctx;
  const effectiveDestinationEnvelope = destinationEnvelope || data.destinationEnvelope || null;

  // Step 3b: Optimize intra-day routing (weighted NN + 2-opt)
  optimizeClusterRouting(clusters);

  // Step 4: Select hotel (3 tiers) — per-path since clusters differ
  const rankedHotels = selectTopHotelsByBarycenter(
    clusters,
    data.bookingHotels || [],
    preferences.budgetLevel || 'medium',
    undefined,
    preferences.durationDays,
    { destination: preferences.destination, destCoords: data.destCoords },
    3
  );
  const hotels = rankedHotels.length > 0
    ? rankedHotels
    : [buildFallbackAccommodation(
      clusters,
      data.destCoords,
      preferences.destination || '',
      preferences.budgetLevel || 'moderate',
    )];
  const hotel = hotels[0] || null;
  if (rankedHotels.length === 0 && hotel) {
    console.warn('[Pipeline V3] Step 4: Hotel pool empty/invalid, using synthetic fallback accommodation');
  }
  const hotelCoords = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : data.destCoords;
  console.log(`[Pipeline V3] Step 4: Hotel selected: ${hotel?.name || 'none'}`);

  // Step 6: Compute travel times (selective Directions API)
  const directionsMode = (process.env.PIPELINE_DIRECTIONS_MODE || 'selective') as 'selective' | 'all' | 'off';
  let travelTimes: Awaited<ReturnType<typeof computeTravelTimes>>;
  try {
    travelTimes = await computeTravelTimes(clusters, hotelCoords, directionsMode, preferences.startDate);
  } catch (err) {
    if (isProviderQuotaStopError(err)) throw err;
    if (isProviderQuotaLikeError(err)) {
      reportProviderQuotaExceeded('google_maps', 'step6_travel_times_quota_like');
      throw err;
    } else {
      console.error('[Pipeline V3] Step 6 failed:', err);
      throw new Error(`[Pipeline V3] Travel times computation failed: ${(err as Error).message}`);
    }
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
    if (isProviderQuotaStopError(err)) throw err;
    if (isProviderQuotaLikeError(err)) {
      reportProviderQuotaExceeded('serpapi', 'step7_restaurant_enrichment_quota_like');
      throw err;
    } else {
      console.error('[Pipeline V3] Step 7 failed:', err);
      throw new Error(`[Pipeline V3] Restaurant pool enrichment failed: ${(err as Error).message}`);
    }
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
  const startDateStr = preferences.startDate.toISOString().split('T')[0];
  const ratioEnforcement = enforceFinalActivityRatio(
    scheduledDays,
    allActivities,
    densityProfile.densityCategory as 'dense' | 'medium' | 'spread',
    ratioFeasibleBand,
  );
  if (ratioEnforcement.swaps > 0) {
    console.log(
      `[Pipeline V3] Ratio enforcer: ${ratioEnforcement.swaps} swap(s), iconic=${ratioEnforcement.ratio.iconic.toFixed(3)}`
    );
  }

  // Step 11b: Inject transport items (outbound + return) into day schedule
  if (scheduledDays.length > 0) {
    const day1 = scheduledDays[0];
    const lastDay = scheduledDays[scheduledDays.length - 1];
    const transportFallbackCoords = hotel
      ? { lat: hotel.latitude, lng: hotel.longitude }
      : data.destCoords;

    addOutboundTransportItem(day1, data.outboundFlight || null, bestTransport, preferences, transportFallbackCoords);
    addReturnTransportItem(lastDay, data.returnFlight || null, bestTransport, preferences, transportFallbackCoords);
    injectFirstLastMileTransfers(day1, lastDay);
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

  const postInjectionMustSeeRepairs: RepairAction[] = [];
  const postInjectionMustSeeUnresolved: string[] = [];
  ensureMustSees(
    scheduledDays,
    allActivities,
    startDateStr,
    postInjectionMustSeeRepairs,
    postInjectionMustSeeUnresolved
  );
  if (postInjectionMustSeeRepairs.length > 0) {
    console.log(`[Pipeline V3] Post-injection must-see recovery: ${postInjectionMustSeeRepairs.length} injection(s)`);
  }
  if (postInjectionMustSeeUnresolved.length > 0) {
    for (const msg of postInjectionMustSeeUnresolved) {
      console.warn(`[Pipeline V3] Post-injection must-see unresolved: ${msg}`);
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
      if (isProviderQuotaStopError(e)) throw e;
      console.warn('[Pipeline V3] Step 13: LLM review failed (non-blocking):', e);
    }
  }

  const routingPolicyByDay = new Map(
    clusters.map((cluster) => [cluster.dayNumber, cluster.routingPolicy || 'geo_optimized'])
  );

  // Step 10b: Post-scheduler geographic reorder (reduce zigzag)
  // Swap activity time slots to minimize total travel distance per day
  {
    for (const day of scheduledDays) {
      const actCount = day.items.filter((i) => i.type === 'activity').length;
      if (actCount > 2 && routingPolicyByDay.get(day.dayNumber) !== 'llm_locked') {
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

  const finalP02Fallbacks = enforceFinalRestaurantProximity(
    scheduledDays,
    densityProfile.densityCategory as 'dense' | 'medium' | 'spread'
  );
  if (finalP02Fallbacks > 0) {
    console.log(`[Pipeline V3] Final P0.2 guard: converted ${finalP02Fallbacks} distant meal(s) to Repas libre`);
  }

  const finalSemanticFallbacks = enforceFinalMealSemantics(scheduledDays);
  if (finalSemanticFallbacks > 0) {
    console.log(`[Pipeline V3] Final meal semantic guard: converted ${finalSemanticFallbacks} non-food meal(s) to Repas libre`);
  }

  const finalCoverageFallbacks = enforceFinalMealCoverage(scheduledDays, timeWindows);
  if (finalCoverageFallbacks > 0) {
    console.log(`[Pipeline V3] Final meal coverage guard: inserted ${finalCoverageFallbacks} fallback meal(s) for missing lunch/dinner`);
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
  const llmOrderPreservedRate = computeLlmOrderPreservedRate(clusters, scheduledDays);
  const destinationScopeStats = enforceDestinationEnvelopeOnTimeline(scheduledDays, effectiveDestinationEnvelope);
  const genericLabelPatchCount = sanitizeGenericTimelineLabels(scheduledDays);
  if (genericLabelPatchCount > 0) {
    console.log(`[Pipeline V3] Generic timeline labels sanitized: ${genericLabelPatchCount}`);
  }

  const originDestinationDistanceKm = computeOriginDestinationDistanceKm(preferences, data.destCoords);
  const requiresLonghaul = originDestinationDistanceKm > 30;
  const longhaulCoverage = collectLonghaulCoverage(scheduledDays);
  const longhaulViolations: string[] = [];
  if (requiresLonghaul) {
    if (!longhaulCoverage.hasOutbound) {
      longhaulViolations.push(
        `P0.11: Missing outbound long-haul transport (${preferences.origin} → ${preferences.destination}, ${originDestinationDistanceKm.toFixed(0)}km)`
      );
    }
    if (!longhaulCoverage.hasReturn) {
      longhaulViolations.push(
        `P0.11: Missing return long-haul transport (${preferences.destination} → ${preferences.origin}, ${originDestinationDistanceKm.toFixed(0)}km)`
      );
    }
  }

  // Step 10: Validate contracts
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
    effectiveDestinationEnvelope,
  );
  console.log(`[Pipeline V3] Step 10: Quality score ${contractResult.score}/100, Invariants: ${contractResult.invariantsPassed ? 'PASSED' : 'FAILED'}`);

  const contractsModeRaw = (process.env.PIPELINE_CONTRACTS_MODE || 'warn').toLowerCase();
  const contractsMode: 'strict' | 'warn' = contractsModeRaw === 'warn' ? 'warn' : 'strict';
  const unresolvedRepairViolations = [
    ...repairResult.unresolvedViolations.map(v => `REPAIR: ${v}`),
    ...postInjectionMustSeeUnresolved.map(v => `POST_INJECTION_REPAIR: ${v}`),
  ];
  const combinedContractViolations = [...unresolvedRepairViolations, ...contractResult.violations, ...longhaulViolations];
  const contractsPassed = contractResult.invariantsPassed && longhaulViolations.length === 0;
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
    invariantsPassed: contractsPassed,
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
  const totalLateMealReplacements =
    (repairResult.rescueDiagnostics?.lateMealReplacementCount ?? 0) + finalSemanticFallbacks + finalCoverageFallbacks;
  const totalMealSemanticReplacements =
    (repairResult.rescueDiagnostics?.mealSemanticReplacementCount ?? 0) + finalSemanticFallbacks;
  const totalMealFallbackCount =
    (repairResult.rescueDiagnostics?.mealFallbackCount ?? 0) + finalSemanticFallbacks + finalCoverageFallbacks;

  trip.plannerDiagnostics = {
    plannerVersion: 'v3.0',
    beamUsed: false,
    beamFallbackUsed: false,
    dayTripPackCount: dayTripPacks.length,
    repairRejectedCount: repairResult.unresolvedViolations.length,
    zigzagTurnsTotal,
    routeInefficiencyTotal: Number(routeInefficiencyTotal.toFixed(2)),
    criticalGeoCount,
    contractsPassed,
    rescueStage: 0,
    protectedBreakCount: repairResult.rescueDiagnostics?.protectedBreakCount ?? 0,
    lateMealReplacementCount: totalLateMealReplacements,
    mealSemanticReplacementCount: totalMealSemanticReplacements,
    dayNumberMismatchCount: 0,
    dayTripEvictionCount: repairResult.rescueDiagnostics?.dayTripEvictionCount ?? 0,
    finalIntegrityFailures: repairResult.rescueDiagnostics?.finalIntegrityFailures ?? 0,
    orphanTransportCount: repairResult.rescueDiagnostics?.orphanTransportCount ?? 0,
    teleportLegCount: repairResult.rescueDiagnostics?.teleportLegCount ?? 0,
    staleNarrativeCount: repairResult.rescueDiagnostics?.staleNarrativeCount ?? 0,
    freeTimeOverBudgetCount: repairResult.rescueDiagnostics?.freeTimeOverBudgetCount ?? 0,
    mealFallbackCount: totalMealFallbackCount,
    routeRebuildCount: repairResult.rescueDiagnostics?.routeRebuildCount ?? 0,
    restaurantRefetchMissCount: repairResult.rescueDiagnostics?.restaurantRefetchMissCount ?? 0,
    missingProtectedMustSeeCount,
    dayTripAtomicityBreakCount,
    arrivalFatigueViolationCount,
    temporalImpossibleItemCount,
    sparseFullCityDayCount,
    dayTripDestinationMismatchCount,
    sameFamilyOverloadCount,
    ratioMixSwapCount: ratioEnforcement.swaps,
    llmOrderPreservedRate,
    outsideEnvelopeRejectCount: destinationScopeStats.outsideEnvelopeRejectCount,
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
      {
        onSnapshot: options?.onSnapshot,
        runId: options?.runId,
        enableRunTrace: options?.enableRunTrace,
        travelStyleDecision: options?.travelStyleDecision,
      },
    );
  }

  console.log(`[Pipeline V3] Multi-city trip: ${cityPlan.map(c => `${c.city} (${c.days}d)`).join(' → ')}`);

  // Build per-city preferences with correct start dates
  const cityPrefsArray: Array<{ prefs: TripPreferences; index: number }> = [];
  const baseDate = new Date(preferences.startDate || new Date());
  let dateOffset = 0;
  for (let i = 0; i < cityPlan.length; i++) {
    const city = cityPlan[i];
    const cityDate = new Date(baseDate);
    cityDate.setDate(cityDate.getDate() + dateOffset);
    cityPrefsArray.push({
      prefs: {
        ...preferences,
        destination: city.city,
        durationDays: city.days,
        startDate: cityDate,
      },
      index: i,
    });
    dateOffset += city.days;
  }

  // Run all cities in parallel for speed (each city is independent)
  onEvent?.({
    type: 'info',
    label: 'multi-city',
    detail: `Planning ${cityPlan.length} cities in parallel...`,
    timestamp: Date.now(),
  });

  const segmentResults = await Promise.allSettled(
    cityPrefsArray.map(({ prefs, index }) =>
      generateTripV3(
        prefs,
        onEvent,
        {
          onSnapshot: options?.onSnapshot,
          runId: options?.runId ? `${options.runId}:seg${index + 1}` : undefined,
          enableRunTrace: options?.enableRunTrace,
          travelStyleDecision: options?.travelStyleDecision,
        },
      )
    )
  );

  const segments: Trip[] = [];
  for (let i = 0; i < segmentResults.length; i++) {
    const result = segmentResults[i];
    if (result.status === 'fulfilled') {
      segments.push(result.value);
    } else {
      console.error(`[Pipeline V3] Multi-city segment ${i + 1} (${cityPlan[i].city}) failed:`, result.reason);
      throw new Error(`Multi-city segment failed for ${cityPlan[i].city}: ${(result.reason as Error)?.message || String(result.reason)}`);
    }
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

  const mergedFreeTimeMinutesByDay = Object.fromEntries(
    mergedDays.map((day) => {
      const minutes = day.items
        .filter((item) => item.type === 'free_time')
        .reduce((sum, item) => sum + (item.duration || Math.max(0, timeToMin(item.endTime) - timeToMin(item.startTime))), 0);
      return [String(day.dayNumber), minutes];
    })
  );
  const mergedLonghaulDistanceKm = computeOriginDestinationDistanceKm(preferences, undefined);
  const mergedLonghaulRequired = mergedLonghaulDistanceKm > 30;
  const mergedLonghaulCoverage = collectLonghaulCoverage(mergedDays);

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
  mergedTrip.reliabilitySummary = {
    validatedCount: segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.validatedCount || 0), 0),
    replacedCount: segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.replacedCount || 0), 0),
    rejectedCount: segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.rejectedCount || 0), 0),
    groundingRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.groundingRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    ratioIconicLocal: {
      iconic: Number(
        (
          segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.ratioIconicLocal.iconic || 0), 0)
          / segments.length
        ).toFixed(3)
      ),
      localGem: Number(
        (
          segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.ratioIconicLocal.localGem || 0), 0)
          / segments.length
        ).toFixed(3)
      ),
    },
    ratioFeasibleBand: (() => {
      const bands = segments
        .map((segment) => segment.reliabilitySummary?.ratioFeasibleBand)
        .filter((band): band is RatioFeasibleBand => Boolean(band));
      if (bands.length === 0) return undefined;
      const avgLower = bands.reduce((sum, band) => sum + band.lower, 0) / bands.length;
      const avgUpper = bands.reduce((sum, band) => sum + band.upper, 0) / bands.length;
      const avgCatalog = bands.reduce((sum, band) => sum + band.catalogIconicRatio, 0) / bands.length;
      return {
        lower: Number(avgLower.toFixed(3)),
        upper: Number(avgUpper.toFixed(3)),
        catalogIconicRatio: Number(avgCatalog.toFixed(3)),
      };
    })(),
    realMealCoverage: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.realMealCoverage || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    freeTimeMinutesByDay: mergedFreeTimeMinutesByDay,
    hubConsistencyRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.reliabilitySummary?.hubConsistencyRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
  };
  mergedTrip.generationDiagnostics = {
    validationLatencyMs: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.validationLatencyMs || 0), 0),
    runId: options?.runId || undefined,
    plannerMode: segments.some((segment) => segment.generationDiagnostics?.plannerMode === 'llm_closed_world')
      ? 'llm_closed_world'
      : 'deterministic',
    llmSchedulerUsed: segments.some((segment) => Boolean(segment.generationDiagnostics?.llmSchedulerUsed)),
    fallbackReason: segments.find((segment) => segment.generationDiagnostics?.fallbackReason)?.generationDiagnostics?.fallbackReason,
    groundingRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.groundingRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    unknownIdRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.unknownIdRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    parseAttempts: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.parseAttempts || 0), 0),
    plannerBudgetMs: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.plannerBudgetMs || 0), 0)
        / segments.length
      ).toFixed(0)
    ),
    plannerTimeoutRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.plannerTimeoutRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    plannerTimeoutCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.plannerTimeoutCount || 0), 0),
    plannerTruncationCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.plannerTruncationCount || 0), 0),
    plannerFinishReasonCounts: mergeReasonCodeCounts(
      segments.map((segment) => segment.generationDiagnostics?.plannerFinishReasonCounts)
    ),
    closedWorldActivationRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.closedWorldActivationRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    geoFallbackUsed: segments.some((segment) => Boolean(segment.generationDiagnostics?.geoFallbackUsed)),
    geoScopeSource: segments.find((segment) => segment.generationDiagnostics?.geoScopeSource)
      ?.generationDiagnostics?.geoScopeSource,
    travelStyleDecision: options?.travelStyleDecision
      || segments.find((segment) => Boolean(segment.generationDiagnostics?.travelStyleDecision))
        ?.generationDiagnostics?.travelStyleDecision,
    questionFlow: {
      askedCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.questionFlow?.askedCount || 0), 0),
      autoDefaultCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.questionFlow?.autoDefaultCount || 0), 0),
      postDraftAdjustUsed: segments.some((segment) => Boolean(segment.generationDiagnostics?.questionFlow?.postDraftAdjustUsed)),
    },
    longhaulInjected: {
      required: mergedLonghaulRequired,
      outbound: mergedLonghaulCoverage.hasOutbound,
      return: mergedLonghaulCoverage.hasReturn,
      mode: mergedLonghaulCoverage.mode || 'unknown',
      source: mergedLonghaulCoverage.outboundFallback || mergedLonghaulCoverage.returnFallback ? 'fallback' : 'verified',
      distanceKm: Number(mergedLonghaulDistanceKm.toFixed(1)),
    },
    outsideEnvelopeRejectCount: segments.reduce(
      (sum, segment) => sum + (segment.generationDiagnostics?.outsideEnvelopeRejectCount || 0),
      0
    ),
    inspiredModeUsed: segments.some((segment) => Boolean(segment.generationDiagnostics?.inspiredModeUsed)),
    mealSemanticReplacements: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.mealSemanticReplacements || 0), 0),
    llmOrderPreservedRate: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.llmOrderPreservedRate || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    requestedDropCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.requestedDropCount || 0), 0),
    acceptedDropCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.acceptedDropCount || 0), 0),
    dropRecoveryCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.dropRecoveryCount || 0), 0),
    plannerProviderUsed: segments.find((segment) => segment.generationDiagnostics?.plannerProviderUsed && segment.generationDiagnostics.plannerProviderUsed !== 'deterministic')
      ?.generationDiagnostics?.plannerProviderUsed || 'deterministic',
    providerFallback: segments.some((segment) => Boolean(segment.generationDiagnostics?.providerFallback)),
    hubCoherenceScore: Number(
      (
        segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.hubCoherenceScore || 0), 0)
        / segments.length
      ).toFixed(3)
    ),
    reasonCodeCounts: mergeReasonCodeCounts(
      segments.map((segment) => segment.generationDiagnostics?.reasonCodeCounts)
    ),
    ratioFeasibleBand: (() => {
      const bands = segments
        .map((segment) => segment.generationDiagnostics?.ratioFeasibleBand)
        .filter((band): band is RatioFeasibleBand => Boolean(band));
      if (bands.length === 0) return undefined;
      const avgLower = bands.reduce((sum, band) => sum + band.lower, 0) / bands.length;
      const avgUpper = bands.reduce((sum, band) => sum + band.upper, 0) / bands.length;
      const avgCatalog = bands.reduce((sum, band) => sum + band.catalogIconicRatio, 0) / bands.length;
      return {
        lower: Number(avgLower.toFixed(3)),
        upper: Number(avgUpper.toFixed(3)),
        catalogIconicRatio: Number(avgCatalog.toFixed(3)),
      };
    })(),
    freeTimeMinutesByDay: mergedFreeTimeMinutesByDay,
    replacementCounts: {
      lateMealReplacementCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.replacementCounts?.lateMealReplacementCount || 0), 0),
      mealFallbackCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.replacementCounts?.mealFallbackCount || 0), 0),
      routeRebuildCount: segments.reduce((sum, segment) => sum + (segment.generationDiagnostics?.replacementCounts?.routeRebuildCount || 0), 0),
    },
    providerCallBreakdown: mergeValidationProviderBreakdowns(
      segments.map((segment) => segment.generationDiagnostics?.providerCallBreakdown)
    ),
    parallelismStats: mergeValidationParallelismStats(
      segments.map((segment) => segment.generationDiagnostics?.parallelismStats)
    ),
  };

  if (options?.enableRunTrace !== false) {
    mergedTrip.runTrace = {
      runId: options?.runId || buildRunId(),
      startedAt: segments[0]?.runTrace?.startedAt || new Date().toISOString(),
      endedAt: segments[segments.length - 1]?.runTrace?.endedAt || new Date().toISOString(),
      status: mergedTrip.qualityMetrics?.invariantsPassed ? 'done' : 'error',
      totalLatencyMs: segments.reduce((sum, segment) => sum + (segment.runTrace?.totalLatencyMs || 0), 0),
      estimatedCostEur: Number(
        segments.reduce((sum, segment) => sum + (segment.runTrace?.estimatedCostEur || 0), 0).toFixed(3)
      ),
      fallbackReasons: Array.from(new Set(
        segments.flatMap((segment) => segment.runTrace?.fallbackReasons || [])
      )),
      steps: segments.flatMap((segment) => segment.runTrace?.steps || []),
      llmAudit: segments.flatMap((segment) => segment.runTrace?.llmAudit || []),
      candidateDecisions: segments.flatMap((segment) => segment.runTrace?.candidateDecisions || []).slice(0, 1200),
      reasonCodeCounts: mergeReasonCodeCounts(segments.map((segment) => segment.runTrace?.reasonCodeCounts)),
    };
    mergedTrip.generationDiagnostics.runTrace = mergedTrip.runTrace;
  }

  return mergedTrip;
}

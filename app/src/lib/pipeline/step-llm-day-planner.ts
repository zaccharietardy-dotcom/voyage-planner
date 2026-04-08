/**
 * Pipeline V3 — Closed-world LLM Day Planner
 *
 * The LLM can only schedule with candidate IDs we provide in a verified catalog.
 * No free-text POI creation is accepted.
 */

import type { ActivityCluster, DayTripPack, ScoredActivity } from './types';
import type { DayTimeWindow } from './step4-anchor-transport';
import type { TripPreferences, Restaurant } from '../types';
import type { CityDensityProfile } from './types';
import { calculateDistance } from '../services/geocoding';
import { fetchGeminiPlannerFast } from '../services/geminiSearch';
import { trackEstimatedCost } from '../services/apiCostGuard';

type PlannerCandidateType = 'activity' | 'restaurant' | 'transport';
type PlannerKind = 'iconic' | 'local_gem';

export interface PlannerCatalogCandidate {
  candidateId: string;
  type: PlannerCandidateType;
  name: string;
  coords?: { lat: number; lng: number };
  durationBounds?: { min: number; max: number };
  openingWindows?: Record<string, { open: string; close: string } | null>;
  estimatedCost?: number;
  mustSee: boolean;
  zone: string;
  kind: PlannerKind;
  sourceId: string;
  originalDayNumber?: number;
  fixedDayNumber?: number;
}

export interface PlannerCatalog {
  destination: string;
  densityCategory: CityDensityProfile['densityCategory'];
  totalDays: number;
  candidates: PlannerCatalogCandidate[];
}

export interface DayPlanHint {
  dayNumber: number;
  candidateIds: string[];
  theme?: string;
}

export interface DayPlanHints {
  days: DayPlanHint[];
  ratioIconicLocal: { iconic: number; localGem: number };
  groundingRate: number;
  unknownIdRate: number;
  invalidCandidateRefs: string[];
  parseAttempts: number;
  latencyMs: number;
}

export interface ClosedWorldPlannerResult {
  clusters: ActivityCluster[];
  hints: DayPlanHints;
  catalog: PlannerCatalog;
}

export interface ClosedWorldPlannerAttempt {
  result: ClosedWorldPlannerResult | null;
  failureReason?: string;
  groundingRate: number;
  unknownIdRate: number;
  parseAttempts: number;
  latencyMs: number;
}

interface ParsedDayPlanPayload {
  days: Array<{ dayNumber?: number; candidateIds?: unknown; theme?: unknown }>;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function timeToMinSimple(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const UNKNOWN_ID_RATE_MAX = 0.2;
const MIN_GROUNDING_RATE = 0.6;
const ICONIC_RATIO_MIN = 0.55;
const ICONIC_RATIO_MAX = 0.65;
const MIN_PLANNER_ATTEMPT_TIMEOUT_MS = 3000;
const MAX_PLANNER_ATTEMPT_TIMEOUT_MS = 14000;
const PLANNER_ATTEMPT_GUARD_MS = 800;

function extractStrictJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      // continue
    }
  }

  return null;
}

function computeRatio(candidates: PlannerCatalogCandidate[]): { iconic: number; localGem: number } {
  const relevant = candidates.filter((candidate) => candidate.type === 'activity');
  if (relevant.length === 0) return { iconic: 0.6, localGem: 0.4 };
  const iconic = relevant.filter((candidate) => candidate.kind === 'iconic').length;
  const iconicRatio = iconic / relevant.length;
  return {
    iconic: Number(iconicRatio.toFixed(3)),
    localGem: Number((1 - iconicRatio).toFixed(3)),
  };
}

function shouldLockActivity(activity: ScoredActivity, cluster: ActivityCluster): boolean {
  return Boolean(
    activity.mustSee
    || activity.protectedReason === 'must_see'
    || activity.protectedReason === 'day_trip'
    || activity.protectedReason === 'day_trip_anchor'
    || activity.protectedReason === 'user_forced'
    || cluster.isDayTrip
    || cluster.isFullDay
  );
}

function activityKind(activity: ScoredActivity): PlannerKind {
  if (activity.mustSee || activity.source === 'mustsee' || activity.protectedReason === 'must_see') {
    return 'iconic';
  }
  return 'local_gem';
}

export function buildPlannerCatalog(
  clusters: ActivityCluster[],
  restaurants: Restaurant[],
  dayTripPacks: DayTripPack[],
  destination: string,
  densityCategory: CityDensityProfile['densityCategory'],
): PlannerCatalog {
  const candidates: PlannerCatalogCandidate[] = [];
  const seenCandidateIds = new Set<string>();

  for (const cluster of clusters) {
    const zone = cluster.dayTripDestination || `day-${cluster.dayNumber}`;
    for (const activity of cluster.activities) {
      const sourceId = activity.id || `${activity.name}:${cluster.dayNumber}`;
      const candidateId = `act:${normalizeText(sourceId).replace(/\s+/g, '-').slice(0, 64)}`;
      if (!candidateId || seenCandidateIds.has(candidateId)) continue;
      seenCandidateIds.add(candidateId);

      const duration = Math.max(30, activity.duration || 90);
      const locked = shouldLockActivity(activity, cluster);

      candidates.push({
        candidateId,
        type: 'activity',
        name: activity.name,
        coords: { lat: activity.latitude, lng: activity.longitude },
        durationBounds: { min: Math.max(30, duration - 30), max: Math.min(360, duration + 60) },
        openingWindows: activity.openingHoursByDay as Record<string, { open: string; close: string } | null> | undefined,
        estimatedCost: activity.estimatedCost || 0,
        mustSee: Boolean(activity.mustSee),
        zone,
        kind: activityKind(activity),
        sourceId,
        originalDayNumber: cluster.dayNumber,
        fixedDayNumber: locked ? cluster.dayNumber : undefined,
      });
    }
  }

  const restaurantSample = restaurants
    .filter((restaurant) => Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude))
    .slice(0, 40);
  for (const restaurant of restaurantSample) {
    const sourceId = restaurant.id || restaurant.name || '';
    if (!sourceId) continue;
    const candidateId = `rest:${normalizeText(sourceId).replace(/\s+/g, '-').slice(0, 64)}`;
    if (seenCandidateIds.has(candidateId)) continue;
    seenCandidateIds.add(candidateId);

    candidates.push({
      candidateId,
      type: 'restaurant',
      name: restaurant.name || 'Restaurant',
      coords: { lat: restaurant.latitude, lng: restaurant.longitude },
      durationBounds: { min: 45, max: 120 },
      estimatedCost: restaurant.priceLevel ? restaurant.priceLevel * 15 : undefined,
      mustSee: false,
      zone: normalizeText(restaurant.address || destination || 'destination').slice(0, 48) || 'destination',
      kind: 'local_gem',
      sourceId,
    });
  }

  for (const pack of dayTripPacks) {
    const sourceId = pack.id || pack.destination;
    const candidateId = `transport:${normalizeText(sourceId).replace(/\s+/g, '-').slice(0, 64)}`;
    if (!candidateId || seenCandidateIds.has(candidateId)) continue;
    seenCandidateIds.add(candidateId);

    const anchor = pack.anchor;
    candidates.push({
      candidateId,
      type: 'transport',
      name: `${destination} -> ${pack.destination}`,
      coords: { lat: anchor.latitude, lng: anchor.longitude },
      durationBounds: { min: Math.max(20, pack.outboundDurationMin - 15), max: Math.max(45, pack.outboundDurationMin + 25) },
      estimatedCost: 0,
      mustSee: false,
      zone: normalizeText(pack.destination),
      kind: 'local_gem',
      sourceId,
      originalDayNumber: undefined,
      fixedDayNumber: undefined,
    });
  }

  return {
    destination,
    densityCategory,
    totalDays: clusters.length,
    candidates,
  };
}

function buildPrompt(
  catalog: PlannerCatalog,
  preferences: TripPreferences,
  timeWindows: DayTimeWindow[],
): string {
  const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
  const lines = activityCandidates.map((candidate) => {
    const fixed = candidate.fixedDayNumber ? `FIXED_DAY=${candidate.fixedDayNumber}` : 'MOVABLE';
    const dur = candidate.durationBounds ? `${candidate.durationBounds.min}-${candidate.durationBounds.max}min` : '60-120min';
    const scoreHint = candidate.kind === 'iconic' ? 'iconic' : 'local_gem';
    const mustSee = candidate.mustSee ? 'must_see' : 'optional';
    const zone = candidate.zone || 'destination';
    return `- id=${candidate.candidateId} | name=${candidate.name} | ${scoreHint} | ${mustSee} | zone=${zone} | duration=${dur} | ${fixed}`;
  });

  const windows = timeWindows.map((window) => {
    const capacity = Math.max(0, timeToMinSimple(window.activityEndTime) - timeToMinSimple(window.activityStartTime));
    const role = window.hasArrivalTransport ? 'arrival' : window.hasDepartureTransport ? 'departure' : 'full_day';
    return `Jour ${window.dayNumber}: ${window.activityStartTime}-${window.activityEndTime} (${capacity}min, ${role})`;
  });

  return [
    `Tu planifies un voyage pour ${preferences.destination}.`,
    `Répartis les activités avec une logique narrative solide et géographiquement cohérente.`,
    `Style: ${preferences.travelStyle || 'auto'}, groupe: ${preferences.groupType}, budget: ${preferences.budgetLevel}.`,
    '',
    'FENÊTRES JOURNALIÈRES:',
    windows.join('\n'),
    '',
    'CATALOGUE ACTIVITÉS (closed-world):',
    lines.join('\n'),
    '',
    'RÈGLES STRICTES:',
    '1) Utilise uniquement les candidateIds fournis (aucun nom libre).',
    '2) Les IDs FIXED_DAY doivent rester sur ce jour.',
    '3) Aucun doublon, aucune suppression: toutes les activités doivent être assignées.',
    '4) Vise un ratio 60/40 iconique/pépites (bande 55-65% iconique).',
    '5) Évite le zigzag: privilégie les activités de même zone le même jour.',
    '6) Respecte la capacité de chaque jour (somme durées dans la fenêtre).',
    '',
    'FORMAT JSON OBLIGATOIRE:',
    '{',
    '  "days": [',
    '    { "dayNumber": 1, "candidateIds": ["act:..."], "theme": "..." }',
    '  ]',
    '}',
  ].join('\n');
}

function buildRepairPrompt(
  catalog: PlannerCatalog,
  timeWindows: DayTimeWindow[],
  invalidRaw: string,
): string {
  const windows = timeWindows.map((window) => {
    const role = window.hasArrivalTransport ? 'arrival' : window.hasDepartureTransport ? 'departure' : 'full_day';
    return `Jour ${window.dayNumber}: ${window.activityStartTime}-${window.activityEndTime} (${role})`;
  });
  const ids = catalog.candidates
    .filter((candidate) => candidate.type === 'activity')
    .map((candidate) => candidate.candidateId)
    .join(', ');

  return [
    'Répare le JSON ci-dessous en sortie STRICTEMENT valide.',
    'Ne change pas les intentions, corrige uniquement le format/structure.',
    'IMPORTANT: utilise uniquement ces candidateIds:',
    ids,
    '',
    'Fenêtres:',
    windows.join('\n'),
    '',
    'Format OBLIGATOIRE:',
    '{"days":[{"dayNumber":1,"candidateIds":["act:..."],"theme":"..."}]}',
    '',
    'Règles:',
    '- dayNumber entier',
    '- candidateIds tableau de strings uniquement',
    '- aucun texte hors JSON',
    '',
    'JSON à réparer:',
    invalidRaw,
  ].join('\n');
}

function normalizeParsedPayload(
  parsed: ParsedDayPlanPayload | Array<{ dayNumber?: number; candidateIds?: unknown; theme?: unknown }>
): ParsedDayPlanPayload | null {
  const rows = Array.isArray(parsed) ? parsed : parsed.days;
  if (!Array.isArray(rows)) return null;

  const normalized: ParsedDayPlanPayload['days'] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    if (!Number.isInteger(row.dayNumber)) return null;
    if (!Array.isArray(row.candidateIds)) return null;
    if (row.candidateIds.some((id) => typeof id !== 'string')) return null;
    if (row.theme !== undefined && typeof row.theme !== 'string') return null;
    normalized.push({
      dayNumber: row.dayNumber,
      candidateIds: row.candidateIds,
      theme: row.theme,
    });
  }

  if (normalized.length === 0) return null;
  return { days: normalized };
}

function parseDayHints(rawText: string): ParsedDayPlanPayload | null {
  const parsed = extractStrictJson<ParsedDayPlanPayload | Array<{ dayNumber?: number; candidateIds?: unknown; theme?: unknown }>>(rawText);
  if (!parsed) return null;
  return normalizeParsedPayload(parsed);
}

async function callPlannerRawText(
  prompt: string,
  attemptTimeoutMs: number,
  maxRetries: number,
): Promise<{ rawText: string } | { failureReason: string }> {
  try {
    const response = await fetchGeminiPlannerFast({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 3000,
          responseMimeType: 'application/json',
        },
      }, {
        timeoutMs: attemptTimeoutMs,
        maxRetries,
        retryDelayMs: 450,
      });

    if (!(response instanceof Response)) {
      return { failureReason: 'planner_timeout' };
    }
    if (response.status === 408) {
      return { failureReason: 'planner_timeout' };
    }
    if (!response.ok) {
      return { failureReason: `planner_http_${response.status}` };
    }

    const payload = await response.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) {
      return { failureReason: 'planner_empty_response' };
    }
    return { rawText };
  } catch {
    return { failureReason: 'planner_call_error' };
  }
}

function rebuildClustersFromHints(
  hints: ParsedDayPlanPayload,
  catalog: PlannerCatalog,
  originalClusters: ActivityCluster[],
): {
  clusters: ActivityCluster[];
  groundingRate: number;
  unknownIdRate: number;
  invalidCandidateRefs: string[];
  ratioIconicLocal: { iconic: number; localGem: number };
} {
  const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
  const candidateById = new Map(activityCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const activityBySourceId = new Map<string, ScoredActivity>();

  for (const cluster of originalClusters) {
    for (const activity of cluster.activities) {
      const key = activity.id || `${activity.name}:${cluster.dayNumber}`;
      activityBySourceId.set(key, activity);
    }
  }

  const normalizedByDay = new Map<number, string[]>();
  const globallyAssigned = new Set<string>();
  const invalidCandidateRefs: string[] = [];
  let totalRequestedRefs = 0;
  let totalValidRefs = 0;
  const requestedCandidates: PlannerCatalogCandidate[] = [];

  for (const day of hints.days) {
    const dayNumber = Number(day.dayNumber);
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > originalClusters.length) continue;
    const ids = Array.isArray(day.candidateIds) ? day.candidateIds : [];
    const accepted: string[] = [];

    for (const rawId of ids) {
      if (typeof rawId !== 'string') continue;
      totalRequestedRefs++;
      const candidate = candidateById.get(rawId);
      if (!candidate) {
        invalidCandidateRefs.push(rawId);
        continue;
      }
      totalValidRefs++;
      requestedCandidates.push(candidate);
      if (globallyAssigned.has(rawId)) continue;
      globallyAssigned.add(rawId);
      accepted.push(rawId);
    }
    normalizedByDay.set(dayNumber, accepted);
  }

  // Enforce fixed activities to stay on their required day.
  for (const candidate of activityCandidates) {
    if (!candidate.fixedDayNumber) continue;
    const fixedDay = candidate.fixedDayNumber;
    const sourceDayIds = normalizedByDay.get(fixedDay) || [];
    if (!sourceDayIds.includes(candidate.candidateId)) {
      // Remove from any other day.
      for (const [dayNumber, ids] of normalizedByDay.entries()) {
        if (dayNumber === fixedDay) continue;
        const idx = ids.indexOf(candidate.candidateId);
        if (idx >= 0) ids.splice(idx, 1);
      }
      sourceDayIds.unshift(candidate.candidateId);
      normalizedByDay.set(fixedDay, sourceDayIds);
      globallyAssigned.add(candidate.candidateId);
    }
  }

  // Put unassigned activities back to their original day.
  for (const candidate of activityCandidates) {
    if (globallyAssigned.has(candidate.candidateId)) continue;
    const fallbackDay = candidate.originalDayNumber || 1;
    const ids = normalizedByDay.get(fallbackDay) || [];
    ids.push(candidate.candidateId);
    normalizedByDay.set(fallbackDay, ids);
    globallyAssigned.add(candidate.candidateId);
  }

  const rebuilt: ActivityCluster[] = [];
  for (let dayNumber = 1; dayNumber <= originalClusters.length; dayNumber++) {
    const original = originalClusters[dayNumber - 1];
    const dayIds = normalizedByDay.get(dayNumber) || [];
    const dayActivities: ScoredActivity[] = [];
    for (const candidateId of dayIds) {
      const candidate = candidateById.get(candidateId);
      if (!candidate) continue;
      const activity = activityBySourceId.get(candidate.sourceId);
      if (!activity) continue;
      dayActivities.push(activity);
    }

    // Hard fallback: never produce an empty day from planner hints.
    const finalActivities = dayActivities.length > 0 ? dayActivities : original.activities;
    const centroid = finalActivities.length > 0
      ? {
          lat: finalActivities.reduce((sum, activity) => sum + activity.latitude, 0) / finalActivities.length,
          lng: finalActivities.reduce((sum, activity) => sum + activity.longitude, 0) / finalActivities.length,
        }
      : original.centroid;

    let intra = 0;
    for (let i = 1; i < finalActivities.length; i++) {
      intra += calculateDistance(
        finalActivities[i - 1].latitude,
        finalActivities[i - 1].longitude,
        finalActivities[i].latitude,
        finalActivities[i].longitude,
      );
    }

    rebuilt.push({
      dayNumber,
      activities: finalActivities,
      centroid,
      totalIntraDistance: intra,
      maxRadius: original.maxRadius,
      isFullDay: original.isFullDay,
      isDayTrip: original.isDayTrip,
      dayTripDestination: original.dayTripDestination,
      plannerRole: original.plannerRole,
    });
  }

  const usedCandidates = rebuilt.flatMap((cluster) => cluster.activities.map((activity) => {
    const sourceId = activity.id || `${activity.name}:${cluster.dayNumber}`;
    const match = activityCandidates.find((candidate) => candidate.sourceId === sourceId);
    return match;
  })).filter(Boolean) as PlannerCatalogCandidate[];

  const ratioIconicLocal = computeRatio(requestedCandidates.length > 0 ? requestedCandidates : usedCandidates);
  const groundingRate = totalRequestedRefs > 0 ? totalValidRefs / totalRequestedRefs : 0;
  const unknownIdRate = totalRequestedRefs > 0 ? invalidCandidateRefs.length / totalRequestedRefs : 0;

  return {
    clusters: rebuilt,
    groundingRate,
    unknownIdRate,
    invalidCandidateRefs,
    ratioIconicLocal,
  };
}

export async function attemptClosedWorldDayPlanning(
  params: {
    clusters: ActivityCluster[];
    restaurants: Restaurant[];
    dayTripPacks: DayTripPack[];
    preferences: TripPreferences;
    timeWindows: DayTimeWindow[];
    densityCategory: CityDensityProfile['densityCategory'];
    maxPlannerLatencyMs?: number;
  }
): Promise<ClosedWorldPlannerAttempt> {
  const t0 = Date.now();
  const maxPlannerLatencyMs = Math.max(4000, params.maxPlannerLatencyMs ?? 12000);
  const plannerDeadlineMs = t0 + maxPlannerLatencyMs;
  let parseAttempts = 0;

  const catalog = buildPlannerCatalog(
    params.clusters,
    params.restaurants,
    params.dayTripPacks,
    params.preferences.destination || '',
    params.densityCategory,
  );

  const activityCount = catalog.candidates.filter((candidate) => candidate.type === 'activity').length;
  if (activityCount < 4) {
    return {
      result: null,
      failureReason: 'not_enough_candidates',
      groundingRate: 0,
      unknownIdRate: 0,
      parseAttempts,
      latencyMs: Date.now() - t0,
    };
  }

  const primaryPrompt = buildPrompt(catalog, params.preferences, params.timeWindows);
  trackEstimatedCost('llm_closed_world_planner', 0.008);

  const callWithRemainingBudget = async (prompt: string): Promise<{ rawText: string } | { failureReason: string }> => {
    parseAttempts++;
    const remainingMs = plannerDeadlineMs - Date.now();
    if (remainingMs <= MIN_PLANNER_ATTEMPT_TIMEOUT_MS + PLANNER_ATTEMPT_GUARD_MS) {
      return { failureReason: 'planner_timeout' };
    }
    const attemptTimeoutMs = Math.max(
      MIN_PLANNER_ATTEMPT_TIMEOUT_MS,
      Math.min(MAX_PLANNER_ATTEMPT_TIMEOUT_MS, remainingMs - PLANNER_ATTEMPT_GUARD_MS)
    );
    return callPlannerRawText(prompt, attemptTimeoutMs, 0);
  };

  const firstAttempt = await callWithRemainingBudget(primaryPrompt);
  if ('failureReason' in firstAttempt) {
    return {
      result: null,
      failureReason: firstAttempt.failureReason,
      groundingRate: 0,
      unknownIdRate: 0,
      parseAttempts,
      latencyMs: Date.now() - t0,
    };
  }

  let parsed = parseDayHints(firstAttempt.rawText);
  if (!parsed) {
    const repairPrompt = buildRepairPrompt(catalog, params.timeWindows, firstAttempt.rawText);
    const retryAttempt = await callWithRemainingBudget(repairPrompt);
    if ('failureReason' in retryAttempt) {
      return {
        result: null,
        failureReason: retryAttempt.failureReason,
        groundingRate: 0,
        unknownIdRate: 0,
        parseAttempts,
        latencyMs: Date.now() - t0,
      };
    }
    parsed = parseDayHints(retryAttempt.rawText);
    if (!parsed) {
      return {
        result: null,
        failureReason: 'planner_parse_invalid',
        groundingRate: 0,
        unknownIdRate: 0,
        parseAttempts,
        latencyMs: Date.now() - t0,
      };
    }
  }

  const rebuilt = rebuildClustersFromHints(parsed, catalog, params.clusters);
  if (rebuilt.unknownIdRate > UNKNOWN_ID_RATE_MAX) {
    return {
      result: null,
      failureReason: 'unknown_id_rate_high',
      groundingRate: rebuilt.groundingRate,
      unknownIdRate: rebuilt.unknownIdRate,
      parseAttempts,
      latencyMs: Date.now() - t0,
    };
  }
  if (rebuilt.groundingRate < MIN_GROUNDING_RATE) {
    return {
      result: null,
      failureReason: 'grounding_below_threshold',
      groundingRate: rebuilt.groundingRate,
      unknownIdRate: rebuilt.unknownIdRate,
      parseAttempts,
      latencyMs: Date.now() - t0,
    };
  }

  if (rebuilt.ratioIconicLocal.iconic < ICONIC_RATIO_MIN || rebuilt.ratioIconicLocal.iconic > ICONIC_RATIO_MAX) {
    return {
      result: null,
      failureReason: 'ratio_out_of_band',
      groundingRate: rebuilt.groundingRate,
      unknownIdRate: rebuilt.unknownIdRate,
      parseAttempts,
      latencyMs: Date.now() - t0,
    };
  }

  const normalizedDays: DayPlanHint[] = [];
  for (let dayNumber = 1; dayNumber <= params.clusters.length; dayNumber++) {
    const parsedDay = parsed.days.find((day) => Number(day.dayNumber) === dayNumber);
    const parsedIds = Array.isArray(parsedDay?.candidateIds)
      ? parsedDay!.candidateIds.filter((value): value is string => typeof value === 'string')
      : [];
    normalizedDays.push({
      dayNumber,
      candidateIds: parsedIds,
      theme: typeof parsedDay?.theme === 'string' ? parsedDay.theme : '',
    });
  }

  return {
    result: {
      clusters: rebuilt.clusters,
      catalog,
      hints: {
        days: normalizedDays,
        ratioIconicLocal: rebuilt.ratioIconicLocal,
        groundingRate: rebuilt.groundingRate,
        unknownIdRate: rebuilt.unknownIdRate,
        invalidCandidateRefs: rebuilt.invalidCandidateRefs,
        parseAttempts,
        latencyMs: Date.now() - t0,
      },
    },
    groundingRate: rebuilt.groundingRate,
    unknownIdRate: rebuilt.unknownIdRate,
    parseAttempts,
    latencyMs: Date.now() - t0,
  };
}

export const __test__ = {
  parseDayHints,
  rebuildClustersFromHints,
};

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
import { isApiBudgetExceededError, trackEstimatedCost } from '../services/apiCostGuard';
import { isProviderQuotaStopError } from '../services/providerQuotaGuard';

type PlannerProvider = 'gemini' | 'anthropic' | 'gpt';
type PlannerCandidateType = 'activity' | 'restaurant' | 'transport';
type PlannerKind = 'iconic' | 'local_gem';

export interface PlannerRatioFeasibleBand {
  lower: number;
  upper: number;
  catalogIconicRatio: number;
}

export interface PlannerCatalogCandidate {
  candidateId: string;
  type: PlannerCandidateType;
  name: string;
  qualityScore?: number;
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
  protectedReason?: ScoredActivity['protectedReason'];
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
  dropCandidateIds?: string[];
  theme?: string;
  narrative?: string;
  activityTips?: Record<string, string>;
  mealContext?: Record<string, string>;
  routeNotes?: Record<string, string>;
}

export interface LLMEnrichments {
  dayThemes: Record<number, string>;
  dayNarratives: Record<number, string>;
  activityTips: Record<string, string>;
  mealContext: { [dayNumber: number]: Record<string, string> };
  routeNotes: Record<string, string>;
}

export interface DayPlanHints {
  days: DayPlanHint[];
  ratioIconicLocal: { iconic: number; localGem: number };
  groundingRate: number;
  unknownIdRate: number;
  invalidCandidateRefs: string[];
  parseAttempts: number;
  latencyMs: number;
  requestedDropCount: number;
  acceptedDropCount: number;
  dropRecoveryCount: number;
  ratioFeasibleBand: PlannerRatioFeasibleBand;
  reasonCodeCounts: Record<string, number>;
}

export interface ClosedWorldPlannerResult {
  clusters: ActivityCluster[];
  hints: DayPlanHints;
  catalog: PlannerCatalog;
  enrichments: LLMEnrichments;
}

export interface ClosedWorldPlannerAttempt {
  result: ClosedWorldPlannerResult | null;
  failureReason?: string;
  groundingRate: number;
  unknownIdRate: number;
  parseAttempts: number;
  latencyMs: number;
  providerUsed?: PlannerProvider;
  providerFallback: boolean;
  plannerAudit: PlannerAuditEntry[];
  candidateDecisionEvents?: CandidateDecisionEvent[];
  reasonCodeCounts?: Record<string, number>;
}

export interface PlannerAuditEntry {
  provider: PlannerProvider;
  attempt: number;
  promptType: 'primary' | 'repair_json';
  parseStatus: 'ok' | 'invalid_json' | 'call_failed';
  latencyMs: number;
  attemptTimeoutMs?: number;
  requestedOutputTokens?: number;
  responseStatus?: number;
  failureReason?: string;
  promptRedacted: string;
  rawResponsePreview?: string;
  rawResponseTail?: string;
  rawResponseLength?: number;
  finishReason?: string;
  outputTokens?: number;
}

export interface CandidateDecisionEvent {
  candidateId: string;
  dayNumber?: number;
  stage: 'proposed' | 'grounding' | 'assignment' | 'drop' | 'recovery';
  decision: 'keep' | 'reject' | 'drop' | 'reinsert' | 'recover';
  reasonCode: string;
}

interface ParsedDayPlanPayload {
  days: Array<{
    dayNumber?: number;
    candidateIds?: unknown;
    dropCandidateIds?: unknown;
    theme?: unknown;
    narrative?: unknown;
    activityTips?: unknown;
    mealContext?: unknown;
    routeNotes?: unknown;
  }>;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function timeToMinSimple(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const UNKNOWN_ID_RATE_MAX = 0.2;
const MIN_GROUNDING_RATE = 0.6;
const MIN_PLANNER_ATTEMPT_TIMEOUT_MS = 4000;
const MAX_PLANNER_ATTEMPT_TIMEOUT_MS = 40000;
const PLANNER_ATTEMPT_GUARD_MS = 800;
const PRIMARY_ATTEMPT_SOFT_CAP_MS = 12000;
const MIN_ACTIVITY_CATALOG_SIZE = 12;
const MAX_ACTIVITY_CATALOG_SIZE = 72;
const MAX_DECISION_EVENTS = 1200;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
function cleanPotentialJson(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function extractStrictJson<T>(raw: string): T | null {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  if (trimmed) candidates.push(trimmed);

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  for (const candidateRaw of candidates) {
    const candidate = cleanPotentialJson(candidateRaw);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
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

export function computeFeasibleRatioBand(candidates: PlannerCatalogCandidate[]): PlannerRatioFeasibleBand {
  const relevant = candidates.filter((candidate) => candidate.type === 'activity');
  if (relevant.length === 0) {
    return { lower: 0.5, upper: 0.7, catalogIconicRatio: 0.6 };
  }
  const iconicCount = relevant.filter((candidate) => candidate.kind === 'iconic').length;
  const catalogIconicRatio = iconicCount / relevant.length;
  const lower = Math.max(0.35, catalogIconicRatio - 0.10);
  const upper = Math.min(0.80, catalogIconicRatio + 0.10);
  return {
    lower: Number(lower.toFixed(3)),
    upper: Number(upper.toFixed(3)),
    catalogIconicRatio: Number(catalogIconicRatio.toFixed(3)),
  };
}

function isProtectedDropCandidate(candidate: PlannerCatalogCandidate): boolean {
  return Boolean(
    candidate.mustSee
    || candidate.fixedDayNumber
    || candidate.protectedReason === 'must_see'
    || candidate.protectedReason === 'day_trip'
    || candidate.protectedReason === 'day_trip_anchor'
    || candidate.protectedReason === 'user_forced'
  );
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
        qualityScore: Number.isFinite(activity.score) ? activity.score : undefined,
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
        protectedReason: activity.protectedReason,
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

function computePlannerActivityCap(
  totalDays: number,
  densityCategory: CityDensityProfile['densityCategory'],
  maxPlannerLatencyMs: number,
): number {
  const safeDays = Math.max(1, totalDays || 1);
  const densityBase = densityCategory === 'spread'
    ? safeDays * 7 + 8
    : densityCategory === 'medium'
      ? safeDays * 6 + 8
      : safeDays * 5 + 6;
  const latencyPenalty = maxPlannerLatencyMs < 12_000
    ? 16
    : maxPlannerLatencyMs < 20_000
      ? 8
      : 0;
  const capped = densityBase - latencyPenalty;
  return Math.max(MIN_ACTIVITY_CATALOG_SIZE, Math.min(MAX_ACTIVITY_CATALOG_SIZE, capped));
}

function candidatePriority(candidate: PlannerCatalogCandidate): number {
  const baseScore = Number.isFinite(candidate.qualityScore) ? Number(candidate.qualityScore) : 0;
  const protectedBonus = isProtectedDropCandidate(candidate) ? 120 : 0;
  const fixedBonus = candidate.fixedDayNumber ? 60 : 0;
  const mustSeeBonus = candidate.mustSee ? 40 : 0;
  const localGemBonus = candidate.kind === 'local_gem' ? 4 : 0;
  return baseScore + protectedBonus + fixedBonus + mustSeeBonus + localGemBonus;
}

function compactPlannerCatalog(
  catalog: PlannerCatalog,
  options: { maxActivityCandidates: number }
): PlannerCatalog {
  const maxActivityCandidates = Math.max(MIN_ACTIVITY_CATALOG_SIZE, options.maxActivityCandidates);
  const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
  if (activityCandidates.length <= maxActivityCandidates) return catalog;

  const protectedActivities = activityCandidates.filter((candidate) => isProtectedDropCandidate(candidate));
  const movableActivities = activityCandidates.filter((candidate) => !isProtectedDropCandidate(candidate));

  const selected = new Map<string, PlannerCatalogCandidate>();
  for (const candidate of protectedActivities) {
    selected.set(candidate.candidateId, candidate);
  }

  if (selected.size > maxActivityCandidates) {
    const keepIds = new Set(
      [...selected.values()]
        .sort((left, right) => candidatePriority(right) - candidatePriority(left))
        .slice(0, maxActivityCandidates)
        .map((candidate) => candidate.candidateId)
    );
    return {
      ...catalog,
      candidates: catalog.candidates.filter((candidate) => candidate.type !== 'activity' || keepIds.has(candidate.candidateId)),
    };
  }

  const remainingSlots = maxActivityCandidates - selected.size;
  if (remainingSlots <= 0) {
    const keepIds = new Set(selected.keys());
    return {
      ...catalog,
      candidates: catalog.candidates.filter((candidate) => candidate.type !== 'activity' || keepIds.has(candidate.candidateId)),
    };
  }

  const dayBuckets = new Map<number, PlannerCatalogCandidate[]>();
  for (const candidate of movableActivities) {
    const dayNumber = candidate.originalDayNumber || candidate.fixedDayNumber || 1;
    if (!dayBuckets.has(dayNumber)) dayBuckets.set(dayNumber, []);
    dayBuckets.get(dayNumber)!.push(candidate);
  }
  for (const bucket of dayBuckets.values()) {
    bucket.sort((left, right) => candidatePriority(right) - candidatePriority(left));
  }

  const dayNumbers = [...dayBuckets.keys()].sort((left, right) => left - right);
  const targetFloorPerDay = dayNumbers.length > 0
    ? Math.max(1, Math.floor(Math.min(remainingSlots, dayNumbers.length * 2) / dayNumbers.length))
    : 0;

  for (const dayNumber of dayNumbers) {
    const bucket = dayBuckets.get(dayNumber) || [];
    let taken = 0;
    while (bucket.length > 0 && taken < targetFloorPerDay && selected.size < maxActivityCandidates) {
      const candidate = bucket.shift();
      if (!candidate || selected.has(candidate.candidateId)) continue;
      selected.set(candidate.candidateId, candidate);
      taken++;
    }
  }

  if (selected.size < maxActivityCandidates) {
    const leftovers = movableActivities
      .filter((candidate) => !selected.has(candidate.candidateId))
      .sort((left, right) => candidatePriority(right) - candidatePriority(left));
    for (const candidate of leftovers) {
      if (selected.size >= maxActivityCandidates) break;
      selected.set(candidate.candidateId, candidate);
    }
  }

  const keepIds = new Set(selected.keys());
  return {
    ...catalog,
    candidates: catalog.candidates.filter((candidate) => candidate.type !== 'activity' || keepIds.has(candidate.candidateId)),
  };
}

function buildPrompt(
  catalog: PlannerCatalog,
  preferences: TripPreferences,
  timeWindows: DayTimeWindow[],
): string {
  const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
  const ratioBand = computeFeasibleRatioBand(activityCandidates);
  const movableCount = activityCandidates.filter((candidate) => !isProtectedDropCandidate(candidate)).length;
  const dropCap = Math.min(3, Math.floor(movableCount * 0.15));
  const lines = activityCandidates.map((candidate) => {
    const fixed = candidate.fixedDayNumber ? `FIXED_DAY=${candidate.fixedDayNumber}` : 'MOVABLE';
    const dur = candidate.durationBounds ? `${candidate.durationBounds.min}-${candidate.durationBounds.max}min` : '60-120min';
    const scoreHint = candidate.kind === 'iconic' ? 'iconic' : 'local_gem';
    const mustSee = candidate.mustSee ? 'must_see' : 'optional';
    const zone = candidate.zone || 'destination';
    const compactName = (candidate.name || '').slice(0, 34);
    return `- id=${candidate.candidateId} | n=${compactName} | ${scoreHint} | ${mustSee} | z=${zone} | dur=${dur} | ${fixed}`;
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
    `3) Tu peux supprimer des candidats movables, mais reste sous ${dropCap} drops globaux (must-see/fixed interdits).`,
    `4) Vise un ratio iconique réaliste dans la bande ${Math.round(ratioBand.lower * 100)}-${Math.round(ratioBand.upper * 100)}% (catalog=${Math.round(ratioBand.catalogIconicRatio * 100)}%).`,
    '5) Évite le zigzag: privilégie les activités de même zone le même jour.',
    '6) Respecte la capacité de chaque jour (somme durées dans la fenêtre).',
    '',
    'ENRICHISSEMENT NARRATIF:',
    '7) Pour chaque jour, écris "theme" (titre évocateur 8-12 mots) et "narrative" (2 phrases immersives décrivant l\'arc de la journée).',
    '8) Pour chaque activité, écris un "activityTips" (1-2 phrases conseil PRUDENT: meilleur moment, astuce locale, détail surprenant). PAS de faits durs non vérifiables (pas "ouvert depuis 1973", pas "marée basse à 9h47"). Préfère "vérifiez les horaires de marée".',
    '9) Pour chaque repas (lunch/dinner), écris un "mealContext": 1 phrase décrivant la cuisine locale de la zone (pas un restaurant spécifique).',
    '10) Pour chaque trajet entre deux activités consécutives, écris un "routeNotes" (clé "idFrom->idTo"): 1 phrase sur ce qu\'on voit en chemin.',
    '11) CONSCIENCE TEMPORELLE: viewpoints en fin d\'après-midi, marchés le matin, musées tôt ou tard (moins de monde), plages en milieu de journée.',
    '',
    'FORMAT JSON OBLIGATOIRE:',
    '{',
    '  "days": [',
    '    {',
    '      "dayNumber": 1,',
    '      "candidateIds": ["act:..."],',
    '      "dropCandidateIds": ["act:..."],',
    '      "theme": "Titre évocateur du jour",',
    '      "narrative": "2 phrases immersives.",',
    '      "activityTips": { "act:xxx": "Conseil prudent 1-2 phrases" },',
    '      "mealContext": { "lunch": "Cuisine locale de la zone", "dinner": "..." },',
    '      "routeNotes": { "act:a->act:b": "Ce qu\'on voit en chemin" }',
    '    }',
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
    '{"days":[{"dayNumber":1,"candidateIds":["act:..."],"dropCandidateIds":["act:..."],"theme":"..."}]}',
    '',
    'Règles:',
    '- dayNumber entier',
    '- candidateIds tableau de strings uniquement',
    '- dropCandidateIds tableau de strings uniquement (optionnel)',
    '- aucun texte hors JSON',
    '',
    'JSON à réparer:',
    invalidRaw.slice(0, 2200),
  ].join('\n');
}

function buildCompactRepairPrompt(
  catalog: PlannerCatalog,
  timeWindows: DayTimeWindow[],
): string {
  const ids = catalog.candidates
    .filter((candidate) => candidate.type === 'activity')
    .map((candidate) => candidate.candidateId)
    .join(', ');
  const windows = timeWindows
    .map((window) => `J${window.dayNumber}:${window.activityStartTime}-${window.activityEndTime}`)
    .join(' | ');

  return [
    'Réponds UNIQUEMENT en JSON compact valide.',
    'Objectif: planifier par candidateIds, sans texte libre.',
    `Jours: ${windows}`,
    `IDs autorisés: ${ids}`,
    'Format strict:',
    '{"days":[{"dayNumber":1,"candidateIds":["act:..."],"dropCandidateIds":["act:..."]}]}',
    'Contraintes: dayNumber entier, candidateIds/dropCandidateIds tableaux de strings.',
  ].join('\n');
}

function isTruncationFinishReason(finishReason?: string): boolean {
  if (!finishReason) return false;
  const normalized = finishReason.toLowerCase();
  return normalized.includes('max_tokens')
    || normalized.includes('length')
    || normalized.includes('max_output_tokens')
    || normalized.includes('token_limit');
}

function safeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
      result[k] = v.trim();
      count++;
    }
  }
  return count > 0 ? result : undefined;
}

function normalizeParsedPayload(
  parsed: ParsedDayPlanPayload | Array<ParsedDayPlanPayload['days'][number]>
): ParsedDayPlanPayload | null {
  const rows = Array.isArray(parsed) ? parsed : parsed.days;
  if (!Array.isArray(rows)) return null;

  const normalized: ParsedDayPlanPayload['days'] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    if (!Number.isInteger(row.dayNumber)) return null;
    if (!Array.isArray(row.candidateIds)) return null;
    if (row.candidateIds.some((id) => typeof id !== 'string')) return null;
    if (row.dropCandidateIds !== undefined && (!Array.isArray(row.dropCandidateIds) || row.dropCandidateIds.some((id) => typeof id !== 'string'))) {
      return null;
    }
    if (row.theme !== undefined && typeof row.theme !== 'string') return null;
    normalized.push({
      dayNumber: row.dayNumber,
      candidateIds: row.candidateIds,
      dropCandidateIds: row.dropCandidateIds,
      theme: row.theme,
      narrative: typeof row.narrative === 'string' ? row.narrative.trim() : undefined,
      activityTips: safeStringRecord(row.activityTips),
      mealContext: safeStringRecord(row.mealContext),
      routeNotes: safeStringRecord(row.routeNotes),
    });
  }

  if (normalized.length === 0) return null;
  return { days: normalized };
}

function extractEnrichments(parsed: ParsedDayPlanPayload): LLMEnrichments {
  const enrichments: LLMEnrichments = {
    dayThemes: {},
    dayNarratives: {},
    activityTips: {},
    mealContext: {} as { [dayNumber: number]: Record<string, string> },
    routeNotes: {},
  };
  for (const day of parsed.days) {
    const dn = day.dayNumber ?? 0;
    if (typeof day.theme === 'string' && day.theme.trim()) {
      enrichments.dayThemes[dn] = day.theme.trim();
    }
    if (typeof day.narrative === 'string' && day.narrative.trim()) {
      enrichments.dayNarratives[dn] = day.narrative.trim();
    }
    if (day.activityTips) {
      for (const [k, v] of Object.entries(day.activityTips)) {
        enrichments.activityTips[k] = v;
      }
    }
    if (day.mealContext && Object.keys(day.mealContext).length > 0) {
      enrichments.mealContext[dn] = day.mealContext as Record<string, string>;
    }
    if (day.routeNotes) {
      for (const [k, v] of Object.entries(day.routeNotes)) {
        enrichments.routeNotes[k] = v;
      }
    }
  }
  return enrichments;
}

function parseDayHints(rawText: string): ParsedDayPlanPayload | null {
  const parsed = extractStrictJson<ParsedDayPlanPayload | Array<ParsedDayPlanPayload['days'][number]>>(rawText);
  if (!parsed) return null;
  return normalizeParsedPayload(parsed);
}

function redactPrompt(prompt: string): string {
  return prompt
    .replace(/act:[a-z0-9-]+/gi, 'act:<id>')
    .replace(/\b\d{2}:\d{2}\b/g, '<time>')
    .slice(0, 1800);
}

function extractOpenAIText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }
  return chunks.join('\n').trim();
}

function extractGeminiText(payload: any): string {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  if (candidates.length === 0) return '';
  const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && part.text.trim()) {
      chunks.push(part.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function extractAnthropicText(payload: any): string {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const chunks: string[] = [];
  for (const part of content) {
    if (part?.type === 'text' && typeof part?.text === 'string' && part.text.trim()) {
      chunks.push(part.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

async function fetchOpenAiPlannerFast(
  prompt: string,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    maxOutputTokens?: number;
  } = {}
): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'openai_api_key_missing', status: 'UNAVAILABLE' } }), { status: 503 });
  }

  const timeoutMs = Math.max(1500, options.timeoutMs ?? 7000);
  const maxRetries = Math.max(0, options.maxRetries ?? 0);
  const retryDelayMs = Math.max(200, options.retryDelayMs ?? 450);
  const maxOutputTokens = Math.max(500, Math.min(4500, options.maxOutputTokens ?? 2400));
  const model = process.env.OPENAI_PLANNER_MODEL || 'gpt-5-mini';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: prompt,
          text: { format: { type: 'json_object' } },
          reasoning: { effort: 'low' },
          max_output_tokens: maxOutputTokens,
        }),
        signal: controller.signal,
      });
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          continue;
        }
        return new Response(JSON.stringify({ error: { message: 'planner timeout', status: 'DEADLINE_EXCEEDED' } }), { status: 408 });
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      }
      return new Response(JSON.stringify({ error: { message: 'planner call failed', status: 'UNAVAILABLE' } }), { status: 503 });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return new Response(JSON.stringify({ error: { message: 'planner timeout', status: 'DEADLINE_EXCEEDED' } }), { status: 408 });
}

async function fetchAnthropicPlannerFast(
  prompt: string,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    maxOutputTokens?: number;
  } = {}
): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'anthropic_api_key_missing', status: 'UNAVAILABLE' } }), { status: 503 });
  }

  const timeoutMs = Math.max(1500, options.timeoutMs ?? 7000);
  const maxRetries = Math.max(0, options.maxRetries ?? 0);
  const retryDelayMs = Math.max(200, options.retryDelayMs ?? 450);
  const maxOutputTokens = Math.max(500, Math.min(4500, options.maxOutputTokens ?? 2000));
  const model = process.env.ANTHROPIC_PLANNER_MODEL || 'claude-haiku-4-5';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxOutputTokens,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          continue;
        }
        return new Response(JSON.stringify({ error: { message: 'planner timeout', status: 'DEADLINE_EXCEEDED' } }), { status: 408 });
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      }
      return new Response(JSON.stringify({ error: { message: 'planner call failed', status: 'UNAVAILABLE' } }), { status: 503 });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return new Response(JSON.stringify({ error: { message: 'planner timeout', status: 'DEADLINE_EXCEEDED' } }), { status: 408 });
}

async function callPlannerRawText(
  prompt: string,
  attemptTimeoutMs: number,
  maxRetries: number,
  provider: PlannerProvider,
  maxOutputTokens: number,
): Promise<{
  rawText: string;
  responseStatus: number;
  finishReason?: string;
  outputTokens?: number;
} | { failureReason: string; responseStatus?: number }> {
  try {
    const response = provider === 'gpt'
      ? await fetchOpenAiPlannerFast(prompt, {
          timeoutMs: attemptTimeoutMs,
          maxRetries,
          retryDelayMs: 450,
          maxOutputTokens,
        })
      : provider === 'anthropic'
        ? await fetchAnthropicPlannerFast(prompt, {
            timeoutMs: attemptTimeoutMs,
            maxRetries,
            retryDelayMs: 450,
            maxOutputTokens,
          })
        : await fetchGeminiPlannerFast({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens,
              responseMimeType: 'application/json',
            },
          }, {
            timeoutMs: attemptTimeoutMs,
            maxRetries,
            retryDelayMs: 450,
            caller: 'day_planner',
          });

    if (!(response instanceof Response)) {
      return { failureReason: 'planner_timeout' };
    }
    if (response.status === 408) {
      return { failureReason: 'planner_timeout', responseStatus: response.status };
    }
    if (!response.ok) {
      return { failureReason: `planner_http_${response.status}`, responseStatus: response.status };
    }

    const payload = await response.json();
    const rawText = provider === 'gpt'
      ? extractOpenAIText(payload)
      : provider === 'anthropic'
        ? extractAnthropicText(payload)
        : extractGeminiText(payload);
    if (!rawText) {
      return { failureReason: 'planner_empty_response', responseStatus: response.status };
    }
    const finishReason = provider === 'gpt'
      ? undefined
      : provider === 'anthropic'
        ? payload?.stop_reason
        : payload?.candidates?.[0]?.finishReason;
    const outputTokens = provider === 'anthropic'
      ? Number(payload?.usage?.output_tokens || 0) || undefined
      : Number(payload?.usageMetadata?.candidatesTokenCount || 0) || undefined;
    return { rawText, responseStatus: response.status, finishReason, outputTokens };
  } catch (error) {
    if (isProviderQuotaStopError(error) || isApiBudgetExceededError(error)) {
      throw error;
    }
    return { failureReason: 'planner_call_error' };
  }
}

function rebuildClustersFromHints(
  hints: ParsedDayPlanPayload,
  catalog: PlannerCatalog,
  originalClusters: ActivityCluster[],
  timeWindows: DayTimeWindow[] = [],
): {
  clusters: ActivityCluster[];
  groundingRate: number;
  unknownIdRate: number;
  invalidCandidateRefs: string[];
  ratioIconicLocal: { iconic: number; localGem: number };
  requestedDropCount: number;
  acceptedDropCount: number;
  dropRecoveryCount: number;
  ratioFeasibleBand: PlannerRatioFeasibleBand;
  reasonCodeCounts: Record<string, number>;
  candidateDecisionEvents: CandidateDecisionEvent[];
} {
  const activityCandidates = catalog.candidates.filter((candidate) => candidate.type === 'activity');
  const ratioFeasibleBand = computeFeasibleRatioBand(activityCandidates);
  const candidateById = new Map(activityCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const candidateBySourceId = new Map(activityCandidates.map((candidate) => [candidate.sourceId, candidate]));
  const activityBySourceId = new Map<string, ScoredActivity>();
  const reasonCodeCounts: Record<string, number> = {};
  const candidateDecisionEvents: CandidateDecisionEvent[] = [];
  const pushDecision = (event: CandidateDecisionEvent) => {
    reasonCodeCounts[event.reasonCode] = (reasonCodeCounts[event.reasonCode] || 0) + 1;
    if (candidateDecisionEvents.length < MAX_DECISION_EVENTS) {
      candidateDecisionEvents.push(event);
    }
  };

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
  const requestedDropIds = new Set<string>();

  const isTransitDay = (dayNumber: number): boolean => {
    const timeWindow = timeWindows.find((window) => window.dayNumber === dayNumber);
    if (timeWindow?.hasArrivalTransport || timeWindow?.hasDepartureTransport) return true;
    const cluster = originalClusters[dayNumber - 1];
    return cluster?.plannerRole === 'arrival' || cluster?.plannerRole === 'departure';
  };

  for (const day of hints.days) {
    const dayNumber = Number(day.dayNumber);
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > originalClusters.length) continue;
    const ids = Array.isArray(day.candidateIds) ? day.candidateIds : [];
    const accepted: string[] = [];

    for (const rawId of ids) {
      if (typeof rawId !== 'string') continue;
      totalRequestedRefs++;
      pushDecision({
        candidateId: rawId,
        dayNumber,
        stage: 'proposed',
        decision: 'keep',
        reasonCode: 'llm_proposed',
      });
      const candidate = candidateById.get(rawId);
      if (!candidate) {
        invalidCandidateRefs.push(rawId);
        pushDecision({
          candidateId: rawId,
          dayNumber,
          stage: 'grounding',
          decision: 'reject',
          reasonCode: 'unknown_candidate_id',
        });
        continue;
      }
      totalValidRefs++;
      pushDecision({
        candidateId: rawId,
        dayNumber,
        stage: 'grounding',
        decision: 'keep',
        reasonCode: 'candidate_id_valid',
      });
      if (globallyAssigned.has(rawId)) continue;
      globallyAssigned.add(rawId);
      accepted.push(rawId);
    }
    const dropIds = Array.isArray(day.dropCandidateIds) ? day.dropCandidateIds : [];
    for (const rawDropId of dropIds) {
      if (typeof rawDropId !== 'string') continue;
      totalRequestedRefs++;
      pushDecision({
        candidateId: rawDropId,
        dayNumber,
        stage: 'drop',
        decision: 'drop',
        reasonCode: 'llm_requested_drop',
      });
      const candidate = candidateById.get(rawDropId);
      if (!candidate) {
        invalidCandidateRefs.push(rawDropId);
        pushDecision({
          candidateId: rawDropId,
          dayNumber,
          stage: 'grounding',
          decision: 'reject',
          reasonCode: 'unknown_candidate_id',
        });
        continue;
      }
      totalValidRefs++;
      requestedDropIds.add(rawDropId);
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
      pushDecision({
        candidateId: candidate.candidateId,
        dayNumber: fixedDay,
        stage: 'assignment',
        decision: 'reinsert',
        reasonCode: 'fixed_day_enforced',
      });
    }
  }

  // Explicit LLM drops: remove from assigned days before constraint checks.
  for (const droppedCandidateId of requestedDropIds) {
    const candidate = candidateById.get(droppedCandidateId);
    if (!candidate) continue;
    if (isProtectedDropCandidate(candidate)) {
      pushDecision({
        candidateId: droppedCandidateId,
        dayNumber: candidate.fixedDayNumber || candidate.originalDayNumber,
        stage: 'drop',
        decision: 'reject',
        reasonCode: 'protected_drop_rejected',
      });
      continue;
    }
    for (const [dayNumber, ids] of normalizedByDay.entries()) {
      const idx = ids.indexOf(droppedCandidateId);
      if (idx < 0) continue;
      ids.splice(idx, 1);
      normalizedByDay.set(dayNumber, ids);
      globallyAssigned.delete(droppedCandidateId);
      pushDecision({
        candidateId: droppedCandidateId,
        dayNumber,
        stage: 'drop',
        decision: 'drop',
        reasonCode: 'drop_applied',
      });
    }
  }

  const requestedDropCandidates = new Map<string, PlannerCatalogCandidate>();

  // Implicit drops for movable unassigned candidates.
  for (const candidate of activityCandidates) {
    if (globallyAssigned.has(candidate.candidateId)) continue;
    if (isProtectedDropCandidate(candidate)) {
      const fallbackDay = candidate.fixedDayNumber || candidate.originalDayNumber || 1;
      const ids = normalizedByDay.get(fallbackDay) || [];
      if (!ids.includes(candidate.candidateId)) ids.unshift(candidate.candidateId);
      normalizedByDay.set(fallbackDay, ids);
      globallyAssigned.add(candidate.candidateId);
      pushDecision({
        candidateId: candidate.candidateId,
        dayNumber: fallbackDay,
        stage: 'assignment',
        decision: 'reinsert',
        reasonCode: 'protected_unassigned_reinserted',
      });
    } else {
      requestedDropCandidates.set(candidate.candidateId, candidate);
      pushDecision({
        candidateId: candidate.candidateId,
        dayNumber: candidate.originalDayNumber,
        stage: 'drop',
        decision: 'drop',
        reasonCode: 'implicit_movable_drop_request',
      });
    }
  }
  for (const droppedCandidateId of requestedDropIds) {
    const candidate = candidateById.get(droppedCandidateId);
    if (!candidate || isProtectedDropCandidate(candidate)) continue;
    requestedDropCandidates.set(candidate.candidateId, candidate);
  }

  const movableCandidates = activityCandidates.filter((candidate) => !isProtectedDropCandidate(candidate));
  const globalDropCap = Math.min(3, Math.floor(movableCandidates.length * 0.15));
  const acceptedDropIds = new Set<string>();
  const acceptedDropsByDay = new Map<number, number>();

  const requestedDropList = [...requestedDropCandidates.values()].sort((left, right) => {
    const leftDay = left.originalDayNumber || left.fixedDayNumber || 1;
    const rightDay = right.originalDayNumber || right.fixedDayNumber || 1;
    if (leftDay !== rightDay) return leftDay - rightDay;
    return left.candidateId.localeCompare(right.candidateId);
  });

  for (const candidate of requestedDropList) {
    const fallbackDay = candidate.originalDayNumber || candidate.fixedDayNumber || 1;
    if (acceptedDropIds.size >= globalDropCap) {
      pushDecision({
        candidateId: candidate.candidateId,
        dayNumber: fallbackDay,
        stage: 'drop',
        decision: 'reject',
        reasonCode: 'drop_cap_global_reached',
      });
      continue;
    }
    if (!isTransitDay(fallbackDay) && (acceptedDropsByDay.get(fallbackDay) || 0) >= 1) {
      pushDecision({
        candidateId: candidate.candidateId,
        dayNumber: fallbackDay,
        stage: 'drop',
        decision: 'reject',
        reasonCode: 'drop_cap_day_reached',
      });
      continue;
    }
    acceptedDropIds.add(candidate.candidateId);
    acceptedDropsByDay.set(fallbackDay, (acceptedDropsByDay.get(fallbackDay) || 0) + 1);
    pushDecision({
      candidateId: candidate.candidateId,
      dayNumber: fallbackDay,
      stage: 'drop',
      decision: 'drop',
      reasonCode: 'drop_accepted',
    });
  }

  // Reinsert non-accepted drops on their original/fixed day.
  for (const candidate of requestedDropList) {
    if (acceptedDropIds.has(candidate.candidateId)) continue;
    const fallbackDay = candidate.fixedDayNumber || candidate.originalDayNumber || 1;
    const ids = normalizedByDay.get(fallbackDay) || [];
    if (!ids.includes(candidate.candidateId)) ids.push(candidate.candidateId);
    normalizedByDay.set(fallbackDay, ids);
    globallyAssigned.add(candidate.candidateId);
    pushDecision({
      candidateId: candidate.candidateId,
      dayNumber: fallbackDay,
      stage: 'assignment',
      decision: 'reinsert',
      reasonCode: 'drop_rejected_reinsert',
    });
  }

  let dropRecoveryCount = 0;

  // Guarantee minimum useful activities/day.
  for (let dayNumber = 1; dayNumber <= originalClusters.length; dayNumber++) {
    const dayIds = normalizedByDay.get(dayNumber) || [];
    const minActivities = isTransitDay(dayNumber) ? 1 : 2;
    if (dayIds.length >= minActivities) {
      normalizedByDay.set(dayNumber, dayIds);
      continue;
    }

    let missing = minActivities - dayIds.length;
    const original = originalClusters[dayNumber - 1];
    const dayZone = original?.dayTripDestination || `day-${dayNumber}`;
    const dayCentroid = original?.centroid;

    const refillPool = [...acceptedDropIds]
      .map((candidateId) => candidateById.get(candidateId))
      .filter((candidate): candidate is PlannerCatalogCandidate => Boolean(candidate))
      .sort((left, right) => {
        const leftSameDay = (left.originalDayNumber || 0) === dayNumber ? 0 : 1;
        const rightSameDay = (right.originalDayNumber || 0) === dayNumber ? 0 : 1;
        if (leftSameDay !== rightSameDay) return leftSameDay - rightSameDay;
        const leftSameZone = left.zone === dayZone ? 0 : 1;
        const rightSameZone = right.zone === dayZone ? 0 : 1;
        if (leftSameZone !== rightSameZone) return leftSameZone - rightSameZone;
        const leftShort = (left.durationBounds?.max || 120) <= 120 ? 0 : 1;
        const rightShort = (right.durationBounds?.max || 120) <= 120 ? 0 : 1;
        if (leftShort !== rightShort) return leftShort - rightShort;
        if (!dayCentroid || !left.coords || !right.coords) return left.candidateId.localeCompare(right.candidateId);
        const leftDist = calculateDistance(dayCentroid.lat, dayCentroid.lng, left.coords.lat, left.coords.lng);
        const rightDist = calculateDistance(dayCentroid.lat, dayCentroid.lng, right.coords.lat, right.coords.lng);
        return leftDist - rightDist;
      });

    for (const candidate of refillPool) {
      if (missing <= 0) break;
      if (!acceptedDropIds.has(candidate.candidateId)) continue;
      if (dayIds.includes(candidate.candidateId)) continue;
      dayIds.push(candidate.candidateId);
      acceptedDropIds.delete(candidate.candidateId);
      globallyAssigned.add(candidate.candidateId);
      missing--;
      dropRecoveryCount++;
      pushDecision({
        candidateId: candidate.candidateId,
        dayNumber,
        stage: 'recovery',
        decision: 'recover',
        reasonCode: 'day_minimum_recovery_from_drop',
      });
    }

    if (missing > 0) {
      for (const activity of original?.activities || []) {
        if (missing <= 0) break;
        const sourceId = activity.id || `${activity.name}:${original.dayNumber}`;
        const candidate = candidateBySourceId.get(sourceId);
        if (!candidate) continue;
        if (dayIds.includes(candidate.candidateId)) continue;
        if (globallyAssigned.has(candidate.candidateId)) continue;
        dayIds.push(candidate.candidateId);
        globallyAssigned.add(candidate.candidateId);
        missing--;
        pushDecision({
          candidateId: candidate.candidateId,
          dayNumber,
          stage: 'recovery',
          decision: 'recover',
          reasonCode: 'day_minimum_recovery_from_original',
        });
      }
    }

    normalizedByDay.set(dayNumber, dayIds);
  }

  const rebuilt: ActivityCluster[] = [];
  const usedCandidateIds = new Set<string>();
  for (let dayNumber = 1; dayNumber <= originalClusters.length; dayNumber++) {
    const original = originalClusters[dayNumber - 1];
    const dayIds = normalizedByDay.get(dayNumber) || [];
    const dayActivities: ScoredActivity[] = [];
    for (let orderIndex = 0; orderIndex < dayIds.length; orderIndex++) {
      const candidateId = dayIds[orderIndex];
      const candidate = candidateById.get(candidateId);
      if (!candidate) continue;
      const activity = activityBySourceId.get(candidate.sourceId);
      if (!activity) continue;
      dayActivities.push({
        ...activity,
        llmOrderIndex: orderIndex,
      });
      usedCandidateIds.add(candidateId);
      pushDecision({
        candidateId,
        dayNumber,
        stage: 'assignment',
        decision: 'keep',
        reasonCode: 'assigned_to_day',
      });
    }

    // Hard fallback safety: never produce an empty day from planner hints.
    const finalActivities = dayActivities.length > 0
      ? dayActivities
      : original.activities.slice(0, Math.max(1, isTransitDay(dayNumber) ? 1 : Math.min(2, original.activities.length))).map((activity, index) => ({
          ...activity,
          llmOrderIndex: index,
        }));
    if (dayActivities.length === 0) {
      reasonCodeCounts['empty_day_hard_fallback'] = (reasonCodeCounts['empty_day_hard_fallback'] || 0) + 1;
    }
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
      routingPolicy: 'llm_locked',
    });
  }

  const usedCandidates = [...usedCandidateIds]
    .map((candidateId) => candidateById.get(candidateId))
    .filter((candidate): candidate is PlannerCatalogCandidate => Boolean(candidate));

  const ratioIconicLocal = computeRatio(usedCandidates.length > 0 ? usedCandidates : activityCandidates);
  const groundingRate = totalRequestedRefs > 0 ? totalValidRefs / totalRequestedRefs : 0;
  const unknownIdRate = totalRequestedRefs > 0 ? invalidCandidateRefs.length / totalRequestedRefs : 0;

  return {
    clusters: rebuilt,
    groundingRate,
    unknownIdRate,
    invalidCandidateRefs,
    ratioIconicLocal,
    requestedDropCount: requestedDropList.length,
    acceptedDropCount: acceptedDropIds.size,
    dropRecoveryCount,
    ratioFeasibleBand,
    reasonCodeCounts,
    candidateDecisionEvents,
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
    enableGptFallback?: boolean;
  }
): Promise<ClosedWorldPlannerAttempt> {
  const t0 = Date.now();
  const enforceRatioBand =
    !isTruthyEnvFlag(process.env.PIPELINE_LLM_RATIO_GATE_DISABLE)
    && !isTruthyEnvFlag(process.env.PIPELINE_LLM_BENCH_MODE);
  const maxPlannerLatencyMs = Math.max(4000, params.maxPlannerLatencyMs ?? 12000);
  const plannerDeadlineMs = t0 + maxPlannerLatencyMs;
  let parseAttempts = 0;
  const plannerAudit: PlannerAuditEntry[] = [];

  const fullCatalog = buildPlannerCatalog(
    params.clusters,
    params.restaurants,
    params.dayTripPacks,
    params.preferences.destination || '',
    params.densityCategory,
  );

  const maxActivityCandidates = computePlannerActivityCap(
    fullCatalog.totalDays,
    params.densityCategory,
    maxPlannerLatencyMs,
  );
  const catalog = compactPlannerCatalog(fullCatalog, { maxActivityCandidates });

  const activityCount = catalog.candidates.filter((candidate) => candidate.type === 'activity').length;
  if (activityCount < 4) {
    return {
      result: null,
      failureReason: 'not_enough_candidates',
      groundingRate: 0,
      unknownIdRate: 0,
      parseAttempts,
      latencyMs: Date.now() - t0,
      providerFallback: false,
      plannerAudit,
    };
  }

  const primaryPrompt = buildPrompt(catalog, params.preferences, params.timeWindows);
  const plannerOutputTokens = Math.min(
    2600,
    Math.max(1000, params.clusters.length * 220 + activityCount * 24)
  );

  const providerOrder: PlannerProvider[] = ['gemini'];
  if (params.enableGptFallback && process.env.OPENAI_API_KEY) {
    providerOrder.push('gpt');
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providerOrder.push('anthropic');
  }

  const callWithRemainingBudget = async (
    provider: PlannerProvider,
    promptType: 'primary' | 'repair_json',
    prompt: string,
    providersRemaining: number,
    options?: { maxOutputTokens?: number },
  ): Promise<{
    rawText: string;
    responseStatus: number;
    finishReason?: string;
    outputTokens?: number;
  } | { failureReason: string; responseStatus?: number }> => {
    parseAttempts++;
    const outputTokenBudget = Math.max(
      700,
      Math.min(3000, options?.maxOutputTokens || plannerOutputTokens),
    );
    const remainingMs = plannerDeadlineMs - Date.now();
    const reserveForOtherProviders = Math.max(0, providersRemaining - 1) * (MIN_PLANNER_ATTEMPT_TIMEOUT_MS + PLANNER_ATTEMPT_GUARD_MS);
    const reserveForRepair = promptType === 'primary'
      ? (MIN_PLANNER_ATTEMPT_TIMEOUT_MS + PLANNER_ATTEMPT_GUARD_MS)
      : 0;
    const availableMs = remainingMs - reserveForOtherProviders - reserveForRepair;
    if (availableMs <= MIN_PLANNER_ATTEMPT_TIMEOUT_MS + PLANNER_ATTEMPT_GUARD_MS) {
      plannerAudit.push({
        provider,
        attempt: parseAttempts,
        promptType,
        parseStatus: 'call_failed',
        latencyMs: 0,
        attemptTimeoutMs: 0,
        requestedOutputTokens: outputTokenBudget,
        failureReason: 'planner_timeout',
        promptRedacted: redactPrompt(prompt),
      });
      return { failureReason: 'planner_timeout' };
    }
    const attemptTimeoutMs = Math.max(
      MIN_PLANNER_ATTEMPT_TIMEOUT_MS,
      Math.min(
        MAX_PLANNER_ATTEMPT_TIMEOUT_MS,
        providersRemaining > 1 ? PRIMARY_ATTEMPT_SOFT_CAP_MS : MAX_PLANNER_ATTEMPT_TIMEOUT_MS,
        availableMs - PLANNER_ATTEMPT_GUARD_MS,
      )
    );
    trackEstimatedCost(
      provider === 'gpt'
        ? 'llm_closed_world_planner_gpt'
        : provider === 'anthropic'
          ? 'llm_closed_world_planner_anthropic'
          : 'llm_closed_world_planner',
      provider === 'gpt' ? 0.015 : provider === 'anthropic' ? 0.012 : 0.008
    );
    const attemptStartedAt = Date.now();
    const attemptResult = await callPlannerRawText(prompt, attemptTimeoutMs, 0, provider, outputTokenBudget);
    const latencyMs = Date.now() - attemptStartedAt;
    if ('failureReason' in attemptResult) {
      plannerAudit.push({
        provider,
        attempt: parseAttempts,
        promptType,
        parseStatus: 'call_failed',
        latencyMs,
        attemptTimeoutMs,
        requestedOutputTokens: outputTokenBudget,
        responseStatus: attemptResult.responseStatus,
        failureReason: attemptResult.failureReason,
        promptRedacted: redactPrompt(prompt),
      });
      return attemptResult;
    }
    plannerAudit.push({
      provider,
      attempt: parseAttempts,
      promptType,
      parseStatus: parseDayHints(attemptResult.rawText) ? 'ok' : 'invalid_json',
      latencyMs,
      attemptTimeoutMs,
      requestedOutputTokens: outputTokenBudget,
      responseStatus: attemptResult.responseStatus,
      finishReason: attemptResult.finishReason,
      outputTokens: attemptResult.outputTokens,
      promptRedacted: redactPrompt(prompt),
      rawResponsePreview: attemptResult.rawText.slice(0, 600),
      rawResponseTail: attemptResult.rawText.slice(-240),
      rawResponseLength: attemptResult.rawText.length,
    });
    return attemptResult;
  };

  let lastFailureReason = 'llm_scheduler_failed';
  let lastGroundingRate = 0;
  let lastUnknownIdRate = 0;
  let lastReasonCodeCounts: Record<string, number> | undefined;
  let lastCandidateDecisionEvents: CandidateDecisionEvent[] | undefined;

  for (let providerIndex = 0; providerIndex < providerOrder.length; providerIndex++) {
    const provider = providerOrder[providerIndex];
    const providersRemaining = providerOrder.length - providerIndex;
    const firstAttempt = await callWithRemainingBudget(provider, 'primary', primaryPrompt, providersRemaining);
    if ('failureReason' in firstAttempt) {
      lastFailureReason = firstAttempt.failureReason;
      if (providerIndex < providerOrder.length - 1) continue;
      return {
        result: null,
        failureReason: lastFailureReason,
        groundingRate: 0,
        unknownIdRate: 0,
        parseAttempts,
        latencyMs: Date.now() - t0,
        providerFallback: providerIndex > 0,
        providerUsed: provider,
        plannerAudit,
      };
    }

    let parsed = parseDayHints(firstAttempt.rawText);
    if (!parsed) {
      const firstAttemptTruncated = isTruncationFinishReason(firstAttempt.finishReason);
      const repairPrompt = firstAttemptTruncated
        ? buildCompactRepairPrompt(catalog, params.timeWindows)
        : buildRepairPrompt(catalog, params.timeWindows, firstAttempt.rawText);
      const retryAttempt = await callWithRemainingBudget(
        provider,
        'repair_json',
        repairPrompt,
        providersRemaining,
        { maxOutputTokens: firstAttemptTruncated ? Math.min(3000, plannerOutputTokens + 500) : plannerOutputTokens },
      );
      if ('failureReason' in retryAttempt) {
        lastFailureReason = retryAttempt.failureReason;
        if (providerIndex < providerOrder.length - 1) continue;
        return {
          result: null,
          failureReason: lastFailureReason,
          groundingRate: 0,
          unknownIdRate: 0,
          parseAttempts,
          latencyMs: Date.now() - t0,
          providerFallback: providerIndex > 0,
          providerUsed: provider,
          plannerAudit,
        };
      }
      parsed = parseDayHints(retryAttempt.rawText);
      if (!parsed) {
        lastFailureReason = firstAttemptTruncated || isTruncationFinishReason(retryAttempt.finishReason)
          ? 'planner_parse_truncated'
          : 'planner_parse_invalid';
        if (providerIndex < providerOrder.length - 1) continue;
        return {
          result: null,
          failureReason: lastFailureReason,
          groundingRate: 0,
          unknownIdRate: 0,
          parseAttempts,
          latencyMs: Date.now() - t0,
          providerFallback: providerIndex > 0,
          providerUsed: provider,
          plannerAudit,
        };
      }
    }

    const rebuilt = rebuildClustersFromHints(parsed, catalog, params.clusters, params.timeWindows);
    lastGroundingRate = rebuilt.groundingRate;
    lastUnknownIdRate = rebuilt.unknownIdRate;
    lastReasonCodeCounts = rebuilt.reasonCodeCounts;
    lastCandidateDecisionEvents = rebuilt.candidateDecisionEvents;

    if (rebuilt.unknownIdRate > UNKNOWN_ID_RATE_MAX) {
      lastFailureReason = 'unknown_id_rate_high';
      if (providerIndex < providerOrder.length - 1) continue;
      return {
        result: null,
        failureReason: lastFailureReason,
        groundingRate: rebuilt.groundingRate,
        unknownIdRate: rebuilt.unknownIdRate,
        parseAttempts,
        latencyMs: Date.now() - t0,
        providerFallback: providerIndex > 0,
        providerUsed: provider,
        plannerAudit,
        reasonCodeCounts: rebuilt.reasonCodeCounts,
        candidateDecisionEvents: rebuilt.candidateDecisionEvents,
      };
    }
    if (rebuilt.groundingRate < MIN_GROUNDING_RATE) {
      lastFailureReason = 'grounding_below_threshold';
      if (providerIndex < providerOrder.length - 1) continue;
      return {
        result: null,
        failureReason: lastFailureReason,
        groundingRate: rebuilt.groundingRate,
        unknownIdRate: rebuilt.unknownIdRate,
        parseAttempts,
        latencyMs: Date.now() - t0,
        providerFallback: providerIndex > 0,
        providerUsed: provider,
        plannerAudit,
        reasonCodeCounts: rebuilt.reasonCodeCounts,
        candidateDecisionEvents: rebuilt.candidateDecisionEvents,
      };
    }

    const ratioOutOfBand =
      rebuilt.ratioIconicLocal.iconic < rebuilt.ratioFeasibleBand.lower
      || rebuilt.ratioIconicLocal.iconic > rebuilt.ratioFeasibleBand.upper;
    if (ratioOutOfBand && enforceRatioBand) {
      lastFailureReason = 'ratio_out_of_band';
      if (providerIndex < providerOrder.length - 1) continue;
      return {
        result: null,
        failureReason: lastFailureReason,
        groundingRate: rebuilt.groundingRate,
        unknownIdRate: rebuilt.unknownIdRate,
        parseAttempts,
        latencyMs: Date.now() - t0,
        providerFallback: providerIndex > 0,
        providerUsed: provider,
        plannerAudit,
        reasonCodeCounts: rebuilt.reasonCodeCounts,
        candidateDecisionEvents: rebuilt.candidateDecisionEvents,
      };
    }
    if (ratioOutOfBand && !enforceRatioBand) {
      rebuilt.reasonCodeCounts['ratio_out_of_band_accepted'] =
        (rebuilt.reasonCodeCounts['ratio_out_of_band_accepted'] || 0) + 1;
    }

    const normalizedDays: DayPlanHint[] = [];
    for (let dayNumber = 1; dayNumber <= params.clusters.length; dayNumber++) {
      const parsedDay = parsed.days.find((day) => Number(day.dayNumber) === dayNumber);
      const parsedIds = Array.isArray(parsedDay?.candidateIds)
        ? parsedDay!.candidateIds.filter((value): value is string => typeof value === 'string')
        : [];
      const parsedDropIds = Array.isArray(parsedDay?.dropCandidateIds)
        ? parsedDay!.dropCandidateIds.filter((value): value is string => typeof value === 'string')
        : [];
      normalizedDays.push({
        dayNumber,
        candidateIds: parsedIds,
        dropCandidateIds: parsedDropIds,
        theme: typeof parsedDay?.theme === 'string' ? parsedDay.theme : '',
      });
    }

    const enrichments = extractEnrichments(parsed);

    return {
      result: {
        clusters: rebuilt.clusters,
        catalog,
        enrichments,
        hints: {
          days: normalizedDays,
          ratioIconicLocal: rebuilt.ratioIconicLocal,
          groundingRate: rebuilt.groundingRate,
          unknownIdRate: rebuilt.unknownIdRate,
          invalidCandidateRefs: rebuilt.invalidCandidateRefs,
          parseAttempts,
          latencyMs: Date.now() - t0,
          requestedDropCount: rebuilt.requestedDropCount,
          acceptedDropCount: rebuilt.acceptedDropCount,
          dropRecoveryCount: rebuilt.dropRecoveryCount,
          ratioFeasibleBand: rebuilt.ratioFeasibleBand,
          reasonCodeCounts: rebuilt.reasonCodeCounts,
        },
      },
      groundingRate: rebuilt.groundingRate,
      unknownIdRate: rebuilt.unknownIdRate,
      parseAttempts,
      latencyMs: Date.now() - t0,
      providerUsed: provider,
      providerFallback: providerIndex > 0,
      plannerAudit,
      reasonCodeCounts: rebuilt.reasonCodeCounts,
      candidateDecisionEvents: rebuilt.candidateDecisionEvents,
    };
  }

  return {
    result: null,
    failureReason: lastFailureReason,
    groundingRate: lastGroundingRate,
    unknownIdRate: lastUnknownIdRate,
    parseAttempts,
    latencyMs: Date.now() - t0,
    providerFallback: providerOrder.length > 1,
    plannerAudit,
    reasonCodeCounts: lastReasonCodeCounts,
    candidateDecisionEvents: lastCandidateDecisionEvents,
  };
}

export const __test__ = {
  parseDayHints,
  rebuildClustersFromHints,
  computeFeasibleRatioBand,
  compactPlannerCatalog,
  computePlannerActivityCap,
};

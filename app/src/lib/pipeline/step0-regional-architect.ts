/**
 * Pipeline V3 — Step 0c: Regional Itinerary Architect
 *
 * LLM-assisted blueprint for regional/sparse destinations.
 * The deterministic pipeline remains source of truth for validation/scheduling.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TripPreferences } from '../types';
import type { DestinationAnalysis } from './step0-destination-intel';
import { fetchGeminiWithRetry } from '../services/geminiSearch';
import { getCityCenterCoordsAsync } from '../services/geocoding';
import { resolveCoordinates } from '../services/coordsResolver';
import {
  buildDestinationEnvelope,
  getEnvelopeAdaptiveRadiusKm,
  type DestinationEnvelope,
} from '../services/destinationEnvelope';
import { trackEstimatedCost } from '../services/apiCostGuard';
import {
  mergeValidationParallelismStats,
  mergeValidationProviderBreakdowns,
  runValidationTasks,
  type ValidationParallelismStats,
  type ValidationProviderCallStats,
  type ValidationTask,
} from './utils/validation-orchestrator';

type BlueprintMode = 'single_base' | 'road_trip';
export type BlueprintPoiKind = 'iconic' | 'local_gem';

const BLUEPRINT_CACHE_DIR = path.join(process.cwd(), '.cache', 'regional-blueprints');
const BLUEPRINT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const ICONIC_RATIO_TARGET = 0.6;
const ICONIC_RATIO_MIN = 0.55;
const ICONIC_RATIO_MAX = 0.65;
const MAX_RATIO_REGEN_ATTEMPTS = 2;

export interface RegionalBlueprintHub {
  city: string;
  days: number;
  rationale?: string;
}

export interface RegionalBlueprintRatio {
  iconic: number;
  localGem: number;
}

export interface RegionalBlueprintRatioTarget {
  iconic: number;
  localGem: number;
  minIconic: number;
  maxIconic: number;
}

export interface RegionalBlueprintPoiCandidate {
  name: string;
  kind: BlueprintPoiKind;
}

export interface RegionalBlueprintPoi {
  name: string;
  latitude: number;
  longitude: number;
  source: string;
  kind: BlueprintPoiKind;
}

export interface RegionalDayAnchor {
  dayNumber: number;
  stayCity: string;
  zone: string;
  poiCandidates: RegionalBlueprintPoiCandidate[];
  transportHint?: string;
  resolvedPois: RegionalBlueprintPoi[];
}

export interface RegionalBlueprintDiagnostics {
  validationLatencyMs: number;
  providerCallBreakdown: Record<string, ValidationProviderCallStats>;
  parallelismStats: ValidationParallelismStats;
  ratioRegenerationCount: number;
  ratioAutoAdjustments: number;
}

export interface RegionalBlueprint {
  mode: BlueprintMode;
  hubs: RegionalBlueprintHub[];
  dayAnchors: RegionalDayAnchor[];
  confidence: number;
  source: 'gemini' | 'fallback' | 'cache';
  cacheKey: string;
  createdAt: string;
  ratioTarget: RegionalBlueprintRatioTarget;
  ratioActual: RegionalBlueprintRatio;
  diagnostics: RegionalBlueprintDiagnostics;
}

interface RegionalBlueprintRaw {
  mode?: BlueprintMode | 'auto';
  hubs?: Array<{ city?: string; days?: number; rationale?: string }>;
  dayAnchors?: Array<{
    dayNumber?: number;
    stayCity?: string;
    zone?: string;
    poiCandidates?: Array<string | { name?: string; kind?: BlueprintPoiKind | string }>;
    transportHint?: string;
  }>;
  confidence?: number;
  ratioTarget?: {
    iconic?: number;
    localGem?: number;
    minIconic?: number;
    maxIconic?: number;
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

export interface RegionalBlueprintSeed {
  name: string;
  kind: BlueprintPoiKind;
  dayNumber: number;
  zone: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPoiKind(value: unknown, fallbackIndex: number): BlueprintPoiKind {
  if (value === 'iconic' || value === 'local_gem') return value;
  // Default 60/40 split when kind is missing.
  return fallbackIndex % 5 < 3 ? 'iconic' : 'local_gem';
}

function toRatioTarget(raw?: RegionalBlueprintRaw['ratioTarget']): RegionalBlueprintRatioTarget {
  const iconic = Number.isFinite(raw?.iconic) ? Math.max(0, Math.min(1, raw?.iconic || ICONIC_RATIO_TARGET)) : ICONIC_RATIO_TARGET;
  const localGem = Number.isFinite(raw?.localGem) ? Math.max(0, Math.min(1, raw?.localGem || 1 - iconic)) : (1 - iconic);
  const minIconic = Number.isFinite(raw?.minIconic) ? Math.max(0, Math.min(1, raw?.minIconic || ICONIC_RATIO_MIN)) : ICONIC_RATIO_MIN;
  const maxIconic = Number.isFinite(raw?.maxIconic) ? Math.max(0, Math.min(1, raw?.maxIconic || ICONIC_RATIO_MAX)) : ICONIC_RATIO_MAX;
  return {
    iconic,
    localGem,
    minIconic: Math.min(minIconic, maxIconic),
    maxIconic: Math.max(minIconic, maxIconic),
  };
}

function emptyParallelismStats(): ValidationParallelismStats {
  return {
    scheduled: 0,
    deduped: 0,
    settled: 0,
    fulfilled: 0,
    rejected: 0,
    retries: 0,
    maxInFlight: 0,
    maxInFlightByProvider: {},
  };
}

function emptyDiagnostics(): RegionalBlueprintDiagnostics {
  return {
    validationLatencyMs: 0,
    providerCallBreakdown: {},
    parallelismStats: emptyParallelismStats(),
    ratioRegenerationCount: 0,
    ratioAutoAdjustments: 0,
  };
}

function buildCacheKey(preferences: TripPreferences, analysis?: DestinationAnalysis | null): string {
  const payload = [
    normalizeText(preferences.destination || ''),
    preferences.durationDays,
    preferences.groupType,
    preferences.budgetLevel,
    preferences.travelStyle || 'auto',
    normalizeText(preferences.mustSee || ''),
    (preferences.activities || []).join(','),
    analysis?.inputType || 'unknown',
    (analysis?.resolvedCities || []).map((city) => `${normalizeText(city.name)}:${city.stayDuration}`).join('|'),
  ].join('::');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function extractJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
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

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      // continue
    }
  }
  return null;
}

function normalizePoiCandidates(
  rawCandidates: Array<string | { name?: string; kind?: BlueprintPoiKind | string }>
): RegionalBlueprintPoiCandidate[] {
  const normalized: RegionalBlueprintPoiCandidate[] = [];
  for (let i = 0; i < rawCandidates.length; i += 1) {
    const entry = rawCandidates[i];
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (!name) continue;
      normalized.push({ name, kind: toPoiKind(undefined, i) });
      continue;
    }
    const name = (entry?.name || '').trim();
    if (!name) continue;
    normalized.push({ name, kind: toPoiKind(entry.kind, i) });
  }
  return normalized.slice(0, 5);
}

export function computeBlueprintRatio(blueprint: Pick<RegionalBlueprint, 'dayAnchors'>): RegionalBlueprintRatio {
  let iconic = 0;
  let localGem = 0;
  for (const anchor of blueprint.dayAnchors) {
    for (const candidate of anchor.poiCandidates) {
      if (candidate.kind === 'iconic') iconic += 1;
      else localGem += 1;
    }
  }
  const total = iconic + localGem;
  if (total === 0) {
    return { iconic: ICONIC_RATIO_TARGET, localGem: 1 - ICONIC_RATIO_TARGET };
  }
  return {
    iconic: Number((iconic / total).toFixed(3)),
    localGem: Number((localGem / total).toFixed(3)),
  };
}

function countAnchorsWithoutLocalGems(dayAnchors: RegionalDayAnchor[]): number {
  return dayAnchors.filter((anchor) =>
    anchor.poiCandidates.length > 0 && !anchor.poiCandidates.some((poi) => poi.kind === 'local_gem')
  ).length;
}

export function enforceBlueprintRatio(blueprint: RegionalBlueprint): {
  blueprint: RegionalBlueprint;
  adjustments: number;
} {
  const nextAnchors: RegionalDayAnchor[] = blueprint.dayAnchors.map((anchor) => ({
    ...anchor,
    poiCandidates: anchor.poiCandidates.map((candidate) => ({ ...candidate })),
    resolvedPois: anchor.resolvedPois.map((poi) => ({ ...poi })),
  }));

  let adjustments = 0;

  // Guarantee at least one local gem per day anchor when there are candidates.
  for (const anchor of nextAnchors) {
    if (anchor.poiCandidates.length === 0) continue;
    const localCount = anchor.poiCandidates.filter((candidate) => candidate.kind === 'local_gem').length;
    if (localCount > 0) continue;
    const replacementIndex = Math.max(0, anchor.poiCandidates.length - 1);
    if (anchor.poiCandidates[replacementIndex].kind !== 'local_gem') {
      anchor.poiCandidates[replacementIndex].kind = 'local_gem';
      adjustments += 1;
    }
  }

  const getRatio = () => computeBlueprintRatio({ dayAnchors: nextAnchors });

  let ratio = getRatio();

  if (ratio.iconic > blueprint.ratioTarget.maxIconic) {
    const iconicSlots: Array<{ anchorIndex: number; candidateIndex: number }> = [];
    nextAnchors.forEach((anchor, anchorIndex) => {
      anchor.poiCandidates.forEach((candidate, candidateIndex) => {
        if (candidate.kind === 'iconic') iconicSlots.push({ anchorIndex, candidateIndex });
      });
    });

    for (const slot of iconicSlots) {
      if (ratio.iconic <= blueprint.ratioTarget.maxIconic) break;
      nextAnchors[slot.anchorIndex].poiCandidates[slot.candidateIndex].kind = 'local_gem';
      adjustments += 1;
      ratio = getRatio();
    }
  }

  if (ratio.iconic < blueprint.ratioTarget.minIconic) {
    const localSlots: Array<{ anchorIndex: number; candidateIndex: number }> = [];
    nextAnchors.forEach((anchor, anchorIndex) => {
      const localCount = anchor.poiCandidates.filter((candidate) => candidate.kind === 'local_gem').length;
      if (localCount <= 1) return;
      anchor.poiCandidates.forEach((candidate, candidateIndex) => {
        if (candidate.kind === 'local_gem') localSlots.push({ anchorIndex, candidateIndex });
      });
    });

    for (const slot of localSlots) {
      if (ratio.iconic >= blueprint.ratioTarget.minIconic) break;
      const anchor = nextAnchors[slot.anchorIndex];
      const localCount = anchor.poiCandidates.filter((candidate) => candidate.kind === 'local_gem').length;
      if (localCount <= 1) continue;
      anchor.poiCandidates[slot.candidateIndex].kind = 'iconic';
      adjustments += 1;
      ratio = getRatio();
    }
  }

  // Keep resolved POI kinds in sync with candidate kinds.
  for (const anchor of nextAnchors) {
    const kindByName = new Map(anchor.poiCandidates.map((candidate) => [normalizeText(candidate.name), candidate.kind]));
    anchor.resolvedPois = anchor.resolvedPois.map((poi) => ({
      ...poi,
      kind: kindByName.get(normalizeText(poi.name)) || poi.kind,
    }));
  }

  return {
    blueprint: {
      ...blueprint,
      dayAnchors: nextAnchors,
      ratioActual: computeBlueprintRatio({ dayAnchors: nextAnchors }),
    },
    adjustments,
  };
}

function upgradeCachedBlueprint(raw: RegionalBlueprint): RegionalBlueprint {
  const upgradedAnchors: RegionalDayAnchor[] = (raw.dayAnchors || []).map((anchor, anchorIndex) => {
    const normalizedCandidates = normalizePoiCandidates(
      (anchor as unknown as { poiCandidates?: Array<string | { name?: string; kind?: BlueprintPoiKind | string }> }).poiCandidates || []
    );
    const kindByName = new Map(normalizedCandidates.map((candidate) => [normalizeText(candidate.name), candidate.kind]));
    const resolvedPois: RegionalBlueprintPoi[] = (anchor.resolvedPois || []).map((poi, poiIndex) => ({
      name: poi.name,
      latitude: poi.latitude,
      longitude: poi.longitude,
      source: poi.source,
      kind: kindByName.get(normalizeText(poi.name)) || toPoiKind((poi as { kind?: string }).kind, poiIndex),
    }));
    return {
      dayNumber: anchor.dayNumber || anchorIndex + 1,
      stayCity: (anchor.stayCity || '').trim(),
      zone: (anchor.zone || '').trim() || `Jour ${anchorIndex + 1}`,
      poiCandidates: normalizedCandidates,
      transportHint: anchor.transportHint,
      resolvedPois,
    };
  });

  const ratioTarget = toRatioTarget(raw.ratioTarget);
  return {
    ...raw,
    dayAnchors: upgradedAnchors,
    ratioTarget,
    ratioActual: raw.ratioActual || computeBlueprintRatio({ dayAnchors: upgradedAnchors }),
    diagnostics: raw.diagnostics || emptyDiagnostics(),
  };
}

function readCachedBlueprint(cacheKey: string): RegionalBlueprint | null {
  try {
    const filePath = path.join(BLUEPRINT_CACHE_DIR, `${cacheKey}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RegionalBlueprint;
    const ageMs = Date.now() - new Date(raw.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > BLUEPRINT_TTL_MS) return null;
    const upgraded = upgradeCachedBlueprint(raw);
    return { ...upgraded, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCachedBlueprint(blueprint: RegionalBlueprint): void {
  try {
    if (!fs.existsSync(BLUEPRINT_CACHE_DIR)) {
      fs.mkdirSync(BLUEPRINT_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(BLUEPRINT_CACHE_DIR, `${blueprint.cacheKey}.json`),
      JSON.stringify(blueprint)
    );
  } catch (err) {
    console.warn('[RegionalArchitect] Failed to write cache:', err);
  }
}

function fallbackBlueprint(
  preferences: TripPreferences,
  cacheKey: string,
  analysis?: DestinationAnalysis | null,
): RegionalBlueprint {
  const fallbackHubs: RegionalBlueprintHub[] =
    analysis?.resolvedCities?.length
      ? analysis.resolvedCities.map((city) => ({
          city: city.name,
          days: Math.max(1, city.stayDuration),
          rationale: 'resolver_fallback',
        }))
      : [{ city: preferences.destination, days: Math.max(1, preferences.durationDays), rationale: 'single_base_fallback' }];

  return {
    mode: fallbackHubs.length > 1 ? 'road_trip' : 'single_base',
    hubs: rebalanceHubDays(fallbackHubs, preferences.durationDays),
    dayAnchors: [],
    confidence: 0.35,
    source: 'fallback',
    cacheKey,
    createdAt: new Date().toISOString(),
    ratioTarget: toRatioTarget(),
    ratioActual: { iconic: ICONIC_RATIO_TARGET, localGem: 1 - ICONIC_RATIO_TARGET },
    diagnostics: emptyDiagnostics(),
  };
}

function rebalanceHubDays(hubs: RegionalBlueprintHub[], targetDays: number): RegionalBlueprintHub[] {
  const cleaned = hubs
    .map((hub) => ({ ...hub, city: (hub.city || '').trim(), days: Math.max(1, Math.round(hub.days || 1)) }))
    .filter((hub) => hub.city.length > 0);

  if (cleaned.length === 0) return [];

  let total = cleaned.reduce((sum, hub) => sum + hub.days, 0);
  if (total === targetDays) return cleaned;
  if (total <= 0) {
    const even = Math.max(1, Math.floor(targetDays / cleaned.length));
    return cleaned.map((hub, idx) => ({ ...hub, days: idx === cleaned.length - 1 ? Math.max(1, targetDays - even * (cleaned.length - 1)) : even }));
  }

  const ratio = targetDays / total;
  let remaining = targetDays;
  const adjusted = cleaned.map((hub, idx) => {
    if (idx === cleaned.length - 1) {
      return { ...hub, days: Math.max(1, remaining) };
    }
    const days = Math.max(1, Math.round(hub.days * ratio));
    remaining -= days;
    return { ...hub, days };
  });

  // Guard against negative remainder because of rounding.
  if (remaining < 0) {
    let debt = Math.abs(remaining);
    for (let i = adjusted.length - 1; i >= 0 && debt > 0; i--) {
      if (adjusted[i].days > 1) {
        adjusted[i].days -= 1;
        debt--;
      }
    }
  }
  return adjusted;
}

function normalizeBlueprintRaw(
  raw: RegionalBlueprintRaw,
  preferences: TripPreferences,
  cacheKey: string,
  analysis?: DestinationAnalysis | null,
): RegionalBlueprint {
  const candidateHubs = raw.hubs?.length
    ? raw.hubs.map((hub) => ({
        city: (hub.city || '').trim(),
        days: Math.max(1, Math.round(hub.days || 1)),
        rationale: hub.rationale || 'llm',
      }))
    : (analysis?.resolvedCities || []).map((city) => ({ city: city.name, days: city.stayDuration, rationale: 'resolver' }));

  const hubs = rebalanceHubDays(
    candidateHubs.length > 0 ? candidateHubs : [{ city: preferences.destination, days: preferences.durationDays, rationale: 'single_base' }],
    preferences.durationDays
  );

  const mode: BlueprintMode =
    raw.mode === 'road_trip' || raw.mode === 'single_base'
      ? raw.mode
      : hubs.length > 1
        ? 'road_trip'
        : 'single_base';

  const dayAnchors: RegionalDayAnchor[] = (raw.dayAnchors || [])
    .map((anchor, idx) => ({
      dayNumber: Math.min(
        preferences.durationDays,
        Math.max(1, Math.round(anchor.dayNumber || idx + 1))
      ),
      stayCity: (anchor.stayCity || hubs[Math.min(idx, hubs.length - 1)]?.city || preferences.destination).trim(),
      zone: (anchor.zone || '').trim() || `Jour ${idx + 1}`,
      poiCandidates: normalizePoiCandidates(anchor.poiCandidates || []),
      transportHint: anchor.transportHint?.trim(),
      resolvedPois: [],
    }))
    .filter((anchor) => anchor.poiCandidates.length > 0);

  const ratioTarget = toRatioTarget(raw.ratioTarget);

  return {
    mode,
    hubs,
    dayAnchors,
    confidence: Math.max(0.05, Math.min(1, raw.confidence ?? 0.65)),
    source: 'gemini',
    cacheKey,
    createdAt: new Date().toISOString(),
    ratioTarget,
    ratioActual: computeBlueprintRatio({ dayAnchors }),
    diagnostics: emptyDiagnostics(),
  };
}

async function canonicalizeAnchors(
  blueprint: RegionalBlueprint,
  fallbackDestination: string,
  destinationEnvelope?: DestinationEnvelope | null,
): Promise<RegionalBlueprint> {
  if (blueprint.dayAnchors.length === 0) return blueprint;

  const cityKeys = new Set(
    blueprint.dayAnchors.map((anchor) => normalizeText(anchor.stayCity || fallbackDestination)).filter(Boolean)
  );

  const cityTasks: ValidationTask<{ lat: number; lng: number } | null>[] = Array.from(cityKeys).map((cityKey) => ({
    key: `city:${cityKey}`,
    provider: 'geocoding',
    run: async () => getCityCenterCoordsAsync(cityKey || fallbackDestination),
  }));

  const cityResult = await runValidationTasks(cityTasks, {
    defaultConcurrency: 6,
    providerConcurrency: { geocoding: 4 },
    maxRetries: 1,
    baseBackoffMs: 120,
  });

  const cityCenters = new Map<string, { lat: number; lng: number }>();
  for (const [taskKey, settled] of cityResult.settledByKey.entries()) {
    if (settled.status !== 'fulfilled' || !settled.value) continue;
    cityCenters.set(taskKey.replace(/^city:/, ''), settled.value);
  }

  const poiTasks: ValidationTask<{ lat: number; lng: number; source: string } | null>[] = [];

  for (const anchor of blueprint.dayAnchors) {
    const cityKey = normalizeText(anchor.stayCity || fallbackDestination);
    const center = cityCenters.get(cityKey);
    if (!center) continue;

    for (const candidate of anchor.poiCandidates.slice(0, 3)) {
      const taskKey = `poi:${cityKey}:${normalizeText(candidate.name)}`;
      poiTasks.push({
        key: taskKey,
        provider: 'coords',
        run: async () => {
          const coords = await resolveCoordinates(
            candidate.name,
            anchor.stayCity || fallbackDestination,
            center,
            'attraction',
            {
              allowPaidFallback: false,
              destinationEnvelope: destinationEnvelope || undefined,
              destinationRadiusKm: destinationEnvelope ? getEnvelopeAdaptiveRadiusKm(destinationEnvelope) : undefined,
            }
          );
          if (!coords) return null;
          return { lat: coords.lat, lng: coords.lng, source: coords.source };
        },
      });
    }
  }

  const poiResult = await runValidationTasks(poiTasks, {
    defaultConcurrency: 8,
    providerConcurrency: { coords: 8 },
    maxRetries: 2,
    baseBackoffMs: 180,
  });

  const canonicalAnchors: RegionalDayAnchor[] = [];
  for (const anchor of blueprint.dayAnchors) {
    const cityKey = normalizeText(anchor.stayCity || fallbackDestination);
    const resolvedCandidates: RegionalBlueprintPoiCandidate[] = [];
    const resolvedPois: RegionalBlueprintPoi[] = [];

    for (const candidate of anchor.poiCandidates.slice(0, 3)) {
      const taskKey = `poi:${cityKey}:${normalizeText(candidate.name)}`;
      const settled = poiResult.settledByKey.get(taskKey);
      if (!settled || settled.status !== 'fulfilled' || !settled.value) continue;

      resolvedCandidates.push({ ...candidate });
      resolvedPois.push({
        name: candidate.name,
        latitude: settled.value.lat,
        longitude: settled.value.lng,
        source: settled.value.source,
        kind: candidate.kind,
      });
    }

    if (resolvedPois.length === 0) continue;

    canonicalAnchors.push({
      ...anchor,
      poiCandidates: resolvedCandidates,
      resolvedPois,
    });
  }

  const diagnostics: RegionalBlueprintDiagnostics = {
    validationLatencyMs: cityResult.latencyMs + poiResult.latencyMs,
    providerCallBreakdown: mergeValidationProviderBreakdowns([
      cityResult.providerCallBreakdown,
      poiResult.providerCallBreakdown,
    ]),
    parallelismStats: mergeValidationParallelismStats([
      cityResult.parallelismStats,
      poiResult.parallelismStats,
    ]),
    ratioRegenerationCount: blueprint.diagnostics.ratioRegenerationCount,
    ratioAutoAdjustments: blueprint.diagnostics.ratioAutoAdjustments,
  };

  return {
    ...blueprint,
    dayAnchors: canonicalAnchors,
    ratioActual: computeBlueprintRatio({ dayAnchors: canonicalAnchors }),
    diagnostics,
  };
}

function validateBlueprint(
  blueprint: RegionalBlueprint,
  durationDays: number,
  mustSeeRaw: string,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const daySum = blueprint.hubs.reduce((sum, hub) => sum + hub.days, 0);
  if (daySum !== durationDays) {
    issues.push(`hub_days_mismatch:${daySum}/${durationDays}`);
  }
  if (blueprint.hubs.length === 0) {
    issues.push('no_hubs');
  }
  if (blueprint.mode === 'road_trip' && blueprint.hubs.length < 2) {
    issues.push('road_trip_without_multiple_hubs');
  }
  if (blueprint.dayAnchors.length > 0) {
    const dayNumbers = new Set<number>();
    for (const anchor of blueprint.dayAnchors) {
      if (anchor.dayNumber < 1 || anchor.dayNumber > durationDays) {
        issues.push(`anchor_day_out_of_range:${anchor.dayNumber}`);
      }
      dayNumbers.add(anchor.dayNumber);
    }
    if (dayNumbers.size < Math.min(durationDays, 2)) {
      issues.push('insufficient_anchor_coverage');
    }
  }

  const ratio = blueprint.ratioActual;
  if (ratio.iconic < blueprint.ratioTarget.minIconic || ratio.iconic > blueprint.ratioTarget.maxIconic) {
    issues.push(`ratio_out_of_band:${ratio.iconic}`);
  }

  const missingLocalGemDays = countAnchorsWithoutLocalGems(blueprint.dayAnchors);
  if (missingLocalGemDays > 0) {
    issues.push(`missing_local_gem_days:${missingLocalGemDays}`);
  }

  const mustSeeTokens = (mustSeeRaw || '')
    .split(',')
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (mustSeeTokens.length > 0) {
    const candidateNames = new Set(
      blueprint.dayAnchors.flatMap((anchor) =>
        anchor.poiCandidates.map((candidate) => normalizeText(candidate.name))
      )
    );
    const missing = mustSeeTokens.filter((token) => {
      for (const candidateName of candidateNames) {
        if (candidateName.includes(token) || token.includes(candidateName)) return false;
      }
      return true;
    });
    const coverageRate = 1 - (missing.length / mustSeeTokens.length);
    if (coverageRate < 0.7) {
      issues.push(`must_see_coverage_low:${coverageRate.toFixed(2)}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function buildPrompt(
  preferences: TripPreferences,
  options: { analysis?: DestinationAnalysis | null; forceForSparse?: boolean },
  feedback?: string,
): string {
  const mustSee = preferences.mustSee?.trim() || 'aucun';
  const activities = (preferences.activities || []).join(', ') || 'mix';
  const resolvedHints = options.analysis?.resolvedCities?.map((city) => `${city.name} (${city.stayDuration}j)`).join(', ') || 'none';
  const sparseMode = options.forceForSparse ? 'SPARSE_MODE=ON' : 'SPARSE_MODE=OFF';
  return `Tu es un architecte d'itinéraire régional haut niveau.
Crée un blueprint pour "${preferences.destination}" sur ${preferences.durationDays} jours.

Contexte:
- Groupe: ${preferences.groupType}, budget: ${preferences.budgetLevel}
- Activités: ${activities}
- Must-see demandés: ${mustSee}
- Hints resolver: ${resolvedHints}
- ${sparseMode}

Contraintes dures:
1) Mode = "single_base" ou "road_trip" (choix logique, sans zigzag)
2) hubs: villes de séjour + jours (somme EXACTE = ${preferences.durationDays})
3) dayAnchors: 1 entrée/jour si possible, avec zone + 2-4 POIs candidates
4) Chaque POI candidate DOIT avoir un kind: "iconic" ou "local_gem"
5) Ratio global visé: 60/40 iconique/pépites
6) Bande acceptable obligatoire: 55-65% d'iconiques
7) Au moins 1 local_gem par jour (hors jour vide)
8) Les POIs doivent être vérifiables (pas de concepts vagues)

Réponds en JSON STRICT:
{
  "mode": "single_base" | "road_trip",
  "hubs": [{ "city": "...", "days": 2, "rationale": "..." }],
  "dayAnchors": [
    {
      "dayNumber": 1,
      "stayCity": "...",
      "zone": "...",
      "poiCandidates": [
        { "name": "...", "kind": "iconic" },
        { "name": "...", "kind": "local_gem" }
      ],
      "transportHint": "..."
    }
  ],
  "confidence": 0.0,
  "ratioTarget": {
    "iconic": ${ICONIC_RATIO_TARGET},
    "localGem": ${1 - ICONIC_RATIO_TARGET},
    "minIconic": ${ICONIC_RATIO_MIN},
    "maxIconic": ${ICONIC_RATIO_MAX}
  }
}

${feedback ? `Corrige absolument les problèmes du draft précédent: ${feedback}` : ''}`;
}

async function requestBlueprint(prompt: string): Promise<RegionalBlueprintRaw | null> {
  trackEstimatedCost('llm-architect', 0.03);
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    maxOutputTokens: 2400,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
  };

  const response = await fetchGeminiWithRetry({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  }, 3, 'step0_regional');

  if (!response.ok) return null;
  const data = await response.json() as GeminiGenerateContentResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('')?.trim();
  if (!text) return null;
  return extractJson<RegionalBlueprintRaw>(text);
}

export async function planRegionalBlueprint(
  preferences: TripPreferences,
  options: { analysis?: DestinationAnalysis | null; forceForSparse?: boolean } = {}
): Promise<RegionalBlueprint> {
  const cacheKey = buildCacheKey(preferences, options.analysis);
  const cached = readCachedBlueprint(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return fallbackBlueprint(preferences, cacheKey, options.analysis);
  }

  let feedback: string | undefined;
  let lastCandidate: RegionalBlueprint | null = null;
  let ratioRegenerationCount = 0;
  const envelope = await buildDestinationEnvelope(preferences.destination);

  try {
    for (let attempt = 0; attempt <= MAX_RATIO_REGEN_ATTEMPTS; attempt += 1) {
      const prompt = buildPrompt(preferences, options, feedback);
      const raw = await requestBlueprint(prompt);
      if (!raw) {
        feedback = 'Le JSON précédent est invalide ou vide. Respecte strictement le format demandé.';
        continue;
      }

      const normalized = normalizeBlueprintRaw(raw, preferences, cacheKey, options.analysis);
      const canonical = await canonicalizeAnchors(normalized, preferences.destination, envelope);
      const candidate = {
        ...canonical,
        ratioActual: computeBlueprintRatio(canonical),
      };
      lastCandidate = candidate;

      const validation = validateBlueprint(candidate, preferences.durationDays, preferences.mustSee || '');
      if (validation.ok) {
        const ready = {
          ...candidate,
          diagnostics: {
            ...candidate.diagnostics,
            ratioRegenerationCount,
            ratioAutoAdjustments: 0,
          },
        };
        writeCachedBlueprint(ready);
        return ready;
      }

      feedback = validation.issues.join(', ');
      ratioRegenerationCount += 1;
    }

    if (lastCandidate) {
      const enforced = enforceBlueprintRatio(lastCandidate);
      const repaired = {
        ...enforced.blueprint,
        diagnostics: {
          ...enforced.blueprint.diagnostics,
          ratioRegenerationCount,
          ratioAutoAdjustments: enforced.adjustments,
        },
      };
      const validation = validateBlueprint(repaired, preferences.durationDays, preferences.mustSee || '');
      if (validation.ok) {
        writeCachedBlueprint(repaired);
        return repaired;
      }
      console.warn('[RegionalArchitect] Invalid blueprint after ratio fallback:', validation.issues.join(', '));
    }

    return fallbackBlueprint(preferences, cacheKey, options.analysis);
  } catch (err) {
    console.warn('[RegionalArchitect] Failed, using fallback:', err);
    return fallbackBlueprint(preferences, cacheKey, options.analysis);
  }
}

export function extractBlueprintMustSeeSeedItems(
  blueprint: RegionalBlueprint,
  maxSeeds: number = 24
): RegionalBlueprintSeed[] {
  const iconicQuota = Math.max(1, Math.round(maxSeeds * blueprint.ratioTarget.iconic));
  const localQuota = Math.max(1, maxSeeds - iconicQuota);

  const iconic: RegionalBlueprintSeed[] = [];
  const local: RegionalBlueprintSeed[] = [];
  const seen = new Set<string>();

  for (const anchor of blueprint.dayAnchors) {
    for (const poi of anchor.resolvedPois) {
      const key = normalizeText(poi.name);
      if (!key || seen.has(key)) continue;
      const seed: RegionalBlueprintSeed = {
        name: poi.name,
        kind: poi.kind,
        dayNumber: anchor.dayNumber,
        zone: anchor.zone,
      };
      seen.add(key);
      if (poi.kind === 'iconic') iconic.push(seed);
      else local.push(seed);
    }
  }

  const selected: RegionalBlueprintSeed[] = [];
  for (const seed of iconic) {
    if (selected.length >= maxSeeds || selected.filter((entry) => entry.kind === 'iconic').length >= iconicQuota) break;
    selected.push(seed);
  }
  for (const seed of local) {
    if (selected.length >= maxSeeds || selected.filter((entry) => entry.kind === 'local_gem').length >= localQuota) break;
    selected.push(seed);
  }

  if (selected.length < maxSeeds) {
    for (const seed of [...iconic, ...local]) {
      if (selected.length >= maxSeeds) break;
      if (selected.some((entry) => normalizeText(entry.name) === normalizeText(seed.name))) continue;
      selected.push(seed);
    }
  }

  return selected;
}

export function extractBlueprintMustSeeSeeds(
  blueprint: RegionalBlueprint,
  maxSeeds: number = 24
): string[] {
  return extractBlueprintMustSeeSeedItems(blueprint, maxSeeds).map((seed) => seed.name);
}

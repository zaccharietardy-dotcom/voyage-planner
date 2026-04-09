import { createHash } from 'crypto';

import {
  probeGemini,
  probeGooglePlaces,
  probeSerpApi,
} from '@/lib/integrations/providerProbes';
import type { GenerateTripInput } from '@/lib/validations/generate';
import { getProviderQuotaGuardState } from '@/lib/services/providerQuotaGuard';

const FINGERPRINT_DEDUP_TTL_MS = Math.max(
  60_000,
  Number(process.env.GENERATE_FINGERPRINT_DEDUP_TTL_MS || 6 * 60 * 60 * 1000),
);
const FINGERPRINT_COOLDOWN_MS = Math.max(
  10_000,
  Number(process.env.GENERATE_FINGERPRINT_COOLDOWN_MS || 3 * 60 * 1000),
);
const QUALITY_LIVE_MAX_RUNS_PER_DAY = Math.max(
  1,
  Number(process.env.QUALITY_LIVE_MAX_RUNS_PER_DAY || 1),
);
const ENFORCE_QUALITY_LIVE_DAILY_CAP =
  process.env.QUALITY_LIVE_ENFORCE_DAILY_CAP === '1'
  || process.env.QUALITY_LIVE_ENFORCE_DAILY_CAP === 'true';

const PROVIDER_READINESS_CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.PROVIDER_READINESS_CACHE_TTL_MS || 5 * 60 * 1000),
);

type AdmissionReasonCode =
  | 'admission_allowed'
  | 'dedupe_hit'
  | 'cooldown_active'
  | 'quality_live_daily_cap'
  | 'provider_not_ready';

type RequiredProvider = 'gemini' | 'serpapi' | 'google_places';

type ReadinessStatus = 'ready' | 'not_configured' | 'quota_exceeded' | 'error';

export interface AdmissionDecision {
  allowed: boolean;
  reasonCode: AdmissionReasonCode;
  requestFingerprint: string;
  cooldownRemainingMs?: number;
  replayTrip?: unknown;
  replaySessionId?: string;
}

export interface ProviderReadinessSnapshot {
  checkedAt: string;
  fromCache: boolean;
  requiredProviders: RequiredProvider[];
  overall: 'ready' | 'blocked';
  blockedProviders: RequiredProvider[];
  providers: Record<RequiredProvider, {
    configured: boolean;
    status: ReadinessStatus;
    reason?: string;
    latencyMs?: number;
  }>;
}

interface FingerprintEntry {
  userId: string;
  requestFingerprint: string;
  lastStartedAt: number;
  lastCompletedAt?: number;
  inProgress: boolean;
  lastSessionId?: string;
  lastTrip?: unknown;
}

interface DailyRunCounter {
  dayKey: string;
  count: number;
}

const fingerprintEntries = new Map<string, FingerprintEntry>();
const dailyRunCounters = new Map<string, DailyRunCounter>();

let cachedProviderReadiness: {
  expiresAt: number;
  snapshot: ProviderReadinessSnapshot;
} | null = null;

function normalizeText(value: string | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeDateOnly(value: string): string {
  const asString = String(value || '').trim();
  if (!asString) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  const parsed = new Date(asString);
  if (!Number.isFinite(parsed.getTime())) return asString;
  return parsed.toISOString().slice(0, 10);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function buildEntryKey(userId: string, requestFingerprint: string): string {
  return `${userId}:${requestFingerprint}`;
}

function getDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function pruneAdmissionState(nowMs: number): void {
  for (const [key, entry] of fingerprintEntries.entries()) {
    const ref = entry.lastCompletedAt || entry.lastStartedAt;
    if (nowMs - ref > FINGERPRINT_DEDUP_TTL_MS * 2) {
      fingerprintEntries.delete(key);
    }
  }

  const todayKey = getDayKey(nowMs);
  for (const [userId, counter] of dailyRunCounters.entries()) {
    if (counter.dayKey !== todayKey) {
      dailyRunCounters.delete(userId);
    }
  }
}

function getRequiredProvidersFromGuard(): RequiredProvider[] {
  const guard = getProviderQuotaGuardState();
  const providers = new Set<RequiredProvider>();

  for (const provider of guard.requiredProviders) {
    if (provider === 'gemini' || provider === 'serpapi' || provider === 'google_places') {
      providers.add(provider);
    }
  }

  if (providers.size === 0) {
    providers.add('gemini');
    providers.add('serpapi');
    providers.add('google_places');
  }

  return Array.from(providers);
}

function baseProviderReadiness(): ProviderReadinessSnapshot {
  const requiredProviders = getRequiredProvidersFromGuard();

  const providers: ProviderReadinessSnapshot['providers'] = {
    gemini: {
      configured: Boolean(process.env.GOOGLE_AI_API_KEY),
      status: process.env.GOOGLE_AI_API_KEY ? 'ready' : 'not_configured',
    },
    serpapi: {
      configured: Boolean(process.env.SERPAPI_KEY),
      status: process.env.SERPAPI_KEY ? 'ready' : 'not_configured',
    },
    google_places: {
      configured: Boolean(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
      status: (process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY) ? 'ready' : 'not_configured',
    },
  };

  const guard = getProviderQuotaGuardState();
  if (guard.stopped && guard.provider && (guard.provider in providers)) {
    const provider = guard.provider as RequiredProvider;
    providers[provider] = {
      ...providers[provider],
      status: 'quota_exceeded',
      reason: guard.detail || guard.reasonCode || 'quota_exceeded',
    };
  }

  const blockedProviders = requiredProviders.filter((provider) => providers[provider].status !== 'ready');
  return {
    checkedAt: new Date().toISOString(),
    fromCache: false,
    requiredProviders,
    overall: blockedProviders.length > 0 ? 'blocked' : 'ready',
    blockedProviders,
    providers,
  };
}

function probeToStatus(result: Awaited<ReturnType<typeof probeGemini>>): {
  status: ReadinessStatus;
  reason?: string;
  latencyMs?: number;
} {
  switch (result.status) {
    case 'ok':
      return { status: 'ready', reason: result.details, latencyMs: result.latencyMs };
    case 'quota_exceeded':
      return { status: 'quota_exceeded', reason: result.error || result.details, latencyMs: result.latencyMs };
    case 'not_configured':
      return { status: 'not_configured', reason: result.error || result.details, latencyMs: result.latencyMs };
    default:
      return { status: 'error', reason: result.error || result.details, latencyMs: result.latencyMs };
  }
}

export async function getProviderReadinessSnapshot(options?: {
  probe?: boolean;
}): Promise<ProviderReadinessSnapshot> {
  const shouldProbe = Boolean(options?.probe);
  const now = Date.now();

  if (!shouldProbe && cachedProviderReadiness && cachedProviderReadiness.expiresAt > now) {
    return {
      ...cachedProviderReadiness.snapshot,
      fromCache: true,
    };
  }

  const snapshot = baseProviderReadiness();

  if (shouldProbe) {
    const [geminiProbe, serpProbe, placesProbe] = await Promise.allSettled([
      probeGemini(),
      probeSerpApi(),
      probeGooglePlaces(),
    ]);

    if (geminiProbe.status === 'fulfilled') {
      const parsed = probeToStatus(geminiProbe.value);
      snapshot.providers.gemini = {
        ...snapshot.providers.gemini,
        status: parsed.status,
        reason: parsed.reason,
        latencyMs: parsed.latencyMs,
      };
    }

    if (serpProbe.status === 'fulfilled') {
      const parsed = probeToStatus(serpProbe.value);
      snapshot.providers.serpapi = {
        ...snapshot.providers.serpapi,
        status: parsed.status,
        reason: parsed.reason,
        latencyMs: parsed.latencyMs,
      };
    }

    if (placesProbe.status === 'fulfilled') {
      const parsed = probeToStatus(placesProbe.value);
      snapshot.providers.google_places = {
        ...snapshot.providers.google_places,
        status: parsed.status,
        reason: parsed.reason,
        latencyMs: parsed.latencyMs,
      };
    }

    const blockedProviders = snapshot.requiredProviders.filter((provider) => snapshot.providers[provider].status !== 'ready');
    snapshot.blockedProviders = blockedProviders;
    snapshot.overall = blockedProviders.length > 0 ? 'blocked' : 'ready';
  }

  cachedProviderReadiness = {
    expiresAt: now + PROVIDER_READINESS_CACHE_TTL_MS,
    snapshot,
  };

  return snapshot;
}

function normalizeGeneratePayload(input: GenerateTripInput): Record<string, unknown> {
  return {
    origin: normalizeText(input.origin),
    destination: normalizeText(input.destination),
    startDate: normalizeDateOnly(input.startDate),
    durationDays: input.durationDays,
    transport: input.transport,
    carRental: Boolean(input.carRental),
    groupSize: input.groupSize,
    groupType: input.groupType,
    budgetLevel: input.budgetLevel,
    budgetCustom: input.budgetCustom ?? null,
    budgetIsPerPerson: input.budgetIsPerPerson ?? null,
    mustSee: normalizeText(input.mustSee),
    pace: input.pace || null,
    tripMode: input.tripMode || null,
    travelStyle: input.travelStyle || null,
    mealPreference: input.mealPreference || null,
    preferredAirport: normalizeText(input.preferredAirport),
    departureTimePreference: input.departureTimePreference || null,
    needsParking: input.needsParking ?? null,
    activities: [...(input.activities || [])].sort(),
    dietary: [...(input.dietary || [])].sort(),
    cityPlan: (input.cityPlan || []).map((stage) => ({
      city: normalizeText(stage.city),
      days: stage.days,
    })),
    prePurchasedTickets: (input.prePurchasedTickets || [])
      .map((ticket) => ({
        name: normalizeText(ticket.name),
        date: ticket.date ? normalizeDateOnly(ticket.date) : null,
      }))
      .sort((a, b) => `${a.date || ''}:${a.name}`.localeCompare(`${b.date || ''}:${b.name}`)),
  };
}

export function buildRequestFingerprint(input: GenerateTripInput): string {
  const normalized = normalizeGeneratePayload(input);
  const digest = createHash('sha256')
    .update(stableJson(normalized))
    .digest('hex');
  return `fp_${digest.slice(0, 24)}`;
}

export function evaluateGenerationAdmission(params: {
  userId: string;
  requestFingerprint: string;
}): AdmissionDecision {
  const { userId, requestFingerprint } = params;
  const now = Date.now();
  pruneAdmissionState(now);

  const key = buildEntryKey(userId, requestFingerprint);
  const existing = fingerprintEntries.get(key);

  if (existing?.lastTrip && existing.lastCompletedAt && now - existing.lastCompletedAt <= FINGERPRINT_DEDUP_TTL_MS) {
    return {
      allowed: false,
      reasonCode: 'dedupe_hit',
      requestFingerprint,
      replayTrip: existing.lastTrip,
      replaySessionId: existing.lastSessionId,
    };
  }

  if (existing?.lastStartedAt && now - existing.lastStartedAt < FINGERPRINT_COOLDOWN_MS) {
    return {
      allowed: false,
      reasonCode: 'cooldown_active',
      requestFingerprint,
      cooldownRemainingMs: Math.max(0, FINGERPRINT_COOLDOWN_MS - (now - existing.lastStartedAt)),
    };
  }

  if (ENFORCE_QUALITY_LIVE_DAILY_CAP) {
    const dayKey = getDayKey(now);
    const counter = dailyRunCounters.get(userId);
    if (counter && counter.dayKey === dayKey && counter.count >= QUALITY_LIVE_MAX_RUNS_PER_DAY) {
      return {
        allowed: false,
        reasonCode: 'quality_live_daily_cap',
        requestFingerprint,
      };
    }
  }

  return {
    allowed: true,
    reasonCode: 'admission_allowed',
    requestFingerprint,
  };
}

export function evaluateAdmissionWithProviderReadiness(params: {
  admission: AdmissionDecision;
  providerReadiness: ProviderReadinessSnapshot;
}): AdmissionDecision {
  const { admission, providerReadiness } = params;
  if (!admission.allowed) return admission;

  if (providerReadiness.overall === 'blocked') {
    return {
      ...admission,
      allowed: false,
      reasonCode: 'provider_not_ready',
    };
  }

  return admission;
}

export function registerGenerationRunStarted(params: {
  userId: string;
  requestFingerprint: string;
  sessionId: string;
}): void {
  const now = Date.now();
  const key = buildEntryKey(params.userId, params.requestFingerprint);
  const existing = fingerprintEntries.get(key);
  fingerprintEntries.set(key, {
    userId: params.userId,
    requestFingerprint: params.requestFingerprint,
    lastStartedAt: now,
    lastCompletedAt: existing?.lastCompletedAt,
    inProgress: true,
    lastSessionId: params.sessionId,
    lastTrip: existing?.lastTrip,
  });

  if (ENFORCE_QUALITY_LIVE_DAILY_CAP) {
    const dayKey = getDayKey(now);
    const counter = dailyRunCounters.get(params.userId);
    if (!counter || counter.dayKey !== dayKey) {
      dailyRunCounters.set(params.userId, { dayKey, count: 1 });
    } else {
      dailyRunCounters.set(params.userId, { dayKey, count: counter.count + 1 });
    }
  }
}

export function registerGenerationRunCompleted(params: {
  userId: string;
  requestFingerprint: string;
  sessionId: string;
  trip: unknown;
}): void {
  const now = Date.now();
  const key = buildEntryKey(params.userId, params.requestFingerprint);
  const existing = fingerprintEntries.get(key);
  fingerprintEntries.set(key, {
    userId: params.userId,
    requestFingerprint: params.requestFingerprint,
    lastStartedAt: existing?.lastStartedAt || now,
    lastCompletedAt: now,
    inProgress: false,
    lastSessionId: params.sessionId,
    lastTrip: params.trip,
  });
}

export function registerGenerationRunFailed(params: {
  userId: string;
  requestFingerprint: string;
  sessionId?: string;
}): void {
  const now = Date.now();
  const key = buildEntryKey(params.userId, params.requestFingerprint);
  const existing = fingerprintEntries.get(key);
  if (!existing) return;

  fingerprintEntries.set(key, {
    ...existing,
    inProgress: false,
    lastStartedAt: existing.lastStartedAt || now,
    lastSessionId: params.sessionId || existing.lastSessionId,
  });
}

export function clearProviderReadinessCache(): void {
  cachedProviderReadiness = null;
}

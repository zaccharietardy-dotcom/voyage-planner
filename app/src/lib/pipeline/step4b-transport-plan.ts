/**
 * Step 4b — Transport plan builder.
 *
 * Produit un `TransportPlan` (aller + retour multi-legs) à partir de
 * l'origine/destination/dates/préférences utilisateur.
 *
 * Chaîne de fallback :
 *   1. Cache mémoire (30 jours, keyed {origin, destination, month, groupSize})
 *   2. Gemini 3 Flash avec responseSchema JSON typé
 *   3. Table européenne + airportFinder Google Places
 *   4. Heuristique pure (distance → mode, coûts/durées estimés)
 *
 * Ne throw jamais : un trip doit pouvoir être généré même si toutes les sources
 * échouent.
 */

import { callGemini } from '@/lib/services/geminiClient';
import { findHubByCity, normalizeHubKey, type CityHub } from '@/lib/data/european-hubs';
import { findNearestAirport } from '@/lib/services/airportFinder';
import type {
  TransportPlan,
  TransportPlanMode,
  TransportLeg,
  TransportHub,
  LegMode,
} from './types/transport-plan';

export interface BuildTransportPlanInput {
  origin: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  groupSize: number;
  originCoords?: { lat: number; lng: number };
  destinationCoords?: { lat: number; lng: number };
  hotelCoords?: { lat: number; lng: number };
  hotelName?: string;
  transportPref?: 'plane' | 'train' | 'car' | 'bus' | 'flexible';
  tripId?: string;
}

// ===========================================================================
// In-memory cache (replaced by Supabase in task #9)
// ===========================================================================

interface CacheEntry {
  plan: TransportPlan;
  createdAt: number;
}
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cacheKey(input: BuildTransportPlanInput): string {
  const origin = normalizeHubKey(input.origin);
  const destination = normalizeHubKey(input.destination);
  const month = input.startDate.toISOString().slice(0, 7);
  return `${origin}|${destination}|${month}|${input.groupSize}`;
}

function getCached(key: string): TransportPlan | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return { ...entry.plan, source: 'cache' };
}

function setCached(key: string, plan: TransportPlan): void {
  CACHE.set(key, { plan, createdAt: Date.now() });
}

// ===========================================================================
// Main entry point
// ===========================================================================

export async function buildTransportPlan(input: BuildTransportPlanInput): Promise<TransportPlan> {
  const started = Date.now();
  const key = cacheKey(input);
  const cached = getCached(key);
  if (cached) {
    logPlan('hit', cached, key, Date.now() - started);
    return cached;
  }

  const llmPlan = await tryLlmPlan(input);
  if (llmPlan) {
    setCached(key, llmPlan);
    logPlan('llm', llmPlan, key, Date.now() - started);
    return llmPlan;
  }

  const fallbackPlan = await buildFallbackPlan(input);
  setCached(key, fallbackPlan);
  logPlan('fallback', fallbackPlan, key, Date.now() - started);
  return fallbackPlan;
}

function logPlan(outcome: 'hit' | 'llm' | 'fallback', plan: TransportPlan, key: string, elapsedMs: number): void {
  const payload = {
    caller: 'step4b-transport-plan',
    outcome,
    source: plan.source,
    mode: plan.mode,
    outboundLegs: plan.outboundLegs.length,
    returnLegs: plan.returnLegs.length,
    totalOutboundMin: plan.totalOutboundMin,
    totalReturnMin: plan.totalReturnMin,
    totalCostEur: plan.totalCostEur,
    key,
    elapsedMs,
  };
  console.log('[TransportPlan]', JSON.stringify(payload));
}

// ===========================================================================
// LLM path — Gemini 3 Flash with JSON schema
// ===========================================================================

const TRANSPORT_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['plane', 'train', 'car', 'bus'] },
    reasoning: { type: 'string' },
    outboundLegs: { type: 'array', items: { $ref: '#/$defs/leg' } },
    returnLegs: { type: 'array', items: { $ref: '#/$defs/leg' } },
    totalOutboundMin: { type: 'integer' },
    totalReturnMin: { type: 'integer' },
    totalCostEur: { type: 'number' },
  },
  required: ['mode', 'reasoning', 'outboundLegs', 'returnLegs', 'totalOutboundMin', 'totalReturnMin', 'totalCostEur'],
  $defs: {
    hub: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        kind: { type: 'string', enum: ['airport', 'station', 'port'] },
        lat: { type: 'number' },
        lng: { type: 'number' },
        city: { type: 'string' },
        country: { type: 'string' },
      },
      required: ['name', 'kind', 'lat', 'lng'],
    },
    point: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        hub: { $ref: '#/$defs/hub' },
      },
      required: ['name', 'lat', 'lng'],
    },
    leg: {
      type: 'object',
      properties: {
        index: { type: 'integer' },
        mode: { type: 'string', enum: ['plane', 'train', 'high_speed_train', 'rer', 'metro', 'bus', 'car', 'taxi', 'walk', 'ferry'] },
        from: { $ref: '#/$defs/point' },
        to: { $ref: '#/$defs/point' },
        durationMin: { type: 'integer' },
        costEur: { type: 'number' },
        provider: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['index', 'mode', 'from', 'to', 'durationMin', 'costEur'],
    },
  },
} as const;

function buildLlmPrompt(input: BuildTransportPlanInput): string {
  const startStr = input.startDate.toISOString().slice(0, 10);
  const endStr = input.endDate.toISOString().slice(0, 10);
  const pref = input.transportPref || 'flexible';
  const hotelLine = input.hotelName
    ? `Hotel (destination-side): ${input.hotelName} @ ${input.hotelCoords?.lat ?? '?'}, ${input.hotelCoords?.lng ?? '?'}`
    : 'Hotel: unknown — use destination city centre as target.';

  return `You are a travel logistics planner. Design a realistic door-to-door transport plan for this trip.

Origin (where the traveler lives): ${input.origin}
Destination (trip target city): ${input.destination}
Depart date: ${startStr}
Return date: ${endStr}
Group size: ${input.groupSize} people
Preferred mode: ${pref}
${hotelLine}

Rules:
1. Pick the DOMINANT mode (plane/train/car/bus) based on distance + user preference:
   - < 650 km in Europe → favour high-speed train.
   - 650–1500 km → plane unless user explicitly prefers train.
   - > 1500 km → plane.
   - If ${pref} is specified and reasonable, honour it.
2. For plane/train: decompose the outbound into realistic LEGS:
   - Leg 1: origin residence → nearest relevant hub (airport/train station). Choose a realistic transfer mode (RER, train, metro, taxi) with real durations.
   - Leg 2: hub → destination hub (the plane or long-distance train). Use real airport IATA codes (CDG, FCO, BCN…) or station names (Roma Termini, Gare de Lyon).
   - Leg 3: destination hub → hotel/city centre. Use a realistic transfer (airport express train, metro, taxi).
3. For car: usually a single leg (origin residence → hotel). Add one rest-stop leg only if total duration > 4h.
4. Return legs mirror outbound legs in reverse order with realistic later-of-day departure times.
5. Durations in minutes, costs per PERSON in EUR (not total). Plane cost = full ticket per person. Include realistic transfer costs (RER B ≈ 12€, Leonardo Express ≈ 14€).
6. Include a concise \`reasoning\` field explaining the mode choice (1-2 sentences).
7. Coordinates must be real and accurate — hubs must have lat/lng of the actual airport/station (not city centre).
8. The \`from\` of the first outbound leg is the origin residence (approximate coords ok). The \`to\` of the last outbound leg is the hotel (or city centre if hotel coords unknown).

Think step by step but output ONLY the JSON matching the provided schema, no markdown, no prose.`;
}

interface GeminiApiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

async function tryLlmPlan(input: BuildTransportPlanInput): Promise<TransportPlan | null> {
  try {
    const response = await callGemini({
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: buildLlmPrompt(input) }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: TRANSPORT_PLAN_SCHEMA,
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      },
      caller: 'step4b-transport-plan',
      tripId: input.tripId,
    });

    if (!response.ok) {
      console.warn(`[step4b] LLM call failed: HTTP ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as GeminiApiResponse;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[step4b] LLM returned empty body');
      return null;
    }

    const parsed = JSON.parse(text);
    const validated = validateLlmPlan(parsed);
    if (!validated) {
      console.warn('[step4b] LLM output failed validation');
      return null;
    }
    validated.source = 'llm';
    return validated;
  } catch (err) {
    console.warn('[step4b] LLM path error:', err);
    return null;
  }
}

function validateLlmPlan(raw: unknown): TransportPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode = r.mode as TransportPlanMode | undefined;
  if (!mode || !['plane', 'train', 'car', 'bus'].includes(mode)) return null;
  const outbound = Array.isArray(r.outboundLegs) ? r.outboundLegs : [];
  const ret = Array.isArray(r.returnLegs) ? r.returnLegs : [];
  if (outbound.length === 0 || ret.length === 0) return null;

  try {
    const plan: TransportPlan = {
      mode,
      reasoning: String(r.reasoning || ''),
      outboundLegs: outbound.map((leg, i) => normalizeLeg(leg, i)),
      returnLegs: ret.map((leg, i) => normalizeLeg(leg, i)),
      totalOutboundMin: Number(r.totalOutboundMin) || 0,
      totalReturnMin: Number(r.totalReturnMin) || 0,
      totalCostEur: Number(r.totalCostEur) || 0,
      source: 'llm',
    };
    // Recompute totals defensively
    plan.totalOutboundMin = plan.outboundLegs.reduce((sum, l) => sum + l.durationMin, 0);
    plan.totalReturnMin = plan.returnLegs.reduce((sum, l) => sum + l.durationMin, 0);
    return plan;
  } catch {
    return null;
  }
}

function normalizeLeg(raw: unknown, fallbackIndex: number): TransportLeg {
  const l = (raw || {}) as Record<string, unknown>;
  const mode = (l.mode as LegMode) || 'car';
  return {
    index: Number(l.index) || fallbackIndex,
    mode,
    from: normalizePoint(l.from),
    to: normalizePoint(l.to),
    durationMin: Math.max(1, Math.round(Number(l.durationMin) || 60)),
    costEur: Math.max(0, Number(l.costEur) || 0),
    provider: l.provider ? String(l.provider) : undefined,
    reasoning: l.reasoning ? String(l.reasoning) : undefined,
  };
}

function normalizePoint(raw: unknown): TransportLeg['from'] {
  const p = (raw || {}) as Record<string, unknown>;
  const hubRaw = p.hub as Record<string, unknown> | undefined;
  return {
    name: String(p.name || 'Unknown'),
    lat: Number(p.lat) || 0,
    lng: Number(p.lng) || 0,
    hub: hubRaw && hubRaw.name
      ? {
          name: String(hubRaw.name),
          code: hubRaw.code ? String(hubRaw.code) : undefined,
          kind: (hubRaw.kind === 'station' || hubRaw.kind === 'port' ? hubRaw.kind : 'airport') as TransportHub['kind'],
          lat: Number(hubRaw.lat) || 0,
          lng: Number(hubRaw.lng) || 0,
          city: hubRaw.city ? String(hubRaw.city) : undefined,
          country: hubRaw.country ? String(hubRaw.country) : undefined,
        }
      : undefined,
  };
}

// ===========================================================================
// Fallback path — heuristic multi-leg using europe hubs + Google Places
// ===========================================================================

async function buildFallbackPlan(input: BuildTransportPlanInput): Promise<TransportPlan> {
  const originHub = await resolveHub(input.origin, input.originCoords);
  const destHub = await resolveHub(input.destination, input.destinationCoords);
  const originCoords = input.originCoords || originHub?.cityCoords || { lat: 0, lng: 0 };
  const destCoords = input.destinationCoords || destHub?.cityCoords || input.hotelCoords || { lat: 0, lng: 0 };

  const distanceKm = haversineKm(originCoords, destCoords);
  const mode = pickMode(distanceKm, input.transportPref);

  const outboundLegs = buildFallbackLegs({
    startPoint: { name: input.origin, ...originCoords },
    endPoint: input.hotelName
      ? { name: input.hotelName, lat: input.hotelCoords?.lat ?? destCoords.lat, lng: input.hotelCoords?.lng ?? destCoords.lng }
      : { name: input.destination, ...destCoords },
    originHub,
    destHub,
    mode,
    groupSize: input.groupSize,
    distanceKm,
    direction: 'outbound',
  });

  const returnLegs = buildFallbackLegs({
    startPoint: input.hotelName
      ? { name: input.hotelName, lat: input.hotelCoords?.lat ?? destCoords.lat, lng: input.hotelCoords?.lng ?? destCoords.lng }
      : { name: input.destination, ...destCoords },
    endPoint: { name: input.origin, ...originCoords },
    originHub: destHub,
    destHub: originHub,
    mode,
    groupSize: input.groupSize,
    distanceKm,
    direction: 'return',
  });

  const totalOutboundMin = outboundLegs.reduce((s, l) => s + l.durationMin, 0);
  const totalReturnMin = returnLegs.reduce((s, l) => s + l.durationMin, 0);
  const totalCostEur = [...outboundLegs, ...returnLegs].reduce((s, l) => s + l.costEur, 0) * input.groupSize;

  const source: TransportPlan['source'] = originHub && destHub ? 'fallback_table' : 'fallback_heuristic';

  return {
    mode,
    reasoning: `Fallback déterministe : distance ≈ ${Math.round(distanceKm)} km → mode ${mode}. ${
      originHub && destHub ? 'Hubs issus de la table européenne.' : 'Hubs estimés (villes hors table).'
    }`,
    outboundLegs,
    returnLegs,
    totalOutboundMin,
    totalReturnMin,
    totalCostEur,
    source,
  };
}

async function resolveHub(cityName: string, coords?: { lat: number; lng: number }): Promise<CityHub | null> {
  const fromTable = findHubByCity(cityName);
  if (fromTable) return fromTable;

  const nearestAirport = await findNearestAirport(cityName, coords);
  if (nearestAirport) {
    return {
      city: cityName,
      country: nearestAirport.country || 'Unknown',
      keys: [normalizeHubKey(cityName)],
      cityCoords: coords || { lat: nearestAirport.lat, lng: nearestAirport.lng },
      airport: nearestAirport,
    };
  }
  return null;
}

function pickMode(distanceKm: number, pref?: BuildTransportPlanInput['transportPref']): TransportPlanMode {
  if (pref && pref !== 'flexible') return pref;
  if (distanceKm < 650) return 'train';
  return 'plane';
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(c));
}

interface FallbackLegArgs {
  startPoint: { name: string; lat: number; lng: number };
  endPoint: { name: string; lat: number; lng: number };
  originHub: CityHub | null;
  destHub: CityHub | null;
  mode: TransportPlanMode;
  groupSize: number;
  distanceKm: number;
  direction: 'outbound' | 'return';
}

function buildFallbackLegs(args: FallbackLegArgs): TransportLeg[] {
  const { startPoint, endPoint, originHub, destHub, mode, distanceKm } = args;

  if (mode === 'car') {
    return [
      {
        index: 0,
        mode: 'car',
        from: { name: startPoint.name, lat: startPoint.lat, lng: startPoint.lng },
        to: { name: endPoint.name, lat: endPoint.lat, lng: endPoint.lng },
        durationMin: Math.max(45, Math.round((distanceKm / 70) * 60) + 15),
        costEur: Math.max(20, distanceKm * 0.18),
        provider: 'Route',
      },
    ];
  }

  if (mode === 'plane' || mode === 'train' || mode === 'bus') {
    const startHub = pickHub(originHub, mode);
    const endHub = pickHub(destHub, mode);
    if (!startHub || !endHub) {
      return [
        {
          index: 0,
          mode: mode as LegMode,
          from: { name: startPoint.name, lat: startPoint.lat, lng: startPoint.lng },
          to: { name: endPoint.name, lat: endPoint.lat, lng: endPoint.lng },
          durationMin: estimateMainLegDuration(mode, distanceKm),
          costEur: estimateMainLegCost(mode, distanceKm),
          provider: mode === 'plane' ? 'Airline' : mode === 'train' ? 'Rail' : 'Bus',
        },
      ];
    }

    const preLeg: TransportLeg = {
      index: 0,
      mode: pickTransferMode(startHub, mode),
      from: { name: startPoint.name, lat: startPoint.lat, lng: startPoint.lng },
      to: {
        name: startHub.name,
        lat: startHub.lat,
        lng: startHub.lng,
        hub: startHub,
      },
      durationMin: estimateTransferDuration(startPoint, { lat: startHub.lat, lng: startHub.lng }, mode),
      costEur: estimateTransferCost(startPoint, { lat: startHub.lat, lng: startHub.lng }, mode),
      provider: mode === 'plane' ? 'Transfert aéroport' : 'Transfert gare',
    };

    const hubDistanceKm = haversineKm({ lat: startHub.lat, lng: startHub.lng }, { lat: endHub.lat, lng: endHub.lng });
    const mainLeg: TransportLeg = {
      index: 1,
      mode: mode === 'plane' ? 'plane' : mode === 'train' ? (hubDistanceKm > 300 ? 'high_speed_train' : 'train') : 'bus',
      from: { name: startHub.name, lat: startHub.lat, lng: startHub.lng, hub: startHub },
      to: { name: endHub.name, lat: endHub.lat, lng: endHub.lng, hub: endHub },
      durationMin: estimateMainLegDuration(mode, hubDistanceKm),
      costEur: estimateMainLegCost(mode, hubDistanceKm),
      provider: mode === 'plane' ? 'Compagnie aérienne' : mode === 'train' ? 'Rail' : 'Bus longue distance',
    };

    const postLeg: TransportLeg = {
      index: 2,
      mode: pickTransferMode(endHub, mode),
      from: { name: endHub.name, lat: endHub.lat, lng: endHub.lng, hub: endHub },
      to: { name: endPoint.name, lat: endPoint.lat, lng: endPoint.lng },
      durationMin: estimateTransferDuration({ lat: endHub.lat, lng: endHub.lng }, endPoint, mode),
      costEur: estimateTransferCost({ lat: endHub.lat, lng: endHub.lng }, endPoint, mode),
      provider: mode === 'plane' ? 'Transfert aéroport' : 'Transfert centre-ville',
    };

    return [preLeg, mainLeg, postLeg];
  }

  return [];
}

function pickHub(cityHub: CityHub | null, mode: TransportPlanMode): TransportHub | null {
  if (!cityHub) return null;
  if (mode === 'plane') return cityHub.airport;
  if (mode === 'train') return cityHub.station || cityHub.airport;
  if (mode === 'bus') return cityHub.station || cityHub.airport;
  return cityHub.airport;
}

function pickTransferMode(hub: TransportHub, mainMode: TransportPlanMode): LegMode {
  if (mainMode === 'plane') return 'rer';
  if (mainMode === 'train') return 'metro';
  if (mainMode === 'bus') return 'metro';
  return 'taxi';
}

function estimateTransferDuration(a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode: TransportPlanMode): number {
  const km = haversineKm(a, b);
  if (km < 2) return 15;
  if (mode === 'plane') return Math.max(45, Math.round(km * 2.5) + 30); // inclut pré-vol
  return Math.max(20, Math.round(km * 2) + 10);
}

function estimateTransferCost(a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode: TransportPlanMode): number {
  const km = haversineKm(a, b);
  if (km < 2) return 5;
  if (mode === 'plane') return Math.max(10, Math.round(km * 0.5));
  return Math.max(5, Math.round(km * 0.4));
}

function estimateMainLegDuration(mode: TransportPlanMode, km: number): number {
  const speed = mode === 'plane' ? 700 : mode === 'train' ? 220 : mode === 'bus' ? 70 : 80;
  const fixed = mode === 'plane' ? 120 : 20;
  return Math.max(45, Math.round((km / speed) * 60) + fixed);
}

function estimateMainLegCost(mode: TransportPlanMode, km: number): number {
  const perKm = mode === 'plane' ? 0.18 : mode === 'train' ? 0.15 : mode === 'bus' ? 0.08 : 0.12;
  return Math.max(25, Math.round(km * perKm));
}

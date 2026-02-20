/**
 * Service Viator - Recherche d'expériences et activités de qualité
 *
 * API Viator Partner v2 (affiliate)
 * - Recherche par destination + coordonnées
 * - 300K+ expériences dans 200+ pays
 * - Gratuit (affiliate) avec commission 8%
 *
 * Chaîne: appelé depuis attractionsAIServer.ts
 * Doc: https://docs.viator.com/partner-api/
 */

import * as fs from 'fs';
import * as path from 'path';
import { Attraction } from './attractions';
import { ActivityType } from '../types';
import { findKnownViatorProduct } from './viatorKnownProducts';
import { calculateDistance } from './geocoding';

function getViatorApiKey() { return process.env.VIATOR_API_KEY?.trim(); }
const VIATOR_BASE_URL = 'https://api.viator.com/partner';

// Cache fichier 7 jours
const CACHE_BASE = process.env.VERCEL ? '/tmp' : process.cwd();
const CACHE_DIR = path.join(CACHE_BASE, '.cache', 'viator');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export function isViatorConfigured(): boolean {
  return !!getViatorApiKey();
}

export interface ViatorProductCoordinates {
  lat: number;
  lng: number;
  source: 'place';
}

const viatorProductCoordinatesCache = new Map<string, ViatorProductCoordinates | null>();
const viatorProductCoordinatesInFlight = new Map<string, Promise<ViatorProductCoordinates | null>>();
const viatorLocationCoordinatesCache = new Map<string, ViatorProductCoordinates | null>();

const LOCATION_REFERENCE_PATTERN = /^(LOC-[A-Za-z0-9+/=_-]{4,}|MEET_AT_DEPARTURE_POINT|CONTACT_SUPPLIER_LATER)$/i;

function isViatorLocationReference(value: string): boolean {
  const ref = value.trim();
  if (!ref) return false;
  return LOCATION_REFERENCE_PATTERN.test(ref);
}

export interface ViatorPlusValueInput {
  title: string;
  description?: string;
  rating?: number;
  reviewCount?: number;
  price?: number;
  freeCancellation?: boolean;
  instantConfirmation?: boolean;
}

export interface ViatorPlusValueAssessment {
  score: number;
  reasons: string[];
}

interface CoordinateCandidate {
  lat: number;
  lng: number;
  score: number;
  path: string;
}

function toCoord(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isValidCoordinatePair(lat: number, lng: number): boolean {
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function scoreCoordinatePath(path: string): number {
  const p = path.toLowerCase();
  let score = 0;

  const strongPositive = ['meeting', 'meet', 'pickup', 'pick_up', 'pick-up', 'start', 'departure'];
  const mediumPositive = ['itinerary', 'stop', 'waypoint', 'location', 'address', 'venue', 'point'];
  const strongNegative = ['bounds', 'viewport', 'north', 'south', 'east', 'west', 'min', 'max'];
  const mediumNegative = ['destination', 'city', 'region', 'country', 'center', 'centre', 'mapcenter'];

  if (strongPositive.some(k => p.includes(k))) score += 6;
  if (mediumPositive.some(k => p.includes(k))) score += 3;
  if (strongNegative.some(k => p.includes(k))) score -= 8;
  if (mediumNegative.some(k => p.includes(k))) score -= 5;

  return score;
}

function collectCoordinateCandidates(
  value: unknown,
  path: string,
  out: CoordinateCandidate[]
): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;

  const pairs: Array<{ latKey: string; lngKey: string }> = [
    { latKey: 'latitude', lngKey: 'longitude' },
    { latKey: 'lat', lngKey: 'lng' },
    { latKey: 'lat', lngKey: 'lon' },
  ];

  for (const pair of pairs) {
    if (!(pair.latKey in record) || !(pair.lngKey in record)) continue;
    const lat = toCoord(record[pair.latKey]);
    const lng = toCoord(record[pair.lngKey]);
    if (lat === null || lng === null) continue;
    if (!isValidCoordinatePair(lat, lng)) continue;
    const candidatePath = `${path}.${pair.latKey}/${pair.lngKey}`;
    out.push({ lat, lng, score: scoreCoordinatePath(candidatePath), path: candidatePath });
  }

  for (const [key, child] of Object.entries(record)) {
    if (!child || typeof child !== 'object') continue;
    collectCoordinateCandidates(child, `${path}.${key}`, out);
  }
}

function extractCoordinateCandidates(value: unknown): CoordinateCandidate[] {
  const candidates: CoordinateCandidate[] = [];
  collectCoordinateCandidates(value, 'root', candidates);
  return candidates;
}

function isCoordinateNearDestination(
  coords: { lat: number; lng: number },
  destinationCenter: { lat: number; lng: number },
  maxDistanceKm: number = 40
): boolean {
  const distance = calculateDistance(coords.lat, coords.lng, destinationCenter.lat, destinationCenter.lng);
  return distance <= maxDistanceKm;
}

function selectBestCoordinateCandidate(
  value: unknown,
  destinationCenter: { lat: number; lng: number }
): ViatorProductCoordinates | null {
  const candidates = extractCoordinateCandidates(value)
    .filter(c => isCoordinateNearDestination({ lat: c.lat, lng: c.lng }, destinationCenter))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dA = calculateDistance(a.lat, a.lng, destinationCenter.lat, destinationCenter.lng);
      const dB = calculateDistance(b.lat, b.lng, destinationCenter.lat, destinationCenter.lng);
      return dA - dB;
    });

  if (candidates.length === 0) return null;
  const best = candidates[0];

  // Avoid "verified" on generic coordinates when payload contains many ambiguous pairs.
  if (best.score < 0) return null;
  if (best.score === 0 && candidates.length > 1) return null;

  return { lat: best.lat, lng: best.lng, source: 'place' };
}

function buildViatorHeaders(): Record<string, string> {
  return {
    'exp-api-key': getViatorApiKey() || '',
    'Accept-Language': 'fr-FR',
    'Content-Type': 'application/json',
    'Accept': 'application/json;version=2.0',
  };
}

function collectProductPayloadsByCode(
  value: unknown,
  out: Map<string, unknown>,
): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectProductPayloadsByCode(item, out);
    return;
  }

  const record = value as Record<string, unknown>;
  const codeRaw = record.productCode;
  const productCode = typeof codeRaw === 'string' ? codeRaw.trim() : '';
  if (productCode && !out.has(productCode)) {
    out.set(productCode, record);
  }

  for (const child of Object.values(record)) {
    if (!child || typeof child !== 'object') continue;
    collectProductPayloadsByCode(child, out);
  }
}

function collectLocationReferences(
  value: unknown,
  path: string,
  out: Set<string>
): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLocationReferences(item, `${path}[${index}]`, out));
    return;
  }

  const record = value as Record<string, unknown>;

  // Booking answers can carry pickup references in a generic "answer" field.
  const bookingAnswer = typeof record.answer === 'string' ? record.answer.trim() : '';
  const bookingQuestion = typeof record.question === 'string' ? record.question.trim().toUpperCase() : '';
  const bookingUnit = typeof record.unit === 'string' ? record.unit.trim().toUpperCase() : '';
  if (
    bookingAnswer &&
    isViatorLocationReference(bookingAnswer) &&
    (bookingQuestion.includes('PICKUP') || bookingQuestion.includes('MEET')) &&
    (bookingUnit.includes('LOCATION_REFERENCE') || bookingUnit.includes('REFERENCE'))
  ) {
    out.add(bookingAnswer);
  }

  for (const [key, child] of Object.entries(record)) {
    const nextPath = `${path}.${key}`;
    if (typeof child === 'string') {
      const ref = child.trim();
      const keyLooksLikeRef = /ref|location|meeting|pickup|departure|start/i.test(key);
      const pathLooksLikeLocation = /location|meeting|pickup|departure|start/i.test(nextPath);
      if ((keyLooksLikeRef || pathLooksLikeLocation) && isViatorLocationReference(ref)) {
        out.add(ref);
      }
      continue;
    }
    if (child && typeof child === 'object') {
      collectLocationReferences(child, nextPath, out);
    }
  }
}

function extractLocationReference(locationPayload: Record<string, unknown>): string | null {
  const candidateKeys = ['ref', 'reference', 'locationRef', 'locationReference', 'id', 'answer'];
  for (const key of candidateKeys) {
    const value = locationPayload[key];
    if (typeof value === 'string' && isViatorLocationReference(value)) {
      return value.trim();
    }
  }
  return null;
}

function collectLocationPayloads(
  value: unknown,
  path: string,
  out: Record<string, unknown>[]
): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLocationPayloads(item, `${path}[${index}]`, out));
    return;
  }

  const record = value as Record<string, unknown>;
  const hasRef = extractLocationReference(record);
  if (hasRef && /location/i.test(path)) {
    out.push(record);
  }

  for (const [key, child] of Object.entries(record)) {
    if (!child || typeof child !== 'object') continue;
    collectLocationPayloads(child, `${path}.${key}`, out);
  }
}

async function fetchProductsBulk(productCodes: string[]): Promise<Map<string, unknown>> {
  const byCode = new Map<string, unknown>();
  if (!getViatorApiKey() || productCodes.length === 0) return byCode;

  const headers = buildViatorHeaders();

  const calls: Array<{ url: string; body: Record<string, unknown> }> = [
    {
      url: `${VIATOR_BASE_URL}/products/bulk`,
      body: { productCodes, currency: 'EUR' },
    },
    {
      url: `${VIATOR_BASE_URL}/products/search`,
      body: {
        currency: 'EUR',
        pagination: { start: 1, count: Math.max(productCodes.length, 20) },
        filtering: { productCodes },
      },
    },
  ];

  for (const call of calls) {
    try {
      const response = await fetch(call.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(call.body),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      collectProductPayloadsByCode(data, byCode);
      if (byCode.size >= productCodes.length) break;
    } catch {
      // Try next endpoint silently.
    }
  }

  // Last resort for unresolved products: product-by-product endpoint.
  const unresolved = productCodes.filter((code) => !byCode.has(code));
  if (unresolved.length === 0) return byCode;

  await Promise.allSettled(
    unresolved.map(async (code) => {
      try {
        const response = await fetch(`${VIATOR_BASE_URL}/products/${encodeURIComponent(code)}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) return;
        const data = await response.json();
        collectProductPayloadsByCode(data, byCode);
      } catch {
        // Ignore single-product failures.
      }
    })
  );

  return byCode;
}

async function fetchScheduleLocationReferences(
  productCodes: string[],
  destinationCenter: { lat: number; lng: number }
): Promise<Map<string, string[]>> {
  const refsByCode = new Map<string, string[]>();
  if (!getViatorApiKey() || productCodes.length === 0) return refsByCode;

  const headers = buildViatorHeaders();
  const startDate = new Date().toISOString().slice(0, 10);

  const responses = await Promise.allSettled(
    productCodes.map(async (code) => {
      const url = `${VIATOR_BASE_URL}/availability/schedules/${encodeURIComponent(code)}?startDate=${encodeURIComponent(startDate)}&currency=EUR`;
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) return { code, refs: [] as string[], direct: null as ViatorProductCoordinates | null };
      const data = await response.json();

      const direct = selectBestCoordinateCandidate(data, destinationCenter);
      const refs = new Set<string>();
      collectLocationReferences(data, 'schedule', refs);

      return { code, refs: Array.from(refs), direct };
    })
  );

  for (const result of responses) {
    if (result.status !== 'fulfilled') continue;
    const { code, refs, direct } = result.value;

    if (direct && !viatorProductCoordinatesCache.has(code)) {
      viatorProductCoordinatesCache.set(code, direct);
    }
    if (refs.length > 0) {
      refsByCode.set(code, refs);
    }
  }

  return refsByCode;
}

async function fetchLocationsBulk(
  refs: string[],
  destinationCenter: { lat: number; lng: number }
): Promise<Map<string, ViatorProductCoordinates>> {
  const resolved = new Map<string, ViatorProductCoordinates>();
  if (!getViatorApiKey() || refs.length === 0) return resolved;

  const refsToFetch = refs.filter((ref) => !viatorLocationCoordinatesCache.has(ref));
  if (refsToFetch.length === 0) {
    for (const ref of refs) {
      const cached = viatorLocationCoordinatesCache.get(ref);
      if (cached) resolved.set(ref, cached);
    }
    return resolved;
  }

  const headers = buildViatorHeaders();
  const calls = [
    { url: `${VIATOR_BASE_URL}/locations/bulk`, body: { locations: refsToFetch } },
    { url: `${VIATOR_BASE_URL}/locations/bulk`, body: { locationRefs: refsToFetch } },
  ];

  let data: unknown = null;
  for (const call of calls) {
    try {
      const response = await fetch(call.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(call.body),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      data = await response.json();
      break;
    } catch {
      // Try alternate payload format.
    }
  }

  if (data) {
    const locationPayloads: Record<string, unknown>[] = [];
    collectLocationPayloads(data, 'root', locationPayloads);

    for (const payload of locationPayloads) {
      const ref = extractLocationReference(payload);
      if (!ref) continue;
      const coords = selectBestCoordinateCandidate(payload, destinationCenter);
      if (coords) {
        viatorLocationCoordinatesCache.set(ref, coords);
      }
    }
  }

  for (const ref of refsToFetch) {
    if (!viatorLocationCoordinatesCache.has(ref)) {
      viatorLocationCoordinatesCache.set(ref, null);
    }
  }

  for (const ref of refs) {
    const cached = viatorLocationCoordinatesCache.get(ref);
    if (cached) resolved.set(ref, cached);
  }

  return resolved;
}

export async function getViatorProductCoordinatesBulk(
  productCodes: string[],
  destinationCenter: { lat: number; lng: number }
): Promise<Map<string, ViatorProductCoordinates>> {
  const resolved = new Map<string, ViatorProductCoordinates>();
  if (!getViatorApiKey() || productCodes.length === 0) return resolved;

  const normalizedCodes = Array.from(
    new Set(
      productCodes
        .map((code) => code.trim())
        .filter(Boolean)
    )
  );

  const unresolvedCodes: string[] = [];
  for (const code of normalizedCodes) {
    if (viatorProductCoordinatesCache.has(code)) {
      const cached = viatorProductCoordinatesCache.get(code);
      if (cached) resolved.set(code, cached);
      continue;
    }
    unresolvedCodes.push(code);
  }

  if (unresolvedCodes.length === 0) return resolved;

  const productPayloadsByCode = await fetchProductsBulk(unresolvedCodes);
  const locationRefsByCode = new Map<string, string[]>();
  const refsToResolve = new Set<string>();
  const unresolvedWithoutRefs: string[] = [];

  for (const code of unresolvedCodes) {
    const payload = productPayloadsByCode.get(code);
    if (!payload) continue;

    const directCoords = selectBestCoordinateCandidate(payload, destinationCenter);
    if (directCoords) {
      viatorProductCoordinatesCache.set(code, directCoords);
      resolved.set(code, directCoords);
      continue;
    }

    const refs = new Set<string>();
    collectLocationReferences(payload, 'product', refs);
    const refsList = Array.from(refs);
    if (refsList.length > 0) {
      locationRefsByCode.set(code, refsList);
      refsList.forEach((ref) => refsToResolve.add(ref));
    } else {
      unresolvedWithoutRefs.push(code);
    }
  }

  if (unresolvedWithoutRefs.length > 0) {
    const scheduleRefs = await fetchScheduleLocationReferences(unresolvedWithoutRefs, destinationCenter);
    for (const code of unresolvedWithoutRefs) {
      if (viatorProductCoordinatesCache.has(code) && viatorProductCoordinatesCache.get(code)) {
        resolved.set(code, viatorProductCoordinatesCache.get(code)!);
        continue;
      }
      const refs = scheduleRefs.get(code) || [];
      if (refs.length === 0) continue;
      locationRefsByCode.set(code, refs);
      refs.forEach((ref) => refsToResolve.add(ref));
    }
  }

  const locationsByRef = await fetchLocationsBulk(Array.from(refsToResolve), destinationCenter);

  for (const code of unresolvedCodes) {
    if (resolved.has(code)) continue;

    const refs = locationRefsByCode.get(code) || [];
    let coords: ViatorProductCoordinates | null = null;
    for (const ref of refs) {
      const refCoords = locationsByRef.get(ref);
      if (refCoords && isCoordinateNearDestination(refCoords, destinationCenter)) {
        coords = refCoords;
        break;
      }
    }

    viatorProductCoordinatesCache.set(code, coords);
    if (coords) resolved.set(code, coords);
  }

  return resolved;
}

/**
 * Try to get precise coordinates from Viator product APIs using productCode.
 * Some products expose meeting-point/location coordinates in product details.
 */
export async function getViatorProductCoordinates(
  productCode: string,
  destinationCenter: { lat: number; lng: number }
): Promise<ViatorProductCoordinates | null> {
  const normalizedCode = productCode?.trim();
  if (!getViatorApiKey() || !normalizedCode) return null;

  if (viatorProductCoordinatesCache.has(normalizedCode)) {
    return viatorProductCoordinatesCache.get(normalizedCode) || null;
  }

  if (viatorProductCoordinatesInFlight.has(normalizedCode)) {
    return viatorProductCoordinatesInFlight.get(normalizedCode) || null;
  }

  const inFlight = (async () => {
    const bulk = await getViatorProductCoordinatesBulk([normalizedCode], destinationCenter);
    return bulk.get(normalizedCode) || null;
  })();

  viatorProductCoordinatesInFlight.set(normalizedCode, inFlight);
  try {
    const coords = await inFlight;
    if (!viatorProductCoordinatesCache.has(normalizedCode)) {
      viatorProductCoordinatesCache.set(normalizedCode, coords);
    }
    return coords;
  } finally {
    viatorProductCoordinatesInFlight.delete(normalizedCode);
  }
}

/**
 * Build a Viator search URL as fallback
 * This always works even if we don't have the exact product URL
 */
function buildViatorSearchUrl(productTitle: string, destination: string): string {
  const searchQuery = `${productTitle} ${destination}`;
  return `https://www.viator.com/searchResults/all?text=${encodeURIComponent(searchQuery)}`;
}

/**
 * Validate and normalize a Viator product URL.
 * Priority: API productUrl (if valid viator.com URL) > search URL fallback.
 *
 * We don't try to construct product URLs from productCode alone because
 * Viator product URLs require a destination ID (e.g., d511 for Rome) that
 * the API doesn't always provide alongside the code.
 */
function normalizeViatorUrl(
  productUrl: string | undefined,
  productTitle: string,
  destination: string,
  _productCode?: string, // Reserved for future use if API provides dest ID
): string {
  // 1. Try API-provided productUrl (most reliable when present)
  if (productUrl && productUrl.trim() !== '') {
    // Relative URL → prepend Viator base
    if (productUrl.startsWith('/')) {
      return `https://www.viator.com${productUrl}`;
    }
    // Must be a proper http(s) URL on viator.com
    if (productUrl.startsWith('http')) {
      try {
        const url = new URL(productUrl);
        if (url.hostname.includes('viator.com')) {
          return productUrl;
        }
      } catch {
        // Invalid URL, fall through
      }
    }
  }

  // 2. Fallback: search URL (always shows relevant results)
  return buildViatorSearchUrl(productTitle, destination);
}

// ============================================
// Mapping catégories Viator → ActivityType
// ============================================

const VIATOR_TAG_TO_ACTIVITY_TYPE: Record<number, ActivityType> = {
  // Culture & History
  21911: 'culture',    // Museums
  21912: 'culture',    // Historical Tours
  21913: 'culture',    // Heritage Tours
  21914: 'culture',    // Art Tours
  // Food & Drink
  21917: 'gastronomy', // Food Tours
  21918: 'gastronomy', // Wine Tastings
  21919: 'gastronomy', // Cooking Classes
  // Nature & Outdoor
  21915: 'nature',     // Nature & Wildlife
  21916: 'nature',     // Hiking
  21920: 'adventure',  // Adventure
  21921: 'adventure',  // Water Sports
  // Nightlife
  21922: 'nightlife',  // Nightlife
  // Shopping
  21923: 'shopping',   // Shopping Tours
  // Wellness
  21924: 'wellness',   // Spa & Wellness
};

function guessActivityType(title: string, tags?: number[]): ActivityType {
  // Try tags first
  if (tags) {
    for (const tag of tags) {
      if (VIATOR_TAG_TO_ACTIVITY_TYPE[tag]) {
        return VIATOR_TAG_TO_ACTIVITY_TYPE[tag];
      }
    }
  }

  // Fallback: keyword matching on title
  const t = title.toLowerCase();
  if (/food|gastro|cook|wine|tast|tapas|culinar/i.test(t)) return 'gastronomy';
  if (/beach|surf|snorkel|dive|kayak|boat|sail|cruise/i.test(t)) return 'beach';
  if (/hike|trek|nature|wildlife|park|garden|mountain/i.test(t)) return 'nature';
  if (/museum|cathedral|church|palace|castle|histor|art|gallery|monument/i.test(t)) return 'culture';
  if (/adventure|zip|climb|bungee|paraglid|rafting/i.test(t)) return 'adventure';
  if (/night|club|bar|pub crawl/i.test(t)) return 'nightlife';
  if (/shop|market|boutique/i.test(t)) return 'shopping';
  if (/spa|wellness|massage|yoga/i.test(t)) return 'wellness';
  return 'culture'; // default
}

// ============================================
// Cache
// ============================================

function getCacheKey(destination: string, lat: number, lng: number): string {
  const key = `${destination}-${lat.toFixed(2)}-${lng.toFixed(2)}`;
  return key.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 200);
}

function readCache(key: string): Attraction[] | null {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, attractions: Attraction[]): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify(attractions, null, 2)
    );
  } catch (error) {
    console.warn('[Viator Cache] Erreur écriture:', error);
  }
}

// ============================================
// API calls
// ============================================

interface ViatorProduct {
  productCode: string;
  title: string;
  description?: string;
  duration?: { fixedDurationInMinutes?: number; variableDurationFromMinutes?: number };
  pricing?: { summary?: { fromPrice?: number }; currency?: string };
  reviews?: { totalReviews?: number; combinedAverageRating?: number };
  images?: Array<{ variants?: Array<{ url?: string; width?: number; height?: number }> }>;
  tags?: number[];
  flags?: string[];
  destinations?: Array<{ ref?: string; primary?: boolean }>;
  productUrl?: string;
}

interface ViatorSearchResponse {
  products?: ViatorProduct[];
  totalCount?: number;
}

/**
 * Recherche la destination ID Viator pour une ville
 */
async function findDestinationId(destination: string): Promise<string | null> {
  if (!getViatorApiKey()) return null;

  try {
    // Note: freetext search works best in English for destination names
    const response = await fetch(`${VIATOR_BASE_URL}/search/freetext`, {
      method: 'POST',
      headers: {
        'exp-api-key': getViatorApiKey() || '',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2.0',
      },
      body: JSON.stringify({
        searchTerm: destination,
        searchTypes: [{
          searchType: 'DESTINATIONS',
          pagination: { start: 1, count: 3 },
        }],
        currency: 'EUR',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[Viator] Freetext search failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const destinations = data?.destinations?.results;
    if (destinations && destinations.length > 0) {
      const id = destinations[0].id || destinations[0].ref;
      return id ? String(id) : null;
    }
    return null;
  } catch (error) {
    console.warn('[Viator] Erreur recherche destination:', error);
    return null;
  }
}

/**
 * Recherche des activités Viator pour une destination
 */
export async function searchViatorActivities(
  destination: string,
  cityCenter: { lat: number; lng: number },
  options?: {
    types?: ActivityType[];
    limit?: number;
    maxPricePerActivity?: number;
  }
): Promise<Attraction[]> {
  if (!getViatorApiKey()) {
    return [];
  }

  const limit = options?.limit || 30;
  const cacheKey = getCacheKey(destination, cityCenter.lat, cityCenter.lng);

  // Check cache
  const cached = readCache(cacheKey);
  if (cached) return cached;

  try {
    // 1. Find destination ID
    const destId = await findDestinationId(destination);

    // 2. Search products
    const searchBody: Record<string, unknown> = {
      currency: 'EUR',
      pagination: { start: 1, count: limit },
      sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
    };

    if (destId) {
      searchBody.filtering = { destination: destId };
    } else {
      // Fallback: search by coordinates with radius
      searchBody.filtering = {
        location: {
          coordinates: {
            latitude: cityCenter.lat,
            longitude: cityCenter.lng,
          },
          radius: 15,
          unit: 'km',
        },
      };
    }

    // Add quality tags filter
    searchBody.filtering = {
      ...searchBody.filtering as Record<string, unknown>,
      tags: [21972], // Excellent Quality tag
    };

    const response = await fetch(`${VIATOR_BASE_URL}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': getViatorApiKey() || '',
        'Accept-Language': 'fr-FR',
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2.0',
      },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      // If quality filter fails, retry without it
      if (response.status === 400) {
        delete (searchBody.filtering as Record<string, unknown>).tags;
        const retryResponse = await fetch(`${VIATOR_BASE_URL}/products/search`, {
          method: 'POST',
          headers: {
            'exp-api-key': getViatorApiKey() || '',
            'Accept-Language': 'fr-FR',
            'Content-Type': 'application/json',
            'Accept': 'application/json;version=2.0',
          },
          body: JSON.stringify(searchBody),
          signal: AbortSignal.timeout(8000),
        });
        if (!retryResponse.ok) {
          console.warn(`[Viator] Search failed: ${retryResponse.status}`);
          return [];
        }
        const data: ViatorSearchResponse = await retryResponse.json();
        return processViatorResults(data, destination, cityCenter, cacheKey, options?.maxPricePerActivity);
      }
      console.warn(`[Viator] Search failed: ${response.status}`);
      return [];
    }

    const data: ViatorSearchResponse = await response.json();
    return processViatorResults(data, destination, cityCenter, cacheKey, options?.maxPricePerActivity);
  } catch (error) {
    console.warn('[Viator] Erreur recherche:', error);
    return [];
  }
}

/**
 * Cherche un produit Viator correspondant à une activité (ex: "Colosseum, Rome")
 * Retourne l'URL affiliée et le prix si un match est trouvé.
 *
 * Ordre de priorité:
 * 1. URLs connues (viatorKnownProducts.ts) - garantie de qualité
 * 2. Exact match dans les résultats API
 * 3. Fuzzy match avec seuil strict (60%)
 */
export interface ViatorProductResult {
  url: string;
  price: number;
  title: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  duration?: number; // Durée en minutes du produit Viator
}

export async function findViatorProduct(
  activityName: string,
  destinationName: string,
): Promise<ViatorProductResult | null> {
  // ===== PRIORITÉ 1: URLs connues =====
  const knownProduct = findKnownViatorProduct(activityName);
  if (knownProduct) {
    return knownProduct;
  }

  if (!getViatorApiKey()) return null;

  try {
    // Nettoyer le nom de l'activité pour la recherche
    // Garder plus de mots pour une recherche plus précise
    const searchTerm = activityName
      .replace(/\b(visite|visit|guided|entry|billet)\b/gi, '')
      .trim();

    const response = await fetch(`${VIATOR_BASE_URL}/search/freetext`, {
      method: 'POST',
      headers: {
        'exp-api-key': getViatorApiKey() || '',
        'Accept-Language': 'fr-FR',
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2.0',
      },
      body: JSON.stringify({
        searchTerm: `${searchTerm} ${destinationName}`,
        searchTypes: [{
          searchType: 'PRODUCTS',
          pagination: { start: 1, count: 10 }, // Plus de résultats pour mieux matcher
        }],
        currency: 'EUR',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const products = data?.products?.results || [];

    if (products.length === 0) return null;

    // Filtrer les produits avec les keywords exclus
    const filteredProducts = products.filter((p: ViatorProduct) => {
      const titleLower = (p.title || '').toLowerCase();
      if (VIATOR_EXCLUDED_KEYWORDS.some(kw => titleLower.includes(kw))) return false;
      if (isViatorLowRelevanceCandidate(p.title || '', p.description)) return false;
      return true;
    });

    if (filteredProducts.length === 0) return null;

    const activityNameLower = activityName.toLowerCase();
    const activityWords = activityNameLower.split(/\s+/).filter(w => w.length > 3);

    // ===== PRIORITÉ 2: Exact match =====
    // Le nom de l'activité est contenu dans le titre du produit OU vice-versa
    for (const product of filteredProducts) {
      const productTitle = (product.title || '').toLowerCase();
      const productTitleClean = productTitle.replace(/tour|visit|ticket|skip.*line|guided/gi, '').trim();

      // Exact match: le titre du produit contient le nom de l'activité
      if (productTitle.includes(activityNameLower) || activityNameLower.includes(productTitleClean)) {
        const price = product.pricing?.summary?.fromPrice || 0;
        const url = normalizeViatorUrl(product.productUrl, product.title, destinationName, product.productCode);
        const imageUrl = product.images?.[0]?.variants?.find((v: { width?: number; url?: string }) => v.width && v.width >= 480 && v.width <= 800)?.url || product.images?.[0]?.variants?.[0]?.url;
        const duration = product.duration?.fixedDurationInMinutes || product.duration?.variableDurationFromMinutes;
        return { url, price: Math.round(price), title: product.title, imageUrl, rating: product.reviews?.combinedAverageRating, reviewCount: product.reviews?.totalReviews, duration };
      }
    }

    // ===== PRIORITÉ 3: Fuzzy match avec seuil dynamique =====
    // Seuil plus strict pour les noms ambigus (palazzo, museum, church, etc.)
    const ambiguousNamePattern = /\b(palazzo|museum|musée|musee|church|église|eglise|basilica|basilique|temple|castle|château|chateau|cathedral|cathédrale|cathedrale|gallery|galerie)\b/i;
    const isAmbiguousName = ambiguousNamePattern.test(activityNameLower);
    const minThreshold = isAmbiguousName ? 0.75 : 0.6;

    let bestMatch: { product: ViatorProduct; score: number } | null = null;

    for (const product of filteredProducts) {
      const productTitle = (product.title || '').toLowerCase();
      const matchCount = activityWords.filter(w => productTitle.includes(w)).length;
      const matchRatio = activityWords.length > 0 ? matchCount / activityWords.length : 0;

      // Seuil dynamique: plus strict pour les noms ambigus (palazzo, museum, etc.)
      if (matchRatio >= minThreshold || (matchCount >= 3 && matchRatio >= 0.5)) {
        const score = matchRatio * 100 + matchCount * 10;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { product, score };
        }
      }
    }

    if (bestMatch) {
      const price = bestMatch.product.pricing?.summary?.fromPrice || 0;
      const url = normalizeViatorUrl(bestMatch.product.productUrl, bestMatch.product.title, destinationName, bestMatch.product.productCode);
      const imageUrl = bestMatch.product.images?.[0]?.variants?.find((v: { width?: number; url?: string }) => v.width && v.width >= 480 && v.width <= 800)?.url || bestMatch.product.images?.[0]?.variants?.[0]?.url;
      const duration = bestMatch.product.duration?.fixedDurationInMinutes || bestMatch.product.duration?.variableDurationFromMinutes;
      return { url, price: Math.round(price), title: bestMatch.product.title, imageUrl, rating: bestMatch.product.reviews?.combinedAverageRating, reviewCount: bestMatch.product.reviews?.totalReviews, duration };
    }

    return null;
  } catch (error) {
    console.warn(`[Viator] Erreur findViatorProduct("${activityName}"):`, error);
    return null;
  }
}

// Keywords to exclude from Viator results (venues, concerts, etc.)
const VIATOR_EXCLUDED_KEYWORDS = [
  // Concert halls & venues - on ne "visite" pas ces lieux sans spectacle
  'concertgebouw', 'concert hall', 'philharmonic', 'philharmonie',
  'opera house', 'symphony', 'orchestra performance',
  // Venues without actual tour value
  'ziggo dome', 'heineken music hall', 'melkweg', 'paradiso',
  'bimhuis', 'muziekgebouw', 'carré',
  // Generic photo spots
  'photo spot', 'instagram spot', 'selfie',
  // Photography/photoshoot marketing activities
  'photoshoot', 'photo shoot', 'photo tour', 'photo session',
  'photography tour', 'photography experience', 'photo experience',
  'professional photographer', 'professional photo',
  // Tourist traps + commercial experience museums
  'madame tussauds', 'tussaud', 'wax museum', 'trick eye',
  'selfie museum', "ripley's",
  'museum of illusions', 'upside down', 'banksy museum', 'wondr', 'ice bar',
  // Wellness/spa — non pertinent pour tourisme standard
  'massage', 'thai massage', 'spa treatment', 'hammam', 'thermal bath treatment',
  // Ultra-luxe inaccessible pour budgets normaux
  'private yacht', 'luxury sailing', 'private sailing', 'private boat charter',
  'helicopter', 'helicoptère', 'limousine', 'limo tour',
  'ferrari', 'lamborghini', 'supercar', 'sports car',
  // Low-relevance experiences for most sightseeing itineraries
  'magic show', 'magician', 'illusion show',
];

const VIATOR_MONUMENT_PLUS_VALUE_KEYWORDS = [
  'skip the line', 'priority access', 'small group', 'expert guide',
  'private guide', 'after hours', 'exclusive access', 'audio guide',
  'fast-track', 'quick access',
];

const VIATOR_LOW_RELEVANCE_KEYWORDS = [
  'photoshoot', 'photo shoot', 'photo session', 'professional photographer',
  'magic show', 'magician', 'selfie',
];

const VIATOR_GENERIC_PRIVATE_TOUR_KEYWORDS = [
  'private tour', 'private walking tour', 'private city tour',
  'customized private', 'customized tour', 'customizable tour', 'custom-made tour',
  'tailor-made', 'bespoke tour', 'personalized tour',
  'visite privee', 'tour prive', 'personnalise', 'personnalisee',
  'local insights', 'hidden gems',
];

function normalizeViatorText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function isViatorLowRelevanceCandidate(title: string, description?: string): boolean {
  const text = `${normalizeViatorText(title)} ${normalizeViatorText(description)}`.trim();
  if (!text) return false;
  return VIATOR_LOW_RELEVANCE_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function isViatorGenericPrivateTourCandidate(title: string, description?: string): boolean {
  const text = `${normalizeViatorText(title)} ${normalizeViatorText(description)}`.trim();
  if (!text) return false;

  if (VIATOR_GENERIC_PRIVATE_TOUR_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return true;
  }

  const hasPrivateSignal = /\b(private|privee?|prive)\b/.test(text);
  const hasCustomizedSignal = /\b(custom|customized|customizable|tailor[-\s]?made|bespoke|personalized|personnalise)\b/.test(text);
  return hasPrivateSignal && hasCustomizedSignal;
}

export function scoreViatorPlusValue(input: ViatorPlusValueInput): ViatorPlusValueAssessment {
  const reasons: string[] = [];
  const text = `${normalizeViatorText(input.title)} ${normalizeViatorText(input.description)}`.trim();
  let score = 0;

  if (VIATOR_MONUMENT_PLUS_VALUE_KEYWORDS.some((keyword) => text.includes(keyword))) {
    score += 2;
    reasons.push('has_clear_operational_benefit');
  }

  const rating = Number(input.rating || 0);
  const reviewCount = Number(input.reviewCount || 0);
  const price = Number(input.price || 0);

  if (rating >= 4.6) {
    score += 1;
    reasons.push('high_rating');
  } else if (rating > 0 && rating < 4.2) {
    score -= 1;
    reasons.push('low_rating');
  }

  if (reviewCount >= 500) {
    score += 1;
    reasons.push('high_social_proof');
  } else if (reviewCount > 0 && reviewCount < 30) {
    score -= 1;
    reasons.push('weak_social_proof');
  }

  if (input.freeCancellation) {
    score += 0.5;
    reasons.push('free_cancellation');
  }
  if (input.instantConfirmation) {
    score += 0.5;
    reasons.push('instant_confirmation');
  }

  if (isViatorLowRelevanceCandidate(input.title, input.description)) {
    score -= 4;
    reasons.push('low_relevance_pattern');
  }

  if (isViatorGenericPrivateTourCandidate(input.title, input.description)) {
    score -= 2.5;
    reasons.push('generic_private_tour');
  }

  if (price >= 180) {
    score -= 2;
    reasons.push('very_high_price');
  } else if (price >= 120) {
    score -= 1;
    reasons.push('high_price');
  }

  return {
    score: Math.round(score * 10) / 10,
    reasons,
  };
}

function inferViatorOpeningHours(title: string, description?: string): { open: string; close: string } {
  const text = `${title} ${description || ''}`.toLowerCase();

  const eveningKeywords = [
    'evening', 'night', 'sunset', 'aperitivo', 'dinner', 'pub crawl', 'after dark',
    'soir', 'soirée', 'nuit', 'coucher de soleil', 'apéritif', 'dîner', 'bar',
  ];
  const morningKeywords = ['morning', 'sunrise', 'breakfast', 'matin', 'lever du soleil', 'petit-déjeuner'];

  if (eveningKeywords.some(k => text.includes(k))) return { open: '17:00', close: '23:30' };
  if (morningKeywords.some(k => text.includes(k))) return { open: '07:00', close: '12:30' };
  return { open: '09:00', close: '18:00' };
}

function processViatorResults(
  data: ViatorSearchResponse,
  destination: string,
  cityCenter: { lat: number; lng: number },
  cacheKey: string,
  maxPricePerActivity: number = 200
): Attraction[] {
  const products = data.products || [];
  if (products.length === 0) return [];

  const attractions: Attraction[] = products
    .filter(p => {
      if (!p.title || !p.productCode) return false;
      // Filter out excluded keywords
      const titleLower = p.title.toLowerCase();
      for (const kw of VIATOR_EXCLUDED_KEYWORDS) {
        if (titleLower.includes(kw)) {
          return false;
        }
      }
      if (isViatorLowRelevanceCandidate(p.title, p.description)) {
        return false;
      }
      // Filter out overpriced activities
      const price = p.pricing?.summary?.fromPrice || 0;
      if (price > maxPricePerActivity) {
        return false;
      }
      return true;
    })
    .map((p): Attraction => {
      // Get best image (medium size ~720px)
      let imageUrl: string | undefined;
      if (p.images?.[0]?.variants) {
        const variants = p.images[0].variants;
        // Prefer medium-sized image
        const medium = variants.find(v => v.width && v.width >= 480 && v.width <= 800);
        imageUrl = medium?.url || variants[0]?.url;
      }

      // Duration
      const durationMinutes = p.duration?.fixedDurationInMinutes
        || p.duration?.variableDurationFromMinutes
        || 90; // default 1h30

      // Price
      const price = p.pricing?.summary?.fromPrice || 0;

      // Rating
      const rating = p.reviews?.combinedAverageRating || 4.0;
      const reviewCount = p.reviews?.totalReviews || 0;

      // Utiliser productUrl de l'API si disponible, sinon construire depuis productCode, sinon recherche
      const affiliateUrl = normalizeViatorUrl(p.productUrl, p.title, destination, p.productCode);

      const cleanDescription = (p.description || p.title || '')
        .replace(/\s+/g, ' ')
        .trim();

      const plusValue = scoreViatorPlusValue({
        title: p.title,
        description: cleanDescription,
        rating,
        reviewCount,
        price,
        freeCancellation: (p.flags || []).some(f => /free.?cancel/i.test(f) || /annulation.?gratuite/i.test(f)),
        instantConfirmation: (p.flags || []).some(f => /instant.?confirm/i.test(f) || /confirmation.?instantan/i.test(f)),
      });

      return {
        id: `viator-${p.productCode}`,
        name: p.title,
        type: guessActivityType(p.title, p.tags),
        description: cleanDescription || p.title,
        duration: durationMinutes,
        estimatedCost: Math.round(price),
        latitude: cityCenter.lat, // Viator doesn't return exact coords — resolved later via coordsResolver
        longitude: cityCenter.lng,
        rating: Math.min(5, Math.round(rating * 10) / 10),
        mustSee: (reviewCount > 500 && rating >= 4.5),
        bookingRequired: true,
        bookingUrl: affiliateUrl,
        openingHours: inferViatorOpeningHours(p.title, p.description),
        dataReliability: 'estimated', // coords are city center, not exact — will be resolved
        geoSource: 'city_fallback',
        geoConfidence: 'low',
        qualityFlags: ['viator_city_center_fallback', ...(plusValue.score < 1 ? ['viator_low_plus_value'] : [])],
        imageUrl,
        providerName: 'Viator',
        reviewCount,
        freeCancellation: (p.flags || []).some(f => /free.?cancel/i.test(f) || /annulation.?gratuite/i.test(f)),
        instantConfirmation: (p.flags || []).some(f => /instant.?confirm/i.test(f) || /confirmation.?instantan/i.test(f)),
      };
    });

  // Cache results
  if (attractions.length > 0) {
    writeCache(cacheKey, attractions);
  }

  return attractions;
}

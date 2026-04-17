/**
 * Pipeline V3 — Step 0: Destination Intelligence + Region Resolver
 *
 * Provides expert-level knowledge about any destination to guide
 * the entire pipeline: must-see attractions, local cuisine, neighborhoods,
 * tourist traps to avoid, and cultural context.
 *
 * Architecture:
 *   1. Static cache (destination-intel-cache.ts) — curated by Claude Opus for top 30 destinations. $0, instant.
 *   2. LLM fallback (Gemini 3 Flash) — for uncached destinations. ~$0.005/trip.
 *   3. Region resolver — classifies destination as city/region/country/vague,
 *      resolves regions to concrete cities with suggested durations.
 */

import type { TripPreferences, CityStage } from '../types';
import { fetchGeminiWithRetry } from '../services/geminiSearch';
import { CITY_CENTERS } from '../services/geocoding';
import type { DestinationEnvelope } from '../services/destinationEnvelope';

// ============================================
// Types
// ============================================

export interface DestinationIntel {
  mustSeeAttractions: Array<{
    name: string;
    type: 'culture' | 'nature' | 'landmark' | 'museum' | 'food' | 'entertainment' | 'neighborhood';
    whyImportant: string;
    estimatedDuration: number;
    neighborhood: string;
  }>;
  localCuisine: Array<{
    cuisineType: string;
    searchQuery: string;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'any';
  }>;
  neighborhoods: Array<{
    name: string;
    vibe: string;
    bestFor: string;
  }>;
  avoidList: Array<{
    name: string;
    reason: string;
  }>;
  breakfastStyle: string;
  culturalNotes: string[];
}

// ============================================
// Main Function
// ============================================

let _cache: Record<string, DestinationIntel> | null = null;

function getCache(): Record<string, DestinationIntel> {
  if (!_cache) {
    try {
      // Dynamic import to avoid circular deps — the cache file is a large static object
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DESTINATION_INTEL_CACHE } = require('../data/destination-intel-cache');
      _cache = DESTINATION_INTEL_CACHE;
    } catch {
      _cache = {};
    }
  }
  return _cache!;
}

/**
 * Get destination intelligence: try cache first, then LLM fallback.
 */
export async function getDestinationIntel(
  destination: string,
  preferences?: TripPreferences
): Promise<DestinationIntel | null> {
  const cache = getCache();

  // Normalize destination for cache lookup
  const key = destination
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Try exact match
  if (cache[key]) {
    console.log(`[Step 0] Destination intel cache HIT: ${key}`);
    return cache[key];
  }

  // Try partial match (e.g., "New York City" matches "new york")
  for (const [cacheKey, intel] of Object.entries(cache)) {
    if (key.includes(cacheKey) || cacheKey.includes(key)) {
      console.log(`[Step 0] Destination intel cache PARTIAL HIT: ${key} → ${cacheKey}`);
      return intel;
    }
  }

  // Cache miss — LLM fallback
  console.log(`[Step 0] Destination intel cache MISS: ${key} — calling Gemini 3 Flash`);
  return fetchDestinationIntelFromLLM(destination, preferences);
}

// ============================================
// LLM Fallback
// ============================================

async function fetchDestinationIntelFromLLM(
  destination: string,
  preferences?: TripPreferences
): Promise<DestinationIntel | null> {
  const prompt = `Tu es un expert voyage pour ${destination}. ${preferences ? `Voyage ${preferences.durationDays} jours, ${preferences.groupType}, budget ${preferences.budgetLevel}.` : ''}

Génère un JSON avec exactement cette structure :
{
  "mustSeeAttractions": [10-12 lieux avec { "name": string, "type": "culture"|"nature"|"landmark"|"museum"|"food"|"entertainment"|"neighborhood", "whyImportant": string, "estimatedDuration": number (minutes), "neighborhood": string }],
  "localCuisine": [5-7 cuisines avec { "cuisineType": string, "searchQuery": string (pour Google Places API), "mealType": "breakfast"|"lunch"|"dinner"|"any" }],
  "neighborhoods": [3-5 quartiers avec { "name": string, "vibe": string, "bestFor": string }],
  "avoidList": [3-5 pièges à touristes avec { "name": string, "reason": string }],
  "breakfastStyle": string (ce que les locaux mangent au petit-déj),
  "culturalNotes": [2-3 string (tips pratiques: pourboires, dress code, horaires)]
}

IMPORTANT: ne recommande que des lieux ICONIQUES et AUTHENTIQUES. Pas de chaînes, pas de tourist traps. Les searchQuery doivent fonctionner dans Google Places API.`;

  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    }, 3, 'step0_destintel');

    if (!response.ok) {
      console.warn(`[Step 0] LLM fallback failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || '').join('').trim();

    if (!text) return null;

    // Extract JSON from response
    const parsed = extractJson<DestinationIntel>(text);
    if (parsed && Array.isArray(parsed.mustSeeAttractions)) {
      console.log(`[Step 0] LLM fallback success: ${parsed.mustSeeAttractions.length} attractions, ${parsed.localCuisine?.length || 0} cuisines`);
      return parsed;
    }

    console.warn('[Step 0] LLM response did not contain valid intel');
    return null;
  } catch (e) {
    console.warn('[Step 0] LLM fallback error:', e);
    return null;
  }
}

// ============================================
// Helpers
// ============================================

function extractJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) as T; } catch { /* continue */ }
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.substring(braceStart, braceEnd + 1)) as T; } catch { /* continue */ }
  }

  return null;
}

// ============================================
// Region Resolver — Classify & resolve destinations
// ============================================

export type DestinationType = 'city' | 'region' | 'country' | 'vague';

export interface DestinationAnalysis {
  inputType: DestinationType;
  resolvedCities: Array<{
    name: string;
    stayDuration: number; // jours recommandés
    highlights: string[];
    coords?: { lat: number; lng: number };
  }>;
  destinationEnvelope?: DestinationEnvelope;
}

// Nominatim types that indicate a region (not a city)
const REGION_TYPES = new Set(['administrative', 'state', 'region', 'country', 'boundary', 'province', 'county']);
const CITY_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality']);

interface NominatimResult {
  place_id: number;
  type: string;
  class: string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
  importance: number;
  name?: string;
  addresstype?: string;
}

/**
 * Classify a destination via Nominatim, then resolve regions to cities.
 * Uses LLM for contextual suggestions, falls back to Nominatim bbox search.
 */
export async function resolveDestination(
  preferences: TripPreferences,
): Promise<DestinationAnalysis | null> {
  const dest = preferences.destination.trim();
  const cache = getCache();

  const key = dest.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Check 1: destination intel cache (30 top destinations) → known city
  for (const cacheKey of Object.keys(cache)) {
    if (key === cacheKey || key.includes(cacheKey) || cacheKey.includes(key)) {
      return null;
    }
  }

  // Check 2: CITY_CENTERS (300+ cities) → known city
  const cityCenterKey = key.replace(/[^a-z\s]/g, '').trim();
  if (CITY_CENTERS[cityCenterKey]) {
    return null;
  }
  for (const ck of Object.keys(CITY_CENTERS)) {
    if (cityCenterKey.includes(ck) || ck.includes(cityCenterKey)) {
      return null;
    }
  }

  // Check 3: Nominatim classification — is this a city or a region?
  console.log(`[Step 0] Region resolver: classifying "${dest}" via Nominatim`);
  let nominatimResult: NominatimResult | null = null;
  try {
    const nRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dest)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'NaraeVoyage/1.0' } },
    );
    if (nRes.ok) {
      const results = await nRes.json();
      if (results.length > 0) nominatimResult = results[0];
    }
  } catch (e) {
    console.warn('[Step 0] Nominatim classification failed:', e);
  }

  // If Nominatim says it's a city → pipeline classique
  if (nominatimResult) {
    const nType = nominatimResult.type || nominatimResult.addresstype || '';
    if (CITY_TYPES.has(nType)) {
      console.log(`[Step 0] Nominatim: "${dest}" is a city (type=${nType}), skipping resolver`);
      return null;
    }
    // If it's a region/country → proceed to resolve
    if (REGION_TYPES.has(nType) || nominatimResult.class === 'boundary') {
      console.log(`[Step 0] Nominatim: "${dest}" is a region (type=${nType}), resolving to cities`);
    }
  }

  // Try LLM first (contextual, budget-aware suggestions)
  const llmResult = await resolveLLM(dest, preferences);
  if (llmResult) return llmResult;

  // LLM failed → Nominatim bbox fallback
  if (nominatimResult?.boundingbox) {
    console.log(`[Step 0] LLM failed, using Nominatim bbox fallback for "${dest}"`);
    const bboxResult = await resolveViaNominatimBbox(nominatimResult.boundingbox, preferences.durationDays);
    if (bboxResult) return bboxResult;
  }

  console.warn(`[Step 0] Region resolver: could not resolve "${dest}"`);
  return null;
}

/**
 * Search for major cities within a bounding box using Nominatim.
 */
async function resolveViaNominatimBbox(
  bbox: [string, string, string, string],
  durationDays: number,
): Promise<DestinationAnalysis | null> {
  const [south, north, west, east] = bbox;
  try {
    // viewbox format: west,north,east,south (lon,lat,lon,lat)
    const url = `https://nominatim.openstreetmap.org/search?q=city&format=json&limit=10&bounded=1&viewbox=${west},${north},${east},${south}&featuretype=city`;
    const res = await fetch(url, { headers: { 'User-Agent': 'NaraeVoyage/1.0' } });
    if (!res.ok) return null;

    const cities: NominatimResult[] = await res.json();
    if (cities.length === 0) return null;

    // Sort by importance (Nominatim's relevance score) and take top 2-4
    const maxCities = durationDays <= 3 ? 1 : durationDays <= 5 ? 2 : Math.min(4, Math.floor(durationDays / 2));
    const topCities = cities
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, maxCities);

    // Distribute days
    let remaining = durationDays;
    const resolvedCities = topCities.map((c, i) => {
      const name = c.name || c.display_name.split(',')[0].trim();
      const days = i === topCities.length - 1
        ? Math.max(1, remaining)
        : Math.max(1, Math.round(remaining / (topCities.length - i)));
      remaining -= days;
      const lat = Number.parseFloat(c.lat || '');
      const lng = Number.parseFloat(c.lon || '');
      return {
        name,
        stayDuration: days,
        highlights: [],
        coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
      };
    });

    console.log(`[Step 0] Nominatim bbox: found ${resolvedCities.length} cities: ${resolvedCities.map(c => `${c.name} (${c.stayDuration}j)`).join(', ')}`);
    return { inputType: 'region', resolvedCities };
  } catch (e) {
    console.warn('[Step 0] Nominatim bbox search failed:', e);
    return null;
  }
}

/**
 * Resolve destination via LLM (Gemini 3 Flash).
 */
async function resolveLLM(
  dest: string,
  preferences: TripPreferences,
): Promise<DestinationAnalysis | null> {
  const prompt = `Tu es un expert géographie et voyage. Analyse cette destination : "${dest}"

Contexte du voyage : ${preferences.durationDays} jours, ${preferences.groupSize} personnes, ${preferences.groupType}, budget ${preferences.budgetLevel}${preferences.activities?.length ? `, intérêts : ${preferences.activities.join(', ')}` : ''}.

Réponds en JSON strict :
{
  "inputType": "city" | "region" | "country" | "vague",
  "resolvedCities": [
    {
      "name": "Nom de la ville (précis, sans le pays)",
      "stayDuration": nombre de jours recommandés,
      "highlights": ["2-3 raisons courtes d'y aller"]
    }
  ]
}

Règles :
- "city" si c'est déjà une ville précise (Paris, Lyon, etc.) → resolvedCities = [{ cette ville, durée totale }]
- "region" si c'est une région (Bretagne, Toscane, Algarve, Côte d'Azur) → 2-4 villes dans la région
- "country" si c'est un pays (Japon, Islande, Portugal) → 2-4 villes du pays
- "vague" si c'est flou ("au soleil", "mer", "montagne") → 2-3 destinations concrètes
- Adapte le nombre de villes à la durée : 2-3 jours → 1 ville, 4-5 jours → 2 villes, 6+ jours → 2-4 villes
- Adapte au budget : economic → villes abordables, luxury → destinations premium
- La somme des stayDuration doit = ${preferences.durationDays} jours
- Choisis des villes avec des choses à faire (pas des bleds paumés)`;

  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    }, 3, 'step0_cityplan_resolver');

    if (!response.ok) {
      console.warn(`[Step 0] LLM resolver failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || '').join('').trim();
    if (!text) return null;

    const parsed = extractJson<DestinationAnalysis>(text);
    if (!parsed || !Array.isArray(parsed.resolvedCities) || parsed.resolvedCities.length === 0) {
      console.warn('[Step 0] LLM resolver: invalid response');
      return null;
    }

    // Validate stayDuration
    parsed.resolvedCities = parsed.resolvedCities.filter(c => c.stayDuration > 0 && c.name);
    if (parsed.resolvedCities.length === 0) return null;

    const totalDays = parsed.resolvedCities.reduce((s, c) => s + c.stayDuration, 0);
    if (totalDays !== preferences.durationDays) {
      let remaining = preferences.durationDays;
      const ratio = preferences.durationDays / totalDays;
      for (let i = 0; i < parsed.resolvedCities.length; i++) {
        if (i === parsed.resolvedCities.length - 1) {
          parsed.resolvedCities[i].stayDuration = Math.max(1, remaining);
        } else {
          const adjusted = Math.max(1, Math.round(parsed.resolvedCities[i].stayDuration * ratio));
          parsed.resolvedCities[i].stayDuration = adjusted;
          remaining -= adjusted;
        }
      }
    }

    console.log(`[Step 0] LLM resolver: "${dest}" → ${parsed.inputType}, ${parsed.resolvedCities.length} cities: ${parsed.resolvedCities.map(c => `${c.name} (${c.stayDuration}j)`).join(', ')}`);
    return parsed;
  } catch (e) {
    console.warn('[Step 0] LLM resolver error:', e);
    return null;
  }
}

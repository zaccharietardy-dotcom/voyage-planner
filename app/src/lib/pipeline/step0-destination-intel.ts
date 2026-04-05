/**
 * Pipeline V3 — Step 0: Destination Intelligence
 *
 * Provides expert-level knowledge about any destination to guide
 * the entire pipeline: must-see attractions, local cuisine, neighborhoods,
 * tourist traps to avoid, and cultural context.
 *
 * Architecture:
 *   1. Static cache (destination-intel-cache.ts) — curated by Claude Opus for top 30 destinations. $0, instant.
 *   2. LLM fallback (Gemini 3 Flash) — for uncached destinations. ~$0.005/trip.
 */

import type { TripPreferences } from '../types';
import { fetchGeminiWithRetry } from '../services/geminiSearch';

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
    });

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

/**
 * Service centralisé de résolution GPS — 100% précision
 *
 * Chaîne exhaustive de résolution (du moins cher au plus cher) :
 * 1. Cache mémoire (gratuit)
 * 2. Travel Places API (gratuit, RapidAPI)
 * 3. Nominatim/OSM (gratuit, 500ms throttle)
 * 4. Gemini 2.5 Flash + Google Search (gratuit)
 * 5. Google Places API (New) (gratuit dans $200/mois de crédit)
 * 6. SerpAPI Google Maps (payant, ~$0.01/call, dernier recours)
 *
 * Si toutes échouent → retourne null → l'item sera remplacé ou supprimé
 * JAMAIS de coordonnées inventées.
 */

import { resolveAttractionByName } from './overpassAttractions';
import { geocodeAddress, calculateDistance } from './geocoding';
import { geocodeWithGemini } from './geminiSearch';
import { geocodeWithFallback } from './serpApiPlaces';

// Distance maximale acceptée entre le résultat API et le centre de destination.
// NOTE:
// - Attractions in regional / road-trip contexts legitimately span wider areas.
// - Restaurants/hotels remain stricter to avoid cross-city pollution.
const DEFAULT_ATTRACTION_MAX_DISTANCE_KM = 60;
const DEFAULT_LOCAL_MAX_DISTANCE_KM = 25;
const BROAD_DESTINATION_MAX_DISTANCE_KM = 220;
const BROAD_DESTINATION_HINTS = [
  'bretagne',
  'normandie',
  'provence',
  'loire',
  'alsace',
  'occitanie',
  'corse',
  'toscane',
  'sicile',
  'andalousie',
  'region',
  'région',
  'province',
  'country',
  'france',
  'italie',
  'espagne',
];

function normalizeHint(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isLikelyBroadDestination(city: string): boolean {
  const normalized = normalizeHint(city);
  if (!normalized) return false;

  if (BROAD_DESTINATION_HINTS.some((hint) => normalized.includes(hint))) {
    return true;
  }

  // Heuristic: multi-token area names often indicate a region-level query
  // ("cote de granit rose", "south of france", etc.).
  const tokens = normalized.split(/[\s,-]+/).filter(Boolean);
  return tokens.length >= 4;
}

function inferResolutionMaxDistanceKm(
  city: string,
  itemType: string,
  explicitMaxDistanceKm?: number
): number {
  if (Number.isFinite(explicitMaxDistanceKm)) {
    return Math.max(5, Math.min(300, explicitMaxDistanceKm as number));
  }

  if (isLikelyBroadDestination(city)) {
    return BROAD_DESTINATION_MAX_DISTANCE_KM;
  }

  const normalizedType = (itemType || '').toLowerCase();
  if (normalizedType === 'restaurant' || normalizedType === 'hotel') {
    return DEFAULT_LOCAL_MAX_DISTANCE_KM;
  }

  return DEFAULT_ATTRACTION_MAX_DISTANCE_KM;
}

/**
 * Vérifie que les coordonnées résolues sont bien proches de la destination
 * Rejette les résultats d'une autre ville (ex: Lisbonne pour un trip Barcelone)
 */
function isResultNearDestination(
  result: { lat: number; lng: number },
  nearbyCoords: { lat: number; lng: number },
  name: string,
  source: string,
  maxDistanceKm: number
): boolean {
  const distance = calculateDistance(result.lat, result.lng, nearbyCoords.lat, nearbyCoords.lng);
  if (distance > maxDistanceKm) {
    console.warn(`[CoordsResolver] ❌ ${source} rejeté pour "${name}": ${distance.toFixed(1)}km de la destination (max ${maxDistanceKm}km)`);
    return false;
  }
  return true;
}

export interface ResolutionResult {
  lat: number;
  lng: number;
  source: 'cache' | 'travel_places' | 'nominatim' | 'gemini' | 'google_places' | 'serpapi';
  address?: string;
  operatingHours?: Record<string, string>;
}

interface ResolveCoordinatesOptions {
  allowPaidFallback?: boolean;
  maxDistanceKm?: number;
}

// In-memory resolution cache (avoids re-resolving the same item in a single generation)
const resolutionCache = new Map<string, ResolutionResult | null>();
let totalResolutionAttempts = 0;
let totalResolved = 0;
let resolutionsBySource: Record<string, number> = {
  cache: 0, travel_places: 0, nominatim: 0, gemini: 0, google_places: 0, serpapi: 0,
};

/**
 * Réinitialise le cache et les compteurs pour une nouvelle génération de trip
 */
export function resetResolutionStats(): void {
  resolutionCache.clear();
  totalResolutionAttempts = 0;
  totalResolved = 0;
  resolutionsBySource = { cache: 0, travel_places: 0, nominatim: 0, gemini: 0, google_places: 0, serpapi: 0 };
}

/**
 * Retourne les stats de résolution de la génération courante
 */
export function getResolutionStats(): { attempts: number; resolved: number; bySource: Record<string, number> } {
  return {
    attempts: totalResolutionAttempts,
    resolved: totalResolved,
    bySource: { ...resolutionsBySource },
  };
}

/**
 * Résout les coordonnées GPS d'un lieu via chaîne exhaustive de 5 APIs
 *
 * @param name - Nom du lieu (ex: "Colosseum", "Trattoria Da Enzo")
 * @param city - Ville de destination (ex: "Rome", "Paris")
 * @param nearbyCoords - Centre-ville ou position de référence pour la recherche
 * @param itemType - Type d'item pour optimiser la recherche
 * @returns Coordonnées vérifiées ou null si introuvable
 */
export async function resolveCoordinates(
  name: string,
  city: string,
  nearbyCoords: { lat: number; lng: number },
  itemType: 'attraction' | 'restaurant' | 'hotel' | string = 'attraction',
  options?: ResolveCoordinatesOptions
): Promise<ResolutionResult | null> {
  if (!name || !city) return null;

  const allowPaidFallback = options?.allowPaidFallback !== false;
  const maxDistanceKm = inferResolutionMaxDistanceKm(city, itemType, options?.maxDistanceKm);
  totalResolutionAttempts++;
  const cacheKey = `${name.toLowerCase().trim()}|${city.toLowerCase().trim()}|paid:${allowPaidFallback ? '1' : '0'}`;

  // Check in-memory cache first
  if (resolutionCache.has(cacheKey)) {
    const cached = resolutionCache.get(cacheKey);
    if (cached) {
      resolutionsBySource.cache++;
      totalResolved++;
    }
    return cached || null;
  }

  // Step 1: Travel Places API (gratuit via RapidAPI)
  try {
    const travelResult = await resolveAttractionByName(name, nearbyCoords);
    if (travelResult && travelResult.lat && travelResult.lng) {
      if (isResultNearDestination(travelResult, nearbyCoords, name, 'Travel Places', maxDistanceKm)) {
        const result: ResolutionResult = {
          lat: travelResult.lat,
          lng: travelResult.lng,
          source: 'travel_places',
        };
        resolutionCache.set(cacheKey, result);
        resolutionsBySource.travel_places++;
        totalResolved++;
        return result;
      }
      // Result too far from destination, try next API
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Travel Places échoué pour "${name}":`, e);
  }

  // Step 2: Nominatim/OSM (gratuit, 500ms throttle)
  try {
    const geoQuery = `${name}, ${city}`;
    const geo = await geocodeAddress(geoQuery);
    if (geo && geo.lat && geo.lng) {
      if (isResultNearDestination(geo, nearbyCoords, name, 'Nominatim', maxDistanceKm)) {
        const result: ResolutionResult = {
          lat: geo.lat,
          lng: geo.lng,
          source: 'nominatim',
          address: geo.displayName,
        };
        resolutionCache.set(cacheKey, result);
        resolutionsBySource.nominatim++;
        totalResolved++;
        return result;
      }
      // Result too far from destination, try next API
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Nominatim échoué pour "${name}":`, e);
  }

  // Step 3: Gemini 2.5 Flash + Google Search grounding (gratuit)
  try {
    const geminiResult = await geocodeWithGemini(name, city);
    if (geminiResult && geminiResult.lat && geminiResult.lng) {
      if (isResultNearDestination(geminiResult, nearbyCoords, name, 'Gemini', maxDistanceKm)) {
        const result: ResolutionResult = {
          lat: geminiResult.lat,
          lng: geminiResult.lng,
          source: 'gemini',
          address: geminiResult.address,
        };
        resolutionCache.set(cacheKey, result);
        resolutionsBySource.gemini++;
        totalResolved++;
        return result;
      }
      // Result too far from destination, try next API
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Gemini échoué pour "${name}":`, e);
  }

  // Step 4: Google Places (New) → SerpAPI fallback (geocodeWithFallback tries Google first, then SerpAPI)
  if (allowPaidFallback) {
    try {
      const placesResult = await geocodeWithFallback(name, city, nearbyCoords);
      if (placesResult && placesResult.lat && placesResult.lng) {
        if (isResultNearDestination(placesResult, nearbyCoords, name, 'Google Places/SerpAPI', maxDistanceKm)) {
          const result: ResolutionResult = {
            lat: placesResult.lat,
            lng: placesResult.lng,
            source: 'google_places', // Could be Google Places or SerpAPI internally
            address: placesResult.address,
            operatingHours: placesResult.operatingHours,
          };
          resolutionCache.set(cacheKey, result);
          resolutionsBySource.google_places++;
          totalResolved++;
          return result;
        }
        // Result too far from destination, try next API
      }
    } catch (e) {
      console.warn(`[CoordsResolver] Google Places/SerpAPI échoué pour "${name}":`, e);
    }
  }

  // Toutes les APIs ont échoué
  console.error(`[CoordsResolver] ❌ ÉCHEC TOTAL: "${name}" à ${city} — aucune API n'a pu résoudre`);
  resolutionCache.set(cacheKey, null);
  return null;
}

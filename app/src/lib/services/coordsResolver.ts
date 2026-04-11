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
import {
  getEnvelopeAdaptiveRadiusKm,
  isPointWithinDestinationEnvelope,
  type DestinationEnvelope,
} from './destinationEnvelope';

// Distance maximale acceptée entre le résultat API et le centre de destination.
// NOTE:
// - Attractions in regional / road-trip contexts legitimately span wider areas.
// - Restaurants/hotels remain stricter to avoid cross-city pollution.
const DEFAULT_ATTRACTION_MAX_DISTANCE_KM = 60;
const DEFAULT_LOCAL_MAX_DISTANCE_KM = 25;
const BROAD_DESTINATION_MAX_DISTANCE_KM = 220;

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

  // Heuristic only (no hardcoded destination names):
  // multi-token place labels are often region-level queries
  // ("cote de granit rose", "south of france", etc.).
  const tokens = normalized.split(/[\s,-]+/).filter(Boolean);
  return tokens.length >= 4;
}

function inferResolutionMaxDistanceKm(
  city: string,
  itemType: string,
  explicitMaxDistanceKm?: number,
  destinationRadiusKm?: number,
): number {
  if (Number.isFinite(explicitMaxDistanceKm)) {
    return Math.max(5, Math.min(300, explicitMaxDistanceKm as number));
  }

  // Dynamic: use destination bounding box radius when available
  // This replaces the hardcoded region hints — works for ANY destination worldwide
  if (Number.isFinite(destinationRadiusKm) && destinationRadiusKm! > 0) {
    const normalizedType = (itemType || '').toLowerCase();
    if (normalizedType === 'restaurant' || normalizedType === 'hotel') {
      // Restaurants/hotels: tighter, but scale with destination size
      return Math.max(DEFAULT_LOCAL_MAX_DISTANCE_KM, Math.min(80, destinationRadiusKm! * 0.6));
    }
    // Attractions: generous, up to the full destination radius + margin
    return Math.max(DEFAULT_ATTRACTION_MAX_DISTANCE_KM, Math.min(300, destinationRadiusKm! * 1.3));
  }

  // Fallback: hardcoded hints for when bounding box is not available
  if (isLikelyBroadDestination(city)) {
    return BROAD_DESTINATION_MAX_DISTANCE_KM;
  }

  const normalizedType = (itemType || '').toLowerCase();
  if (normalizedType === 'restaurant' || normalizedType === 'hotel') {
    return DEFAULT_LOCAL_MAX_DISTANCE_KM;
  }

  return DEFAULT_ATTRACTION_MAX_DISTANCE_KM;
}

function simplifySearchName(name: string): string {
  return name
    .replace(/["'`]/g, '')
    .replace(/\b(le|la|les|de|du|des|d')\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildGeocodeQueries(name: string, city: string): string[] {
  const simplified = simplifySearchName(name);
  const candidates = [
    `${name}, ${city}`,
    `${simplified}, ${city}`,
    `${name} ${city}`,
    `${simplified} ${city}`,
  ]
    .map((query) => query.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const query of candidates) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(query);
  }
  return deduped;
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
  maxDistanceKm: number,
  destinationEnvelope?: DestinationEnvelope
): boolean {
  if (destinationEnvelope) {
    const inside = isPointWithinDestinationEnvelope(
      { lat: result.lat, lng: result.lng },
      destinationEnvelope,
      { extraBufferKm: Math.min(15, Math.max(4, maxDistanceKm * 0.2)) }
    );
    if (!inside) {
      console.warn(`[CoordsResolver] ❌ ${source} rejeté pour "${name}": hors enveloppe destination`);
      return false;
    }
  }

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
  /** Radius of the destination area in km (from bounding box). Overrides hardcoded hints. */
  destinationRadiusKm?: number;
  /** Envelope used for strict in-destination filtering. */
  destinationEnvelope?: DestinationEnvelope;
}

// In-memory resolution cache (avoids re-resolving the same item in a single generation)
const resolutionCache = new Map<string, ResolutionResult | null>();
let totalResolutionAttempts = 0;
let totalResolved = 0;
let resolutionsBySource: Record<string, number> = {
  cache: 0, travel_places: 0, nominatim: 0, gemini: 0, google_places: 0, serpapi: 0,
};
let outsideEnvelopeRejects = 0;

/**
 * Réinitialise le cache et les compteurs pour une nouvelle génération de trip
 */
export function resetResolutionStats(): void {
  resolutionCache.clear();
  totalResolutionAttempts = 0;
  totalResolved = 0;
  resolutionsBySource = { cache: 0, travel_places: 0, nominatim: 0, gemini: 0, google_places: 0, serpapi: 0 };
  outsideEnvelopeRejects = 0;
}

/**
 * Retourne les stats de résolution de la génération courante
 */
export function getResolutionStats(): { attempts: number; resolved: number; bySource: Record<string, number>; outsideEnvelopeRejects: number } {
  return {
    attempts: totalResolutionAttempts,
    resolved: totalResolved,
    bySource: { ...resolutionsBySource },
    outsideEnvelopeRejects,
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
  const scopeRadiusKm = options?.destinationEnvelope
    ? getEnvelopeAdaptiveRadiusKm(options.destinationEnvelope)
    : options?.destinationRadiusKm;
  const maxDistanceKm = inferResolutionMaxDistanceKm(city, itemType, options?.maxDistanceKm, scopeRadiusKm);
  totalResolutionAttempts++;
  const cacheKey = `${name.toLowerCase().trim()}|${city.toLowerCase().trim()}|paid:${allowPaidFallback ? '1' : '0'}|scope:${Math.round(scopeRadiusKm || 0)}|env:${options?.destinationEnvelope ? '1' : '0'}`;

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
      if (isResultNearDestination(travelResult, nearbyCoords, name, 'Travel Places', maxDistanceKm, options?.destinationEnvelope)) {
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

  // Step 2: Nominatim/OSM (gratuit, 500ms throttle) with query variants
  try {
    const boundedKm = Math.max(30, Math.min(260, maxDistanceKm + 20));
    for (const geoQuery of buildGeocodeQueries(name, city)) {
      const geo = await geocodeAddress(geoQuery, {
        nearbyCoords,
        limit: 6,
        boundedKm,
      });
      if (!geo || !geo.lat || !geo.lng) continue;
      if (isResultNearDestination(geo, nearbyCoords, name, 'Nominatim', maxDistanceKm, options?.destinationEnvelope)) {
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
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Nominatim échoué pour "${name}":`, e);
  }

  // Step 3: Gemini 2.5 Flash + Google Search grounding (gratuit)
  try {
    const geminiResult = await geocodeWithGemini(name, city);
    if (geminiResult && geminiResult.lat && geminiResult.lng) {
      if (isResultNearDestination(geminiResult, nearbyCoords, name, 'Gemini', maxDistanceKm, options?.destinationEnvelope)) {
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
        if (isResultNearDestination(placesResult, nearbyCoords, name, 'Google Places/SerpAPI', maxDistanceKm, options?.destinationEnvelope)) {
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
  if (options?.destinationEnvelope) {
    outsideEnvelopeRejects += 1;
  }
  console.error(`[CoordsResolver] ❌ ÉCHEC TOTAL: "${name}" à ${city} — aucune API n'a pu résoudre`);
  resolutionCache.set(cacheKey, null);
  return null;
}

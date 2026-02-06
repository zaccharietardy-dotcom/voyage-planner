/**
 * Service centralisé de résolution GPS — 100% précision
 *
 * Chaîne exhaustive de résolution (du moins cher au plus cher) :
 * 1. Pool SerpAPI existant (cache gratuit)
 * 2. Travel Places API (gratuit, RapidAPI)
 * 3. Nominatim/OSM (gratuit, 500ms throttle)
 * 4. Gemini 2.5 Flash + Google Search (gratuit)
 * 5. SerpAPI Google Maps (payant, ~$0.01/call)
 *
 * Si les 5 échouent → retourne null → l'item sera remplacé ou supprimé
 * JAMAIS de coordonnées inventées.
 */

import { resolveAttractionByName } from './overpassAttractions';
import { geocodeAddress } from './geocoding';
import { geocodeWithGemini } from './geminiSearch';
import { geocodeViaSerpApi } from './serpApiPlaces';

export interface ResolutionResult {
  lat: number;
  lng: number;
  source: 'cache' | 'travel_places' | 'nominatim' | 'gemini' | 'serpapi';
  address?: string;
}

// In-memory resolution cache (avoids re-resolving the same item in a single generation)
const resolutionCache = new Map<string, ResolutionResult | null>();
let totalResolutionAttempts = 0;
let totalResolved = 0;
let resolutionsBySource: Record<string, number> = {
  cache: 0, travel_places: 0, nominatim: 0, gemini: 0, serpapi: 0,
};

/**
 * Réinitialise le cache et les compteurs pour une nouvelle génération de trip
 */
export function resetResolutionStats(): void {
  resolutionCache.clear();
  totalResolutionAttempts = 0;
  totalResolved = 0;
  resolutionsBySource = { cache: 0, travel_places: 0, nominatim: 0, gemini: 0, serpapi: 0 };
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
  itemType: 'attraction' | 'restaurant' | 'hotel' | string = 'attraction'
): Promise<ResolutionResult | null> {
  if (!name || !city) return null;

  totalResolutionAttempts++;
  const cacheKey = `${name.toLowerCase().trim()}|${city.toLowerCase().trim()}`;

  // Check in-memory cache first
  if (resolutionCache.has(cacheKey)) {
    const cached = resolutionCache.get(cacheKey);
    if (cached) {
      resolutionsBySource.cache++;
      totalResolved++;
      console.log(`[CoordsResolver] ✅ Cache hit: "${name}" → (${cached.lat.toFixed(4)}, ${cached.lng.toFixed(4)})`);
    }
    return cached || null;
  }

  console.log(`[CoordsResolver] Résolution de "${name}" à ${city} (type: ${itemType})...`);

  // Step 1: Travel Places API (gratuit via RapidAPI)
  try {
    const travelResult = await resolveAttractionByName(name, nearbyCoords);
    if (travelResult && travelResult.lat && travelResult.lng) {
      const result: ResolutionResult = {
        lat: travelResult.lat,
        lng: travelResult.lng,
        source: 'travel_places',
      };
      resolutionCache.set(cacheKey, result);
      resolutionsBySource.travel_places++;
      totalResolved++;
      console.log(`[CoordsResolver] ✅ Travel Places: "${name}" → (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)})`);
      return result;
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Travel Places échoué pour "${name}":`, e);
  }

  // Step 2: Nominatim/OSM (gratuit, 500ms throttle)
  try {
    const geoQuery = `${name}, ${city}`;
    const geo = await geocodeAddress(geoQuery);
    if (geo && geo.lat && geo.lng) {
      const result: ResolutionResult = {
        lat: geo.lat,
        lng: geo.lng,
        source: 'nominatim',
        address: geo.displayName,
      };
      resolutionCache.set(cacheKey, result);
      resolutionsBySource.nominatim++;
      totalResolved++;
      console.log(`[CoordsResolver] ✅ Nominatim: "${name}" → (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)})`);
      return result;
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Nominatim échoué pour "${name}":`, e);
  }

  // Step 3: Gemini 2.5 Flash + Google Search grounding (gratuit)
  try {
    const geminiResult = await geocodeWithGemini(name, city);
    if (geminiResult && geminiResult.lat && geminiResult.lng) {
      const result: ResolutionResult = {
        lat: geminiResult.lat,
        lng: geminiResult.lng,
        source: 'gemini',
        address: geminiResult.address,
      };
      resolutionCache.set(cacheKey, result);
      resolutionsBySource.gemini++;
      totalResolved++;
      console.log(`[CoordsResolver] ✅ Gemini: "${name}" → (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)})`);
      return result;
    }
  } catch (e) {
    console.warn(`[CoordsResolver] Gemini échoué pour "${name}":`, e);
  }

  // Step 4: SerpAPI Google Maps (payant, dernier recours)
  try {
    const serpResult = await geocodeViaSerpApi(name, city, nearbyCoords);
    if (serpResult && serpResult.lat && serpResult.lng) {
      const result: ResolutionResult = {
        lat: serpResult.lat,
        lng: serpResult.lng,
        source: 'serpapi',
        address: serpResult.address,
      };
      resolutionCache.set(cacheKey, result);
      resolutionsBySource.serpapi++;
      totalResolved++;
      console.log(`[CoordsResolver] ✅ SerpAPI: "${name}" → (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)})`);
      return result;
    }
  } catch (e) {
    console.warn(`[CoordsResolver] SerpAPI échoué pour "${name}":`, e);
  }

  // Toutes les APIs ont échoué
  console.error(`[CoordsResolver] ❌ ÉCHEC TOTAL: "${name}" à ${city} — aucune API n'a pu résoudre`);
  resolutionCache.set(cacheKey, null);
  return null;
}

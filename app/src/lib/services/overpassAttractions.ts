/**
 * Service de recherche d'attractions via Overpass API (OpenStreetMap) + Wikidata
 *
 * GRATUIT et ILLIMITÉ:
 * - Overpass: découverte de POI touristiques avec coordonnées GPS
 * - Wikidata: enrichissement (descriptions, images, popularité)
 *
 * Pipeline: Overpass (découverte) → filtre wikidata → Wikidata batch (enrichissement) → tri popularité → Attraction[]
 */

import * as fs from 'fs';
import * as path from 'path';
import { ActivityType } from '../types';
import { Attraction } from './attractions';

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const CACHE_BASE = process.env.VERCEL ? '/tmp' : process.cwd();
const CACHE_DIR = path.join(CACHE_BASE, '.cache', 'overpass-attractions');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// Types OSM à exclure (pollution des résultats identifiée lors des tests)
const EXCLUDED_OSM_TYPES = new Set([
  'tomb', 'battlefield', 'wayside_shrine', 'boundary_stone',
  'information', 'yes', 'hotel', 'guest_house', 'hostel', 'motel',
  'apartment', 'camp_site',
]);

// Noms à exclure (animaux de zoo, personnes, lieux mineurs polluants)
const EXCLUDED_NAME_PATTERNS = [
  // Animaux (zoo de Prague, etc.)
  /^(ailurus|tapir|daim|gorilla|panthera|cervus|ursus|vulpes|canis|felis|equus|bison|lynx)/i,
  // Tourist traps
  /madame tussauds/i, /hard rock caf/i, /planet hollywood/i,
  /rainforest caf/i, /ripley.*believe/i, /wax museum/i,
  /selfie museum/i, /trick eye/i,
  // Lieux mineurs qui polluent les résultats
  /temple de paris/i,
  /arc de triomphe du carrousel/i,
  /\bobelisk\b/i, /\bobélisque\b/i,
  /\bwar memorial\b/i, /\bmémorial de guerre\b/i,
  /\bcenotaph\b/i,
  /\bcemetery\b/i, /\bcimetière\b/i,
  /\bossuary\b/i, /\bossuaire\b/i,
];

// Mapping OSM tourism/historic types → ActivityType
function mapOsmTypeToActivityType(osmTags: Record<string, string>): ActivityType {
  const tourism = osmTags.tourism || '';
  const historic = osmTags.historic || '';
  const leisure = osmTags.leisure || '';
  const building = osmTags.building || '';

  if (tourism === 'museum' || tourism === 'gallery') return 'culture';
  if (tourism === 'viewpoint') return 'nature';
  if (tourism === 'attraction') {
    if (building === 'cathedral' || building === 'church' || building === 'basilica') return 'culture';
    return 'culture';
  }
  if (historic) return 'culture';
  if (leisure === 'park' || leisure === 'garden') return 'nature';
  if (building === 'cathedral' || building === 'church' || building === 'basilica') return 'culture';
  return 'culture';
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

interface WikidataEntity {
  name: string;
  nameFr: string;
  nameEn: string;
  description: string;
  descriptionFr: string;
  popularity: number; // sitelinks count
  imageFilename?: string;
  officialWebsite?: string;
  latitude?: number;
  longitude?: number;
}

// ============================================
// Cache
// ============================================

function getCacheKey(lat: number, lng: number): string {
  return `overpass-${lat.toFixed(2)}-${lng.toFixed(2)}`;
}

function readCache(key: string): Attraction[] | null {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, attractions: Attraction[]): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(attractions, null, 2));
  } catch (e) {
    console.warn('[Overpass] Cache write error:', e);
  }
}

// ============================================
// Overpass API
// ============================================

async function queryOverpass(lat: number, lng: number, radiusKm: number = 10): Promise<OverpassElement[]> {
  const half = radiusKm * 0.009; // rough degrees conversion
  const bbox = `${lat - half},${lng - half},${lat + half},${lng + half}`;

  const query = `[out:json][timeout:30];
(
  node["tourism"]["wikidata"]["name"](${bbox});
  way["tourism"]["wikidata"]["name"](${bbox});
  node["historic"]["wikidata"]["name"](${bbox});
  way["historic"]["wikidata"]["name"](${bbox});
  node["leisure"="park"]["wikidata"]["name"](${bbox});
  way["leisure"="park"]["wikidata"]["name"](${bbox});
  node["leisure"="garden"]["wikidata"]["name"](${bbox});
  way["leisure"="garden"]["wikidata"]["name"](${bbox});
  way["bridge"="yes"]["wikidata"]["name"](${bbox});
  node["amenity"="theatre"]["wikidata"]["name"](${bbox});
  way["amenity"="theatre"]["wikidata"]["name"](${bbox});
  node["amenity"="marketplace"]["wikidata"]["name"](${bbox});
  way["amenity"="marketplace"]["wikidata"]["name"](${bbox});
);
out center body;`;

  const body = new URLSearchParams({ data: query });

  const response = await fetch(OVERPASS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.elements || [];
}

// ============================================
// Wikidata API
// ============================================

async function enrichWithWikidata(qids: string[]): Promise<Map<string, WikidataEntity>> {
  const result = new Map<string, WikidataEntity>();
  if (qids.length === 0) return result;

  // Batch par 50 (limite Wikidata)
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const ids = batch.join('|');

    try {
      const url = `${WIKIDATA_API_URL}?action=wbgetentities&ids=${encodeURIComponent(ids)}&format=json&languages=en|fr&props=labels|descriptions|sitelinks|claims`;

      const response = await fetch(url, {
        headers: { 'User-Agent': 'VoyageApp/1.0 (travel planner)' },
      });

      if (!response.ok) continue;

      const data = await response.json();

      for (const [qid, entity] of Object.entries(data.entities || {})) {
        const e = entity as any;
        const nameEn = e.labels?.en?.value || '';
        const nameFr = e.labels?.fr?.value || '';
        const descEn = e.descriptions?.en?.value || '';
        const descFr = e.descriptions?.fr?.value || '';
        const sitelinks = Object.keys(e.sitelinks || {}).length;

        // Extract coords from P625 (coordinate location)
        const coordClaim = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
        const latitude = coordClaim?.latitude;
        const longitude = coordClaim?.longitude;

        // Extract image from P18
        const imageClaim = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;

        // Extract official website from P856
        const websiteClaim = e.claims?.P856?.[0]?.mainsnak?.datavalue?.value;

        result.set(qid, {
          name: nameFr || nameEn,
          nameFr,
          nameEn,
          description: descFr || descEn,
          descriptionFr: descFr,
          popularity: sitelinks,
          imageFilename: imageClaim,
          officialWebsite: websiteClaim,
          latitude,
          longitude,
        });
      }
    } catch (e) {
      console.warn(`[Wikidata] Batch error (offset ${i}):`, e);
    }

    // Small delay between batches to be polite
    if (i + 50 < qids.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return result;
}

function getWikimediaImageUrl(filename: string): string {
  // Convert Wikidata filename to Wikimedia Commons URL
  const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
  const md5 = require('crypto').createHash('md5').update(filename.replace(/ /g, '_')).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5[0]}${md5[1]}/${encoded}/400px-${encoded}`;
}

// ============================================
// Filtrage
// ============================================

function shouldExclude(name: string, tags: Record<string, string>): boolean {
  const tourism = tags.tourism || '';
  const historic = tags.historic || '';
  const leisure = tags.leisure || '';

  // Exclude by OSM type
  if (EXCLUDED_OSM_TYPES.has(tourism) || EXCLUDED_OSM_TYPES.has(historic)) return true;

  // Exclude memorials of specific persons (they have "memorial" type and usually a person's name)
  if (historic === 'memorial' || historic === 'artwork') {
    // Keep if it's a well-known memorial site (9/11, war memorials with specific names)
    const keepPatterns = /memorial.*museum|monument|9\/11|holocaust|war memorial|mémorial/i;
    if (!keepPatterns.test(name) && !tags.tourism) return true;
  }

  // Exclude by name patterns
  for (const pattern of EXCLUDED_NAME_PATTERNS) {
    if (pattern.test(name)) return true;
  }

  return false;
}

// ============================================
// Main function
// ============================================

/**
 * Recherche les attractions touristiques via Overpass (OSM) + Wikidata
 * Gratuit et illimité. Retourne les attractions triées par popularité mondiale.
 */
export async function searchAttractionsOverpass(
  destination: string,
  cityCenter: { lat: number; lng: number },
  options: {
    limit?: number;
    minPopularity?: number; // Minimum sitelinks count
  } = {}
): Promise<Attraction[]> {
  const { limit = 50, minPopularity = 40 } = options;

  // Check cache
  const cacheKey = getCacheKey(cityCenter.lat, cityCenter.lng);
  const cached = readCache(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  // 1. Query Overpass
  let elements: OverpassElement[];
  try {
    elements = await queryOverpass(cityCenter.lat, cityCenter.lng);
  } catch (error) {
    console.error('[Overpass] Query error:', error);
    return [];
  }

  // 2. Deduplicate by wikidata QID and extract info
  const seen = new Set<string>();
  const pois: Array<{
    name: string;
    qid: string;
    lat: number;
    lng: number;
    tags: Record<string, string>;
  }> = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const qid = tags.wikidata || '';
    const name = tags.name || tags['name:en'] || '';

    if (!qid || !name || seen.has(qid)) continue;
    if (shouldExclude(name, tags)) continue;

    seen.add(qid);

    const lat = el.lat || el.center?.lat || 0;
    const lng = el.lon || el.center?.lon || 0;

    pois.push({ name, qid, lat, lng, tags });
  }

  // 3. Enrich ALL with Wikidata (batched)
  const allQids = pois.map(p => p.qid);
  const wikidataMap = await enrichWithWikidata(allQids);

  // 4. Build attractions with popularity score, sort, and filter
  const attractions: (Attraction & { popularity: number })[] = [];

  for (const poi of pois) {
    const wd = wikidataMap.get(poi.qid);
    const popularity = wd?.popularity || 0;

    // Filter low-popularity items
    if (popularity < minPopularity) continue;

    // Use Wikidata coords if OSM coords are missing
    const lat = poi.lat || wd?.latitude || 0;
    const lng = poi.lng || wd?.longitude || 0;
    if (!lat || !lng) continue;

    const name = wd?.name || poi.name;
    const description = wd?.description || `Découvrez ${name}`;

    // Generate image URL from Wikidata
    let imageUrl: string | undefined;
    if (wd?.imageFilename) {
      try {
        imageUrl = getWikimediaImageUrl(wd.imageFilename);
      } catch {
        // ignore image URL generation errors
      }
    }

    attractions.push({
      id: `osm-${poi.qid}`,
      name,
      type: mapOsmTypeToActivityType(poi.tags),
      description,
      duration: estimateDuration(poi.tags),
      estimatedCost: 0, // Will be estimated later by Claude or duration estimator
      latitude: lat,
      longitude: lng,
      rating: Math.min(5, 3 + (popularity / 50)), // Convert popularity to 3-5 rating
      mustSee: popularity >= 80, // Major landmarks (80+ Wikipedia pages)
      bookingRequired: false,
      bookingUrl: wd?.officialWebsite,
      openingHours: { open: '09:00', close: '18:00' },
      dataReliability: 'verified' as const,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
      imageUrl,
      providerName: 'OpenStreetMap + Wikidata',
      reviewCount: popularity, // Use sitelinks as proxy for "reviews"
      popularity,
    });
  }

  // Sort by popularity (most famous first)
  attractions.sort((a, b) => b.popularity - a.popularity);

  // Religious filter: only keep religious buildings with high popularity (>=80 sitelinks = Notre-Dame, Sacré-Cœur level)
  // Minor chapels, temples, churches are excluded
  const MIN_RELIGIOUS_POPULARITY = 80;
  const MAX_RELIGIOUS = 3;
  let religiousCount = 0;
  const diversified = attractions.filter(a => {
    const tags = pois.find(p => `osm-${p.qid}` === a.id)?.tags || {};
    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const isReligious = /church|cathedral|basilica|chapel|mosque|synagogue|temple/i.test(building)
      || /place_of_worship/i.test(amenity)
      || /\b(église|church|cathedral|cathédrale|basilique|basilica|chapel|chapelle|mosquée|mosque|synagogue|temple|sanctuaire|shrine)\b/i.test(a.name);
    if (isReligious) {
      if (a.popularity < MIN_RELIGIOUS_POPULARITY) {
        return false;
      }
      religiousCount++;
      if (religiousCount > MAX_RELIGIOUS) return false;
    }
    return true;
  });

  // Take top N
  const result: Attraction[] = diversified.slice(0, limit).map(({ popularity, ...attr }) => attr);

  // Cache
  writeCache(cacheKey, result);

  return result;
}

/**
 * Estimate visit duration based on OSM tags
 */
function estimateDuration(tags: Record<string, string>): number {
  const tourism = tags.tourism || '';
  const historic = tags.historic || '';
  const leisure = tags.leisure || '';
  const building = tags.building || '';

  if (tourism === 'museum') return 120;
  if (building === 'cathedral' || building === 'basilica') return 60;
  if (building === 'church') return 30;
  if (tourism === 'viewpoint') return 30;
  if (leisure === 'park') return 90;
  if (historic === 'castle') return 90;
  if (historic === 'monument') return 20;
  if (tourism === 'attraction') return 60;
  return 60;
}

/**
 * Vérifie si le service Overpass est disponible (toujours true, pas de clé API)
 */
export function isOverpassConfigured(): boolean {
  return true;
}

/**
 * Résout un nom d'attraction en coordonnées via Travel Places API (RapidAPI)
 */
export async function resolveAttractionByName(
  name: string,
  cityCenter: { lat: number; lng: number },
): Promise<{ lat: number; lng: number; name: string } | null> {
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY?.trim();
  if (!RAPIDAPI_KEY) return null;

  try {
    const query = JSON.stringify({
      query: `{ getPlaces(name: "${name.replace(/"/g, '\\"')}", lat: ${cityCenter.lat}, lng: ${cityCenter.lng}, maxDistMeters: 20000, limit: 1) { name lat lng } }`,
    });

    const response = await fetch('https://travel-places.p.rapidapi.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'travel-places.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
      body: query,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const places = data?.data?.getPlaces;
    if (places && places.length > 0) {
      return { lat: places[0].lat, lng: places[0].lng, name: places[0].name };
    }
  } catch (e) {
    console.warn(`[TravelPlaces] Error resolving "${name}":`, e);
  }
  return null;
}

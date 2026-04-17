import * as fs from 'fs';
import * as path from 'path';

import type { TripPreferences } from '../types';
import { textSearchPlaces } from '../services/googlePlacesNew';
import { geocodeAddress } from '../services/geocoding';
import type { Catalog, CatalogEntry, CityCatalog } from './catalog-types';
import { normalizeCitySlug } from './catalog-types';

type RawPlace = Awaited<ReturnType<typeof textSearchPlaces>>[number];

const CACHE_BASE = process.env.VERCEL ? '/tmp' : process.cwd();
const CACHE_DIR = path.join(CACHE_BASE, '.cache', 'catalog-v4');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — opening hours can change

const TOP_N = {
  attractions: 50,
  restaurants: 40,
  breakfast: 10,
  bars: 10,
} as const;

const MIN_VIABLE = {
  attractions: 15,
  restaurants: 10,
} as const;

function cacheKey(city: string, coords: { lat: number; lng: number }): string {
  return `${normalizeCitySlug(city)}-${coords.lat.toFixed(2)}-${coords.lng.toFixed(2)}`;
}

function cacheFilePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCache(key: string): CityCatalog | null {
  try {
    const filePath = cacheFilePath(key);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CityCatalog;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: CityCatalog): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFilePath(key), JSON.stringify(data));
  } catch (err) {
    console.warn('[V4 Catalog] Cache write failed:', err);
  }
}

const PRICE_LEVEL_MAP: Record<string, 0 | 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const CUISINE_TYPE_MAP: Record<string, string> = {
  french_restaurant: 'french',
  italian_restaurant: 'italian',
  japanese_restaurant: 'japanese',
  chinese_restaurant: 'chinese',
  thai_restaurant: 'thai',
  indian_restaurant: 'indian',
  mexican_restaurant: 'mexican',
  korean_restaurant: 'korean',
  vietnamese_restaurant: 'vietnamese',
  spanish_restaurant: 'spanish',
  greek_restaurant: 'greek',
  turkish_restaurant: 'turkish',
  lebanese_restaurant: 'lebanese',
  mediterranean_restaurant: 'mediterranean',
  seafood_restaurant: 'seafood',
  steak_house: 'steak',
  pizza_restaurant: 'pizza',
  sushi_restaurant: 'sushi',
  vegetarian_restaurant: 'vegetarian',
  vegan_restaurant: 'vegan',
};

function extractCuisines(types?: string[]): string[] {
  if (!types) return [];
  const out: string[] = [];
  for (const t of types) {
    if (CUISINE_TYPE_MAP[t]) out.push(CUISINE_TYPE_MAP[t]);
  }
  return Array.from(new Set(out));
}

function parseOpeningHours(
  regular: RawPlace['regularOpeningHours'],
): { simple?: { open: string; close: string }; byDay?: Record<string, { open: string; close: string } | null> } {
  if (!regular?.periods?.length) return {};
  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const byDay: Record<string, { open: string; close: string } | null> = {};
  for (const day of DAY_NAMES) byDay[day] = null;

  let earliestOpen = '23:59';
  let latestClose = '00:00';

  for (const period of regular.periods) {
    const dayName = DAY_NAMES[period.open.day];
    if (!dayName) continue;
    const open = `${String(period.open.hour).padStart(2, '0')}:${String(period.open.minute).padStart(2, '0')}`;
    const close = period.close
      ? `${String(period.close.hour).padStart(2, '0')}:${String(period.close.minute).padStart(2, '0')}`
      : '23:59';
    byDay[dayName] = { open, close };
    if (open < earliestOpen) earliestOpen = open;
    if (close > latestClose) latestClose = close;
  }

  return {
    simple: {
      open: earliestOpen === '23:59' ? '09:00' : earliestOpen,
      close: latestClose === '00:00' ? '18:00' : latestClose,
    },
    byDay,
  };
}

function deriveMealSuitable(
  category: 'restaurant' | 'bar' | 'breakfast',
  byDay?: Record<string, { open: string; close: string } | null>,
): Array<'breakfast' | 'lunch' | 'dinner'> {
  if (category === 'breakfast') return ['breakfast'];
  if (category === 'bar') return ['dinner'];
  if (!byDay) return ['lunch', 'dinner'];
  const meals = new Set<'breakfast' | 'lunch' | 'dinner'>();
  for (const hours of Object.values(byDay)) {
    if (!hours) continue;
    if (hours.open <= '10:00') meals.add('breakfast');
    if (hours.open <= '13:00' && hours.close >= '13:00') meals.add('lunch');
    if (hours.close >= '19:30' || hours.close < hours.open) meals.add('dinner');
  }
  return meals.size > 0 ? Array.from(meals) : ['lunch', 'dinner'];
}

function placeToCatalogEntry(
  place: RawPlace,
  aliasIndex: number,
  aliasPrefix: string,
  category: CatalogEntry['category'],
): CatalogEntry | null {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const name = place.displayName?.text;
  if (!lat || !lng || !name || !place.id) return null;

  const { simple, byDay } = parseOpeningHours(place.regularOpeningHours);
  const photos = (place.photos || [])
    .slice(0, 5)
    .map((p) => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800`);

  const cuisines = category === 'restaurant' || category === 'breakfast' || category === 'bar'
    ? extractCuisines(place.types)
    : undefined;

  const mealSuitable = category === 'restaurant' || category === 'bar' || category === 'breakfast'
    ? deriveMealSuitable(category, byDay)
    : undefined;

  return {
    alias: `${aliasPrefix}${aliasIndex + 1}`,
    placeId: place.id,
    name,
    coords: { lat, lng },
    address: place.shortFormattedAddress || place.formattedAddress,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel: place.priceLevel ? PRICE_LEVEL_MAP[place.priceLevel] : undefined,
    openingHours: simple,
    openingHoursByDay: byDay,
    photoUrl: photos[0],
    photos,
    website: place.websiteUri,
    googleMapsUrl: place.googleMapsUri,
    category,
    subtype: place.primaryType,
    cuisines,
    mealSuitable,
  };
}

function filterAndRank(
  places: RawPlace[],
  category: CatalogEntry['category'],
  topN: number,
  aliasPrefix: string,
): CatalogEntry[] {
  const minRating = category === 'attraction' ? 4.0 : 3.8;
  const minReviews = category === 'attraction' ? 50 : 30;
  const filtered = places.filter((p) => {
    if (!p.location || !p.displayName?.text || !p.id) return false;
    if ((p.rating ?? 0) < minRating) return false;
    if ((p.userRatingCount ?? 0) < minReviews) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const scoreA = (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 1);
    const scoreB = (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 1);
    return scoreB - scoreA;
  });
  const entries: CatalogEntry[] = [];
  for (const place of filtered.slice(0, topN * 2)) {
    const entry = placeToCatalogEntry(place, entries.length, aliasPrefix, category);
    if (entry) entries.push(entry);
    if (entries.length >= topN) break;
  }
  return entries;
}

async function fetchCityCatalog(
  city: string,
  coords: { lat: number; lng: number },
  onProgress?: (label: string) => void,
): Promise<CityCatalog> {
  onProgress?.(`Fetching catalog for ${city}...`);

  const radiusMeters = 15000;
  const [attractions, restaurants, breakfast, bars] = await Promise.all([
    textSearchPlaces(`top tourist attractions ${city}`, {
      locationBias: { lat: coords.lat, lng: coords.lng, radiusMeters },
      maxResultCount: 20,
    }).catch(() => [] as RawPlace[]),
    textSearchPlaces(`best restaurants ${city}`, {
      locationBias: { lat: coords.lat, lng: coords.lng, radiusMeters },
      maxResultCount: 20,
    }).catch(() => [] as RawPlace[]),
    textSearchPlaces(`café breakfast bakery ${city}`, {
      locationBias: { lat: coords.lat, lng: coords.lng, radiusMeters },
      maxResultCount: 15,
    }).catch(() => [] as RawPlace[]),
    textSearchPlaces(`cocktail bar ${city}`, {
      locationBias: { lat: coords.lat, lng: coords.lng, radiusMeters },
      maxResultCount: 15,
    }).catch(() => [] as RawPlace[]),
  ]);

  return {
    city,
    coords,
    fetchedAt: Date.now(),
    attractions: filterAndRank(attractions, 'attraction', TOP_N.attractions, 'a'),
    restaurants: filterAndRank(restaurants, 'restaurant', TOP_N.restaurants, 'r'),
    breakfast: filterAndRank(breakfast, 'breakfast', TOP_N.breakfast, 'b'),
    bars: filterAndRank(bars, 'bar', TOP_N.bars, 'br'),
  };
}

export interface BuildCatalogResult {
  catalog: Catalog;
  stats: {
    totalEntries: number;
    entriesByCity: Record<string, number>;
    cacheHits: string[];
    cacheMisses: string[];
  };
}

function listHubs(preferences: TripPreferences): string[] {
  if (Array.isArray(preferences.cityPlan) && preferences.cityPlan.length > 0) {
    return preferences.cityPlan.map((s) => s.city).filter(Boolean);
  }
  return preferences.destination ? [preferences.destination] : [];
}

export class CatalogTooSparseError extends Error {
  constructor(public readonly city: string, public readonly counts: { attractions: number; restaurants: number }) {
    super(
      `Catalog too sparse for ${city}: ${counts.attractions} attractions, ${counts.restaurants} restaurants. Falling back.`,
    );
    this.name = 'CatalogTooSparseError';
  }
}

export async function buildCatalog(
  preferences: TripPreferences,
  onProgress?: (label: string) => void,
): Promise<BuildCatalogResult> {
  const hubs = listHubs(preferences);
  if (hubs.length === 0) {
    return {
      catalog: {},
      stats: { totalEntries: 0, entriesByCity: {}, cacheHits: [], cacheMisses: [] },
    };
  }

  const cacheHits: string[] = [];
  const cacheMisses: string[] = [];

  const perCity = await Promise.all(
    hubs.map(async (city) => {
      const geo = await geocodeAddress(city);
      if (!geo?.lat || !geo?.lng) {
        console.warn(`[V4 Catalog] Geocode failed for "${city}" — skipping`);
        return null;
      }
      const coords = { lat: geo.lat, lng: geo.lng };
      const key = cacheKey(city, coords);

      const cached = readCache(key);
      if (cached) {
        cacheHits.push(city);
        onProgress?.(`Catalog cache hit: ${city}`);
        return { slug: normalizeCitySlug(city), catalog: cached };
      }

      cacheMisses.push(city);
      const city_catalog = await fetchCityCatalog(city, coords, onProgress);
      if (
        city_catalog.attractions.length < MIN_VIABLE.attractions ||
        city_catalog.restaurants.length < MIN_VIABLE.restaurants
      ) {
        throw new CatalogTooSparseError(city, {
          attractions: city_catalog.attractions.length,
          restaurants: city_catalog.restaurants.length,
        });
      }
      writeCache(key, city_catalog);
      onProgress?.(
        `Catalog built for ${city}: ${city_catalog.attractions.length} attractions, ${city_catalog.restaurants.length} restaurants`,
      );
      return { slug: normalizeCitySlug(city), catalog: city_catalog };
    }),
  );

  const catalog: Catalog = {};
  const entriesByCity: Record<string, number> = {};
  let totalEntries = 0;

  for (const entry of perCity) {
    if (!entry) continue;
    catalog[entry.slug] = entry.catalog;
    const count =
      entry.catalog.attractions.length +
      entry.catalog.restaurants.length +
      entry.catalog.breakfast.length +
      entry.catalog.bars.length;
    entriesByCity[entry.catalog.city] = count;
    totalEntries += count;
  }

  return {
    catalog,
    stats: { totalEntries, entriesByCity, cacheHits, cacheMisses },
  };
}

/**
 * Google Places API (New) — Direct REST client
 *
 * Replaces SerpAPI for restaurants + attractions searches.
 * Uses Google Places Text Search (New) and Nearby Search (New).
 *
 * Pricing (New API):
 *   - Text Search: $0.032 per request (first $200/month free)
 *   - Nearby Search: $0.032 per request (first $200/month free)
 *   - Place Details: $0.005 per request (Basic fields)
 *
 * With $200/month free credit: ~6,250 requests/month free.
 *
 * NOTE: SerpAPI is kept as fallback for:
 *   - google_flights (no Google API equivalent)
 *   - When Google Places API fails or key is missing
 */

import { Restaurant, DietaryType, ActivityType } from '../types';
import { Attraction } from './attractions';
import { calculateDistance } from './geocoding';
import { getDestinationSize, getCostMultiplier, getDestinationArchetypes } from './destinationData';
import { buildPlacePhotoProxyUrl } from './googlePlacePhoto';
import { getCachedResponse, setCachedResponse } from './supabaseCache';

// ============================================
// Configuration
// ============================================

function getGooglePlacesKey(): string {
  return (process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

export function isGooglePlacesNewConfigured(): boolean {
  return !!getGooglePlacesKey();
}

const GOOGLE_PLACES_NEW_BASE = 'https://places.googleapis.com/v1/places';
const DEFAULT_TIMEOUT_MS = 12000;

// ============================================
// Usage tracking
// ============================================

let googlePlacesRequestCount = 0;

export function getGooglePlacesRequestCount(): number {
  return googlePlacesRequestCount;
}

export function resetGooglePlacesRequestCount(): void {
  googlePlacesRequestCount = 0;
}

// ============================================
// Shared types for Google Places API (New)
// ============================================

interface GooglePlaceNewResult {
  id: string; // places/ChIJ... format
  displayName?: { text: string; languageCode: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string; // PRICE_LEVEL_FREE, PRICE_LEVEL_INEXPENSIVE, etc.
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  regularOpeningHours?: {
    openNow?: boolean;
    periods?: Array<{
      open: { day: number; hour: number; minute: number };
      close?: { day: number; hour: number; minute: number };
    }>;
    weekdayDescriptions?: string[];
  };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  photos?: Array<{
    name: string; // "places/{place_id}/photos/{photo_reference}"
    widthPx: number;
    heightPx: number;
    authorAttributions?: Array<{ displayName: string; uri: string }>;
  }>;
  editorialSummary?: { text: string; languageCode: string };
  businessStatus?: string;
  shortFormattedAddress?: string;
}

interface GooglePlacesNewTextSearchResponse {
  places?: GooglePlaceNewResult[];
  nextPageToken?: string;
}

// ============================================
// Core fetch helper
// ============================================

async function googlePlacesFetch<T>(
  endpoint: string,
  body: Record<string, unknown>,
  fieldMask: string,
): Promise<T | null> {
  const apiKey = getGooglePlacesKey();
  if (!apiKey) {
    console.warn('[Google Places New] No API key configured');
    return null;
  }

  googlePlacesRequestCount++;

  // Cost guard — determine call type from endpoint
  const { trackApiCost } = await import('./apiCostGuard');
  const costType = endpoint.includes('searchNearby') ? 'places-nearby-search' : 'places-text-search';
  trackApiCost(costType);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${GOOGLE_PLACES_NEW_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[Google Places New] HTTP ${response.status}: ${errorBody.substring(0, 300)}`);
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error(`[Google Places New] Timeout after ${DEFAULT_TIMEOUT_MS}ms`);
    } else {
      console.error('[Google Places New] Fetch error:', error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================
// Cache layer (in-memory, per-process)
// ============================================

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const textSearchCache = new Map<string, CacheEntry<GooglePlaceNewResult[]>>();
const nearbySearchCache = new Map<string, CacheEntry<GooglePlaceNewResult[]>>();

function getCacheKey(parts: string[]): string {
  return parts.map(p => (p || '').toLowerCase().trim()).join('|');
}

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  // Limit cache size
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
}

// ============================================
// Text Search (New) — for attractions
// ============================================

const TEXT_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.types',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.googleMapsUri',
  'places.photos',
  'places.editorialSummary',
  'places.businessStatus',
].join(',');

export async function textSearchPlaces(
  query: string,
  options: {
    locationBias?: { lat: number; lng: number; radiusMeters?: number };
    languageCode?: string;
    maxResultCount?: number;
    includedType?: string;
  } = {}
): Promise<GooglePlaceNewResult[]> {
  const {
    locationBias,
    languageCode = 'fr',
    maxResultCount = 20,
  } = options;

  const cacheKey = getCacheKey([
    query,
    locationBias ? `${locationBias.lat.toFixed(2)},${locationBias.lng.toFixed(2)}` : '',
    languageCode,
    String(maxResultCount),
    options.includedType || '',
  ]);

  const cached = getFromCache(textSearchCache, cacheKey);
  if (cached) return cached;

  // L2 Supabase cache
  const l2 = await getCachedResponse<GooglePlaceNewResult[]>('text-search', cacheKey);
  if (l2) {
    setInCache(textSearchCache, cacheKey, l2);
    return l2;
  }

  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode,
    maxResultCount,
  };

  if (locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: locationBias.lat, longitude: locationBias.lng },
        radius: locationBias.radiusMeters || 10000,
      },
    };
  }

  if (options.includedType) {
    body.includedType = options.includedType;
  }

  const result = await googlePlacesFetch<GooglePlacesNewTextSearchResponse>(
    ':searchText',
    body,
    TEXT_SEARCH_FIELD_MASK,
  );

  const places = result?.places || [];
  setInCache(textSearchCache, cacheKey, places);
  setCachedResponse('text-search', cacheKey, places, 30).catch(() => {});

  console.log(`[Google Places New] Text search "${query}": ${places.length} results`);
  return places;
}

// ============================================
// Nearby Search (New) — for restaurants near activities
// ============================================

const NEARBY_SEARCH_FIELD_MASK = TEXT_SEARCH_FIELD_MASK;

export async function nearbySearchPlaces(
  center: { lat: number; lng: number },
  options: {
    radiusMeters?: number;
    includedTypes?: string[];
    excludedTypes?: string[];
    languageCode?: string;
    maxResultCount?: number;
  } = {}
): Promise<GooglePlaceNewResult[]> {
  const {
    radiusMeters = 500,
    includedTypes,
    excludedTypes,
    languageCode = 'fr',
    maxResultCount = 20,
  } = options;

  const cacheKey = getCacheKey([
    `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`,
    String(radiusMeters),
    (includedTypes || []).join(','),
    (excludedTypes || []).join(','),
    languageCode,
  ]);

  const cached = getFromCache(nearbySearchCache, cacheKey);
  if (cached) return cached;

  // L2 Supabase cache
  const l2 = await getCachedResponse<GooglePlaceNewResult[]>('nearby-search', cacheKey);
  if (l2) {
    setInCache(nearbySearchCache, cacheKey, l2);
    return l2;
  }

  const body: Record<string, unknown> = {
    locationRestriction: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: radiusMeters,
      },
    },
    languageCode,
    maxResultCount,
  };

  if (includedTypes && includedTypes.length > 0) {
    body.includedTypes = includedTypes;
  }
  if (excludedTypes && excludedTypes.length > 0) {
    body.excludedTypes = excludedTypes;
  }

  const result = await googlePlacesFetch<GooglePlacesNewTextSearchResponse>(
    ':searchNearby',
    body,
    NEARBY_SEARCH_FIELD_MASK,
  );

  const places = result?.places || [];
  setInCache(nearbySearchCache, cacheKey, places);
  setCachedResponse('nearby-search', cacheKey, places, 30).catch(() => {});

  console.log(`[Google Places New] Nearby search @${center.lat.toFixed(3)},${center.lng.toFixed(3)}: ${places.length} results`);
  return places;
}

// ============================================
// Converters: Google Places (New) → app types
// ============================================

function parsePriceLevelNew(priceLevel?: string): 1 | 2 | 3 | 4 {
  switch (priceLevel) {
    case 'PRICE_LEVEL_FREE':
    case 'PRICE_LEVEL_INEXPENSIVE': return 1;
    case 'PRICE_LEVEL_MODERATE': return 2;
    case 'PRICE_LEVEL_EXPENSIVE': return 3;
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4;
    default: return 2;
  }
}

function extractPhotoUrl(place: GooglePlaceNewResult): string | undefined {
  if (!place.photos || place.photos.length === 0) return undefined;
  // The photo name has format: "places/{place_id}/photos/{photo_reference}"
  // Extract photo_reference for our proxy
  const photoName = place.photos[0].name;
  const photoRefMatch = photoName.match(/photos\/(.+)$/);
  if (photoRefMatch) {
    return buildPlacePhotoProxyUrl(photoRefMatch[1], 400);
  }
  return undefined;
}

function extractGooglePlaceId(place: GooglePlaceNewResult): string | undefined {
  // place.id is like "places/ChIJ123..." — extract the ChIJ... part
  if (!place.id) return undefined;
  return place.id.replace(/^places\//, '');
}

function parseOpeningHoursNew(
  regularOpeningHours?: GooglePlaceNewResult['regularOpeningHours']
): Record<string, { open: string; close: string } | null> | undefined {
  if (!regularOpeningHours?.periods) return undefined;

  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const result: Record<string, { open: string; close: string } | null> = {};

  // Initialize all days as null
  for (const day of DAY_NAMES) {
    result[day] = null;
  }

  for (const period of regularOpeningHours.periods) {
    const dayName = DAY_NAMES[period.open.day];
    if (!dayName) continue;

    const openTime = `${String(period.open.hour).padStart(2, '0')}:${String(period.open.minute).padStart(2, '0')}`;
    const closeTime = period.close
      ? `${String(period.close.hour).padStart(2, '0')}:${String(period.close.minute).padStart(2, '0')}`
      : '23:59';

    result[dayName] = { open: openTime, close: closeTime };
  }

  return Object.values(result).some(v => v !== null) ? result : undefined;
}

function getSimpleOpeningHours(
  regularOpeningHours?: GooglePlaceNewResult['regularOpeningHours']
): { open: string; close: string } {
  if (!regularOpeningHours?.periods || regularOpeningHours.periods.length === 0) {
    return { open: '09:00', close: '18:00' };
  }

  // Find earliest open and latest close
  let earliestOpen = '23:59';
  let latestClose = '00:00';

  for (const period of regularOpeningHours.periods) {
    const openTime = `${String(period.open.hour).padStart(2, '0')}:${String(period.open.minute).padStart(2, '0')}`;
    if (openTime < earliestOpen) earliestOpen = openTime;

    if (period.close) {
      const closeTime = `${String(period.close.hour).padStart(2, '0')}:${String(period.close.minute).padStart(2, '0')}`;
      if (closeTime > latestClose) latestClose = closeTime;
    }
  }

  return {
    open: earliestOpen === '23:59' ? '09:00' : earliestOpen,
    close: latestClose === '00:00' ? '18:00' : latestClose,
  };
}

function extractCuisineTypes(place: GooglePlaceNewResult): string[] {
  const types = place.types || [];
  const cuisines: string[] = [];

  // Map Google Places types to cuisine types
  const typeMap: Record<string, string> = {
    'french_restaurant': 'french',
    'italian_restaurant': 'italian',
    'japanese_restaurant': 'japanese',
    'chinese_restaurant': 'chinese',
    'thai_restaurant': 'thai',
    'indian_restaurant': 'indian',
    'mexican_restaurant': 'mexican',
    'korean_restaurant': 'korean',
    'vietnamese_restaurant': 'vietnamese',
    'spanish_restaurant': 'spanish',
    'greek_restaurant': 'greek',
    'turkish_restaurant': 'turkish',
    'lebanese_restaurant': 'lebanese',
    'mediterranean_restaurant': 'mediterranean',
    'seafood_restaurant': 'seafood',
    'steak_house': 'steak',
    'pizza_restaurant': 'pizza',
    'sushi_restaurant': 'sushi',
    'vegetarian_restaurant': 'vegetarian',
    'vegan_restaurant': 'vegan',
    'brunch_restaurant': 'brunch',
    'breakfast_restaurant': 'breakfast',
    'cafe': 'café',
    'bakery': 'bakery',
    'bar': 'bar',
  };

  for (const t of types) {
    if (typeMap[t]) cuisines.push(typeMap[t]);
  }

  // Use primaryTypeDisplayName as fallback
  if (cuisines.length === 0 && place.primaryTypeDisplayName?.text) {
    cuisines.push(place.primaryTypeDisplayName.text.toLowerCase());
  }

  return cuisines.length > 0 ? cuisines : ['local'];
}

/**
 * Convert a Google Places (New) result to our Restaurant type
 */
export function googlePlaceNewToRestaurant(
  place: GooglePlaceNewResult,
  destination: string,
  activityCoords?: { lat: number; lng: number },
): Restaurant {
  const lat = place.location?.latitude || 0;
  const lng = place.location?.longitude || 0;

  let distanceKm = 0;
  let walkingTime = 0;
  if (activityCoords) {
    distanceKm = calculateDistance(activityCoords.lat, activityCoords.lng, lat, lng);
    walkingTime = Math.round((distanceKm * 1000) / 80); // ~80m/min
  }

  const googleMapsUrl = place.googleMapsUri ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${place.displayName?.text || ''}, ${place.formattedAddress || destination}`
    )}`;

  return {
    id: `gp-new-${extractGooglePlaceId(place) || Date.now()}`,
    name: place.displayName?.text || 'Restaurant',
    address: place.shortFormattedAddress || place.formattedAddress || 'Adresse non disponible',
    latitude: lat,
    longitude: lng,
    rating: place.rating || 0,
    reviewCount: place.userRatingCount || 0,
    priceLevel: parsePriceLevelNew(place.priceLevel),
    cuisineTypes: extractCuisineTypes(place),
    dietaryOptions: ['none'] as DietaryType[],
    specialties: place.editorialSummary?.text ? [place.editorialSummary.text] : undefined,
    description: place.editorialSummary?.text,
    phoneNumber: place.nationalPhoneNumber,
    website: place.websiteUri,
    googleMapsUrl,
    photos: extractPhotoUrl(place) ? [extractPhotoUrl(place)!] : undefined,
    googlePlaceId: extractGooglePlaceId(place),
    openingHours: parseOpeningHoursNew(place.regularOpeningHours) || {},
    distance: distanceKm,
    walkingTime,
    dataReliability: 'verified' as const,
  };
}

// ============================================
// Non-touristic type filters (shared with SerpAPI)
// ============================================

const NON_TOURISTIC_TYPES = new Set([
  'movie_theater', 'gym', 'fitness_center',
  'bowling_alley', 'event_venue', 'convention_center',
  'concert_hall', 'performing_arts_theater',
  'stadium', 'sports_complex', 'arena',
  'apartment_building', 'office', 'bank',
  'hospital', 'dentist', 'car_dealer', 'gas_station',
  'laundry', 'storage', 'parking', 'car_rental',
  'restaurant', 'food', 'meal_delivery', 'meal_takeaway',
  'cafe', 'coffee_shop', 'bakery', 'ice_cream_shop',
  'fast_food_restaurant', 'bar', 'night_club',
]);

const NON_TOURISTIC_NAME_KEYWORDS = [
  'cinema', 'cinéma', 'movie', 'imax',
  'gym', 'fitness', 'bowling', 'arcade', 'gaming',
  'residence', 'office', 'apartment',
  'concert hall', 'philharmonic', 'opera house',
  'don quijote', 'uniqlo', 'daiso',
  'college', 'university', 'school',
  'supermarket', 'carrefour', 'lidl',
  'restaurant', 'ristorante', 'trattoria', 'osteria',
  'pizzeria', 'burger', 'sushi bar', 'kebab',
  'madame tussauds', 'hard rock cafe', 'wax museum',
];

function isNonTouristicPlace(place: GooglePlaceNewResult): boolean {
  const types = place.types || [];
  for (const t of types) {
    if (NON_TOURISTIC_TYPES.has(t)) return true;
  }

  const nameLower = (place.displayName?.text || '').toLowerCase();
  for (const keyword of NON_TOURISTIC_NAME_KEYWORDS) {
    if (nameLower.includes(keyword)) return true;
  }

  return false;
}

/**
 * Convert a Google Places (New) result to our Attraction type
 */
export function googlePlaceNewToAttraction(
  place: GooglePlaceNewResult,
  destination: string,
  priority: number = 2,
): Attraction | null {
  if (!place.location?.latitude || !place.location?.longitude) return null;

  // Filter non-touristic places
  if (isNonTouristicPlace(place)) return null;

  const activityType = mapGoogleTypesToActivityType(place.types || []);

  return {
    id: `gp-new-${extractGooglePlaceId(place) || Date.now()}`,
    name: place.displayName?.text || 'Attraction',
    type: activityType,
    description: place.editorialSummary?.text || `${place.displayName?.text || ''} à ${destination}`,
    duration: estimateAttractionDuration(place.types || []),
    estimatedCost: estimateAttractionCost(place.priceLevel, destination, place.displayName?.text),
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    rating: place.rating || 4.0,
    reviewCount: place.userRatingCount || 0,
    mustSee: false,
    bookingRequired: false,
    openingHours: getSimpleOpeningHours(place.regularOpeningHours),
    openingHoursByDay: parseOpeningHoursNew(place.regularOpeningHours) || undefined,
    phone: place.nationalPhoneNumber,
    website: place.websiteUri,
    googleMapsUrl: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${place.displayName?.text || ''}, ${destination}`
    )}`,
    imageUrl: extractPhotoUrl(place),
    googlePlaceId: extractGooglePlaceId(place),
    dataReliability: 'verified' as const,
  };
}

function mapGoogleTypesToActivityType(types: string[]): ActivityType {
  for (const t of types) {
    if (['museum', 'art_gallery'].includes(t)) return 'culture';
    if (['park', 'garden', 'national_park', 'hiking_area'].includes(t)) return 'nature';
    if (['beach'].includes(t)) return 'beach';
    if (['shopping_mall', 'market', 'clothing_store'].includes(t)) return 'shopping';
    if (['bar', 'night_club'].includes(t)) return 'nightlife';
    if (['spa', 'beauty_salon'].includes(t)) return 'wellness';
    if (['tourist_attraction', 'church', 'place_of_worship', 'historical_landmark',
         'monument', 'castle', 'palace'].includes(t)) return 'culture';
  }
  return 'culture';
}

function estimateAttractionDuration(types: string[]): number {
  for (const t of types) {
    if (['museum', 'art_gallery'].includes(t)) return 120;
    if (['park', 'garden', 'national_park'].includes(t)) return 90;
    if (['church', 'place_of_worship'].includes(t)) return 45;
    if (['zoo', 'aquarium', 'amusement_park'].includes(t)) return 180;
    if (['beach'].includes(t)) return 180;
    if (['shopping_mall', 'market'].includes(t)) return 120;
  }
  return 90;
}

// Known free landmarks
const FREE_KNOWN_LANDMARKS: Record<string, boolean> = {
  'fontaine de trevi': true, 'trevi fountain': true, 'fontana di trevi': true,
  'pantheon': true, 'piazza navona': true, 'piazza di spagna': true,
  'spanish steps': true, 'trastevere': true, 'campo de\' fiori': true,
  'champs-élysées': true, 'puerta del sol': true, 'gran vía': true,
  'piccadilly circus': true, 'trafalgar square': true, 'dam square': true,
  'vondelpark': true, 'shibuya crossing': true, 'times square': true,
  'brooklyn bridge': true, 'central park': true, 'high line': true,
};

const FREE_ATTRACTION_PATTERNS = /\b(fontaine|fountain|fontana|piazza|place|plaza|square|pont|bridge|viewpoint|panorama|promenade|quartier|quarter|steps|crossing)\b/i;

function estimateAttractionCost(priceLevel?: string, destination?: string, name?: string): number {
  if (name) {
    const nameLower = name.toLowerCase().trim();
    const nameNormalized = nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const landmark of Object.keys(FREE_KNOWN_LANDMARKS)) {
      const landmarkNorm = landmark.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (nameNormalized === landmarkNorm || nameNormalized.includes(landmarkNorm) || landmarkNorm.includes(nameNormalized)) return 0;
    }
    if (FREE_ATTRACTION_PATTERNS.test(nameLower)) return 0;
  }

  if (priceLevel === 'PRICE_LEVEL_FREE') return 0;

  const multiplier = getCostMultiplier(destination || '');
  switch (priceLevel) {
    case 'PRICE_LEVEL_INEXPENSIVE': return Math.round(10 * multiplier);
    case 'PRICE_LEVEL_MODERATE': return Math.round(20 * multiplier);
    case 'PRICE_LEVEL_EXPENSIVE': return Math.round(35 * multiplier);
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return Math.round(50 * multiplier);
    default: return Math.round(15 * multiplier);
  }
}

// ============================================
// High-level API: Search Restaurants
// ============================================

/**
 * Search restaurants via Google Places Text Search (New).
 * Drop-in replacement for searchRestaurantsWithSerpApi().
 */
export async function searchRestaurantsGooglePlaces(
  destination: string,
  options: {
    mealType?: 'breakfast' | 'lunch' | 'dinner';
    cuisineType?: string;
    limit?: number;
    latitude?: number;
    longitude?: number;
  } = {}
): Promise<Restaurant[]> {
  if (!isGooglePlacesNewConfigured()) {
    console.warn('[Google Places New] No API key — cannot search restaurants');
    return [];
  }

  const { mealType, cuisineType, limit = 10 } = options;

  // Build query based on meal type
  let query: string;
  if (mealType === 'breakfast') {
    query = `café petit déjeuner boulangerie ${destination}`;
  } else if (cuisineType) {
    query = `${cuisineType} restaurant ${destination}`;
  } else {
    query = `meilleur restaurant ${destination}`;
  }

  const locationBias = (options.latitude && options.longitude)
    ? { lat: options.latitude, lng: options.longitude, radiusMeters: 5000 }
    : undefined;

  const places = await textSearchPlaces(query, {
    locationBias,
    maxResultCount: Math.min(limit + 5, 20),
  });

  // Filter permanently closed places
  const openPlaces = places.filter(p =>
    p.businessStatus !== 'CLOSED_PERMANENTLY'
  );

  const restaurants = openPlaces
    .map(p => googlePlaceNewToRestaurant(p, destination))
    .slice(0, limit);

  console.log(`[Google Places New] Found ${restaurants.length} restaurants for "${destination}" (${mealType || 'any'})`);
  return restaurants;
}

// ============================================
// High-level API: Search Restaurants Nearby
// ============================================

/**
 * Search restaurants near an activity via Google Places Nearby Search (New).
 * Drop-in replacement for searchRestaurantsNearby() from serpApiPlaces.
 */
export async function searchRestaurantsNearbyGooglePlaces(
  activityCoords: { lat: number; lng: number },
  destination: string,
  options: {
    mealType?: 'breakfast' | 'lunch' | 'dinner';
    maxDistance?: number; // meters, default 500
    minRating?: number;
    minReviews?: number;
    limit?: number;
  } = {}
): Promise<Restaurant[]> {
  if (!isGooglePlacesNewConfigured()) {
    console.warn('[Google Places New] No API key — cannot search nearby restaurants');
    return [];
  }

  const {
    mealType = 'lunch',
    maxDistance = 800,
    minRating = 4.0,
    minReviews = 80,
    limit = 5,
  } = options;

  // Build types filter
  const includedTypes = mealType === 'breakfast'
    ? ['cafe', 'bakery', 'breakfast_restaurant', 'brunch_restaurant']
    : ['restaurant'];

  const places = await nearbySearchPlaces(activityCoords, {
    radiusMeters: Math.min(maxDistance, 1500),
    includedTypes,
    maxResultCount: 20,
  });

  // Filter + convert + sort by distance
  const restaurants: Restaurant[] = [];
  for (const place of places) {
    if (!place.location?.latitude || !place.location?.longitude) continue;
    if (place.businessStatus === 'CLOSED_PERMANENTLY') continue;

    const distanceKm = calculateDistance(
      activityCoords.lat, activityCoords.lng,
      place.location.latitude, place.location.longitude
    );
    const distanceMeters = Math.round(distanceKm * 1000);

    if (distanceMeters > maxDistance) continue;
    if (place.rating && place.rating < minRating) continue;
    if (place.userRatingCount && place.userRatingCount < minReviews) continue;

    restaurants.push(googlePlaceNewToRestaurant(place, destination, activityCoords));
  }

  restaurants.sort((a, b) => (a.distance || 0) - (b.distance || 0));

  console.log(`[Google Places New] Found ${restaurants.length} nearby restaurants (${mealType})`);
  return restaurants.slice(0, limit);
}

// ============================================
// High-level API: Search Attractions Multi-Query
// ============================================

/**
 * Search tourist attractions via Google Places Text Search (New).
 * Drop-in replacement for searchAttractionsMultiQuery() from serpApiPlaces.
 */
export async function searchAttractionsGooglePlacesNew(
  destination: string,
  cityCenter: { lat: number; lng: number },
  options: {
    activities?: ActivityType[];
    limit?: number;
  } = {}
): Promise<Attraction[]> {
  if (!isGooglePlacesNewConfigured()) {
    console.warn('[Google Places New] No API key — cannot search attractions');
    return [];
  }

  const { limit = 50 } = options;
  const allAttractions = new Map<string, Attraction & { priority: number }>();

  // Build adaptive queries
  const queries = getAdaptiveQueries(destination, options.activities);

  // Execute all queries in parallel
  const promises = queries.map(async ({ query, priority }) => {
    const places = await textSearchPlaces(`${query} ${destination}`, {
      locationBias: { lat: cityCenter.lat, lng: cityCenter.lng, radiusMeters: 15000 },
      maxResultCount: 20,
    });

    return places.map(place => ({ place, priority }));
  });

  const results = await Promise.all(promises);

  // Process and deduplicate
  for (const queryResults of results) {
    for (const { place, priority } of queryResults) {
      const attraction = googlePlaceNewToAttraction(place, destination, priority);
      if (!attraction) continue;

      // Quality threshold
      const destSize = getDestinationSize(destination);
      const thresholds = QUALITY_THRESHOLDS[destSize];
      if (attraction.rating && attraction.rating < thresholds.minRating) continue;
      if (attraction.reviewCount && attraction.reviewCount < thresholds.minReviews) continue;

      // Dedup by placeId or normalized name
      const key = attraction.googlePlaceId || attraction.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!allAttractions.has(key) || allAttractions.get(key)!.priority > priority) {
        allAttractions.set(key, { ...attraction, priority });
      }
    }
  }

  // Sort by priority then rating
  const sorted = Array.from(allAttractions.values())
    .sort((a, b) => a.priority - b.priority || (b.rating || 0) - (a.rating || 0));

  // Dedup by GPS proximity
  const deduped: typeof sorted = [];
  for (const attr of sorted) {
    const isDuplicate = deduped.some(existing => {
      if (!attr.latitude || !existing.latitude) return false;
      const dLat = (attr.latitude - existing.latitude) * 111;
      const dLng = (attr.longitude - existing.longitude) * 111 * Math.cos(attr.latitude * Math.PI / 180);
      const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distKm > 0.15) return false;
      const wordsA = attr.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const wordsB = existing.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return wordsA.some(w => wordsB.includes(w));
    });
    if (!isDuplicate) deduped.push(attr);
  }

  // Diversification by type
  const maxPerType = Math.max(3, Math.ceil(deduped.length * 0.3));
  const typeCounts: Record<string, number> = {};
  const diversified = deduped.filter(attr => {
    const t = attr.type;
    const reviews = attr.reviewCount || 0;
    const rating = attr.rating || 0;
    if (reviews > 5000 && rating >= 4.6) {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      return true;
    }
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    return typeCounts[t] <= maxPerType;
  });

  const finalAttractions = diversified.slice(0, limit).map(({ priority, ...attr }) => ({
    ...attr,
    mustSee: false,
  }));

  console.log(`[Google Places New] Found ${finalAttractions.length} attractions for "${destination}"`);
  return finalAttractions;
}

// ============================================
// High-level API: Search Must-See by Name
// ============================================

/**
 * Search specific must-see attractions by name.
 * Drop-in replacement for searchMustSeeAttractions() from serpApiPlaces.
 */
export async function searchMustSeeGooglePlaces(
  mustSee: string,
  destination: string,
  cityCenter: { lat: number; lng: number },
): Promise<Attraction[]> {
  if (!isGooglePlacesNewConfigured() || !mustSee.trim()) return [];

  // Parse must-see items
  const rawItems = mustSee.split(',').map(s => s.trim()).filter(Boolean);
  const items: string[] = [];
  for (const item of rawItems) {
    if (/\s*[&]\s*/.test(item) || /\s+et\s+/i.test(item)) {
      const parts = item.split(/\s*[&]\s*|\s+et\s+/i).map(p => p.trim()).filter(Boolean);
      items.push(...parts);
    } else {
      items.push(item);
    }
  }

  const results: Attraction[] = [];

  const promises = items.map(async (item) => {
    const places = await textSearchPlaces(`${item} ${destination}`, {
      locationBias: { lat: cityCenter.lat, lng: cityCenter.lng, radiusMeters: 15000 },
      maxResultCount: 3,
    });

    if (places.length > 0 && places[0].location) {
      const attraction = googlePlaceNewToAttraction(places[0], destination, 0);
      if (attraction) {
        attraction.mustSee = true;
        return attraction;
      }
    }

    // Retry with broader query
    const retryPlaces = await textSearchPlaces(`${item} attraction ${destination}`, {
      locationBias: { lat: cityCenter.lat, lng: cityCenter.lng, radiusMeters: 20000 },
      maxResultCount: 3,
    });

    if (retryPlaces.length > 0 && retryPlaces[0].location) {
      const attraction = googlePlaceNewToAttraction(retryPlaces[0], destination, 0);
      if (attraction) {
        attraction.mustSee = true;
        return attraction;
      }
    }

    return null;
  });

  const found = await Promise.all(promises);
  for (const attr of found) {
    if (attr) results.push(attr);
  }

  console.log(`[Google Places New] Found ${results.length}/${items.length} must-see attractions`);
  return results;
}

// ============================================
// High-level API: Geocode via Google Places
// ============================================

/**
 * Geocode a place name via Google Places Text Search (New).
 * Drop-in replacement for geocodeViaSerpApi() from serpApiPlaces.
 */
export async function geocodeViaGooglePlaces(
  placeName: string,
  city: string,
  nearbyCoords?: { lat: number; lng: number },
): Promise<{ lat: number; lng: number; address?: string } | null> {
  if (!isGooglePlacesNewConfigured() || !placeName.trim()) return null;

  const query = `${placeName} ${city}`;
  const places = await textSearchPlaces(query, {
    locationBias: nearbyCoords
      ? { lat: nearbyCoords.lat, lng: nearbyCoords.lng, radiusMeters: 15000 }
      : undefined,
    maxResultCount: 3,
  });

  if (places.length > 0 && places[0].location) {
    return {
      lat: places[0].location.latitude,
      lng: places[0].location.longitude,
      address: places[0].formattedAddress,
    };
  }

  return null;
}

// ============================================
// Adaptive queries (same logic as serpApiPlaces)
// ============================================

const QUALITY_THRESHOLDS: Record<string, { minRating: number; minReviews: number }> = {
  major: { minRating: 4.0, minReviews: 300 },
  medium: { minRating: 3.8, minReviews: 100 },
  small: { minRating: 3.5, minReviews: 30 },
};

function getAdaptiveQueries(
  destination: string,
  activities?: ActivityType[]
): { query: string; priority: number }[] {
  const base = [
    { query: 'top tourist attractions must see landmarks', priority: 1 },
    { query: 'best museums art galleries historical sites', priority: 2 },
    { query: 'famous viewpoints markets food streets', priority: 2 },
  ];

  const archetypes = getDestinationArchetypes(destination);

  const religiousCities = ['rome', 'istanbul', 'kyoto', 'bangkok', 'jerusalem', 'bali', 'varanasi', 'cairo', 'seville', 'florence'];
  if (religiousCities.some(c => destination.toLowerCase().includes(c)) || archetypes.includes('cultural')) {
    base.push({ query: 'famous temples shrines churches monuments', priority: 2 });
  }

  if (archetypes.includes('beach') || activities?.includes('beach')) {
    base.push({ query: 'best beaches swimming spots coastal walks seaside', priority: 2 });
  }
  if (activities?.includes('nature') || archetypes.includes('nature')) {
    base.push({ query: 'parks gardens botanical hiking trails nature reserves', priority: 2 });
  }
  if (activities?.includes('nightlife') || archetypes.includes('nightlife')) {
    base.push({ query: 'best nightlife areas rooftop bars evening entertainment', priority: 3 });
  }
  if (activities?.includes('gastronomy') || archetypes.includes('gastronomy')) {
    base.push({ query: 'food markets street food districts local cuisine', priority: 2 });
  }
  if (activities?.includes('adventure') || archetypes.includes('adventure')) {
    base.push({ query: 'outdoor activities water sports adventure experiences', priority: 2 });
  }
  if (activities?.includes('wellness') || archetypes.includes('wellness')) {
    base.push({ query: 'spas thermal baths wellness retreats hot springs', priority: 3 });
  }
  if (activities?.includes('shopping')) {
    base.push({ query: 'best shopping districts markets boutiques crafts', priority: 3 });
  }

  return base;
}

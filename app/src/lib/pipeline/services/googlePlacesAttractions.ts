/**
 * Google Places Text Search — Tourist Attractions
 *
 * Uses the Google Places Text Search API to find top attractions with:
 * - GPS coordinates
 * - Ratings
 * - Review counts (= popularity proxy)
 *
 * FREE within $200/month Google Cloud credit.
 * Response time: ~0.3s
 */

import type { Attraction } from '../../services/attractions';
import type { ActivityType } from '../../types';
import { buildPlacePhotoProxyUrl } from '../../services/googlePlacePhoto';
import { getCachedResponse, setCachedResponse } from '../../services/supabaseCache';

const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

/** Google Places types that are NOT tourist attractions (cities, agencies, etc.) */
const EXCLUDED_GOOGLE_TYPES = [
  'locality', 'political', 'administrative_area_level_1',
  'administrative_area_level_2', 'administrative_area_level_3',
  'administrative_area_level_4', 'administrative_area_level_5',
  'country', 'colloquial_area', 'sublocality',
  'travel_agency', 'real_estate_agency', 'insurance_agency',
  // Food/drink establishments should not be in attraction pool
  'restaurant', 'cafe', 'bakery', 'meal_takeaway', 'meal_delivery',
  'food', 'bar', 'night_club',
];

/** Google Places types that indicate a genuine tourist attraction */
const ATTRACTION_GOOGLE_TYPES = [
  'tourist_attraction', 'museum', 'park', 'art_gallery',
  'church', 'place_of_worship', 'zoo', 'aquarium',
  'amusement_park', 'stadium', 'shopping_mall',
];

/**
 * Check if a Google Places result should be excluded (city, agency, etc.).
 * A result is excluded if it has an excluded type AND no genuine attraction type.
 */
function isExcludedPlaceType(types: string[]): boolean {
  if (ATTRACTION_GOOGLE_TYPES.some(t => types.includes(t))) return false;
  return EXCLUDED_GOOGLE_TYPES.some(t => types.includes(t));
}

function getApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

export async function searchGooglePlacesAttractions(
  destination: string,
  destCoords: { lat: number; lng: number },
  options?: { limit?: number }
): Promise<Attraction[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[Google Places] No API key configured');
    return [];
  }

  try {
    const queries = [
      `top tourist attractions ${destination}`,
      `must see landmarks ${destination}`,
    ];

    const allResults: any[] = [];
    const seenPlaceIds = new Set<string>();

    for (const query of queries) {
      // L2 cache check
      const cacheKey = `places-text-search-legacy|${query}|fr`;
      const cachedResults = await getCachedResponse<any[]>('places-text-search-legacy', cacheKey);
      if (cachedResults) {
        for (const result of cachedResults) {
          if (!seenPlaceIds.has(result.place_id)) {
            if (isExcludedPlaceType(result.types || [])) continue;
            seenPlaceIds.add(result.place_id);
            allResults.push(result);
          }
        }
        continue;
      }

      const { trackApiCost } = await import('../../services/apiCostGuard');
      trackApiCost('places-text-search-legacy');

      const url = new URL(GOOGLE_PLACES_TEXT_SEARCH_URL);
      url.searchParams.set('query', query);
      url.searchParams.set('language', 'fr');
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`[Google Places] HTTP ${response.status} for query "${query}"`);
        continue;
      }

      const data = await response.json();

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.warn(`[Google Places] Status: ${data.status} - ${data.error_message || ''}`);
        continue;
      }

      // Save raw results to L2 (before dedup/filtering)
      setCachedResponse('places-text-search-legacy', cacheKey, data.results || [], 30, destination).catch(() => {});

      for (const result of data.results || []) {
        if (!seenPlaceIds.has(result.place_id)) {
          // Skip cities, administrative areas, and agencies
          if (isExcludedPlaceType(result.types || [])) {
            console.log(`[Google Places] Filtered "${result.name}" (types: ${(result.types || []).join(', ')})`);
            continue;
          }
          seenPlaceIds.add(result.place_id);
          allResults.push(result);
        }
      }
    }

    const attractions: Attraction[] = allResults.map((r, idx) => {
      const loc = r.geometry?.location || {};
      // Extract photo URL from Google Places photo_reference
      const photoRef = r.photos?.[0]?.photo_reference;
      const imageUrl = photoRef
        ? buildPlacePhotoProxyUrl(photoRef, 400)
        : undefined;
      // Build photo gallery (up to 3 photos) for carousel display — limited to save API quota
      const photoGallery = r.photos && r.photos.length > 0
        ? r.photos.slice(0, 3).map((p: any) => {
            const ref = p.photo_reference || p.name;
            return ref ? buildPlacePhotoProxyUrl(ref, 800) : null;
          }).filter(Boolean) as string[]
        : undefined;
      return {
        id: `gp-${r.place_id || idx}`,
        name: r.name || 'Unknown',
        type: mapGoogleType(r.types || []) as ActivityType,
        description: '',  // Don't use formatted_address — addresses are filtered in buildDescription()
        latitude: loc.lat || 0,
        longitude: loc.lng || 0,
        rating: r.rating || 0,
        reviewCount: r.user_ratings_total || 0,
        duration: estimateDuration(r.types || []),
        estimatedCost: 0, // Will be fixed by fixAttractionCost
        openingHours: { open: '09:00', close: '18:00' },
        mustSee: false,
        bookingRequired: false,
        dataReliability: 'verified' as const,
        imageUrl,
        photoGallery: photoGallery && photoGallery.length > 1 ? photoGallery : undefined,
        googlePlaceId: r.place_id || undefined,
      };
    });

    console.log(`[Google Places] ✅ ${attractions.length} attractions found for ${destination}`);
    return attractions;
  } catch (error) {
    console.warn('[Google Places] Error:', error instanceof Error ? error.message : error);
    return [];
  }
}

function mapGoogleType(types: string[]): string {
  if (types.includes('museum')) return 'museum';
  if (types.includes('church') || types.includes('place_of_worship')) return 'religious';
  if (types.includes('amusement_park')) return 'amusement_park';
  if (types.includes('park')) return 'park';
  if (types.includes('art_gallery')) return 'gallery';
  if (types.includes('zoo') || types.includes('aquarium')) return 'zoo';
  if (types.includes('stadium')) return 'stadium';
  if (types.includes('shopping_mall') || types.includes('market')) return 'market';
  if (types.includes('tourist_attraction')) return 'attraction';
  if (types.includes('point_of_interest')) return 'attraction';
  return 'attraction';
}

function estimateDuration(types: string[]): number {
  if (types.includes('museum')) return 120;
  if (types.includes('amusement_park')) return 240;
  if (types.includes('park') || types.includes('garden')) return 60;
  if (types.includes('church') || types.includes('place_of_worship')) return 30;
  if (types.includes('zoo') || types.includes('aquarium')) return 180;
  return 60; // Default: 1 hour
}

// ============================================
// Google Places Details — Opening Hours Enrichment
// ============================================

const GOOGLE_PLACES_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Batch-enrich attractions with real opening hours from Google Places Details API.
 * Only fetches for attractions that have a googlePlaceId.
 *
 * Cost: ~$0.005 per request (Place Details: Basic + Contact fields)
 * For 20 attractions: ~$0.10 per trip generation.
 *
 * @param attractions - Attractions to enrich (mutates in place)
 * @param limit - Max number of Details API calls (default: 20)
 */
export async function enrichAttractionsWithPlaceDetails(
  attractions: Attraction[],
  limit: number = 20
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const toEnrich = attractions
    .filter(a => a.googlePlaceId)
    .slice(0, limit);

  if (toEnrich.length === 0) return;

  const T0 = Date.now();
  let enriched = 0;
  const CONCURRENCY = 5;

  for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
    const batch = toEnrich.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(attraction => fetchPlaceDetails(attraction.googlePlaceId!, apiKey))
    );

    batch.forEach((attraction, idx) => {
      const result = results[idx];
      if (result.status !== 'fulfilled' || !result.value) return;

      const details = result.value;

      // Update opening hours
      if (details.openingHours) {
        attraction.openingHours = details.openingHours.default;
        attraction.openingHoursByDay = details.openingHours.byDay;
      }

      // Update business status
      if (details.businessStatus) {
        attraction.businessStatus = details.businessStatus;
      }

      // Add phone and website (if not already set)
      if (details.phone && !attraction.phone) {
        attraction.phone = details.phone;
      }
      if (details.website && !attraction.website) {
        attraction.website = details.website;
      }

      enriched++;
    });
  }

  console.log(`[Google Places Details] ✅ ${enriched}/${toEnrich.length} attractions enriched with real hours (${Date.now() - T0}ms)`);
}

interface PlaceDetailsResult {
  openingHours?: {
    default: { open: string; close: string };
    byDay: Record<string, { open: string; close: string } | null>;
  };
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
  phone?: string;
  website?: string;
}

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<PlaceDetailsResult | null> {
  // L2 cache check
  const cacheKey = `places-details|${placeId}`;
  const cachedDetails = await getCachedResponse<PlaceDetailsResult>('places-details-legacy', cacheKey);
  if (cachedDetails) return cachedDetails;

  try {
    const { trackApiCost } = await import('../../services/apiCostGuard');
    trackApiCost('places-details-legacy');

    const url = new URL(GOOGLE_PLACES_DETAILS_URL);
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'opening_hours,business_status,formatted_phone_number,website');
    url.searchParams.set('language', 'fr');
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 'OK') return null;

    const result = data.result;
    if (!result) return null;

    // Parse opening hours periods
    let openingHours: PlaceDetailsResult['openingHours'] = undefined;
    if (result.opening_hours?.periods) {
      const periods: any[] = result.opening_hours.periods;
      const byDay: Record<string, { open: string; close: string } | null> = {};

      // Initialize all days as null (closed)
      for (const day of DAY_NAMES) {
        byDay[day] = null;
      }

      // Fill in open days
      for (const period of periods) {
        if (!period.open) continue;

        const dayIdx = period.open.day;
        const dayName = DAY_NAMES[dayIdx];
        if (!dayName) continue;

        const openTime = formatPeriodTime(period.open.time);
        const closeTime = period.close ? formatPeriodTime(period.close.time) : '23:59';

        byDay[dayName] = { open: openTime, close: closeTime };
      }

      // Compute default open/close (most common hours across open days)
      const openDays = Object.values(byDay).filter(v => v !== null) as { open: string; close: string }[];
      if (openDays.length > 0) {
        // Use earliest open and latest close as defaults
        const defaultOpen = openDays.reduce((min, d) => d.open < min ? d.open : min, '23:59');
        const defaultClose = openDays.reduce((max, d) => d.close > max ? d.close : max, '00:00');

        openingHours = {
          default: { open: defaultOpen, close: defaultClose },
          byDay,
        };
      }
    }

    const detailResult: PlaceDetailsResult = {
      openingHours,
      businessStatus: result.business_status || undefined,
      phone: result.formatted_phone_number || undefined,
      website: result.website || undefined,
    };

    // Save to L2
    setCachedResponse('places-details-legacy', cacheKey, detailResult, 30).catch(() => {});

    return detailResult;
  } catch {
    return null;
  }
}

function formatPeriodTime(time: string): string {
  // Google returns "0930" format, we need "09:30"
  if (!time || time.length < 4) return '09:00';
  return `${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

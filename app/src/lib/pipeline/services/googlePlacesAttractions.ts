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

const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

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

      for (const result of data.results || []) {
        if (!seenPlaceIds.has(result.place_id)) {
          seenPlaceIds.add(result.place_id);
          allResults.push(result);
        }
      }
    }

    const attractions: Attraction[] = allResults.map((r, idx) => {
      const loc = r.geometry?.location || {};
      return {
        id: `gp-${r.place_id || idx}`,
        name: r.name || 'Unknown',
        type: mapGoogleType(r.types || []) as ActivityType,
        description: r.formatted_address || '',
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
  if (types.includes('park')) return 'park';
  if (types.includes('art_gallery')) return 'gallery';
  if (types.includes('zoo') || types.includes('aquarium')) return 'zoo';
  if (types.includes('amusement_park')) return 'amusement_park';
  if (types.includes('stadium')) return 'stadium';
  if (types.includes('shopping_mall') || types.includes('market')) return 'market';
  if (types.includes('tourist_attraction')) return 'attraction';
  if (types.includes('point_of_interest')) return 'attraction';
  return 'attraction';
}

function estimateDuration(types: string[]): number {
  if (types.includes('museum')) return 120;
  if (types.includes('park') || types.includes('garden')) return 60;
  if (types.includes('church') || types.includes('place_of_worship')) return 30;
  if (types.includes('zoo') || types.includes('aquarium')) return 180;
  if (types.includes('amusement_park')) return 240;
  return 60; // Default: 1 hour
}

/**
 * TripAdvisor RapidAPI Service
 *
 * Restaurants: searchLocation → searchRestaurants → détails avec Michelin, rating, cuisine
 * Hôtels: searchHotels → prix réels multi-providers (Booking, Hotels.com, etc.)
 *
 * Clé: RAPIDAPI_KEY (partagée avec Travel Places, FlixBus, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Restaurant, DietaryType, Accommodation } from '../types';

const RAPIDAPI_HOST = 'tripadvisor16.p.rapidapi.com';
const BASE_URL = `https://${RAPIDAPI_HOST}/api/v1`;
const CACHE_DIR = path.join(process.cwd(), '.cache', 'tripadvisor');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// ============================================
// Cache
// ============================================

function readCache<T>(key: string): T | null {
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

function writeCache(key: string, data: unknown): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[TripAdvisor] Cache write error:', e);
  }
}

function getHeaders(): Record<string, string> {
  const key = process.env.RAPIDAPI_KEY?.trim();
  if (!key) throw new Error('RAPIDAPI_KEY not configured');
  return {
    'x-rapidapi-host': RAPIDAPI_HOST,
    'x-rapidapi-key': key,
  };
}

// ============================================
// Location search (needed to get geoId/locationId)
// ============================================

interface TripAdvisorLocation {
  locationId: string;
  localizedName: string;
  latitude: number;
  longitude: number;
}

async function searchLocation(query: string): Promise<TripAdvisorLocation | null> {
  const cacheKey = `loc-${query.toLowerCase().replace(/\s+/g, '-')}`;
  const cached = readCache<TripAdvisorLocation>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${BASE_URL}/restaurant/searchLocation?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) return null;

    const data = await response.json();
    const results = data?.data || [];
    if (results.length === 0) return null;

    const loc: TripAdvisorLocation = {
      locationId: results[0].locationId,
      localizedName: results[0].localizedName,
      latitude: parseFloat(results[0].latitude) || 0,
      longitude: parseFloat(results[0].longitude) || 0,
    };

    writeCache(cacheKey, loc);
    return loc;
  } catch (e) {
    console.warn('[TripAdvisor] searchLocation error:', e);
    return null;
  }
}

// ============================================
// Restaurants
// ============================================

interface TripAdvisorRestaurant {
  restaurantsId: string;
  name: string;
  averageRating: number;
  userReviewCount: number;
  priceTag?: string; // "$", "$$-$$$", "$$$$"
  establishmentTypeAndCuisineTags?: string[];
  currentOpenStatusCategory?: string;
  currentOpenStatusText?: string;
  address?: string;
  addressObj?: {
    street1?: string;
    street2?: string;
    city?: string;
    country?: string;
    postalcode?: string;
  };
  latitude?: string;
  longitude?: string;
  heroImgUrl?: string;
  heroImgRawHeight?: number;
  heroImgRawWidth?: number;
  parentGeoName?: string;
  distanceTo?: string;
  telephone?: string;
  website?: string;
  menuUrl?: string;
  isDiningReservations?: boolean;
  reserveActionUrl?: string;
}

export async function searchTripAdvisorRestaurants(
  destination: string,
  options: {
    limit?: number;
  } = {}
): Promise<Restaurant[]> {
  const { limit = 20 } = options;

  // 1. Get locationId
  const location = await searchLocation(destination);
  if (!location) {
    console.warn(`[TripAdvisor] Location not found for "${destination}"`);
    return [];
  }

  // 2. Check cache
  const cacheKey = `restos-${location.locationId}`;
  const cached = readCache<Restaurant[]>(cacheKey);
  if (cached) {
    console.log(`[TripAdvisor] Cache hit restaurants ${destination} (${cached.length})`);
    return cached.slice(0, limit);
  }

  // 3. Search restaurants
  try {
    const url = `${BASE_URL}/restaurant/searchRestaurants?locationId=${location.locationId}`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      console.error(`[TripAdvisor] Restaurant search error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results: TripAdvisorRestaurant[] = data?.data?.data || [];

    console.log(`[TripAdvisor] ${results.length} restaurants trouvés pour "${destination}"`);

    const restaurants: Restaurant[] = results
      .filter(r => r.name && r.averageRating > 0)
      .slice(0, limit)
      .map((r, i) => {
        const lat = parseFloat(r.latitude || '') || location.latitude;
        const lng = parseFloat(r.longitude || '') || location.longitude;
        const address = r.address || formatAddress(r.addressObj) || '';

        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          address ? `${r.name}, ${address}` : `${r.name}, ${destination}`
        )}`;

        return {
          id: `ta-${r.restaurantsId || i}`,
          name: r.name,
          address: address || 'Adresse non disponible',
          latitude: lat,
          longitude: lng,
          rating: r.averageRating || 0,
          reviewCount: r.userReviewCount || 0,
          priceLevel: parseTAPriceLevel(r.priceTag),
          cuisineTypes: (r.establishmentTypeAndCuisineTags || []).slice(0, 5),
          dietaryOptions: ['none'] as DietaryType[],
          openingHours: {},
          isOpenNow: r.currentOpenStatusCategory === 'OPEN',
          phoneNumber: r.telephone,
          website: r.website,
          googleMapsUrl,
          reservationUrl: r.reserveActionUrl || undefined,
          photos: r.heroImgUrl ? [r.heroImgUrl] : undefined,
          distance: 0,
          walkingTime: 0,
        };
      });

    writeCache(cacheKey, restaurants);
    return restaurants;
  } catch (e) {
    console.error('[TripAdvisor] Restaurant search error:', e);
    return [];
  }
}

// ============================================
// Hotels
// ============================================

interface TripAdvisorHotel {
  id: string;
  title: string;
  primaryInfo?: string;
  secondaryInfo?: string;
  badge?: { text: string };
  bubbleRating?: { rating: number; count: string };
  isSponsored?: boolean;
  aclessBadge?: { text: string };
  cardPhotos?: Array<{
    sizes?: {
      urlTemplate?: string;
      maxHeight?: number;
      maxWidth?: number;
    };
  }>;
  commerceInfo?: {
    externalUrl?: string;
    provider?: string;
    loadingMessage?: string;
    priceForDisplay?: string;
    strikethroughPrice?: string;
    pricingPeriod?: string;
    details?: string;
  };
  priceForDisplay?: string;
  strikethroughPrice?: string;
  priceDetails?: string;
  priceSummary?: string;
}

export async function searchTripAdvisorHotels(
  destination: string,
  options: {
    checkIn: string; // YYYY-MM-DD
    checkOut: string;
    adults?: number;
    rooms?: number;
    currency?: string;
    limit?: number;
  }
): Promise<Accommodation[]> {
  const { checkIn, checkOut, adults = 2, rooms = 1, currency = 'EUR', limit = 15 } = options;

  // 1. Get geoId (same as locationId)
  const location = await searchLocation(destination);
  if (!location) {
    console.warn(`[TripAdvisor] Location not found for hotels "${destination}"`);
    return [];
  }

  // 2. Check cache
  const cacheKey = `hotels-${location.locationId}-${checkIn}-${checkOut}-${adults}-${rooms}`;
  const cached = readCache<Accommodation[]>(cacheKey);
  if (cached) {
    console.log(`[TripAdvisor] Cache hit hotels ${destination} (${cached.length})`);
    return cached.slice(0, limit);
  }

  // 3. Search hotels
  try {
    const params = new URLSearchParams({
      geoId: location.locationId,
      checkIn,
      checkOut,
      adults: adults.toString(),
      rooms: rooms.toString(),
      currencyCode: currency,
    });

    const url = `${BASE_URL}/hotels/searchHotels?${params}`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      console.error(`[TripAdvisor] Hotel search error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results: TripAdvisorHotel[] = data?.data?.data || [];

    console.log(`[TripAdvisor] ${results.length} hôtels trouvés pour "${destination}"`);

    // Calculate nights
    const nights = Math.max(1, Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (24 * 60 * 60 * 1000)
    ));

    const accommodations: Accommodation[] = results
      .filter(h => h.title && !h.isSponsored)
      .slice(0, limit)
      .map((h, i) => {
        const totalPrice = parsePrice(h.commerceInfo?.priceForDisplay || h.priceForDisplay || '');
        const pricePerNight = totalPrice > 0 ? Math.round(totalPrice / nights) : 0;
        const ratingValue = h.bubbleRating?.rating || 0;
        const reviewCount = parseInt(h.bubbleRating?.count?.replace(/[^0-9]/g, '') || '0') || 0;

        // Extract photo URL
        const photoUrl = h.cardPhotos?.[0]?.sizes?.urlTemplate
          ?.replace('{width}', '600')
          .replace('{height}', '400');

        // Extract provider and booking URL
        const provider = h.commerceInfo?.provider || '';
        const bookingUrl = h.commerceInfo?.externalUrl || undefined;

        // Determine hotel type from badges/info
        const type = guessAccommodationType(h.title, h.primaryInfo || '');

        return {
          id: `ta-hotel-${h.id || i}`,
          name: h.title,
          type,
          address: destination,
          latitude: location.latitude,
          longitude: location.longitude,
          rating: ratingValue,
          reviewCount,
          pricePerNight,
          totalPrice: totalPrice > 0 ? totalPrice : undefined,
          currency,
          amenities: parseAmenities(h.primaryInfo, h.secondaryInfo),
          photos: photoUrl ? [photoUrl] : undefined,
          checkInTime: '15:00',
          checkOutTime: '11:00',
          bookingUrl,
          description: [
            h.primaryInfo,
            h.secondaryInfo,
            provider ? `Prix via ${provider}` : undefined,
            h.badge?.text,
          ].filter(Boolean).join(' • '),
        };
      });

    writeCache(cacheKey, accommodations);
    return accommodations;
  } catch (e) {
    console.error('[TripAdvisor] Hotel search error:', e);
    return [];
  }
}

// ============================================
// Helpers
// ============================================

function formatAddress(obj?: { street1?: string; city?: string; country?: string }): string {
  if (!obj) return '';
  return [obj.street1, obj.city, obj.country].filter(Boolean).join(', ');
}

function parseTAPriceLevel(priceTag?: string): 1 | 2 | 3 | 4 {
  if (!priceTag) return 2;
  if (priceTag.includes('$$$$')) return 4;
  if (priceTag.includes('$$$')) return 3;
  if (priceTag.includes('$$')) return 2;
  if (priceTag.includes('€€€€')) return 4;
  if (priceTag.includes('€€€')) return 3;
  if (priceTag.includes('€€')) return 2;
  return 1;
}

function parsePrice(priceStr: string): number {
  if (!priceStr) return 0;
  // Extract number from strings like "$245", "€189", "245 €"
  const match = priceStr.replace(/[,\s]/g, '').match(/[\d.]+/);
  return match ? Math.round(parseFloat(match[0])) : 0;
}

function guessAccommodationType(name: string, info: string): 'hotel' | 'apartment' | 'hostel' | 'bnb' | 'resort' {
  const text = `${name} ${info}`.toLowerCase();
  if (text.includes('hostel') || text.includes('auberge')) return 'hostel';
  if (text.includes('resort') || text.includes('spa')) return 'resort';
  if (text.includes('apartment') || text.includes('appart') || text.includes('suite')) return 'apartment';
  if (text.includes('b&b') || text.includes('bed and breakfast') || text.includes('chambre')) return 'bnb';
  return 'hotel';
}

function parseAmenities(primary?: string, secondary?: string): string[] {
  const text = `${primary || ''} ${secondary || ''}`.toLowerCase();
  const amenities: string[] = [];
  if (text.includes('wifi') || text.includes('wi-fi')) amenities.push('wifi');
  if (text.includes('pool') || text.includes('piscine')) amenities.push('pool');
  if (text.includes('breakfast') || text.includes('petit')) amenities.push('breakfast');
  if (text.includes('parking')) amenities.push('parking');
  if (text.includes('spa')) amenities.push('spa');
  if (text.includes('gym') || text.includes('fitness')) amenities.push('gym');
  if (text.includes('restaurant')) amenities.push('restaurant');
  return amenities;
}

// ============================================
// Configuration check
// ============================================

export function isTripAdvisorConfigured(): boolean {
  return !!process.env.RAPIDAPI_KEY?.trim();
}

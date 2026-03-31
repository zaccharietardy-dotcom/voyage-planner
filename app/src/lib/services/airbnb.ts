/**
 * Service de recherche Airbnb via RapidAPI (airbnb13)
 *
 * Utilise l'API "Airbnb13" sur RapidAPI
 * Endpoint: GET /search-location?location=...&checkin=...&checkout=...&adults=...&currency=EUR
 *
 * Variables d'environnement requises :
 * - RAPIDAPI_KEY : clé RapidAPI (partagée avec Booking)
 */

import { Accommodation } from '../types';

function getRapidApiKey() { return process.env.RAPIDAPI_KEY || ''; }
const AIRBNB_HOST = 'airbnb13.p.rapidapi.com';

export function isAirbnbApiConfigured(): boolean {
  return !!getRapidApiKey();
}

interface AirbnbSearchOptions {
  maxPricePerNight?: number;
  minPricePerNight?: number;
  guests?: number;
  requireKitchen?: boolean;
  limit?: number;
  cityCenter?: { lat: number; lng: number };
}

export function isValidAirbnbRoomUrl(url?: string | null, listingId?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('airbnb.com')) return false;
    const match = parsed.pathname.match(/^\/rooms\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match?.[1]) return false;
    if (listingId && match[1] !== listingId) return false;
    return true;
  } catch {
    return false;
  }
}

interface Airbnb13Listing {
  id?: string;
  name?: string;
  city?: string;
  type?: string;
  url?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviewsCount?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  images?: string[];
  previewAmenities?: string[];
  price?: {
    rate?: number;
    currency?: string;
    total?: number | null;
    priceItems?: Array<{ title?: string; amount?: number }>;
  };
}

/**
 * Recherche des logements Airbnb pour une destination
 */
export async function searchAirbnbListings(
  destination: string,
  checkIn: string,
  checkOut: string,
  options: AirbnbSearchOptions = {},
): Promise<Accommodation[]> {
  if (!getRapidApiKey()) {
    console.warn('[Airbnb] RAPIDAPI_KEY non configurée');
    return [];
  }

  try {
    const params = new URLSearchParams({
      location: destination,
      checkin: checkIn,
      checkout: checkOut,
      adults: (options.guests || 2).toString(),
      currency: 'EUR',
    });

    const response = await fetch(`https://${AIRBNB_HOST}/search-location?${params}`, {
      headers: {
        'x-rapidapi-key': getRapidApiKey(),
        'x-rapidapi-host': AIRBNB_HOST,
      },
    });

    if (!response.ok) {
      console.error(`[Airbnb] HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (data.error !== false || !Array.isArray(data.results)) {
      console.warn('[Airbnb] API error:', data.message || 'unknown');
      return [];
    }

    const listings: Airbnb13Listing[] = data.results;
    console.log(`[Airbnb] ${listings.length} résultats pour ${destination}`);

    const nights = Math.max(1, Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)
    ));

    const accommodations: Accommodation[] = [];

    for (const item of listings.slice(0, options.limit || 15)) {
      const listingId = String(item.id || '').trim();
      if (!listingId || !item.lat || !item.lng) continue;

      // Extraire le prix par nuit
      let pricePerNight = 0;
      if (item.price?.priceItems?.length) {
        // Chercher "N nights x € X"
        for (const pi of item.price.priceItems) {
          const match = pi.title?.match(/(\d+)\s*nights?\s*x\s*[€$£]\s*([\d,.]+)/i);
          if (match) {
            pricePerNight = parseFloat(match[2].replace(',', ''));
            break;
          }
        }
      }
      if (!pricePerNight && item.price?.rate && nights > 0) {
        pricePerNight = Math.round(item.price.rate / nights);
      }
      if (pricePerNight <= 0) continue;

      // Filtrer par budget
      if (options.maxPricePerNight && pricePerNight > options.maxPricePerNight * 1.5) continue;

      const bookingUrl = `https://www.airbnb.com/rooms/${listingId}?check_in=${checkIn}&check_out=${checkOut}&adults=${options.guests || 2}`;
      const typeLower = (item.type || '').toLowerCase();
      const isEntireHome = typeLower.includes('entire') || typeLower.includes('flat') ||
        typeLower.includes('apartment') || typeLower.includes('loft') ||
        typeLower.includes('home') || typeLower.includes('condo') ||
        typeLower.includes('house');

      accommodations.push({
        id: `airbnb-${listingId}`,
        name: item.name || `Airbnb à ${destination}`,
        type: isEntireHome ? 'apartment' as const : 'bnb' as const,
        address: item.city || destination,
        latitude: item.lat,
        longitude: item.lng,
        rating: (item.rating || 4) * 2, // /5 → /10
        reviewCount: item.reviewsCount || 0,
        pricePerNight,
        totalPrice: pricePerNight * nights,
        currency: 'EUR',
        amenities: item.previewAmenities || (isEntireHome ? ['Logement entier', 'WiFi'] : ['WiFi']),
        photos: (item.images || []).slice(0, 5),
        checkInTime: '15:00',
        checkOutTime: '11:00',
        bookingUrl,
        distanceToCenter: undefined,
        breakfastIncluded: false,
        description: item.type || undefined,
      });
    }

    // Trier par prix croissant
    accommodations.sort((a, b) => a.pricePerNight - b.pricePerNight);

    // Si cuisine requise, préférer les logements entiers
    if (options.requireKitchen) {
      const entireHomes = accommodations.filter(a => a.type === 'apartment');
      if (entireHomes.length > 0) return entireHomes;
    }

    console.log(`[Airbnb] ${accommodations.length} logements retenus (${accommodations.filter(a => a.type === 'apartment').length} entiers)`);
    return accommodations;
  } catch (error) {
    console.error('[Airbnb] Erreur:', error);
    return [];
  }
}

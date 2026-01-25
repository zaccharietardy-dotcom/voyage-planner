/**
 * Foursquare Legacy API v2 Service
 *
 * API GRATUITE - données vérifiées: restaurants, bars, attractions avec notes réelles
 *
 * Documentation: https://developer.foursquare.com/docs/api-reference/venues/search
 *
 * Authentification via client_id et client_secret:
 * FOURSQUARE_CLIENT_ID=xxx
 * FOURSQUARE_CLIENT_SECRET=xxx
 */

import * as fs from 'fs';
import * as path from 'path';

const FOURSQUARE_API_URL = 'https://api.foursquare.com/v2/venues';
const CACHE_DIR = path.join(process.cwd(), 'data', 'foursquare-cache');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Catégories Foursquare utiles
export const FOURSQUARE_CATEGORIES = {
  restaurant: '13065', // Food
  cafe: '13032', // Café
  bar: '13003', // Bar
  nightclub: '10032', // Nightclub
  museum: '10027', // Museum
  landmark: '16000', // Landmarks & Outdoors
  park: '16032', // Park
  shopping: '17000', // Shopping
  hotel: '19014', // Hotel
  attraction: '10000', // Arts & Entertainment
};

export interface FoursquarePlace {
  fsq_id: string;
  name: string;
  location: {
    address?: string;
    formatted_address?: string;
    locality?: string;
    region?: string;
    country?: string;
    cross_street?: string;
    postcode?: string;
  };
  geocodes: {
    main: {
      latitude: number;
      longitude: number;
    };
  };
  categories: Array<{
    id: number;
    name: string;
    icon: {
      prefix: string;
      suffix: string;
    };
  }>;
  distance?: number;
  rating?: number;
  price?: number; // 1-4
  hours?: {
    open_now?: boolean;
    regular?: Array<{
      day: number;
      open: string;
      close: string;
    }>;
  };
  tel?: string;
  website?: string;
  photos?: Array<{
    id: string;
    prefix: string;
    suffix: string;
    width: number;
    height: number;
  }>;
  tips?: Array<{
    text: string;
    created_at: string;
  }>;
  stats?: {
    total_ratings: number;
    total_tips: number;
  };
}

interface FoursquareSearchResponse {
  results: FoursquarePlace[];
}

interface PlaceCache {
  [key: string]: {
    places: FoursquarePlace[];
    fetchedAt: string;
  };
}

/**
 * Charge le cache des places
 */
function loadCache(): PlaceCache {
  try {
    const cacheFile = path.join(CACHE_DIR, 'places.json');
    if (fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }
  } catch (error) {
    console.warn('[Foursquare] Erreur lecture cache:', error);
  }
  return {};
}

/**
 * Sauvegarde le cache
 */
function saveCache(cache: PlaceCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cacheFile = path.join(CACHE_DIR, 'places.json');
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('[Foursquare] Erreur sauvegarde cache:', error);
  }
}

/**
 * Recherche des lieux via Foursquare Places API
 */
export async function searchPlaces(options: {
  query?: string;
  location: { lat: number; lng: number };
  radius?: number; // mètres, max 100000
  categories?: string; // IDs séparés par virgule (format v2: categoryId)
  limit?: number; // max 50
  sort?: 'RELEVANCE' | 'RATING' | 'DISTANCE' | 'POPULARITY';
}): Promise<FoursquarePlace[]> {
  const clientId = process.env.FOURSQUARE_CLIENT_ID;
  const clientSecret = process.env.FOURSQUARE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('[Foursquare] FOURSQUARE_CLIENT_ID/SECRET non configurées');
    return [];
  }

  const { query, location, radius = 5000, categories, limit = 20 } = options;

  // Clé de cache
  const cacheKey = `${query || 'all'}-${location.lat.toFixed(3)}-${location.lng.toFixed(3)}-${categories || 'all'}`;
  const cache = loadCache();

  // Vérifier le cache
  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < CACHE_TTL) {
      console.log(`[Foursquare] Cache hit pour "${query || categories}"`);
      return cached.places;
    }
  }

  try {
    // API Legacy v2 avec client_id/client_secret
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      v: '20240101', // Version date (YYYYMMDD)
      ll: `${location.lat},${location.lng}`,
      radius: radius.toString(),
      limit: limit.toString(),
    });

    if (query) {
      params.set('query', query);
    }

    if (categories) {
      params.set('categoryId', categories);
    }

    const response = await fetch(`${FOURSQUARE_API_URL}/search?${params}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Foursquare] Erreur API: ${response.status} - ${errorText}`);
      return [];
    }

    const data = await response.json();

    // V2 API: response.venues (pas response.results)
    const venues = data.response?.venues || [];

    // Convertir v2 venues en format FoursquarePlace
    const places: FoursquarePlace[] = venues.map((v: any) => ({
      fsq_id: v.id,
      name: v.name,
      location: {
        address: v.location?.address,
        formatted_address: v.location?.formattedAddress?.join(', '),
        locality: v.location?.city,
        region: v.location?.state,
        country: v.location?.country,
        cross_street: v.location?.crossStreet,
        postcode: v.location?.postalCode,
      },
      geocodes: {
        main: {
          latitude: v.location?.lat || 0,
          longitude: v.location?.lng || 0,
        },
      },
      categories: v.categories?.map((c: any) => ({
        id: c.id,
        name: c.name,
        icon: c.icon ? `${c.icon.prefix}88${c.icon.suffix}` : undefined,
      })) || [],
      distance: v.location?.distance,
      rating: v.rating ? v.rating / 2 : undefined, // V2 rating is 0-10, convert to 0-5
      price: v.price?.tier,
      hours: v.hours,
      tel: v.contact?.phone,
      website: v.url,
      stats: v.stats,
    }));

    console.log(`[Foursquare] ${places.length} lieux trouvés pour "${query || categories}"`);

    // Sauvegarder en cache
    cache[cacheKey] = {
      places,
      fetchedAt: new Date().toISOString(),
    };
    saveCache(cache);

    return places;
  } catch (error) {
    console.error('[Foursquare] Erreur recherche:', error);
    return [];
  }
}

/**
 * Recherche des restaurants vérifiés
 */
export async function searchRestaurants(
  city: string,
  location: { lat: number; lng: number },
  options?: {
    cuisine?: string;
    priceLevel?: 1 | 2 | 3 | 4;
    limit?: number;
  }
): Promise<FoursquarePlace[]> {
  const query = options?.cuisine ? `${options.cuisine} restaurant` : 'restaurant';

  const places = await searchPlaces({
    query,
    location,
    categories: FOURSQUARE_CATEGORIES.restaurant,
    limit: options?.limit || 30,
    sort: 'RATING',
  });

  // Filtrer par prix si spécifié
  if (options?.priceLevel) {
    const maxPrice = options.priceLevel;
    return places.filter(p => !p.price || p.price <= maxPrice);
  }

  return places;
}

/**
 * Recherche des attractions touristiques vérifiées
 */
export async function searchAttractions(
  city: string,
  location: { lat: number; lng: number },
  options?: {
    type?: 'museum' | 'landmark' | 'park' | 'all';
    limit?: number;
  }
): Promise<FoursquarePlace[]> {
  const categoryMap: Record<string, string> = {
    museum: FOURSQUARE_CATEGORIES.museum,
    landmark: FOURSQUARE_CATEGORIES.landmark,
    park: FOURSQUARE_CATEGORIES.park,
    all: `${FOURSQUARE_CATEGORIES.museum},${FOURSQUARE_CATEGORIES.landmark},${FOURSQUARE_CATEGORIES.attraction}`,
  };

  const categories = categoryMap[options?.type || 'all'];

  return searchPlaces({
    location,
    categories,
    limit: options?.limit || 30,
    sort: 'POPULARITY',
  });
}

/**
 * Recherche des bars et vie nocturne
 */
export async function searchNightlife(
  city: string,
  location: { lat: number; lng: number },
  limit?: number
): Promise<FoursquarePlace[]> {
  return searchPlaces({
    location,
    categories: `${FOURSQUARE_CATEGORIES.bar},${FOURSQUARE_CATEGORIES.nightclub}`,
    limit: limit || 20,
    sort: 'RATING',
  });
}

/**
 * Recherche des hôtels vérifiés
 */
export async function searchHotelsFoursquare(
  city: string,
  location: { lat: number; lng: number },
  limit?: number
): Promise<FoursquarePlace[]> {
  return searchPlaces({
    query: 'hotel',
    location,
    categories: FOURSQUARE_CATEGORIES.hotel,
    limit: limit || 20,
    sort: 'RATING',
  });
}

/**
 * Convertit un lieu Foursquare en format Restaurant interne
 */
export function foursquareToRestaurant(place: FoursquarePlace): {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviewCount: number;
  priceLevel: 1 | 2 | 3 | 4;
  cuisineTypes: string[];
  isVerified: true;
  foursquareId: string;
  phone?: string;
  website?: string;
  isOpenNow?: boolean;
  googleMapsUrl: string;
} {
  const address = place.location.formatted_address || place.location.address || '';

  return {
    id: `fsq-${place.fsq_id}`,
    name: place.name,
    address: address || 'Adresse non disponible',
    latitude: place.geocodes.main.latitude,
    longitude: place.geocodes.main.longitude,
    rating: place.rating ? place.rating / 2 : 4, // Foursquare: /10, on veut /5
    reviewCount: place.stats?.total_ratings || 0,
    priceLevel: (place.price || 2) as 1 | 2 | 3 | 4,
    cuisineTypes: place.categories.map(c => c.name),
    isVerified: true,
    foursquareId: place.fsq_id,
    phone: place.tel,
    website: place.website,
    isOpenNow: place.hours?.open_now,
    googleMapsUrl: generateGoogleMapsUrl(place.name, address),
  };
}

/**
 * Convertit un lieu Foursquare en format Attraction interne
 */
export function foursquareToAttraction(place: FoursquarePlace): {
  id: string;
  name: string;
  description: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviewCount: number;
  category: string;
  isVerified: true;
  foursquareId: string;
  photos: string[];
  tips: string[];
  website?: string;
  googleMapsUrl: string;
} {
  const address = place.location.formatted_address || place.location.address || '';

  return {
    id: `fsq-${place.fsq_id}`,
    name: place.name,
    description: place.tips?.[0]?.text || `Découvrez ${place.name}`,
    address: address || 'Adresse non disponible',
    latitude: place.geocodes.main.latitude,
    longitude: place.geocodes.main.longitude,
    rating: place.rating ? place.rating / 2 : 4, // Foursquare: /10, on veut /5
    reviewCount: place.stats?.total_ratings || 0,
    category: place.categories[0]?.name || 'Attraction',
    isVerified: true,
    foursquareId: place.fsq_id,
    photos: (place.photos || []).map(p => `${p.prefix}300x300${p.suffix}`),
    tips: (place.tips || []).map(t => t.text),
    website: place.website,
    googleMapsUrl: generateGoogleMapsUrl(place.name, address),
  };
}

/**
 * Vérifie si l'API Foursquare est configurée
 */
export function isFoursquareConfigured(): boolean {
  return !!(process.env.FOURSQUARE_CLIENT_ID && process.env.FOURSQUARE_CLIENT_SECRET);
}

/**
 * Génère l'URL Foursquare d'un lieu
 */
export function getFoursquareUrl(place: FoursquarePlace): string {
  return `https://foursquare.com/v/${place.fsq_id}`;
}

/**
 * Génère l'URL Google Maps direct pour un lieu
 * Affiche le nom du lieu directement dans Google Maps
 */
export function generateGoogleMapsUrl(name: string, address?: string): string {
  // Combiner nom + adresse pour une recherche précise
  const query = address ? `${name}, ${address}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

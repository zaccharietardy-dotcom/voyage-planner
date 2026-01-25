/**
 * Service de recherche de lieux via SerpAPI (Google Local/Maps)
 *
 * Retourne des données RÉELLES et VÉRIFIÉES:
 * - Restaurants avec adresses, notes, avis
 * - Hôtels avec prix, disponibilité
 * - Attractions avec horaires
 *
 * Quota gratuit: 100 recherches/mois
 * https://serpapi.com/
 */

import { Restaurant, DietaryType, ActivityType } from '../types';
import { Attraction } from './attractions';
import { calculateDistance } from './geocoding';

const SERPAPI_KEY = process.env.SERPAPI_KEY?.trim();
const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';

interface SerpApiLocalResult {
  position: number;
  title: string;
  place_id?: string;
  lsig?: string;
  data_id?: string;
  data_cid?: string;
  reviews_link?: string;
  photos_link?: string;
  gps_coordinates?: {
    latitude: number;
    longitude: number;
  };
  place_id_search?: string;
  provider_id?: string;
  rating?: number;
  reviews?: number;
  reviews_original?: string;
  price?: string;
  type?: string;
  types?: string[];
  type_id?: string;
  type_ids?: string[];
  address?: string;
  open_state?: string;
  hours?: string;
  operating_hours?: Record<string, string>;
  phone?: string;
  website?: string;
  description?: string;
  service_options?: {
    dine_in?: boolean;
    takeout?: boolean;
    delivery?: boolean;
  };
  thumbnail?: string;
}

interface SerpApiLocalResponse {
  search_metadata?: {
    status: string;
    google_local_url?: string;
  };
  local_results?: SerpApiLocalResult[];
  error?: string;
}

/**
 * Recherche des restaurants via SerpAPI Google Local
 */
export async function searchRestaurantsWithSerpApi(
  destination: string,
  options: {
    mealType?: 'breakfast' | 'lunch' | 'dinner';
    cuisineType?: string;
    limit?: number;
  } = {}
): Promise<Restaurant[]> {
  if (!SERPAPI_KEY) {
    console.warn('[SerpAPI Places] SERPAPI_KEY non configurée');
    return [];
  }

  const { mealType, cuisineType, limit = 10 } = options;

  // Construire la requête selon le type de repas
  let query = 'restaurant';
  if (mealType === 'breakfast') {
    query = 'breakfast brunch';
  } else if (cuisineType) {
    query = `${cuisineType} restaurant`;
  } else {
    query = 'restaurant local cuisine'; // Privilégier la cuisine locale
  }

  const params = new URLSearchParams({
    api_key: SERPAPI_KEY,
    engine: 'google_local',
    q: query,
    location: destination,
    hl: 'fr',
    gl: getCountryCode(destination),
  });

  try {
    console.log(`[SerpAPI Places] Recherche restaurants à ${destination}...`);
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI Places] Erreur HTTP:', response.status);
      return [];
    }

    const data: SerpApiLocalResponse = await response.json();

    if (data.error) {
      console.error('[SerpAPI Places] Erreur:', data.error);
      return [];
    }

    const results = data.local_results || [];
    console.log(`[SerpAPI Places] ${results.length} restaurants trouvés`);

    // Convertir en format Restaurant
    const restaurants: Restaurant[] = results.slice(0, limit).map((r, index) => {
      // Générer une URL Google Maps fiable en utilisant le NOM + ADRESSE COMPLÈTE
      // Cela permet à Google Maps de trouver le lieu exact
      const searchQuery = r.address
        ? `${r.title}, ${r.address}`
        : `${r.title}, ${destination}`;
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

      return {
        id: `serp-${r.place_id || r.data_cid || index}`,
        name: r.title,
        address: r.address || 'Adresse non disponible',
        latitude: r.gps_coordinates?.latitude || 0,
        longitude: r.gps_coordinates?.longitude || 0,
        rating: r.rating || 0,
        reviewCount: r.reviews || 0,
        priceLevel: parsePriceLevel(r.price),
        cuisineTypes: parseCuisineTypes(r.type, r.types),
        dietaryOptions: ['none'] as DietaryType[],
        specialties: r.description ? [r.description] : undefined,
        description: r.description,
        phoneNumber: r.phone,
        website: r.website,
        googleMapsUrl, // URL Google Maps fiable avec nom + adresse complète
        openingHours: parseOpeningHours(r.operating_hours) || {},
        distance: 0, // Sera calculé plus tard
        walkingTime: 0,
      };
    });

    return restaurants;
  } catch (error) {
    console.error('[SerpAPI Places] Erreur:', error);
    return [];
  }
}

/**
 * Recherche des hôtels via SerpAPI Google Hotels
 */
export async function searchHotelsWithSerpApi(
  destination: string,
  checkInDate: string,
  checkOutDate: string,
  options: {
    adults?: number;
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    limit?: number;
  } = {}
): Promise<any[]> {
  if (!SERPAPI_KEY) {
    console.warn('[SerpAPI Hotels] SERPAPI_KEY non configurée');
    return [];
  }

  const { adults = 2, limit = 10 } = options;

  const params = new URLSearchParams({
    api_key: SERPAPI_KEY,
    engine: 'google_hotels',
    q: destination,
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    adults: adults.toString(),
    currency: 'EUR',
    hl: 'fr',
    gl: getCountryCode(destination),
  });

  try {
    console.log(`[SerpAPI Hotels] Recherche hôtels à ${destination}...`);
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI Hotels] Erreur HTTP:', response.status);
      return [];
    }

    const data = await response.json();

    if (data.error) {
      console.error('[SerpAPI Hotels] Erreur:', data.error);
      return [];
    }

    const properties = data.properties || [];
    console.log(`[SerpAPI Hotels] ${properties.length} hôtels trouvés`);

    return properties.slice(0, limit).map((h: any) => ({
      id: `serp-hotel-${h.property_token || h.name}`,
      name: h.name,
      address: h.address,
      latitude: h.gps_coordinates?.latitude,
      longitude: h.gps_coordinates?.longitude,
      rating: h.overall_rating,
      reviewCount: h.reviews,
      stars: h.hotel_class,
      pricePerNight: h.rate_per_night?.lowest ? parseFloat(h.rate_per_night.lowest.replace(/[^0-9.]/g, '')) : null,
      totalPrice: h.total_rate?.lowest ? parseFloat(h.total_rate.lowest.replace(/[^0-9.]/g, '')) : null,
      amenities: h.amenities,
      images: h.images,
      checkIn: h.check_in_time,
      checkOut: h.check_out_time,
      bookingUrl: h.link,
      dataSource: 'serpapi',
    }));
  } catch (error) {
    console.error('[SerpAPI Hotels] Erreur:', error);
    return [];
  }
}

/**
 * Recherche des attractions via SerpAPI Google Local
 */
export async function searchAttractionsWithSerpApi(
  destination: string,
  options: {
    type?: string; // 'museum', 'park', 'monument', etc.
    limit?: number;
  } = {}
): Promise<any[]> {
  if (!SERPAPI_KEY) {
    console.warn('[SerpAPI Attractions] SERPAPI_KEY non configurée');
    return [];
  }

  const { type, limit = 10 } = options;

  const query = type
    ? `${type} ${destination}`
    : `tourist attractions ${destination}`;

  const params = new URLSearchParams({
    api_key: SERPAPI_KEY,
    engine: 'google_local',
    q: query,
    location: destination,
    hl: 'fr',
    gl: getCountryCode(destination),
  });

  try {
    console.log(`[SerpAPI Attractions] Recherche attractions à ${destination}...`);
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI Attractions] Erreur HTTP:', response.status);
      return [];
    }

    const data: SerpApiLocalResponse = await response.json();

    if (data.error) {
      console.error('[SerpAPI Attractions] Erreur:', data.error);
      return [];
    }

    const results = data.local_results || [];
    console.log(`[SerpAPI Attractions] ${results.length} attractions trouvées`);

    return results.slice(0, limit).map((a, index) => ({
      id: `serp-attr-${a.place_id || index}`,
      name: a.title,
      address: a.address,
      latitude: a.gps_coordinates?.latitude,
      longitude: a.gps_coordinates?.longitude,
      rating: a.rating,
      reviewCount: a.reviews,
      type: a.type,
      description: a.description,
      openingHours: parseOpeningHours(a.operating_hours),
      phone: a.phone,
      website: a.website,
      thumbnail: a.thumbnail,
      dataSource: 'serpapi',
    }));
  } catch (error) {
    console.error('[SerpAPI Attractions] Erreur:', error);
    return [];
  }
}

/**
 * Vérifie si SerpAPI Places est configurée
 */
export function isSerpApiPlacesConfigured(): boolean {
  return !!SERPAPI_KEY;
}

// === Constantes de qualité ===

export const QUALITY_THRESHOLDS = {
  attractions: { minRating: 4.3, minReviews: 500 },
  restaurants: { minRating: 4.3, minReviews: 100, maxDistanceMeters: 500 },
};

// === Requêtes thématiques pour attractions ===

const ATTRACTION_QUERIES = [
  { query: 'top tourist attractions must see', priority: 1 },
  { query: 'best museums', priority: 2 },
  { query: 'famous viewpoints landmarks', priority: 2 },
  { query: 'parks gardens nature', priority: 3 },
];

/**
 * Recherche multi-requêtes des attractions via SerpAPI Google Maps
 * Utilise le paramètre ll pour recherche GPS précise
 */
export async function searchAttractionsMultiQuery(
  destination: string,
  cityCenter: { lat: number; lng: number },
  options: {
    types?: ActivityType[];
    limit?: number;
  } = {}
): Promise<Attraction[]> {
  if (!SERPAPI_KEY) {
    console.warn('[SerpAPI Attractions Multi] SERPAPI_KEY non configurée');
    return [];
  }

  const { limit = 15 } = options;
  const allAttractions: Map<string, Attraction & { priority: number }> = new Map();
  const countryCode = getCountryCode(destination);

  console.log(`[SerpAPI Attractions Multi] Recherche attractions à ${destination} (${cityCenter.lat}, ${cityCenter.lng})...`);

  // Exécuter les requêtes en parallèle pour optimiser le temps
  const promises = ATTRACTION_QUERIES.map(async ({ query, priority }) => {
    const params = new URLSearchParams({
      api_key: SERPAPI_KEY!,
      engine: 'google_maps',
      q: `${query} ${destination}`,
      ll: `@${cityCenter.lat},${cityCenter.lng},14z`, // 14z = ~1km de rayon
      hl: 'fr',
      gl: countryCode,
    });

    try {
      const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);
      if (!response.ok) return [];

      const data = await response.json();
      if (data.error) {
        console.warn(`[SerpAPI Attractions Multi] Erreur pour "${query}":`, data.error);
        return [];
      }

      return (data.local_results || []).map((place: SerpApiLocalResult) => ({
        place,
        priority,
      }));
    } catch (error) {
      console.error(`[SerpAPI Attractions Multi] Erreur pour "${query}":`, error);
      return [];
    }
  });

  const results = await Promise.all(promises);

  // Traiter et dédupliquer les résultats
  for (const queryResults of results) {
    for (const { place, priority } of queryResults) {
      // Filtrage qualité
      if (!meetsAttractionQualityThreshold(place)) continue;

      // Clé de déduplication: place_id ou nom normalisé
      const key = place.place_id || place.title.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Ne garder que si c'est nouveau ou meilleure priorité
      if (!allAttractions.has(key) || allAttractions.get(key)!.priority > priority) {
        const attraction = convertToAttraction(place, destination, priority);
        if (attraction) {
          allAttractions.set(key, { ...attraction, priority });
        }
      }
    }
  }

  // Trier par priorité puis par rating
  const sorted = Array.from(allAttractions.values())
    .sort((a, b) => a.priority - b.priority || (b.rating || 0) - (a.rating || 0))
    .slice(0, limit);

  // Marquer les 3 premiers comme mustSee
  const finalAttractions = sorted.map((attr, index) => {
    const { priority, ...attraction } = attr;
    return {
      ...attraction,
      mustSee: index < 3,
    };
  });

  console.log(`[SerpAPI Attractions Multi] ✅ ${finalAttractions.length} attractions de qualité trouvées`);
  return finalAttractions;
}

/**
 * Recherche des restaurants à proximité d'une activité via Google Maps
 * Utilise le paramètre ll pour recherche GPS précise
 */
export async function searchRestaurantsNearby(
  activityCoords: { lat: number; lng: number },
  destination: string,
  options: {
    mealType?: 'breakfast' | 'lunch' | 'dinner';
    maxDistance?: number; // mètres, défaut 500
    minRating?: number;
    minReviews?: number;
    limit?: number;
  } = {}
): Promise<Restaurant[]> {
  if (!SERPAPI_KEY) {
    console.warn('[SerpAPI Restaurants Nearby] SERPAPI_KEY non configurée');
    return [];
  }

  const {
    mealType = 'lunch',
    maxDistance = QUALITY_THRESHOLDS.restaurants.maxDistanceMeters,
    minRating = QUALITY_THRESHOLDS.restaurants.minRating,
    minReviews = QUALITY_THRESHOLDS.restaurants.minReviews,
    limit = 5,
  } = options;

  // Construire la requête selon le type de repas
  let query: string;
  switch (mealType) {
    case 'breakfast':
      query = 'breakfast brunch cafe';
      break;
    case 'dinner':
      query = 'restaurant dinner';
      break;
    default:
      query = 'restaurant lunch';
  }

  // Zoom 16z = ~300m de rayon, parfait pour proximité
  const params = new URLSearchParams({
    api_key: SERPAPI_KEY,
    engine: 'google_maps',
    q: query,
    ll: `@${activityCoords.lat},${activityCoords.lng},16z`,
    hl: 'fr',
    gl: getCountryCode(destination),
  });

  try {
    console.log(`[SerpAPI Restaurants Nearby] Recherche ${mealType} près de (${activityCoords.lat}, ${activityCoords.lng})...`);
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI Restaurants Nearby] Erreur HTTP:', response.status);
      return [];
    }

    const data = await response.json();

    if (data.error) {
      console.error('[SerpAPI Restaurants Nearby] Erreur:', data.error);
      return [];
    }

    const results = data.local_results || [];
    const restaurants: Restaurant[] = [];

    for (const place of results) {
      // Vérifier les coordonnées GPS
      if (!place.gps_coordinates?.latitude || !place.gps_coordinates?.longitude) {
        continue;
      }

      // Calculer la distance en mètres
      const distanceKm = calculateDistance(
        activityCoords.lat,
        activityCoords.lng,
        place.gps_coordinates.latitude,
        place.gps_coordinates.longitude
      );
      const distanceMeters = Math.round(distanceKm * 1000);

      // Filtres de qualité
      if (distanceMeters > maxDistance) continue;
      if (place.rating && place.rating < minRating) continue;
      if (place.reviews && place.reviews < minReviews) continue;

      // Générer URL Google Maps
      const searchQuery = place.address
        ? `${place.title}, ${place.address}`
        : `${place.title}, ${destination}`;
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

      restaurants.push({
        id: `serp-nearby-${place.place_id || place.data_cid || restaurants.length}`,
        name: place.title,
        address: place.address || 'Adresse non disponible',
        latitude: place.gps_coordinates.latitude,
        longitude: place.gps_coordinates.longitude,
        rating: place.rating || 0,
        reviewCount: place.reviews || 0,
        priceLevel: parsePriceLevel(place.price),
        cuisineTypes: parseCuisineTypes(place.type, place.types),
        dietaryOptions: ['none'] as DietaryType[],
        specialties: place.description ? [place.description] : undefined,
        description: place.description,
        phoneNumber: place.phone,
        website: place.website,
        googleMapsUrl,
        openingHours: parseOpeningHours(place.operating_hours) || {},
        distance: distanceKm,
        walkingTime: Math.round(distanceMeters / 80), // ~80m/min de marche
      });
    }

    // Trier par distance
    restaurants.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    console.log(`[SerpAPI Restaurants Nearby] ✅ ${restaurants.length} restaurants à moins de ${maxDistance}m trouvés`);
    return restaurants.slice(0, limit);
  } catch (error) {
    console.error('[SerpAPI Restaurants Nearby] Erreur:', error);
    return [];
  }
}

/**
 * Vérifie si une attraction répond aux critères de qualité
 */
function meetsAttractionQualityThreshold(place: SerpApiLocalResult): boolean {
  const { minRating, minReviews } = QUALITY_THRESHOLDS.attractions;

  // Si pas de rating/reviews, on accepte (données manquantes != mauvaise qualité)
  if (place.rating === undefined && place.reviews === undefined) return true;

  // Vérifier les seuils si les données existent
  if (place.rating !== undefined && place.rating < minRating) return false;
  if (place.reviews !== undefined && place.reviews < minReviews) return false;

  return true;
}

/**
 * Convertit un résultat SerpAPI en Attraction
 */
function convertToAttraction(
  place: SerpApiLocalResult,
  destination: string,
  priority: number
): Attraction | null {
  if (!place.gps_coordinates?.latitude || !place.gps_coordinates?.longitude) {
    // Attractions sans coordonnées GPS sont inutiles pour la cohérence géo
    return null;
  }

  // Mapper le type vers ActivityType
  const activityType = mapToActivityType(place.type, place.types);

  return {
    id: `serp-attr-${place.place_id || place.data_cid || Date.now()}`,
    name: place.title,
    type: activityType,
    description: place.description || `${place.title} à ${destination}`,
    duration: estimateDuration(activityType),
    estimatedCost: estimateCost(place.price),
    latitude: place.gps_coordinates.latitude,
    longitude: place.gps_coordinates.longitude,
    rating: place.rating || 4.0,
    mustSee: priority === 1,
    bookingRequired: false,
    openingHours: place.operating_hours ? parseSimpleOpeningHours(place.operating_hours) || { open: '09:00', close: '18:00' } : { open: '09:00', close: '18:00' },
    tips: place.description,
    dataReliability: 'verified' as const,
    googleMapsUrl: place.website || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.title + ', ' + destination)}`,
  };
}

/**
 * Mappe les types SerpAPI vers ActivityType
 */
function mapToActivityType(type?: string, types?: string[]): ActivityType {
  const allTypes = [type, ...(types || [])].filter(Boolean).map(t => t!.toLowerCase());

  for (const t of allTypes) {
    if (t.includes('museum') || t.includes('gallery') || t.includes('church') || t.includes('cathedral')) {
      return 'culture';
    }
    if (t.includes('park') || t.includes('garden') || t.includes('nature') || t.includes('beach')) {
      return 'nature';
    }
    if (t.includes('restaurant') || t.includes('food') || t.includes('market')) {
      return 'gastronomy';
    }
    if (t.includes('bar') || t.includes('club') || t.includes('nightlife')) {
      return 'nightlife';
    }
    if (t.includes('shop') || t.includes('mall') || t.includes('store')) {
      return 'shopping';
    }
    if (t.includes('spa') || t.includes('wellness') || t.includes('gym')) {
      return 'wellness';
    }
    if (t.includes('adventure') || t.includes('sport') || t.includes('tour')) {
      return 'adventure';
    }
  }

  return 'culture'; // Défaut pour les attractions touristiques
}

/**
 * Estime la durée de visite selon le type d'activité
 */
function estimateDuration(type: ActivityType): number {
  const durations: Record<ActivityType, number> = {
    culture: 120,      // 2h pour un musée
    nature: 90,        // 1h30 pour un parc
    gastronomy: 90,    // 1h30 pour un repas
    beach: 180,        // 3h à la plage
    shopping: 120,     // 2h shopping
    nightlife: 180,    // 3h de soirée
    adventure: 180,    // 3h d'activité aventure
    wellness: 120,     // 2h spa/wellness
  };
  return durations[type] || 90;
}

/**
 * Estime le coût selon le niveau de prix
 */
function estimateCost(price?: string): number {
  if (!price) return 15;
  const level = parsePriceLevel(price);
  const costs = { 1: 10, 2: 20, 3: 35, 4: 50 };
  return costs[level];
}

/**
 * Parse les horaires d'ouverture en format simple
 */
function parseSimpleOpeningHours(hours: Record<string, string>): { open: string; close: string } | undefined {
  // Prendre le premier jour avec des horaires
  for (const value of Object.values(hours)) {
    if (value && !value.toLowerCase().includes('fermé') && !value.toLowerCase().includes('closed')) {
      const match = value.match(/(\d{1,2}:\d{2})\s*(?:AM|PM)?\s*[-–]\s*(\d{1,2}:\d{2})\s*(?:AM|PM)?/i);
      if (match) {
        return { open: match[1], close: match[2] };
      }
    }
  }
  return { open: '09:00', close: '18:00' }; // Défaut
}

// === Fonctions utilitaires ===

function getCountryCode(destination: string): string {
  const dest = destination.toLowerCase();

  if (['barcelona', 'madrid', 'sevilla', 'valencia', 'malaga'].some(c => dest.includes(c))) return 'es';
  if (['paris', 'lyon', 'marseille', 'nice', 'bordeaux'].some(c => dest.includes(c))) return 'fr';
  if (['rome', 'florence', 'venice', 'milan', 'naples'].some(c => dest.includes(c))) return 'it';
  if (['lisbon', 'porto'].some(c => dest.includes(c))) return 'pt';
  if (['london', 'manchester', 'edinburgh'].some(c => dest.includes(c))) return 'uk';
  if (['berlin', 'munich', 'frankfurt'].some(c => dest.includes(c))) return 'de';
  if (['amsterdam', 'rotterdam'].some(c => dest.includes(c))) return 'nl';
  if (['brussels', 'bruges'].some(c => dest.includes(c))) return 'be';
  if (['athens', 'santorini'].some(c => dest.includes(c))) return 'gr';
  if (['tokyo', 'kyoto', 'osaka'].some(c => dest.includes(c))) return 'jp';

  return 'us'; // Défaut
}

function parsePriceLevel(price?: string): 1 | 2 | 3 | 4 {
  if (!price) return 2;
  const dollarCount = (price.match(/\$/g) || []).length;
  const euroCount = (price.match(/€/g) || []).length;
  const count = Math.max(dollarCount, euroCount);
  return Math.min(4, Math.max(1, count)) as 1 | 2 | 3 | 4;
}

function parseCuisineTypes(type?: string, types?: string[]): string[] {
  const cuisines: string[] = [];

  if (type) {
    cuisines.push(type.toLowerCase());
  }

  if (types) {
    cuisines.push(...types.map(t => t.toLowerCase()));
  }

  return cuisines.length > 0 ? cuisines : ['local'];
}

function parseOpeningHours(hours?: Record<string, string>): Record<string, { open: string; close: string } | null> | undefined {
  if (!hours) return undefined;

  const result: Record<string, { open: string; close: string } | null> = {};
  const dayMapping: Record<string, string> = {
    'lundi': 'monday',
    'mardi': 'tuesday',
    'mercredi': 'wednesday',
    'jeudi': 'thursday',
    'vendredi': 'friday',
    'samedi': 'saturday',
    'dimanche': 'sunday',
    'monday': 'monday',
    'tuesday': 'tuesday',
    'wednesday': 'wednesday',
    'thursday': 'thursday',
    'friday': 'friday',
    'saturday': 'saturday',
    'sunday': 'sunday',
  };

  for (const [day, value] of Object.entries(hours)) {
    const normalizedDay = dayMapping[day.toLowerCase()];
    if (!normalizedDay) continue;

    if (value.toLowerCase().includes('fermé') || value.toLowerCase().includes('closed')) {
      result[normalizedDay] = null;
    } else {
      // Parse "10:00 AM - 10:00 PM" or "10:00 - 22:00"
      const match = value.match(/(\d{1,2}:\d{2})\s*(?:AM|PM)?\s*[-–]\s*(\d{1,2}:\d{2})\s*(?:AM|PM)?/i);
      if (match) {
        result[normalizedDay] = {
          open: match[1],
          close: match[2],
        };
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

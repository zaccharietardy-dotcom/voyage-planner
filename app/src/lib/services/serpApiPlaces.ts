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

import * as fs from 'fs';
import * as path from 'path';
import { Restaurant, DietaryType, ActivityType } from '../types';
import { Attraction } from './attractions';
import { calculateDistance } from './geocoding';
import { getDestinationSize, getCostMultiplier, getDestinationArchetypes } from './destinationData';

function getSerpApiKey() { return process.env.SERPAPI_KEY?.trim(); }
const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';

// ============================================
// Cache attractions (7 jours TTL)
// ============================================

const CACHE_BASE = process.env.VERCEL ? '/tmp' : process.cwd();
const ATTRACTIONS_CACHE_DIR = path.join(CACHE_BASE, '.cache', 'attractions');
const ATTRACTIONS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function getAttractionsCacheKey(destination: string, cityCenter: { lat: number; lng: number }): string {
  const key = `${destination}-${cityCenter.lat.toFixed(2)}-${cityCenter.lng.toFixed(2)}`;
  return key.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 200);
}

function readAttractionsCache(key: string): Attraction[] | null {
  try {
    const filePath = path.join(ATTRACTIONS_CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > ATTRACTIONS_CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeAttractionsCache(key: string, data: Attraction[]): void {
  try {
    if (!fs.existsSync(ATTRACTIONS_CACHE_DIR)) {
      fs.mkdirSync(ATTRACTIONS_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(ATTRACTIONS_CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch (error) {
    console.warn('[SerpAPI Cache] Erreur écriture:', error);
  }
}

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
    latitude?: number;
    longitude?: number;
  } = {}
): Promise<Restaurant[]> {
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI Places] SERPAPI_KEY non configurée');
    return [];
  }

  const { mealType, cuisineType, limit = 10 } = options;

  // Construire la requête selon le type de repas + langue locale
  const countryCode = getCountryCode(destination);
  let query = 'restaurant';
  if (mealType === 'breakfast') {
    // Query adaptée au pays pour trouver cafés et boulangeries
    const breakfastQueries: Record<string, string> = {
      fr: 'café petit déjeuner boulangerie',
      es: 'cafetería desayuno',
      it: 'caffè colazione pasticceria',
      pt: 'café pequeno almoço padaria',
      de: 'frühstück café bäckerei',
    };
    query = breakfastQueries[countryCode] || 'breakfast brunch café bakery';
  } else if (cuisineType) {
    query = `${cuisineType} restaurant`;
  } else {
    query = 'meilleur restaurant'; // Generic query to get diverse results
  }

  const serpParams: Record<string, string> = {
    api_key: getSerpApiKey()!,
    engine: 'google_local',
    q: query,
    hl: 'fr',
    gl: getCountryCode(destination),
  };
  // Utiliser les coordonnées GPS si disponibles (plus fiable pour les villes hors Europe/US)
  if (options.latitude && options.longitude) {
    serpParams.ll = `@${options.latitude},${options.longitude},14z`;
  }
  // Pour les villes hors Europe/US, le param `location` échoue souvent ("Unsupported location")
  // Stratégie: essayer d'abord avec location, puis fallback avec le nom de la ville dans la query
  serpParams.location = destination;

  const tryFetch = async (p: Record<string, string>): Promise<SerpApiLocalResponse | null> => {
    const url = `${SERPAPI_BASE_URL}?${new URLSearchParams(p)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text();
      // HTTP 400 = "Unsupported location" — fallback possible
      if (resp.status === 400) return null;
      console.error(`[SerpAPI Places] Erreur HTTP ${resp.status}:`, body.substring(0, 200));
      return null;
    }
    const data: SerpApiLocalResponse = await resp.json();
    if (data.error) {
      // "Unsupported location" → fallback
      if (data.error.includes('Unsupported') || data.error.includes('location')) return null;
      console.error('[SerpAPI Places] Erreur:', data.error);
      return null;
    }
    return data;
  };

  try {
    console.log(`[SerpAPI Places] Requête: q="${query}", location="${destination}", ll="${serpParams.ll || 'none'}", gl="${serpParams.gl}"`);
    let data = await tryFetch(serpParams);

    // Fallback: si location échoue, mettre le nom de la ville dans la query
    if (!data) {
      console.log(`[SerpAPI Places] Location "${destination}" non supportée, fallback → query avec nom de ville`);
      const fallbackParams = { ...serpParams };
      delete fallbackParams.location;
      fallbackParams.q = `${query} ${destination}`;
      data = await tryFetch(fallbackParams);
    }

    if (!data) {
      console.warn('[SerpAPI Places] Toutes les tentatives ont échoué');
      return [];
    }

    const results = data.local_results || [];
    console.log(`[SerpAPI Places] ${results.length} résultats local_results`);

    // Filtrer les restaurants fermés définitivement
    const openResults = results.filter(r => {
      const openState = r.open_state?.toLowerCase() || '';
      // Exclure les restaurants fermés définitivement
      if (openState.includes('permanently closed') ||
          openState.includes('fermé définitivement') ||
          openState.includes('cerrado permanentemente') ||
          openState.includes('chiuso definitivamente')) {
        return false;
      }
      return true;
    });

    // Convertir en format Restaurant
    const restaurants: Restaurant[] = openResults.slice(0, limit).map((r, index) => {
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
        // Pas de reservationUrl TheFork (liens de recherche générique peu fiables)
        // Google Maps est utilisé via googleMapsUrl ci-dessus
        photos: r.thumbnail ? [r.thumbnail] : undefined,
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
    hotelClass?: number; // 2, 3, 4, ou 5 étoiles
    limit?: number;
    sort?: 'relevance' | 'lowest_price' | 'highest_rating';
  } = {}
): Promise<any[]> {
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI Hotels] SERPAPI_KEY non configurée');
    return [];
  }

  const { adults = 2, limit = 10, minPrice, maxPrice, hotelClass, sort } = options;

  const params = new URLSearchParams({
    api_key: getSerpApiKey()!,
    engine: 'google_hotels',
    q: destination,
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    adults: adults.toString(),
    currency: 'EUR',
    hl: 'fr',
    gl: getCountryCode(destination),
  });

  // Filtres de prix (par nuit)
  if (minPrice) {
    params.set('min_price', minPrice.toString());
  }
  if (maxPrice) {
    params.set('max_price', maxPrice.toString());
  }

  // Filtre de classe d'hôtel (étoiles)
  // Format SerpAPI: "2" pour 2 étoiles, "3" pour 3 étoiles, etc.
  if (hotelClass) {
    params.set('hotel_class', hotelClass.toString());
  }

  // Tri des résultats
  // 3 = lowest price, 8 = highest rating
  if (sort === 'lowest_price') {
    params.set('sort_by', '3');
  } else if (sort === 'highest_rating') {
    params.set('sort_by', '8');
  }

  try {
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

    // FILTRER les hôtels DISPONIBLES uniquement (ceux qui ont un prix)
    // Si rate_per_night est null, l'hôtel est probablement complet pour ces dates
    const availableProperties = properties.filter((h: any) => {
      const hasPrice = h.rate_per_night?.lowest || h.total_rate?.lowest;
      if (!hasPrice) {
        return false;
      }
      return true;
    });

    return availableProperties.slice(0, limit).map((h: any) => {
      // UTILISER LE LIEN DIRECT FOURNI PAR GOOGLE
      // Ce lien pointe vers le site officiel de l'hôtel avec les dates pré-remplies
      // C'est la source la plus fiable pour la disponibilité
      const bookingUrl = h.link || `https://www.google.com/travel/hotels/entity/${h.property_token}?q=${encodeURIComponent(destination)}&g2lb=2502548&hl=fr&gl=fr&cs=1&ssta=1&ts=CAEaHBIaEhQKBwjoDxAHGBcSBwjoDxAHGBgYATICEAAqCQoFOgNFVVIaAA&checkin=${checkInDate}&checkout=${checkOutDate}&adults=${options.adults || 2}`;

      return {
        id: `serp-hotel-${h.property_token || h.name}`,
        name: h.name,
        address: h.address,
        latitude: h.gps_coordinates?.latitude,
        longitude: h.gps_coordinates?.longitude,
        rating: h.overall_rating,
        reviewCount: h.reviews,
        stars: h.hotel_class,
        pricePerNight: h.rate_per_night?.extracted_lowest || (h.rate_per_night?.lowest ? parseFloat(h.rate_per_night.lowest.replace(/[^0-9.]/g, '')) : null),
        totalPrice: h.total_rate?.extracted_lowest || (h.total_rate?.lowest ? parseFloat(h.total_rate.lowest.replace(/[^0-9.]/g, '')) : null),
        amenities: h.amenities,
        images: h.images,
        checkIn: h.check_in_time,
        checkOut: h.check_out_time,
        bookingUrl, // Lien direct vers le site de l'hôtel (disponibilité garantie)
        dataSource: 'serpapi',
        propertyToken: h.property_token, // Pour récupérer les détails si besoin
      };
    });
  } catch (error) {
    console.error('[SerpAPI Hotels] Erreur:', error);
    return [];
  }
}

/**
 * Récupère la liste des noms d'hôtels DISPONIBLES via SerpAPI Google Hotels
 * Utilisé pour vérifier si les hôtels de RapidAPI sont vraiment disponibles
 */
export async function getAvailableHotelNames(
  destination: string,
  checkInDate: string,
  checkOutDate: string,
  adults: number = 2
): Promise<Set<string>> {
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI] Clé non configurée - skip vérification disponibilité');
    return new Set(); // Retourne un set vide = on ne peut pas vérifier
  }

  const params = new URLSearchParams({
    api_key: getSerpApiKey()!,
    engine: 'google_hotels',
    q: destination,
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    adults: adults.toString(),
    currency: 'EUR',
    hl: 'fr',
    gl: 'fr',
  });

  try {
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI] Erreur HTTP:', response.status);
      return new Set();
    }

    const data = await response.json();

    if (data.error) {
      console.error('[SerpAPI] Erreur:', data.error);
      return new Set();
    }

    const properties = data.properties || [];

    // Récupérer les noms des hôtels qui ont un prix (= disponibles)
    const availableNames = new Set<string>();
    properties.forEach((h: any) => {
      const hasPrice = h.rate_per_night?.lowest || h.total_rate?.lowest;
      if (hasPrice && h.name) {
        // Normaliser le nom pour la comparaison
        const normalizedName = h.name.toLowerCase().trim();
        availableNames.add(normalizedName);
      }
    });

    return availableNames;
  } catch (error) {
    console.error('[SerpAPI] Erreur vérification disponibilité:', error);
    return new Set();
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
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI Attractions] SERPAPI_KEY non configurée');
    return [];
  }

  const { type, limit = 10 } = options;

  // Obtenir le code pays pour precision
  const countryCode = getCountryCode(destination);
  const countryName = getCountryName(countryCode);

  // Construire une query plus precise avec le pays
  const locationQuery = countryName ? `${destination}, ${countryName}` : destination;
  const query = type
    ? `${type} ${locationQuery}`
    : `tourist attractions ${locationQuery}`;

  const params = new URLSearchParams({
    api_key: getSerpApiKey()!,
    engine: 'google_local',
    q: query,
    location: locationQuery,
    hl: 'fr',
    gl: countryCode,
  });

  try {
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
  return !!getSerpApiKey();
}

// === Constantes de qualité ===

export const QUALITY_THRESHOLDS = {
  attractions: {
    major:  { minRating: 4.0, minReviews: 300 },
    medium: { minRating: 3.8, minReviews: 100 },
    small:  { minRating: 3.5, minReviews: 30 },
  },
  restaurants: { minRating: 4.0, minReviews: 80, maxDistanceMeters: 800 },
};

// === Requêtes thématiques pour attractions (adaptatives) ===

/**
 * Génère des requêtes SerpAPI adaptatives selon la destination et les préférences utilisateur.
 * Les requêtes varient selon l'archétype de la destination (plage, culture, nature...)
 * et les activités choisies par l'utilisateur.
 */
function getAdaptiveQueries(
  destination: string,
  activities?: ActivityType[]
): { query: string; priority: number }[] {
  const base = [
    // Incontournables (toujours inclus)
    { query: 'top tourist attractions must see landmarks', priority: 1 },
    // Culture & histoire
    { query: 'best museums art galleries historical sites', priority: 2 },
    // Vues & marchés
    { query: 'famous viewpoints markets food streets', priority: 2 },
  ];

  const archetypes = getDestinationArchetypes(destination);

  // Requête temples/églises UNIQUEMENT pour destinations culturelles/religieuses
  const religiousCities = ['rome', 'istanbul', 'kyoto', 'bangkok', 'jerusalem', 'bali', 'varanasi', 'cairo', 'seville', 'florence'];
  if (religiousCities.some(c => destination.toLowerCase().includes(c)) || archetypes.includes('cultural')) {
    base.push({ query: 'famous temples shrines churches monuments', priority: 2 });
  }

  // Queries adaptatives selon archétype destination + préférences utilisateur
  if (archetypes.includes('beach') || activities?.includes('beach')) {
    base.push({ query: 'best beaches swimming spots coastal walks seaside', priority: 2 });
  }
  if (activities?.includes('nature') || archetypes.includes('nature')) {
    base.push({ query: 'parks gardens botanical hiking trails nature reserves', priority: 2 });
  }
  if (activities?.includes('nightlife') || archetypes.includes('nightlife')) {
    base.push({ query: 'best nightlife areas rooftop bars evening entertainment districts', priority: 3 });
  }
  if (activities?.includes('gastronomy') || archetypes.includes('gastronomy')) {
    base.push({ query: 'food markets street food districts local cuisine neighborhoods', priority: 2 });
  }
  if (activities?.includes('adventure') || archetypes.includes('adventure')) {
    base.push({ query: 'outdoor activities water sports adventure experiences', priority: 2 });
  }
  if (activities?.includes('wellness') || archetypes.includes('wellness')) {
    base.push({ query: 'spas thermal baths wellness retreats hot springs', priority: 3 });
  }
  if (activities?.includes('shopping')) {
    base.push({ query: 'best shopping districts markets boutiques local crafts', priority: 3 });
  }

  return base;
}

// Fallback statique (si aucune activité fournie)
const ATTRACTION_QUERIES = [
  { query: 'top tourist attractions must see landmarks', priority: 1 },
  { query: 'best museums art galleries historical sites', priority: 2 },
  { query: 'famous viewpoints markets food streets', priority: 2 },
];

// Types non-touristiques à exclure
const NON_TOURISTIC_TYPES = new Set([
  'movie_theater', 'cinema', 'gym', 'fitness_center',
  'bowling_alley', 'arcade', 'event_venue', 'convention_center',
  'concert_hall', 'performing_arts_theater', 'theater', 'theatre',
  'stadium', 'sports_complex', 'arena', 'music_venue',
  'apartment_building', 'residential', 'office', 'bank',
  'hospital', 'dentist', 'car_dealer', 'gas_station',
  'laundry', 'storage', 'parking', 'car_rental',
  'night_club', 'bar',
  // Restaurants ne sont PAS des attractions — ils appartiennent au système de repas
  'restaurant', 'food', 'meal_delivery', 'meal_takeaway',
  'cafe', 'coffee_shop', 'bakery', 'ice_cream_shop',
  'fast_food_restaurant', 'pizza_restaurant', 'seafood_restaurant',
  'chinese_restaurant', 'japanese_restaurant', 'indian_restaurant',
  'italian_restaurant', 'french_restaurant', 'thai_restaurant',
  'vietnamese_restaurant', 'mexican_restaurant', 'korean_restaurant',
  'steak_house', 'sushi_restaurant', 'ramen_restaurant',
  'brunch_restaurant', 'breakfast_restaurant',
]);

const NON_TOURISTIC_NAME_KEYWORDS = [
  'cinema', 'cinéma', 'movie', 'toho', 'imax',
  'gym', 'fitness', 'bowling', 'arcade', 'gaming', 'taito station',
  'tower apartment', 'residence', 'office', 'マンション',
  'nhk hall', 'line cube', 'gymnasium', 'arena', 'stadium',
  // Concert halls, theaters - on ne "visite" pas ces lieux sans spectacle
  'concert hall', 'concertgebouw', 'philharmonic', 'philharmonie',
  'opera house', 'opéra', 'theater ', 'theatre ', 'théâtre',
  'music hall', 'concert venue', 'performing arts', 'auditorium',
  'amphitheater', 'amphithéâtre', 'beurs van berlage',
  // Amsterdam specific venues
  'ziggo dome', 'heineken music hall', 'carré', 'muziekgebouw',
  'melkweg', 'paradiso', 'bimhuis',
  // Photo spots - not real attractions, just photo opportunities
  'photo spot', 'photo point', 'instagram spot', 'selfie spot',
  'i amsterdam', 'iamsterdam', ' letters', ' sign',
  'don quijote', 'donki', 'uniqlo', 'daiso',
  // Educational institutions (not tourist attractions)
  'college', 'collège', 'university', 'università', 'lycée', 'school', 'école', 'scuola',
  'faculty', 'faculté', 'facoltà', 'institute', 'istituto', 'akademie',
  // Street food / fast food places (belong to meal system, not attractions)
  'street food', 'fast food', 'kebab', 'mortadella', 'panini shop', 'piadineria',
  'friggitoria', 'supplizio', 'rosticceria', 'focacceria', 'gelateria',
  // Supermarkets/grocery (not tourist attractions)
  'conad', 'carrefour', 'lidl', 'aldi', 'esselunga', 'coop ', 'pam ', 'despar',
  'simply', 'eurospin', 'penny', 'spar', 'albert heijn', 'tesco', 'sainsbury',
  'supermarket', 'supermarché', 'supermercato', 'grocery',
  // Restaurants & food establishments (ne sont pas des attractions)
  'restaurant', 'ristorante', 'restaurante', 'restoran',
  'bistrot', 'bistro', 'brasserie', 'trattoria', 'osteria', 'taverna',
  'pizzeria', 'steakhouse', 'grill house', 'burger', 'sushi bar',
  'pancake', 'brunch', 'diner', 'food court', 'foodhall',
  'café restaurant', 'wine bar', 'tapas bar', 'ramen',
  'brouwerij', 'brewery', 'pub ', 'beer hall',
  'little buddha', 'le petit chef', 'blin queen', 'blini',
  // Tourist traps
  'madame tussauds', 'tussaud', 'hard rock cafe', 'hard rock café',
  'planet hollywood', 'rainforest cafe', 'rainforest café', 'bubba gump',
  'wax museum', 'musée de cire', 'selfie museum', 'trick eye',
  "ripley's", 'believe it or not',
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
    activities?: ActivityType[];
    limit?: number;
  } = {}
): Promise<Attraction[]> {
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI Attractions Multi] SERPAPI_KEY non configurée');
    return [];
  }

  const { limit = 50 } = options;

  // Vérifier le cache
  const cacheKey = getAttractionsCacheKey(destination, cityCenter);
  const cached = readAttractionsCache(cacheKey);
  if (cached) {
    return cached.slice(0, limit);
  }

  const allAttractions: Map<string, Attraction & { priority: number }> = new Map();
  const countryCode = getCountryCode(destination);

  // Utiliser les requêtes adaptatives si activités fournies, sinon le fallback statique
  const queries = options.activities
    ? getAdaptiveQueries(destination, options.activities)
    : ATTRACTION_QUERIES;

  // Exécuter les requêtes en parallèle pour optimiser le temps
  const promises = queries.map(async ({ query, priority }) => {
    const params = new URLSearchParams({
      api_key: getSerpApiKey()!,
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
      // Filtrage qualité (seuils adaptatifs selon la taille de la destination)
      if (!meetsAttractionQualityThreshold(place, destination)) continue;

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
    .sort((a, b) => a.priority - b.priority || (b.rating || 0) - (a.rating || 0));

  // Déduplication par proximité GPS: si 2 attractions sont à < 150m et partagent un mot commun (>3 chars), garder la mieux notée
  const deduped: typeof sorted = [];
  for (const attr of sorted) {
    const isDuplicate = deduped.some(existing => {
      if (!attr.latitude || !existing.latitude) return false;
      // Distance approximative en km (Haversine simplifié)
      const dLat = (attr.latitude - existing.latitude) * 111;
      const dLng = (attr.longitude - existing.longitude) * 111 * Math.cos(attr.latitude * Math.PI / 180);
      const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distKm > 0.15) return false; // > 150m = pas un doublon
      // Vérifier un mot commun significatif (>3 chars)
      const wordsA = attr.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const wordsB = existing.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return wordsA.some(w => wordsB.includes(w));
    });
    if (!isDuplicate) {
      deduped.push(attr);
    }
  }

  // Diversification par ActivityType :
  // - Chaque type ne peut pas dépasser 30% du total
  // - Exception : attractions très populaires (>5000 reviews ET rating >= 4.6) passent toujours
  const maxPerType = Math.max(3, Math.ceil(deduped.length * 0.3));
  const typeCounts: Record<string, number> = {};
  const diversified = deduped.filter(attr => {
    const t = attr.type;
    const reviews = attr.reviewCount || 0;
    const rating = attr.rating || 0;

    // Laisser passer les incontournables
    if (reviews > 5000 && rating >= 4.6) {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      return true;
    }

    typeCounts[t] = (typeCounts[t] || 0) + 1;
    if (typeCounts[t] > maxPerType) {
      return false;
    }
    return true;
  });

  const limited = diversified.slice(0, limit);

  // Don't auto-tag SerpAPI results as mustSee — this causes false positives
  // (e.g., "Barcelona Segwayday" blocking real must-sees like Sagrada Família).
  // Must-see tagging should only come from: user preferences, curated database, or Overpass/Wikidata.
  const finalAttractions = limited.map((attr) => {
    const { priority, ...attraction } = attr;
    return {
      ...attraction,
      mustSee: false,
    };
  });

  // Sauvegarder en cache
  writeAttractionsCache(cacheKey, finalAttractions);

  return finalAttractions;
}

/**
 * Recherche spécifique des mustSee par nom exact via SerpAPI Google Maps
 */
export async function searchMustSeeAttractions(
  mustSee: string,
  destination: string,
  cityCenter: { lat: number; lng: number },
): Promise<Attraction[]> {
  if (!getSerpApiKey() || !mustSee.trim()) return [];

  // Split by comma, then expand "&" / "et" into separate items
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
  const countryCode = getCountryCode(destination);
  const results: Attraction[] = [];

  const promises = items.map(async (item) => {
    const params = new URLSearchParams({
      api_key: getSerpApiKey()!,
      engine: 'google_maps',
      q: `${item} ${destination}`,
      ll: `@${cityCenter.lat},${cityCenter.lng},14z`,
      hl: 'fr',
      gl: countryCode,
    });

    try {
      const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);
      if (!response.ok) return null;

      const data = await response.json();
      const places: SerpApiLocalResult[] = data.local_results || [];

      // Prendre le premier résultat (le plus pertinent pour une recherche par nom)
      if (places.length > 0 && places[0].gps_coordinates) {
        const attraction = convertToAttraction(places[0], destination, 0);
        if (attraction) {
          attraction.mustSee = true;
          return attraction;
        }
      }
      // Retry avec 1 variante (économie SerpAPI: 1 retry au lieu de 2)
      const variants = [
        `${item} attraction ${destination}`,
      ];
      for (const variant of variants) {
        try {
          const retryParams = new URLSearchParams({
            api_key: getSerpApiKey()!,
            engine: 'google_maps',
            q: variant,
            ll: `@${cityCenter.lat},${cityCenter.lng},14z`,
            hl: 'fr',
            gl: countryCode,
          });
          const retryResponse = await fetch(`${SERPAPI_BASE_URL}?${retryParams}`);
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            const retryPlaces: SerpApiLocalResult[] = retryData.local_results || [];
            if (retryPlaces.length > 0 && retryPlaces[0].gps_coordinates) {
              const retryAttraction = convertToAttraction(retryPlaces[0], destination, 0);
              if (retryAttraction) {
                retryAttraction.mustSee = true;
                return retryAttraction;
              }
            }
          }
        } catch { /* ignore retry errors */ }
      }
      return null;
    } catch (error) {
      console.error(`[SerpAPI MustSee] Erreur pour "${item}":`, error);
      return null;
    }
  });

  const found = await Promise.all(promises);
  for (const attr of found) {
    if (attr) results.push(attr);
  }

  return results;
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
  if (!getSerpApiKey()) {
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

  // Construire la requête selon le type de repas + langue locale
  const countryCode = getCountryCode(destination);
  let query: string;
  switch (mealType) {
    case 'breakfast': {
      const breakfastQueries: Record<string, string> = {
        fr: 'café boulangerie petit déjeuner',
        es: 'cafetería desayuno',
        it: 'caffè colazione',
        pt: 'café padaria',
      };
      query = breakfastQueries[countryCode] || 'breakfast brunch café bakery';
      break;
    }
    case 'dinner':
      query = 'restaurant dinner';
      break;
    default:
      query = 'restaurant lunch';
  }

  // Zoom 16z = ~300m de rayon, parfait pour proximité
  const params = new URLSearchParams({
    api_key: getSerpApiKey()!,
    engine: 'google_maps',
    q: query,
    ll: `@${activityCoords.lat},${activityCoords.lng},16z`,
    hl: 'fr',
    gl: getCountryCode(destination),
  });

  try {
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
        photos: place.thumbnail ? [place.thumbnail] : undefined,
        openingHours: parseOpeningHours(place.operating_hours) || {},
        distance: distanceKm,
        walkingTime: Math.round(distanceMeters / 80), // ~80m/min de marche
      });
    }

    // Trier par distance
    restaurants.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    return restaurants.slice(0, limit);
  } catch (error) {
    console.error('[SerpAPI Restaurants Nearby] Erreur:', error);
    return [];
  }
}

// ============================================
// Grocery Store Search
// ============================================

export interface GroceryStore {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviewCount: number;
  distance?: number; // km
  walkingTime?: number; // minutes
  googleMapsUrl: string;
  openingHours?: Record<string, { open: string; close: string } | null>;
}

/**
 * Recherche un supermarché/épicerie proche d'une position (logement typiquement)
 */
export async function searchGroceryStores(
  coords: { lat: number; lng: number },
  destination: string,
  options: {
    maxDistance?: number; // mètres, défaut 800
    limit?: number;
  } = {}
): Promise<GroceryStore[]> {
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI Grocery] SERPAPI_KEY non configurée');
    return [];
  }

  const { maxDistance = 800, limit = 3 } = options;

  const countryCode = getCountryCode(destination);
  // Query adaptée à la langue locale
  const queryMap: Record<string, string> = {
    fr: 'supermarché épicerie',
    es: 'supermercado',
    it: 'supermercato',
    pt: 'supermercado',
    de: 'supermarkt',
    nl: 'supermarkt',
  };
  const query = queryMap[countryCode] || 'supermarket grocery store';

  const params = new URLSearchParams({
    api_key: getSerpApiKey()!,
    engine: 'google_maps',
    q: query,
    ll: `@${coords.lat},${coords.lng},15z`,
    hl: 'fr',
    gl: countryCode,
  });

  try {
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI Grocery] Erreur HTTP:', response.status);
      return [];
    }

    const data = await response.json();
    if (data.error) {
      console.error('[SerpAPI Grocery] Erreur:', data.error);
      return [];
    }

    const results = data.local_results || [];
    const stores: GroceryStore[] = [];

    for (const place of results) {
      if (!place.gps_coordinates?.latitude || !place.gps_coordinates?.longitude) continue;

      const distanceKm = calculateDistance(
        coords.lat, coords.lng,
        place.gps_coordinates.latitude, place.gps_coordinates.longitude
      );
      const distanceMeters = Math.round(distanceKm * 1000);

      if (distanceMeters > maxDistance) continue;

      const searchQuery = place.address
        ? `${place.title}, ${place.address}`
        : `${place.title}, ${destination}`;

      stores.push({
        id: `serp-grocery-${place.place_id || place.data_cid || stores.length}`,
        name: place.title,
        address: place.address || 'Adresse non disponible',
        latitude: place.gps_coordinates.latitude,
        longitude: place.gps_coordinates.longitude,
        rating: place.rating || 0,
        reviewCount: place.reviews || 0,
        distance: distanceKm,
        walkingTime: Math.round(distanceMeters / 80),
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`,
        openingHours: parseOpeningHours(place.operating_hours) || undefined,
      });
    }

    stores.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    return stores.slice(0, limit);
  } catch (error) {
    console.error('[SerpAPI Grocery] Erreur:', error);
    return [];
  }
}

/**
 * Geocode un lieu spécifique via SerpAPI Google Maps (payant, dernier recours)
 * Utilisé par coordsResolver.ts quand toutes les APIs gratuites ont échoué
 *
 * Coût: ~$0.01 par appel (quota SerpAPI)
 */
export async function geocodeViaSerpApi(
  placeName: string,
  city: string,
  nearbyCoords?: { lat: number; lng: number },
): Promise<{ lat: number; lng: number; address?: string; operatingHours?: Record<string, string> } | null> {
  if (!getSerpApiKey() || !placeName.trim()) return null;

  const countryCode = getCountryCode(city);
  const query = `${placeName} ${city}`;

  const params = new URLSearchParams({
    api_key: getSerpApiKey()!,
    engine: 'google_maps',
    q: query,
    hl: 'fr',
    gl: countryCode,
  });

  // Si on a des coordonnées de référence, centrer la recherche
  if (nearbyCoords) {
    params.set('ll', `@${nearbyCoords.lat},${nearbyCoords.lng},14z`);
  }

  try {
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);
    if (!response.ok) {
      console.warn(`[SerpAPI Geocode] HTTP ${response.status} pour "${query}"`);
      return null;
    }

    const data = await response.json();
    const places: SerpApiLocalResult[] = data.local_results || [];

    if (places.length > 0 && places[0].gps_coordinates) {
      const result = {
        lat: places[0].gps_coordinates.latitude,
        lng: places[0].gps_coordinates.longitude,
        address: places[0].address,
        operatingHours: places[0].operating_hours,
      };
      return result;
    }

    return null;
  } catch (error) {
    console.error(`[SerpAPI Geocode] Erreur pour "${query}":`, error);
    return null;
  }
}

/**
 * Vérifie si une attraction répond aux critères de qualité
 */
function meetsAttractionQualityThreshold(place: SerpApiLocalResult, destination?: string): boolean {
  const destSize = destination ? getDestinationSize(destination) : 'major';
  const { minRating, minReviews } = QUALITY_THRESHOLDS.attractions[destSize];

  // Exclure les types non-touristiques
  const allTypes = [place.type, ...(place.types || []), ...(place.type_ids || [])].filter(Boolean).map(t => t!.toLowerCase());
  for (const t of allTypes) {
    if (NON_TOURISTIC_TYPES.has(t)) {
      return false;
    }
  }

  // Exclure les restaurants par type SerpAPI (souvent "Restaurant" ou contient "restaurant")
  for (const t of allTypes) {
    if (t.includes('restaurant') || t.includes('food') || t.includes('cafe') || t.includes('coffee') || t.includes('bakery') || t.includes('bar') || t.includes('pub')) {
      return false;
    }
  }

  // Exclure par nom (heuristique)
  const nameLower = place.title.toLowerCase();
  for (const keyword of NON_TOURISTIC_NAME_KEYWORDS) {
    if (nameLower.includes(keyword)) {
      return false;
    }
  }

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
    estimatedCost: estimateCost(place.price, destination, place.title),
    latitude: place.gps_coordinates.latitude,
    longitude: place.gps_coordinates.longitude,
    rating: place.rating || 4.0,
    mustSee: false, // Don't auto-tag SerpAPI results — must-see from user prefs only
    bookingRequired: false,
    openingHours: place.operating_hours ? parseSimpleOpeningHours(place.operating_hours) || { open: '09:00', close: '18:00' } : { open: '09:00', close: '18:00' },
    tips: place.description,
    dataReliability: 'verified' as const,
    googleMapsUrl: place.website || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.title + ', ' + destination)}`,
    imageUrl: place.thumbnail,
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
 * Patterns pour les attractions gratuites par nature (espaces publics, fontaines, places, etc.)
 */
const FREE_ATTRACTION_PATTERNS = /\b(fontaine|fountain|fontana|fuente|piazza|place|plaza|square|platz|pont|bridge|puente|brücke|viewpoint|panorama|belvedere|mirador|promenade|boulevard|quartier|quarter|barrio|viertel|trastevere|steps|escalier|scalinata|crossing|carrefour|campo|rambla|passeig|via|viale|corso|calle|rue|strasse|straße|street|road|lane|alley|ruelle|vicolo|passage|paseo|avenida)\b/i;

const FREE_KNOWN_LANDMARKS: Record<string, boolean> = {
  'fontaine de trevi': true, 'trevi fountain': true, 'fontana di trevi': true,
  'pantheon': true, 'panthéon': true,
  'piazza navona': true, 'piazza di spagna': true, 'spanish steps': true,
  'piazza san marco': true, 'place saint-marc': true,
  'trastevere': true, 'quartier du trastevere': true,
  'campo de\' fiori': true, 'campo de fiori': true,
  'champs-élysées': true, 'champs elysees': true,
  'puerta del sol': true, 'gran vía': true, 'gran via': true,
  'piccadilly circus': true, 'trafalgar square': true,
  'dam square': true, 'museumplein': true, 'vondelpark': true,
  'jordaan': true, 'quartier du jordaan': true, 'oosterpark': true,
  'shibuya crossing': true, 'times square': true,
  'brooklyn bridge': true, 'high line': true, 'central park': true,
  'arc de triomphe du carrousel': true,
  'piazza del popolo': true, 'capitole': true,
  'janicule': true, 'gianicolo': true,
  'via dei coronari': true, 'via del corso': true,
  'via condotti': true, 'via appia antica': true, 'appian way': true,
};

/**
 * Estime le coût selon le niveau de prix, ajusté au coût de la vie local
 * Détecte les attractions gratuites (fontaines, places, espaces publics) pour retourner 0
 */
function estimateCost(price?: string, destination?: string, placeName?: string): number {
  // Vérifier si l'attraction est connue comme gratuite
  if (placeName) {
    const nameLower = placeName.toLowerCase().trim();
    if (FREE_KNOWN_LANDMARKS[nameLower]) return 0;
    // Vérifier aussi sans accents
    const nameNormalized = nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const landmark of Object.keys(FREE_KNOWN_LANDMARKS)) {
      const landmarkNorm = landmark.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (nameNormalized === landmarkNorm || nameNormalized.includes(landmarkNorm) || landmarkNorm.includes(nameNormalized)) return 0;
    }
    // Vérifier les patterns d'attractions gratuites
    if (FREE_ATTRACTION_PATTERNS.test(nameLower)) return 0;
  }

  if (!price) return Math.round(15 * getCostMultiplier(destination || ''));
  const level = parsePriceLevel(price);
  const baseCosts: Record<number, number> = { 1: 10, 2: 20, 3: 35, 4: 50 };
  const baseCost = baseCosts[level] || 15;
  return Math.round(baseCost * getCostMultiplier(destination || ''));
}

/**
 * Parse les horaires d'ouverture en format simple
 */
export function parseSimpleOpeningHours(hours: Record<string, string>): { open: string; close: string } | undefined {
  // Prendre le premier jour avec des horaires
  for (const value of Object.values(hours)) {
    if (value && !value.toLowerCase().includes('fermé') && !value.toLowerCase().includes('closed')) {
      // Match formats: "9:00 AM – 5:00 PM", "09:00–17:00", "9 AM – 5 PM"
      const match = value.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (match) {
        let openH = parseInt(match[1]);
        const openM = match[2] || '00';
        const openAmPm = match[3];
        let closeH = parseInt(match[4]);
        const closeM = match[5] || '00';
        const closeAmPm = match[6];

        // Convert AM/PM to 24h
        if (openAmPm?.toUpperCase() === 'PM' && openH < 12) openH += 12;
        if (openAmPm?.toUpperCase() === 'AM' && openH === 12) openH = 0;
        if (closeAmPm?.toUpperCase() === 'PM' && closeH < 12) closeH += 12;
        if (closeAmPm?.toUpperCase() === 'AM' && closeH === 12) closeH = 0;

        return {
          open: `${String(openH).padStart(2, '0')}:${openM}`,
          close: `${String(closeH).padStart(2, '0')}:${closeM}`,
        };
      }
    }
  }
  return { open: '09:00', close: '18:00' }; // Défaut
}

// === Fonctions utilitaires ===

function getCountryCode(destination: string): string {
  const dest = destination.toLowerCase();
  const destNorm = dest.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalized = `${dest} ${destNorm}`;

  // If the user already provided an ISO-like country suffix, honor it.
  const isoMatch = normalized.match(/(?:,\s*|\s+)([a-z]{2})\s*$/i);
  if (isoMatch) {
    const code = isoMatch[1].toLowerCase();
    if (code.length === 2) return code;
  }

  if (['barcelona', 'madrid', 'sevilla', 'valencia', 'malaga'].some(c => normalized.includes(c))) return 'es';
  if (['paris', 'lyon', 'marseille', 'nice', 'bordeaux', 'angers', 'nantes', 'toulouse'].some(c => normalized.includes(c))) return 'fr';
  if (['rome', 'florence', 'venice', 'milan', 'naples', 'roma', 'firenze', 'venezia', 'milano', 'napoli'].some(c => normalized.includes(c))) return 'it';
  if (['lisbon', 'porto', 'lisbonne'].some(c => normalized.includes(c))) return 'pt';
  if (['london', 'manchester', 'edinburgh', 'londres'].some(c => normalized.includes(c))) return 'uk';
  if (['berlin', 'munich', 'frankfurt'].some(c => normalized.includes(c))) return 'de';
  if (['amsterdam', 'rotterdam'].some(c => normalized.includes(c))) return 'nl';
  if (['brussels', 'bruges', 'bruxelles'].some(c => normalized.includes(c))) return 'be';
  if (['athens', 'santorini', 'athenes'].some(c => normalized.includes(c))) return 'gr';
  if (['tokyo', 'kyoto', 'osaka'].some(c => normalized.includes(c))) return 'jp';
  // Chine - IMPORTANT: Pekin/Beijing
  if (['beijing', 'pekin', 'shanghai', 'hong kong', 'guangzhou', 'shenzhen', 'xian', "xi'an", 'chengdu'].some(c => normalized.includes(c))) return 'cn';
  // Autres pays asiatiques
  if (['bangkok', 'phuket', 'chiang mai'].some(c => normalized.includes(c))) return 'th';
  if (['singapore', 'singapour'].some(c => normalized.includes(c))) return 'sg';
  if (['bali', 'jakarta'].some(c => normalized.includes(c))) return 'id';
  if (['hanoi', 'ho chi minh', 'saigon'].some(c => normalized.includes(c))) return 'vn';
  if (['seoul'].some(c => normalized.includes(c))) return 'kr';
  // Amerique
  if (['new york', 'los angeles', 'san francisco', 'miami', 'las vegas', 'chicago'].some(c => normalized.includes(c))) return 'us';
  if (['toronto', 'montreal', 'vancouver', 'ottawa'].some(c => normalized.includes(c))) return 'ca';
  if (['mexico city', 'ciudad de mexico', 'cancun'].some(c => normalized.includes(c))) return 'mx';
  if (['rio de janeiro', 'sao paulo', 'são paulo'].some(c => normalized.includes(c))) return 'br';
  if (['buenos aires'].some(c => normalized.includes(c))) return 'ar';
  // Moyen-Orient
  if (['dubai', 'abu dhabi'].some(c => normalized.includes(c))) return 'ae';
  if (['marrakech', 'casablanca', 'fes', 'rabat'].some(c => normalized.includes(c))) return 'ma';
  if (['istanbul', 'ankara'].some(c => normalized.includes(c))) return 'tr';
  if (['tel aviv', 'jerusalem'].some(c => normalized.includes(c))) return 'il';
  // Oceanie
  if (['sydney', 'melbourne', 'brisbane'].some(c => normalized.includes(c))) return 'au';
  if (['auckland', 'wellington'].some(c => normalized.includes(c))) return 'nz';

  // Explicit country names in destination string.
  const countryHints: Array<{ code: string; tokens: string[] }> = [
    { code: 'fr', tokens: ['france'] },
    { code: 'es', tokens: ['spain', 'espagne'] },
    { code: 'it', tokens: ['italy', 'italie'] },
    { code: 'de', tokens: ['germany', 'allemagne'] },
    { code: 'uk', tokens: ['united kingdom', 'royaume-uni', 'great britain', 'england'] },
    { code: 'us', tokens: ['united states', 'usa', 'etats-unis', 'états-unis'] },
    { code: 'ca', tokens: ['canada'] },
    { code: 'jp', tokens: ['japan', 'japon'] },
    { code: 'cn', tokens: ['china', 'chine'] },
    { code: 'au', tokens: ['australia', 'australie'] },
  ];
  for (const hint of countryHints) {
    if (hint.tokens.some(t => normalized.includes(t))) return hint.code;
  }

  // Neutral fallback for unknown destinations (instead of forcing France).
  return 'us';
}

// Convertit le code pays en nom de pays pour les queries
function getCountryName(countryCode: string): string {
  const countryNames: Record<string, string> = {
    'es': 'Spain',
    'fr': 'France',
    'it': 'Italy',
    'pt': 'Portugal',
    'uk': 'United Kingdom',
    'de': 'Germany',
    'nl': 'Netherlands',
    'be': 'Belgium',
    'gr': 'Greece',
    'jp': 'Japan',
    'cn': 'China',
    'th': 'Thailand',
    'sg': 'Singapore',
    'id': 'Indonesia',
    'vn': 'Vietnam',
    'kr': 'South Korea',
    'us': 'USA',
    'ae': 'UAE',
    'ma': 'Morocco',
    'au': 'Australia',
  };
  return countryNames[countryCode] || '';
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

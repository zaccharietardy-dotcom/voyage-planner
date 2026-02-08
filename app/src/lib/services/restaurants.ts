/**
 * Service de recherche de restaurants
 *
 * Chaîne de priorité:
 * 0. Base de données locale (données vérifiées < 30 jours)
 * 1. Gemini + Google Search (grounding - données vérifiées, GRATUIT 500-1500 req/jour) ✅ PRIORITÉ
 * 2. TripAdvisor (données riches, Michelin) ✅
 * 3. SerpAPI Google Local (RÉELS, 100 req/mois gratuit) ✅
 * 4. Google Places API (si configuré)
 * 5. OpenStreetMap Overpass API
 * 6. Restaurants locaux générés (fallback hardcodé)
 *
 * NOTE: Gemini grounding est gratuit (500-1500 req/jour) et vérifie sur Google Maps.
 * SerpAPI coûte $0.01/req. On priorise Gemini pour réduire les coûts.
 */

import { Restaurant, DietaryType } from '../types';
import { calculateDistance, estimateTravelTime } from './geocoding';
import { validateRestaurantCuisine, filterRestaurantsByCuisine } from './cuisineValidator';
import { searchRestaurants as searchFoursquareRestaurants, foursquareToRestaurant, isFoursquareConfigured } from './foursquare';
import { searchRestaurantsWithSerpApi, searchRestaurantsNearby, isSerpApiPlacesConfigured, QUALITY_THRESHOLDS } from './serpApiPlaces';
import { searchPlacesFromDB, savePlacesToDB, isDataFresh, type PlaceData } from './placeDatabase';
import { searchTripAdvisorRestaurants, isTripAdvisorConfigured } from './tripadvisor';
import { searchRestaurantsWithGemini } from './geminiSearch';

// Configuration optionnelle Google Places
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

/**
 * Construit une URL de réservation pour un restaurant
 * Priorité: TheFork (Europe) > Google Maps
 */
function buildReservationUrl(restaurantName: string, city: string): string {
  // TheFork couvre la majorité de l'Europe (France, Espagne, Italie, Portugal, etc.)
  const searchQuery = `${restaurantName} ${city}`;
  return `https://www.thefork.fr/search?q=${encodeURIComponent(searchQuery)}`;
}

/**
 * Seuil minimum de notation pour les restaurants
 * Les restaurants avec une note inférieure ne seront pas suggérés
 * Note: les restaurants sans note (null/undefined) sont conservés (bénéfice du doute)
 */
export const MIN_RATING_THRESHOLD = 3.7;

// Liste des chaînes à éviter (utilisée pour filtrer les résultats OSM/Google)
// ÉTENDUE: Inclut les chaînes européennes et asiatiques
const CHAIN_RESTAURANTS = [
  // USA/International
  "mcdonald's", "mcdonalds", "burger king", "kfc", "subway", "domino's", "dominos",
  "pizza hut", "starbucks", "dunkin", "wendy's", "taco bell", "five guys",
  "papa john's", "little caesars", "chipotle", "panda express", "chick-fil-a",
  "popeyes", "sonic", "arby's", "jack in the box", "carl's jr", "hardee's",
  // France
  "quick", "paul", "brioche dorée", "class croute", "pomme de pain",
  "la mie caline", "columbus café", "flunch", "hippopotamus", "buffalo grill",
  "courtepaille", "léon de bruxelles", "del arte", "pizza del arte",
  // Espagne
  "café pans", "pans & company", "pans and company", "100 montaditos",
  "la sureña", "lizarran", "rodilla", "telepizza", "foster's hollywood",
  "vips", "ginos", "la tagliatella", "udon", "goiko",
  // Italie / Europe
  "vapiano", "nordsee", "febo", "wok to walk", "wagamama",
  // Boulangeries/Cafés chaînes
  "dots bakery", "dots coffee", "breadway", "costa coffee", "pret a manger",
  "café de flore", "le pain quotidien", "exki", "cojean",
  // Sushi/Asiatique chaînes (à éviter pour destinations européennes locales)
  "sushi shop", "planet sushi", "eat sushi", "sushi daily", "yo sushi",
  "itsu", "wasabi", "wok", "asia", "asian", "noodle", "ramen shop",
];

interface RestaurantSearchParams {
  latitude: number;
  longitude: number;
  radius?: number; // en mètres, défaut 1000
  dietary?: DietaryType[];
  priceLevel?: 1 | 2 | 3 | 4;
  cuisineTypes?: string[];
  mealType?: 'breakfast' | 'lunch' | 'dinner';
  limit?: number;
  destination?: string; // Nom de la ville pour la recherche AI
}

/**
 * Recherche des restaurants à proximité
 * Privilégie les restaurants locaux authentiques via Claude AI
 *
 * CHAÎNE DE PRIORITÉ:
 * 0. Base de données locale (données vérifiées < 30 jours)
 * 1. Gemini + Google Search grounding (gratuit 500-1500 req/jour, vérifié Google Maps)
 * 2. TripAdvisor (données riches, Michelin)
 * 3. SerpAPI Google Local ($0.01/req, 100 req/mois gratuit)
 * 4. Google Places API (si configuré)
 * 5. OpenStreetMap Overpass API
 * 6. Restaurants locaux générés (dernier recours)
 *
 * IMPORTANT: Le filtre par nom interdit (filterByForbiddenNames) est appliqué
 * à la fin de TOUTES les sources pour garantir qu'aucun restaurant chinois/asiatique
 * ne passe à travers en Espagne, etc.
 */
export async function searchRestaurants(params: RestaurantSearchParams): Promise<Restaurant[]> {
  const { latitude, longitude, radius = 1000, limit = 10, destination, mealType, dietary } = params;

  // Variable pour stocker le résultat final
  let finalRestaurants: Restaurant[] = [];

  // 0. PRIORITÉ MAXIMALE: Base de données locale (données vérifiées < 30 jours)
  if (destination) {
    try {
      const dbRestaurants = await searchPlacesFromDB({
        city: destination,
        type: 'restaurant',
        maxAgeDays: 30,
        limit: limit + 10,
      });

      if (dbRestaurants.length >= limit) {

        // Convertir PlaceData → Restaurant
        const restaurants = dbRestaurants.map(placeToRestaurant);

        // Appliquer les filtres
        let filtered = filterRestaurantsByCuisine(restaurants, destination, {
          strictMode: true,
          allowNonLocal: true,
        });
        filtered = filterByForbiddenNames(filtered, destination);

        if (filtered.length >= limit) {
          return applyFinalFilter(filtered, destination, limit, mealType, dietary);
        }
      }
    } catch (error) {
      console.warn('[Restaurants] Erreur base locale, fallback vers API:', error);
    }
  }

  // 1. PRIORITÉ: Gemini + Google Search (grounding gratuit, vérifié sur Google Maps)
  if (destination && process.env.GOOGLE_AI_API_KEY) {
    try {
      const geminiResults = await searchRestaurantsWithGemini(destination, {
        mealType: mealType || 'lunch',
        limit: limit + 5,
        cityCenter: { lat: latitude, lng: longitude },
      });
      if (geminiResults.length > 0) {
        // Sauvegarder en base locale pour cache
        try {
          const placesToSave = geminiResults.map(r => restaurantToPlace(r, destination));
          await savePlacesToDB(placesToSave, 'gemini');
        } catch (saveError) {
          console.warn('[Restaurants] Erreur sauvegarde Gemini en base:', saveError);
        }

        let filtered = filterOutChains(geminiResults);
        filtered = filterRestaurantsByCuisine(filtered, destination, { strictMode: true, allowNonLocal: true });
        filtered = filterByForbiddenNames(filtered, destination);

        if (filtered.length > 0) {
          finalRestaurants = filtered.slice(0, limit);
          return applyFinalFilter(finalRestaurants, destination, limit, mealType, dietary);
        }
      }
    } catch (error) {
      console.warn('[Restaurants] Gemini error, trying TripAdvisor:', error);
    }
  }

  // 2. FALLBACK: TripAdvisor (données RÉELLES, rating, cuisine, Michelin)
  if (destination && isTripAdvisorConfigured()) {
    try {
      const taRestaurants = await searchTripAdvisorRestaurants(destination, {
        limit: limit + 10,
      });

      if (taRestaurants.length > 0) {
        // Sauvegarder en base locale
        try {
          const placesToSave = taRestaurants.map(r => restaurantToPlace(r, destination));
          await savePlacesToDB(placesToSave, 'tripadvisor');
        } catch (saveError) {
          console.warn('[Restaurants] Erreur sauvegarde TripAdvisor en base:', saveError);
        }

        let filtered = filterRestaurantsByCuisine(taRestaurants, destination, {
          strictMode: true,
          allowNonLocal: true,
        });
        filtered = filterByForbiddenNames(filtered, destination);

        if (filtered.length > 0) {
          finalRestaurants = filtered.slice(0, limit);
          return applyFinalFilter(finalRestaurants, destination, limit, mealType, dietary);
        }
      }
    } catch (error) {
      console.warn('[Restaurants] TripAdvisor error, trying SerpAPI:', error);
    }
  }

  // 3. FALLBACK: SerpAPI Google Local (données RÉELLES vérifiées, 100 req/mois gratuit)
  if (destination && isSerpApiPlacesConfigured()) {
    try {
      const serpRestaurants = await searchRestaurantsWithSerpApi(destination, {
        mealType,
        limit: limit + 10, // Demander plus pour filtrer ensuite
      });

      if (serpRestaurants.length > 0) {
        // SAUVEGARDER EN BASE pour les prochaines requêtes
        try {
          const placesToSave = serpRestaurants.map(r => restaurantToPlace(r, destination));
          await savePlacesToDB(placesToSave, 'serpapi');
        } catch (saveError) {
          console.warn('[Restaurants] Erreur sauvegarde en base:', saveError);
        }

        // Filtrer les cuisines incohérentes avec la destination
        let filtered = filterRestaurantsByCuisine(serpRestaurants, destination, {
          strictMode: true,
          allowNonLocal: true,
        });
        // Filtrer par nom (ex: "Chino Peking")
        filtered = filterByForbiddenNames(filtered, destination);

        if (filtered.length > 0) {
          finalRestaurants = filtered.slice(0, limit);
          return applyFinalFilter(finalRestaurants, destination, limit, mealType, dietary);
        }
      }
    } catch (error) {
      console.warn('[Restaurants] SerpAPI error, trying alternatives:', error);
    }
  }

  // 4. Essayer Google Places si configuré
  if (GOOGLE_PLACES_API_KEY) {
    try {
      const googleResults = await searchWithGooglePlaces(params);
      // Filtrer les chaînes ET les cuisines incohérentes
      let filtered = filterOutChains(googleResults);
      if (destination) {
        filtered = filterRestaurantsByCuisine(filtered, destination, { strictMode: true, allowNonLocal: true });
        // NOUVEAU: Ajouter le filtre par nom pour Google Places aussi
        filtered = filterByForbiddenNames(filtered, destination);
      }
      if (filtered.length > 0) {
        finalRestaurants = filtered;
        // Appliquer le filtre final et retourner
        return applyFinalFilter(finalRestaurants, destination, limit, mealType, dietary);
      }
    } catch (error) {
      console.error('[Restaurants] Google Places error, falling back to OSM:', error);
    }
  }

  // 5. Utiliser OpenStreetMap (Overpass API)
  try {
    const osmResults = await searchWithOverpass(params);
    // Filtrer les chaînes ET les cuisines incohérentes
    let filtered = filterOutChains(osmResults);
    if (destination) {
      filtered = filterRestaurantsByCuisine(filtered, destination, { strictMode: true, allowNonLocal: true });
      // Filtrage supplémentaire par NOM (OSM peut avoir cuisineTypes vide)
      filtered = filterByForbiddenNames(filtered, destination);
    }
    if (filtered.length > 0) {
      finalRestaurants = filtered;
      // Appliquer le filtre final et retourner
      return applyFinalFilter(finalRestaurants, destination, limit, mealType, dietary);
    }
  } catch (error) {
    console.error('[Restaurants] Overpass error, using fallback:', error);
  }

  // 6. Fallback: générer des restaurants locaux typiques
  // IMPORTANT: generateLocalRestaurants doit UNIQUEMENT générer de la cuisine locale
  finalRestaurants = generateLocalRestaurants(params, destination);
  // Appliquer le filtre final même pour les restaurants générés (sécurité)
  return applyFinalFilter(finalRestaurants, destination, limit, mealType, dietary);
}

/**
 * Recherche des restaurants à proximité d'une activité
 * Utilise la recherche GPS pour garantir la cohérence géographique
 *
 * @param activityCoords Coordonnées GPS de l'activité
 * @param destination Nom de la ville
 * @param mealType Type de repas (breakfast, lunch, dinner)
 * @param options Options de filtrage
 * @returns Liste de restaurants triés par distance
 */
export async function searchRestaurantsNearActivity(
  activityCoords: { lat: number; lng: number },
  destination: string,
  mealType: 'breakfast' | 'lunch' | 'dinner' = 'lunch',
  options: {
    dietary?: DietaryType[];
    priceLevel?: 1 | 2 | 3 | 4;
    limit?: number;
  } = {}
): Promise<Restaurant[]> {
  const { limit = 3 } = options;

  // 1. Essayer Gemini grounded (gratuit, vérifié Google Maps)
  if (destination && process.env.GOOGLE_AI_API_KEY) {
    try {
      const geminiResults = await searchRestaurantsWithGemini(destination, {
        mealType,
        limit: limit + 5,
        cityCenter: { lat: activityCoords.lat, lng: activityCoords.lng },
      });
      if (geminiResults.length > 0) {
        let filtered = filterOutChains(geminiResults);
        filtered = filterRestaurantsByCuisine(filtered, destination, { strictMode: true, allowNonLocal: true });
        filtered = filterByForbiddenNames(filtered, destination);
        if (filtered.length > 0) {
          return applyFinalFilter(filtered, destination, limit, mealType, options.dietary);
        }
      }
    } catch (error) {
      console.warn('[Restaurants Nearby] Gemini error, trying SerpAPI:', error);
    }
  }

  // 2. Fallback: SerpAPI avec recherche GPS
  if (isSerpApiPlacesConfigured()) {
    try {
      const nearbyRestaurants = await searchRestaurantsNearby(activityCoords, destination, {
        mealType,
        maxDistance: QUALITY_THRESHOLDS.restaurants.maxDistanceMeters,
        minRating: QUALITY_THRESHOLDS.restaurants.minRating,
        minReviews: QUALITY_THRESHOLDS.restaurants.minReviews,
        limit: limit + 5, // Demander plus pour filtrer ensuite
      });

      if (nearbyRestaurants.length > 0) {
        // Appliquer les filtres de cuisine et de nom
        let filtered = filterRestaurantsByCuisine(nearbyRestaurants, destination, {
          strictMode: true,
          allowNonLocal: true,
        });
        filtered = filterByForbiddenNames(filtered, destination);

        if (filtered.length > 0) {
          return applyFinalFilter(filtered, destination, limit, mealType, options.dietary);
        }
      }
    } catch (error) {
      console.warn('[Restaurants Nearby] Erreur SerpAPI, fallback vers recherche standard:', error);
    }
  }

  // 2. Fallback: recherche standard avec coordonnées GPS
  return searchRestaurants({
    latitude: activityCoords.lat,
    longitude: activityCoords.lng,
    radius: 500, // 500m
    mealType,
    dietary: options.dietary,
    priceLevel: options.priceLevel,
    limit,
    destination,
  });
}

/**
 * Filtre les chaînes de restauration rapide
 */
function filterOutChains(restaurants: Restaurant[]): Restaurant[] {
  return restaurants.filter(r => {
    const nameLower = r.name.toLowerCase();
    return !CHAIN_RESTAURANTS.some(chain => nameLower.includes(chain));
  });
}

/**
 * Filtre les restaurants par note minimum (Bug #2)
 *
 * - Rejette les restaurants avec rating < MIN_RATING_THRESHOLD (3.7)
 * - Conserve les restaurants sans note (undefined/null) - bénéfice du doute
 * - Ne modifie pas les valeurs de rating
 *
 * @param restaurants Liste des restaurants à filtrer
 * @returns Liste filtrée avec uniquement les restaurants >= 3.7 ou sans note
 */
export function filterByRating(restaurants: Restaurant[]): Restaurant[] {
  return restaurants.filter(r => {
    // Conserver si pas de note (bénéfice du doute)
    if (r.rating === undefined || r.rating === null) {
      return true;
    }

    // Rejeter si note < 3.7
    if (r.rating < MIN_RATING_THRESHOLD) {
      console.warn(
        `[Restaurants] Rejeté: "${r.name}" - note ${r.rating} < ${MIN_RATING_THRESHOLD}`
      );
      return false;
    }

    return true;
  });
}

/**
 * Filtre les restaurants par mots-clés interdits dans le NOM
 * Utile quand OSM n'a pas de cuisineTypes mais le nom révèle la cuisine
 */
function filterByForbiddenNames(restaurants: Restaurant[], destination: string): Restaurant[] {
  const { getCountryFromDestination } = require('./cuisineValidator');

  // Mots-clés interdits par pays (dans le nom du restaurant)
  // IMPORTANT: Liste exhaustive incluant toutes les variantes possibles
  const FORBIDDEN_KEYWORDS: Record<string, string[]> = {
    // Garder UNIQUEMENT les vrais pièges à touristes et fast-food non-local
    // Les restaurants sushi/thai/indian bien notés peuvent être excellents même en Europe
    Spain: ['wok', 'kebab', 'döner', 'doner', 'pekin', 'peking', 'beijing', 'dim sum', 'chino express'],
    Italy: ['wok', 'kebab', 'döner', 'doner', 'pekin', 'peking', 'chino express'],
    France: ['burger king', 'mcdonald', 'kfc', 'subway', 'quick', 'five guys'],
    Portugal: ['wok', 'kebab', 'döner', 'doner', 'pekin', 'peking', 'chino express'],
    Greece: ['wok', 'kebab', 'pekin', 'peking', 'chino express'],
    Croatia: ['wok', 'kebab', 'pekin', 'peking', 'chino express'],
    Morocco: ['wok', 'pekin', 'peking', 'chino express'],
    Malta: ['wok', 'kebab', 'pekin', 'peking', 'chino express'],
    Turkey: ['wok', 'pekin', 'peking', 'chino express'],
    Cyprus: ['wok', 'kebab', 'pekin', 'peking', 'chino express'],
  };

  const country = getCountryFromDestination(destination);
  const forbiddenKeywords = country ? (FORBIDDEN_KEYWORDS[country] || []) : [];

  if (forbiddenKeywords.length === 0) return restaurants;

  return restaurants.filter(r => {
    const nameLower = r.name.toLowerCase();
    const isForbidden = forbiddenKeywords.some(keyword => nameLower.includes(keyword));
    if (isForbidden) {
      // Exception : restaurants très bien notés (authentiques et de qualité)
      if (r.rating && r.rating >= 4.5 && (r.reviewCount || 0) >= 200) {
        return true;
      }
    }
    return !isForbidden;
  });
}

/**
 * FILTRE FINAL DE SÉCURITÉ
 * Appliqué à la toute fin pour garantir qu'aucun restaurant inapproprié ne passe
 * C'est le dernier rempart avant de retourner les résultats à l'utilisateur
 *
 * Applique dans l'ordre:
 * 1. Filtre par note minimum (>= 3.7)
 * 2. Filtre par noms interdits (cuisine non locale)
 */
/**
 * Types de restaurants inappropriés pour certains repas
 * Pour le dîner: exclure les sandwicheries, coffee shops, fast-food, snacks
 * Ces établissements sont OK pour le petit-déjeuner ou le déjeuner rapide
 */
const INAPPROPRIATE_FOR_DINNER = [
  // Sandwicheries et fast-food
  'sandwich', 'sandwicherie', 'panini',
  'snack', 'quick', 'fast food', 'fast-food',
  'kebab', 'döner', 'doner', 'shawarma',

  // Cafés et coffee shops
  'coffee', 'café', 'cafe', 'coffeeshop', 'coffee shop',

  // Boulangeries et pâtisseries
  'bakery', 'boulangerie', 'patisserie', 'pâtisserie',
  'bagel', 'donut', 'doughnut',

  // Desserts
  'ice cream', 'glacier', 'gelato',

  // Boissons
  'juice', 'smoothie', 'bubble tea',

  // NOUVEAU: Établissements de petit-déjeuner/brunch
  'breakfast', 'brunch', 'pancake', 'waffle',

  // NOUVEAU: Chaînes bas de gamme (inappropriées pour "luxury")
  'prezzo', 'pizza hut', 'dominos', "domino's", 'papa john',
  'subway', "mcdonald", 'burger king', 'kfc',
];

/**
 * Filtre les restaurants inappropriés selon le type de repas
 * Pour le dîner: exclure sandwicheries, coffee shops, etc.
 */
function filterByMealType(restaurants: Restaurant[], mealType?: 'breakfast' | 'lunch' | 'dinner'): Restaurant[] {
  if (mealType !== 'dinner') {
    return restaurants; // Pas de filtre pour petit-déjeuner/déjeuner
  }

  return restaurants.filter(r => {
    const nameLower = (r.name || '').toLowerCase();
    const cuisineLower = (r.cuisineTypes || []).join(' ').toLowerCase();
    const descLower = (r.description || '').toLowerCase();

    // Vérifier si le restaurant correspond à un type inapproprié pour le dîner
    const isInappropriate = INAPPROPRIATE_FOR_DINNER.some(keyword =>
      nameLower.includes(keyword) ||
      cuisineLower.includes(keyword) ||
      descLower.includes(keyword)
    );

    if (isInappropriate) {
      return false;
    }

    return true;
  });
}

/**
 * Priorise les restaurants correspondant aux restrictions diététiques de l'utilisateur.
 * Ne supprime PAS les restaurants non-matching (données souvent incomplètes),
 * mais les trie pour que les matchs apparaissent en premier.
 */
function applyDietaryPreference(restaurants: Restaurant[], dietary?: DietaryType[]): Restaurant[] {
  if (!dietary || dietary.length === 0 || dietary.includes('none')) return restaurants;

  const dietaryKeywords: Record<string, string[]> = {
    vegetarian: ['vegetarian', 'végétarien', 'veggie', 'vegetarisch', 'vegetariano'],
    vegan: ['vegan', 'végan', 'plant-based', 'végétal', 'vegano'],
    halal: ['halal'],
    kosher: ['kosher', 'casher', 'cacher'],
    gluten_free: ['gluten-free', 'sans gluten', 'celiac', 'coeliaque', 'glutenfrei'],
  };

  const targetKeywords = dietary.flatMap(d => dietaryKeywords[d] || []);
  if (targetKeywords.length === 0) return restaurants;

  return [...restaurants].sort((a, b) => {
    const aText = `${a.name} ${a.description || ''} ${(a.cuisineTypes || []).join(' ')}`.toLowerCase();
    const bText = `${b.name} ${b.description || ''} ${(b.cuisineTypes || []).join(' ')}`.toLowerCase();
    const aMatch = targetKeywords.some(kw => aText.includes(kw)) ? 1 : 0;
    const bMatch = targetKeywords.some(kw => bText.includes(kw)) ? 1 : 0;
    return bMatch - aMatch;
  });
}

function applyFinalFilter(restaurants: Restaurant[], destination: string | undefined, limit: number, mealType?: 'breakfast' | 'lunch' | 'dinner', dietary?: DietaryType[]): Restaurant[] {
  if (restaurants.length === 0) {
    return [];
  }

  // 1. Filtre par note minimum (Bug #2)
  let filtered = filterByRating(restaurants);
  const excludedByRating = restaurants.length - filtered.length;

  // 2. Filtre par type de repas (ex: pas de sandwicherie pour le dîner)
  const beforeMealTypeFilter = filtered.length;
  filtered = filterByMealType(filtered, mealType);
  const excludedByMealType = beforeMealTypeFilter - filtered.length;

  // 3. Filtre par nom (si destination fournie)
  if (destination) {
    const beforeNameFilter = filtered.length;
    filtered = filterByForbiddenNames(filtered, destination);
    const excludedByName = beforeNameFilter - filtered.length;

  }

  // 4. Prioriser les restaurants correspondant aux restrictions diététiques
  filtered = applyDietaryPreference(filtered, dietary);

  return filtered.slice(0, limit);
}

/**
 * Recherche via Overpass API (OpenStreetMap)
 */
async function searchWithOverpass(params: RestaurantSearchParams): Promise<Restaurant[]> {
  const { latitude, longitude, radius = 1000 } = params;

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](around:${radius},${latitude},${longitude});
      node["amenity"="cafe"](around:${radius},${latitude},${longitude});
      node["amenity"="fast_food"](around:${radius},${latitude},${longitude});
    );
    out body;
  `;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    throw new Error('Overpass API request failed');
  }

  const data = await response.json();
  const restaurants: Restaurant[] = [];

  for (const element of data.elements || []) {
    if (!element.tags?.name) continue;

    const distance = calculateDistance(latitude, longitude, element.lat, element.lon);
    const walkingTime = estimateTravelTime(distance, 'walk');

    // Extraire les types de cuisine
    const cuisineTypes: string[] = [];
    if (element.tags.cuisine) {
      cuisineTypes.push(...element.tags.cuisine.split(';').map((c: string) => c.trim()));
    }

    // Déterminer le niveau de prix
    let priceLevel: 1 | 2 | 3 | 4 = 2;
    if (element.tags['price:range']) {
      const priceTag = element.tags['price:range'];
      if (priceTag.includes('€€€€')) priceLevel = 4;
      else if (priceTag.includes('€€€')) priceLevel = 3;
      else if (priceTag.includes('€€')) priceLevel = 2;
      else priceLevel = 1;
    }

    // Options diététiques
    const dietaryOptions: DietaryType[] = ['none'];
    if (element.tags['diet:vegetarian'] === 'yes' || element.tags['diet:vegetarian'] === 'only') {
      dietaryOptions.push('vegetarian');
    }
    if (element.tags['diet:vegan'] === 'yes' || element.tags['diet:vegan'] === 'only') {
      dietaryOptions.push('vegan');
    }
    if (element.tags['diet:halal'] === 'yes') {
      dietaryOptions.push('halal');
    }
    if (element.tags['diet:kosher'] === 'yes') {
      dietaryOptions.push('kosher');
    }
    if (element.tags['diet:gluten_free'] === 'yes') {
      dietaryOptions.push('gluten_free');
    }

    // Construire l'adresse
    const address = element.tags['addr:street']
      ? `${element.tags['addr:housenumber'] || ''} ${element.tags['addr:street']}, ${element.tags['addr:city'] || ''}`
      : 'Adresse non disponible';

    // Générer l'URL Google Maps avec nom + adresse (plus fiable que GPS)
    const searchQuery = address !== 'Adresse non disponible'
      ? `${element.tags.name}, ${address}`
      : `${element.tags.name}, ${params.destination || ''}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

    restaurants.push({
      id: element.id.toString(),
      name: element.tags.name,
      address,
      latitude: element.lat,
      longitude: element.lon,
      rating: Math.round((4.0 + Math.random() * 0.8) * 10) / 10, // OSM n'a pas de ratings, on génère
      reviewCount: Math.floor(50 + Math.random() * 500),
      priceLevel,
      cuisineTypes,
      dietaryOptions,
      openingHours: parseOpeningHours(element.tags.opening_hours),
      phoneNumber: element.tags.phone,
      website: element.tags.website,
      googleMapsUrl, // URL Google Maps fiable avec nom + adresse
      reservationUrl: buildReservationUrl(element.tags.name, params.destination || ''),
      dataReliability: 'verified' as const, // Coordonnées réelles OpenStreetMap
      distance,
      walkingTime,
    });
  }

  // Filtrer selon les critères
  let filtered = restaurants;

  if (params.dietary && params.dietary.length > 0 && !params.dietary.includes('none')) {
    filtered = filtered.filter((r) =>
      params.dietary!.some((d) => r.dietaryOptions.includes(d))
    );
  }

  if (params.priceLevel) {
    filtered = filtered.filter((r) => r.priceLevel <= params.priceLevel!);
  }

  // Trier par distance
  filtered.sort((a, b) => (a.distance || 0) - (b.distance || 0));

  return filtered.slice(0, params.limit || 10);
}

/**
 * Recherche via Google Places API
 */
async function searchWithGooglePlaces(params: RestaurantSearchParams): Promise<Restaurant[]> {
  const { latitude, longitude, radius = 1000 } = params;

  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.append('location', `${latitude},${longitude}`);
  url.searchParams.append('radius', radius.toString());
  url.searchParams.append('type', 'restaurant');
  url.searchParams.append('key', GOOGLE_PLACES_API_KEY!);

  if (params.priceLevel) {
    url.searchParams.append('maxprice', params.priceLevel.toString());
  }

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Google Places API error: ${data.status}`);
  }

  return data.results.map((place: any) => {
    // Générer l'URL Google Maps avec le place_id (le plus fiable pour Google Places)
    const googleMapsUrl = place.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.vicinity}`)}`;

    return {
      id: place.place_id,
      name: place.name,
      address: place.vicinity,
      latitude: place.geometry.location.lat,
      longitude: place.geometry.location.lng,
      rating: Math.round((place.rating || 4.0) * 10) / 10,
      reviewCount: place.user_ratings_total || 0,
      priceLevel: place.price_level || 2,
      cuisineTypes: place.types?.filter((t: string) => !['restaurant', 'food', 'establishment'].includes(t)) || [],
      dietaryOptions: ['none'] as DietaryType[],
      openingHours: {},
      isOpenNow: place.opening_hours?.open_now,
      googleMapsUrl, // URL directe vers la fiche Google Maps
      reservationUrl: `https://www.thefork.fr/search?q=${encodeURIComponent(`${place.name} ${params.destination || ''}`)}`,
      photos: place.photos?.map((p: any) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${p.photo_reference}&key=${GOOGLE_PLACES_API_KEY}`
      ),
      distance: calculateDistance(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng),
      walkingTime: estimateTravelTime(
        calculateDistance(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng),
        'walk'
      ),
    };
  });
}

/**
 * Génère des restaurants locaux typiques basés sur la destination
 * Fallback quand les APIs ne fonctionnent pas
 */
function generateLocalRestaurants(params: RestaurantSearchParams, destination?: string): Restaurant[] {
  const { latitude, longitude, mealType, dietary = ['none'], priceLevel } = params;

  // Restaurants par région/pays
  const regionalRestaurants: Record<string, Record<string, { name: string; cuisine: string[]; price: 1 | 2 | 3 | 4; specialties: string[] }[]>> = {
    // Espagne
    barcelona: {
      breakfast: [
        { name: 'Granja Viader', cuisine: ['catalan', 'cafe'], price: 1, specialties: ['Churros con chocolate', 'Cacaolat'] },
        { name: 'Federal Café', cuisine: ['brunch', 'healthy'], price: 2, specialties: ['Pancakes', 'Avocado toast'] },
        { name: 'Flax & Kale', cuisine: ['healthy', 'vegetarian'], price: 2, specialties: ['Smoothie bowls', 'Flexitarian menu'] },
      ],
      lunch: [
        { name: 'Can Culleretes', cuisine: ['catalan', 'traditional'], price: 2, specialties: ['Escudella i carn d\'olla', 'Canelons'] },
        { name: 'El Xampanyet', cuisine: ['catalan', 'tapas'], price: 2, specialties: ['Anchoas', 'Cava de la casa'] },
        { name: 'La Mar Salada', cuisine: ['seafood', 'mediterranean'], price: 3, specialties: ['Paella', 'Fideuà'] },
        { name: 'Cervecería Catalana', cuisine: ['tapas', 'spanish'], price: 2, specialties: ['Patatas bravas', 'Jamón ibérico'] },
      ],
      dinner: [
        { name: 'Cal Pep', cuisine: ['catalan', 'seafood'], price: 3, specialties: ['Tapas de mer', 'Fritura de pescado'] },
        { name: 'Tickets', cuisine: ['tapas', 'modern'], price: 4, specialties: ['Tapas créatives', 'Molecular gastronomy'] },
        { name: 'Els Quatre Gats', cuisine: ['catalan', 'historic'], price: 3, specialties: ['Cuisine catalane', 'Ambiance Picasso'] },
        { name: 'Can Paixano', cuisine: ['cava bar', 'tapas'], price: 1, specialties: ['Cava', 'Bocadillos'] },
      ],
    },
    madrid: {
      breakfast: [
        { name: 'Chocolatería San Ginés', cuisine: ['cafe', 'traditional'], price: 1, specialties: ['Churros con chocolate'] },
        { name: 'Federal Café Madrid', cuisine: ['brunch', 'international'], price: 2, specialties: ['Brunch', 'Coffee'] },
      ],
      lunch: [
        { name: 'Sobrino de Botín', cuisine: ['castilian', 'traditional'], price: 3, specialties: ['Cochinillo asado', 'Cordero'] },
        { name: 'Casa Lucio', cuisine: ['madrileño', 'traditional'], price: 3, specialties: ['Huevos rotos', 'Callos'] },
        { name: 'Mercado de San Miguel', cuisine: ['tapas', 'varied'], price: 2, specialties: ['Tapas variées', 'Vins'] },
      ],
      dinner: [
        { name: 'DiverXO', cuisine: ['modern', 'creative'], price: 4, specialties: ['Cuisine fusion', '3 étoiles Michelin'] },
        { name: 'Casa Mono', cuisine: ['spanish', 'wine bar'], price: 3, specialties: ['Raciones', 'Vins naturels'] },
      ],
    },
    // France
    paris: {
      breakfast: [
        { name: 'Café de Flore', cuisine: ['french', 'cafe'], price: 2, specialties: ['Croissant', 'Café crème'] },
        { name: 'Claus', cuisine: ['brunch', 'healthy'], price: 2, specialties: ['Petit-déjeuner complet', 'Granola maison'] },
      ],
      lunch: [
        { name: 'Le Bouillon Chartier', cuisine: ['french', 'traditional'], price: 1, specialties: ['Cuisine bourgeoise', 'Prix doux'] },
        { name: 'L\'Ami Jean', cuisine: ['basque', 'french'], price: 3, specialties: ['Riz au lait', 'Cuisine basque'] },
        { name: 'Bistrot Paul Bert', cuisine: ['bistrot', 'french'], price: 2, specialties: ['Steak frites', 'Tarte tatin'] },
      ],
      dinner: [
        { name: 'Le Comptoir du Panthéon', cuisine: ['french', 'bistrot'], price: 2, specialties: ['Cuisine du marché'] },
        { name: 'Septime', cuisine: ['modern', 'gastronomic'], price: 4, specialties: ['Menu dégustation', 'Produits de saison'] },
      ],
    },
    // Italie
    rome: {
      breakfast: [
        { name: 'Tazza d\'Oro', cuisine: ['cafe', 'italian'], price: 1, specialties: ['Granita di caffè', 'Espresso'] },
      ],
      lunch: [
        { name: 'Da Enzo al 29', cuisine: ['roman', 'traditional'], price: 2, specialties: ['Cacio e Pepe', 'Carbonara'] },
        { name: 'Roscioli', cuisine: ['deli', 'italian'], price: 3, specialties: ['Salumi', 'Formaggi', 'Pasta'] },
      ],
      dinner: [
        { name: 'Armando al Pantheon', cuisine: ['roman', 'traditional'], price: 3, specialties: ['Coda alla vaccinara', 'Amatriciana'] },
        { name: 'Pizzarium', cuisine: ['pizza', 'roman'], price: 1, specialties: ['Pizza al taglio', 'Toppings créatifs'] },
      ],
    },
    // UK
    london: {
      breakfast: [
        { name: 'The Wolseley', cuisine: ['british', 'cafe'], price: 3, specialties: ['Full English Breakfast', 'Eggs Benedict'] },
        { name: 'Dishoom', cuisine: ['indian', 'brunch'], price: 2, specialties: ['Bacon Naan Roll', 'Masala Chai'] },
        { name: 'The Breakfast Club', cuisine: ['brunch', 'british'], price: 2, specialties: ['Full Monty', 'Pancakes'] },
      ],
      lunch: [
        { name: 'Rules', cuisine: ['british', 'traditional'], price: 3, specialties: ['Roast Beef', 'Game Pie'] },
        { name: 'The Ivy', cuisine: ['british', 'modern'], price: 3, specialties: ['Fish and Chips', 'Shepherd\'s Pie'] },
        { name: 'Ye Olde Cheshire Cheese', cuisine: ['british', 'pub'], price: 2, specialties: ['Pie and Mash', 'Real Ale'] },
        { name: 'Gordon\'s Wine Bar', cuisine: ['british', 'wine bar'], price: 2, specialties: ['Cheese Board', 'Wine Selection'] },
      ],
      dinner: [
        { name: 'St. John', cuisine: ['british', 'nose-to-tail'], price: 3, specialties: ['Bone Marrow', 'Welsh Rarebit'] },
        { name: 'The Harwood Arms', cuisine: ['british', 'gastropub'], price: 3, specialties: ['Venison', 'Scotch Egg'] },
        { name: 'Sketch', cuisine: ['modern', 'british'], price: 4, specialties: ['Afternoon Tea', 'Creative Menu'] },
        { name: 'Duck & Waffle', cuisine: ['british', 'modern'], price: 3, specialties: ['Duck and Waffle', 'City Views'] },
      ],
    },
    londres: {
      breakfast: [
        { name: 'The Wolseley', cuisine: ['british', 'cafe'], price: 3, specialties: ['Full English Breakfast', 'Eggs Benedict'] },
        { name: 'Dishoom', cuisine: ['indian', 'brunch'], price: 2, specialties: ['Bacon Naan Roll', 'Masala Chai'] },
        { name: 'The Breakfast Club', cuisine: ['brunch', 'british'], price: 2, specialties: ['Full Monty', 'Pancakes'] },
      ],
      lunch: [
        { name: 'Rules', cuisine: ['british', 'traditional'], price: 3, specialties: ['Roast Beef', 'Game Pie'] },
        { name: 'The Ivy', cuisine: ['british', 'modern'], price: 3, specialties: ['Fish and Chips', 'Shepherd\'s Pie'] },
        { name: 'Ye Olde Cheshire Cheese', cuisine: ['british', 'pub'], price: 2, specialties: ['Pie and Mash', 'Real Ale'] },
        { name: 'Gordon\'s Wine Bar', cuisine: ['british', 'wine bar'], price: 2, specialties: ['Cheese Board', 'Wine Selection'] },
      ],
      dinner: [
        { name: 'St. John', cuisine: ['british', 'nose-to-tail'], price: 3, specialties: ['Bone Marrow', 'Welsh Rarebit'] },
        { name: 'The Harwood Arms', cuisine: ['british', 'gastropub'], price: 3, specialties: ['Venison', 'Scotch Egg'] },
        { name: 'Sketch', cuisine: ['modern', 'british'], price: 4, specialties: ['Afternoon Tea', 'Creative Menu'] },
        { name: 'Duck & Waffle', cuisine: ['british', 'modern'], price: 3, specialties: ['Duck and Waffle', 'City Views'] },
      ],
    },
  };

  // Déterminer la région
  const destLower = (destination || '').toLowerCase();
  let region = 'default';
  for (const key of Object.keys(regionalRestaurants)) {
    if (destLower.includes(key)) {
      region = key;
      break;
    }
  }

  // Restaurants par défaut (cuisine locale générique - noms neutres)
  const defaultRestaurants: Record<string, { name: string; cuisine: string[]; price: 1 | 2 | 3 | 4; specialties: string[] }[]> = {
    breakfast: [
      { name: 'Local Cafe', cuisine: ['cafe', 'local'], price: 1, specialties: ['Traditional Breakfast'] },
      { name: 'Artisan Bakery', cuisine: ['bakery', 'local'], price: 1, specialties: ['Fresh Pastries', 'Coffee'] },
    ],
    lunch: [
      { name: 'Local Kitchen', cuisine: ['local', 'traditional'], price: 2, specialties: ['Local Cuisine', 'Fresh Produce'] },
      { name: 'City Bistro', cuisine: ['bistrot', 'local'], price: 2, specialties: ['Daily Special', 'Homemade'] },
    ],
    dinner: [
      { name: 'The Local Table', cuisine: ['local', 'gastronomic'], price: 3, specialties: ['Tasting Menu', 'Local Wine'] },
      { name: 'Traditional Inn', cuisine: ['traditional', 'local'], price: 2, specialties: ['Regional Specialties'] },
    ],
  };

  const restaurantList = region !== 'default'
    ? regionalRestaurants[region][mealType || 'lunch'] || defaultRestaurants[mealType || 'lunch']
    : defaultRestaurants[mealType || 'lunch'];

  const restaurants: Restaurant[] = [];

  for (let i = 0; i < restaurantList.length; i++) {
    const template = restaurantList[i];

    // Filtrer par prix si spécifié
    if (priceLevel && template.price > priceLevel) continue;

    // Générer une position aléatoire à proximité
    const offsetLat = (Math.random() - 0.5) * 0.015;
    const offsetLng = (Math.random() - 0.5) * 0.015;
    const restLat = latitude + offsetLat;
    const restLng = longitude + offsetLng;

    const distance = calculateDistance(latitude, longitude, restLat, restLng);

    // Options diététiques basées sur le type
    const dietaryOptions: DietaryType[] = ['none'];
    if (template.cuisine.includes('vegetarian') || template.cuisine.includes('healthy')) {
      dietaryOptions.push('vegetarian');
      dietaryOptions.push('vegan');
    }

    // Générer l'URL Google Maps avec nom + ville
    const searchQuery = destination
      ? `${template.name}, ${destination}`
      : template.name;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

    restaurants.push({
      id: `local-${mealType}-${i}`,
      name: template.name,
      address: destination ? `Centre-ville, ${destination}` : 'Centre-ville',
      latitude: restLat,
      longitude: restLng,
      rating: Math.round((4.2 + Math.random() * 0.6) * 10) / 10, // Bonnes notes pour restaurants recommandés
      reviewCount: Math.floor(200 + Math.random() * 600),
      priceLevel: template.price,
      cuisineTypes: template.cuisine,
      dietaryOptions,
      specialties: template.specialties,
      googleMapsUrl, // URL Google Maps avec nom + ville
      reservationUrl: buildReservationUrl(template.name, destination || ''),
      openingHours: generateOpeningHours(mealType),
      isOpenNow: true,
      distance,
      walkingTime: estimateTravelTime(distance, 'walk'),
      dataReliability: 'generated' as const, // Coordonnées fictives (centre-ville + jitter)
    });
  }

  // Filtrer par régime si nécessaire
  let filtered = restaurants;
  if (dietary.length > 0 && !dietary.includes('none')) {
    filtered = filtered.filter((r) =>
      dietary.some((d) => r.dietaryOptions.includes(d))
    );
  }

  // Trier par note
  filtered.sort((a, b) => b.rating - a.rating);

  return filtered.slice(0, params.limit || 5);
}

/**
 * Parse les horaires d'ouverture OSM
 */
function parseOpeningHours(hoursString?: string): Record<string, { open: string; close: string } | null> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const result: Record<string, { open: string; close: string } | null> = {};

  // Par défaut, ouvert 12:00-14:30 et 19:00-22:30
  for (const day of days) {
    result[day] = { open: '12:00', close: '22:30' };
  }

  if (!hoursString) return result;

  // Parsing simplifié - OSM a un format complexe
  // TODO: Parser complètement le format OSM opening_hours
  return result;
}

/**
 * Génère des horaires selon le type de repas
 */
function generateOpeningHours(mealType?: string): Record<string, { open: string; close: string } | null> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const result: Record<string, { open: string; close: string } | null> = {};

  for (const day of days) {
    switch (mealType) {
      case 'breakfast':
        result[day] = { open: '07:00', close: '11:30' };
        break;
      case 'lunch':
        result[day] = { open: '11:30', close: '15:00' };
        break;
      case 'dinner':
        result[day] = { open: '18:30', close: '23:00' };
        break;
      default:
        result[day] = { open: '11:30', close: '23:00' };
    }
  }

  // Fermer un jour aléatoire (souvent lundi ou dimanche)
  const closedDay = Math.random() > 0.5 ? 'monday' : 'sunday';
  result[closedDay] = null;

  return result;
}

/**
 * Sélectionne le meilleur restaurant selon les critères
 */
export function selectBestRestaurant(
  restaurants: Restaurant[],
  preferences: {
    dietary?: DietaryType[];
    maxDistance?: number; // km
    maxPrice?: 1 | 2 | 3 | 4;
    preferHighRating?: boolean;
    destination?: string; // RÈGLE 4: Pour le scoring de cuisine locale
  }
): Restaurant | null {
  let filtered = [...restaurants];

  // Filtrer par régime alimentaire
  if (preferences.dietary && preferences.dietary.length > 0 && !preferences.dietary.includes('none')) {
    filtered = filtered.filter((r) =>
      preferences.dietary!.some((d) => r.dietaryOptions.includes(d))
    );
  }

  // Filtrer par distance
  if (preferences.maxDistance) {
    filtered = filtered.filter((r) => (r.distance || 0) <= preferences.maxDistance!);
  }

  // Filtrer par prix
  if (preferences.maxPrice) {
    filtered = filtered.filter((r) => r.priceLevel <= preferences.maxPrice!);
  }

  if (filtered.length === 0) return null;

  // RÈGLE 4: Calculer un score composite incluant la cuisine locale
  const scored = filtered.map(r => {
    let score = 0;

    // Score basé sur la note (0-50)
    score += r.rating * 10;

    // Score basé sur la distance (0-20, plus c'est proche, mieux c'est)
    if (r.distance !== undefined) {
      score += Math.max(0, 20 - r.distance * 10);
    }

    // Score basé sur la cuisine locale (RÈGLE 4)
    if (preferences.destination) {
      const cuisineValidation = validateRestaurantCuisine(r.cuisineTypes, preferences.destination);
      score += cuisineValidation.score; // +20 pour cuisine locale, -50 pour interdite
    }

    return { restaurant: r, score };
  });

  // Trier par score décroissant
  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.restaurant || null;
}

/**
 * Formate le niveau de prix
 */
export function formatPriceLevel(level: 1 | 2 | 3 | 4): string {
  return '€'.repeat(level);
}

/**
 * Estime le prix moyen d'un repas
 */
export function estimateMealPrice(level: 1 | 2 | 3 | 4, mealType: 'breakfast' | 'lunch' | 'dinner'): number {
  const basePrices: Record<string, number[]> = {
    breakfast: [8, 12, 18, 30],
    lunch: [12, 20, 35, 60],
    dinner: [18, 30, 50, 100],
  };

  return basePrices[mealType][level - 1];
}

/**
 * Convertit un PlaceData de la base de données en Restaurant
 */
function placeToRestaurant(place: PlaceData): Restaurant {
  return {
    id: place.externalId || `db-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    rating: Math.round((place.rating || 4.0) * 10) / 10,
    reviewCount: place.reviewCount || 0,
    priceLevel: (place.priceLevel as 1 | 2 | 3 | 4) || 2,
    cuisineTypes: place.cuisineTypes || [],
    dietaryOptions: ['none'],
    openingHours: place.openingHours || {},
    phoneNumber: place.phone,
    website: place.website,
    googleMapsUrl: place.googleMapsUrl,
    reservationUrl: place.bookingUrl || buildReservationUrl(place.name, place.city),
    distance: undefined,
    walkingTime: undefined,
  };
}

/**
 * Convertit un Restaurant en PlaceData pour sauvegarde en base
 */
function restaurantToPlace(restaurant: Restaurant, city: string): PlaceData {
  return {
    externalId: restaurant.id,
    type: 'restaurant',
    name: restaurant.name,
    city,
    address: restaurant.address,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    rating: restaurant.rating,
    reviewCount: restaurant.reviewCount,
    priceLevel: restaurant.priceLevel,
    cuisineTypes: restaurant.cuisineTypes,
    openingHours: restaurant.openingHours as Record<string, { open: string; close: string } | null>,
    phone: restaurant.phoneNumber,
    website: restaurant.website,
    googleMapsUrl: restaurant.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${city}`)}`,
    bookingUrl: restaurant.reservationUrl,
    source: 'serpapi',
    dataReliability: 'verified',
  };
}

/**
 * Service de recherche de restaurants via Claude AI - VERSION SERVEUR
 * Recommande des restaurants locaux authentiques, évite les chaînes
 */

import Anthropic from '@anthropic-ai/sdk';
import { Restaurant, DietaryType } from '../types';
import { tokenTracker } from './tokenTracker';
import { filterRestaurantsByCuisine } from './cuisineValidator';
import * as fs from 'fs';
import * as path from 'path';

// Import des mots-clés interdits pour le filtrage par nom
// (répliqué ici pour éviter la dépendance circulaire avec restaurants.ts)
const FORBIDDEN_NAME_KEYWORDS: Record<string, string[]> = {
  Spain: ['chinese', 'chinois', 'china', 'chino', 'wok', 'asia', 'asian', 'asiatique', 'asiatico', 'oriental', 'oriente', 'sushi', 'ramen', 'noodle', 'pho', 'thai', 'thaï', 'thailand', 'vietnam', 'vietnamita', 'indian', 'indien', 'indio', 'curry', 'tandoori', 'kebab', 'döner', 'doner', 'korean', 'coreen', 'coreano', 'japanese', 'japonais', 'japones', 'pekin', 'peking', 'beijing', 'szechuan', 'sichuan', 'cantonese', 'cantones', 'dim sum', 'hong kong', 'mandarin', 'shanghai', 'tokyo', 'osaka'],
  Italy: ['chinese', 'chinois', 'china', 'cinese', 'wok', 'asia', 'asian', 'asiatico', 'sushi', 'ramen', 'mexican', 'mexicano', 'tacos', 'burrito', 'indian', 'indiano', 'curry', 'kebab', 'döner', 'pekin', 'peking'],
  France: ['burger king', 'mcdonald', 'kfc', 'subway', 'quick', 'five guys'],
  Portugal: ['chinese', 'chinois', 'china', 'chines', 'wok', 'asia', 'sushi', 'indian', 'indiano', 'curry', 'kebab', 'pekin', 'peking'],
  Greece: ['chinese', 'chinois', 'china', 'wok', 'asia', 'asian', 'sushi', 'indian', 'curry', 'mexican', 'pekin', 'peking'],
};

function getCountryFromDestination(destination: string): string | null {
  const dest = destination.toLowerCase();
  if (['barcelona', 'madrid', 'sevilla', 'valencia', 'malaga', 'bilbao', 'granada'].some(c => dest.includes(c))) return 'Spain';
  if (['rome', 'florence', 'venice', 'milan', 'naples', 'roma', 'firenze', 'venezia', 'milano', 'napoli'].some(c => dest.includes(c))) return 'Italy';
  if (['paris', 'lyon', 'marseille', 'nice', 'bordeaux', 'toulouse'].some(c => dest.includes(c))) return 'France';
  if (['lisbon', 'porto', 'lisboa'].some(c => dest.includes(c))) return 'Portugal';
  if (['athens', 'santorini', 'athenes'].some(c => dest.includes(c))) return 'Greece';
  return null;
}

function filterByForbiddenNames(restaurants: Restaurant[], destination: string): Restaurant[] {
  const country = getCountryFromDestination(destination);
  const forbiddenKeywords = country ? (FORBIDDEN_NAME_KEYWORDS[country] || []) : [];

  if (forbiddenKeywords.length === 0) return restaurants;

  return restaurants.filter(r => {
    const nameLower = r.name.toLowerCase();
    const isForbidden = forbiddenKeywords.some(keyword => nameLower.includes(keyword));
    if (isForbidden) {
      console.log(`[Restaurants Cache] EXCLU par nom: "${r.name}" contient un mot interdit pour ${country}`);
    }
    return !isForbidden;
  });
}

// Cache file path
const CACHE_DIR = path.join(process.cwd(), 'data', 'restaurants-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'restaurants.json');

interface RestaurantsCache {
  [key: string]: {
    restaurants: Restaurant[];
    fetchedAt: string;
    version: number;
  };
}

function loadCache(): RestaurantsCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Erreur lecture cache restaurants:', error);
  }
  return {};
}

function saveCache(cache: RestaurantsCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('Erreur sauvegarde cache restaurants:', error);
  }
}

function getCacheKey(destination: string, mealType: string): string {
  return `${destination.toLowerCase().trim()}-${mealType}`;
}

/**
 * Recherche des restaurants locaux authentiques via Claude
 */
export async function searchRestaurantsWithAI(
  destination: string,
  options: {
    mealType: 'breakfast' | 'lunch' | 'dinner';
    priceLevel?: 1 | 2 | 3 | 4;
    dietary?: DietaryType[];
    cityCenter: { lat: number; lng: number };
    forceRefresh?: boolean;
  }
): Promise<Restaurant[]> {
  const cacheKey = getCacheKey(destination, options.mealType);
  const cache = loadCache();
  const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours

  // Vérifier le cache
  const cached = cache[cacheKey];
  if (
    cached &&
    !options.forceRefresh &&
    new Date().getTime() - new Date(cached.fetchedAt).getTime() < cacheMaxAge
  ) {
    console.log(`[Restaurants] Cache hit pour ${destination} - ${options.mealType}`);
    // IMPORTANT: Passer destination pour appliquer les filtres cuisine même sur le cache!
    return filterRestaurants(cached.restaurants, options, destination);
  }

  console.log(`[Restaurants] Cache miss pour ${destination} - ${options.mealType}, appel Claude...`);

  try {
    const restaurants = await fetchRestaurantsFromClaude(destination, options);

    // Sauvegarder en cache
    cache[cacheKey] = {
      restaurants,
      fetchedAt: new Date().toISOString(),
      version: 1,
    };
    saveCache(cache);

    console.log(`[Restaurants] ${restaurants.length} restaurants trouvés pour ${destination}`);
    return filterRestaurants(restaurants, options, destination);
  } catch (error) {
    console.error('[Restaurants] Erreur recherche:', error);
    if (cached) {
      return filterRestaurants(cached.restaurants, options, destination);
    }
    return [];
  }
}

function filterRestaurants(
  restaurants: Restaurant[],
  options: { priceLevel?: number; dietary?: DietaryType[] },
  destination?: string
): Restaurant[] {
  let filtered = restaurants;

  // Filtres de base (prix et régime alimentaire)
  if (options.priceLevel) {
    filtered = filtered.filter(r => r.priceLevel <= options.priceLevel!);
  }

  if (options.dietary && options.dietary.length > 0 && !options.dietary.includes('none')) {
    filtered = filtered.filter(r =>
      options.dietary!.some(d => r.dietaryOptions.includes(d))
    );
  }

  // CRITIQUE: Appliquer les filtres cuisine même sur les données en cache!
  // Sans ces filtres, un restaurant chinois peut passer à travers le cache
  if (destination) {
    const beforeCount = filtered.length;
    filtered = filterRestaurantsByCuisine(filtered, destination, { strictMode: true });
    filtered = filterByForbiddenNames(filtered, destination);
    const afterCount = filtered.length;
    if (beforeCount !== afterCount) {
      console.log(`[Restaurants] Filtres cuisine appliqués: ${beforeCount} → ${afterCount} restaurants`);
    }
  }

  return filtered;
}

async function fetchRestaurantsFromClaude(
  destination: string,
  options: {
    mealType: 'breakfast' | 'lunch' | 'dinner';
    cityCenter: { lat: number; lng: number };
  }
): Promise<Restaurant[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }

  const client = new Anthropic({ apiKey });

  const mealLabels = {
    breakfast: 'petit-déjeuner/brunch',
    lunch: 'déjeuner',
    dinner: 'dîner',
  };

  const prompt = `Tu es un expert culinaire local. Recommande 8-10 VRAIS restaurants pour ${mealLabels[options.mealType]} à ${destination}.

CRITÈRES IMPORTANTS:
- UNIQUEMENT des restaurants qui EXISTENT VRAIMENT
- Privilégier FORTEMENT la cuisine LOCALE et TRADITIONNELLE de ${destination}
- ÉVITER les chaînes (McDonald's, Burger King, Domino's, Subway, KFC, Pizza Hut, Starbucks, etc.)
- ÉVITER les cuisines NON-LOCALES et incohérentes avec la destination:
  * En Espagne: pas de restaurant chinois, japonais, indien, thaï
  * En Italie: pas de restaurant chinois, mexicain, fast-food
  * En France: pas de fast-food américain
  * Privilégie les restaurants où les locaux mangent
- Au moins 80% des restaurants doivent proposer une cuisine LOCALE
- Varier les gammes de prix (du populaire au gastronomique)
- Inclure des adresses recommandées par les guides (Routard, Michelin, locaux)

Pour chaque restaurant, fournis au format JSON:
{
  "id": "nom-en-kebab-case",
  "name": "Nom du Restaurant",
  "address": "Adresse complète avec numéro et rue",
  "latitude": 41.3851,
  "longitude": 2.1734,
  "rating": 4.5,
  "reviewCount": 850,
  "priceLevel": 2,
  "cuisineTypes": ["catalane", "tapas"],
  "dietaryOptions": ["none"],
  "specialties": ["Paella", "Tapas variés"],
  "description": "Description courte du restaurant et son ambiance",
  "reservationUrl": "https://...",
  "phoneNumber": "+34 XXX XXX XXX",
  "tips": "Conseil pratique (réservation, plat signature, etc.)"
}

- priceLevel: 1 (€ budget) à 4 (€€€€ gastronomique)
- dietaryOptions: ["none", "vegetarian", "vegan", "halal", "kosher", "gluten_free"]
- Les coordonnées GPS doivent être EXACTES et RÉELLES

Réponds UNIQUEMENT avec un tableau JSON valide.`;

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Tracker les tokens consommés
  if (response.usage) {
    tokenTracker.track(response.usage, `Restaurants: ${destination} - ${options.mealType}`);
  }

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Réponse Claude invalide');
  }

  let jsonStr = content.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  const rawRestaurants = JSON.parse(jsonStr);

  // Calculer distances depuis le centre-ville
  return rawRestaurants.map((r: any, index: number) => {
    const distance = calculateDistance(
      options.cityCenter.lat,
      options.cityCenter.lng,
      r.latitude || options.cityCenter.lat,
      r.longitude || options.cityCenter.lng
    );

    return {
      id: r.id || `${destination.toLowerCase()}-${options.mealType}-${index}`,
      name: r.name,
      address: r.address || 'Adresse non disponible',
      latitude: r.latitude || options.cityCenter.lat + (Math.random() - 0.5) * 0.02,
      longitude: r.longitude || options.cityCenter.lng + (Math.random() - 0.5) * 0.02,
      rating: Math.min(5, Math.max(1, r.rating || 4)),
      reviewCount: r.reviewCount || 100,
      priceLevel: Math.min(4, Math.max(1, r.priceLevel || 2)) as 1 | 2 | 3 | 4,
      cuisineTypes: r.cuisineTypes || ['local'],
      dietaryOptions: (r.dietaryOptions || ['none']) as DietaryType[],
      specialties: r.specialties,
      description: r.description,
      reservationUrl: r.reservationUrl,
      phoneNumber: r.phoneNumber,
      tips: r.tips,
      openingHours: generateOpeningHours(options.mealType),
      distance,
      walkingTime: Math.ceil(distance / 4 * 60), // ~4 km/h à pied
    };
  });
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function generateOpeningHours(mealType: string): Record<string, { open: string; close: string } | null> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const result: Record<string, { open: string; close: string } | null> = {};

  for (const day of days) {
    switch (mealType) {
      case 'breakfast':
        result[day] = { open: '07:30', close: '12:00' };
        break;
      case 'lunch':
        result[day] = { open: '12:00', close: '15:30' };
        break;
      case 'dinner':
        result[day] = { open: '19:00', close: '23:30' };
        break;
      default:
        result[day] = { open: '12:00', close: '23:00' };
    }
  }

  return result;
}

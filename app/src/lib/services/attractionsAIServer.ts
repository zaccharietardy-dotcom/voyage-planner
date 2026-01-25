/**
 * Service de recherche d'attractions - VERSION SERVEUR
 * Ce fichier utilise fs et ne peut être importé que côté serveur
 *
 * Chaîne de priorité:
 * 1. Foursquare Places API (GRATUIT, données vérifiées)
 * 2. SerpAPI Google Local (données RÉELLES, 100 req/mois gratuit) ✅
 * 3. Cache local
 * 4. Claude AI (fallback)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Attraction } from './attractions';
import { ActivityType } from '../types';
import { tokenTracker } from './tokenTracker';
import { searchAttractions as searchFoursquareAttractions, foursquareToAttraction, isFoursquareConfigured } from './foursquare';
import { searchAttractionsWithSerpApi, searchAttractionsMultiQuery, isSerpApiPlacesConfigured } from './serpApiPlaces';
import { searchPlacesFromDB, savePlacesToDB, type PlaceData } from './placeDatabase';
import * as fs from 'fs';
import * as path from 'path';

// Cache file path
const CACHE_DIR = path.join(process.cwd(), 'data', 'attractions-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'attractions.json');

interface AttractionsCache {
  [destination: string]: {
    attractions: Attraction[];
    fetchedAt: string;
    version: number;
  };
}

function loadCache(): AttractionsCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Erreur lecture cache attractions:', error);
  }
  return {};
}

function saveCache(cache: AttractionsCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('Erreur sauvegarde cache attractions:', error);
  }
}

function normalizeDestination(dest: string): string {
  return dest.toLowerCase().trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-');
}

function validateActivityType(type: string): ActivityType {
  const validTypes: ActivityType[] = [
    'culture', 'nature', 'gastronomy', 'beach',
    'shopping', 'nightlife', 'adventure', 'wellness'
  ];
  const normalized = type?.toLowerCase().trim() as ActivityType;
  return validTypes.includes(normalized) ? normalized : 'culture';
}

async function fetchAttractionsFromClaude(
  destination: string,
  types?: ActivityType[]
): Promise<Attraction[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }

  const client = new Anthropic({ apiKey });

  const typesList = types?.length
    ? types.join(', ')
    : 'culture, nature, gastronomy, beach, shopping, nightlife, adventure, wellness';

  const prompt = `Tu es un expert en voyage. Génère une liste de 10-15 attractions touristiques RÉELLES et populaires pour ${destination}.

Pour chaque attraction, fournis les informations au format JSON suivant:
{
  "id": "identifiant-unique-en-kebab-case",
  "name": "Nom officiel de l'attraction",
  "type": "culture|nature|gastronomy|beach|shopping|nightlife|adventure|wellness",
  "description": "Description courte et attrayante (1-2 phrases)",
  "duration": 90,
  "estimatedCost": 15,
  "latitude": 41.4036,
  "longitude": 2.1744,
  "rating": 4.5,
  "mustSee": true,
  "bookingRequired": true,
  "bookingUrl": "https://...",
  "openingHours": { "open": "09:00", "close": "20:00" },
  "tips": "Conseil pratique pour les visiteurs"
}

Types d'activités à inclure prioritairement: ${typesList}

IMPORTANT:
- Utilise UNIQUEMENT des attractions qui EXISTENT VRAIMENT
- Les coordonnées GPS doivent être EXACTES et RÉELLES
- Inclus les prix d'entrée actuels (approximatifs)
- Varie les types d'attractions

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après.`;

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Tracker les tokens consommés
  if (response.usage) {
    tokenTracker.track(response.usage, `Attractions: ${destination}`);
  }

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Réponse Claude invalide');
  }

  let jsonStr = content.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  const attractions: Attraction[] = JSON.parse(jsonStr);

  return attractions.map((a, index) => ({
    id: a.id || `${normalizeDestination(destination)}-${index}`,
    name: a.name,
    type: validateActivityType(a.type),
    description: a.description || '',
    duration: Math.max(30, Math.min(300, a.duration || 90)),
    estimatedCost: Math.max(0, a.estimatedCost || 0),
    latitude: a.latitude || 0,
    longitude: a.longitude || 0,
    rating: Math.max(1, Math.min(5, a.rating || 4)),
    mustSee: Boolean(a.mustSee),
    bookingRequired: Boolean(a.bookingRequired),
    bookingUrl: a.bookingUrl || undefined,
    openingHours: a.openingHours || { open: '09:00', close: '18:00' },
    tips: a.tips || undefined,
  }));
}

/**
 * Recherche des attractions depuis le cache ou Claude
 * Version serveur qui accède directement au cache fichier
 *
 * Priorité:
 * 1. Foursquare (si configuré et coordonnées disponibles)
 * 2. Cache local
 * 3. Claude AI
 */
export async function searchAttractionsFromCache(
  destination: string,
  options?: {
    types?: ActivityType[];
    forceRefresh?: boolean;
    maxResults?: number;
    cityCenter?: { lat: number; lng: number }; // Pour Foursquare
  }
): Promise<Attraction[]> {
  const normalizedDest = normalizeDestination(destination);
  const cache = loadCache();
  const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours

  // 0. PRIORITÉ MAXIMALE: Base de données SQLite (données vérifiées < 30 jours)
  try {
    const dbAttractions = await searchPlacesFromDB({
      city: destination,
      type: 'attraction',
      maxAgeDays: 30,
      limit: (options?.maxResults || 15) + 5,
    });

    if (dbAttractions.length >= 5) {
      console.log(`[Server] ✅ ${dbAttractions.length} attractions trouvées en base locale pour ${destination}`);

      const attractions = dbAttractions.map((place, index) => placeToAttraction(place, index));
      return filterAttractions(attractions, options?.types, options?.maxResults);
    }
  } catch (error) {
    console.warn('[Server] Erreur base locale, fallback vers API:', error);
  }

  // 1. PRIORITÉ: Foursquare Places API (données vérifiées)
  if (isFoursquareConfigured() && options?.cityCenter) {
    try {
      console.log(`[Server] Recherche attractions via Foursquare pour ${destination}...`);
      const foursquarePlaces = await searchFoursquareAttractions(
        destination,
        options.cityCenter,
        { type: 'all', limit: (options.maxResults || 15) + 5 }
      );

      if (foursquarePlaces.length > 0) {
        const attractions: Attraction[] = foursquarePlaces.map((place, index) => {
          const converted = foursquareToAttraction(place);
          return {
            id: converted.id,
            name: converted.name,
            type: mapCategoryToActivityType(converted.category),
            description: converted.description,
            duration: 90, // Durée par défaut
            estimatedCost: 15, // Coût estimé par défaut
            latitude: converted.latitude,
            longitude: converted.longitude,
            rating: converted.rating,
            mustSee: index < 3, // Top 3 = incontournables
            bookingRequired: false,
            bookingUrl: converted.website,
            openingHours: { open: '09:00', close: '18:00' },
            tips: converted.tips[0],
            dataReliability: 'verified' as const,
            googleMapsUrl: converted.googleMapsUrl,
          };
        });

        console.log(`[Server] ${attractions.length} attractions vérifiées via Foursquare`);
        return filterAttractions(attractions, options?.types, options?.maxResults);
      }
    } catch (error) {
      console.warn('[Server] Foursquare error, trying cache/Claude:', error);
    }
  }

  // 2. PRIORITÉ: SerpAPI Google Maps (données RÉELLES avec multi-requêtes)
  if (isSerpApiPlacesConfigured()) {
    try {
      let attractions: Attraction[] = [];

      // Si on a les coordonnées du centre-ville, utiliser la recherche multi-requêtes améliorée
      if (options?.cityCenter) {
        console.log(`[Server] Recherche attractions via SerpAPI Multi-Query pour ${destination}...`);
        attractions = await searchAttractionsMultiQuery(destination, options.cityCenter, {
          types: options.types,
          limit: (options.maxResults || 15) + 5,
        });
      } else {
        // Fallback: recherche simple
        console.log(`[Server] Recherche attractions via SerpAPI Simple pour ${destination}...`);
        const serpAttractions = await searchAttractionsWithSerpApi(destination, {
          limit: (options?.maxResults || 15) + 5,
        });

        attractions = serpAttractions.map((a: any, index: number) => ({
          id: a.id,
          name: a.name,
          type: mapCategoryToActivityType(a.type || 'culture'),
          description: a.description || '',
          duration: 90,
          estimatedCost: 15,
          latitude: a.latitude || 0,
          longitude: a.longitude || 0,
          rating: a.rating || 4,
          mustSee: index < 3,
          bookingRequired: false,
          bookingUrl: a.website,
          openingHours: a.openingHours || { open: '09:00', close: '18:00' },
          tips: undefined,
          dataReliability: 'verified' as const,
        }));
      }

      if (attractions.length > 0) {
        // SAUVEGARDER EN BASE SQLITE pour les prochaines requêtes
        try {
          const placesToSave = attractions.map(a => attractionToPlace(a, destination));
          await savePlacesToDB(placesToSave, 'serpapi');
        } catch (saveError) {
          console.warn('[Server] Erreur sauvegarde en base:', saveError);
        }

        // Sauvegarder en cache fichier aussi
        cache[normalizedDest] = {
          attractions,
          fetchedAt: new Date().toISOString(),
          version: 3, // Version 3 = avec multi-requêtes
        };
        saveCache(cache);

        console.log(`[Server] ✅ ${attractions.length} attractions RÉELLES via SerpAPI`);
        return filterAttractions(attractions, options?.types, options?.maxResults);
      }
    } catch (error) {
      console.warn('[Server] SerpAPI error, trying cache/Claude:', error);
    }
  }

  // 3. Vérifier le cache
  const cached = cache[normalizedDest];
  if (
    cached &&
    !options?.forceRefresh &&
    new Date().getTime() - new Date(cached.fetchedAt).getTime() < cacheMaxAge
  ) {
    console.log(`[Server] Cache hit pour ${destination} (${cached.attractions.length} attractions)`);
    return filterAttractions(cached.attractions, options?.types, options?.maxResults);
  }

  // 4. Claude AI (fallback)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log(`[Server] Cache miss pour ${destination}, appel Claude API...`);

    try {
      const attractions = await fetchAttractionsFromClaude(destination, options?.types);

      cache[normalizedDest] = {
        attractions,
        fetchedAt: new Date().toISOString(),
        version: 1,
      };
      saveCache(cache);

      console.log(`[Server] ${attractions.length} attractions mises en cache pour ${destination}`);

      return filterAttractions(attractions, options?.types, options?.maxResults);
    } catch (error) {
      console.error('[Server] Erreur recherche attractions:', error);
    }
  }

  // 5. Fallback: cache expiré ou vide
  if (cached) {
    console.warn('[Server] Utilisation du cache expiré pour', destination);
    return filterAttractions(cached.attractions, options?.types, options?.maxResults);
  }
  return [];
}

/**
 * Convertit une catégorie Foursquare en ActivityType
 */
function mapCategoryToActivityType(category: string): ActivityType {
  const lowerCategory = category.toLowerCase();

  if (lowerCategory.includes('museum') || lowerCategory.includes('art') || lowerCategory.includes('historic')) {
    return 'culture';
  }
  if (lowerCategory.includes('park') || lowerCategory.includes('garden') || lowerCategory.includes('nature')) {
    return 'nature';
  }
  if (lowerCategory.includes('beach')) {
    return 'beach';
  }
  if (lowerCategory.includes('shop') || lowerCategory.includes('mall') || lowerCategory.includes('market')) {
    return 'shopping';
  }
  if (lowerCategory.includes('bar') || lowerCategory.includes('club') || lowerCategory.includes('night')) {
    return 'nightlife';
  }
  if (lowerCategory.includes('spa') || lowerCategory.includes('wellness')) {
    return 'wellness';
  }
  if (lowerCategory.includes('restaurant') || lowerCategory.includes('food')) {
    return 'gastronomy';
  }
  if (lowerCategory.includes('sport') || lowerCategory.includes('adventure')) {
    return 'adventure';
  }

  return 'culture'; // Défaut
}

function filterAttractions(
  attractions: Attraction[],
  types?: ActivityType[],
  maxResults?: number
): Attraction[] {
  let filtered = attractions;

  if (types && types.length > 0) {
    filtered = attractions.filter(a => types.includes(a.type));
  }

  if (maxResults && maxResults > 0) {
    filtered = filtered.slice(0, maxResults);
  }

  return filtered;
}

/**
 * Vérifie si une destination est en cache
 */
export function isDestinationInCache(destination: string): boolean {
  const cache = loadCache();
  const normalizedDest = normalizeDestination(destination);
  return normalizedDest in cache;
}

/**
 * Liste toutes les destinations en cache
 */
export function getCachedDestinationsList(): string[] {
  const cache = loadCache();
  return Object.keys(cache);
}

/**
 * Convertit un PlaceData de la base de données en Attraction
 */
function placeToAttraction(place: PlaceData, index: number): Attraction {
  return {
    id: place.externalId || `db-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: place.name,
    type: mapCategoryToActivityType(place.categories?.[0] || 'culture'),
    description: place.description || '',
    duration: 90, // Durée par défaut
    estimatedCost: place.priceLevel || 15,
    latitude: place.latitude,
    longitude: place.longitude,
    rating: place.rating || 4,
    mustSee: index < 3, // Top 3 = incontournables
    bookingRequired: false,
    bookingUrl: place.bookingUrl,
    openingHours: place.openingHours
      ? { open: place.openingHours.monday?.open || '09:00', close: place.openingHours.monday?.close || '18:00' }
      : { open: '09:00', close: '18:00' },
    tips: place.tips,
    dataReliability: place.dataReliability as 'verified' | 'estimated' | 'generated',
    googleMapsUrl: place.googleMapsUrl,
  };
}

/**
 * Convertit une Attraction en PlaceData pour sauvegarde en base
 */
function attractionToPlace(attraction: Attraction, city: string): PlaceData {
  return {
    externalId: attraction.id,
    type: 'attraction',
    name: attraction.name,
    city,
    address: `${city}`,
    latitude: attraction.latitude,
    longitude: attraction.longitude,
    rating: attraction.rating,
    priceLevel: attraction.estimatedCost,
    categories: [attraction.type],
    openingHours: {
      monday: attraction.openingHours,
      tuesday: attraction.openingHours,
      wednesday: attraction.openingHours,
      thursday: attraction.openingHours,
      friday: attraction.openingHours,
      saturday: attraction.openingHours,
      sunday: attraction.openingHours,
    },
    googleMapsUrl: attraction.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${attraction.name}, ${city}`)}`,
    bookingUrl: attraction.bookingUrl,
    description: attraction.description,
    tips: attraction.tips,
    source: 'serpapi',
    dataReliability: 'verified',
  };
}

/**
 * Service Viator - Recherche d'expériences et activités de qualité
 *
 * API Viator Partner v2 (affiliate)
 * - Recherche par destination + coordonnées
 * - 300K+ expériences dans 200+ pays
 * - Gratuit (affiliate) avec commission 8%
 *
 * Chaîne: appelé depuis attractionsAIServer.ts
 * Doc: https://docs.viator.com/partner-api/
 */

import * as fs from 'fs';
import * as path from 'path';
import { Attraction } from './attractions';
import { ActivityType } from '../types';

const VIATOR_API_KEY = process.env.VIATOR_API_KEY?.trim();
const VIATOR_BASE_URL = 'https://api.viator.com/partner';

// Cache fichier 7 jours
const CACHE_DIR = path.join(process.cwd(), '.cache', 'viator');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export function isViatorConfigured(): boolean {
  return !!VIATOR_API_KEY;
}

// ============================================
// Mapping catégories Viator → ActivityType
// ============================================

const VIATOR_TAG_TO_ACTIVITY_TYPE: Record<number, ActivityType> = {
  // Culture & History
  21911: 'culture',    // Museums
  21912: 'culture',    // Historical Tours
  21913: 'culture',    // Heritage Tours
  21914: 'culture',    // Art Tours
  // Food & Drink
  21917: 'gastronomy', // Food Tours
  21918: 'gastronomy', // Wine Tastings
  21919: 'gastronomy', // Cooking Classes
  // Nature & Outdoor
  21915: 'nature',     // Nature & Wildlife
  21916: 'nature',     // Hiking
  21920: 'adventure',  // Adventure
  21921: 'adventure',  // Water Sports
  // Nightlife
  21922: 'nightlife',  // Nightlife
  // Shopping
  21923: 'shopping',   // Shopping Tours
  // Wellness
  21924: 'wellness',   // Spa & Wellness
};

function guessActivityType(title: string, tags?: number[]): ActivityType {
  // Try tags first
  if (tags) {
    for (const tag of tags) {
      if (VIATOR_TAG_TO_ACTIVITY_TYPE[tag]) {
        return VIATOR_TAG_TO_ACTIVITY_TYPE[tag];
      }
    }
  }

  // Fallback: keyword matching on title
  const t = title.toLowerCase();
  if (/food|gastro|cook|wine|tast|tapas|culinar/i.test(t)) return 'gastronomy';
  if (/beach|surf|snorkel|dive|kayak|boat|sail|cruise/i.test(t)) return 'beach';
  if (/hike|trek|nature|wildlife|park|garden|mountain/i.test(t)) return 'nature';
  if (/museum|cathedral|church|palace|castle|histor|art|gallery|monument/i.test(t)) return 'culture';
  if (/adventure|zip|climb|bungee|paraglid|rafting/i.test(t)) return 'adventure';
  if (/night|club|bar|pub crawl/i.test(t)) return 'nightlife';
  if (/shop|market|boutique/i.test(t)) return 'shopping';
  if (/spa|wellness|massage|yoga/i.test(t)) return 'wellness';
  return 'culture'; // default
}

// ============================================
// Cache
// ============================================

function getCacheKey(destination: string, lat: number, lng: number): string {
  const key = `${destination}-${lat.toFixed(2)}-${lng.toFixed(2)}`;
  return key.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 200);
}

function readCache(key: string): Attraction[] | null {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }
    console.log(`[Viator Cache] ✅ Cache hit pour "${key}"`);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, attractions: Attraction[]): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify(attractions, null, 2)
    );
  } catch (error) {
    console.warn('[Viator Cache] Erreur écriture:', error);
  }
}

// ============================================
// API calls
// ============================================

interface ViatorProduct {
  productCode: string;
  title: string;
  description?: string;
  duration?: { fixedDurationInMinutes?: number; variableDurationFromMinutes?: number };
  pricing?: { summary?: { fromPrice?: number }; currency?: string };
  reviews?: { totalReviews?: number; combinedAverageRating?: number };
  images?: Array<{ variants?: Array<{ url?: string; width?: number; height?: number }> }>;
  tags?: number[];
  flags?: string[];
  destinations?: Array<{ ref?: string; primary?: boolean }>;
  productUrl?: string;
}

interface ViatorSearchResponse {
  products?: ViatorProduct[];
  totalCount?: number;
}

/**
 * Recherche la destination ID Viator pour une ville
 */
async function findDestinationId(destination: string): Promise<string | null> {
  if (!VIATOR_API_KEY) return null;

  try {
    // Note: freetext search works best in English for destination names
    const response = await fetch(`${VIATOR_BASE_URL}/search/freetext`, {
      method: 'POST',
      headers: {
        'exp-api-key': VIATOR_API_KEY,
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2.0',
      },
      body: JSON.stringify({
        searchTerm: destination,
        searchTypes: [{
          searchType: 'DESTINATIONS',
          pagination: { start: 1, count: 3 },
        }],
        currency: 'EUR',
      }),
    });

    if (!response.ok) {
      console.warn(`[Viator] Freetext search failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const destinations = data?.destinations?.results;
    if (destinations && destinations.length > 0) {
      const id = destinations[0].id || destinations[0].ref;
      console.log(`[Viator] Destination "${destination}" → ID ${id}`);
      return id ? String(id) : null;
    }
    console.log(`[Viator] Aucune destination trouvée pour "${destination}"`);
    return null;
  } catch (error) {
    console.warn('[Viator] Erreur recherche destination:', error);
    return null;
  }
}

/**
 * Recherche des activités Viator pour une destination
 */
export async function searchViatorActivities(
  destination: string,
  cityCenter: { lat: number; lng: number },
  options?: {
    types?: ActivityType[];
    limit?: number;
  }
): Promise<Attraction[]> {
  if (!VIATOR_API_KEY) {
    console.log('[Viator] API key non configurée, skip');
    return [];
  }

  const limit = options?.limit || 30;
  const cacheKey = getCacheKey(destination, cityCenter.lat, cityCenter.lng);

  // Check cache
  const cached = readCache(cacheKey);
  if (cached) return cached;

  console.log(`[Viator] 🔍 Recherche d'activités pour ${destination}...`);

  try {
    // 1. Find destination ID
    const destId = await findDestinationId(destination);

    // 2. Search products
    const searchBody: Record<string, unknown> = {
      currency: 'EUR',
      pagination: { start: 1, count: limit },
      sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
    };

    if (destId) {
      searchBody.filtering = { destination: destId };
    } else {
      // Fallback: search by coordinates with radius
      searchBody.filtering = {
        location: {
          coordinates: {
            latitude: cityCenter.lat,
            longitude: cityCenter.lng,
          },
          radius: 15,
          unit: 'km',
        },
      };
    }

    // Add quality tags filter
    searchBody.filtering = {
      ...searchBody.filtering as Record<string, unknown>,
      tags: [21972], // Excellent Quality tag
    };

    const response = await fetch(`${VIATOR_BASE_URL}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': VIATOR_API_KEY,
        'Accept-Language': 'fr-FR',
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2.0',
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      // If quality filter fails, retry without it
      if (response.status === 400) {
        console.log('[Viator] Retry sans filtre qualité...');
        delete (searchBody.filtering as Record<string, unknown>).tags;
        const retryResponse = await fetch(`${VIATOR_BASE_URL}/products/search`, {
          method: 'POST',
          headers: {
            'exp-api-key': VIATOR_API_KEY,
            'Accept-Language': 'fr-FR',
            'Content-Type': 'application/json',
            'Accept': 'application/json;version=2.0',
          },
          body: JSON.stringify(searchBody),
        });
        if (!retryResponse.ok) {
          console.warn(`[Viator] Search failed: ${retryResponse.status}`);
          return [];
        }
        const data: ViatorSearchResponse = await retryResponse.json();
        return processViatorResults(data, destination, cityCenter, cacheKey);
      }
      console.warn(`[Viator] Search failed: ${response.status}`);
      return [];
    }

    const data: ViatorSearchResponse = await response.json();
    return processViatorResults(data, destination, cityCenter, cacheKey);
  } catch (error) {
    console.warn('[Viator] Erreur recherche:', error);
    return [];
  }
}

/**
 * Cherche un produit Viator correspondant à une activité (ex: "Colosseum, Rome")
 * Retourne l'URL affiliée et le prix si un match est trouvé.
 * Utilise un fuzzy match sur le titre pour éviter les faux positifs.
 */
export async function findViatorProduct(
  activityName: string,
  destinationName: string,
): Promise<{ url: string; price: number; title: string } | null> {
  if (!VIATOR_API_KEY) return null;

  try {
    // Nettoyer le nom de l'activité pour la recherche
    const searchTerm = activityName
      .replace(/\b(visite|visit|tour|guided|entry|ticket|billet)\b/gi, '')
      .trim();

    const response = await fetch(`${VIATOR_BASE_URL}/search/freetext`, {
      method: 'POST',
      headers: {
        'exp-api-key': VIATOR_API_KEY,
        'Accept-Language': 'fr-FR',
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2.0',
      },
      body: JSON.stringify({
        searchTerm: `${searchTerm} ${destinationName}`,
        searchTypes: [{
          searchType: 'PRODUCTS',
          pagination: { start: 1, count: 5 },
        }],
        currency: 'EUR',
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const products = data?.products?.results || [];

    if (products.length === 0) return null;

    // Fuzzy match : vérifier que le produit correspond bien à l'activité
    const activityWords = activityName.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    for (const product of products) {
      const productTitle = (product.title || '').toLowerCase();
      // Au moins 1 mot significatif de l'activité doit être dans le titre Viator
      const matchCount = activityWords.filter(w => productTitle.includes(w)).length;
      const matchRatio = activityWords.length > 0 ? matchCount / activityWords.length : 0;

      if (matchRatio >= 0.3 || matchCount >= 2) {
        const price = product.pricing?.summary?.fromPrice || 0;
        const url = product.productUrl
          || `https://www.viator.com/tours/${encodeURIComponent(destinationName)}/${product.productCode}`;

        console.log(`[Viator] ✅ Match trouvé: "${activityName}" → "${product.title}" (${price}€)`);
        return { url, price: Math.round(price), title: product.title };
      }
    }

    return null;
  } catch (error) {
    console.warn(`[Viator] Erreur findViatorProduct("${activityName}"):`, error);
    return null;
  }
}

function processViatorResults(
  data: ViatorSearchResponse,
  destination: string,
  cityCenter: { lat: number; lng: number },
  cacheKey: string
): Attraction[] {
  const products = data.products || [];
  console.log(`[Viator] ${products.length} activités trouvées pour ${destination}`);

  if (products.length === 0) return [];

  const attractions: Attraction[] = products
    .filter(p => p.title && p.productCode)
    .map((p): Attraction => {
      // Get best image (medium size ~720px)
      let imageUrl: string | undefined;
      if (p.images?.[0]?.variants) {
        const variants = p.images[0].variants;
        // Prefer medium-sized image
        const medium = variants.find(v => v.width && v.width >= 480 && v.width <= 800);
        imageUrl = medium?.url || variants[0]?.url;
      }

      // Duration
      const durationMinutes = p.duration?.fixedDurationInMinutes
        || p.duration?.variableDurationFromMinutes
        || 90; // default 1h30

      // Price
      const price = p.pricing?.summary?.fromPrice || 0;

      // Rating
      const rating = p.reviews?.combinedAverageRating || 4.0;
      const reviewCount = p.reviews?.totalReviews || 0;

      // Use Viator's pre-built affiliate URL (includes tracking params)
      const affiliateUrl = p.productUrl
        || `https://www.viator.com/tours/${encodeURIComponent(destination)}/${p.productCode}`;

      return {
        id: `viator-${p.productCode}`,
        name: p.title,
        type: guessActivityType(p.title, p.tags),
        description: p.description?.substring(0, 200) || p.title,
        duration: durationMinutes,
        estimatedCost: Math.round(price),
        latitude: cityCenter.lat, // Viator doesn't always return exact coords
        longitude: cityCenter.lng,
        rating: Math.min(5, Math.round(rating * 10) / 10),
        mustSee: (reviewCount > 500 && rating >= 4.5),
        bookingRequired: true,
        bookingUrl: affiliateUrl,
        openingHours: { open: '09:00', close: '18:00' },
        dataReliability: 'verified',
        imageUrl,
        providerName: 'Viator',
        reviewCount,
      };
    });

  // Cache results
  if (attractions.length > 0) {
    writeCache(cacheKey, attractions);
  }

  console.log(`[Viator] ✅ ${attractions.length} activités mappées`);
  return attractions;
}

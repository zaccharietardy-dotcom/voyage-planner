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
import { findKnownViatorProduct } from './viatorKnownProducts';

const VIATOR_API_KEY = process.env.VIATOR_API_KEY?.trim();
const VIATOR_BASE_URL = 'https://api.viator.com/partner';

// Cache fichier 7 jours
const CACHE_DIR = path.join(process.cwd(), '.cache', 'viator');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export function isViatorConfigured(): boolean {
  return !!VIATOR_API_KEY;
}

/**
 * Build a Viator search URL as fallback
 * This always works even if we don't have the exact product URL
 */
function buildViatorSearchUrl(productTitle: string, destination: string): string {
  const searchQuery = `${productTitle} ${destination}`;
  return `https://www.viator.com/searchResults/all?text=${encodeURIComponent(searchQuery)}`;
}

/**
 * Validate and normalize a Viator product URL.
 * Priority: API productUrl (if valid viator.com URL) > search URL fallback.
 *
 * We don't try to construct product URLs from productCode alone because
 * Viator product URLs require a destination ID (e.g., d511 for Rome) that
 * the API doesn't always provide alongside the code.
 */
function normalizeViatorUrl(
  productUrl: string | undefined,
  productTitle: string,
  destination: string,
  _productCode?: string, // Reserved for future use if API provides dest ID
): string {
  // 1. Try API-provided productUrl (most reliable when present)
  if (productUrl && productUrl.trim() !== '') {
    // Relative URL → prepend Viator base
    if (productUrl.startsWith('/')) {
      return `https://www.viator.com${productUrl}`;
    }
    // Must be a proper http(s) URL on viator.com
    if (productUrl.startsWith('http')) {
      try {
        const url = new URL(productUrl);
        if (url.hostname.includes('viator.com')) {
          return productUrl;
        }
      } catch {
        // Invalid URL, fall through
      }
    }
  }

  // 2. Fallback: search URL (always shows relevant results)
  return buildViatorSearchUrl(productTitle, destination);
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
      return id ? String(id) : null;
    }
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
    maxPricePerActivity?: number;
  }
): Promise<Attraction[]> {
  if (!VIATOR_API_KEY) {
    return [];
  }

  const limit = options?.limit || 30;
  const cacheKey = getCacheKey(destination, cityCenter.lat, cityCenter.lng);

  // Check cache
  const cached = readCache(cacheKey);
  if (cached) return cached;

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
        return processViatorResults(data, destination, cityCenter, cacheKey, options?.maxPricePerActivity);
      }
      console.warn(`[Viator] Search failed: ${response.status}`);
      return [];
    }

    const data: ViatorSearchResponse = await response.json();
    return processViatorResults(data, destination, cityCenter, cacheKey, options?.maxPricePerActivity);
  } catch (error) {
    console.warn('[Viator] Erreur recherche:', error);
    return [];
  }
}

/**
 * Cherche un produit Viator correspondant à une activité (ex: "Colosseum, Rome")
 * Retourne l'URL affiliée et le prix si un match est trouvé.
 *
 * Ordre de priorité:
 * 1. URLs connues (viatorKnownProducts.ts) - garantie de qualité
 * 2. Exact match dans les résultats API
 * 3. Fuzzy match avec seuil strict (60%)
 */
export interface ViatorProductResult {
  url: string;
  price: number;
  title: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  duration?: number; // Durée en minutes du produit Viator
}

export async function findViatorProduct(
  activityName: string,
  destinationName: string,
): Promise<ViatorProductResult | null> {
  // ===== PRIORITÉ 1: URLs connues =====
  const knownProduct = findKnownViatorProduct(activityName);
  if (knownProduct) {
    return knownProduct;
  }

  if (!VIATOR_API_KEY) return null;

  try {
    // Nettoyer le nom de l'activité pour la recherche
    // Garder plus de mots pour une recherche plus précise
    const searchTerm = activityName
      .replace(/\b(visite|visit|guided|entry|billet)\b/gi, '')
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
          pagination: { start: 1, count: 10 }, // Plus de résultats pour mieux matcher
        }],
        currency: 'EUR',
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const products = data?.products?.results || [];

    if (products.length === 0) return null;

    // Filtrer les produits avec les keywords exclus
    const filteredProducts = products.filter((p: ViatorProduct) => {
      const titleLower = (p.title || '').toLowerCase();
      return !VIATOR_EXCLUDED_KEYWORDS.some(kw => titleLower.includes(kw));
    });

    if (filteredProducts.length === 0) return null;

    const activityNameLower = activityName.toLowerCase();
    const activityWords = activityNameLower.split(/\s+/).filter(w => w.length > 3);

    // ===== PRIORITÉ 2: Exact match =====
    // Le nom de l'activité est contenu dans le titre du produit OU vice-versa
    for (const product of filteredProducts) {
      const productTitle = (product.title || '').toLowerCase();
      const productTitleClean = productTitle.replace(/tour|visit|ticket|skip.*line|guided/gi, '').trim();

      // Exact match: le titre du produit contient le nom de l'activité
      if (productTitle.includes(activityNameLower) || activityNameLower.includes(productTitleClean)) {
        const price = product.pricing?.summary?.fromPrice || 0;
        const url = normalizeViatorUrl(product.productUrl, product.title, destinationName, product.productCode);
        const imageUrl = product.images?.[0]?.variants?.find((v: { width?: number; url?: string }) => v.width && v.width >= 480 && v.width <= 800)?.url || product.images?.[0]?.variants?.[0]?.url;
        const duration = product.duration?.fixedDurationInMinutes || product.duration?.variableDurationFromMinutes;
        return { url, price: Math.round(price), title: product.title, imageUrl, rating: product.reviews?.combinedAverageRating, reviewCount: product.reviews?.totalReviews, duration };
      }
    }

    // ===== PRIORITÉ 3: Fuzzy match avec seuil dynamique =====
    // Seuil plus strict pour les noms ambigus (palazzo, museum, church, etc.)
    const ambiguousNamePattern = /\b(palazzo|museum|musée|musee|church|église|eglise|basilica|basilique|temple|castle|château|chateau|cathedral|cathédrale|cathedrale|gallery|galerie)\b/i;
    const isAmbiguousName = ambiguousNamePattern.test(activityNameLower);
    const minThreshold = isAmbiguousName ? 0.75 : 0.6;

    let bestMatch: { product: ViatorProduct; score: number } | null = null;

    for (const product of filteredProducts) {
      const productTitle = (product.title || '').toLowerCase();
      const matchCount = activityWords.filter(w => productTitle.includes(w)).length;
      const matchRatio = activityWords.length > 0 ? matchCount / activityWords.length : 0;

      // Seuil dynamique: plus strict pour les noms ambigus (palazzo, museum, etc.)
      if (matchRatio >= minThreshold || (matchCount >= 3 && matchRatio >= 0.5)) {
        const score = matchRatio * 100 + matchCount * 10;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { product, score };
        }
      }
    }

    if (bestMatch) {
      const price = bestMatch.product.pricing?.summary?.fromPrice || 0;
      const url = normalizeViatorUrl(bestMatch.product.productUrl, bestMatch.product.title, destinationName, bestMatch.product.productCode);
      const imageUrl = bestMatch.product.images?.[0]?.variants?.find((v: { width?: number; url?: string }) => v.width && v.width >= 480 && v.width <= 800)?.url || bestMatch.product.images?.[0]?.variants?.[0]?.url;
      const duration = bestMatch.product.duration?.fixedDurationInMinutes || bestMatch.product.duration?.variableDurationFromMinutes;
      return { url, price: Math.round(price), title: bestMatch.product.title, imageUrl, rating: bestMatch.product.reviews?.combinedAverageRating, reviewCount: bestMatch.product.reviews?.totalReviews, duration };
    }

    return null;
  } catch (error) {
    console.warn(`[Viator] Erreur findViatorProduct("${activityName}"):`, error);
    return null;
  }
}

// Keywords to exclude from Viator results (venues, concerts, etc.)
const VIATOR_EXCLUDED_KEYWORDS = [
  // Concert halls & venues - on ne "visite" pas ces lieux sans spectacle
  'concertgebouw', 'concert hall', 'philharmonic', 'philharmonie',
  'opera house', 'symphony', 'orchestra performance',
  // Venues without actual tour value
  'ziggo dome', 'heineken music hall', 'melkweg', 'paradiso',
  'bimhuis', 'muziekgebouw', 'carré',
  // Generic photo spots
  'photo spot', 'instagram spot', 'selfie',
  // Tourist traps
  'madame tussauds', 'tussaud', 'wax museum', 'trick eye',
  'selfie museum', "ripley's",
  // Wellness/spa — non pertinent pour tourisme standard
  'massage', 'thai massage', 'spa treatment', 'hammam', 'thermal bath treatment',
  // Ultra-luxe inaccessible pour budgets normaux
  'private yacht', 'luxury sailing', 'private sailing', 'private boat charter',
  'helicopter', 'helicoptère', 'limousine', 'limo tour',
  'ferrari', 'lamborghini', 'supercar', 'sports car',
];

function processViatorResults(
  data: ViatorSearchResponse,
  destination: string,
  cityCenter: { lat: number; lng: number },
  cacheKey: string,
  maxPricePerActivity: number = 200
): Attraction[] {
  const products = data.products || [];
  if (products.length === 0) return [];

  const attractions: Attraction[] = products
    .filter(p => {
      if (!p.title || !p.productCode) return false;
      // Filter out excluded keywords
      const titleLower = p.title.toLowerCase();
      for (const kw of VIATOR_EXCLUDED_KEYWORDS) {
        if (titleLower.includes(kw)) {
          return false;
        }
      }
      // Filter out overpriced activities
      const price = p.pricing?.summary?.fromPrice || 0;
      if (price > maxPricePerActivity) {
        return false;
      }
      return true;
    })
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

      // Utiliser productUrl de l'API si disponible, sinon construire depuis productCode, sinon recherche
      const affiliateUrl = normalizeViatorUrl(p.productUrl, p.title, destination, p.productCode);

      return {
        id: `viator-${p.productCode}`,
        name: p.title,
        type: guessActivityType(p.title, p.tags),
        description: p.description?.substring(0, 200) || p.title,
        duration: durationMinutes,
        estimatedCost: Math.round(price),
        latitude: cityCenter.lat, // Viator doesn't return exact coords — resolved later via coordsResolver
        longitude: cityCenter.lng,
        rating: Math.min(5, Math.round(rating * 10) / 10),
        mustSee: (reviewCount > 500 && rating >= 4.5),
        bookingRequired: true,
        bookingUrl: affiliateUrl,
        openingHours: { open: '09:00', close: '18:00' },
        dataReliability: 'estimated', // coords are city center, not exact — will be resolved
        imageUrl,
        providerName: 'Viator',
        reviewCount,
      };
    });

  // Cache results
  if (attractions.length > 0) {
    writeCache(cacheKey, attractions);
  }

  return attractions;
}

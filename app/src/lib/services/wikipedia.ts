/**
 * Wikipedia REST API Service
 *
 * Fetches short summaries (extract) and thumbnails for attractions.
 * Free, no API key, 200 req/s rate limit.
 *
 * Uses the Wikipedia REST API v1:
 * https://en.wikipedia.org/api/rest_v1/page/summary/{title}
 *
 * Strategy:
 * 1. Try destination language first (fr for French destinations, etc.)
 * 2. Fallback to English Wikipedia
 * 3. Cache results for 30 days
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================
// Types
// ============================================

export interface WikipediaSummary {
  title: string;
  extract: string; // 1-3 sentence summary
  description?: string; // Short description (e.g., "Museum in Paris")
  thumbnailUrl?: string; // Thumbnail image URL
  pageUrl: string; // Full Wikipedia page URL
}

// ============================================
// Cache (file-based, 30 days TTL)
// ============================================

const CACHE_DIR = join(process.cwd(), '.cache', 'wikipedia');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getCachePath(key: string): string {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  // Sanitize key for filesystem
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  return join(CACHE_DIR, `${safeKey}.json`);
}

function readCache(key: string): WikipediaSummary | null | 'miss' {
  const path = getCachePath(key);
  if (!existsSync(path)) return 'miss';
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    if (Date.now() - raw.timestamp > CACHE_TTL_MS) return 'miss';
    return raw.data; // Can be null (negative cache)
  } catch {
    return 'miss';
  }
}

function writeCache(key: string, data: WikipediaSummary | null): void {
  try {
    const path = getCachePath(key);
    writeFileSync(path, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // Non-critical
  }
}

// ============================================
// Main API
// ============================================

/**
 * Fetch Wikipedia summary for an attraction/place.
 *
 * @param name - Place name (e.g., "Colosseum", "Tour Eiffel")
 * @param lang - Language code (defaults to 'en')
 * @returns Summary with extract and thumbnail, or null if not found
 */
export async function fetchWikipediaSummary(
  name: string,
  lang: string = 'en'
): Promise<WikipediaSummary | null> {
  const cacheKey = `wiki-${lang}-${name}`;
  const cached = readCache(cacheKey);
  if (cached !== 'miss') return cached;

  // Try the main language first, then English fallback
  const langs = lang === 'en' ? ['en'] : [lang, 'en'];

  for (const l of langs) {
    const result = await fetchFromWikipedia(name, l);
    if (result) {
      writeCache(cacheKey, result);
      return result;
    }
  }

  // Negative cache (don't retry for 30 days)
  writeCache(cacheKey, null);
  return null;
}

/**
 * Batch fetch Wikipedia summaries for multiple attractions.
 * Runs in parallel with concurrency limit.
 *
 * @param names - Array of place names
 * @param lang - Language code
 * @returns Map of name → summary (or null)
 */
export async function batchFetchWikipediaSummaries(
  names: string[],
  lang: string = 'en'
): Promise<Map<string, WikipediaSummary | null>> {
  const results = new Map<string, WikipediaSummary | null>();
  const CONCURRENCY = 5;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < names.length; i += CONCURRENCY) {
    const batch = names.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(name => fetchWikipediaSummary(name, lang))
    );

    batch.forEach((name, idx) => {
      const r = batchResults[idx];
      results.set(name, r.status === 'fulfilled' ? r.value : null);
    });
  }

  return results;
}

// ============================================
// Wikipedia API call
// ============================================

async function fetchFromWikipedia(
  name: string,
  lang: string
): Promise<WikipediaSummary | null> {
  try {
    // URL-encode the title (Wikipedia uses underscores)
    const title = encodeURIComponent(name.replace(/ /g, '_'));
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VoyagePlanner/1.0 (contact@voyageplanner.app)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (response.status === 404) {
      // Try with search API as fallback
      return await searchAndFetch(name, lang);
    }

    if (!response.ok) return null;

    const data = await response.json();

    // Skip disambiguation pages
    if (data.type === 'disambiguation') {
      return await searchAndFetch(name, lang);
    }

    // Must have an extract
    if (!data.extract || data.extract.length < 20) return null;

    return {
      title: data.title || name,
      extract: cleanExtract(data.extract),
      description: data.description || undefined,
      thumbnailUrl: data.thumbnail?.source || undefined,
      pageUrl: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${title}`,
    };
  } catch {
    return null;
  }
}

/**
 * Search Wikipedia and fetch the first result's summary.
 * Used when direct title lookup fails (e.g., "Chapelle Sixtine" → "Sistine Chapel")
 */
async function searchAndFetch(
  query: string,
  lang: string
): Promise<WikipediaSummary | null> {
  try {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'VoyagePlanner/1.0 (contact@voyageplanner.app)',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const results = data?.query?.search;
    if (!results || results.length === 0) return null;

    // Fetch summary for the first search result
    const title = results[0].title;
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;

    const summaryResponse = await fetch(summaryUrl, {
      headers: {
        'User-Agent': 'VoyagePlanner/1.0 (contact@voyageplanner.app)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!summaryResponse.ok) return null;

    const summaryData = await summaryResponse.json();
    if (!summaryData.extract || summaryData.extract.length < 20) return null;

    return {
      title: summaryData.title || title,
      extract: cleanExtract(summaryData.extract),
      description: summaryData.description || undefined,
      thumbnailUrl: summaryData.thumbnail?.source || undefined,
      pageUrl: summaryData.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Clean Wikipedia extract: trim to 2-3 sentences max,
 * remove parenthetical translations, clean up formatting.
 */
function cleanExtract(text: string): string {
  // Remove parenthetical translations like "(French: Tour Eiffel)"
  let cleaned = text.replace(/\s*\([^)]*(?:pronunciation|French|Italian|Spanish|Japanese|Arabic|Dutch|Portuguese|German|Chinese|Korean)[^)]*\)/gi, '');

  // Remove IPA pronunciations
  cleaned = cleaned.replace(/\s*\(\/[^)]+\/\)/g, '');

  // Remove double spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  // Split into sentences and take first 2-3
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  const maxSentences = sentences.length <= 3 ? sentences.length : 2;

  return sentences.slice(0, maxSentences).join(' ').trim();
}

/**
 * Detect the best Wikipedia language for a destination.
 */
export function getWikiLanguageForDestination(destination: string): string {
  const lower = destination.toLowerCase();

  // French-speaking destinations
  if (/paris|lyon|marseille|bordeaux|nice|strasbourg|lille|toulouse|nantes|montpellier|marrakech|tunis|bruxelles|genève|québec|montréal/i.test(lower)) {
    return 'fr';
  }

  // Italian
  if (/roma|rome|milano|milan|venezia|venice|firenze|florence|napoli|naples|torino|turin|bologna|genova/i.test(lower)) {
    return 'it';
  }

  // Spanish
  if (/madrid|barcelona|barcelone|sevilla|seville|valencia|malaga|bilbao|granada|toledo|buenos aires|mexico|cancun/i.test(lower)) {
    return 'es';
  }

  // German
  if (/berlin|münchen|munich|hamburg|frankfurt|köln|cologne|vienna|wien|zürich|zurich/i.test(lower)) {
    return 'de';
  }

  // Portuguese
  if (/lisboa|lisbon|lisbonne|porto|são paulo|rio de janeiro/i.test(lower)) {
    return 'pt';
  }

  // Japanese
  if (/tokyo|kyoto|osaka|hiroshima|nara|yokohama|sapporo|fukuoka/i.test(lower)) {
    return 'ja';
  }

  // Dutch
  if (/amsterdam|rotterdam|utrecht|den haag|la haye|bruges|brugge|gent/i.test(lower)) {
    return 'nl';
  }

  // Default to English
  return 'en';
}

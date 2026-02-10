/**
 * Wikimedia Commons / Wikipedia — Image lookup
 *
 * Uses the Wikipedia REST API to find the main image for a landmark/place.
 * Completely free, no API key required, no rate limit for reasonable usage.
 *
 * Strategy:
 * 1. Search Wikipedia for the place name
 * 2. Get the page's main image (thumbnail) at 600px width
 *
 * This is used as a fallback when Google Places / Viator / SerpAPI
 * don't provide an image for an activity.
 */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_API_FR = 'https://fr.wikipedia.org/w/api.php';

// Simple in-memory cache to avoid re-fetching during a single pipeline run
const imageCache = new Map<string, string | null>();

/**
 * Fetch the main Wikipedia image for a given place/landmark name.
 * Tries French Wikipedia first (better for European cities), then English.
 * Returns the image URL or null if not found.
 */
export async function fetchWikipediaImage(name: string): Promise<string | null> {
  if (!name || name.length < 3) return null;

  const cacheKey = name.toLowerCase().trim();
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey) || null;

  // Try French first (trip destinations are often European), then English
  const result = await tryWikipediaImage(name, WIKI_API_FR)
    || await tryWikipediaImage(name, WIKI_API);

  imageCache.set(cacheKey, result);
  return result;
}

async function tryWikipediaImage(name: string, apiBase: string): Promise<string | null> {
  try {
    // Step 1: Search for the page
    const searchUrl = new URL(apiBase);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', name);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');

    const searchRes = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const pageTitle = searchData?.query?.search?.[0]?.title;
    if (!pageTitle) return null;

    // Step 2: Get the page's main image (pageimages prop)
    const imageUrl = new URL(apiBase);
    imageUrl.searchParams.set('action', 'query');
    imageUrl.searchParams.set('titles', pageTitle);
    imageUrl.searchParams.set('prop', 'pageimages');
    imageUrl.searchParams.set('piprop', 'thumbnail');
    imageUrl.searchParams.set('pithumbsize', '600');
    imageUrl.searchParams.set('format', 'json');
    imageUrl.searchParams.set('origin', '*');

    const imageRes = await fetch(imageUrl.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!imageRes.ok) return null;

    const imageData = await imageRes.json();
    const pages = imageData?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0] as any;
    const thumbnail = page?.thumbnail?.source;

    if (thumbnail && typeof thumbnail === 'string') {
      return thumbnail;
    }

    return null;
  } catch (error) {
    // Silently fail — this is a best-effort fallback
    return null;
  }
}

/**
 * Batch fetch Wikipedia images for multiple activities.
 * Processes in parallel with concurrency limit to avoid overwhelming the API.
 */
export async function fetchWikipediaImagesBatch(
  names: string[],
  concurrency: number = 5
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const uniqueNames = [...new Set(names.filter(n => n && n.length >= 3))];

  // Process in batches
  for (let i = 0; i < uniqueNames.length; i += concurrency) {
    const batch = uniqueNames.slice(i, i + concurrency);
    const promises = batch.map(async (name) => {
      const url = await fetchWikipediaImage(name);
      if (url) results.set(name, url);
    });
    await Promise.all(promises);
  }

  return results;
}

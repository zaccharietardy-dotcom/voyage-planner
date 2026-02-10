/**
 * Image lookup service — Google Places + Wikipedia fallback
 *
 * Strategy:
 * 1. Google Places "Find Place" API → exact match by name + location bias
 *    Returns the place's official photo_reference → reliable image
 * 2. Fallback: Wikipedia API → main article thumbnail (free, no key)
 *
 * Google Places Find Place = 1 request per lookup ($0.017 each)
 * Photo URL = free (just constructs URL, browser fetches it directly)
 */

const GOOGLE_FIND_PLACE_URL = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
const WIKI_API_FR = 'https://fr.wikipedia.org/w/api.php';
const WIKI_API_EN = 'https://en.wikipedia.org/w/api.php';

// In-memory cache for a single pipeline run
const imageCache = new Map<string, string | null>();

function getApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

/**
 * Find an image for a place by name.
 * Uses Google Places (most reliable) then Wikipedia as fallback.
 */
export async function fetchPlaceImage(
  name: string,
  latitude?: number,
  longitude?: number
): Promise<string | null> {
  if (!name || name.length < 3) return null;

  const cacheKey = `${name.toLowerCase().trim()}|${latitude}|${longitude}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey) || null;

  // Try Google Places first (most reliable — photo tied to place_id)
  const apiKey = getApiKey();
  if (apiKey) {
    const googleImage = await fetchGooglePlacesImage(name, apiKey, latitude, longitude);
    if (googleImage) {
      imageCache.set(cacheKey, googleImage);
      return googleImage;
    }
  }

  // Fallback: Wikipedia
  const wikiImage = await fetchWikipediaImage(name);
  imageCache.set(cacheKey, wikiImage);
  return wikiImage;
}

/**
 * Google Places Find Place → extract photo_reference → build photo URL.
 * One API call per lookup. Returns null if no photo found.
 */
async function fetchGooglePlacesImage(
  name: string,
  apiKey: string,
  latitude?: number,
  longitude?: number
): Promise<string | null> {
  try {
    const url = new URL(GOOGLE_FIND_PLACE_URL);
    url.searchParams.set('input', name);
    url.searchParams.set('inputtype', 'textquery');
    url.searchParams.set('fields', 'photos,name');
    url.searchParams.set('language', 'fr');
    url.searchParams.set('key', apiKey);

    // Location bias: prefer results near the activity's GPS coordinates
    if (latitude && longitude) {
      url.searchParams.set('locationbias', `circle:5000@${latitude},${longitude}`);
    }

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const photoRef = candidate?.photos?.[0]?.photo_reference;

    if (!photoRef) return null;

    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${photoRef}&key=${apiKey}`;
  } catch {
    return null;
  }
}

/**
 * Wikipedia fallback: search for page → get main thumbnail.
 * Free, no API key. Tries French then English Wikipedia.
 */
export async function fetchWikipediaImage(name: string): Promise<string | null> {
  if (!name || name.length < 3) return null;

  return await tryWikipediaImage(name, WIKI_API_FR)
    || await tryWikipediaImage(name, WIKI_API_EN);
}

async function tryWikipediaImage(name: string, apiBase: string): Promise<string | null> {
  try {
    // Search for the page
    const searchUrl = new URL(apiBase);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', name);
    searchUrl.searchParams.set('srlimit', '1');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');

    const searchRes = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(5000) });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const pageTitle = searchData?.query?.search?.[0]?.title;
    if (!pageTitle) return null;

    // Get the page's main image
    const imageUrl = new URL(apiBase);
    imageUrl.searchParams.set('action', 'query');
    imageUrl.searchParams.set('titles', pageTitle);
    imageUrl.searchParams.set('prop', 'pageimages');
    imageUrl.searchParams.set('piprop', 'thumbnail');
    imageUrl.searchParams.set('pithumbsize', '600');
    imageUrl.searchParams.set('format', 'json');
    imageUrl.searchParams.set('origin', '*');

    const imageRes = await fetch(imageUrl.toString(), { signal: AbortSignal.timeout(5000) });
    if (!imageRes.ok) return null;

    const imageData = await imageRes.json();
    const pages = imageData?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0] as any;
    const thumbnail = page?.thumbnail?.source;

    return (thumbnail && typeof thumbnail === 'string') ? thumbnail : null;
  } catch {
    return null;
  }
}

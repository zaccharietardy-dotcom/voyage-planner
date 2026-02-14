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

type GooglePlaceCandidate = {
  name?: string;
  formatted_address?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
  photos?: Array<{
    photo_reference?: string;
  }>;
};

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }

  return intersection / Math.max(aTokens.size, bTokens.size);
}

function geoDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

export function scoreGooglePlaceCandidate(params: {
  queryName: string;
  candidate: GooglePlaceCandidate;
  latitude?: number;
  longitude?: number;
  destinationHint?: string;
}): number {
  const { queryName, candidate, latitude, longitude, destinationHint } = params;
  const candidateName = candidate.name || '';
  const normalizedQuery = normalizeText(queryName);
  const normalizedCandidate = normalizeText(candidateName);
  if (!normalizedQuery || !normalizedCandidate) return 0;

  let nameScore = 0;
  if (normalizedQuery === normalizedCandidate) {
    nameScore = 1;
  } else if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    nameScore = 0.9;
  } else {
    nameScore = tokenSimilarity(normalizedQuery, normalizedCandidate);
  }

  let geoScore = 0.5;
  const cLat = candidate.geometry?.location?.lat;
  const cLng = candidate.geometry?.location?.lng;
  if (latitude && longitude && typeof cLat === 'number' && typeof cLng === 'number') {
    const distance = geoDistanceKm(latitude, longitude, cLat, cLng);
    if (distance <= 0.5) geoScore = 1;
    else if (distance <= 2) geoScore = 0.85;
    else if (distance <= 5) geoScore = 0.6;
    else if (distance <= 10) geoScore = 0.35;
    else geoScore = 0.1;
  }

  let destinationScore = 0.5;
  if (destinationHint) {
    const normalizedHint = normalizeText(destinationHint);
    const addressText = normalizeText(candidate.formatted_address || '');
    destinationScore =
      addressText.includes(normalizedHint) || normalizedCandidate.includes(normalizedHint)
        ? 1
        : 0.2;
  }

  const hasCoordsInput = Boolean(latitude && longitude);
  const weighted =
    hasCoordsInput
      ? nameScore * 0.65 + geoScore * 0.3 + destinationScore * 0.05
      : nameScore * 0.85 + destinationScore * 0.15;

  const hasPhoto = Boolean(candidate.photos?.[0]?.photo_reference);
  return hasPhoto ? weighted : Math.max(0, weighted - 0.4);
}

/**
 * Find an image for a place by name.
 * Uses Google Places (most reliable) then Wikipedia as fallback.
 */
export async function fetchPlaceImage(
  name: string,
  latitude?: number,
  longitude?: number,
  destinationHint?: string
): Promise<string | null> {
  if (!name || name.length < 3) return null;

  const cacheKey = `${name.toLowerCase().trim()}|${latitude}|${longitude}|${normalizeText(destinationHint || '')}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey) || null;

  // Try Google Places first (most reliable — photo tied to place_id)
  const apiKey = getApiKey();
  if (apiKey) {
    const googleImage = await fetchGooglePlacesImage(
      name,
      apiKey,
      latitude,
      longitude,
      destinationHint
    );
    if (googleImage) {
      imageCache.set(cacheKey, googleImage);
      return googleImage;
    }
  }

  // Fallback: Wikipedia
  const wikiImage = await fetchWikipediaImage(name, destinationHint);
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
  longitude?: number,
  destinationHint?: string
): Promise<string | null> {
  try {
    const url = new URL(GOOGLE_FIND_PLACE_URL);
    const query = destinationHint ? `${name} ${destinationHint}` : name;
    url.searchParams.set('input', query);
    url.searchParams.set('inputtype', 'textquery');
    url.searchParams.set('fields', 'photos,name,formatted_address,geometry');
    url.searchParams.set('language', 'fr');
    url.searchParams.set('key', apiKey);

    // Location bias: prefer results near the activity's GPS coordinates
    if (latitude && longitude) {
      url.searchParams.set('locationbias', `circle:5000@${latitude},${longitude}`);
    }

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;

    const data = await res.json();
    const candidates = Array.isArray(data?.candidates)
      ? (data.candidates as GooglePlaceCandidate[])
      : [];
    if (candidates.length === 0) return null;

    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreGooglePlaceCandidate({
          queryName: name,
          candidate,
          latitude,
          longitude,
          destinationHint,
        }),
      }))
      .sort((a, b) => b.score - a.score);

    const minScore = latitude && longitude ? 0.55 : 0.62;
    const best = scored[0];
    if (!best || best.score < minScore) return null;

    const photoRef = best.candidate.photos?.[0]?.photo_reference;
    if (!photoRef) return null;

    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${apiKey}`;
  } catch {
    return null;
  }
}

/**
 * Fetch a restaurant photo by Google Place ID.
 * Uses Place Details API ($0.005/call) — much cheaper than Find Place ($0.017).
 * Returns the first photo URL at maxwidth=800 for high quality.
 */
export async function fetchRestaurantPhotoByPlaceId(
  placeId: string,
  apiKey?: string
): Promise<string | null> {
  const key = apiKey || getApiKey();
  if (!key || !placeId) return null;

  const cacheKey = `place_id:${placeId}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey) || null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'photos');
    url.searchParams.set('key', key);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) { imageCache.set(cacheKey, null); return null; }

    const data = await res.json();
    if (data.status !== 'OK') { imageCache.set(cacheKey, null); return null; }

    const photoRef = data.result?.photos?.[0]?.photo_reference;
    if (!photoRef) { imageCache.set(cacheKey, null); return null; }

    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${key}`;
    imageCache.set(cacheKey, photoUrl);
    return photoUrl;
  } catch {
    imageCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Wikipedia fallback: search for page → get main thumbnail.
 * Free, no API key. Tries French then English Wikipedia.
 */
export async function fetchWikipediaImage(name: string, destinationHint?: string): Promise<string | null> {
  if (!name || name.length < 3) return null;

  const contextualName = destinationHint ? `${name} ${destinationHint}` : name;
  return await tryWikipediaImage(contextualName, WIKI_API_FR)
    || await tryWikipediaImage(name, WIKI_API_FR)
    || await tryWikipediaImage(contextualName, WIKI_API_EN)
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

    const searchRes = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(3000) });
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
    imageUrl.searchParams.set('pithumbsize', '400');
    imageUrl.searchParams.set('format', 'json');
    imageUrl.searchParams.set('origin', '*');

    const imageRes = await fetch(imageUrl.toString(), { signal: AbortSignal.timeout(3000) });
    if (!imageRes.ok) return null;

    const imageData = await imageRes.json();
    const pages = imageData?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0] as { thumbnail?: { source?: string } };
    const thumbnail = page?.thumbnail?.source;

    return (thumbnail && typeof thumbnail === 'string') ? thumbnail : null;
  } catch {
    return null;
  }
}

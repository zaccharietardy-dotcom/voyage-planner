/**
 * SNCF (French National Railway) API integration
 *
 * Uses the official SNCF API at api.sncf.com
 * Covers French train routes (TGV, TER, Intercités, etc.)
 * Requires API key via SNCF_API_KEY env variable
 */

export interface SncfJourney {
  duration: number;        // minutes
  departureTime: string;   // ISO
  arrivalTime: string;     // ISO
  sections: SncfSection[];
  transfers: number;
}

export interface SncfSection {
  mode: string;           // 'TGV INOUI', 'TER', 'INTERCITES', 'RER', etc.
  trainNumber: string;    // e.g. '6607'
  from: string;           // station name
  to: string;
  departure: string;      // ISO
  arrival: string;        // ISO
  duration: number;       // minutes
}

// Known French city admin codes for the SNCF journeys endpoint
const FRENCH_CITY_CODES: Record<string, string> = {
  paris: 'admin:fr:75056',
  lyon: 'admin:fr:69123',
  marseille: 'admin:fr:13055',
  bordeaux: 'admin:fr:33063',
  toulouse: 'admin:fr:31555',
  nice: 'admin:fr:06088',
  strasbourg: 'admin:fr:67482',
  lille: 'admin:fr:59350',
  nantes: 'admin:fr:44109',
  rennes: 'admin:fr:35238',
  montpellier: 'admin:fr:34172',
};

const SNCF_API_BASE = 'https://api.sncf.com/v1/coverage/sncf';
const TIMEOUT_MS = 6000; // Keep short for Vercel serverless

// In-memory cache for city codes (permanent)
const cityCodeCache = new Map<string, string>();

// In-memory cache for journey results (route+date -> journeys)
const journeyCache = new Map<string, { data: SncfJourney[]; timestamp: number }>();
const JOURNEY_CACHE_TTL = 3600_000; // 1 hour

/**
 * Build Basic Auth header from SNCF API key
 */
function getAuthHeader(): string {
  const apiKey = process.env.SNCF_API_KEY;
  if (!apiKey) {
    throw new Error('SNCF_API_KEY environment variable is not set');
  }
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

/**
 * Format a Date to SNCF datetime format: YYYYMMDDTHHMMSS
 */
function formatSncfDatetime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}`;
}

/**
 * Parse SNCF datetime (YYYYMMDDTHHMMSS) to ISO string
 */
function parseSncfDatetime(dt: string): string {
  // Format: 20260201T080000
  if (!dt || dt.length < 15) return dt;
  const iso = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}`;
  return iso;
}

/**
 * Calculate duration in minutes between two ISO datetime strings
 */
function parseDuration(departure: string, arrival: string): number {
  const dep = new Date(departure).getTime();
  const arr = new Date(arrival).getTime();
  return Math.round((arr - dep) / 60000);
}

/**
 * Check if a city name is a known French city
 */
function isFrenchCity(city: string): boolean {
  const normalized = city.toLowerCase().trim();
  if (FRENCH_CITY_CODES[normalized]) return true;
  for (const frCity of Object.keys(FRENCH_CITY_CODES)) {
    if (normalized.includes(frCity) || frCity.includes(normalized)) return true;
  }
  return false;
}

/**
 * Find admin code for a city name (with cache)
 * Returns the SNCF admin code or null if not found
 */
export async function findSncfCityCode(cityName: string): Promise<string | null> {
  const cacheKey = cityName.toLowerCase().trim();

  // Check known cities first
  if (FRENCH_CITY_CODES[cacheKey]) {
    return FRENCH_CITY_CODES[cacheKey];
  }

  // Check cache
  if (cityCodeCache.has(cacheKey)) {
    return cityCodeCache.get(cacheKey)!;
  }

  try {
    const url = `${SNCF_API_BASE}/places?q=${encodeURIComponent(cityName)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: getAuthHeader() },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[SNCF API] HTTP ${res.status} for places query "${cityName}"`);
      return null;
    }

    const data = await res.json();
    // Look for administrative_region with admin code
    const places = data.places || [];
    for (const place of places) {
      if (place.embedded_type === 'administrative_region' && place.administrative_region?.id) {
        const adminId = place.administrative_region.id as string;
        cityCodeCache.set(cacheKey, adminId);
        console.log(`[SNCF API] Found city code for "${cityName}": ${adminId}`);
        return adminId;
      }
    }

    // Fallback: use first stop_area if no admin region found
    for (const place of places) {
      if (place.embedded_type === 'stop_area' && place.stop_area?.id) {
        const stopId = place.stop_area.id as string;
        cityCodeCache.set(cacheKey, stopId);
        console.log(`[SNCF API] Found stop area for "${cityName}": ${stopId}`);
        return stopId;
      }
    }

    console.warn(`[SNCF API] No city code found for "${cityName}"`);
    return null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[SNCF API] Timeout for places query "${cityName}"`);
    } else {
      console.warn(`[SNCF API] Error finding city code:`, err instanceof Error ? err.message : err);
    }
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJourney(journey: any): SncfJourney | null {
  const rawSections = journey.sections || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transportSections = rawSections.filter((s: any) => s.type === 'public_transport');

  if (transportSections.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections: SncfSection[] = transportSections.map((s: any) => {
    const info = s.display_informations || {};
    const dep = parseSncfDatetime(s.departure_date_time || '');
    const arr = parseSncfDatetime(s.arrival_date_time || '');
    return {
      mode: info.commercial_mode || info.network || 'Train',
      trainNumber: info.headsign || '',
      from: s.from?.name || s.from?.stop_point?.name || '?',
      to: s.to?.name || s.to?.stop_point?.name || '?',
      departure: dep,
      arrival: arr,
      duration: dep && arr ? parseDuration(dep, arr) : Math.round((s.duration || 0) / 60),
    };
  });

  const departureTime = parseSncfDatetime(journey.departure_date_time || '');
  const arrivalTime = parseSncfDatetime(journey.arrival_date_time || '');

  return {
    duration: journey.duration ? Math.round(journey.duration / 60) : parseDuration(departureTime, arrivalTime),
    departureTime,
    arrivalTime,
    sections,
    transfers: Math.max(0, sections.length - 1),
  };
}

/**
 * Search train journeys between two French cities
 * Returns up to 5 journeys with schedule information (no prices available)
 */
export async function searchSncfJourneys(
  origin: string,
  destination: string,
  date?: Date
): Promise<SncfJourney[]> {
  // Check cache
  const dateStr = date ? date.toISOString().split('T')[0] : 'anytime';
  const cacheKey = `${origin.toLowerCase()}→${destination.toLowerCase()}→${dateStr}`;
  const cached = journeyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < JOURNEY_CACHE_TTL) {
    console.log(`[SNCF API] Cache hit for ${origin} → ${destination}`);
    return cached.data;
  }

  console.log(`[SNCF API] Searching ${origin} → ${destination} on ${dateStr}`);

  // Only search if at least one city is French
  if (!isFrenchCity(origin) && !isFrenchCity(destination)) {
    console.log(`[SNCF API] Skipping: no French city in route (${origin} → ${destination})`);
    return [];
  }

  // Resolve city codes
  const [fromCode, toCode] = await Promise.all([
    findSncfCityCode(origin),
    findSncfCityCode(destination),
  ]);

  if (!fromCode || !toCode) {
    console.warn(`[SNCF API] Could not resolve city codes: from=${fromCode}, to=${toCode}`);
    return [];
  }

  try {
    const params = new URLSearchParams({
      from: fromCode,
      to: toCode,
    });

    if (date) {
      params.set('datetime', formatSncfDatetime(date));
    }

    const url = `${SNCF_API_BASE}/journeys?${params}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: getAuthHeader() },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[SNCF API] HTTP ${res.status} for ${origin} → ${destination}`);
      return [];
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const journeys: SncfJourney[] = (data.journeys || [])
      .map((j: Record<string, unknown>) => parseJourney(j))
      .filter((j: SncfJourney | null): j is SncfJourney => j !== null);

    // Cache results
    journeyCache.set(cacheKey, { data: journeys, timestamp: Date.now() });

    console.log(`[SNCF API] Found ${journeys.length} journeys for ${origin} → ${destination}, trains: ${journeys.map(j => j.sections.map(s => `${s.mode} ${s.trainNumber}`).join('+')).join(', ')}`);
    return journeys;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[SNCF API] Timeout for ${origin} → ${destination}`);
    } else {
      console.warn(`[SNCF API] Error:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}

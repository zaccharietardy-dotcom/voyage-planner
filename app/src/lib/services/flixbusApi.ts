/**
 * FlixBus RapidAPI integration
 *
 * Autocomplete stations and schedule lookups via flixbus2.p.rapidapi.com
 * No trip search or pricing — only schedule and autocomplete endpoints
 */

export interface FlixbusStation {
  id: string;         // UUID
  name: string;
  cityName: string;
  cityId: string;
  lat: number;
  lon: number;
  isTrain: boolean;
}

export interface FlixbusDeparture {
  time: string;        // "HH:MM"
  lineCode: string;    // "N729"
  direction: string;
  stops: string[];     // names of intermediate stops
  delay: number;
  isCancelled: boolean;
}

interface RawStation {
  id: string;
  name: string;
  city?: { name?: string; id?: string };
  location?: { lat?: number; lon?: number };
  is_train?: boolean;
}

interface RawDeparture {
  time?: string;
  line_code?: string;
  direction?: string;
  stops?: Array<{ name?: string } | string>;
  delay?: number;
  is_cancelled?: boolean;
}

const FLIXBUS_BASE = 'https://flixbus2.p.rapidapi.com';
const TIMEOUT_MS = 6000;

// Permanent cache for station lookups (query → stations)
const stationCache = new Map<string, FlixbusStation[]>();

// Schedule cache with 1-hour TTL
const scheduleCache = new Map<string, { data: FlixbusDeparture[]; timestamp: number }>();
const SCHEDULE_CACHE_TTL = 3600_000; // 1 hour

function getHeaders(): Record<string, string> | null {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.warn('[FlixBus API] RAPIDAPI_KEY not set — returning empty results');
    return null;
  }
  return {
    'x-rapidapi-host': 'flixbus2.p.rapidapi.com',
    'x-rapidapi-key': key,
  };
}

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function parseStation(raw: RawStation): FlixbusStation {
  return {
    id: raw.id,
    name: raw.name || '',
    cityName: raw.city?.name || '',
    cityId: raw.city?.id || '',
    lat: raw.location?.lat || 0,
    lon: raw.location?.lon || 0,
    isTrain: raw.is_train || false,
  };
}

function parseDeparture(raw: RawDeparture): FlixbusDeparture {
  const stops: string[] = (raw.stops || []).map((s) =>
    typeof s === 'string' ? s : (s.name || '')
  ).filter(Boolean);

  return {
    time: raw.time || '',
    lineCode: raw.line_code || '',
    direction: raw.direction || '',
    stops,
    delay: raw.delay || 0,
    isCancelled: raw.is_cancelled || false,
  };
}

/**
 * Search stations by city name (returns all stations in that city)
 */
export async function searchFlixbusStations(query: string): Promise<FlixbusStation[]> {
  const cacheKey = query.toLowerCase().trim();
  if (stationCache.has(cacheKey)) {
    console.log(`[FlixBus API] Station cache hit for "${query}"`);
    return stationCache.get(cacheKey)!;
  }

  const headers = getHeaders();
  if (!headers) return [];

  try {
    const url = `${FLIXBUS_BASE}/autocomplete?query=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[FlixBus API] HTTP ${res.status} for autocomplete "${query}"`);
      return [];
    }

    const raw: RawStation[] = await res.json();
    const stations = raw.map(parseStation);

    // Cache permanently
    stationCache.set(cacheKey, stations);

    console.log(`[FlixBus API] Found ${stations.length} stations for "${query}"`);
    return stations;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[FlixBus API] Timeout for autocomplete "${query}"`);
    } else {
      console.warn(`[FlixBus API] Error:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}

/**
 * Get departures from a station, optionally filtered by destination city
 */
export async function getFlixbusDepartures(
  stationId: string,
  date: Date,
  destinationCity?: string
): Promise<FlixbusDeparture[]> {
  const dateStr = formatDate(date);
  const cacheKey = `${stationId}:${dateStr}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SCHEDULE_CACHE_TTL) {
    console.log(`[FlixBus API] Schedule cache hit for ${stationId} on ${dateStr}`);
    return filterByDestination(cached.data, destinationCity);
  }

  const headers = getHeaders();
  if (!headers) return [];

  try {
    const url = `${FLIXBUS_BASE}/schedule?station_id=${encodeURIComponent(stationId)}&date=${dateStr}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[FlixBus API] HTTP ${res.status} for schedule ${stationId}`);
      return [];
    }

    const data = await res.json();
    const rawDepartures: RawDeparture[] = data?.schedule?.departures || [];
    const departures = rawDepartures.map(parseDeparture);

    // Cache for 1 hour
    scheduleCache.set(cacheKey, { data: departures, timestamp: Date.now() });

    console.log(`[FlixBus API] Found ${departures.length} departures from ${stationId} on ${dateStr}`);
    return filterByDestination(departures, destinationCity);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[FlixBus API] Timeout for schedule ${stationId}`);
    } else {
      console.warn(`[FlixBus API] Error:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}

/**
 * Filter departures where direction or any stop name contains the destination city
 */
function filterByDestination(
  departures: FlixbusDeparture[],
  destinationCity?: string
): FlixbusDeparture[] {
  if (!destinationCity) return departures;

  const needle = destinationCity.toLowerCase().trim();
  return departures.filter((d) => {
    if (d.direction.toLowerCase().includes(needle)) return true;
    return d.stops.some((stop) => stop.toLowerCase().includes(needle));
  });
}

/**
 * Find the main bus station for a city (first result, typically the largest)
 */
export async function findMainFlixbusStation(city: string): Promise<FlixbusStation | null> {
  const stations = await searchFlixbusStations(city);
  if (stations.length === 0) return null;

  // Prefer non-train stations (actual bus stations)
  const busStation = stations.find((s) => !s.isTrain);
  return busStation || stations[0];
}

/**
 * Build a FlixBus booking URL using city IDs for better deep-linking
 * Falls back to city names if station lookup fails
 */
export async function buildFlixbusBookingUrl(
  origin: string,
  destination: string,
  date?: Date,
  passengers: number = 1
): Promise<string> {
  // Try to resolve city IDs for better URL
  const [originStation, destStation] = await Promise.all([
    findMainFlixbusStation(origin).catch(() => null),
    findMainFlixbusStation(destination).catch(() => null),
  ]);

  const flixDate = date
    ? `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
    : '';

  // If we have city IDs, use them for a direct search URL
  if (originStation?.cityId && destStation?.cityId) {
    return `https://shop.flixbus.fr/search?departureCity=${originStation.cityId}&arrivalCity=${destStation.cityId}${flixDate ? `&rideDate=${flixDate}` : ''}&adult=${passengers}`;
  }

  // Fallback: use city names
  return `https://shop.flixbus.fr/search?departureCity=${encodeURIComponent(origin)}&arrivalCity=${encodeURIComponent(destination)}${flixDate ? `&rideDate=${flixDate}` : ''}&adult=${passengers}`;
}

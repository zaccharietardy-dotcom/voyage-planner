/**
 * Deutsche Bahn Transport REST API integration
 *
 * Uses the free public API at v6.db.transport.rest
 * Covers European train routes with real prices and schedules
 * No API key required
 */

export interface DBJourney {
  duration: number;       // minutes
  price: number | null;   // EUR
  legs: DBLeg[];
  departureTime: string;
  arrivalTime: string;
  transfers: number;
}

export interface DBLeg {
  mode: 'train' | 'bus' | 'ferry' | 'walk' | 'transfer';
  from: string;
  to: string;
  departure: string;
  arrival: string;
  duration: number;       // minutes
  operator?: string;
  line?: string;          // e.g. "ICE 775", "TER 3330"
  direction?: string;
}

interface DBAPILocation {
  type: string;
  id: string;
  name: string;
  location?: { latitude: number; longitude: number };
}

interface DBAPILeg {
  origin?: { name?: string };
  destination?: { name?: string };
  departure?: string;
  arrival?: string;
  walking?: boolean;
  transfer?: boolean;
  line?: { name?: string; operator?: { name?: string }; mode?: string; product?: string };
}

interface DBAPIJourney {
  legs?: DBAPILeg[];
  price?: { amount?: number; currency?: string };
}

const DB_API_BASE = 'https://v6.db.transport.rest';
const TIMEOUT_MS = 12000;

// Countries/regions covered well by the DB API
// Outside Europe, results are unreliable (e.g. "Tokyo" resolves to a German location)
const EUROPEAN_COUNTRY_CITIES = new Set([
  // Major European cities (non-exhaustive, just for filtering)
  'paris', 'lyon', 'marseille', 'bordeaux', 'toulouse', 'nice', 'strasbourg',
  'lille', 'nantes', 'rennes', 'montpellier', 'caen', 'rouen', 'tours', 'dijon',
  'avignon', 'angers', 'le mans', 'grenoble', 'clermont-ferrand',
  'london', 'manchester', 'edinburgh', 'birmingham', 'glasgow', 'liverpool', 'bristol',
  'berlin', 'munich', 'frankfurt', 'hamburg', 'cologne', 'stuttgart', 'dusseldorf', 'dresden', 'leipzig', 'nuremberg',
  'rome', 'milan', 'florence', 'venice', 'naples', 'turin', 'bologna', 'genoa',
  'madrid', 'barcelona', 'valencia', 'seville', 'malaga', 'bilbao', 'zaragoza',
  'amsterdam', 'rotterdam', 'utrecht', 'the hague',
  'brussels', 'antwerp', 'ghent', 'bruges',
  'zurich', 'geneva', 'bern', 'basel', 'lausanne', 'lucerne',
  'vienna', 'salzburg', 'innsbruck', 'graz',
  'prague', 'brno',
  'budapest',
  'warsaw', 'krakow', 'wroclaw', 'gdansk',
  'copenhagen', 'aarhus',
  'stockholm', 'gothenburg', 'malmo',
  'oslo', 'bergen',
  'helsinki',
  'lisbon', 'porto',
  'dublin',
  'athens', 'thessaloniki',
  'bucharest',
  'zagreb', 'split',
  'ljubljana',
  'bratislava',
]);

function isEuropeanCity(city: string): boolean {
  const normalized = city.toLowerCase().trim();
  // Direct match
  if (EUROPEAN_COUNTRY_CITIES.has(normalized)) return true;
  // Partial match (e.g. "Paris Nord" contains "paris")
  for (const eurCity of EUROPEAN_COUNTRY_CITIES) {
    if (normalized.includes(eurCity) || eurCity.includes(normalized)) return true;
  }
  return false;
}

// In-memory cache for station IDs (city name → station ID)
const stationCache = new Map<string, string>();

// In-memory cache for journey results (route+date → journeys)
const journeyCache = new Map<string, { data: DBJourney[]; timestamp: number }>();
const JOURNEY_CACHE_TTL = 3600_000; // 1 hour

/**
 * Find the main station ID for a city name
 */
async function findStation(cityName: string): Promise<string | null> {
  const cacheKey = cityName.toLowerCase().trim();
  if (stationCache.has(cacheKey)) {
    return stationCache.get(cacheKey)!;
  }

  try {
    const url = `${DB_API_BASE}/locations?query=${encodeURIComponent(cityName)}&results=3&fuzzy=true`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const locations: DBAPILocation[] = await res.json();
    // Prefer stations (type: 'stop' or 'station') over addresses
    const station = locations.find(l => l.type === 'stop' || l.type === 'station') || locations[0];
    if (!station?.id) return null;

    stationCache.set(cacheKey, station.id);
    return station.id;
  } catch (err) {
    console.warn(`[DB API] Failed to find station for "${cityName}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Parse ISO duration or calculate from departure/arrival
 */
function parseDuration(departure: string, arrival: string): number {
  const dep = new Date(departure).getTime();
  const arr = new Date(arrival).getTime();
  return Math.round((arr - dep) / 60000);
}

/**
 * Search for train journeys between two cities
 * Returns up to 5 journeys with prices when available
 */
export async function searchTrainJourneys(
  origin: string,
  destination: string,
  date?: Date,
  results: number = 5
): Promise<DBJourney[]> {
  // Check cache
  const dateStr = date ? date.toISOString().split('T')[0] : 'anytime';
  const cacheKey = `${origin.toLowerCase()}→${destination.toLowerCase()}→${dateStr}`;
  const cached = journeyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < JOURNEY_CACHE_TTL) {
    console.log(`[DB API] Cache hit for ${origin} → ${destination}`);
    return cached.data;
  }

  console.log(`[DB API] Searching ${origin} → ${destination} on ${dateStr}`);

  // Only use DB API for European routes
  if (!isEuropeanCity(origin) || !isEuropeanCity(destination)) {
    console.log(`[DB API] Skipping: non-European route (${origin} → ${destination})`);
    return [];
  }

  // Find station IDs
  const [fromId, toId] = await Promise.all([
    findStation(origin),
    findStation(destination),
  ]);

  if (!fromId || !toId) {
    console.warn(`[DB API] Could not find stations: from=${fromId}, to=${toId}`);
    return [];
  }

  try {
    const params = new URLSearchParams({
      from: fromId,
      to: toId,
      results: String(results),
      tickets: 'true',
      // Only include trains, not buses or walking
      nationalExpress: 'true',
      national: 'true',
      regionalExpress: 'true',
      regional: 'true',
      suburban: 'false',
      bus: 'false',
      ferry: 'true',
      subway: 'false',
      tram: 'false',
      taxi: 'false',
    });

    if (date) {
      params.set('departure', date.toISOString());
    }

    const url = `${DB_API_BASE}/journeys?${params}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[DB API] HTTP ${res.status} for ${origin} → ${destination}`);
      return [];
    }

    const data = await res.json();
    const journeys: DBJourney[] = (data.journeys || [])
      .map((j: DBAPIJourney) => parseJourney(j))
      .filter((j: DBJourney | null): j is DBJourney => j !== null);

    // Cache results
    journeyCache.set(cacheKey, { data: journeys, timestamp: Date.now() });

    console.log(`[DB API] Found ${journeys.length} journeys for ${origin} → ${destination}, prices: ${journeys.map(j => j.price ? `${j.price}€` : 'N/A').join(', ')}`);
    return journeys;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[DB API] Timeout for ${origin} → ${destination}`);
    } else {
      console.warn(`[DB API] Error:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}

function parseJourney(j: DBAPIJourney): DBJourney | null {
  if (!j.legs || j.legs.length === 0) return null;

  const legs: DBLeg[] = j.legs
    .filter((leg: DBAPILeg) => !leg.walking && !leg.transfer)
    .map((leg: DBAPILeg) => ({
      mode: (leg.line?.mode === 'bus' ? 'bus' : 'train') as DBLeg['mode'],
      from: leg.origin?.name || '?',
      to: leg.destination?.name || '?',
      departure: leg.departure || '',
      arrival: leg.arrival || '',
      duration: leg.departure && leg.arrival ? parseDuration(leg.departure, leg.arrival) : 0,
      operator: leg.line?.operator?.name,
      line: leg.line?.name,
    }));

  if (legs.length === 0) return null;

  const firstLeg = j.legs[0];
  const lastLeg = j.legs[j.legs.length - 1];
  const departure = firstLeg.departure || '';
  const arrival = lastLeg.arrival || '';

  return {
    duration: departure && arrival ? parseDuration(departure, arrival) : legs.reduce((sum, l) => sum + l.duration, 0),
    price: j.price?.amount ?? null,
    legs,
    departureTime: departure,
    arrivalTime: arrival,
    transfers: Math.max(0, legs.length - 1),
  };
}

/**
 * Get the cheapest price from DB API for a route
 * Returns { price, duration, operator } or null
 */
export async function getCheapestTrainPrice(
  origin: string,
  destination: string,
  date?: Date
): Promise<{ price: number; duration: number; operator: string; departureTime: string; arrivalTime: string; transfers: number; dataSource: 'api' } | null> {
  const journeys = await searchTrainJourneys(origin, destination, date, 5);

  // Filter journeys that have prices
  const withPrices = journeys.filter(j => j.price !== null && j.price > 0);

  if (withPrices.length === 0) {
    // Even without prices, return duration info if available
    if (journeys.length > 0) {
      const best = journeys[0];
      const operator = best.legs[0]?.operator || best.legs[0]?.line || 'Train';
      return {
        price: 0, // Signal that price is unknown
        duration: best.duration,
        operator: String(operator),
        departureTime: best.departureTime,
        arrivalTime: best.arrivalTime,
        transfers: best.transfers,
        dataSource: 'api',
      };
    }
    return null;
  }

  // Find cheapest
  const cheapest = withPrices.reduce((a, b) => (a.price! < b.price! ? a : b));
  const operator = cheapest.legs[0]?.operator || cheapest.legs[0]?.line || 'Train';

  return {
    price: cheapest.price!,
    duration: cheapest.duration,
    operator: String(operator),
    departureTime: cheapest.departureTime,
    arrivalTime: cheapest.arrivalTime,
    transfers: cheapest.transfers,
    dataSource: 'api',
  };
}

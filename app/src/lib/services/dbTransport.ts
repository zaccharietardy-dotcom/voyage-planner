/**
 * Train Schedule API — horaires réels de trains européens
 *
 * Chaîne de priorité :
 * 1. Google Directions API (mode=transit) — fiable, précis, nécessite GOOGLE_MAPS_API_KEY
 * 2. Transitous/MOTIS API — gratuit, couverture paneuropéenne, pas de prix
 * 3. Retourne [] → le caller utilise les known routes + estimations
 *
 * Remplace l'ancien DB HAFAS (v6.db.transport.rest) qui est mort depuis jan 2025.
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
  line?: string;          // e.g. "ICE 775", "TGV 9713", "Eurostar 9014"
  direction?: string;
}

function getGoogleMapsKey() { return process.env.GOOGLE_MAPS_API_KEY; }
const TIMEOUT_MS = 8000;

// Coordonnées des principales villes européennes pour Google + Transitous
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  // France
  'paris': { lat: 48.8566, lng: 2.3522 },
  'lyon': { lat: 45.7640, lng: 4.8357 },
  'marseille': { lat: 43.2965, lng: 5.3698 },
  'bordeaux': { lat: 44.8378, lng: -0.5792 },
  'toulouse': { lat: 43.6047, lng: 1.4442 },
  'nice': { lat: 43.7102, lng: 7.2620 },
  'strasbourg': { lat: 48.5734, lng: 7.7521 },
  'lille': { lat: 50.6292, lng: 3.0573 },
  'nantes': { lat: 47.2184, lng: -1.5536 },
  'rennes': { lat: 48.1173, lng: -1.6778 },
  'montpellier': { lat: 43.6108, lng: 3.8767 },
  'dijon': { lat: 47.3220, lng: 5.0415 },
  'avignon': { lat: 43.9493, lng: 4.8055 },
  'grenoble': { lat: 45.1885, lng: 5.7245 },
  // UK
  'london': { lat: 51.5074, lng: -0.1278 },
  'manchester': { lat: 53.4808, lng: -2.2426 },
  'edinburgh': { lat: 55.9533, lng: -3.1883 },
  'birmingham': { lat: 52.4862, lng: -1.8904 },
  // Germany
  'berlin': { lat: 52.5200, lng: 13.4050 },
  'munich': { lat: 48.1351, lng: 11.5820 },
  'frankfurt': { lat: 50.1109, lng: 8.6821 },
  'hamburg': { lat: 53.5511, lng: 9.9937 },
  'cologne': { lat: 50.9375, lng: 6.9603 },
  'stuttgart': { lat: 48.7758, lng: 9.1829 },
  'dusseldorf': { lat: 51.2277, lng: 6.7735 },
  'dresden': { lat: 51.0504, lng: 13.7373 },
  'nuremberg': { lat: 49.4521, lng: 11.0767 },
  // Italy
  'rome': { lat: 41.9028, lng: 12.4964 },
  'milan': { lat: 45.4642, lng: 9.1900 },
  'florence': { lat: 43.7696, lng: 11.2558 },
  'venice': { lat: 45.4408, lng: 12.3155 },
  'naples': { lat: 40.8518, lng: 14.2681 },
  'turin': { lat: 45.0703, lng: 7.6869 },
  'bologna': { lat: 44.4949, lng: 11.3426 },
  'genoa': { lat: 44.4056, lng: 8.9463 },
  // Spain
  'madrid': { lat: 40.4168, lng: -3.7038 },
  'barcelona': { lat: 41.3874, lng: 2.1686 },
  'valencia': { lat: 39.4699, lng: -0.3763 },
  'seville': { lat: 37.3891, lng: -5.9845 },
  'malaga': { lat: 36.7213, lng: -4.4214 },
  'bilbao': { lat: 43.2630, lng: -2.9350 },
  // Benelux
  'amsterdam': { lat: 52.3676, lng: 4.9041 },
  'rotterdam': { lat: 51.9244, lng: 4.4777 },
  'utrecht': { lat: 52.0907, lng: 5.1214 },
  'the hague': { lat: 52.0705, lng: 4.3007 },
  'brussels': { lat: 50.8503, lng: 4.3517 },
  'antwerp': { lat: 51.2194, lng: 4.4025 },
  'ghent': { lat: 51.0543, lng: 3.7174 },
  'bruges': { lat: 51.2093, lng: 3.2247 },
  // Switzerland
  'zurich': { lat: 47.3769, lng: 8.5417 },
  'geneva': { lat: 46.2044, lng: 6.1432 },
  'bern': { lat: 46.9480, lng: 7.4474 },
  'basel': { lat: 47.5596, lng: 7.5886 },
  'lausanne': { lat: 46.5197, lng: 6.6323 },
  'lucerne': { lat: 47.0502, lng: 8.3093 },
  // Austria
  'vienna': { lat: 48.2082, lng: 16.3738 },
  'salzburg': { lat: 47.8095, lng: 13.0550 },
  'innsbruck': { lat: 47.2692, lng: 11.4041 },
  // Central/Eastern Europe
  'prague': { lat: 50.0755, lng: 14.4378 },
  'budapest': { lat: 47.4979, lng: 19.0402 },
  'warsaw': { lat: 52.2297, lng: 21.0122 },
  'krakow': { lat: 50.0647, lng: 19.9450 },
  'copenhagen': { lat: 55.6761, lng: 12.5683 },
  'stockholm': { lat: 59.3293, lng: 18.0686 },
  'oslo': { lat: 59.9139, lng: 10.7522 },
  'helsinki': { lat: 60.1699, lng: 24.9384 },
  'lisbon': { lat: 38.7223, lng: -9.1393 },
  'porto': { lat: 41.1579, lng: -8.6291 },
  'dublin': { lat: 53.3498, lng: -6.2603 },
  'athens': { lat: 37.9838, lng: 23.7275 },
  'bucharest': { lat: 44.4268, lng: 26.1025 },
  'zagreb': { lat: 45.8150, lng: 15.9819 },
  'ljubljana': { lat: 46.0569, lng: 14.5058 },
  'bratislava': { lat: 48.1486, lng: 17.1077 },
};

function getCityCoords(city: string): { lat: number; lng: number } | null {
  const normalized = city.toLowerCase().trim();
  // Direct match
  if (CITY_COORDS[normalized]) return CITY_COORDS[normalized];
  // Partial match (e.g. "Paris Nord" → "paris")
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (normalized.includes(key) || key.includes(normalized)) return coords;
  }
  return null;
}

function isEuropeanCity(city: string): boolean {
  return getCityCoords(city) !== null;
}

// In-memory cache for journey results
const journeyCache = new Map<string, { data: DBJourney[]; timestamp: number }>();
const JOURNEY_CACHE_TTL = 3600_000; // 1 hour

/**
 * Parse ISO duration or calculate from departure/arrival
 */
function parseDuration(departure: string, arrival: string): number {
  const dep = new Date(departure).getTime();
  const arr = new Date(arrival).getTime();
  return Math.round((arr - dep) / 60000);
}

// ============================================
// Source 1: Google Directions API (mode=transit)
// ============================================

interface GoogleStep {
  travel_mode: string;
  duration: { value: number };
  distance: { value: number };
  html_instructions?: string;
  transit_details?: {
    departure_stop: { name: string };
    arrival_stop: { name: string };
    departure_time: { value: number; text: string };
    arrival_time: { value: number; text: string };
    num_stops: number;
    line: {
      short_name?: string;
      name?: string;
      vehicle?: { type: string };
      operator?: { name: string };
      color?: string;
    };
  };
}

interface GoogleLeg {
  duration: { value: number };
  distance: { value: number };
  departure_time?: { value: number };
  arrival_time?: { value: number };
  steps: GoogleStep[];
}

interface GoogleRoute {
  legs: GoogleLeg[];
}

async function searchWithGoogle(
  origin: string,
  destination: string,
  date?: Date
): Promise<DBJourney[]> {
  if (!getGoogleMapsKey()) return [];

  const originCoords = getCityCoords(origin);
  const destCoords = getCityCoords(destination);
  if (!originCoords || !destCoords) return [];

  try {
    const params = new URLSearchParams({
      origin: `${originCoords.lat},${originCoords.lng}`,
      destination: `${destCoords.lat},${destCoords.lng}`,
      mode: 'transit',
      transit_mode: 'rail',
      alternatives: 'true',
      language: 'fr',
      key: getGoogleMapsKey(),
    });

    if (date) {
      params.set('departure_time', Math.floor(date.getTime() / 1000).toString());
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Google Transit] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (data.status !== 'OK' || !data.routes?.length) {
      console.warn(`[Google Transit] Status: ${data.status}`);
      return [];
    }

    const journeys: DBJourney[] = data.routes
      .map((route: GoogleRoute) => parseGoogleRoute(route))
      .filter((j: DBJourney | null): j is DBJourney => j !== null);

    return journeys;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[Google Transit] Timeout for ${origin} → ${destination}`);
    } else {
      console.warn(`[Google Transit] Error:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}

function parseGoogleRoute(route: GoogleRoute): DBJourney | null {
  const leg = route.legs[0];
  if (!leg) return null;

  const legs: DBLeg[] = [];

  for (const step of leg.steps) {
    if (step.travel_mode !== 'TRANSIT' || !step.transit_details) continue;

    const td = step.transit_details;
    const vehicleType = td.line?.vehicle?.type || '';

    // Filtrer : on ne veut que les trains, pas les bus/metro/tram urbains
    const isRail = ['RAIL', 'HEAVY_RAIL', 'HIGH_SPEED_TRAIN', 'COMMUTER_TRAIN', 'LONG_DISTANCE_TRAIN', 'INTERCITY_BUS'].includes(vehicleType);
    // Accepter aussi les ferry
    const isFerry = vehicleType === 'FERRY';
    // Accepter les bus interurbains (FlixBus etc.) mais pas les bus locaux
    const isIntercityBus = vehicleType === 'INTERCITY_BUS' || vehicleType === 'BUS' && (td.num_stops <= 5 || step.duration.value > 3600);

    if (!isRail && !isFerry && !isIntercityBus) continue;

    const depTime = new Date(td.departure_time.value * 1000).toISOString();
    const arrTime = new Date(td.arrival_time.value * 1000).toISOString();

    legs.push({
      mode: isFerry ? 'ferry' : isIntercityBus ? 'bus' : 'train',
      from: td.departure_stop.name,
      to: td.arrival_stop.name,
      departure: depTime,
      arrival: arrTime,
      duration: Math.round(step.duration.value / 60),
      operator: td.line?.operator?.name,
      line: td.line?.short_name || td.line?.name,
    });
  }

  if (legs.length === 0) return null;

  const departureTime = legs[0].departure;
  const arrivalTime = legs[legs.length - 1].arrival;

  return {
    duration: parseDuration(departureTime, arrivalTime),
    price: null, // Google ne donne pas les prix de trains
    legs,
    departureTime,
    arrivalTime,
    transfers: Math.max(0, legs.length - 1),
  };
}

// ============================================
// Source 2: Transitous / MOTIS API (fallback gratuit)
// ============================================

interface TransitousLeg {
  mode: string;
  from: { name: string };
  to: { name: string };
  startTime: string;
  endTime: string;
  duration: number; // seconds
  routeShortName?: string;
  routeLongName?: string;
  agencyName?: string;
  transitLeg?: boolean;
}

interface TransitousItinerary {
  duration: number; // seconds
  transfers: number;
  legs: TransitousLeg[];
  startTime: string;
  endTime: string;
}

async function searchWithTransitous(
  origin: string,
  destination: string,
  date?: Date,
  results: number = 5
): Promise<DBJourney[]> {
  const originCoords = getCityCoords(origin);
  const destCoords = getCityCoords(destination);
  if (!originCoords || !destCoords) return [];

  try {
    const params = new URLSearchParams({
      fromPlace: `${originCoords.lat},${originCoords.lng}`,
      toPlace: `${destCoords.lat},${destCoords.lng}`,
      transitModes: 'RAIL,FERRY',
      directModes: 'WALK',
      numItineraries: String(results),
    });

    if (date) {
      // Transitous attend un format avec timezone offset (pas Z)
      const tzOffset = date.getTimezoneOffset();
      const sign = tzOffset <= 0 ? '+' : '-';
      const absOffset = Math.abs(tzOffset);
      const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
      const mins = String(absOffset % 60).padStart(2, '0');
      const localISO = new Date(date.getTime() - tzOffset * 60000).toISOString().slice(0, 19);
      params.set('time', `${localISO}${sign}${hours}:${mins}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `https://api.transitous.org/api/v5/plan?${params}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Transitous] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const itineraries: TransitousItinerary[] = data.itineraries || [];

    const journeys: DBJourney[] = itineraries
      .map(parseTransitousItinerary)
      .filter((j): j is DBJourney => j !== null);

    return journeys;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[Transitous] Timeout for ${origin} → ${destination}`);
    } else {
      console.warn(`[Transitous] Error:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}

function parseTransitousItinerary(it: TransitousItinerary): DBJourney | null {
  const legs: DBLeg[] = [];

  const RAIL_MODES = ['RAIL', 'HIGHSPEED_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'SUBWAY', 'TRAM'];
  const SKIP_MODES = ['WALK', 'FLEX', 'CAR', 'BICYCLE'];

  for (const leg of it.legs) {
    // Ignorer marche, vélo, voiture
    if (SKIP_MODES.includes(leg.mode)) continue;
    // Ignorer le metro/tram/RER urbain (on ne veut que les trains intercity)
    if ((leg.mode === 'SUBWAY' || leg.mode === 'TRAM') && leg.duration < 1800) continue;
    // Ignorer les ferry courts (navettes portuaires type Frioul < 45min)
    if (leg.mode === 'FERRY' && leg.duration < 2700) continue;
    // Ignorer les trains très courts (RER de 3 min entre gares)
    if (leg.mode !== 'FERRY' && leg.mode !== 'BUS' && leg.duration < 600) continue;

    const isRail = RAIL_MODES.includes(leg.mode) || leg.mode.includes('RAIL');
    const isFerry = leg.mode === 'FERRY';
    const isBus = leg.mode === 'BUS';
    if (!isRail && !isFerry && !isBus) continue;

    const mode = isFerry ? 'ferry' as const
      : isBus ? 'bus' as const
      : 'train' as const;

    // Nettoyer le nom de ligne : les codes GTFS comme "FRPNO -> BEBMI" ne sont pas lisibles
    let lineName = leg.routeShortName || leg.routeLongName || '';
    if (lineName.includes('->') || lineName.includes(' -> ') || /^[A-Z]{3,}[0-9]*$/.test(lineName)) {
      // Code GTFS technique → utiliser l'opérateur comme fallback
      lineName = leg.agencyName || lineName;
    }

    legs.push({
      mode,
      from: leg.from.name,
      to: leg.to.name,
      departure: leg.startTime,
      arrival: leg.endTime,
      duration: Math.round(leg.duration / 60),
      operator: leg.agencyName,
      line: lineName || undefined,
    });
  }

  if (legs.length === 0) return null;

  return {
    duration: Math.round(it.duration / 60),
    price: null, // Transitous ne donne pas les prix
    legs,
    departureTime: legs[0].departure,
    arrivalTime: legs[legs.length - 1].arrival,
    transfers: Math.max(0, legs.length - 1),
  };
}

// ============================================
// API publique (même interface qu'avant)
// ============================================

/**
 * Search for train journeys between two European cities
 * Uses Google Directions API (transit) → Transitous fallback
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
    return cached.data;
  }

  // Only search European routes
  if (!isEuropeanCity(origin) || !isEuropeanCity(destination)) {
    return [];
  }

  // 1. Try Google Directions API (mode=transit, transit_mode=rail)
  let journeys = await searchWithGoogle(origin, destination, date);

  // 2. Fallback: Transitous / MOTIS API
  if (journeys.length === 0) {
    journeys = await searchWithTransitous(origin, destination, date, results);
  }

  // Limiter au nombre demandé
  journeys = journeys.slice(0, results);

  // Cache results (même vide, pour éviter de re-tenter trop souvent)
  if (journeys.length > 0) {
    journeyCache.set(cacheKey, { data: journeys, timestamp: Date.now() });
  }

  return journeys;
}

/**
 * Get the best train schedule for a route
 * Returns real departure/arrival times, train numbers, and transfers
 */
export async function getCheapestTrainPrice(
  origin: string,
  destination: string,
  date?: Date
): Promise<{ price: number; duration: number; operator: string; departureTime: string; arrivalTime: string; transfers: number; legs: DBLeg[]; dataSource: 'api' } | null> {
  const journeys = await searchTrainJourneys(origin, destination, date, 5);

  if (journeys.length === 0) return null;

  // Prendre le premier trajet chronologiquement (le plus tôt après l'heure demandée)
  const best = journeys.reduce((a, b) => a.departureTime < b.departureTime ? a : b);
  const operator = best.legs[0]?.operator || best.legs[0]?.line || 'Train';

  return {
    price: best.price ?? 0, // 0 = prix inconnu, sera complété par known routes
    duration: best.duration,
    operator: String(operator),
    departureTime: best.departureTime,
    arrivalTime: best.arrivalTime,
    transfers: best.transfers,
    legs: best.legs,
    dataSource: 'api',
  };
}

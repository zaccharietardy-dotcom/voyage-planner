/**
 * Service de calcul d'itinéraires avec temps de trajet réels
 *
 * Chaîne de fallback:
 * 1. Google Directions API (payant, très précis)
 * 2. OpenRouteService (gratuit, 2000 req/jour)
 * 3. Estimation par vitesse (toujours disponible)
 */

// Configuration des API
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const OPENROUTE_API_KEY = process.env.OPENROUTE_API_KEY;

// Types
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DirectionsRequest {
  from: Coordinates;
  to: Coordinates;
  mode?: 'transit' | 'walking' | 'driving';
  departureTime?: Date;
}

export interface TransitLine {
  number: string;
  name?: string;
  mode: 'bus' | 'metro' | 'tram' | 'train' | 'ferry';
  color?: string;
  departureStop?: string;
  arrivalStop?: string;
  numStops?: number;
}

export interface DirectionsStep {
  instruction: string;
  distance: number; // mètres
  duration: number; // secondes
  mode: 'walk' | 'transit';
  transitLine?: TransitLine;
}

export interface DirectionsResult {
  duration: number; // minutes
  distance: number; // km
  steps: DirectionsStep[];
  transitLines: TransitLine[];
  googleMapsUrl: string;
  source: 'google' | 'openroute' | 'estimated';
}

/**
 * Obtient les directions entre deux points
 * Utilise la chaîne de fallback automatique
 */
export async function getDirections(request: DirectionsRequest): Promise<DirectionsResult> {
  const { from, to, mode = 'transit', departureTime } = request;

  // Générer le lien Google Maps dans tous les cas
  const googleMapsUrl = generateGoogleMapsUrl(from, to, mode);

  // 1. Essayer Google Directions API
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const result = await searchWithGoogle(from, to, mode, departureTime);
      return { ...result, googleMapsUrl };
    } catch (error) {
      console.warn('Google Directions API error, falling back:', error);
    }
  }

  // 2. Essayer OpenRouteService
  if (OPENROUTE_API_KEY) {
    try {
      const result = await searchWithOpenRouteService(from, to, mode);
      return { ...result, googleMapsUrl };
    } catch (error) {
      console.warn('OpenRouteService error, falling back:', error);
    }
  }

  // 3. Fallback sur estimation
  return estimateDirections(from, to, mode, googleMapsUrl);
}

/**
 * Recherche via Google Directions API
 */
async function searchWithGoogle(
  from: Coordinates,
  to: Coordinates,
  mode: 'transit' | 'walking' | 'driving',
  departureTime?: Date
): Promise<Omit<DirectionsResult, 'googleMapsUrl'>> {
  const params = new URLSearchParams({
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    mode: mode,
    key: GOOGLE_MAPS_API_KEY!,
    language: 'fr',
  });

  if (departureTime && mode === 'transit') {
    params.append('departure_time', Math.floor(departureTime.getTime() / 1000).toString());
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params}`
  );

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'OK' || !data.routes?.length) {
    throw new Error(`Google API: ${data.status}`);
  }

  const route = data.routes[0];
  const leg = route.legs[0];

  // Parser les étapes et extraire les lignes de transport
  const steps: DirectionsStep[] = [];
  const transitLines: TransitLine[] = [];

  for (const step of leg.steps || []) {
    const parsedStep: DirectionsStep = {
      instruction: step.html_instructions?.replace(/<[^>]*>/g, '') || '',
      distance: step.distance?.value || 0,
      duration: step.duration?.value || 0,
      mode: step.travel_mode === 'TRANSIT' ? 'transit' : 'walk',
    };

    // Extraire les infos de transport en commun
    if (step.transit_details) {
      const transit = step.transit_details;
      const line: TransitLine = {
        number: transit.line?.short_name || transit.line?.name || '',
        name: transit.line?.name,
        mode: mapGoogleVehicleType(transit.line?.vehicle?.type),
        color: transit.line?.color,
        departureStop: transit.departure_stop?.name,
        arrivalStop: transit.arrival_stop?.name,
        numStops: transit.num_stops,
      };
      parsedStep.transitLine = line;
      transitLines.push(line);
    }

    steps.push(parsedStep);
  }

  return {
    duration: Math.ceil(leg.duration.value / 60),
    distance: leg.distance.value / 1000,
    steps,
    transitLines,
    source: 'google',
  };
}

/**
 * Recherche via OpenRouteService (gratuit)
 */
async function searchWithOpenRouteService(
  from: Coordinates,
  to: Coordinates,
  mode: 'transit' | 'walking' | 'driving'
): Promise<Omit<DirectionsResult, 'googleMapsUrl'>> {
  // ORS ne supporte pas bien le transit, on utilise foot-walking ou driving-car
  const orsProfile = mode === 'walking' ? 'foot-walking' : 'driving-car';

  const response = await fetch(
    `https://api.openrouteservice.org/v2/directions/${orsProfile}?api_key=${OPENROUTE_API_KEY}&start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`,
    {
      headers: {
        'Accept': 'application/json, application/geo+json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`OpenRouteService error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.features?.length) {
    throw new Error('No route found');
  }

  const route = data.features[0];
  const summary = route.properties.summary;

  // ORS ne donne pas les détails de transit, juste distance/durée
  return {
    duration: Math.ceil(summary.duration / 60),
    distance: summary.distance / 1000,
    steps: [],
    transitLines: [],
    source: 'openroute',
  };
}

/**
 * Estimation basée sur la distance (fallback ultime)
 */
function estimateDirections(
  from: Coordinates,
  to: Coordinates,
  mode: 'transit' | 'walking' | 'driving',
  googleMapsUrl: string
): DirectionsResult {
  const distance = calculateDistance(from.lat, from.lng, to.lat, to.lng);

  // Vitesses moyennes
  const speeds: Record<string, number> = {
    walking: 4, // km/h
    transit: 15, // km/h (avec attente)
    driving: 30, // km/h (trafic urbain)
  };

  const speed = speeds[mode] || 15;
  const duration = Math.ceil((distance / speed) * 60);

  // Ajouter temps d'attente pour le transit
  const waitTime = mode === 'transit' ? 10 : 0;

  return {
    duration: duration + waitTime,
    distance,
    steps: [],
    transitLines: [],
    googleMapsUrl,
    source: 'estimated',
  };
}

/**
 * Génère l'URL Google Maps pour ouvrir l'itinéraire
 */
export function generateGoogleMapsUrl(
  from: Coordinates,
  to: Coordinates,
  mode: 'transit' | 'walking' | 'driving' = 'transit'
): string {
  const travelMode = mode === 'transit' ? 'transit' : mode === 'walking' ? 'walking' : 'driving';

  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${travelMode}`;
}

/**
 * Génère un lien Google Maps SEARCH par nom de lieu
 *
 * IMPORTANT: Préférer cette fonction aux coordonnées GPS!
 * Google Maps trouvera automatiquement le vrai lieu par son nom.
 *
 * Exemple: "Sagrada Familia, Barcelona" → ouvre la vraie fiche Google Maps
 */
export function generateGoogleMapsSearchUrl(
  placeName: string,
  city?: string
): string {
  const query = city ? `${placeName}, ${city}` : placeName;
  const encodedQuery = encodeURIComponent(query);
  return `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
}

/**
 * Génère un lien d'itinéraire Google Maps par NOMS de lieux
 *
 * IMPORTANT: Préférer cette fonction aux coordonnées GPS!
 * Google Maps trouvera automatiquement les vrais lieux.
 */
export function generateGoogleMapsDirectionsUrl(
  fromName: string,
  toName: string,
  city: string,
  mode: 'transit' | 'walking' | 'driving' = 'transit'
): string {
  const origin = encodeURIComponent(`${fromName}, ${city}`);
  const destination = encodeURIComponent(`${toName}, ${city}`);
  const travelMode = mode === 'transit' ? 'transit' : mode === 'walking' ? 'walking' : 'driving';

  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${travelMode}`;
}

/**
 * Génère l'URL pour l'embed Google Maps
 */
export function generateGoogleMapsEmbedUrl(
  from: Coordinates,
  to: Coordinates,
  mode: 'transit' | 'walking' | 'driving' = 'transit'
): string | null {
  if (!GOOGLE_MAPS_API_KEY) return null;

  const travelMode = mode === 'transit' ? 'transit' : mode === 'walking' ? 'walking' : 'driving';

  return `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&mode=${travelMode}`;
}

/**
 * Convertit le type de véhicule Google en notre type
 */
function mapGoogleVehicleType(type?: string): TransitLine['mode'] {
  const mapping: Record<string, TransitLine['mode']> = {
    BUS: 'bus',
    SUBWAY: 'metro',
    METRO_RAIL: 'metro',
    TRAM: 'tram',
    RAIL: 'train',
    HEAVY_RAIL: 'train',
    COMMUTER_TRAIN: 'train',
    HIGH_SPEED_TRAIN: 'train',
    FERRY: 'ferry',
  };
  return mapping[type || ''] || 'bus';
}

/**
 * Calcule la distance entre deux points (Haversine)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formate la durée pour l'affichage
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h${mins}` : `${hours}h`;
}

/**
 * Obtient l'icône pour un mode de transport
 */
export function getTransitModeIcon(mode: TransitLine['mode']): string {
  const icons: Record<TransitLine['mode'], string> = {
    bus: '🚌',
    metro: '🚇',
    tram: '🚊',
    train: '🚆',
    ferry: '⛴️',
  };
  return icons[mode] || '🚌';
}

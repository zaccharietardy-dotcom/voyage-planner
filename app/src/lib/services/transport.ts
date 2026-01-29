/**
 * Service de comparaison des modes de transport
 *
 * Compare avion, train, bus, voiture et combinaisons
 * Score composite basé sur: prix, temps, CO2
 */

import { calculateDistance } from './geocoding';
import { normalizeCitySync } from './cityNormalization';
import { getCheapestTrainPrice } from './dbTransport';

// Types
export interface TransportOption {
  id: string;
  mode: 'plane' | 'train' | 'bus' | 'car' | 'combined';
  segments: TransportSegment[];
  totalDuration: number;      // minutes
  totalPrice: number;         // euros
  totalCO2: number;           // kg CO2
  score: number;              // note /10
  scoreDetails: {
    priceScore: number;       // /10
    timeScore: number;        // /10
    co2Score: number;         // /10
  };
  bookingUrl?: string;
  recommended?: boolean;
  recommendationReason?: string;
  dataSource?: 'api' | 'estimated';
}

export interface TransportSegment {
  mode: 'plane' | 'train' | 'bus' | 'car' | 'ferry' | 'transfer';
  from: string;
  to: string;
  fromCoords?: { lat: number; lng: number };
  toCoords?: { lat: number; lng: number };
  duration: number;           // minutes
  price: number;              // euros
  co2: number;                // kg CO2
  operator?: string;
  departureTime?: string;
  arrivalTime?: string;
  frequency?: string;         // "toutes les 2h", "3 par jour", etc.
  bookingUrl?: string;
}

export interface TransportSearchParams {
  origin: string;
  originCoords: { lat: number; lng: number };
  destination: string;
  destCoords: { lat: number; lng: number };
  date: Date;
  passengers: number;
  preferences?: {
    prioritize?: 'price' | 'time' | 'co2' | 'balanced';
    maxDuration?: number;     // minutes
    maxPrice?: number;        // euros
    avoidModes?: ('plane' | 'bus' | 'car')[];
    forceIncludeMode?: 'plane' | 'train' | 'bus' | 'car' | 'combined'; // Mode choisi par l'utilisateur
  };
}

// Émissions CO2 par km par passager (kg)
const CO2_PER_KM: Record<string, number> = {
  plane_short: 0.255,      // < 1000km
  plane_medium: 0.195,     // 1000-3500km
  plane_long: 0.152,       // > 3500km
  train_highspeed: 0.004,  // TGV, AVE, ICE
  train_regular: 0.014,    // Train classique
  bus: 0.027,              // Autocar
  car: 0.104,              // Voiture (par passager, 2 pers)
  ferry: 0.120,
};

// Vitesses moyennes (km/h)
const SPEEDS: Record<string, number> = {
  plane: 800,              // Vitesse croisière
  train_highspeed: 250,    // TGV/AVE
  train_regular: 120,      // Train classique
  bus: 80,                 // Autocar
  car: 100,                // Voiture autoroute
  ferry: 30,
};

// Prix moyens par km par passager (euros)
const PRICE_PER_KM: Record<string, number> = {
  plane: 0.10,             // Low-cost moyen
  train_highspeed: 0.12,   // TGV
  train_regular: 0.08,     // Train classique
  bus: 0.04,               // Flixbus, Blablacar Bus
  car: 0.08,               // Essence + péages / 2 personnes
};

// Base de données de trajets train connus avec prix/durées réels
// Prix = tarif moyen par personne en €, durée = minutes de trajet
interface KnownTrainRoute {
  duration: number;  // minutes
  price: number;     // euros, prix moyen
  priceRange: [number, number]; // [min, max] prix
  operator: string;
  highSpeed: boolean;
}

function getRouteKey(a: string, b: string): string {
  return [a, b].sort().join('→');
}

const KNOWN_TRAIN_ROUTES: Record<string, KnownTrainRoute> = {
  // France interne
  [getRouteKey('Paris', 'Lyon')]: { duration: 120, price: 50, priceRange: [25, 90], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Marseille')]: { duration: 195, price: 65, priceRange: [30, 120], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Bordeaux')]: { duration: 130, price: 55, priceRange: [25, 95], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Lille')]: { duration: 62, price: 35, priceRange: [15, 60], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Strasbourg')]: { duration: 105, price: 50, priceRange: [25, 85], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Nantes')]: { duration: 135, price: 45, priceRange: [20, 80], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Rennes')]: { duration: 90, price: 40, priceRange: [18, 70], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Toulouse')]: { duration: 265, price: 65, priceRange: [30, 110], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Nice')]: { duration: 340, price: 75, priceRange: [35, 130], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Montpellier')]: { duration: 210, price: 55, priceRange: [25, 95], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Caen')]: { duration: 115, price: 30, priceRange: [15, 45], operator: 'SNCF Intercités / Nomad', highSpeed: false },
  [getRouteKey('Paris', 'Rouen')]: { duration: 85, price: 25, priceRange: [12, 38], operator: 'SNCF Intercités / Nomad', highSpeed: false },
  [getRouteKey('Paris', 'Tours')]: { duration: 75, price: 35, priceRange: [15, 55], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Dijon')]: { duration: 100, price: 40, priceRange: [20, 65], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Avignon')]: { duration: 160, price: 50, priceRange: [25, 85], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Angers')]: { duration: 95, price: 35, priceRange: [15, 55], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Paris', 'Le Mans')]: { duration: 55, price: 30, priceRange: [12, 48], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Lyon', 'Marseille')]: { duration: 105, price: 40, priceRange: [20, 65], operator: 'SNCF TGV INOUI', highSpeed: true },
  [getRouteKey('Lyon', 'Montpellier')]: { duration: 120, price: 40, priceRange: [18, 60], operator: 'SNCF TGV INOUI', highSpeed: true },
  // France → International
  [getRouteKey('Paris', 'London')]: { duration: 135, price: 80, priceRange: [40, 250], operator: 'Eurostar', highSpeed: true },
  [getRouteKey('Paris', 'Brussels')]: { duration: 82, price: 55, priceRange: [29, 120], operator: 'Eurostar / Thalys', highSpeed: true },
  [getRouteKey('Paris', 'Amsterdam')]: { duration: 195, price: 65, priceRange: [35, 150], operator: 'Eurostar / Thalys', highSpeed: true },
  [getRouteKey('Paris', 'Geneva')]: { duration: 195, price: 50, priceRange: [25, 90], operator: 'SNCF TGV Lyria', highSpeed: true },
  [getRouteKey('Paris', 'Barcelona')]: { duration: 390, price: 80, priceRange: [39, 180], operator: 'SNCF TGV / Renfe AVE', highSpeed: true },
  [getRouteKey('Paris', 'Frankfurt')]: { duration: 240, price: 60, priceRange: [29, 120], operator: 'SNCF TGV / ICE', highSpeed: true },
  [getRouteKey('Paris', 'Milan')]: { duration: 425, price: 70, priceRange: [35, 150], operator: 'SNCF TGV / Trenitalia', highSpeed: true },
  // Allemagne
  [getRouteKey('Berlin', 'Munich')]: { duration: 240, price: 50, priceRange: [18, 130], operator: 'Deutsche Bahn ICE', highSpeed: true },
  [getRouteKey('Berlin', 'Frankfurt')]: { duration: 255, price: 50, priceRange: [18, 120], operator: 'Deutsche Bahn ICE', highSpeed: true },
  [getRouteKey('Berlin', 'Hamburg')]: { duration: 105, price: 35, priceRange: [15, 80], operator: 'Deutsche Bahn ICE', highSpeed: true },
  [getRouteKey('Frankfurt', 'Munich')]: { duration: 200, price: 45, priceRange: [18, 100], operator: 'Deutsche Bahn ICE', highSpeed: true },
  [getRouteKey('Frankfurt', 'Cologne')]: { duration: 65, price: 30, priceRange: [15, 60], operator: 'Deutsche Bahn ICE', highSpeed: true },
  // Italie
  [getRouteKey('Rome', 'Milan')]: { duration: 180, price: 50, priceRange: [20, 90], operator: 'Trenitalia Frecciarossa', highSpeed: true },
  [getRouteKey('Rome', 'Florence')]: { duration: 95, price: 35, priceRange: [15, 60], operator: 'Trenitalia Frecciarossa', highSpeed: true },
  [getRouteKey('Rome', 'Naples')]: { duration: 70, price: 25, priceRange: [10, 45], operator: 'Trenitalia Frecciarossa', highSpeed: true },
  [getRouteKey('Milan', 'Florence')]: { duration: 100, price: 35, priceRange: [15, 55], operator: 'Trenitalia Frecciarossa', highSpeed: true },
  [getRouteKey('Milan', 'Venice')]: { duration: 145, price: 30, priceRange: [12, 50], operator: 'Trenitalia Frecciarossa', highSpeed: true },
  // Espagne
  [getRouteKey('Madrid', 'Barcelona')]: { duration: 155, price: 45, priceRange: [20, 90], operator: 'Renfe AVE', highSpeed: true },
  [getRouteKey('Madrid', 'Seville')]: { duration: 155, price: 40, priceRange: [20, 75], operator: 'Renfe AVE', highSpeed: true },
  [getRouteKey('Madrid', 'Valencia')]: { duration: 100, price: 30, priceRange: [15, 55], operator: 'Renfe AVE', highSpeed: true },
  // UK
  [getRouteKey('London', 'Edinburgh')]: { duration: 270, price: 60, priceRange: [25, 150], operator: 'LNER', highSpeed: true },
  [getRouteKey('London', 'Manchester')]: { duration: 130, price: 45, priceRange: [20, 100], operator: 'Avanti West Coast', highSpeed: true },
  // Suisse
  [getRouteKey('Zurich', 'Geneva')]: { duration: 170, price: 50, priceRange: [30, 80], operator: 'SBB/CFF', highSpeed: true },
  [getRouteKey('Zurich', 'Bern')]: { duration: 56, price: 25, priceRange: [15, 40], operator: 'SBB/CFF', highSpeed: true },
  // Japon
  [getRouteKey('Tokyo', 'Kyoto')]: { duration: 135, price: 115, priceRange: [110, 120], operator: 'JR Shinkansen Nozomi', highSpeed: true },
  [getRouteKey('Tokyo', 'Osaka')]: { duration: 150, price: 120, priceRange: [115, 125], operator: 'JR Shinkansen Nozomi', highSpeed: true },
  [getRouteKey('Tokyo', 'Hiroshima')]: { duration: 240, price: 155, priceRange: [150, 160], operator: 'JR Shinkansen Nozomi', highSpeed: true },
  [getRouteKey('Kyoto', 'Osaka')]: { duration: 15, price: 12, priceRange: [10, 15], operator: 'JR Shinkansen', highSpeed: true },
  [getRouteKey('Kyoto', 'Hiroshima')]: { duration: 100, price: 90, priceRange: [85, 95], operator: 'JR Shinkansen', highSpeed: true },
};

/**
 * Cherche un trajet connu dans la base
 */
function findKnownRoute(origin: string, destination: string): KnownTrainRoute | null {
  const originNorm = normalizeCitySync(origin).normalized;
  const destNorm = normalizeCitySync(destination).normalized;
  const key = getRouteKey(originNorm, destNorm);
  return KNOWN_TRAIN_ROUTES[key] || null;
}

// Lignes de train à grande vitesse en Europe
const HIGH_SPEED_RAIL_ROUTES: Record<string, string[]> = {
  'Paris': ['Lyon', 'Marseille', 'Bordeaux', 'Lille', 'Strasbourg', 'Nantes', 'Rennes', 'Montpellier', 'Nice', 'Toulouse', 'Brussels', 'London', 'Amsterdam', 'Geneva', 'Barcelona', 'Frankfurt', 'Stuttgart', 'Munich', 'Milan', 'Turin'],
  'Lyon': ['Paris', 'Marseille', 'Montpellier', 'Geneva', 'Turin', 'Milan'],
  'Barcelona': ['Madrid', 'Paris', 'Valencia', 'Seville', 'Zaragoza', 'Girona', 'Figueres'],
  'Madrid': ['Barcelona', 'Seville', 'Valencia', 'Malaga', 'Cordoba', 'Toledo', 'Zaragoza'],
  'London': ['Paris', 'Brussels', 'Amsterdam'],
  'Amsterdam': ['Paris', 'Brussels', 'London', 'Frankfurt', 'Cologne'],
  'Brussels': ['Paris', 'London', 'Amsterdam', 'Cologne', 'Frankfurt'],
  'Frankfurt': ['Paris', 'Amsterdam', 'Brussels', 'Munich', 'Stuttgart', 'Cologne', 'Berlin'],
  'Berlin': ['Frankfurt', 'Munich', 'Hamburg', 'Prague', 'Warsaw', 'Vienna'],
  'Munich': ['Frankfurt', 'Berlin', 'Vienna', 'Zurich', 'Milan', 'Venice'],
  'Milan': ['Paris', 'Lyon', 'Turin', 'Rome', 'Venice', 'Florence', 'Munich', 'Zurich'],
  'Rome': ['Milan', 'Florence', 'Naples', 'Venice'],
  'Vienna': ['Munich', 'Berlin', 'Prague', 'Budapest', 'Venice'],
  'Zurich': ['Paris', 'Milan', 'Munich', 'Frankfurt', 'Vienna'],
};

// Temps additionnels (minutes)
const ADDITIONAL_TIME = {
  plane: {
    checkin: 120,          // 2h avant
    boarding: 30,
    taxiing: 20,
    baggage: 30,
    transfer: 45,          // Aéroport → centre
  },
  train: {
    station_access: 15,
    boarding: 10,
  },
  bus: {
    station_access: 20,
    boarding: 15,
  },
  car: {
    preparation: 15,
  },
};

/**
 * Compare tous les modes de transport disponibles
 */
export async function compareTransportOptions(
  params: TransportSearchParams
): Promise<TransportOption[]> {
  const distance = calculateDistance(
    params.originCoords.lat,
    params.originCoords.lng,
    params.destCoords.lat,
    params.destCoords.lng
  );

  console.log(`Comparaison transport ${params.origin} → ${params.destination} (${Math.round(distance)} km)`);

  const options: TransportOption[] = [];

  // 1. Option avion (si distance > 300km OU si l'utilisateur l'a demandé)
  const forcePlane = params.preferences?.forceIncludeMode === 'plane';
  if ((distance > 300 || forcePlane) && !params.preferences?.avoidModes?.includes('plane')) {
    const planeOption = calculatePlaneOption(params, distance);
    if (planeOption) options.push(planeOption);
  }

  // 2. Option train (si ligne existe ou distance < 1500km)
  const trainOption = await calculateTrainOption(params, distance);
  if (trainOption) options.push(trainOption);

  // 3. Option bus (si distance < 1200km OU si l'utilisateur l'a demandé)
  const forceBus = params.preferences?.forceIncludeMode === 'bus';
  if ((distance < 1200 || forceBus) && !params.preferences?.avoidModes?.includes('bus')) {
    const busOption = calculateBusOption(params, distance);
    if (busOption) options.push(busOption);
  }

  // 4. Option voiture (si distance < 1500km OU si l'utilisateur l'a demandé)
  const forceCar = params.preferences?.forceIncludeMode === 'car';
  if ((distance < 1500 || forceCar) && !params.preferences?.avoidModes?.includes('car')) {
    const carOption = calculateCarOption(params, distance);
    if (carOption) options.push(carOption);
  }

  // 5. Option combinée train + avion (pour très longues distances sans train direct)
  if (distance > 800 && !hasDirectHighSpeedRail(params.origin, params.destination)) {
    const combinedOption = calculateCombinedOption(params, distance);
    if (combinedOption) options.push(combinedOption);
  }

  console.log(`[Transport] Options générées: ${options.map(o => o.mode).join(', ')}`);

  // Calculer les scores
  const scoredOptions = calculateScores(options, params.preferences?.prioritize || 'balanced');

  // Marquer la recommandation
  markRecommendation(scoredOptions);

  // Trier par score décroissant
  const sorted = scoredOptions.sort((a, b) => b.score - a.score);
  console.log(`[Transport] Options finales: ${sorted.map(o => `${o.mode}(${o.score})`).join(', ')}`);

  return sorted;
}

/**
 * Calcule l'option avion
 */
function calculatePlaneOption(params: TransportSearchParams, distance: number): TransportOption | null {
  // Temps de vol
  const flightTime = Math.round((distance / SPEEDS.plane) * 60);

  // Temps total avec logistique
  const totalDuration = flightTime +
    ADDITIONAL_TIME.plane.checkin +
    ADDITIONAL_TIME.plane.boarding +
    ADDITIONAL_TIME.plane.taxiing +
    ADDITIONAL_TIME.plane.baggage +
    ADDITIONAL_TIME.plane.transfer * 2; // Aller + retour aéroport

  // Prix (avec variation selon distance)
  let basePrice = distance * PRICE_PER_KM.plane;
  if (distance < 500) basePrice *= 1.5;  // Courts trajets plus chers au km
  if (distance > 2000) basePrice *= 0.8; // Longs trajets moins chers au km
  const price = Math.round(basePrice);

  // CO2
  let co2Factor = CO2_PER_KM.plane_medium;
  if (distance < 1000) co2Factor = CO2_PER_KM.plane_short;
  else if (distance > 3500) co2Factor = CO2_PER_KM.plane_long;
  const co2 = Math.round(distance * co2Factor);

  // URL Google Flights with date
  const dateStr = params.date ? params.date.toISOString().split('T')[0] : '';
  const bookingUrl = `https://www.google.com/travel/flights?q=Flights%20from%20${encodeURIComponent(params.origin)}%20to%20${encodeURIComponent(params.destination)}${dateStr ? `%20on%20${dateStr}` : ''}`;

  return {
    id: 'plane',
    mode: 'plane',
    segments: [{
      mode: 'plane',
      from: params.origin,
      to: params.destination,
      fromCoords: params.originCoords,
      toCoords: params.destCoords,
      duration: flightTime,
      price,
      co2,
      frequency: 'Plusieurs vols par jour',
      bookingUrl,
    }],
    totalDuration,
    totalPrice: price,
    totalCO2: co2,
    score: 0, // Calculé après
    scoreDetails: { priceScore: 0, timeScore: 0, co2Score: 0 },
    bookingUrl,
  };
}

/**
 * Calcule l'option train — essaie l'API DB Transport, puis la base connue, puis les estimations
 */
async function calculateTrainOption(params: TransportSearchParams, distance: number): Promise<TransportOption | null> {
  try {
    return await calculateTrainOptionInner(params, distance);
  } catch (err) {
    // Safety net: if anything fails, fall back to pure estimation
    console.error(`[Train] Unexpected error in calculateTrainOption, using estimate:`, err instanceof Error ? err.message : err);
    const isHighSpeed = hasDirectHighSpeedRail(params.origin, params.destination);
    if (!isHighSpeed && distance > 1000) return null;
    const speed = isHighSpeed ? SPEEDS.train_highspeed : SPEEDS.train_regular;
    const travelTime = Math.round((distance / speed) * 60);
    const pricePerKm = isHighSpeed ? PRICE_PER_KM.train_highspeed : PRICE_PER_KM.train_regular;
    let price = Math.round(distance * pricePerKm);
    if (distance > 500) price = Math.round(price * 0.85);
    price = Math.max(price, 15);
    const operator = isHighSpeed ? getTrainOperator(params.origin, params.destination) : 'Train régional';
    return buildTrainOption(params, distance, travelTime, price, operator, 'estimated');
  }
}

async function calculateTrainOptionInner(params: TransportSearchParams, distance: number): Promise<TransportOption | null> {
  const isHighSpeed = hasDirectHighSpeedRail(params.origin, params.destination);

  console.log(`[Train] calculateTrainOption: ${params.origin} → ${params.destination}, distance: ${Math.round(distance)}km, isHighSpeed: ${isHighSpeed}`);

  // Si pas de train direct et distance > 1000km, pas d'option train simple
  if (!isHighSpeed && distance > 1000) {
    const dbResult = await getCheapestTrainPrice(params.origin, params.destination, params.date).catch(() => null);
    if (!dbResult) {
      console.log(`[Train] Skipping train: no high-speed rail, distance > 1000km, and no DB API result`);
      return null;
    }
    return buildTrainOption(params, distance, dbResult.duration, dbResult.price || 0, dbResult.operator, 'api');
  }

  let travelTime: number;
  let price: number;
  let operator: string;
  let dataSource: 'api' | 'estimated' = 'estimated';

  // 1. Try DB Transport REST API (real-time prices + schedules)
  try {
    const dbResult = await getCheapestTrainPrice(params.origin, params.destination, params.date);
    if (dbResult && dbResult.duration > 0) {
      travelTime = dbResult.duration;
      price = dbResult.price > 0 ? dbResult.price : 0;
      operator = dbResult.operator;
      dataSource = 'api';
      console.log(`[Train] DB API result: ${travelTime}min, ${price > 0 ? price + '€' : 'no price'}, ${operator}, ${dbResult.transfers} transfers`);

      if (price === 0) {
        const knownRoute = findKnownRoute(params.origin, params.destination);
        if (knownRoute) {
          price = knownRoute.price;
          console.log(`[Train] Using known route price as supplement: ${price}€`);
        } else {
          const pricePerKm = isHighSpeed ? PRICE_PER_KM.train_highspeed : PRICE_PER_KM.train_regular;
          price = Math.max(Math.round(distance * pricePerKm), 15);
          dataSource = 'estimated';
        }
      }

      return buildTrainOption(params, distance, travelTime, price, operator, dataSource);
    }
  } catch (err) {
    console.warn(`[Train] DB API error, falling back:`, err instanceof Error ? err.message : err);
  }

  // 2. Try known routes database
  const knownRoute = findKnownRoute(params.origin, params.destination);
  if (knownRoute) {
    travelTime = knownRoute.duration;
    price = knownRoute.price;
    operator = knownRoute.operator;
    dataSource = 'api';
    console.log(`[Train] Using known route: ${travelTime}min, ${price}€, ${operator}`);
    return buildTrainOption(params, distance, travelTime, price, operator, dataSource);
  }

  // 3. Fallback: distance-based estimation
  const speed = isHighSpeed ? SPEEDS.train_highspeed : SPEEDS.train_regular;
  travelTime = Math.round((distance / speed) * 60);
  const pricePerKm = isHighSpeed ? PRICE_PER_KM.train_highspeed : PRICE_PER_KM.train_regular;
  price = Math.round(distance * pricePerKm);
  if (distance > 500) price = Math.round(price * 0.85);
  price = Math.max(price, 15);
  operator = isHighSpeed ? getTrainOperator(params.origin, params.destination) : 'Train régional';

  return buildTrainOption(params, distance, travelTime, price, operator, 'estimated');
}

function buildTrainOption(
  params: TransportSearchParams,
  distance: number,
  travelTime: number,
  price: number,
  operator: string,
  dataSource: 'api' | 'estimated'
): TransportOption {
  const isHighSpeed = travelTime > 0 && distance > 0 && (distance / (travelTime / 60)) > 150;
  const totalDuration = travelTime +
    ADDITIONAL_TIME.train.station_access * 2 +
    ADDITIONAL_TIME.train.boarding;

  const co2Factor = isHighSpeed ? CO2_PER_KM.train_highspeed : CO2_PER_KM.train_regular;
  const co2 = Math.round(distance * co2Factor);
  const bookingUrl = getTrainBookingUrl(params.origin, params.destination, params.passengers, params.date);

  return {
    id: dataSource === 'api' ? 'train_api' : (isHighSpeed ? 'train_highspeed' : 'train'),
    mode: 'train',
    segments: [{
      mode: 'train',
      from: params.origin,
      to: params.destination,
      fromCoords: params.originCoords,
      toCoords: params.destCoords,
      duration: travelTime,
      price,
      co2,
      operator,
      frequency: isHighSpeed ? 'Plusieurs par jour' : '1-3 par jour',
      bookingUrl,
    }],
    totalDuration,
    totalPrice: price,
    totalCO2: co2,
    score: 0,
    scoreDetails: { priceScore: 0, timeScore: 0, co2Score: 0 },
    bookingUrl,
    dataSource,
  };
}

/**
 * Calcule l'option bus
 */
function calculateBusOption(params: TransportSearchParams, distance: number): TransportOption | null {
  const travelTime = Math.round((distance / SPEEDS.bus) * 60);

  // Bus: généralement de nuit pour les longs trajets
  const totalDuration = travelTime +
    ADDITIONAL_TIME.bus.station_access * 2 +
    ADDITIONAL_TIME.bus.boarding;

  // Prix (bus = très économique)
  const price = Math.round(distance * PRICE_PER_KM.bus);

  // CO2
  const co2 = Math.round(distance * CO2_PER_KM.bus);

  // FlixBus booking URL with date
  const dateStr = params.date ? params.date.toISOString().split('T')[0] : '';
  const bookingUrl = `https://www.flixbus.fr/recherche?departureCity=${encodeURIComponent(params.origin)}&arrivalCity=${encodeURIComponent(params.destination)}${dateStr ? `&rideDate=${dateStr}` : ''}`;

  return {
    id: 'bus',
    mode: 'bus',
    segments: [{
      mode: 'bus',
      from: params.origin,
      to: params.destination,
      fromCoords: params.originCoords,
      toCoords: params.destCoords,
      duration: travelTime,
      price,
      co2,
      operator: 'FlixBus / BlaBlaCar Bus',
      frequency: '1-4 par jour',
      bookingUrl,
    }],
    totalDuration,
    totalPrice: price,
    totalCO2: co2,
    score: 0,
    scoreDetails: { priceScore: 0, timeScore: 0, co2Score: 0 },
    bookingUrl,
  };
}

/**
 * Calcule l'option voiture
 */
function calculateCarOption(params: TransportSearchParams, distance: number): TransportOption | null {
  const travelTime = Math.round((distance / SPEEDS.car) * 60);

  // Pauses recommandées: 15min toutes les 2h
  const pauseTime = Math.floor(travelTime / 120) * 15;

  const totalDuration = travelTime + pauseTime + ADDITIONAL_TIME.car.preparation;

  // Prix: essence + péages (estimé)
  // ~0.15€/km essence + ~0.05€/km péages en moyenne
  const fuelCost = distance * 0.15;
  const tollCost = distance * 0.05;
  const price = Math.round(fuelCost + tollCost);

  // CO2 (divisé par nombre de passagers)
  const co2PerPerson = Math.round((distance * CO2_PER_KM.car) / Math.max(params.passengers, 2));

  const bookingUrl = `https://www.google.com/maps/dir/${encodeURIComponent(params.origin)}/${encodeURIComponent(params.destination)}`;

  return {
    id: 'car',
    mode: 'car',
    segments: [{
      mode: 'car',
      from: params.origin,
      to: params.destination,
      fromCoords: params.originCoords,
      toCoords: params.destCoords,
      duration: travelTime,
      price,
      co2: co2PerPerson,
      frequency: 'Flexible',
      bookingUrl,
    }],
    totalDuration,
    totalPrice: price,
    totalCO2: co2PerPerson,
    score: 0,
    scoreDetails: { priceScore: 0, timeScore: 0, co2Score: 0 },
    bookingUrl,
  };
}

/**
 * Calcule une option combinée (ex: train + avion)
 */
function calculateCombinedOption(params: TransportSearchParams, distance: number): TransportOption | null {
  // Chercher un hub de train proche de l'origine
  const originHubs = findNearbyHubs(params.origin);
  if (originHubs.length === 0) return null;

  const hub = originHubs[0];

  // Segment 1: Train vers le hub
  const trainDistance = 200; // Estimation
  const trainTime = Math.round((trainDistance / SPEEDS.train_highspeed) * 60);
  const trainPrice = Math.round(trainDistance * PRICE_PER_KM.train_highspeed);
  const trainCO2 = Math.round(trainDistance * CO2_PER_KM.train_highspeed);

  // Segment 2: Avion du hub vers destination
  const flightDistance = distance - trainDistance;
  const flightTime = Math.round((flightDistance / SPEEDS.plane) * 60);
  const flightPrice = Math.round(flightDistance * PRICE_PER_KM.plane);
  const flightCO2 = Math.round(flightDistance * CO2_PER_KM.plane_medium);

  const totalDuration = trainTime + flightTime +
    ADDITIONAL_TIME.train.station_access +
    ADDITIONAL_TIME.plane.checkin +
    ADDITIONAL_TIME.plane.transfer +
    60; // Correspondance

  return {
    id: 'combined_train_plane',
    mode: 'combined',
    segments: [
      {
        mode: 'train',
        from: params.origin,
        to: hub,
        duration: trainTime,
        price: trainPrice,
        co2: trainCO2,
        operator: 'Train grande vitesse',
      },
      {
        mode: 'plane',
        from: hub,
        to: params.destination,
        duration: flightTime,
        price: flightPrice,
        co2: flightCO2,
      },
    ],
    totalDuration,
    totalPrice: trainPrice + flightPrice,
    totalCO2: trainCO2 + flightCO2,
    score: 0,
    scoreDetails: { priceScore: 0, timeScore: 0, co2Score: 0 },
  };
}

/**
 * Calcule les scores pour chaque option
 */
function calculateScores(
  options: TransportOption[],
  prioritize: 'price' | 'time' | 'co2' | 'balanced'
): TransportOption[] {
  if (options.length === 0) return [];

  // Trouver min/max pour normalisation
  const prices = options.map(o => o.totalPrice);
  const durations = options.map(o => o.totalDuration);
  const co2s = options.map(o => o.totalCO2);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const minCO2 = Math.min(...co2s);
  const maxCO2 = Math.max(...co2s);

  // Poids selon la priorité
  let weights = { price: 0.33, time: 0.33, co2: 0.34 };
  switch (prioritize) {
    case 'price':
      weights = { price: 0.5, time: 0.3, co2: 0.2 };
      break;
    case 'time':
      weights = { price: 0.25, time: 0.5, co2: 0.25 };
      break;
    case 'co2':
      weights = { price: 0.2, time: 0.3, co2: 0.5 };
      break;
  }

  return options.map(option => {
    // Score prix: 10 si le moins cher, 0 si le plus cher
    const priceScore = maxPrice === minPrice
      ? 10
      : 10 - ((option.totalPrice - minPrice) / (maxPrice - minPrice)) * 10;

    // Score temps: 10 si le plus rapide
    const timeScore = maxDuration === minDuration
      ? 10
      : 10 - ((option.totalDuration - minDuration) / (maxDuration - minDuration)) * 10;

    // Score CO2: 10 si le moins polluant
    const co2Score = maxCO2 === minCO2
      ? 10
      : 10 - ((option.totalCO2 - minCO2) / (maxCO2 - minCO2)) * 10;

    // Score composite
    const score =
      priceScore * weights.price +
      timeScore * weights.time +
      co2Score * weights.co2;

    return {
      ...option,
      score: Math.round(score * 10) / 10,
      scoreDetails: {
        priceScore: Math.round(priceScore * 10) / 10,
        timeScore: Math.round(timeScore * 10) / 10,
        co2Score: Math.round(co2Score * 10) / 10,
      },
    };
  });
}

/**
 * Marque l'option recommandée
 */
function markRecommendation(options: TransportOption[]): void {
  if (options.length === 0) return;

  // La meilleure option globale
  const best = options.reduce((a, b) => a.score > b.score ? a : b);
  best.recommended = true;

  // Raisons de recommandation
  const reasons: string[] = [];

  if (best.scoreDetails.priceScore >= 8) reasons.push('économique');
  if (best.scoreDetails.timeScore >= 8) reasons.push('rapide');
  if (best.scoreDetails.co2Score >= 8) reasons.push('écologique');

  if (reasons.length > 0) {
    best.recommendationReason = `Option ${reasons.join(', ')}`;
  } else {
    best.recommendationReason = 'Meilleur compromis global';
  }

  // Marquer aussi le plus écologique si différent
  const mostEco = options.reduce((a, b) =>
    a.scoreDetails.co2Score > b.scoreDetails.co2Score ? a : b
  );
  if (mostEco.id !== best.id && mostEco.scoreDetails.co2Score >= 9) {
    mostEco.recommendationReason = 'Option la plus écologique';
  }
}

/**
 * Vérifie si une ligne TGV/AVE existe entre deux villes
 */
function hasDirectHighSpeedRail(origin: string, destination: string): boolean {
  const normalizedOrigin = normalizeCity(origin);
  const normalizedDest = normalizeCity(destination);

  // Vérifier dans les deux sens (Paris→London et London→Paris)
  const originRoutes = HIGH_SPEED_RAIL_ROUTES[normalizedOrigin] || [];
  const destRoutes = HIGH_SPEED_RAIL_ROUTES[normalizedDest] || [];

  const hasFromOrigin = originRoutes.some(city => normalizeCity(city) === normalizedDest);
  const hasFromDest = destRoutes.some(city => normalizeCity(city) === normalizedOrigin);

  console.log(`[Train] Checking high-speed rail: ${origin} (${normalizedOrigin}) → ${destination} (${normalizedDest})`);
  console.log(`[Train] Routes from ${normalizedOrigin}: ${originRoutes.join(', ')}`);
  console.log(`[Train] Routes from ${normalizedDest}: ${destRoutes.join(', ')}`);
  console.log(`[Train] Has direct: ${hasFromOrigin || hasFromDest}`);

  return hasFromOrigin || hasFromDest;
}

/**
 * Normalise le nom d'une ville pour le transport
 * Utilise le service unifié puis retourne le displayName
 */
function normalizeCity(city: string): string {
  const result = normalizeCitySync(city);
  return result.displayName;
}

/**
 * Retourne l'opérateur de train selon les villes
 */
function getTrainOperator(origin: string, destination: string): string {
  const cities = [origin.toLowerCase(), destination.toLowerCase()];

  if (cities.some(c => c.includes('paris') || c.includes('lyon') || c.includes('marseille'))) {
    return 'SNCF TGV';
  }
  if (cities.some(c => c.includes('barcelona') || c.includes('madrid') || c.includes('sevill'))) {
    return 'Renfe AVE';
  }
  if (cities.some(c => c.includes('london'))) {
    return 'Eurostar';
  }
  if (cities.some(c => c.includes('frankfurt') || c.includes('berlin') || c.includes('munich'))) {
    return 'Deutsche Bahn ICE';
  }
  if (cities.some(c => c.includes('rome') || c.includes('milan') || c.includes('florence'))) {
    return 'Trenitalia Frecciarossa';
  }
  return 'Train grande vitesse';
}

/**
 * Retourne l'URL de réservation train
 */
export function getTrainBookingUrl(origin: string, destination: string, passengers: number = 1, date?: Date): string {
  // Utiliser le service unifié pour normaliser les villes
  const originNorm = normalizeCitySync(origin);
  const destNorm = normalizeCitySync(destination);
  const originKey = originNorm.normalized.toLowerCase();
  const destKey = destNorm.normalized.toLowerCase();

  // Eurostar: Paris/Bruxelles/Amsterdam ↔ Londres
  const eurostarCities = ['london', 'paris', 'brussels', 'amsterdam', 'lille', 'rotterdam'];
  const isEurostarRoute = eurostarCities.includes(originKey) || eurostarCities.includes(destKey);

  if (isEurostarRoute && (originKey === 'london' || destKey === 'london')) {
    // Codes numériques Eurostar (format utilisé par leur site de recherche)
    const eurostarCodes: Record<string, string> = {
      'paris': '8727100',      // Paris Nord
      'london': '7015400',     // London St Pancras
      'brussels': '8814001',   // Bruxelles-Midi
      'amsterdam': '8400058',  // Amsterdam Centraal
      'lille': '8722326',      // Lille Europe
      'rotterdam': '8400530',  // Rotterdam Centraal
    };

    const originCode = eurostarCodes[originKey];
    const destCode = eurostarCodes[destKey];

    // Si on a trouvé les codes, générer l'URL avec paramètres incluant la date
    if (originCode && destCode) {
      const dateStr = date ? date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      return `https://www.eurostar.com/search/uk-en?adult=${passengers}&origin=${originCode}&destination=${destCode}&outbound=${dateStr}`;
    }

    // Fallback: page de recherche Eurostar avec villes pré-remplies
    return `https://www.eurostar.com/uk-en/travel/booking/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  }

  // Liste des clés normalisées pour vérification
  const cities = [originKey, destKey];

  // SNCF Connect: trajets France (avec date si dispo)
  const frenchCities = ['paris', 'lyon', 'marseille', 'bordeaux', 'toulouse', 'nice', 'strasbourg', 'lille', 'nantes', 'rennes', 'montpellier', 'caen', 'rouen', 'tours', 'dijon', 'avignon', 'angers', 'le mans', 'grenoble', 'clermont-ferrand'];
  if (cities.some(c => frenchCities.includes(c))) {
    const dateParam = date ? `&outwardDate=${date.toISOString().split('T')[0]}` : '';
    const paxParam = passengers > 1 ? `&passengers=${passengers}` : '';
    return `https://www.sncf-connect.com/app/home/search?from=${encodeURIComponent(origin)}&to=${encodeURIComponent(destination)}${dateParam}${paxParam}`;
  }

  // Renfe: trajets Espagne
  const spanishCities = ['barcelona', 'madrid', 'valencia', 'seville', 'malaga'];
  if (cities.some(c => spanishCities.includes(c))) {
    return `https://www.renfe.com/es/en`;
  }

  // Trainline: fonctionne pour la plupart des trajets européens
  return `https://www.thetrainline.com/en/train-times/${encodeURIComponent(origin.toLowerCase().replace(/\s+/g, '-'))}-to-${encodeURIComponent(destination.toLowerCase().replace(/\s+/g, '-'))}`;
}

/**
 * Trouve les hubs de transport proches d'une ville
 */
function findNearbyHubs(city: string): string[] {
  const normalized = normalizeCity(city);

  // Les grandes villes sont leurs propres hubs
  const majorHubs = ['Paris', 'London', 'Frankfurt', 'Amsterdam', 'Madrid', 'Barcelona', 'Milan', 'Rome', 'Munich', 'Zurich', 'Brussels', 'Vienna'];

  if (majorHubs.includes(normalized)) return [normalized];

  // Sinon, chercher le hub le plus proche (simplification)
  const hubMap: Record<string, string[]> = {
    'Lyon': ['Paris'],
    'Marseille': ['Paris'],
    'Nice': ['Paris', 'Milan'],
    'Toulouse': ['Paris', 'Barcelona'],
    'Bordeaux': ['Paris'],
    'Nantes': ['Paris'],
    'Valencia': ['Madrid', 'Barcelona'],
    'Seville': ['Madrid'],
    'Florence': ['Rome', 'Milan'],
    'Venice': ['Milan', 'Rome'],
    'Geneva': ['Paris', 'Zurich'],
  };

  return hubMap[normalized] || ['Paris']; // Paris par défaut
}

/**
 * Formate la durée en heures et minutes
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${mins.toString().padStart(2, '0')}`;
}

/**
 * Retourne l'icône pour un mode de transport
 */
export function getTransportModeIcon(mode: TransportOption['mode']): string {
  const icons: Record<string, string> = {
    plane: '✈️',
    train: '🚄',
    bus: '🚌',
    car: '🚗',
    combined: '🔄',
    ferry: '⛴️',
  };
  return icons[mode] || '🚀';
}

/**
 * Retourne le label français pour un mode
 */
export function getTransportModeLabel(mode: TransportOption['mode']): string {
  const labels: Record<string, string> = {
    plane: 'Avion',
    train: 'Train',
    bus: 'Bus',
    car: 'Voiture',
    combined: 'Combiné',
    ferry: 'Ferry',
  };
  return labels[mode] || mode;
}

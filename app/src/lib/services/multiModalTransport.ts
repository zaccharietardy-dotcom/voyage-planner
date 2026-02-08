/**
 * Service de transport multi-modal
 *
 * Optimise les trajets combinant plusieurs modes de transport:
 * - Voiture/train -> aéroport -> vol
 * - Bus/train -> gare TGV -> TGV
 * - Train -> port -> ferry (pour les îles)
 *
 * Utilise des règles déterministes (pas d'IA) pour identifier
 * les combinaisons pertinentes, puis tarifie chaque segment.
 */

import type { TransportSegment } from './transport';
import { searchFlights } from './flights';
import { searchFerryInfo } from './geminiSearch';
import { calculateCarCost } from './carCostCalculator';
import { getCheapestTrainPrice } from './dbTransport';
import { calculateDistance } from './geocoding';
import { AIRPORTS } from './geocoding';

// ============================================
// Types
// ============================================

export interface MultiModalOption {
  id: string;
  segments: TransportSegment[];
  totalDuration: number;        // minutes, transferts inclus
  totalPrice: number;           // EUR
  totalCO2: number;             // kg CO2
  transferTime: number;         // minutes entre segments
  description: string;          // ex: "Train Paris -> Marseille + Ferry -> Ajaccio"
  bookingLinks: { url: string; provider: string; label: string }[];
}

// ============================================
// Données de référence: hubs de transport
// ============================================

const TRANSPORT_HUBS: Record<string, {
  airports: string[];
  ferryPorts: string[];
  trainStations: string[];
}> = {
  'marseille': { airports: ['MRS'], ferryPorts: ['Marseille'], trainStations: ['Marseille Saint-Charles'] },
  'nice':      { airports: ['NCE'], ferryPorts: ['Nice'], trainStations: ['Nice Ville'] },
  'toulon':    { airports: [],      ferryPorts: ['Toulon'], trainStations: ['Toulon'] },
  'lyon':      { airports: ['LYS'], ferryPorts: [], trainStations: ['Lyon Part-Dieu'] },
  'paris':     { airports: ['CDG', 'ORY'], ferryPorts: [], trainStations: ['Paris Gare de Lyon', 'Paris Montparnasse'] },
  'barcelona': { airports: ['BCN'], ferryPorts: ['Barcelona'], trainStations: ['Barcelona Sants'] },
  'genoa':     { airports: ['GOA'], ferryPorts: ['Genova'], trainStations: ['Genova Piazza Principe'] },
  'rome':      { airports: ['FCO'], ferryPorts: ['Civitavecchia'], trainStations: ['Roma Termini'] },
  'naples':    { airports: ['NAP'], ferryPorts: ['Naples'], trainStations: ['Napoli Centrale'] },
  'livorno':   { airports: [],      ferryPorts: ['Livorno'], trainStations: ['Livorno Centrale'] },
  'valencia':  { airports: ['VLC'], ferryPorts: ['Valencia'], trainStations: ['Valencia Joaquin Sorolla'] },
};

// ============================================
// Routes ferry connues
// ============================================

interface FerryRoute {
  from: string;
  to: string;
  operator: string;
  duration: number;       // minutes
  estimatedPrice: number; // EUR par personne
  bookingUrl?: string;
}

const FERRY_ROUTES: FerryRoute[] = [
  // Corse
  { from: 'Marseille', to: 'Ajaccio',  operator: 'Corsica Linea', duration: 720, estimatedPrice: 80, bookingUrl: 'https://www.corsicalinea.com' },
  { from: 'Marseille', to: 'Bastia',   operator: 'Corsica Linea', duration: 660, estimatedPrice: 75, bookingUrl: 'https://www.corsicalinea.com' },
  { from: 'Nice',      to: 'Bastia',   operator: 'Corsica Linea', duration: 360, estimatedPrice: 55, bookingUrl: 'https://www.corsicalinea.com' },
  { from: 'Toulon',    to: 'Ajaccio',  operator: 'Corsica Linea', duration: 420, estimatedPrice: 60, bookingUrl: 'https://www.corsicalinea.com' },
  { from: 'Livorno',   to: 'Bastia',   operator: 'Corsica Linea', duration: 240, estimatedPrice: 45, bookingUrl: 'https://www.corsicalinea.com' },
  // Baléares
  { from: 'Barcelona', to: 'Palma',    operator: 'Balearia',         duration: 450, estimatedPrice: 60, bookingUrl: 'https://www.balearia.com' },
  { from: 'Valencia',  to: 'Palma',    operator: 'Trasmediterranea', duration: 480, estimatedPrice: 55, bookingUrl: 'https://www.trasmediterranea.es' },
  // Sardaigne
  { from: 'Civitavecchia', to: 'Olbia',  operator: 'GNV', duration: 360, estimatedPrice: 50, bookingUrl: 'https://www.gnv.it' },
  { from: 'Genova',       to: 'Olbia',  operator: 'GNV', duration: 600, estimatedPrice: 55, bookingUrl: 'https://www.gnv.it' },
  // Sicile
  { from: 'Naples', to: 'Palermo', operator: 'GNV', duration: 660, estimatedPrice: 50, bookingUrl: 'https://www.gnv.it' },
];

// Destinations insulaires et leurs ports d'arrivée
const ISLAND_DESTINATIONS: Record<string, string[]> = {
  'ajaccio':  ['Ajaccio'],
  'bastia':   ['Bastia'],
  'porto-vecchio': ['Bastia', 'Ajaccio'],
  'bonifacio': ['Bastia', 'Ajaccio'],
  'calvi':    ['Bastia'],
  'corte':    ['Bastia', 'Ajaccio'],
  'corse':    ['Ajaccio', 'Bastia'],
  'corsica':  ['Ajaccio', 'Bastia'],
  'palma':    ['Palma'],
  'palma de mallorca': ['Palma'],
  'majorque': ['Palma'],
  'mallorca': ['Palma'],
  'ibiza':    ['Palma'], // via Palma ou direct
  'olbia':    ['Olbia'],
  'sardaigne': ['Olbia'],
  'sardinia': ['Olbia'],
  'palermo':  ['Palermo'],
  'sicile':   ['Palermo'],
  'sicily':   ['Palermo'],
};

// Temps de transfert par défaut entre segments (minutes)
const DEFAULT_TRANSFER_TIME = 120;

// CO2 par km par passager (kg)
const CO2_PER_KM: Record<string, number> = {
  plane: 0.195,
  train: 0.004,
  bus: 0.027,
  car: 0.104,
  ferry: 0.120,
};

// ============================================
// Fonction principale
// ============================================

/**
 * Trouve les options de transport multi-modal entre deux villes.
 * Utilise des règles déterministes pour identifier les combinaisons
 * pertinentes puis tarifie chaque segment via les APIs existantes.
 */
export async function findMultiModalOptions(
  origin: string,
  destination: string,
  date: Date,
  passengers: number,
  budgetLevel: 'economic' | 'moderate' | 'comfort' | 'luxury',
  originCoords?: { lat: number; lng: number },
  destCoords?: { lat: number; lng: number }
): Promise<MultiModalOption[]> {
  // Calcul de distance si coordonnées disponibles
  let distance = 0;
  if (originCoords && destCoords) {
    distance = calculateDistance(
      originCoords.lat, originCoords.lng,
      destCoords.lat, destCoords.lng
    );
  }

  // Skip si distance trop courte ou trop longue
  if (distance > 0 && distance < 300) {
    return [];
  }
  if (distance > 5000) {
    return [];
  }

  const destKey = normalizeKey(destination);
  const originKey = normalizeKey(origin);

  const options: MultiModalOption[] = [];

  // Scénario A: destination insulaire (ferry nécessaire)
  if (isIslandDestination(destKey)) {
    const ferryOptions = await buildFerryOptions(origin, originKey, destination, destKey, date, passengers);
    options.push(...ferryOptions);
  }

  // Scénario B: longue distance + budget serré -> hub aérien moins cher
  if (distance > 800 && (budgetLevel === 'economic' || budgetLevel === 'moderate') && !isIslandDestination(destKey)) {
    const hubOptions = await buildHubFlightOptions(origin, originKey, destination, destKey, date, passengers);
    options.push(...hubOptions);
  }

  // Scénario C: destination loin d'un aéroport majeur
  if (distance > 500 && !isIslandDestination(destKey)) {
    const lastMileOptions = await buildLastMileOptions(origin, originKey, destination, destKey, date, passengers, destCoords);
    options.push(...lastMileOptions);
  }

  // Limiter à 3 options max, triées par prix
  const sorted = options.sort((a, b) => a.totalPrice - b.totalPrice);
  return sorted.slice(0, 3);
}

// ============================================
// Scénario A: Ferry (destinations insulaires)
// ============================================

async function buildFerryOptions(
  origin: string,
  originKey: string,
  destination: string,
  destKey: string,
  date: Date,
  passengers: number
): Promise<MultiModalOption[]> {
  const arrivalPorts = ISLAND_DESTINATIONS[destKey] || [];
  if (arrivalPorts.length === 0) return [];

  const results: MultiModalOption[] = [];

  // Trouver les routes ferry vers ces ports
  for (const arrivalPort of arrivalPorts) {
    const matchingRoutes = FERRY_ROUTES.filter(r => r.to === arrivalPort);

    for (const route of matchingRoutes) {
      const portCity = route.from;
      const portKey = normalizeKey(portCity);

      // Si l'origine est la même ville que le port, pas besoin de premier segment
      if (portKey === originKey) {
        const ferrySegment = buildFerrySegment(route, passengers);
        results.push({
          id: `ferry-direct-${portCity}-${arrivalPort}`.toLowerCase(),
          segments: [ferrySegment],
          totalDuration: route.duration,
          totalPrice: route.estimatedPrice * passengers,
          totalCO2: estimateFerryC02(route.duration),
          transferTime: 0,
          description: `Ferry ${portCity} → ${arrivalPort} (${route.operator})`,
          bookingLinks: route.bookingUrl
            ? [{ url: route.bookingUrl, provider: route.operator, label: `Réserver ${route.operator}` }]
            : [],
        });
        continue;
      }

      // Sinon: train origine -> port + ferry
      try {
        const trainResult = await getCheapestTrainPrice(origin, portCity, date);
        const trainPrice = trainResult?.price ?? estimateTrainPrice(origin, portCity);
        const trainDuration = trainResult?.duration ?? estimateTrainDuration(origin, portCity);
        const trainOperator = trainResult?.operator ?? 'SNCF';

        const trainSegment: TransportSegment = {
          mode: 'train',
          from: origin,
          to: portCity,
          duration: trainDuration,
          price: trainPrice * passengers,
          co2: estimateTrainCO2(trainDuration),
          operator: trainOperator,
          bookingUrl: buildTrainBookingUrl(origin, portCity, passengers, date),
        };

        const ferrySegment = buildFerrySegment(route, passengers);

        const totalPrice = (trainPrice * passengers) + (route.estimatedPrice * passengers);
        const totalDuration = trainDuration + DEFAULT_TRANSFER_TIME + route.duration;
        const totalCO2 = trainSegment.co2 + ferrySegment.co2;

        results.push({
          id: `train+ferry-${portCity}-${arrivalPort}`.toLowerCase(),
          segments: [trainSegment, ferrySegment],
          totalDuration,
          totalPrice,
          totalCO2,
          transferTime: DEFAULT_TRANSFER_TIME,
          description: `Train ${origin} → ${portCity} + Ferry → ${arrivalPort}`,
          bookingLinks: [
            { url: trainSegment.bookingUrl!, provider: trainOperator, label: `Train ${origin}-${portCity}` },
            ...(route.bookingUrl ? [{ url: route.bookingUrl, provider: route.operator, label: `Ferry ${route.operator}` }] : []),
          ],
        });
      } catch (err) {
        console.warn(`[MultiModal] Erreur tarification train ${origin}->${portCity}:`, err);
      }
    }

    // Limiter: garder seulement les 2 meilleures options ferry
    if (results.length > 2) break;
  }

  return results.slice(0, 2);
}

// ============================================
// Scénario B: Hub aérien moins cher
// ============================================

async function buildHubFlightOptions(
  origin: string,
  originKey: string,
  destination: string,
  destKey: string,
  date: Date,
  passengers: number
): Promise<MultiModalOption[]> {
  // Hubs potentiels accessibles en train depuis l'origine
  const nearbyHubs = findNearbyHubs(originKey);
  if (nearbyHubs.length === 0) return [];

  const results: MultiModalOption[] = [];
  const dateStr = formatDate(date);

  for (const hubKey of nearbyHubs.slice(0, 2)) {
    const hub = TRANSPORT_HUBS[hubKey];
    if (!hub || hub.airports.length === 0) continue;

    const hubCity = capitalize(hubKey);
    const airportCode = hub.airports[0];

    // Chercher le code aéroport de la destination
    const destAirportCode = findAirportCode(destination);
    if (!destAirportCode) continue;

    try {
      // Train vers le hub
      const trainResult = await getCheapestTrainPrice(origin, hubCity, date);
      const trainPrice = trainResult?.price ?? estimateTrainPrice(origin, hubCity);
      const trainDuration = trainResult?.duration ?? estimateTrainDuration(origin, hubCity);

      // Vol depuis le hub
      const flightResult = await searchFlights({
        originCode: airportCode,
        destinationCode: destAirportCode,
        departureDate: dateStr,
        adults: passengers,
        cabinClass: 'economy',
      });

      const cheapestFlight = flightResult.outboundFlights
        .filter(f => f.price > 0)
        .sort((a, b) => a.price - b.price)[0];

      if (!cheapestFlight) continue;

      const trainSegment: TransportSegment = {
        mode: 'train',
        from: origin,
        to: hubCity,
        duration: trainDuration,
        price: trainPrice * passengers,
        co2: estimateTrainCO2(trainDuration),
        operator: trainResult?.operator ?? 'SNCF',
        bookingUrl: buildTrainBookingUrl(origin, hubCity, passengers, date),
      };

      const flightSegment: TransportSegment = {
        mode: 'plane',
        from: hubCity,
        to: destination,
        duration: cheapestFlight.duration,
        price: cheapestFlight.price * passengers,
        co2: estimateFlightCO2(cheapestFlight.duration),
        operator: cheapestFlight.airline,
        bookingUrl: cheapestFlight.bookingUrl,
      };

      const totalPrice = (trainPrice * passengers) + (cheapestFlight.price * passengers);
      const totalDuration = trainDuration + DEFAULT_TRANSFER_TIME + cheapestFlight.duration;

      results.push({
        id: `train+plane-via-${hubKey}`,
        segments: [trainSegment, flightSegment],
        totalDuration,
        totalPrice,
        totalCO2: trainSegment.co2 + flightSegment.co2,
        transferTime: DEFAULT_TRANSFER_TIME,
        description: `Train ${origin} → ${hubCity} + Vol ${airportCode} → ${destAirportCode}`,
        bookingLinks: [
          { url: trainSegment.bookingUrl!, provider: trainSegment.operator ?? 'SNCF', label: `Train ${origin}-${hubCity}` },
          ...(cheapestFlight.bookingUrl ? [{ url: cheapestFlight.bookingUrl, provider: cheapestFlight.airline, label: `Vol ${cheapestFlight.airline}` }] : []),
        ],
      });
    } catch (err) {
      console.warn(`[MultiModal] Erreur hub ${hubKey}:`, err);
    }
  }

  return results.slice(0, 2);
}

// ============================================
// Scénario C: Vol + dernier kilomètre
// ============================================

async function buildLastMileOptions(
  origin: string,
  originKey: string,
  destination: string,
  destKey: string,
  date: Date,
  passengers: number,
  destCoords?: { lat: number; lng: number }
): Promise<MultiModalOption[]> {
  // Trouver l'aéroport majeur le plus proche de la destination
  const nearestHub = findNearestHubToDestination(destKey);
  if (!nearestHub) return [];

  const hubCity = capitalize(nearestHub);
  const hub = TRANSPORT_HUBS[nearestHub];
  if (!hub || hub.airports.length === 0) return [];

  // Si le hub est la destination elle-même, pas de last mile
  if (nearestHub === destKey) return [];

  const originAirportCode = findAirportCode(origin);
  const hubAirportCode = hub.airports[0];
  if (!originAirportCode) return [];

  const dateStr = formatDate(date);

  try {
    // Vol vers le hub
    const flightResult = await searchFlights({
      originCode: originAirportCode,
      destinationCode: hubAirportCode,
      departureDate: dateStr,
      adults: passengers,
      cabinClass: 'economy',
    });

    const cheapestFlight = flightResult.outboundFlights
      .filter(f => f.price > 0)
      .sort((a, b) => a.price - b.price)[0];

    if (!cheapestFlight) return [];

    // Train hub -> destination finale
    const trainResult = await getCheapestTrainPrice(hubCity, destination, date);
    if (!trainResult && !canEstimateTrain(hubCity, destination)) return [];

    const trainPrice = trainResult?.price ?? estimateTrainPrice(hubCity, destination);
    const trainDuration = trainResult?.duration ?? estimateTrainDuration(hubCity, destination);

    const flightSegment: TransportSegment = {
      mode: 'plane',
      from: origin,
      to: hubCity,
      duration: cheapestFlight.duration,
      price: cheapestFlight.price * passengers,
      co2: estimateFlightCO2(cheapestFlight.duration),
      operator: cheapestFlight.airline,
      bookingUrl: cheapestFlight.bookingUrl,
    };

    const trainSegment: TransportSegment = {
      mode: 'train',
      from: hubCity,
      to: destination,
      duration: trainDuration,
      price: trainPrice * passengers,
      co2: estimateTrainCO2(trainDuration),
      operator: trainResult?.operator ?? 'Train régional',
      bookingUrl: buildTrainBookingUrl(hubCity, destination, passengers, date),
    };

    const totalPrice = (cheapestFlight.price * passengers) + (trainPrice * passengers);
    const totalDuration = cheapestFlight.duration + DEFAULT_TRANSFER_TIME + trainDuration;

    return [{
      id: `plane+train-via-${nearestHub}`,
      segments: [flightSegment, trainSegment],
      totalDuration,
      totalPrice,
      totalCO2: flightSegment.co2 + trainSegment.co2,
      transferTime: DEFAULT_TRANSFER_TIME,
      description: `Vol ${origin} → ${hubCity} + Train → ${destination}`,
      bookingLinks: [
        ...(cheapestFlight.bookingUrl ? [{ url: cheapestFlight.bookingUrl, provider: cheapestFlight.airline, label: `Vol ${cheapestFlight.airline}` }] : []),
        { url: trainSegment.bookingUrl!, provider: trainSegment.operator ?? 'Train', label: `Train ${hubCity}-${destination}` },
      ],
    }];
  } catch (err) {
    console.warn(`[MultiModal] Erreur last-mile via ${nearestHub}:`, err);
    return [];
  }
}

// ============================================
// Fonctions utilitaires
// ============================================

function normalizeKey(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s-]/g, '')
    .trim();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isIslandDestination(destKey: string): boolean {
  return Object.keys(ISLAND_DESTINATIONS).some(
    island => destKey.includes(island) || island.includes(destKey)
  );
}

function findAirportCode(city: string): string | null {
  const key = normalizeKey(city);

  // Vérifier dans les hubs
  const hub = TRANSPORT_HUBS[key];
  if (hub?.airports.length) return hub.airports[0];

  // Vérifier dans AIRPORTS (importé de geocoding)
  if (AIRPORTS) {
    for (const [code, airport] of Object.entries(AIRPORTS)) {
      const airportCity = (airport as { city?: string }).city?.toLowerCase() ?? '';
      if (airportCity === key || key.includes(airportCity)) return code;
    }
  }

  return null;
}

/** Trouver les hubs accessibles en train depuis une ville */
function findNearbyHubs(originKey: string): string[] {
  // Hubs par proximité géographique approximative (France-centrique)
  const hubProximity: Record<string, string[]> = {
    'paris':     ['lyon', 'lille'],
    'lyon':      ['paris', 'marseille', 'genoa'],
    'marseille': ['lyon', 'nice', 'barcelona'],
    'nice':      ['marseille', 'genoa'],
    'toulouse':  ['barcelona', 'lyon'],
    'bordeaux':  ['paris', 'toulouse'],
    'nantes':    ['paris'],
    'lille':     ['paris'],
    'strasbourg': ['paris', 'lyon'],
    'montpellier': ['lyon', 'marseille', 'barcelona'],
    'rennes':    ['paris'],
  };

  return hubProximity[originKey] ?? [];
}

/** Trouver le hub aérien le plus proche de la destination */
function findNearestHubToDestination(destKey: string): string | null {
  // Villes proches de hubs avec aéroports majeurs
  const cityToHub: Record<string, string> = {
    'cannes':       'nice',
    'antibes':      'nice',
    'monaco':       'nice',
    'menton':       'nice',
    'saint-tropez': 'nice',
    'avignon':      'marseille',
    'aix-en-provence': 'marseille',
    'montpellier':  'marseille',
    'nimes':        'marseille',
    'san remo':     'nice',
    'sanremo':      'nice',
    'pisa':         'rome',
    'florence':     'rome',
    'siena':        'rome',
    'girona':       'barcelona',
    'tarragona':    'barcelona',
    'sitges':       'barcelona',
  };

  return cityToHub[destKey] ?? null;
}

function buildFerrySegment(route: FerryRoute, passengers: number): TransportSegment {
  return {
    mode: 'ferry',
    from: route.from,
    to: route.to,
    duration: route.duration,
    price: route.estimatedPrice * passengers,
    co2: estimateFerryC02(route.duration),
    operator: route.operator,
    bookingUrl: route.bookingUrl,
  };
}

function buildTrainBookingUrl(origin: string, dest: string, passengers: number, date: Date): string {
  const dateStr = formatDate(date);
  // Lien SNCF Connect générique
  return `https://www.sncf-connect.com/app/home/search?departure=${encodeURIComponent(origin)}&arrival=${encodeURIComponent(dest)}&outwardDate=${dateStr}&passengers=${passengers}`;
}

// Estimations de prix/durée quand l'API ne répond pas
function estimateTrainPrice(from: string, to: string): number {
  // ~0.10 EUR/km en moyenne TGV, estimation grossière basée sur la durée
  return 45; // prix moyen fallback
}

function estimateTrainDuration(from: string, to: string): number {
  return 180; // 3h par défaut
}

function canEstimateTrain(from: string, to: string): boolean {
  // On peut toujours fournir une estimation grossière
  return true;
}

// CO2 estimations
function estimateTrainCO2(durationMinutes: number): number {
  // TGV ~250km/h, 0.004 kg CO2/km
  const distKm = (durationMinutes / 60) * 250;
  return Math.round(distKm * CO2_PER_KM.train * 10) / 10;
}

function estimateFlightCO2(durationMinutes: number): number {
  // Avion ~800km/h, 0.195 kg CO2/km
  const distKm = (durationMinutes / 60) * 800;
  return Math.round(distKm * CO2_PER_KM.plane * 10) / 10;
}

function estimateFerryC02(durationMinutes: number): number {
  // Ferry ~30km/h, 0.120 kg CO2/km
  const distKm = (durationMinutes / 60) * 30;
  return Math.round(distKm * CO2_PER_KM.ferry * 10) / 10;
}

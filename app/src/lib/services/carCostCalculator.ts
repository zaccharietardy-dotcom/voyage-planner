import { searchTollCost } from './geminiSearch';

export interface CarCostBreakdown {
  fuel: number;        // EUR
  tolls: number;       // EUR
  total: number;       // EUR
  fuelDetails: {
    distance: number;    // km
    consumption: number; // L/100km
    fuelPrice: number;   // EUR/L
  };
  tollDetails: {
    route?: string;      // e.g. "A6 puis A7"
    source: 'gemini' | 'estimated';
  };
}

const TOLL_RATES_PER_KM: Record<string, number> = {
  'france': 0.09,
  'spain': 0.07,
  'italy': 0.10,
  'portugal': 0.08,
  'germany': 0,
  'austria': 0.01,
  'switzerland': 0.01,
  'belgium': 0,
  'netherlands': 0,
  'uk': 0,
  'czech republic': 0.01,
  'croatia': 0.08,
  'greece': 0.06,
};

const CITY_COUNTRIES: Record<string, string> = {
  // France
  'paris': 'france', 'lyon': 'france', 'marseille': 'france', 'nice': 'france',
  'toulouse': 'france', 'bordeaux': 'france', 'lille': 'france', 'nantes': 'france',
  'strasbourg': 'france', 'montpellier': 'france', 'rennes': 'france', 'grenoble': 'france',
  'avignon': 'france', 'aix-en-provence': 'france', 'dijon': 'france', 'annecy': 'france',
  'biarritz': 'france', 'perpignan': 'france', 'clermont-ferrand': 'france',
  // Spain
  'madrid': 'spain', 'barcelona': 'spain', 'seville': 'spain', 'valencia': 'spain',
  'malaga': 'spain', 'bilbao': 'spain', 'granada': 'spain', 'san sebastian': 'spain',
  'alicante': 'spain', 'zaragoza': 'spain', 'cordoba': 'spain', 'toledo': 'spain',
  // Italy
  'rome': 'italy', 'milan': 'italy', 'florence': 'italy', 'venice': 'italy',
  'naples': 'italy', 'turin': 'italy', 'bologna': 'italy', 'genoa': 'italy',
  'pisa': 'italy', 'verona': 'italy', 'palermo': 'italy', 'amalfi': 'italy',
  'siena': 'italy', 'como': 'italy',
  // Germany
  'berlin': 'germany', 'munich': 'germany', 'frankfurt': 'germany', 'hamburg': 'germany',
  'cologne': 'germany', 'dusseldorf': 'germany', 'stuttgart': 'germany', 'dresden': 'germany',
  'nuremberg': 'germany', 'heidelberg': 'germany',
  // Portugal
  'lisbon': 'portugal', 'porto': 'portugal', 'faro': 'portugal', 'braga': 'portugal',
  // Austria
  'vienna': 'austria', 'salzburg': 'austria', 'innsbruck': 'austria', 'graz': 'austria',
  // Switzerland
  'zurich': 'switzerland', 'geneva': 'switzerland', 'bern': 'switzerland', 'basel': 'switzerland',
  'lausanne': 'switzerland', 'lucerne': 'switzerland', 'interlaken': 'switzerland',
  // Belgium
  'brussels': 'belgium', 'bruges': 'belgium', 'ghent': 'belgium', 'antwerp': 'belgium',
  // Netherlands
  'amsterdam': 'netherlands', 'rotterdam': 'netherlands', 'the hague': 'netherlands',
  'utrecht': 'netherlands',
  // UK
  'london': 'uk', 'edinburgh': 'uk', 'manchester': 'uk', 'liverpool': 'uk',
  'birmingham': 'uk', 'oxford': 'uk', 'cambridge': 'uk', 'bath': 'uk',
  // Czech Republic
  'prague': 'czech republic', 'brno': 'czech republic',
  // Croatia
  'zagreb': 'croatia', 'dubrovnik': 'croatia', 'split': 'croatia',
  // Greece
  'athens': 'greece', 'thessaloniki': 'greece', 'patras': 'greece',
};

function detectCountry(location: string): string | null {
  const normalized = location.toLowerCase().trim();
  // Direct match
  if (CITY_COUNTRIES[normalized]) return CITY_COUNTRIES[normalized];
  // Check if any known city is contained in the location string
  for (const [city, country] of Object.entries(CITY_COUNTRIES)) {
    if (normalized.includes(city)) return country;
  }
  // Check if a country name is in the string
  for (const country of Object.keys(TOLL_RATES_PER_KM)) {
    if (normalized.includes(country)) return country;
  }
  return null;
}

function estimateTolls(origin: string, destination: string, distance: number): number {
  const originCountry = detectCountry(origin);
  const destCountry = detectCountry(destination);

  if (!originCountry && !destCountry) {
    // Default to France rate as conservative estimate
    console.log(`[Car Cost] No country detected for "${origin}" / "${destination}", using France default`);
    return Math.round(distance * 0.09);
  }

  const originRate = originCountry ? (TOLL_RATES_PER_KM[originCountry] ?? 0.05) : 0.05;
  const destRate = destCountry ? (TOLL_RATES_PER_KM[destCountry] ?? 0.05) : 0.05;

  const rate = originCountry && destCountry && originCountry !== destCountry
    ? (originRate + destRate) / 2
    : originCountry ? originRate : destRate;

  return Math.round(distance * rate);
}

/**
 * Calculate car travel cost with fuel + toll breakdown
 * Uses Gemini for toll lookup, fallback to country-based estimates
 */
export async function calculateCarCost(
  origin: string,
  destination: string,
  distance: number,
  options?: {
    fuelPricePerLiter?: number;
    consumptionPer100km?: number;
    passengers?: number;
  }
): Promise<CarCostBreakdown> {
  const fuelPrice = options?.fuelPricePerLiter ?? 1.85;
  const consumption = options?.consumptionPer100km ?? 6.5;

  // Fuel calculation
  const fuel = Math.round((distance / 100) * consumption * fuelPrice);
  console.log(`[Car Cost] Fuel: ${distance}km * ${consumption}L/100km * ${fuelPrice}EUR/L = ${fuel}EUR`);

  // Toll calculation - try Gemini first
  let tolls = 0;
  let tollRoute: string | undefined;
  let tollSource: 'gemini' | 'estimated' = 'estimated';

  try {
    console.log(`[Car Cost] Searching toll cost via Gemini: ${origin} -> ${destination}`);
    const geminiResult = await searchTollCost(origin, destination);
    if (geminiResult && geminiResult.toll > 0) {
      tolls = Math.round(geminiResult.toll);
      tollRoute = geminiResult.route;
      tollSource = 'gemini';
      console.log(`[Car Cost] Gemini toll: ${tolls}EUR (route: ${tollRoute ?? 'unknown'})`);
    } else {
      console.log(`[Car Cost] Gemini returned no toll data, falling back to estimate`);
      tolls = estimateTolls(origin, destination, distance);
      console.log(`[Car Cost] Estimated toll: ${tolls}EUR`);
    }
  } catch (err) {
    console.log(`[Car Cost] Gemini toll lookup failed, using estimate:`, err);
    tolls = estimateTolls(origin, destination, distance);
    console.log(`[Car Cost] Estimated toll: ${tolls}EUR`);
  }

  const total = fuel + tolls;
  console.log(`[Car Cost] Total: ${total}EUR (fuel: ${fuel} + tolls: ${tolls})`);

  return {
    fuel,
    tolls,
    total,
    fuelDetails: {
      distance,
      consumption,
      fuelPrice,
    },
    tollDetails: {
      route: tollRoute,
      source: tollSource,
    },
  };
}

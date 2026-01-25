/**
 * Service de calcul d'empreinte carbone
 *
 * Sources:
 * - ADEME (Agence de l'Environnement et de la Maîtrise de l'Énergie)
 * - ICAO Carbon Emissions Calculator
 * - European Environment Agency
 */

// Émissions en kg CO2 par km par passager
const EMISSIONS_PER_KM: Record<string, number> = {
  // Avion (varie selon distance)
  plane_short: 0.255,      // < 1000 km (décollage/atterrissage = plus d'émissions)
  plane_medium: 0.195,     // 1000-3500 km
  plane_long: 0.152,       // > 3500 km

  // Train
  train_tgv: 0.003,        // TGV France (électrique nucléaire)
  train_intercity: 0.008,  // Intercités
  train_europe: 0.014,     // Train européen moyen

  // Voiture (par passager, 2 personnes en moyenne)
  car_petrol: 0.104,       // Essence
  car_diesel: 0.089,       // Diesel
  car_electric: 0.020,     // Électrique (selon mix énergétique)
  car_hybrid: 0.068,       // Hybride

  // Bus
  bus_coach: 0.027,        // Autocar longue distance
  bus_urban: 0.068,        // Bus urbain

  // Autres
  metro: 0.003,            // Métro (électrique)
  ferry: 0.120,            // Ferry
  walk: 0,
  bike: 0,
};

// Équivalences pour compréhension
const CO2_EQUIVALENTS = {
  tree_absorption_per_year: 25,  // kg CO2 absorbé par an par arbre
  km_car_average: 0.21,          // kg CO2 par km en voiture (moyenne française)
  steak_beef: 6.5,               // kg CO2 par steak de boeuf
  smartphone_charge: 0.008,      // kg CO2 par charge
  streaming_hour: 0.036,         // kg CO2 par heure de streaming HD
};

export interface CarbonBreakdown {
  flights: number;           // kg CO2
  localTransport: number;
  accommodation: number;
  total: number;
  equivalents: {
    treesNeeded: number;     // Arbres pour compenser
    carKmEquivalent: number; // Équivalent km en voiture
    beefSteaks: number;      // Équivalent steaks de boeuf
  };
  comparison: {
    trainAlternative?: number;  // Si le trajet était possible en train
    carAlternative?: number;    // Si le trajet était fait en voiture
    percentVsAverage: number;   // % par rapport à la moyenne
  };
  rating: 'A' | 'B' | 'C' | 'D' | 'E'; // Note environnementale
  tips: string[];            // Conseils pour réduire
}

/**
 * Calcule l'empreinte carbone d'un vol
 */
export function calculateFlightCarbon(
  distanceKm: number,
  passengers: number = 1,
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first' = 'economy'
): number {
  // Facteur par type de distance
  let emissionFactor: number;
  if (distanceKm < 1000) {
    emissionFactor = EMISSIONS_PER_KM.plane_short;
  } else if (distanceKm < 3500) {
    emissionFactor = EMISSIONS_PER_KM.plane_medium;
  } else {
    emissionFactor = EMISSIONS_PER_KM.plane_long;
  }

  // Facteur par classe (plus d'espace = plus de responsabilité)
  const classMultiplier: Record<string, number> = {
    economy: 1.0,
    premium_economy: 1.5,
    business: 2.5,
    first: 4.0,
  };

  const multiplier = classMultiplier[cabinClass] || 1.0;

  return distanceKm * emissionFactor * multiplier * passengers;
}

/**
 * Calcule l'empreinte carbone des transports locaux
 */
export function calculateLocalTransportCarbon(
  activities: { type: string; distanceKm: number }[]
): number {
  let total = 0;

  for (const activity of activities) {
    const emissionFactor = getTransportEmissionFactor(activity.type);
    total += activity.distanceKm * emissionFactor;
  }

  return total;
}

/**
 * Calcule l'empreinte carbone de l'hébergement
 */
export function calculateAccommodationCarbon(
  nights: number,
  type: 'hotel' | 'apartment' | 'hostel' | 'camping' = 'hotel',
  stars: number = 3
): number {
  // kg CO2 par nuit selon le type
  const baseEmissions: Record<string, number> = {
    hotel: 10,        // Hôtel standard
    apartment: 5,     // Appartement
    hostel: 4,        // Auberge de jeunesse
    camping: 2,       // Camping
  };

  // Facteur selon le standing (plus de services = plus d'énergie)
  const starMultiplier = 1 + (stars - 3) * 0.2; // +20% par étoile au-dessus de 3

  return nights * (baseEmissions[type] || 10) * Math.max(0.8, starMultiplier);
}

/**
 * Calcule l'empreinte carbone totale d'un voyage
 */
export function calculateTripCarbon(params: {
  flightDistanceKm: number;
  returnFlight: boolean;
  passengers: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  nights: number;
  accommodationType?: 'hotel' | 'apartment' | 'hostel' | 'camping';
  accommodationStars?: number;
  localTransportKm?: number;
}): CarbonBreakdown {
  // Calcul des vols (aller + retour si applicable)
  const flightMultiplier = params.returnFlight ? 2 : 1;
  const flightCarbon = calculateFlightCarbon(
    params.flightDistanceKm * flightMultiplier,
    params.passengers,
    params.cabinClass
  );

  // Hébergement
  const accommodationCarbon = calculateAccommodationCarbon(
    params.nights,
    params.accommodationType,
    params.accommodationStars
  );

  // Transports locaux (estimation si non fourni)
  const localKm = params.localTransportKm || params.nights * 10; // ~10km/jour
  const localTransportCarbon = localKm * EMISSIONS_PER_KM.bus_urban;

  const total = flightCarbon + accommodationCarbon + localTransportCarbon;

  // Alternatives
  const trainAlternative = params.flightDistanceKm < 1000
    ? params.flightDistanceKm * flightMultiplier * EMISSIONS_PER_KM.train_tgv * params.passengers
    : undefined;

  const carAlternative = params.flightDistanceKm * flightMultiplier *
    EMISSIONS_PER_KM.car_petrol * (params.passengers / 2); // 2 personnes par voiture

  // Moyenne française: ~11 tonnes CO2/an/personne, ~1.5 tonne pour voyages
  const averageVacationCarbon = 500; // kg CO2 pour un voyage moyen
  const percentVsAverage = Math.round((total / averageVacationCarbon) * 100);

  // Note environnementale
  let rating: CarbonBreakdown['rating'];
  if (total < 100) rating = 'A';
  else if (total < 250) rating = 'B';
  else if (total < 500) rating = 'C';
  else if (total < 1000) rating = 'D';
  else rating = 'E';

  // Conseils
  const tips: string[] = [];
  if (params.flightDistanceKm < 800) {
    tips.push('Pour cette distance, le train émet 50x moins de CO2 que l\'avion');
  }
  if (params.cabinClass && params.cabinClass !== 'economy') {
    tips.push('Voyager en classe économique réduit votre empreinte');
  }
  if (flightCarbon > 300) {
    tips.push('Envisagez de compenser vos émissions via un programme certifié');
  }
  tips.push('Privilégiez les transports en commun sur place');
  tips.push('Choisissez des hébergements éco-labellisés');

  return {
    flights: Math.round(flightCarbon),
    localTransport: Math.round(localTransportCarbon),
    accommodation: Math.round(accommodationCarbon),
    total: Math.round(total),
    equivalents: {
      treesNeeded: Math.ceil(total / CO2_EQUIVALENTS.tree_absorption_per_year),
      carKmEquivalent: Math.round(total / CO2_EQUIVALENTS.km_car_average),
      beefSteaks: Math.round(total / CO2_EQUIVALENTS.steak_beef),
    },
    comparison: {
      trainAlternative: trainAlternative ? Math.round(trainAlternative) : undefined,
      carAlternative: Math.round(carAlternative),
      percentVsAverage,
    },
    rating,
    tips,
  };
}

/**
 * Obtient le facteur d'émission pour un type de transport
 */
function getTransportEmissionFactor(type: string): number {
  const mapping: Record<string, string> = {
    walk: 'walk',
    walking: 'walk',
    transit: 'metro',
    public: 'metro',
    bus: 'bus_urban',
    metro: 'metro',
    taxi: 'car_petrol',
    uber: 'car_petrol',
    car: 'car_petrol',
  };

  const key = mapping[type.toLowerCase()] || 'bus_urban';
  return EMISSIONS_PER_KM[key] || 0.05;
}

/**
 * Formate l'affichage du CO2
 */
export function formatCO2(kg: number): string {
  if (kg < 1) {
    return `${Math.round(kg * 1000)} g`;
  }
  if (kg < 1000) {
    return `${Math.round(kg)} kg`;
  }
  return `${(kg / 1000).toFixed(1)} t`;
}

/**
 * Obtient la couleur associée à la note
 */
export function getRatingColor(rating: CarbonBreakdown['rating']): string {
  const colors: Record<CarbonBreakdown['rating'], string> = {
    A: '#22C55E', // green
    B: '#84CC16', // lime
    C: '#EAB308', // yellow
    D: '#F97316', // orange
    E: '#EF4444', // red
  };
  return colors[rating];
}

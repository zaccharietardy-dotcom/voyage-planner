/**
 * Service de calcul d'empreinte carbone
 *
 * Sources officielles — ADEME Base Carbone 2023:
 * - Aviation: ADEME "Aeroport" + ICAO Carbon Emissions Calculator
 * - Ferroviaire: ADEME Base Carbone, SNCF bilan GES
 * - Routier: ADEME "Vehicules particuliers" 2023
 * - Hebergement: ADEME "Hotellerie" + EEA hospitality benchmarks
 * - Alimentation: ADEME "Alimentation" / Agribalyse 3.1
 * - Activites: estimations sectorielles ADEME + EEA
 */

// === EMISSIONS PAR KM (kg CO2e/pax.km) — ADEME Base Carbone 2023 ===

const EMISSIONS_PER_KM: Record<string, number> = {
  // Avion (incluant forcage radiatif x1.9, ADEME 2023)
  plane_short: 0.258,       // < 1000 km
  plane_medium: 0.187,      // 1000-3500 km
  plane_long: 0.152,        // > 3500 km

  // Train (ADEME Base Carbone 2023)
  train_tgv: 0.00173,       // TGV France (mix electrique nucleaire)
  train_intercity: 0.00573, // Intercites France
  train_europe: 0.037,      // Moyenne europeenne

  // Voiture (par vehicule.km — diviser par DEFAULT_CAR_OCCUPANCY)
  car_petrol: 0.192,        // Essence moyenne
  car_diesel: 0.166,        // Diesel moyenne
  car_electric: 0.020,      // Electrique (mix FR)
  car_hybrid: 0.110,        // Hybride

  // Bus (ADEME 2023)
  bus_coach: 0.0295,        // Autocar longue distance
  bus_urban: 0.103,         // Bus urbain

  // Autres
  metro: 0.003,             // Metro electrique
  ferry: 0.120,             // Ferry passagers
  walk: 0,
  bike: 0,
};

const DEFAULT_CAR_OCCUPANCY = 2.2;

// === HEBERGEMENT (kg CO2e/nuit) — ADEME Base Carbone 2023 ===

const ACCOMMODATION_EMISSIONS: Record<string, number> = {
  hotel_5: 30.9,
  hotel_4: 20.5,
  hotel_3: 14.3,
  hotel_2: 10.2,
  hotel_1: 6.9,
  apartment: 6.5,
  hostel: 4.2,
  camping: 1.5,
};

// === ALIMENTATION (kg CO2e/personne/jour) — ADEME Agribalyse 3.1 ===

const FOOD_EMISSIONS_PER_DAY: Record<string, number> = {
  high_meat: 7.26,
  average: 5.68,
  flexitarian: 4.11,
  vegetarian: 3.18,
  vegan: 2.51,
  tourist_default: 6.0,
};

// === ACTIVITES (kg CO2e/jour par type) — Estimations ADEME + EEA ===

const ACTIVITY_EMISSIONS: Record<string, number> = {
  ski: 48.5,            // Station de ski (remontees + canons a neige)
  theme_park: 12,       // Parc d'attractions
  boat: 15,             // Excursion en bateau
  diving: 8,            // Plongee / sports nautiques
  adventure: 8.0,       // Sport / aventure
  wellness: 3.0,        // Spa (eau chaude, electricite)
  culture: 2.5,         // Musees, monuments
  nightlife: 1.5,       // Vie nocturne
  gastronomy: 1.0,      // Food tour
  beach: 0.5,           // Plage / nature passive
  nature: 0.5,          // Randonnee
  shopping: 0.3,        // Shopping
  city_tour: 0.3,       // Visite a pied
};

// === EQUIVALENCES ===

const CO2_EQUIVALENTS = {
  tree_absorption_per_year: 25,  // kg CO2 absorbe par an par arbre
  km_car_average: 0.21,          // kg CO2 par km en voiture (moyenne FR)
  steak_beef: 6.5,               // kg CO2 par steak de boeuf
  smartphone_charge: 0.008,
  streaming_hour: 0.036,
};

export interface CarbonBreakdown {
  flights: number;
  localTransport: number;
  accommodation: number;
  food: number;
  activities: number;
  total: number;
  equivalents: {
    treesNeeded: number;
    carKmEquivalent: number;
    beefSteaks: number;
  };
  comparison: {
    trainAlternative?: number;
    carAlternative?: number;
    percentVsAverage: number;
  };
  rating: 'A' | 'B' | 'C' | 'D' | 'E';
  tips: string[];
}

/**
 * Calcule l'empreinte carbone d'un vol
 */
export function calculateFlightCarbon(
  distanceKm: number,
  passengers: number = 1,
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first' = 'economy'
): number {
  let emissionFactor: number;
  if (distanceKm < 1000) {
    emissionFactor = EMISSIONS_PER_KM.plane_short;
  } else if (distanceKm < 3500) {
    emissionFactor = EMISSIONS_PER_KM.plane_medium;
  } else {
    emissionFactor = EMISSIONS_PER_KM.plane_long;
  }

  // Facteur par classe (plus d'espace = plus de responsabilite)
  const classMultiplier: Record<string, number> = {
    economy: 1.0,
    premium_economy: 1.5,
    business: 2.5,
    first: 4.0,
  };

  return distanceKm * emissionFactor * (classMultiplier[cabinClass] || 1.0) * passengers;
}

/**
 * Calcule l'empreinte carbone des transports locaux
 */
export function calculateLocalTransportCarbon(
  activities: { type: string; distanceKm: number }[]
): number {
  let total = 0;
  for (const activity of activities) {
    total += activity.distanceKm * getTransportEmissionFactor(activity.type);
  }
  return total;
}

/**
 * Calcule l'empreinte carbone de l'hebergement (ADEME 2023 par etoiles)
 */
export function calculateAccommodationCarbon(
  nights: number,
  type: 'hotel' | 'apartment' | 'hostel' | 'camping' = 'hotel',
  stars: number = 3
): number {
  if (type === 'hotel') {
    const clamped = Math.max(1, Math.min(5, stars));
    return nights * (ACCOMMODATION_EMISSIONS[`hotel_${clamped}`] || ACCOMMODATION_EMISSIONS.hotel_3);
  }
  return nights * (ACCOMMODATION_EMISSIONS[type] || ACCOMMODATION_EMISSIONS.hotel_3);
}

/**
 * Calcule l'empreinte carbone de l'alimentation (ADEME Agribalyse)
 */
export function calculateFoodCarbon(
  days: number,
  passengers: number,
  dietType: string = 'tourist_default'
): number {
  const daily = FOOD_EMISSIONS_PER_DAY[dietType] || FOOD_EMISSIONS_PER_DAY.tourist_default;
  return days * passengers * daily;
}

/**
 * Calcule l'empreinte carbone des activites
 */
export function calculateActivitiesCarbon(
  activityTypes: string[],
  daysCount: number,
  passengers: number
): number {
  if (activityTypes.length === 0) {
    return daysCount * passengers * ACTIVITY_EMISSIONS.culture;
  }
  let totalPerDay = 0;
  for (const t of activityTypes) {
    totalPerDay += ACTIVITY_EMISSIONS[t] || ACTIVITY_EMISSIONS.city_tour;
  }
  const avgPerDay = totalPerDay / activityTypes.length;
  return daysCount * passengers * avgPerDay;
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
  dietType?: string;
  activityTypes?: string[];
}): CarbonBreakdown {
  const flightMultiplier = params.returnFlight ? 2 : 1;
  const flightCarbon = calculateFlightCarbon(
    params.flightDistanceKm * flightMultiplier,
    params.passengers,
    params.cabinClass
  );

  const accommodationCarbon = calculateAccommodationCarbon(
    params.nights,
    params.accommodationType,
    params.accommodationStars
  );

  const localKm = params.localTransportKm || params.nights * 10;
  const localTransportCarbon = localKm * EMISSIONS_PER_KM.bus_urban;

  const days = params.nights + 1;
  const foodCarbon = calculateFoodCarbon(days, params.passengers, params.dietType);
  const activitiesCarbon = calculateActivitiesCarbon(
    params.activityTypes || [], days, params.passengers
  );

  const total = flightCarbon + accommodationCarbon + localTransportCarbon
    + foodCarbon + activitiesCarbon;

  // Alternatives transport
  const trainAlt = params.flightDistanceKm < 1000
    ? params.flightDistanceKm * flightMultiplier * EMISSIONS_PER_KM.train_tgv * params.passengers
    : undefined;
  const carAlt = params.flightDistanceKm * flightMultiplier
    * (EMISSIONS_PER_KM.car_petrol / DEFAULT_CAR_OCCUPANCY) * params.passengers;

  // Moyenne francaise: ~500 kg CO2 par voyage (ADEME)
  const averageVacationCarbon = 500;
  const percentVsAverage = Math.round((total / averageVacationCarbon) * 100);

  const rating = computeRating(total);
  const tips = generateTips(params, flightCarbon, foodCarbon);

  return {
    flights: Math.round(flightCarbon),
    localTransport: Math.round(localTransportCarbon),
    accommodation: Math.round(accommodationCarbon),
    food: Math.round(foodCarbon),
    activities: Math.round(activitiesCarbon),
    total: Math.round(total),
    equivalents: {
      treesNeeded: Math.ceil(total / CO2_EQUIVALENTS.tree_absorption_per_year),
      carKmEquivalent: Math.round(total / CO2_EQUIVALENTS.km_car_average),
      beefSteaks: Math.round(total / CO2_EQUIVALENTS.steak_beef),
    },
    comparison: {
      trainAlternative: trainAlt ? Math.round(trainAlt) : undefined,
      carAlternative: Math.round(carAlt),
      percentVsAverage,
    },
    rating,
    tips,
  };
}

/**
 * Note environnementale (seuils ajustes pour inclure alimentation + activites)
 */
function computeRating(total: number): CarbonBreakdown['rating'] {
  if (total < 200) return 'A';
  if (total < 400) return 'B';
  if (total < 700) return 'C';
  if (total < 1200) return 'D';
  return 'E';
}

/**
 * Genere des conseils personnalises pour reduire l'empreinte
 */
function generateTips(
  params: { flightDistanceKm: number; cabinClass?: string; dietType?: string },
  flightCarbon: number,
  foodCarbon: number
): string[] {
  const tips: string[] = [];
  if (params.flightDistanceKm < 800 && params.flightDistanceKm > 0) {
    tips.push('Pour cette distance, le train emet 50x moins de CO2 que l\'avion');
  }
  if (params.cabinClass && params.cabinClass !== 'economy') {
    tips.push('Voyager en classe economique reduit votre empreinte');
  }
  if (flightCarbon > 300) {
    tips.push('Envisagez de compenser vos emissions via un programme certifie');
  }
  if (!params.dietType || params.dietType === 'tourist_default') {
    tips.push('Reduire la viande au restaurant diminue l\'empreinte alimentation de 30%');
  }
  if (foodCarbon > 200) {
    tips.push('Privilegiez les produits locaux et de saison a destination');
  }
  tips.push('Privilegiez les transports en commun sur place');
  tips.push('Choisissez des hebergements eco-labellises');
  return tips;
}

/**
 * Obtient le facteur d'emission pour un type de transport local
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
  const factor = EMISSIONS_PER_KM[key] || 0.05;
  if (key.startsWith('car_')) {
    return factor / DEFAULT_CAR_OCCUPANCY;
  }
  return factor;
}

/**
 * Formate l'affichage du CO2
 */
export function formatCO2(kg: number): string {
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  if (kg < 1000) return `${Math.round(kg)} kg`;
  return `${(kg / 1000).toFixed(1)} t`;
}

/**
 * Obtient la couleur associee a la note
 */
export function getRatingColor(rating: CarbonBreakdown['rating']): string {
  const colors: Record<CarbonBreakdown['rating'], string> = {
    A: '#22C55E',
    B: '#84CC16',
    C: '#EAB308',
    D: '#F97316',
    E: '#EF4444',
  };
  return colors[rating];
}

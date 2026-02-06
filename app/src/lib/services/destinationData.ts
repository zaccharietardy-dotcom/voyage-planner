/**
 * Module centralisé de données par destination
 *
 * Fournit des données contextuelles (coût de la vie, horaires repas,
 * archétypes, fermetures musées, etc.) utilisées par tous les services
 * de génération pour adapter la qualité aux spécificités locales.
 *
 * Data curated Feb 2026
 */

import { getCountryFromDestination } from './cuisineValidator';

// ============================================================================
// CLASSIFICATION TAILLE DE VILLE (pour seuils de qualité adaptatifs)
// ============================================================================

export const DESTINATION_SIZE: Record<string, 'major' | 'medium' | 'small'> = {
  // Major (>2M hab ou top mondial tourisme)
  paris: 'major', london: 'major', tokyo: 'major', 'new york': 'major',
  rome: 'major', barcelona: 'major', amsterdam: 'major', bangkok: 'major',
  berlin: 'major', istanbul: 'major', madrid: 'major', milan: 'major',
  singapore: 'major', dubai: 'major', 'hong kong': 'major', seoul: 'major',
  sydney: 'major', 'los angeles': 'major', chicago: 'major', 'san francisco': 'major',
  moscow: 'major', mumbai: 'major', cairo: 'major', 'buenos aires': 'major',
  'rio de janeiro': 'major', 'mexico city': 'major', toronto: 'major',
  vienna: 'major', prague: 'major', budapest: 'major', lisbon: 'major',
  athens: 'major', florence: 'major', dublin: 'major', copenhagen: 'major',
  stockholm: 'major', oslo: 'major', munich: 'major',

  // Medium (500K-2M ou très touristique)
  marrakech: 'medium', kyoto: 'medium', venice: 'medium', seville: 'medium',
  porto: 'medium', edinburgh: 'medium', krakow: 'medium', warsaw: 'medium',
  helsinki: 'medium', taipei: 'medium', 'cape town': 'medium',
  melbourne: 'medium', naples: 'medium', nice: 'medium', lyon: 'medium',
  marseille: 'medium', bordeaux: 'medium', granada: 'medium', malaga: 'medium',
  bali: 'medium', phuket: 'medium', 'chiang mai': 'medium', hanoi: 'medium',
  'ho chi minh': 'medium', havana: 'medium', lima: 'medium', bogota: 'medium',

  // Small (< 500K ou niche)
  bruges: 'small', split: 'small', dubrovnik: 'small', santorini: 'small',
  mykonos: 'small', cinque_terre: 'small', hallstatt: 'small', colmar: 'small',
  sintra: 'small', rothenburg: 'small', cesky_krumlov: 'small', annecy: 'small',
  siena: 'small', lucca: 'small', toledo: 'small', ronda: 'small',
  luang_prabang: 'small', hoi_an: 'small', ubud: 'small',
};

export function getDestinationSize(destination: string): 'major' | 'medium' | 'small' {
  const dest = destination.toLowerCase().trim();
  // Direct match
  if (DESTINATION_SIZE[dest]) return DESTINATION_SIZE[dest];
  // Partial match
  for (const [key, size] of Object.entries(DESTINATION_SIZE)) {
    if (dest.includes(key) || key.includes(dest)) return size;
  }
  return 'medium'; // default prudent
}

// ============================================================================
// MULTIPLICATEUR COÛT DE LA VIE (Paris = 1.0 baseline)
// ============================================================================

export const COST_MULTIPLIERS: Record<string, number> = {
  // Europe Ouest (cher)
  paris: 1.0, london: 1.3, amsterdam: 1.1, copenhagen: 1.4,
  stockholm: 1.3, oslo: 1.5, helsinki: 1.2, zurich: 1.6,
  geneva: 1.5, munich: 1.0, vienna: 0.9, dublin: 1.1,
  nice: 1.0, lyon: 0.9, bordeaux: 0.9, marseille: 0.85,
  edinburgh: 1.1, milan: 0.95, venice: 1.1, florence: 0.95,

  // Europe Sud & Est (modéré à bon marché)
  rome: 0.9, barcelona: 0.85, madrid: 0.8, seville: 0.7,
  malaga: 0.7, lisbon: 0.7, porto: 0.65, athens: 0.65,
  naples: 0.75, granada: 0.65, berlin: 0.8, prague: 0.55,
  budapest: 0.5, krakow: 0.45, warsaw: 0.5, split: 0.6,
  dubrovnik: 0.7, bruges: 0.9, santorini: 0.85, mykonos: 0.9,

  // Asie
  tokyo: 1.1, kyoto: 1.0, seoul: 0.8, 'hong kong': 1.1,
  singapore: 1.1, taipei: 0.6, bangkok: 0.35, phuket: 0.4,
  'chiang mai': 0.25, bali: 0.3, hanoi: 0.25,
  'ho chi minh': 0.25,

  // Moyen-Orient & Afrique
  istanbul: 0.45, marrakech: 0.4, cairo: 0.3, dubai: 1.2,
  'cape town': 0.5,

  // Amériques
  'new york': 1.4, 'san francisco': 1.3, 'los angeles': 1.2,
  chicago: 1.1, toronto: 1.1, 'mexico city': 0.4,
  'buenos aires': 0.4, 'rio de janeiro': 0.5, havana: 0.35,
  lima: 0.35, bogota: 0.35,

  // Océanie
  sydney: 1.2, melbourne: 1.1,
};

export function getCostMultiplier(destination: string): number {
  const dest = destination.toLowerCase().trim();
  if (COST_MULTIPLIERS[dest]) return COST_MULTIPLIERS[dest];
  for (const [key, mult] of Object.entries(COST_MULTIPLIERS)) {
    if (dest.includes(key) || key.includes(dest)) return mult;
  }
  return 1.0; // baseline Paris
}

// ============================================================================
// HORAIRES REPAS LOCAUX PAR PAYS
// ============================================================================

export const LOCAL_MEAL_TIMES: Record<string, { breakfast: string; lunch: string; dinner: string }> = {
  Spain: { breakfast: '09:30', lunch: '14:00', dinner: '21:00' },
  Italy: { breakfast: '08:00', lunch: '13:00', dinner: '20:30' },
  France: { breakfast: '08:30', lunch: '12:30', dinner: '20:00' },
  Germany: { breakfast: '08:00', lunch: '12:00', dinner: '18:30' },
  UK: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  Ireland: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  Japan: { breakfast: '08:00', lunch: '12:00', dinner: '19:00' },
  'South Korea': { breakfast: '08:00', lunch: '12:00', dinner: '19:00' },
  Thailand: { breakfast: '08:00', lunch: '12:00', dinner: '19:30' },
  Vietnam: { breakfast: '07:30', lunch: '11:30', dinner: '19:00' },
  Indonesia: { breakfast: '08:00', lunch: '12:00', dinner: '19:30' },
  US: { breakfast: '09:00', lunch: '12:00', dinner: '19:00' },
  Canada: { breakfast: '08:30', lunch: '12:00', dinner: '19:00' },
  Mexico: { breakfast: '09:00', lunch: '14:00', dinner: '20:30' },
  Argentina: { breakfast: '09:00', lunch: '13:00', dinner: '21:00' },
  Brazil: { breakfast: '08:00', lunch: '12:30', dinner: '20:00' },
  Portugal: { breakfast: '08:30', lunch: '13:00', dinner: '20:30' },
  Greece: { breakfast: '09:00', lunch: '14:00', dinner: '21:00' },
  Turkey: { breakfast: '08:30', lunch: '12:30', dinner: '19:30' },
  Morocco: { breakfast: '08:30', lunch: '13:00', dinner: '20:00' },
  Egypt: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
  Netherlands: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  Belgium: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  Czech: { breakfast: '08:00', lunch: '12:00', dinner: '18:30' },
  Hungary: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  Poland: { breakfast: '08:00', lunch: '13:00', dinner: '19:00' },
  Croatia: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
  Austria: { breakfast: '08:00', lunch: '12:00', dinner: '18:30' },
  Sweden: { breakfast: '08:00', lunch: '12:00', dinner: '18:00' },
  Denmark: { breakfast: '08:00', lunch: '12:00', dinner: '18:30' },
  Norway: { breakfast: '08:00', lunch: '12:00', dinner: '18:00' },
  Finland: { breakfast: '08:00', lunch: '11:30', dinner: '18:00' },
  Singapore: { breakfast: '08:00', lunch: '12:00', dinner: '19:30' },
  'Hong Kong': { breakfast: '08:00', lunch: '12:30', dinner: '19:30' },
  Taiwan: { breakfast: '08:00', lunch: '12:00', dinner: '19:00' },
  Australia: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  UAE: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
  'South Africa': { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  Cuba: { breakfast: '08:00', lunch: '12:30', dinner: '20:00' },
  Colombia: { breakfast: '08:00', lunch: '12:30', dinner: '19:30' },
  Peru: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
  India: { breakfast: '08:30', lunch: '13:00', dinner: '20:30' },
  Scotland: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  default: { breakfast: '09:00', lunch: '12:30', dinner: '19:30' },
};

export function getMealTimes(destination: string): { breakfast: string; lunch: string; dinner: string } {
  const country = getCountryFromDestination(destination);
  if (country && LOCAL_MEAL_TIMES[country]) {
    return LOCAL_MEAL_TIMES[country];
  }
  return LOCAL_MEAL_TIMES['default'];
}

// ============================================================================
// CAPS RELIGIEUX PAR DESTINATION
// ============================================================================

export const RELIGIOUS_CAP_OVERRIDES: Record<string, number> = {
  rome: 5, vatican: 6, istanbul: 4, bangkok: 5, kyoto: 6,
  jerusalem: 7, bali: 5, seville: 4, florence: 4,
  naples: 4, cairo: 4, marrakech: 4, luang_prabang: 5,
  angkor: 6, varanasi: 6, cusco: 4,
};

export function getReligiousCap(destination: string): number {
  const dest = destination.toLowerCase().trim();
  if (RELIGIOUS_CAP_OVERRIDES[dest]) return RELIGIOUS_CAP_OVERRIDES[dest];
  for (const [key, cap] of Object.entries(RELIGIOUS_CAP_OVERRIDES)) {
    if (dest.includes(key) || key.includes(dest)) return cap;
  }
  return 3; // default cap
}

// ============================================================================
// ARCHÉTYPES DESTINATION (pour queries SerpAPI adaptatives)
// ============================================================================

export const DESTINATION_ARCHETYPES: Record<string, string[]> = {
  beach: [
    'cancun', 'bali', 'phuket', 'maldives', 'santorini', 'mykonos',
    'nice', 'amalfi', 'dubrovnik', 'split', 'malaga', 'faro', 'algarve',
    'ibiza', 'majorca', 'crete', 'zanzibar', 'maui', 'malibu',
    'copacabana', 'ipanema', 'bondi', 'tulum', 'playa del carmen',
    'koh samui', 'koh phi phi', 'langkawi', 'boracay', 'seminyak', 'ubud',
  ],
  nature: [
    'reykjavik', 'queenstown', 'banff', 'patagonia', 'swiss alps',
    'norway', 'costa rica', 'new zealand', 'iceland', 'scottish highlands',
    'dolomites', 'lake district', 'lake como', 'interlaken', 'zermatt',
    'torres del paine', 'yosemite', 'yellowstone', 'grand canyon',
  ],
  cultural: [
    'rome', 'paris', 'kyoto', 'istanbul', 'cairo', 'athens', 'vienna',
    'florence', 'prague', 'budapest', 'krakow', 'jerusalem', 'vatican',
    'venice', 'seville', 'granada', 'marrakech', 'fez', 'cusco',
    'angkor', 'luang prabang', 'varanasi',
  ],
  nightlife: [
    'berlin', 'amsterdam', 'bangkok', 'ibiza', 'tokyo', 'london',
    'barcelona', 'las vegas', 'miami', 'tel aviv', 'belgrade',
    'budapest', 'prague', 'buenos aires', 'rio de janeiro',
  ],
  gastronomy: [
    'tokyo', 'kyoto', 'paris', 'lyon', 'barcelona', 'naples', 'bologna',
    'bangkok', 'hanoi', 'mexico city', 'lima', 'san sebastian',
    'copenhagen', 'singapore', 'hong kong', 'istanbul', 'marrakech',
    'seoul', 'taipei', 'florence',
  ],
  adventure: [
    'queenstown', 'interlaken', 'chamonix', 'moab', 'costa rica',
    'iceland', 'nepal', 'patagonia', 'cape town', 'new zealand',
    'bali', 'swiss alps', 'dolomites', 'scottish highlands',
  ],
  wellness: [
    'bali', 'budapest', 'iceland', 'thai islands', 'sedona',
    'tulum', 'sri lanka', 'maldives', 'ubud', 'koh samui',
  ],
};

export function getDestinationArchetypes(destination: string): string[] {
  const dest = destination.toLowerCase().trim();
  const matches: string[] = [];
  for (const [archetype, cities] of Object.entries(DESTINATION_ARCHETYPES)) {
    if (cities.some(city => dest.includes(city) || city.includes(dest))) {
      matches.push(archetype);
    }
  }
  return matches;
}

// ============================================================================
// COÛTS MOYENS PAR DESTINATION (pour prompt budget Claude)
// ============================================================================

export const DESTINATION_COSTS: Record<string, { avgMeal: number; avgMuseum: number; avgTransit: number; budgetHotel: number }> = {
  // Europe Ouest
  paris: { avgMeal: 18, avgMuseum: 15, avgTransit: 5, budgetHotel: 90 },
  london: { avgMeal: 22, avgMuseum: 0, avgTransit: 8, budgetHotel: 110 },
  amsterdam: { avgMeal: 18, avgMuseum: 18, avgTransit: 4, budgetHotel: 100 },
  copenhagen: { avgMeal: 25, avgMuseum: 15, avgTransit: 5, budgetHotel: 120 },
  stockholm: { avgMeal: 22, avgMuseum: 12, avgTransit: 5, budgetHotel: 100 },
  oslo: { avgMeal: 28, avgMuseum: 15, avgTransit: 6, budgetHotel: 130 },
  dublin: { avgMeal: 20, avgMuseum: 10, avgTransit: 4, budgetHotel: 95 },
  edinburgh: { avgMeal: 20, avgMuseum: 0, avgTransit: 4, budgetHotel: 85 },
  munich: { avgMeal: 18, avgMuseum: 12, avgTransit: 4, budgetHotel: 90 },
  vienna: { avgMeal: 16, avgMuseum: 15, avgTransit: 3, budgetHotel: 80 },
  berlin: { avgMeal: 14, avgMuseum: 12, avgTransit: 3, budgetHotel: 70 },
  brussels: { avgMeal: 18, avgMuseum: 12, avgTransit: 3, budgetHotel: 80 },
  bruges: { avgMeal: 18, avgMuseum: 12, avgTransit: 2, budgetHotel: 85 },
  helsinki: { avgMeal: 20, avgMuseum: 12, avgTransit: 4, budgetHotel: 90 },
  nice: { avgMeal: 18, avgMuseum: 10, avgTransit: 2, budgetHotel: 80 },
  lyon: { avgMeal: 16, avgMuseum: 10, avgTransit: 3, budgetHotel: 75 },

  // Europe Sud
  rome: { avgMeal: 15, avgMuseum: 16, avgTransit: 2, budgetHotel: 75 },
  florence: { avgMeal: 16, avgMuseum: 15, avgTransit: 2, budgetHotel: 80 },
  venice: { avgMeal: 20, avgMuseum: 15, avgTransit: 8, budgetHotel: 100 },
  naples: { avgMeal: 12, avgMuseum: 12, avgTransit: 2, budgetHotel: 55 },
  barcelona: { avgMeal: 15, avgMuseum: 14, avgTransit: 3, budgetHotel: 75 },
  madrid: { avgMeal: 14, avgMuseum: 12, avgTransit: 2, budgetHotel: 65 },
  seville: { avgMeal: 12, avgMuseum: 10, avgTransit: 2, budgetHotel: 55 },
  malaga: { avgMeal: 12, avgMuseum: 8, avgTransit: 2, budgetHotel: 55 },
  lisbon: { avgMeal: 12, avgMuseum: 8, avgTransit: 2, budgetHotel: 60 },
  porto: { avgMeal: 10, avgMuseum: 8, avgTransit: 2, budgetHotel: 50 },
  athens: { avgMeal: 12, avgMuseum: 10, avgTransit: 2, budgetHotel: 55 },
  santorini: { avgMeal: 18, avgMuseum: 5, avgTransit: 3, budgetHotel: 90 },

  // Europe Est
  prague: { avgMeal: 10, avgMuseum: 8, avgTransit: 2, budgetHotel: 45 },
  budapest: { avgMeal: 10, avgMuseum: 8, avgTransit: 2, budgetHotel: 40 },
  krakow: { avgMeal: 8, avgMuseum: 6, avgTransit: 1, budgetHotel: 35 },
  warsaw: { avgMeal: 10, avgMuseum: 6, avgTransit: 2, budgetHotel: 40 },
  split: { avgMeal: 12, avgMuseum: 8, avgTransit: 2, budgetHotel: 50 },
  dubrovnik: { avgMeal: 15, avgMuseum: 10, avgTransit: 2, budgetHotel: 65 },

  // Asie
  tokyo: { avgMeal: 12, avgMuseum: 10, avgTransit: 6, budgetHotel: 70 },
  kyoto: { avgMeal: 12, avgMuseum: 8, avgTransit: 4, budgetHotel: 60 },
  seoul: { avgMeal: 10, avgMuseum: 6, avgTransit: 2, budgetHotel: 50 },
  'hong kong': { avgMeal: 12, avgMuseum: 5, avgTransit: 3, budgetHotel: 70 },
  singapore: { avgMeal: 10, avgMuseum: 15, avgTransit: 3, budgetHotel: 80 },
  taipei: { avgMeal: 7, avgMuseum: 5, avgTransit: 2, budgetHotel: 40 },
  bangkok: { avgMeal: 5, avgMuseum: 4, avgTransit: 1, budgetHotel: 25 },
  phuket: { avgMeal: 6, avgMuseum: 3, avgTransit: 2, budgetHotel: 30 },
  'chiang mai': { avgMeal: 4, avgMuseum: 3, avgTransit: 1, budgetHotel: 20 },
  bali: { avgMeal: 5, avgMuseum: 3, avgTransit: 2, budgetHotel: 25 },
  hanoi: { avgMeal: 4, avgMuseum: 3, avgTransit: 1, budgetHotel: 20 },
  'ho chi minh': { avgMeal: 4, avgMuseum: 3, avgTransit: 1, budgetHotel: 20 },

  // Moyen-Orient & Afrique
  istanbul: { avgMeal: 8, avgMuseum: 10, avgTransit: 1, budgetHotel: 40 },
  marrakech: { avgMeal: 6, avgMuseum: 5, avgTransit: 1, budgetHotel: 30 },
  cairo: { avgMeal: 5, avgMuseum: 8, avgTransit: 1, budgetHotel: 30 },
  dubai: { avgMeal: 20, avgMuseum: 15, avgTransit: 4, budgetHotel: 80 },
  'cape town': { avgMeal: 10, avgMuseum: 6, avgTransit: 2, budgetHotel: 40 },

  // Amériques
  'new york': { avgMeal: 25, avgMuseum: 25, avgTransit: 5, budgetHotel: 150 },
  'san francisco': { avgMeal: 22, avgMuseum: 20, avgTransit: 5, budgetHotel: 130 },
  'los angeles': { avgMeal: 20, avgMuseum: 15, avgTransit: 4, budgetHotel: 110 },
  'mexico city': { avgMeal: 6, avgMuseum: 3, avgTransit: 1, budgetHotel: 30 },
  'buenos aires': { avgMeal: 8, avgMuseum: 3, avgTransit: 1, budgetHotel: 30 },
  'rio de janeiro': { avgMeal: 10, avgMuseum: 5, avgTransit: 2, budgetHotel: 40 },
  havana: { avgMeal: 6, avgMuseum: 3, avgTransit: 1, budgetHotel: 30 },
  lima: { avgMeal: 7, avgMuseum: 4, avgTransit: 1, budgetHotel: 30 },

  // Océanie
  sydney: { avgMeal: 22, avgMuseum: 0, avgTransit: 5, budgetHotel: 100 },
  melbourne: { avgMeal: 20, avgMuseum: 0, avgTransit: 5, budgetHotel: 90 },
};

export function getDestinationCosts(destination: string): { avgMeal: number; avgMuseum: number; avgTransit: number; budgetHotel: number } | null {
  const dest = destination.toLowerCase().trim();
  if (DESTINATION_COSTS[dest]) return DESTINATION_COSTS[dest];
  for (const [key, costs] of Object.entries(DESTINATION_COSTS)) {
    if (dest.includes(key) || key.includes(dest)) return costs;
  }
  return null;
}

// ============================================================================
// FERMETURES CONNUES D'ATTRACTIONS MAJEURES
// ============================================================================

export const KNOWN_CLOSURES: Record<string, string> = {
  // France
  'louvre': 'fermé le mardi',
  'musée du louvre': 'fermé le mardi',
  "musée d'orsay": 'fermé le lundi',
  'orsay': 'fermé le lundi',
  'centre pompidou': 'fermé le mardi',
  'versailles': 'fermé le lundi',
  'château de versailles': 'fermé le lundi',
  'musée rodin': 'fermé le lundi',
  'musée de l\'orangerie': 'fermé le mardi',

  // Italie
  'uffizi': 'fermé le lundi',
  'galleria degli uffizi': 'fermé le lundi',
  'galerie des offices': 'fermé le lundi',
  'vatican': 'fermé le dimanche (sauf dernier dimanche du mois)',
  'musées du vatican': 'fermé le dimanche (sauf dernier dimanche du mois)',
  'galerie borghese': 'réservation obligatoire',
  'galleria borghese': 'réservation obligatoire',
  'palazzo ducale': 'ouvert 7j/7',

  // Espagne
  'prado': 'ouvert 7j/7',
  'museo del prado': 'ouvert 7j/7',
  'reina sofia': 'fermé le mardi',
  'sagrada familia': 'ouvert 7j/7 (réservation fortement conseillée)',
  'park güell': 'ouvert 7j/7 (réservation nécessaire)',
  'alhambra': 'ouvert 7j/7 (réservation OBLIGATOIRE, souvent complet)',

  // Pays-Bas
  'rijksmuseum': 'ouvert 7j/7',
  'van gogh museum': 'ouvert 7j/7 (réservation obligatoire)',
  'anne frank': 'ouvert 7j/7 (réservation en ligne OBLIGATOIRE)',

  // UK
  'british museum': 'ouvert 7j/7 (gratuit)',
  'national gallery': 'ouvert 7j/7 (gratuit)',
  'tate modern': 'ouvert 7j/7 (gratuit)',
  'tower of london': 'fermé 24-26 décembre et 1er janvier',

  // Autres
  'colosseum': 'ouvert 7j/7',
  'colisée': 'ouvert 7j/7',
  'acropole': 'ouvert 7j/7',
  'acropolis': 'ouvert 7j/7',
  'hagia sophia': 'ouvert 7j/7 (gratuit, mosquée active)',
  'sainte-sophie': 'ouvert 7j/7 (gratuit, mosquée active)',
  'topkapi': 'fermé le mardi',
};

/**
 * Retourne les fermetures connues pour les attractions d'une destination
 * Utilisé dans le prompt Claude pour éviter de planifier une visite un jour de fermeture
 */
export function getClosureWarnings(destination: string): string {
  const dest = destination.toLowerCase().trim();
  const warnings: string[] = [];

  // Trouver les fermetures pertinentes pour cette destination
  const cityKeywords: Record<string, string[]> = {
    paris: ['louvre', 'orsay', 'centre pompidou', 'versailles', 'musée rodin', "musée de l'orangerie"],
    rome: ['vatican', 'galerie borghese', 'colosseum'],
    florence: ['uffizi'],
    barcelona: ['sagrada familia', 'park güell'],
    madrid: ['prado', 'reina sofia'],
    amsterdam: ['rijksmuseum', 'van gogh museum', 'anne frank'],
    london: ['british museum', 'national gallery', 'tate modern', 'tower of london'],
    istanbul: ['hagia sophia', 'topkapi'],
    athens: ['acropole'],
    granada: ['alhambra'],
  };

  for (const [city, attractions] of Object.entries(cityKeywords)) {
    if (dest.includes(city)) {
      for (const attr of attractions) {
        const closure = KNOWN_CLOSURES[attr];
        if (closure) {
          // Capitalize first letter of attr
          const name = attr.charAt(0).toUpperCase() + attr.slice(1);
          warnings.push(`${name}: ${closure}`);
        }
      }
    }
  }

  if (warnings.length === 0) return 'Aucune fermeture connue répertoriée.';
  return warnings.join(' | ');
}

// ============================================================================
// DURÉES MINIMALES POUR ATTRACTIONS MAJEURES
// ============================================================================

export const MINIMUM_DURATION_OVERRIDES: [RegExp, number][] = [
  [/\blouvre\b/i, 180],
  [/\bvatican museum|musées du vatican|musei vaticani\b/i, 180],
  [/\bbritish museum\b/i, 180],
  [/\buffizi|galleria degli uffizi|galerie des offices\b/i, 150],
  [/\bprado|museo del prado\b/i, 150],
  [/\bhermitage\b/i, 180],
  [/\bmetropolitan|met museum\b/i, 180],
  [/\bversailles|château de versailles\b/i, 240],
  [/\bcolosseum|colisée|colosseo|coliseo\b/i, 90],
  [/\bsagrada\b/i, 120],
  [/\bmuseum island|île aux musées|museumsinsel\b/i, 180],
  [/\bnational gallery london\b/i, 150],
  [/\bvan gogh museum\b/i, 120],
  [/\brijksmuseum\b/i, 150],
  [/\bacropol/i, 120],
  [/\balhambra\b/i, 180],
  [/\btopkapi\b/i, 120],
  [/\bwinter palace|palais d'hiver\b/i, 180],
  [/\bnational museum of tokyo|tokyo national\b/i, 150],
  [/\bguggenheim\b/i, 120],
  [/\bcentre pompidou|pompidou\b/i, 120],
  [/\breina sofia|reina sofía\b/i, 120],
];

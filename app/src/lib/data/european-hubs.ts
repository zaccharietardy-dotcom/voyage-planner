import type { TransportHub } from '@/lib/pipeline/types/transport-plan';

/**
 * Fallback table des hubs aéroport/gare pour les principales villes européennes.
 * Utilisé par step4b-transport-plan quand le LLM échoue et que airportFinder
 * n'est pas dispo (ou pour éviter des appels API inutiles sur les villes connues).
 *
 * Les coordonnées sont celles des hubs (pas du centre-ville).
 */
export interface CityHub {
  city: string;
  country: string;
  keys: string[];
  cityCoords: { lat: number; lng: number };
  airport: TransportHub;
  station?: TransportHub;
}

export const EUROPEAN_HUBS: CityHub[] = [
  // --- France ---
  {
    city: 'Paris', country: 'France', keys: ['paris', 'paris-france', 'igny', 'versailles', 'saint-denis', 'boulogne', 'ile-de-france'],
    cityCoords: { lat: 48.8566, lng: 2.3522 },
    airport: { name: 'Paris Charles de Gaulle', code: 'CDG', kind: 'airport', lat: 49.0097, lng: 2.5479, city: 'Paris', country: 'France' },
    station: { name: 'Paris Gare du Nord', code: 'FRPNO', kind: 'station', lat: 48.8809, lng: 2.3553, city: 'Paris', country: 'France' },
  },
  {
    city: 'Lyon', country: 'France', keys: ['lyon', 'lyon-france'],
    cityCoords: { lat: 45.7640, lng: 4.8357 },
    airport: { name: 'Lyon Saint-Exupéry', code: 'LYS', kind: 'airport', lat: 45.7256, lng: 5.0811, city: 'Lyon', country: 'France' },
    station: { name: 'Lyon Part-Dieu', code: 'FRLPD', kind: 'station', lat: 45.7603, lng: 4.8598, city: 'Lyon', country: 'France' },
  },
  {
    city: 'Marseille', country: 'France', keys: ['marseille', 'marseille-france'],
    cityCoords: { lat: 43.2965, lng: 5.3698 },
    airport: { name: 'Marseille Provence', code: 'MRS', kind: 'airport', lat: 43.4393, lng: 5.2214, city: 'Marseille', country: 'France' },
    station: { name: 'Marseille Saint-Charles', code: 'FRMSC', kind: 'station', lat: 43.3027, lng: 5.3806, city: 'Marseille', country: 'France' },
  },
  {
    city: 'Nice', country: 'France', keys: ['nice', 'nice-france'],
    cityCoords: { lat: 43.7102, lng: 7.2620 },
    airport: { name: 'Nice Côte d\'Azur', code: 'NCE', kind: 'airport', lat: 43.6653, lng: 7.2150, city: 'Nice', country: 'France' },
    station: { name: 'Nice Ville', code: 'FRNIC', kind: 'station', lat: 43.7044, lng: 7.2619, city: 'Nice', country: 'France' },
  },
  {
    city: 'Toulouse', country: 'France', keys: ['toulouse', 'toulouse-france'],
    cityCoords: { lat: 43.6047, lng: 1.4442 },
    airport: { name: 'Toulouse-Blagnac', code: 'TLS', kind: 'airport', lat: 43.6294, lng: 1.3638, city: 'Toulouse', country: 'France' },
    station: { name: 'Toulouse Matabiau', code: 'FRTLS', kind: 'station', lat: 43.6114, lng: 1.4539, city: 'Toulouse', country: 'France' },
  },
  {
    city: 'Bordeaux', country: 'France', keys: ['bordeaux', 'bordeaux-france'],
    cityCoords: { lat: 44.8378, lng: -0.5792 },
    airport: { name: 'Bordeaux-Mérignac', code: 'BOD', kind: 'airport', lat: 44.8283, lng: -0.7156, city: 'Bordeaux', country: 'France' },
    station: { name: 'Bordeaux Saint-Jean', code: 'FRBDX', kind: 'station', lat: 44.8258, lng: -0.5564, city: 'Bordeaux', country: 'France' },
  },
  {
    city: 'Nantes', country: 'France', keys: ['nantes', 'nantes-france'],
    cityCoords: { lat: 47.2184, lng: -1.5536 },
    airport: { name: 'Nantes Atlantique', code: 'NTE', kind: 'airport', lat: 47.1567, lng: -1.6108, city: 'Nantes', country: 'France' },
    station: { name: 'Nantes', code: 'FRNTE', kind: 'station', lat: 47.2175, lng: -1.5419, city: 'Nantes', country: 'France' },
  },
  {
    city: 'Lille', country: 'France', keys: ['lille', 'lille-france'],
    cityCoords: { lat: 50.6292, lng: 3.0573 },
    airport: { name: 'Lille-Lesquin', code: 'LIL', kind: 'airport', lat: 50.5619, lng: 3.0894, city: 'Lille', country: 'France' },
    station: { name: 'Lille Europe', code: 'FRLLE', kind: 'station', lat: 50.6386, lng: 3.0756, city: 'Lille', country: 'France' },
  },
  {
    city: 'Strasbourg', country: 'France', keys: ['strasbourg', 'strasbourg-france'],
    cityCoords: { lat: 48.5734, lng: 7.7521 },
    airport: { name: 'Strasbourg', code: 'SXB', kind: 'airport', lat: 48.5383, lng: 7.6282, city: 'Strasbourg', country: 'France' },
    station: { name: 'Strasbourg', code: 'FRXWG', kind: 'station', lat: 48.5850, lng: 7.7339, city: 'Strasbourg', country: 'France' },
  },

  // --- UK / Ireland ---
  {
    city: 'London', country: 'United Kingdom', keys: ['london', 'londres', 'london-uk', 'london-united-kingdom'],
    cityCoords: { lat: 51.5074, lng: -0.1278 },
    airport: { name: 'London Heathrow', code: 'LHR', kind: 'airport', lat: 51.4700, lng: -0.4543, city: 'London', country: 'United Kingdom' },
    station: { name: 'London St Pancras International', code: 'GBSPX', kind: 'station', lat: 51.5310, lng: -0.1264, city: 'London', country: 'United Kingdom' },
  },
  {
    city: 'Dublin', country: 'Ireland', keys: ['dublin', 'dublin-ireland'],
    cityCoords: { lat: 53.3498, lng: -6.2603 },
    airport: { name: 'Dublin Airport', code: 'DUB', kind: 'airport', lat: 53.4213, lng: -6.2700, city: 'Dublin', country: 'Ireland' },
  },

  // --- Benelux ---
  {
    city: 'Amsterdam', country: 'Netherlands', keys: ['amsterdam', 'amsterdam-netherlands', 'amsterdam-nl'],
    cityCoords: { lat: 52.3676, lng: 4.9041 },
    airport: { name: 'Amsterdam Schiphol', code: 'AMS', kind: 'airport', lat: 52.3105, lng: 4.7683, city: 'Amsterdam', country: 'Netherlands' },
    station: { name: 'Amsterdam Centraal', code: 'NLASC', kind: 'station', lat: 52.3791, lng: 4.9003, city: 'Amsterdam', country: 'Netherlands' },
  },
  {
    city: 'Brussels', country: 'Belgium', keys: ['brussels', 'bruxelles', 'brussels-belgium'],
    cityCoords: { lat: 50.8503, lng: 4.3517 },
    airport: { name: 'Brussels Airport', code: 'BRU', kind: 'airport', lat: 50.9014, lng: 4.4844, city: 'Brussels', country: 'Belgium' },
    station: { name: 'Brussels-Midi', code: 'BEBMI', kind: 'station', lat: 50.8358, lng: 4.3364, city: 'Brussels', country: 'Belgium' },
  },

  // --- Germany / Austria / Switzerland ---
  {
    city: 'Berlin', country: 'Germany', keys: ['berlin', 'berlin-germany'],
    cityCoords: { lat: 52.5200, lng: 13.4050 },
    airport: { name: 'Berlin Brandenburg', code: 'BER', kind: 'airport', lat: 52.3667, lng: 13.5033, city: 'Berlin', country: 'Germany' },
    station: { name: 'Berlin Hauptbahnhof', code: 'DEBHF', kind: 'station', lat: 52.5251, lng: 13.3694, city: 'Berlin', country: 'Germany' },
  },
  {
    city: 'Munich', country: 'Germany', keys: ['munich', 'münchen', 'munich-germany'],
    cityCoords: { lat: 48.1351, lng: 11.5820 },
    airport: { name: 'Munich Airport', code: 'MUC', kind: 'airport', lat: 48.3538, lng: 11.7861, city: 'Munich', country: 'Germany' },
    station: { name: 'Munich Hauptbahnhof', code: 'DEMCH', kind: 'station', lat: 48.1401, lng: 11.5589, city: 'Munich', country: 'Germany' },
  },
  {
    city: 'Frankfurt', country: 'Germany', keys: ['frankfurt', 'frankfurt-germany'],
    cityCoords: { lat: 50.1109, lng: 8.6821 },
    airport: { name: 'Frankfurt Airport', code: 'FRA', kind: 'airport', lat: 50.0379, lng: 8.5622, city: 'Frankfurt', country: 'Germany' },
    station: { name: 'Frankfurt Hauptbahnhof', code: 'DEFHH', kind: 'station', lat: 50.1073, lng: 8.6634, city: 'Frankfurt', country: 'Germany' },
  },
  {
    city: 'Hamburg', country: 'Germany', keys: ['hamburg', 'hamburg-germany'],
    cityCoords: { lat: 53.5511, lng: 9.9937 },
    airport: { name: 'Hamburg Airport', code: 'HAM', kind: 'airport', lat: 53.6304, lng: 9.9882, city: 'Hamburg', country: 'Germany' },
    station: { name: 'Hamburg Hauptbahnhof', code: 'DEHHH', kind: 'station', lat: 53.5528, lng: 10.0067, city: 'Hamburg', country: 'Germany' },
  },
  {
    city: 'Vienna', country: 'Austria', keys: ['vienna', 'vienne', 'wien', 'vienna-austria'],
    cityCoords: { lat: 48.2082, lng: 16.3738 },
    airport: { name: 'Vienna International', code: 'VIE', kind: 'airport', lat: 48.1103, lng: 16.5697, city: 'Vienna', country: 'Austria' },
    station: { name: 'Wien Hauptbahnhof', code: 'ATWHB', kind: 'station', lat: 48.1856, lng: 16.3761, city: 'Vienna', country: 'Austria' },
  },
  {
    city: 'Zurich', country: 'Switzerland', keys: ['zurich', 'zürich', 'zurich-switzerland'],
    cityCoords: { lat: 47.3769, lng: 8.5417 },
    airport: { name: 'Zurich Airport', code: 'ZRH', kind: 'airport', lat: 47.4647, lng: 8.5492, city: 'Zurich', country: 'Switzerland' },
    station: { name: 'Zürich HB', code: 'CHZUR', kind: 'station', lat: 47.3779, lng: 8.5404, city: 'Zurich', country: 'Switzerland' },
  },
  {
    city: 'Geneva', country: 'Switzerland', keys: ['geneva', 'genève', 'geneva-switzerland'],
    cityCoords: { lat: 46.2044, lng: 6.1432 },
    airport: { name: 'Geneva Airport', code: 'GVA', kind: 'airport', lat: 46.2381, lng: 6.1090, city: 'Geneva', country: 'Switzerland' },
    station: { name: 'Gare de Cornavin', code: 'CHGVA', kind: 'station', lat: 46.2103, lng: 6.1428, city: 'Geneva', country: 'Switzerland' },
  },

  // --- Italy ---
  {
    city: 'Rome', country: 'Italy', keys: ['rome', 'roma', 'rome-italy'],
    cityCoords: { lat: 41.9028, lng: 12.4964 },
    airport: { name: 'Roma Fiumicino', code: 'FCO', kind: 'airport', lat: 41.8003, lng: 12.2389, city: 'Rome', country: 'Italy' },
    station: { name: 'Roma Termini', code: 'ITRMT', kind: 'station', lat: 41.9011, lng: 12.5018, city: 'Rome', country: 'Italy' },
  },
  {
    city: 'Milan', country: 'Italy', keys: ['milan', 'milano', 'milan-italy'],
    cityCoords: { lat: 45.4642, lng: 9.1900 },
    airport: { name: 'Milano Malpensa', code: 'MXP', kind: 'airport', lat: 45.6306, lng: 8.7281, city: 'Milan', country: 'Italy' },
    station: { name: 'Milano Centrale', code: 'ITMIC', kind: 'station', lat: 45.4864, lng: 9.2043, city: 'Milan', country: 'Italy' },
  },
  {
    city: 'Venice', country: 'Italy', keys: ['venice', 'venezia', 'venise', 'venice-italy'],
    cityCoords: { lat: 45.4408, lng: 12.3155 },
    airport: { name: 'Venezia Marco Polo', code: 'VCE', kind: 'airport', lat: 45.5053, lng: 12.3519, city: 'Venice', country: 'Italy' },
    station: { name: 'Venezia Santa Lucia', code: 'ITVSL', kind: 'station', lat: 45.4412, lng: 12.3213, city: 'Venice', country: 'Italy' },
  },
  {
    city: 'Florence', country: 'Italy', keys: ['florence', 'firenze', 'florence-italy'],
    cityCoords: { lat: 43.7696, lng: 11.2558 },
    airport: { name: 'Firenze Peretola', code: 'FLR', kind: 'airport', lat: 43.8100, lng: 11.2051, city: 'Florence', country: 'Italy' },
    station: { name: 'Firenze Santa Maria Novella', code: 'ITFSMN', kind: 'station', lat: 43.7764, lng: 11.2485, city: 'Florence', country: 'Italy' },
  },
  {
    city: 'Naples', country: 'Italy', keys: ['naples', 'napoli', 'naples-italy'],
    cityCoords: { lat: 40.8518, lng: 14.2681 },
    airport: { name: 'Napoli Capodichino', code: 'NAP', kind: 'airport', lat: 40.8860, lng: 14.2908, city: 'Naples', country: 'Italy' },
    station: { name: 'Napoli Centrale', code: 'ITNAC', kind: 'station', lat: 40.8528, lng: 14.2720, city: 'Naples', country: 'Italy' },
  },

  // --- Spain / Portugal ---
  {
    city: 'Madrid', country: 'Spain', keys: ['madrid', 'madrid-spain'],
    cityCoords: { lat: 40.4168, lng: -3.7038 },
    airport: { name: 'Madrid Barajas', code: 'MAD', kind: 'airport', lat: 40.4719, lng: -3.5626, city: 'Madrid', country: 'Spain' },
    station: { name: 'Madrid Puerta de Atocha', code: 'ESMAD', kind: 'station', lat: 40.4066, lng: -3.6900, city: 'Madrid', country: 'Spain' },
  },
  {
    city: 'Barcelona', country: 'Spain', keys: ['barcelona', 'barcelone', 'barcelona-spain'],
    cityCoords: { lat: 41.3851, lng: 2.1734 },
    airport: { name: 'Barcelona El Prat', code: 'BCN', kind: 'airport', lat: 41.2974, lng: 2.0833, city: 'Barcelona', country: 'Spain' },
    station: { name: 'Barcelona Sants', code: 'ESBCN', kind: 'station', lat: 41.3790, lng: 2.1403, city: 'Barcelona', country: 'Spain' },
  },
  {
    city: 'Lisbon', country: 'Portugal', keys: ['lisbon', 'lisbonne', 'lisboa', 'lisbon-portugal'],
    cityCoords: { lat: 38.7223, lng: -9.1393 },
    airport: { name: 'Lisbon Humberto Delgado', code: 'LIS', kind: 'airport', lat: 38.7742, lng: -9.1342, city: 'Lisbon', country: 'Portugal' },
  },
  {
    city: 'Porto', country: 'Portugal', keys: ['porto', 'porto-portugal'],
    cityCoords: { lat: 41.1579, lng: -8.6291 },
    airport: { name: 'Porto Francisco Sá Carneiro', code: 'OPO', kind: 'airport', lat: 41.2481, lng: -8.6814, city: 'Porto', country: 'Portugal' },
  },

  // --- Nordic / Eastern Europe ---
  {
    city: 'Copenhagen', country: 'Denmark', keys: ['copenhagen', 'copenhague', 'københavn', 'copenhagen-denmark'],
    cityCoords: { lat: 55.6761, lng: 12.5683 },
    airport: { name: 'Copenhagen Kastrup', code: 'CPH', kind: 'airport', lat: 55.6180, lng: 12.6561, city: 'Copenhagen', country: 'Denmark' },
  },
  {
    city: 'Stockholm', country: 'Sweden', keys: ['stockholm', 'stockholm-sweden'],
    cityCoords: { lat: 59.3293, lng: 18.0686 },
    airport: { name: 'Stockholm Arlanda', code: 'ARN', kind: 'airport', lat: 59.6519, lng: 17.9186, city: 'Stockholm', country: 'Sweden' },
  },
  {
    city: 'Oslo', country: 'Norway', keys: ['oslo', 'oslo-norway'],
    cityCoords: { lat: 59.9139, lng: 10.7522 },
    airport: { name: 'Oslo Gardermoen', code: 'OSL', kind: 'airport', lat: 60.1976, lng: 11.1004, city: 'Oslo', country: 'Norway' },
  },
  {
    city: 'Prague', country: 'Czech Republic', keys: ['prague', 'praha', 'prague-czech-republic'],
    cityCoords: { lat: 50.0755, lng: 14.4378 },
    airport: { name: 'Václav Havel Prague', code: 'PRG', kind: 'airport', lat: 50.1008, lng: 14.2600, city: 'Prague', country: 'Czech Republic' },
  },
  {
    city: 'Warsaw', country: 'Poland', keys: ['warsaw', 'varsovie', 'warszawa', 'warsaw-poland'],
    cityCoords: { lat: 52.2297, lng: 21.0122 },
    airport: { name: 'Warsaw Chopin', code: 'WAW', kind: 'airport', lat: 52.1657, lng: 20.9671, city: 'Warsaw', country: 'Poland' },
  },
  {
    city: 'Athens', country: 'Greece', keys: ['athens', 'athènes', 'athina', 'athens-greece'],
    cityCoords: { lat: 37.9838, lng: 23.7275 },
    airport: { name: 'Athens Eleftherios Venizelos', code: 'ATH', kind: 'airport', lat: 37.9364, lng: 23.9445, city: 'Athens', country: 'Greece' },
  },
  {
    city: 'Istanbul', country: 'Turkey', keys: ['istanbul', 'istanbul-turkey'],
    cityCoords: { lat: 41.0082, lng: 28.9784 },
    airport: { name: 'Istanbul Airport', code: 'IST', kind: 'airport', lat: 41.2753, lng: 28.7519, city: 'Istanbul', country: 'Turkey' },
  },
  {
    city: 'Budapest', country: 'Hungary', keys: ['budapest', 'budapest-hungary'],
    cityCoords: { lat: 47.4979, lng: 19.0402 },
    airport: { name: 'Budapest Ferenc Liszt', code: 'BUD', kind: 'airport', lat: 47.4394, lng: 19.2619, city: 'Budapest', country: 'Hungary' },
  },
];

/**
 * Normalise un nom de ville/adresse pour matcher les `keys` de la table.
 * Strip accents, lowercase, remplace espaces/virgules par tirets, trim.
 */
export function normalizeHubKey(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[,.]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Cherche un hub correspondant à une ville (ex: "Igny, France" → Paris).
 * Renvoie null si rien ne matche.
 */
export function findHubByCity(cityOrAddress: string): CityHub | null {
  const key = normalizeHubKey(cityOrAddress);
  for (const hub of EUROPEAN_HUBS) {
    if (hub.keys.some(k => key === k || key.startsWith(`${k}-`) || key.endsWith(`-${k}`) || key.includes(k))) {
      return hub;
    }
  }
  return null;
}

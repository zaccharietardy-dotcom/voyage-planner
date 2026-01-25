/**
 * Service de géocodage utilisant Nominatim (OpenStreetMap) - 100% gratuit
 */

export interface GeocodingResult {
  lat: number;
  lng: number;
  displayName: string;
  city?: string;
  country?: string;
  type: string;
}

export interface AirportInfo {
  code: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}

// Base de données des aéroports principaux
const AIRPORTS: Record<string, AirportInfo> = {
  // France
  CDG: { code: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'France', latitude: 49.0097, longitude: 2.5479 },
  ORY: { code: 'ORY', name: 'Paris Orly', city: 'Paris', country: 'France', latitude: 48.7262, longitude: 2.3652 },
  NCE: { code: 'NCE', name: 'Nice Côte d\'Azur', city: 'Nice', country: 'France', latitude: 43.6584, longitude: 7.2159 },
  LYS: { code: 'LYS', name: 'Lyon Saint-Exupéry', city: 'Lyon', country: 'France', latitude: 45.7256, longitude: 5.0811 },
  MRS: { code: 'MRS', name: 'Marseille Provence', city: 'Marseille', country: 'France', latitude: 43.4393, longitude: 5.2214 },
  TLS: { code: 'TLS', name: 'Toulouse-Blagnac', city: 'Toulouse', country: 'France', latitude: 43.629, longitude: 1.3678 },
  BOD: { code: 'BOD', name: 'Bordeaux-Mérignac', city: 'Bordeaux', country: 'France', latitude: 44.8283, longitude: -0.7156 },
  NTE: { code: 'NTE', name: 'Nantes Atlantique', city: 'Nantes', country: 'France', latitude: 47.1532, longitude: -1.6107 },

  // Espagne
  BCN: { code: 'BCN', name: 'Barcelona El Prat', city: 'Barcelone', country: 'Espagne', latitude: 41.2971, longitude: 2.0785 },
  MAD: { code: 'MAD', name: 'Madrid Barajas', city: 'Madrid', country: 'Espagne', latitude: 40.4983, longitude: -3.5676 },
  PMI: { code: 'PMI', name: 'Palma de Mallorca', city: 'Palma', country: 'Espagne', latitude: 39.5517, longitude: 2.7388 },
  AGP: { code: 'AGP', name: 'Málaga Costa del Sol', city: 'Malaga', country: 'Espagne', latitude: 36.6749, longitude: -4.4991 },

  // Italie
  FCO: { code: 'FCO', name: 'Rome Fiumicino', city: 'Rome', country: 'Italie', latitude: 41.8003, longitude: 12.2389 },
  MXP: { code: 'MXP', name: 'Milan Malpensa', city: 'Milan', country: 'Italie', latitude: 45.6306, longitude: 8.7281 },
  VCE: { code: 'VCE', name: 'Venice Marco Polo', city: 'Venise', country: 'Italie', latitude: 45.5053, longitude: 12.3519 },
  NAP: { code: 'NAP', name: 'Naples International', city: 'Naples', country: 'Italie', latitude: 40.886, longitude: 14.2908 },

  // Portugal
  LIS: { code: 'LIS', name: 'Lisbon Humberto Delgado', city: 'Lisbonne', country: 'Portugal', latitude: 38.7813, longitude: -9.1359 },
  OPO: { code: 'OPO', name: 'Porto Francisco Sá Carneiro', city: 'Porto', country: 'Portugal', latitude: 41.2481, longitude: -8.6814 },

  // Espagne (autres)
  SVQ: { code: 'SVQ', name: 'Seville San Pablo', city: 'Séville', country: 'Espagne', latitude: 37.4180, longitude: -5.8931 },

  // Italie (autres)
  FLR: { code: 'FLR', name: 'Florence Peretola', city: 'Florence', country: 'Italie', latitude: 43.8100, longitude: 11.2051 },

  // Autres Europe
  LHR: { code: 'LHR', name: 'London Heathrow', city: 'Londres', country: 'Royaume-Uni', latitude: 51.4700, longitude: -0.4543 },
  AMS: { code: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'Pays-Bas', latitude: 52.3105, longitude: 4.7683 },
  BER: { code: 'BER', name: 'Berlin Brandenburg', city: 'Berlin', country: 'Allemagne', latitude: 52.3667, longitude: 13.5033 },
  MUC: { code: 'MUC', name: 'Munich Franz Josef Strauss', city: 'Munich', country: 'Allemagne', latitude: 48.3538, longitude: 11.7861 },
  BRU: { code: 'BRU', name: 'Brussels Airport', city: 'Bruxelles', country: 'Belgique', latitude: 50.9014, longitude: 4.4844 },
  ZRH: { code: 'ZRH', name: 'Zurich Airport', city: 'Zurich', country: 'Suisse', latitude: 47.4647, longitude: 8.5492 },
  GVA: { code: 'GVA', name: 'Geneva Airport', city: 'Genève', country: 'Suisse', latitude: 46.2381, longitude: 6.1089 },
  PRG: { code: 'PRG', name: 'Prague Václav Havel', city: 'Prague', country: 'Tchéquie', latitude: 50.1008, longitude: 14.26 },
  VIE: { code: 'VIE', name: 'Vienna International', city: 'Vienne', country: 'Autriche', latitude: 48.1103, longitude: 16.5697 },
  ATH: { code: 'ATH', name: 'Athens International', city: 'Athènes', country: 'Grèce', latitude: 37.9364, longitude: 23.9445 },
  DUB: { code: 'DUB', name: 'Dublin Airport', city: 'Dublin', country: 'Irlande', latitude: 53.4264, longitude: -6.2499 },

  // France (autres)
  MPL: { code: 'MPL', name: 'Montpellier Méditerranée', city: 'Montpellier', country: 'France', latitude: 43.5762, longitude: 3.9630 },
  SXB: { code: 'SXB', name: 'Strasbourg Entzheim', city: 'Strasbourg', country: 'France', latitude: 48.5383, longitude: 7.6281 },
  LIL: { code: 'LIL', name: 'Lille-Lesquin', city: 'Lille', country: 'France', latitude: 50.5619, longitude: 3.0894 },
};

// Coordonnées des VRAIS centres-villes (pas les aéroports!)
// Ces coordonnées pointent vers le centre touristique principal
const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  // France
  'paris': { lat: 48.8566, lng: 2.3522 }, // Place de la Concorde
  'lyon': { lat: 45.7640, lng: 4.8357 }, // Place Bellecour
  'marseille': { lat: 43.2965, lng: 5.3698 }, // Vieux-Port
  'nice': { lat: 43.7102, lng: 7.2620 }, // Promenade des Anglais
  'bordeaux': { lat: 44.8378, lng: -0.5792 }, // Place de la Bourse
  'toulouse': { lat: 43.6047, lng: 1.4442 }, // Place du Capitole
  'nantes': { lat: 47.2184, lng: -1.5536 }, // Place Royale
  'montpellier': { lat: 43.6108, lng: 3.8767 }, // Place de la Comédie
  'strasbourg': { lat: 48.5734, lng: 7.7521 }, // Cathédrale
  'lille': { lat: 50.6292, lng: 3.0573 }, // Grand Place
  'angers': { lat: 47.4712, lng: -0.5518 }, // Château d'Angers
  'rennes': { lat: 48.1173, lng: -1.6778 }, // Place de la Mairie
  'tours': { lat: 47.3941, lng: 0.6848 }, // Place Jean Jaurès
  'le mans': { lat: 48.0061, lng: 0.1996 }, // Place des Jacobins

  // Espagne
  'barcelona': { lat: 41.3851, lng: 2.1734 }, // Plaça Catalunya
  'barcelone': { lat: 41.3851, lng: 2.1734 },
  'madrid': { lat: 40.4168, lng: -3.7038 }, // Puerta del Sol
  'valencia': { lat: 39.4699, lng: -0.3763 }, // Plaza del Ayuntamiento
  'valence': { lat: 39.4699, lng: -0.3763 },
  'seville': { lat: 37.3891, lng: -5.9845 }, // Plaza de España
  'séville': { lat: 37.3891, lng: -5.9845 },
  'malaga': { lat: 36.7213, lng: -4.4214 }, // Calle Larios
  'bilbao': { lat: 43.2630, lng: -2.9350 }, // Casco Viejo
  'grenade': { lat: 37.1773, lng: -3.5986 }, // Alhambra
  'granada': { lat: 37.1773, lng: -3.5986 },

  // Italie
  'rome': { lat: 41.9028, lng: 12.4964 }, // Colisée
  'roma': { lat: 41.9028, lng: 12.4964 },
  'milan': { lat: 45.4642, lng: 9.1900 }, // Duomo
  'milano': { lat: 45.4642, lng: 9.1900 },
  'venice': { lat: 45.4408, lng: 12.3155 }, // Place Saint-Marc
  'venise': { lat: 45.4408, lng: 12.3155 },
  'venezia': { lat: 45.4408, lng: 12.3155 },
  'florence': { lat: 43.7696, lng: 11.2558 }, // Piazza del Duomo
  'firenze': { lat: 43.7696, lng: 11.2558 },
  'naples': { lat: 40.8518, lng: 14.2681 }, // Centre historique
  'napoli': { lat: 40.8518, lng: 14.2681 },

  // Portugal
  'lisbon': { lat: 38.7223, lng: -9.1393 }, // Praça do Comércio
  'lisbonne': { lat: 38.7223, lng: -9.1393 },
  'lisboa': { lat: 38.7223, lng: -9.1393 },
  'porto': { lat: 41.1579, lng: -8.6291 }, // Ribeira

  // Autres Europe
  'london': { lat: 51.5074, lng: -0.1278 }, // Trafalgar Square
  'londres': { lat: 51.5074, lng: -0.1278 },
  'amsterdam': { lat: 52.3676, lng: 4.9041 }, // Dam Square
  'berlin': { lat: 52.5200, lng: 13.4050 }, // Brandenburger Tor
  'munich': { lat: 48.1351, lng: 11.5820 }, // Marienplatz
  'münchen': { lat: 48.1351, lng: 11.5820 },
  'brussels': { lat: 50.8503, lng: 4.3517 }, // Grand Place
  'bruxelles': { lat: 50.8503, lng: 4.3517 },
  'zurich': { lat: 47.3769, lng: 8.5417 }, // Bahnhofstrasse
  'geneva': { lat: 46.2044, lng: 6.1432 }, // Jet d'eau
  'genève': { lat: 46.2044, lng: 6.1432 },
  'prague': { lat: 50.0755, lng: 14.4378 }, // Old Town Square
  'vienna': { lat: 48.2082, lng: 16.3738 }, // Stephansdom
  'vienne': { lat: 48.2082, lng: 16.3738 },
  'athens': { lat: 37.9838, lng: 23.7275 }, // Acropole
  'athènes': { lat: 37.9838, lng: 23.7275 },
  'dublin': { lat: 53.3498, lng: -6.2603 }, // Temple Bar
  'budapest': { lat: 47.4979, lng: 19.0402 }, // Parlement
  'copenhagen': { lat: 55.6761, lng: 12.5683 }, // Nyhavn
  'copenhague': { lat: 55.6761, lng: 12.5683 },
  'stockholm': { lat: 59.3293, lng: 18.0686 }, // Gamla Stan
  'oslo': { lat: 59.9139, lng: 10.7522 }, // Centre
  'helsinki': { lat: 60.1699, lng: 24.9384 }, // Cathédrale
};

/**
 * Géocode une adresse en coordonnées
 */
export async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
  try {
    const encoded = encodeURIComponent(address);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      {
        headers: {
          'User-Agent': 'VoyageApp/1.0',
        },
      }
    );

    if (!response.ok) {
      throw new Error('Geocoding request failed');
    }

    const data = await response.json();

    if (data.length === 0) {
      return null;
    }

    const result = data[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
      type: result.type,
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

/**
 * Trouve tous les aéroports proches d'une ville (pour chercher les vols)
 */
export function findNearbyAirports(city: string): AirportInfo[] {
  const normalizedCity = city.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Régions avec plusieurs aéroports
  const regionAirports: Record<string, string[]> = {
    // Île-de-France / Paris region
    'paris': ['CDG', 'ORY'],
    'igny': ['ORY', 'CDG'],
    'versailles': ['ORY', 'CDG'],
    'evry': ['ORY', 'CDG'],
    'massy': ['ORY', 'CDG'],
    'palaiseau': ['ORY', 'CDG'],
    'antony': ['ORY', 'CDG'],
    'boulogne': ['ORY', 'CDG'],
    'neuilly': ['CDG', 'ORY'],
    'saint-denis': ['CDG', 'ORY'],
    'montreuil': ['CDG', 'ORY'],
    'creteil': ['ORY', 'CDG'],
    'ile-de-france': ['CDG', 'ORY'],
    'idf': ['CDG', 'ORY'],
    'region parisienne': ['CDG', 'ORY'],
    // Londres
    'london': ['LHR', 'LGW', 'STN'],
    'londres': ['LHR', 'LGW', 'STN'],
    // Milan
    'milan': ['MXP', 'LIN'],
    'milano': ['MXP', 'LIN'],
  };

  // Mappings ville -> aéroport unique (avec variantes orthographiques)
  const cityMappings: Record<string, string> = {
    // Espagne
    'barcelona': 'BCN', 'barcelone': 'BCN', 'barcelon': 'BCN', 'barca': 'BCN', 'barcel': 'BCN',
    'madrid': 'MAD', 'madri': 'MAD',
    'palma': 'PMI', 'majorque': 'PMI', 'mallorca': 'PMI', 'majorqu': 'PMI',
    'malaga': 'AGP', 'malag': 'AGP',
    'seville': 'SVQ', 'sevilla': 'SVQ',
    // Italie
    'rome': 'FCO', 'roma': 'FCO', 'rom': 'FCO',
    'milan': 'MXP', 'milano': 'MXP', 'mila': 'MXP',
    'venice': 'VCE', 'venise': 'VCE', 'venezia': 'VCE', 'venis': 'VCE',
    'naples': 'NAP', 'napoli': 'NAP', 'naple': 'NAP',
    'florence': 'FLR', 'firenze': 'FLR', 'florenc': 'FLR',
    // Portugal
    'lisbon': 'LIS', 'lisbonne': 'LIS', 'lisboa': 'LIS', 'lisbonn': 'LIS',
    'porto': 'OPO',
    // Autres Europe
    'amsterdam': 'AMS', 'amsterd': 'AMS',
    'berlin': 'BER', 'berli': 'BER',
    'vienna': 'VIE', 'vienne': 'VIE', 'wien': 'VIE',
    'athens': 'ATH', 'athenes': 'ATH', 'athen': 'ATH',
    'prague': 'PRG', 'praha': 'PRG', 'pragu': 'PRG',
    'dublin': 'DUB', 'dubli': 'DUB',
    'london': 'LHR', 'londres': 'LHR', 'londr': 'LHR',
    'brussels': 'BRU', 'bruxelles': 'BRU', 'brussel': 'BRU',
    'munich': 'MUC', 'munchen': 'MUC', 'munic': 'MUC',
    'zurich': 'ZRH', 'zuric': 'ZRH',
    'geneva': 'GVA', 'geneve': 'GVA', 'genev': 'GVA',
    // France
    'nice': 'NCE',
    'lyon': 'LYS',
    'marseille': 'MRS', 'marseil': 'MRS',
    'toulouse': 'TLS', 'toulous': 'TLS',
    'bordeaux': 'BOD', 'bordeau': 'BOD',
    'nantes': 'NTE', 'nante': 'NTE',
    'montpellier': 'MPL', 'montpell': 'MPL',
    'strasbourg': 'SXB', 'strasbour': 'SXB',
    'lille': 'LIL',
  };

  // Chercher dans les régions avec plusieurs aéroports
  for (const [key, codes] of Object.entries(regionAirports)) {
    if (normalizedCity.includes(key) || key.includes(normalizedCity)) {
      return codes.map(code => AIRPORTS[code]).filter(Boolean);
    }
  }

  // Chercher dans les mappings simples
  for (const [key, code] of Object.entries(cityMappings)) {
    if (normalizedCity.includes(key) || key.includes(normalizedCity)) {
      return [AIRPORTS[code]].filter(Boolean);
    }
  }

  // Recherche directe par ville d'aéroport
  for (const airport of Object.values(AIRPORTS)) {
    const normalizedAirportCity = airport.city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalizedCity.includes(normalizedAirportCity) || normalizedAirportCity.includes(normalizedCity)) {
      return [airport];
    }
  }

  // Recherche par code aéroport
  const upperCity = city.toUpperCase().trim();
  if (AIRPORTS[upperCity]) {
    return [AIRPORTS[upperCity]];
  }

  // Défaut: Paris CDG et ORY
  console.warn(`Aéroports non trouvés pour "${city}", utilisation de Paris par défaut`);
  return [AIRPORTS['CDG'], AIRPORTS['ORY']];
}

/**
 * Trouve l'aéroport le plus proche d'une ville (legacy, utilise findNearbyAirports)
 */
export function findNearestAirport(city: string): AirportInfo | null {
  const airports = findNearbyAirports(city);
  return airports.length > 0 ? airports[0] : null;
}

/**
 * Calcule la distance entre deux points (formule de Haversine)
 * @returns Distance en kilomètres
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calcule la distance entre deux points en mètres
 * Wrapper de calculateDistance pour les calculs de proximité
 * @returns Distance en mètres
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  return calculateDistance(lat1, lng1, lat2, lng2) * 1000;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Estime le temps de trajet en fonction de la distance et du mode
 */
export function estimateTravelTime(
  distanceKm: number,
  mode: 'walk' | 'car' | 'public' | 'taxi'
): number {
  const speeds: Record<string, number> = {
    walk: 5, // km/h
    car: 40, // km/h (en ville avec trafic)
    public: 25, // km/h (moyenne transports en commun)
    taxi: 35, // km/h
  };

  const speed = speeds[mode] || 30;
  return Math.round((distanceKm / speed) * 60); // minutes
}

/**
 * Obtient les coordonnées du centre-ville d'une destination
 * IMPORTANT: Retourne le VRAI centre touristique, pas l'aéroport
 */
export function getCityCenterCoords(city: string): { lat: number; lng: number } | null {
  const normalizedCity = city.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Enlever accents

  // Chercher dans notre base de centres-villes
  if (CITY_CENTERS[normalizedCity]) {
    console.log(`[Geocoding] Centre-ville trouvé pour "${city}": ${JSON.stringify(CITY_CENTERS[normalizedCity])}`);
    return CITY_CENTERS[normalizedCity];
  }

  // Essayer sans accents et variations
  for (const [key, coords] of Object.entries(CITY_CENTERS)) {
    const normalizedKey = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalizedKey === normalizedCity || normalizedCity.includes(normalizedKey) || normalizedKey.includes(normalizedCity)) {
      console.log(`[Geocoding] Centre-ville trouvé (fuzzy) pour "${city}": ${JSON.stringify(coords)}`);
      return coords;
    }
  }

  console.log(`[Geocoding] Pas de centre-ville connu pour "${city}"`);
  return null;
}

export { AIRPORTS, CITY_CENTERS };

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
  // France - Corse
  AJA: { code: 'AJA', name: 'Ajaccio Napoleon Bonaparte', city: 'Ajaccio', country: 'France', latitude: 41.9236, longitude: 8.8029 },
  BIA: { code: 'BIA', name: 'Bastia Poretta', city: 'Bastia', country: 'France', latitude: 42.5527, longitude: 9.4837 },
  FSC: { code: 'FSC', name: 'Figari Sud Corse', city: 'Figari', country: 'France', latitude: 41.5006, longitude: 9.0978 },
  CLY: { code: 'CLY', name: 'Calvi Sainte-Catherine', city: 'Calvi', country: 'France', latitude: 42.5308, longitude: 8.7932 },

  // Japon
  NRT: { code: 'NRT', name: 'Tokyo Narita', city: 'Tokyo', country: 'Japon', latitude: 35.7720, longitude: 140.3929 },
  HND: { code: 'HND', name: 'Tokyo Haneda', city: 'Tokyo', country: 'Japon', latitude: 35.5494, longitude: 139.7798 },
  KIX: { code: 'KIX', name: 'Osaka Kansai', city: 'Osaka', country: 'Japon', latitude: 34.4320, longitude: 135.2304 },
  ITM: { code: 'ITM', name: 'Osaka Itami', city: 'Osaka', country: 'Japon', latitude: 34.7855, longitude: 135.4380 },
  NGO: { code: 'NGO', name: 'Nagoya Chubu', city: 'Nagoya', country: 'Japon', latitude: 34.8584, longitude: 136.8125 },
  FUK: { code: 'FUK', name: 'Fukuoka', city: 'Fukuoka', country: 'Japon', latitude: 33.5859, longitude: 130.4510 },
  CTS: { code: 'CTS', name: 'Sapporo New Chitose', city: 'Sapporo', country: 'Japon', latitude: 42.7752, longitude: 141.6925 },

  // Asie (autres)
  ICN: { code: 'ICN', name: 'Seoul Incheon', city: 'Seoul', country: 'Corée du Sud', latitude: 37.4602, longitude: 126.4407 },
  PEK: { code: 'PEK', name: 'Beijing Capital', city: 'Pékin', country: 'Chine', latitude: 40.0799, longitude: 116.6031 },
  PVG: { code: 'PVG', name: 'Shanghai Pudong', city: 'Shanghai', country: 'Chine', latitude: 31.1434, longitude: 121.8052 },
  HKG: { code: 'HKG', name: 'Hong Kong International', city: 'Hong Kong', country: 'Hong Kong', latitude: 22.3080, longitude: 113.9185 },
  SIN: { code: 'SIN', name: 'Singapore Changi', city: 'Singapour', country: 'Singapour', latitude: 1.3644, longitude: 103.9915 },
  BKK: { code: 'BKK', name: 'Bangkok Suvarnabhumi', city: 'Bangkok', country: 'Thaïlande', latitude: 13.6900, longitude: 100.7501 },

  // Amérique du Nord
  JFK: { code: 'JFK', name: 'New York JFK', city: 'New York', country: 'États-Unis', latitude: 40.6413, longitude: -73.7781 },
  LAX: { code: 'LAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'États-Unis', latitude: 33.9416, longitude: -118.4085 },
  SFO: { code: 'SFO', name: 'San Francisco International', city: 'San Francisco', country: 'États-Unis', latitude: 37.6213, longitude: -122.3790 },
  MIA: { code: 'MIA', name: 'Miami International', city: 'Miami', country: 'États-Unis', latitude: 25.7959, longitude: -80.2870 },
  YYZ: { code: 'YYZ', name: 'Toronto Pearson', city: 'Toronto', country: 'Canada', latitude: 43.6777, longitude: -79.6248 },
  YUL: { code: 'YUL', name: 'Montréal Trudeau', city: 'Montréal', country: 'Canada', latitude: 45.4706, longitude: -73.7408 },

  // Grèce (îles et autres)
  HER: { code: 'HER', name: 'Heraklion Nikos Kazantzakis', city: 'Heraklion', country: 'Grèce', latitude: 35.3397, longitude: 25.1803 },
  JTR: { code: 'JTR', name: 'Santorini (Thira)', city: 'Santorin', country: 'Grèce', latitude: 36.3992, longitude: 25.4793 },
  RHO: { code: 'RHO', name: 'Rhodes Diagoras', city: 'Rhodes', country: 'Grèce', latitude: 36.4054, longitude: 28.0862 },
  CFU: { code: 'CFU', name: 'Corfu Ioannis Kapodistrias', city: 'Corfou', country: 'Grèce', latitude: 39.6019, longitude: 19.9117 },
  SKG: { code: 'SKG', name: 'Thessaloniki Macedonia', city: 'Thessalonique', country: 'Grèce', latitude: 40.5197, longitude: 22.9709 },

  // Croatie
  DBV: { code: 'DBV', name: 'Dubrovnik', city: 'Dubrovnik', country: 'Croatie', latitude: 42.5614, longitude: 18.2682 },
  SPU: { code: 'SPU', name: 'Split', city: 'Split', country: 'Croatie', latitude: 43.5390, longitude: 16.2980 },

  // Maroc
  RAK: { code: 'RAK', name: 'Marrakech Menara', city: 'Marrakech', country: 'Maroc', latitude: 31.6069, longitude: -8.0363 },
  CMN: { code: 'CMN', name: 'Casablanca Mohammed V', city: 'Casablanca', country: 'Maroc', latitude: 33.3675, longitude: -7.5900 },

  // Malte
  MLA: { code: 'MLA', name: 'Malta International', city: 'La Valette', country: 'Malte', latitude: 35.8575, longitude: 14.4775 },

  // Sardaigne
  CAG: { code: 'CAG', name: 'Cagliari Elmas', city: 'Cagliari', country: 'Italie', latitude: 39.2515, longitude: 9.0543 },
  OLB: { code: 'OLB', name: 'Olbia Costa Smeralda', city: 'Olbia', country: 'Italie', latitude: 40.8987, longitude: 9.5176 },

  // Sicile
  CTA: { code: 'CTA', name: 'Catania Fontanarossa', city: 'Catane', country: 'Italie', latitude: 37.4668, longitude: 15.0664 },
  PMO: { code: 'PMO', name: 'Palermo Falcone-Borsellino', city: 'Palerme', country: 'Italie', latitude: 38.1760, longitude: 13.0910 },

  // Chypre
  LCA: { code: 'LCA', name: 'Larnaca', city: 'Larnaca', country: 'Chypre', latitude: 34.8751, longitude: 33.6249 },

  // Canaries
  TFS: { code: 'TFS', name: 'Tenerife South', city: 'Tenerife', country: 'Espagne', latitude: 28.0445, longitude: -16.5725 },
  LPA: { code: 'LPA', name: 'Gran Canaria', city: 'Las Palmas', country: 'Espagne', latitude: 27.9319, longitude: -15.3866 },

  // Turquie
  IST: { code: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'Turquie', latitude: 41.2753, longitude: 28.7519 },

  // Hongrie
  BUD: { code: 'BUD', name: 'Budapest Ferenc Liszt', city: 'Budapest', country: 'Hongrie', latitude: 47.4398, longitude: 19.2612 },
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
  // France - Corse
  'ajaccio': { lat: 41.9192, lng: 8.7386 }, // Place Foch
  'bastia': { lat: 42.6975, lng: 9.4510 }, // Vieux-Port
  'porto-vecchio': { lat: 41.5917, lng: 9.2789 }, // Centre
  'bonifacio': { lat: 41.3873, lng: 9.1593 }, // Citadelle
  'calvi': { lat: 42.5679, lng: 8.7571 }, // Citadelle
  'corte': { lat: 42.3058, lng: 9.1492 }, // Citadelle
  'angers': { lat: 47.4712, lng: -0.5518 }, // Château d'Angers
  'rennes': { lat: 48.1173, lng: -1.6778 }, // Place de la Mairie
  'tours': { lat: 47.3941, lng: 0.6848 }, // Place Jean Jaurès
  'le mans': { lat: 48.0061, lng: 0.1996 }, // Place des Jacobins
  'caen': { lat: 49.1859, lng: -0.3706 }, // Château de Caen
  'rouen': { lat: 49.4432, lng: 1.0999 }, // Cathédrale Notre-Dame
  'le havre': { lat: 49.4944, lng: 0.1079 }, // Centre-ville
  'amiens': { lat: 49.8942, lng: 2.2957 }, // Cathédrale Notre-Dame
  'reims': { lat: 49.2583, lng: 4.0317 }, // Cathédrale Notre-Dame
  'metz': { lat: 49.1193, lng: 6.1757 }, // Place d'Armes
  'nancy': { lat: 48.6921, lng: 6.1844 }, // Place Stanislas
  'dijon': { lat: 47.3220, lng: 5.0415 }, // Palais des Ducs
  'besancon': { lat: 47.2378, lng: 6.0241 }, // Citadelle
  'grenoble': { lat: 45.1885, lng: 5.7245 }, // Place Grenette
  'clermont-ferrand': { lat: 45.7772, lng: 3.0870 }, // Place de Jaude
  'limoges': { lat: 45.8336, lng: 1.2611 }, // Gare des Bénédictins
  'poitiers': { lat: 46.5802, lng: 0.3404 }, // Place Charles de Gaulle
  'la rochelle': { lat: 46.1603, lng: -1.1511 }, // Vieux-Port
  'perpignan': { lat: 42.6988, lng: 2.8956 }, // Place de Catalogne
  'pau': { lat: 43.2951, lng: -0.3708 }, // Place Royale
  'biarritz': { lat: 43.4832, lng: -1.5586 }, // Grande Plage
  'bayonne': { lat: 43.4929, lng: -1.4748 }, // Cathédrale Sainte-Marie
  'avignon': { lat: 43.9493, lng: 4.8055 }, // Palais des Papes
  'aix-en-provence': { lat: 43.5297, lng: 5.4474 }, // Cours Mirabeau
  'toulon': { lat: 43.1242, lng: 5.9280 }, // Port
  'cannes': { lat: 43.5528, lng: 7.0174 }, // La Croisette
  'antibes': { lat: 43.5808, lng: 7.1239 }, // Vieil Antibes

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

  // Japon
  'tokyo': { lat: 35.6762, lng: 139.6503 }, // Shibuya
  'osaka': { lat: 34.6937, lng: 135.5023 }, // Dotonbori
  'kyoto': { lat: 35.0116, lng: 135.7681 }, // Gion
  'nagoya': { lat: 35.1815, lng: 136.9066 }, // Centre
  'fukuoka': { lat: 33.5904, lng: 130.4017 }, // Tenjin
  'sapporo': { lat: 43.0618, lng: 141.3545 }, // Odori Park

  // Asie
  'seoul': { lat: 37.5665, lng: 126.9780 }, // Myeongdong
  'séoul': { lat: 37.5665, lng: 126.9780 },
  'beijing': { lat: 39.9042, lng: 116.4074 }, // Place Tiananmen
  'pékin': { lat: 39.9042, lng: 116.4074 },
  'pekin': { lat: 39.9042, lng: 116.4074 },
  'shanghai': { lat: 31.2304, lng: 121.4737 }, // The Bund
  'hong kong': { lat: 22.3193, lng: 114.1694 }, // Victoria Harbour
  'hongkong': { lat: 22.3193, lng: 114.1694 },
  'singapore': { lat: 1.3521, lng: 103.8198 }, // Marina Bay
  'singapour': { lat: 1.3521, lng: 103.8198 },
  'bangkok': { lat: 13.7563, lng: 100.5018 }, // Khao San Road

  // Grèce (îles et autres)
  'heraklion': { lat: 35.3387, lng: 25.1442 }, // Vieux port vénitien
  'héraklion': { lat: 35.3387, lng: 25.1442 },
  'iraklion': { lat: 35.3387, lng: 25.1442 },
  'crete': { lat: 35.2401, lng: 24.4709 },
  'crète': { lat: 35.2401, lng: 24.4709 },
  'chania': { lat: 35.5138, lng: 24.0180 },
  'la canée': { lat: 35.5138, lng: 24.0180 },
  'santorin': { lat: 36.3932, lng: 25.4615 },
  'santorini': { lat: 36.3932, lng: 25.4615 },
  'rhodes': { lat: 36.4341, lng: 28.2176 },
  'corfou': { lat: 39.6243, lng: 19.9217 },
  'corfu': { lat: 39.6243, lng: 19.9217 },
  'mykonos': { lat: 37.4467, lng: 25.3289 },
  'thessalonique': { lat: 40.6401, lng: 22.9444 },
  'thessaloniki': { lat: 40.6401, lng: 22.9444 },

  // Croatie
  'dubrovnik': { lat: 42.6507, lng: 18.0944 }, // Vieille ville
  'split': { lat: 43.5081, lng: 16.4402 }, // Palais de Dioclétien
  'zagreb': { lat: 45.8150, lng: 15.9819 },

  // Turquie
  'istanbul': { lat: 41.0082, lng: 28.9784 }, // Sultanahmet
  'antalya': { lat: 36.8969, lng: 30.7133 },

  // Maroc
  'marrakech': { lat: 31.6295, lng: -7.9811 }, // Jemaa el-Fna
  'fes': { lat: 34.0181, lng: -5.0078 },
  'fès': { lat: 34.0181, lng: -5.0078 },
  'casablanca': { lat: 33.5731, lng: -7.5898 },

  // Malte
  'malte': { lat: 35.8989, lng: 14.5146 },
  'malta': { lat: 35.8989, lng: 14.5146 },
  'valletta': { lat: 35.8989, lng: 14.5146 },
  'la valette': { lat: 35.8989, lng: 14.5146 },

  // Sicile / Sardaigne
  'palermo': { lat: 38.1157, lng: 13.3615 },
  'palerme': { lat: 38.1157, lng: 13.3615 },
  'catania': { lat: 37.5079, lng: 15.0830 },
  'catane': { lat: 37.5079, lng: 15.0830 },
  'cagliari': { lat: 39.2238, lng: 9.1217 },

  // Baléares
  'palma': { lat: 39.5696, lng: 2.6502 },
  'majorque': { lat: 39.5696, lng: 2.6502 },
  'mallorca': { lat: 39.5696, lng: 2.6502 },
  'ibiza': { lat: 38.9067, lng: 1.4206 },

  // Canaries
  'tenerife': { lat: 28.4636, lng: -16.2518 },
  'las palmas': { lat: 28.1235, lng: -15.4363 },
  'gran canaria': { lat: 28.1235, lng: -15.4363 },

  // Chypre
  'chypre': { lat: 34.9071, lng: 33.6226 },
  'cyprus': { lat: 34.9071, lng: 33.6226 },
  'larnaca': { lat: 34.9003, lng: 33.6232 },
  'paphos': { lat: 34.7720, lng: 32.4297 },

  // Amérique du Nord
  'new york': { lat: 40.7580, lng: -73.9855 }, // Times Square
  'newyork': { lat: 40.7580, lng: -73.9855 },
  'los angeles': { lat: 34.0522, lng: -118.2437 }, // Hollywood
  'san francisco': { lat: 37.7749, lng: -122.4194 }, // Union Square
  'miami': { lat: 25.7617, lng: -80.1918 }, // South Beach
  'toronto': { lat: 43.6532, lng: -79.3832 }, // CN Tower
  'montreal': { lat: 45.5017, lng: -73.5673 }, // Vieux-Montréal
  'montréal': { lat: 45.5017, lng: -73.5673 },
};

// In-memory cache for geocoding results (avoids duplicate Nominatim calls within a generation)
const geocodeCache = new Map<string, Promise<GeocodingResult | null>>();

// Nominatim throttle: max 1 concurrent request with 500ms spacing
let nominatimLastCall = 0;
const nominatimMutex = { locked: false, queue: [] as (() => void)[] };

async function withNominatimThrottle<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for previous call to finish
  if (nominatimMutex.locked) {
    await new Promise<void>(resolve => nominatimMutex.queue.push(resolve));
  }
  nominatimMutex.locked = true;

  // Ensure at least 500ms between calls
  const now = Date.now();
  const wait = Math.max(0, nominatimLastCall + 500 - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));

  try {
    const result = await fn();
    return result;
  } finally {
    nominatimLastCall = Date.now();
    nominatimMutex.locked = false;
    const next = nominatimMutex.queue.shift();
    if (next) next();
  }
}

/** Clear geocode cache (call between generations) */
export function clearGeocodeCache() {
  geocodeCache.clear();
}

/**
 * Géocode une adresse en coordonnées (with in-memory cache + Nominatim throttle)
 */
export async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
  const cacheKey = address.toLowerCase().trim();

  // Return cached promise if available (deduplicates concurrent calls for same address)
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const promise = withNominatimThrottle(async () => {
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
  });

  geocodeCache.set(cacheKey, promise);
  return promise;
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
    // France - Corse
    'ajaccio': 'AJA', 'aiacciu': 'AJA',
    'bastia': 'BIA',
    'figari': 'FSC', 'porto-vecchio': 'FSC', 'porto vecchio': 'FSC', 'bonifacio': 'FSC',
    'calvi': 'CLY',
    'corse': 'AJA', 'corsica': 'AJA',
    // Japon
    'tokyo': 'NRT', 'tokio': 'NRT',
    'osaka': 'KIX',
    'kyoto': 'KIX', // Kyoto utilise Osaka Kansai
    'nagoya': 'NGO',
    'fukuoka': 'FUK',
    'sapporo': 'CTS',
    // Asie
    'seoul': 'ICN', 'séoul': 'ICN',
    'beijing': 'PEK', 'pekin': 'PEK', 'pékin': 'PEK',
    'shanghai': 'PVG',
    'hong kong': 'HKG', 'hongkong': 'HKG',
    'singapore': 'SIN', 'singapour': 'SIN',
    'bangkok': 'BKK',
    // Grèce
    'heraklion': 'HER', 'iraklion': 'HER', 'héraklion': 'HER', 'crete': 'HER', 'crète': 'HER', 'chania': 'HER',
    'santorini': 'JTR', 'santorin': 'JTR', 'thira': 'JTR',
    'rhodes': 'RHO',
    'corfu': 'CFU', 'corfou': 'CFU',
    'mykonos': 'JTR', // Closest major airport
    'thessaloniki': 'SKG', 'thessalonique': 'SKG',
    // Croatie
    'dubrovnik': 'DBV',
    'split': 'SPU',
    // Maroc
    'marrakech': 'RAK',
    'casablanca': 'CMN',
    'fes': 'CMN', 'fès': 'CMN',
    // Malte
    'malte': 'MLA', 'malta': 'MLA', 'valletta': 'MLA',
    // Sicile / Sardaigne
    'palermo': 'PMO', 'palerme': 'PMO',
    'catania': 'CTA', 'catane': 'CTA',
    'cagliari': 'CAG',
    'olbia': 'OLB',
    // Chypre
    'chypre': 'LCA', 'cyprus': 'LCA', 'larnaca': 'LCA', 'paphos': 'LCA',
    // Canaries
    'tenerife': 'TFS',
    'gran canaria': 'LPA', 'las palmas': 'LPA',
    // Turquie
    'istanbul': 'IST',
    // Hongrie
    'budapest': 'BUD',
    // Amérique du Nord
    'new york': 'JFK', 'newyork': 'JFK', 'nyc': 'JFK',
    'los angeles': 'LAX', 'la': 'LAX',
    'san francisco': 'SFO',
    'miami': 'MIA',
    'toronto': 'YYZ',
    'montreal': 'YUL', 'montréal': 'YUL',
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

/**
 * Version async de getCityCenterCoords avec fallback Nominatim
 * Tente d'abord le lookup hardcodé, puis geocode via Nominatim si inconnu
 */
export async function getCityCenterCoordsAsync(city: string): Promise<{ lat: number; lng: number } | null> {
  // 1. Lookup hardcodé (instantané)
  const hardcoded = getCityCenterCoords(city);
  if (hardcoded) return hardcoded;

  // 2. Fallback Nominatim (gratuit)
  console.log(`[Geocoding] Nominatim fallback pour "${city}"...`);
  const result = await geocodeAddress(city);
  if (result && result.lat && result.lng) {
    const coords = { lat: result.lat, lng: result.lng };
    // Stocker pour le reste de la session
    const normalizedCity = city.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    CITY_CENTERS[normalizedCity] = coords;
    console.log(`[Geocoding] ✅ Nominatim: "${city}" → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
    return coords;
  }

  console.warn(`[Geocoding] ❌ Nominatim: aucun résultat pour "${city}"`);
  return null;
}

/**
 * Version async de findNearbyAirports avec fallback par distance géographique
 * Ne retourne plus Paris CDG par défaut pour les villes inconnues
 */
export async function findNearbyAirportsAsync(city: string): Promise<AirportInfo[]> {
  const result = findNearbyAirports(city);
  // Si on a trouvé autre chose que le fallback Paris CDG, c'est bon
  if (result.length > 0 && result[0].code !== 'CDG') {
    return result;
  }
  // Vérifier si c'est vraiment Paris/IDF
  const normalizedCity = city.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const parisCities = ['paris', 'igny', 'versailles', 'evry', 'massy', 'palaiseau', 'antony', 'boulogne', 'neuilly', 'saint-denis', 'montreuil', 'creteil', 'ile-de-france'];
  if (parisCities.some(p => normalizedCity.includes(p))) {
    return result; // C'est bien Paris
  }

  // Pas Paris → trouver l'aéroport le plus proche par coordonnées
  console.log(`[Geocoding] Recherche aéroport le plus proche pour "${city}" via géocodage...`);
  const coords = await getCityCenterCoordsAsync(city);
  if (!coords) return result; // Nominatim a échoué, on garde le fallback

  // Calculer la distance à chaque aéroport
  const airportsWithDistance = Object.values(AIRPORTS).map(airport => ({
    airport,
    distance: calculateDistance(coords.lat, coords.lng, airport.latitude, airport.longitude),
  }));
  airportsWithDistance.sort((a, b) => a.distance - b.distance);

  const nearest = airportsWithDistance.slice(0, 3).map(a => a.airport);
  console.log(`[Geocoding] ✅ Aéroports les plus proches de "${city}": ${nearest.map(a => `${a.code} (${Math.round(airportsWithDistance.find(x => x.airport.code === a.code)!.distance)}km)`).join(', ')}`);
  return nearest;
}

export { AIRPORTS, CITY_CENTERS };

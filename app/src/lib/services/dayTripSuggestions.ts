/**
 * Day Trip Suggestions Service
 *
 * Provides curated day trip recommendations for major tourist destinations.
 * Falls back to AI generation for uncovered cities.
 */

import type { GroupType, BudgetLevel, ActivityType } from '../types/trip';

// ============================================
// Types
// ============================================

export interface DayTripSuggestion {
  name: string;
  description: string;
  destination: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  transportMode: 'train' | 'bus' | 'car' | 'ferry' | 'RER' | 'metro';
  transportDurationMin: number;
  estimatedCostPerPerson: number; // Transport cost in EUR
  keyAttractions: string[];
  tags: ActivityType[];
  suitableFor: GroupType[];
  minBudgetLevel: BudgetLevel;
  bestSeason?: string; // e.g., "March-May" for Keukenhof
  bookingRequired?: boolean;
  notes?: string;
  minDays: number;           // minimum trip duration to suggest this day trip
  fullDayRequired: boolean;  // true = takes the whole day
  fromCity: string;          // normalized origin city name for matching (e.g. "paris")
}

// ============================================
// Curated Day Trip Database (80+ entries)
// ============================================

export const DAY_TRIP_DATABASE: DayTripSuggestion[] = [
  // ============================================
  // PARIS (7 day trips)
  // ============================================
  {
    name: 'Château de Versailles',
    description: 'Palais royal somptueux avec jardins à la française et appartements du Roi-Soleil',
    destination: 'Versailles',
    latitude: 48.8049,
    longitude: 2.1204,
    distanceKm: 20,
    transportMode: 'train',
    transportDurationMin: 40,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Galerie des Glaces",
      "Appartements Royaux",
      "Jardins à la française",
      "Grand Trianon",
      "Hameau de la Reine"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bookingRequired: true,
    notes: "Arriver tôt pour éviter les foules. Billets coupe-file recommandés.",
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'paris'
  },
  {
    name: 'Jardins de Monet à Giverny',
    description: "Maison et jardins impressionnistes de Claude Monet, célèbres pour leurs nymphéas",
    destination: 'Giverny',
    latitude: 49.0758,
    longitude: 1.5339,
    distanceKm: 75,
    transportMode: 'train',
    transportDurationMin: 75,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Jardin d'eau et pont japonais",
      "Jardin de fleurs",
      "Maison de Claude Monet",
      "Atelier de Monet"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bestSeason: "April-October",
    notes: "Fermé en hiver. Plus beau au printemps (avril-juin).",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'paris'
  },
  {
    name: 'Mont-Saint-Michel',
    description: 'Abbaye médiévale spectaculaire sur un îlot rocheux en Normandie',
    destination: 'Mont-Saint-Michel',
    latitude: 48.6361,
    longitude: -1.5115,
    distanceKm: 360,
    transportMode: 'bus',
    transportDurationMin: 270,
    estimatedCostPerPerson: 35,
    keyAttractions: [
      "Abbaye du Mont-Saint-Michel",
      "Village médiéval",
      "Remparts",
      "Grande Rue",
      "Baie et marées spectaculaires"
    ],
    tags: ['culture', 'nature', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Journée complète nécessaire. Vérifier les horaires de marées.",
    minDays: 6,
    fullDayRequired: true,
    fromCity: 'paris'
  },
  {
    name: 'Disneyland Paris',
    description: 'Parc à thème Disney avec attractions, spectacles et rencontres avec personnages',
    destination: 'Marne-la-Vallée',
    latitude: 48.8722,
    longitude: 2.7758,
    distanceKm: 32,
    transportMode: 'RER',
    transportDurationMin: 45,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Parc Disneyland",
      "Parc Walt Disney Studios",
      "Château de la Belle au Bois Dormant",
      "Space Mountain",
      "Spectacles Disney"
    ],
    tags: ['adventure'],
    suitableFor: ['couple', 'friends', 'family_with_kids'],
    minBudgetLevel: 'comfort',
    bookingRequired: true,
    notes: "Billets séparés requis (~60-80€). Planifier une journée entière.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'paris'
  },
  {
    name: 'Château de Fontainebleau',
    description: 'Château Renaissance et classique, résidence favorite de Napoléon',
    destination: 'Fontainebleau',
    latitude: 48.4010,
    longitude: 2.7018,
    distanceKm: 65,
    transportMode: 'train',
    transportDurationMin: 50,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Appartements Napoléon",
      "Galerie François Ier",
      "Parc et jardins",
      "Forêt de Fontainebleau"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'paris'
  },
  {
    name: 'Cathédrale de Chartres',
    description: 'Chef-d\'œuvre gothique avec vitraux médiévaux exceptionnels',
    destination: 'Chartres',
    latitude: 48.4478,
    longitude: 1.4876,
    distanceKm: 90,
    transportMode: 'train',
    transportDurationMin: 65,
    estimatedCostPerPerson: 16,
    keyAttractions: [
      "Cathédrale Notre-Dame",
      "Vitraux du XIIIe siècle",
      "Labyrinthe médiéval",
      "Vieille ville"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'paris'
  },
  {
    name: 'Provins Cité Médiévale',
    description: 'Ville médiévale fortifiée classée UNESCO avec spectacles historiques',
    destination: 'Provins',
    latitude: 48.5588,
    longitude: 3.2993,
    distanceKm: 90,
    transportMode: 'train',
    transportDurationMin: 85,
    estimatedCostPerPerson: 14,
    keyAttractions: [
      "Remparts médiévaux",
      "Tour César",
      "Spectacle des aigles",
      "Souterrains"
    ],
    tags: ['culture', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'paris'
  },

  // ============================================
  // ROME (5 day trips)
  // ============================================
  {
    name: 'Villa d\'Este et Villa Adriana',
    description: 'Jardins Renaissance spectaculaires et villa impériale romaine à Tivoli',
    destination: 'Tivoli',
    latitude: 41.9634,
    longitude: 12.7990,
    distanceKm: 30,
    transportMode: 'bus',
    transportDurationMin: 60,
    estimatedCostPerPerson: 3,
    keyAttractions: [
      "Jardins de la Villa d'Este",
      "Fontaines baroques",
      "Villa Adriana (Hadrien)",
      "Ruines romaines"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'rome'
  },
  {
    name: 'Pompéi et Vésuve',
    description: 'Cité romaine figée par l\'éruption de 79 ap. J-C et volcan actif',
    destination: 'Pompéi',
    latitude: 40.7511,
    longitude: 14.4869,
    distanceKm: 240,
    transportMode: 'train',
    transportDurationMin: 130,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Ruines de Pompéi",
      "Forum romain",
      "Maisons patriciennes",
      "Amphithéâtre",
      "Mont Vésuve (optionnel)"
    ],
    tags: ['culture', 'nature', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Journée complète recommandée. Prévoir eau et protection solaire.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'rome'
  },
  {
    name: 'Ostia Antica',
    description: 'Port antique de Rome avec ruines romaines exceptionnellement préservées',
    destination: 'Ostia Antica',
    latitude: 41.7576,
    longitude: 12.2917,
    distanceKm: 25,
    transportMode: 'metro',
    transportDurationMin: 45,
    estimatedCostPerPerson: 2,
    keyAttractions: [
      "Théâtre romain",
      "Forum",
      "Thermes de Neptune",
      "Insulae (immeubles antiques)",
      "Mosaïques"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Alternative moins touristique à Pompéi, plus proche de Rome.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'rome'
  },
  {
    name: 'Orvieto',
    description: 'Ville médiévale perchée en Ombrie avec cathédrale gothique remarquable',
    destination: 'Orvieto',
    latitude: 42.7184,
    longitude: 12.1104,
    distanceKm: 120,
    transportMode: 'train',
    transportDurationMin: 70,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Duomo d'Orvieto",
      "Puits de Saint-Patrick",
      "Vieille ville médiévale",
      "Grottes souterraines"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 5,
    fullDayRequired: true,
    fromCity: 'rome'
  },
  {
    name: 'Castel Gandolfo',
    description: 'Résidence d\'été du Pape avec palais apostolique et jardins sur le lac Albano',
    destination: 'Castel Gandolfo',
    latitude: 41.7475,
    longitude: 12.6508,
    distanceKm: 25,
    transportMode: 'bus',
    transportDurationMin: 45,
    estimatedCostPerPerson: 3,
    keyAttractions: [
      "Palais pontifical",
      "Jardins barberini",
      "Lac Albano",
      "Village historique"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'rome'
  },

  // ============================================
  // TOKYO (5 day trips)
  // ============================================
  {
    name: 'Mont Fuji et Lac Kawaguchi',
    description: 'Montagne sacrée du Japon avec vues panoramiques et villages traditionnels',
    destination: 'Kawaguchiko',
    latitude: 35.5032,
    longitude: 138.7649,
    distanceKm: 100,
    transportMode: 'bus',
    transportDurationMin: 120,
    estimatedCostPerPerson: 20,
    keyAttractions: [
      "Vue sur le Mont Fuji",
      "Lac Kawaguchi",
      "Pagode Chureito",
      "Iyashi no Sato (village traditionnel)",
      "Téléphérique panoramique"
    ],
    tags: ['nature', 'culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bestSeason: "October-May (Fuji visible)",
    notes: "Le Fuji est souvent caché par les nuages en été.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'tokyo'
  },
  {
    name: 'Kamakura',
    description: 'Ancienne capitale avec temples zen, grand Bouddha et plages',
    destination: 'Kamakura',
    latitude: 35.3197,
    longitude: 139.5467,
    distanceKm: 50,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Grand Bouddha (Daibutsu)",
      "Temple Hasedera",
      "Sanctuaire Tsurugaoka Hachimangu",
      "Rue commerçante Komachi",
      "Plages"
    ],
    tags: ['culture', 'nature', 'beach'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'tokyo'
  },
  {
    name: 'Nikko',
    description: 'Site sacré UNESCO avec sanctuaires dorés, cascades et forêts de cèdres',
    destination: 'Nikko',
    latitude: 36.7519,
    longitude: 139.5981,
    distanceKm: 140,
    transportMode: 'train',
    transportDurationMin: 130,
    estimatedCostPerPerson: 25,
    keyAttractions: [
      "Sanctuaire Toshogu",
      "Chutes de Kegon",
      "Lac Chuzenji",
      "Pont sacré Shinkyo",
      "Forêts de cèdres"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Journée complète recommandée. Très beau en automne (koyo).",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'tokyo'
  },
  {
    name: 'Hakone',
    description: 'Station thermale avec onsen, musées d\'art et vue sur le Mont Fuji',
    destination: 'Hakone',
    latitude: 35.2326,
    longitude: 139.1070,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 90,
    estimatedCostPerPerson: 18,
    keyAttractions: [
      "Lac Ashi",
      "Bateau pirate sur le lac",
      "Onsen (sources chaudes)",
      "Vallée d'Owakudani (volcanique)",
      "Musée en plein air"
    ],
    tags: ['nature', 'wellness', 'culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'tokyo'
  },
  {
    name: 'Enoshima',
    description: 'Île côtière avec sanctuaire, grottes marines et aquarium',
    destination: 'Enoshima',
    latitude: 35.3005,
    longitude: 139.4799,
    distanceKm: 60,
    transportMode: 'train',
    transportDurationMin: 50,
    estimatedCostPerPerson: 6,
    keyAttractions: [
      "Sanctuaire Enoshima",
      "Grottes marines",
      "Jardin Samuel Cocking",
      "Phare et vue panoramique",
      "Plages"
    ],
    tags: ['nature', 'beach', 'culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'tokyo'
  },

  // ============================================
  // LONDON (7 day trips)
  // ============================================
  {
    name: 'Stonehenge et Salisbury',
    description: 'Site préhistorique mystérieux et cathédrale médiévale',
    destination: 'Stonehenge',
    latitude: 51.1789,
    longitude: -1.8262,
    distanceKm: 140,
    transportMode: 'bus',
    transportDurationMin: 150,
    estimatedCostPerPerson: 30,
    keyAttractions: [
      "Cercle mégalithique de Stonehenge",
      "Centre des visiteurs",
      "Cathédrale de Salisbury",
      "Magna Carta"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    bookingRequired: true,
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },
  {
    name: 'Bath',
    description: 'Ville géorgienne élégante avec thermes romains classés UNESCO',
    destination: 'Bath',
    latitude: 51.3811,
    longitude: -2.3590,
    distanceKm: 160,
    transportMode: 'train',
    transportDurationMin: 90,
    estimatedCostPerPerson: 25,
    keyAttractions: [
      "Thermes romains",
      "Royal Crescent",
      "Abbaye de Bath",
      "Pulteney Bridge",
      "Thermae Bath Spa (moderne)"
    ],
    tags: ['culture', 'wellness'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },
  {
    name: 'Château de Windsor',
    description: 'Résidence royale fortifiée, plus ancien château habité au monde',
    destination: 'Windsor',
    latitude: 51.4839,
    longitude: -0.6044,
    distanceKm: 35,
    transportMode: 'train',
    transportDurationMin: 50,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Château de Windsor",
      "Chapelle St George",
      "State Apartments",
      "Eton College (à proximité)",
      "Windsor Great Park"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bookingRequired: true,
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },
  {
    name: 'Oxford',
    description: 'Ville universitaire historique avec collèges médiévaux et bibliothèques',
    destination: 'Oxford',
    latitude: 51.7520,
    longitude: -1.2577,
    distanceKm: 90,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 20,
    keyAttractions: [
      "Collèges d'Oxford (Christ Church, Bodleian)",
      "Radcliffe Camera",
      "Ashmolean Museum",
      "Jardin botanique",
      "Lieux de tournage Harry Potter"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },
  {
    name: 'Cambridge',
    description: 'Ville universitaire pittoresque avec colleges sur la rivière Cam',
    destination: 'Cambridge',
    latitude: 52.2053,
    longitude: 0.1218,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 18,
    keyAttractions: [
      "King's College Chapel",
      "Trinity College",
      "Punting sur la Cam",
      "Bibliothèque Wren",
      "Backs (jardins au bord de l'eau)"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },
  {
    name: 'Cotswolds',
    description: 'Villages pittoresques anglais avec cottages en pierre dorée',
    destination: 'Cotswolds',
    latitude: 51.8330,
    longitude: -1.7833,
    distanceKm: 150,
    transportMode: 'bus',
    transportDurationMin: 120,
    estimatedCostPerPerson: 20,
    keyAttractions: [
      "Bibury (Arlington Row)",
      "Bourton-on-the-Water",
      "Stow-on-the-Wold",
      "Castle Combe",
      "Sentiers de randonnée"
    ],
    tags: ['nature', 'culture'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Location de voiture recommandée pour explorer plusieurs villages.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },
  {
    name: 'Brighton',
    description: 'Station balnéaire animée avec pier victorien et quartier bohème',
    destination: 'Brighton',
    latitude: 50.8225,
    longitude: -0.1372,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Brighton Pier",
      "Royal Pavilion",
      "The Lanes (quartier historique)",
      "Plage et front de mer",
      "British Airways i360"
    ],
    tags: ['beach', 'culture', 'nightlife'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'london'
  },

  // ============================================
  // BARCELONA (5 day trips)
  // ============================================
  {
    name: 'Montserrat',
    description: 'Montagne sacrée avec monastère bénédictin et formations rocheuses spectaculaires',
    destination: 'Montserrat',
    latitude: 41.5934,
    longitude: 1.8370,
    distanceKm: 50,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Basilique de Montserrat",
      "Vierge noire (La Moreneta)",
      "Funiculaires panoramiques",
      "Sentiers de randonnée",
      "Musée de Montserrat"
    ],
    tags: ['nature', 'culture', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'barcelona'
  },
  {
    name: 'Girona',
    description: 'Ville médiévale catalane avec murailles, cathédrale et quartier juif',
    destination: 'Girona',
    latitude: 41.9794,
    longitude: 2.8214,
    distanceKm: 100,
    transportMode: 'train',
    transportDurationMin: 40,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Quartier juif (Call)",
      "Cathédrale de Girona",
      "Murailles médiévales",
      "Maisons colorées sur l'Onyar",
      "Lieux Game of Thrones"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'barcelona'
  },
  {
    name: 'Figueres et Musée Dalí',
    description: 'Musée surréaliste de Salvador Dalí dans sa ville natale',
    destination: 'Figueres',
    latitude: 42.2667,
    longitude: 2.9618,
    distanceKm: 140,
    transportMode: 'train',
    transportDurationMin: 55,
    estimatedCostPerPerson: 14,
    keyAttractions: [
      "Théâtre-Musée Dalí",
      "Château de Púbol (Gala Dalí)",
      "Vieille ville de Figueres",
      "Forteresse Sant Ferran"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bookingRequired: true,
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'barcelona'
  },
  {
    name: 'Sitges',
    description: 'Station balnéaire charmante avec plages, festivals et vie nocturne',
    destination: 'Sitges',
    latitude: 41.2353,
    longitude: 1.8120,
    distanceKm: 40,
    transportMode: 'train',
    transportDurationMin: 35,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Plages de Sitges",
      "Vieille ville",
      "Église Sant Bartomeu",
      "Promenade maritime",
      "Musée Cau Ferrat"
    ],
    tags: ['beach', 'culture', 'nightlife'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'barcelona'
  },
  {
    name: 'Tarragone',
    description: 'Ville romaine classée UNESCO avec amphithéâtre et aqueduc antiques',
    destination: 'Tarragona',
    latitude: 41.1189,
    longitude: 1.2445,
    distanceKm: 100,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Amphithéâtre romain",
      "Aqueduc de les Ferreres",
      "Murailles romaines",
      "Cathédrale",
      "Balcon de la Méditerranée"
    ],
    tags: ['culture', 'beach'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'barcelona'
  },

  // ============================================
  // MADRID (5 day trips)
  // ============================================
  {
    name: 'Tolède',
    description: 'Ville impériale médiévale sur trois cultures (chrétienne, juive, musulmane)',
    destination: 'Toledo',
    latitude: 39.8628,
    longitude: -4.0273,
    distanceKm: 70,
    transportMode: 'train',
    transportDurationMin: 30,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Cathédrale Sainte-Marie",
      "Alcázar de Tolède",
      "Synagogue Santa María la Blanca",
      "Mosquée Cristo de la Luz",
      "Vieille ville médiévale"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'madrid'
  },
  {
    name: 'Ségovie',
    description: 'Ville romaine avec aqueduc spectaculaire et château de conte de fées',
    destination: 'Segovia',
    latitude: 40.9429,
    longitude: -4.1088,
    distanceKm: 90,
    transportMode: 'train',
    transportDurationMin: 30,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Aqueduc romain",
      "Alcázar (château)",
      "Cathédrale",
      "Vieille ville",
      "Cochinillo (spécialité gastronomique)"
    ],
    tags: ['culture', 'gastronomy'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'madrid'
  },
  {
    name: 'El Escorial',
    description: 'Monastère royal monumental de Philippe II, résidence et panthéon',
    destination: 'San Lorenzo de El Escorial',
    latitude: 40.5893,
    longitude: -4.1476,
    distanceKm: 50,
    transportMode: 'train',
    transportDurationMin: 55,
    estimatedCostPerPerson: 6,
    keyAttractions: [
      "Monastère El Escorial",
      "Bibliothèque royale",
      "Panthéon des Rois",
      "Jardins",
      "Valle de los Caídos (controversé)"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'madrid'
  },
  {
    name: 'Avila',
    description: 'Ville fortifiée médiévale avec murailles complètes et patrimoine de Sainte Thérèse',
    destination: 'Avila',
    latitude: 40.6567,
    longitude: -4.6818,
    distanceKm: 110,
    transportMode: 'train',
    transportDurationMin: 90,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Murailles médiévales (les mieux préservées d'Europe)",
      "Cathédrale d'Avila",
      "Couvent Sainte-Thérèse",
      "Basilique San Vicente",
      "Vieille ville"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'madrid'
  },
  {
    name: 'Aranjuez',
    description: 'Palais royal et jardins royaux classés UNESCO',
    destination: 'Aranjuez',
    latitude: 40.0333,
    longitude: -3.6025,
    distanceKm: 50,
    transportMode: 'train',
    transportDurationMin: 45,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Palais Royal d'Aranjuez",
      "Jardin de l'île",
      "Jardin du Prince",
      "Casa del Labrador",
      "Train de la fraise (touristique)"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'madrid'
  },

  // ============================================
  // AMSTERDAM (5 day trips)
  // ============================================
  {
    name: 'Zaanse Schans',
    description: 'Village traditionnel avec moulins à vent, maisons vertes et artisanat',
    destination: 'Zaanse Schans',
    latitude: 52.4737,
    longitude: 4.7730,
    distanceKm: 17,
    transportMode: 'bus',
    transportDurationMin: 40,
    estimatedCostPerPerson: 3,
    keyAttractions: [
      "Moulins à vent historiques",
      "Fabrique de fromage",
      "Saboterie traditionnelle",
      "Maisons vertes hollandaises",
      "Musée Zaans"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: false,
    fromCity: 'amsterdam'
  },
  {
    name: 'Keukenhof',
    description: 'Jardin floral spectaculaire avec millions de tulipes (saisonnier)',
    destination: 'Lisse',
    latitude: 52.2697,
    longitude: 4.5462,
    distanceKm: 40,
    transportMode: 'bus',
    transportDurationMin: 60,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "7 millions de tulipes",
      "Jardins thématiques",
      "Pavillons floraux",
      "Moulins à vent",
      "Champs de fleurs environnants"
    ],
    tags: ['nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bestSeason: "March-May",
    bookingRequired: true,
    notes: "Ouvert uniquement mars à mai (8 semaines). Billetterie en ligne obligatoire.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'amsterdam'
  },
  {
    name: 'Delft',
    description: 'Ville historique charmante avec canaux, faïencerie bleue et patrimoine royal',
    destination: 'Delft',
    latitude: 52.0116,
    longitude: 4.3571,
    distanceKm: 60,
    transportMode: 'train',
    transportDurationMin: 15,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Vieille église (Oude Kerk)",
      "Nouvelle église (Nieuwe Kerk)",
      "Faïencerie Delft (Royal Delft)",
      "Canaux historiques",
      "Marché de la place"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'amsterdam'
  },
  {
    name: 'Haarlem',
    description: 'Ville médiévale élégante avec architecture dorée et musées',
    destination: 'Haarlem',
    latitude: 52.3874,
    longitude: 4.6462,
    distanceKm: 20,
    transportMode: 'train',
    transportDurationMin: 15,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Grande Place (Grote Markt)",
      "Église Saint-Bavon",
      "Musée Frans Hals",
      "Moulin De Adriaan",
      "Ruelles médiévales"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: false,
    fromCity: 'amsterdam'
  },
  {
    name: 'Utrecht',
    description: 'Ville universitaire avec canaux à double niveau et tour Dom',
    destination: 'Utrecht',
    latitude: 52.0907,
    longitude: 5.1214,
    distanceKm: 40,
    transportMode: 'train',
    transportDurationMin: 25,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Tour Dom (plus haute des Pays-Bas)",
      "Canaux Oudegracht",
      "Caves à quai (werfkelders)",
      "Musée Centraal",
      "Quartier des musées"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'amsterdam'
  },

  // ============================================
  // FLORENCE (5 day trips)
  // ============================================
  {
    name: 'Sienne',
    description: 'Ville médiévale toscane avec Piazza del Campo et Palio',
    destination: 'Siena',
    latitude: 43.3188,
    longitude: 11.3308,
    distanceKm: 70,
    transportMode: 'bus',
    transportDurationMin: 75,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Piazza del Campo",
      "Duomo de Sienne",
      "Torre del Mangia",
      "Palazzo Pubblico",
      "Rues médiévales"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'florence'
  },
  {
    name: 'San Gimignano',
    description: 'Village médiéval aux tours emblématiques, surnommé Manhattan du Moyen-Âge',
    destination: 'San Gimignano',
    latitude: 43.4677,
    longitude: 11.0437,
    distanceKm: 55,
    transportMode: 'bus',
    transportDurationMin: 90,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "14 tours médiévales",
      "Piazza della Cisterna",
      "Duomo (cathédrale)",
      "Gelato Dondoli (champion du monde)",
      "Vignobles Vernaccia"
    ],
    tags: ['culture', 'gastronomy'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'florence'
  },
  {
    name: 'Pise',
    description: 'Ville universitaire célèbre pour sa tour penchée et Piazza dei Miracoli',
    destination: 'Pisa',
    latitude: 43.7228,
    longitude: 10.4017,
    distanceKm: 85,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Tour de Pise",
      "Cathédrale de Pise",
      "Baptistère",
      "Camposanto Monumentale",
      "Piazza dei Cavalieri"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bookingRequired: true,
    notes: "Réservation recommandée pour monter dans la tour.",
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'florence'
  },
  {
    name: 'Cinque Terre',
    description: 'Cinq villages colorés accrochés aux falaises de la Riviera ligure',
    destination: 'Cinque Terre',
    latitude: 44.1461,
    longitude: 9.6442,
    distanceKm: 230,
    transportMode: 'train',
    transportDurationMin: 150,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Villages de Monterosso, Vernazza, Corniglia, Manarola, Riomaggiore",
      "Sentiers côtiers panoramiques",
      "Plages",
      "Vignobles en terrasses",
      "Via dell'Amore"
    ],
    tags: ['nature', 'beach', 'adventure'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Journée complète nécessaire. Carte Cinque Terre Card recommandée.",
    minDays: 5,
    fullDayRequired: true,
    fromCity: 'florence'
  },
  {
    name: 'Lucques',
    description: 'Ville toscane fortifiée avec murailles Renaissance intactes',
    destination: 'Lucca',
    latitude: 43.8430,
    longitude: 10.5027,
    distanceKm: 75,
    transportMode: 'train',
    transportDurationMin: 80,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Murailles Renaissance (4km à vélo)",
      "Tour Guinigi (arbres sur le toit)",
      "Cathédrale San Martino",
      "Piazza Anfiteatro (ancienne arène)",
      "Maison de Puccini"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'florence'
  },

  // ============================================
  // NAPLES (5 day trips)
  // ============================================
  {
    name: 'Pompéi depuis Naples',
    description: 'Cité romaine pétrifiée par l\'éruption du Vésuve en 79 ap. J-C',
    destination: 'Pompei',
    latitude: 40.7511,
    longitude: 14.4869,
    distanceKm: 25,
    transportMode: 'train',
    transportDurationMin: 35,
    estimatedCostPerPerson: 4,
    keyAttractions: [
      "Site archéologique de Pompéi",
      "Maison du Faune",
      "Amphithéâtre",
      "Thermes",
      "Fresques préservées"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'naples'
  },
  {
    name: 'Île de Capri',
    description: 'Île paradisiaque avec Grotte Bleue, jardins d\'Auguste et Piazzetta',
    destination: 'Capri',
    latitude: 40.5510,
    longitude: 14.2224,
    distanceKm: 30,
    transportMode: 'ferry',
    transportDurationMin: 60,
    estimatedCostPerPerson: 25,
    keyAttractions: [
      "Grotte Bleue",
      "Jardins d'Auguste",
      "Anacapri et Monte Solaro",
      "Piazzetta de Capri",
      "Arche naturelle Faraglioni"
    ],
    tags: ['nature', 'beach', 'culture'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'comfort',
    notes: "Très touristique en été. Grotte Bleue fermée si mer agitée.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'naples'
  },
  {
    name: 'Côte Amalfitaine',
    description: 'Route panoramique spectaculaire avec villages perchés et falaises',
    destination: 'Amalfi',
    latitude: 40.6340,
    longitude: 14.6027,
    distanceKm: 60,
    transportMode: 'bus',
    transportDurationMin: 90,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Positano (village coloré)",
      "Amalfi et sa cathédrale",
      "Ravello et Villa Rufolo",
      "Route panoramique SS163",
      "Plages"
    ],
    tags: ['nature', 'beach', 'culture'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Route sinueuse. Considérer le mal de mer sur le ferry.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'naples'
  },
  {
    name: 'Île d\'Ischia',
    description: 'Île thermale avec sources chaudes, plages et jardins luxuriants',
    destination: 'Ischia',
    latitude: 40.7313,
    longitude: 13.9013,
    distanceKm: 35,
    transportMode: 'ferry',
    transportDurationMin: 60,
    estimatedCostPerPerson: 20,
    keyAttractions: [
      "Jardins La Mortella",
      "Château Aragonais",
      "Sources thermales naturelles",
      "Plage de Maronti",
      "Villages de Sant'Angelo et Forio"
    ],
    tags: ['nature', 'wellness', 'beach'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'naples'
  },
  {
    name: 'Palais Royal de Caserte',
    description: 'Versailles italien avec palais baroque monumental et jardins à cascades',
    destination: 'Caserta',
    latitude: 41.0724,
    longitude: 14.3267,
    distanceKm: 30,
    transportMode: 'train',
    transportDurationMin: 35,
    estimatedCostPerPerson: 4,
    keyAttractions: [
      "Palais Royal de Caserte (1200 pièces)",
      "Jardins et grandes cascades",
      "Jardin anglais",
      "Appartements royaux",
      "Site Star Wars (Naboo)"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'naples'
  },

  // ============================================
  // ISTANBUL (2 day trips)
  // ============================================
  {
    name: 'Îles des Princes',
    description: 'Archipel paisible sans voitures avec maisons ottomanes et balades en calèche',
    destination: 'Büyükada',
    latitude: 40.8608,
    longitude: 29.0971,
    distanceKm: 20,
    transportMode: 'ferry',
    transportDurationMin: 90,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Büyükada (grande île)",
      "Balades en calèche ou vélo",
      "Monastère Saint-Georges",
      "Maisons victoriennes",
      "Plages et criques"
    ],
    tags: ['nature', 'culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'istanbul'
  },
  {
    name: 'Bursa',
    description: 'Première capitale ottomane avec mosquées historiques et station de ski Uludağ',
    destination: 'Bursa',
    latitude: 40.1826,
    longitude: 29.0665,
    distanceKm: 150,
    transportMode: 'ferry',
    transportDurationMin: 150,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Grande Mosquée (Ulu Camii)",
      "Mosquée Verte",
      "Bazar de la soie",
      "Téléphérique Uludağ",
      "Bains ottomans"
    ],
    tags: ['culture', 'nature', 'wellness'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 5,
    fullDayRequired: true,
    fromCity: 'istanbul'
  },

  // ============================================
  // ATHENS (5 day trips)
  // ============================================
  {
    name: 'Delphes',
    description: 'Site archéologique sacré avec oracle d\'Apollon et théâtre antique',
    destination: 'Delphes',
    latitude: 38.4824,
    longitude: 22.5010,
    distanceKm: 180,
    transportMode: 'bus',
    transportDurationMin: 180,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Sanctuaire d'Apollon",
      "Théâtre antique",
      "Trésor des Athéniens",
      "Musée archéologique",
      "Vue sur le golfe de Corinthe"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Journée complète recommandée. Site en altitude (fraîcheur bienvenue en été).",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'athens'
  },
  {
    name: 'Cap Sounion',
    description: 'Temple de Poséidon perché sur falaise avec coucher de soleil spectaculaire',
    destination: 'Sounion',
    latitude: 37.6503,
    longitude: 24.0246,
    distanceKm: 70,
    transportMode: 'bus',
    transportDurationMin: 90,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Temple de Poséidon",
      "Falaises sur la mer Égée",
      "Coucher de soleil légendaire",
      "Plages en route",
      "Baie de Sounion"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Idéal en fin d'après-midi pour le coucher de soleil.",
    minDays: 3,
    fullDayRequired: false,
    fromCity: 'athens'
  },
  {
    name: 'Île d\'Hydra',
    description: 'Île pittoresque sans voitures avec architecture préservée et ânes',
    destination: 'Hydra',
    latitude: 37.3500,
    longitude: 23.4667,
    distanceKm: 65,
    transportMode: 'ferry',
    transportDurationMin: 90,
    estimatedCostPerPerson: 30,
    keyAttractions: [
      "Port d'Hydra (architecture)",
      "Ânes pour le transport",
      "Monastères",
      "Criques et plages",
      "Maisons de capitaines"
    ],
    tags: ['nature', 'beach', 'culture'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'athens'
  },
  {
    name: 'Île d\'Égine',
    description: 'Île proche avec temple d\'Aphaia, pistaches et plages',
    destination: 'Egine',
    latitude: 37.7506,
    longitude: 23.4274,
    distanceKm: 45,
    transportMode: 'ferry',
    transportDurationMin: 45,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Temple d'Aphaia",
      "Ville d'Égine",
      "Monastère Agios Nectarios",
      "Pistaches d'Égine",
      "Plages"
    ],
    tags: ['culture', 'beach', 'gastronomy'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'athens'
  },
  {
    name: 'Nauplie',
    description: 'Première capitale grecque avec forteresse vénitienne et vieille ville charmante',
    destination: 'Nauplie',
    latitude: 37.5673,
    longitude: 22.8015,
    distanceKm: 140,
    transportMode: 'bus',
    transportDurationMin: 120,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Forteresse Palamède",
      "Château Bourtzi (sur îlot)",
      "Vieille ville",
      "Théâtre antique d'Épidaure (à proximité)",
      "Plages"
    ],
    tags: ['culture', 'beach'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Possibilité de combiner avec Épidaure et Mycènes.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'athens'
  },

  // ============================================
  // MARRAKECH (4 day trips)
  // ============================================
  {
    name: 'Cascades d\'Ouzoud',
    description: 'Cascades spectaculaires de 110m avec singes berbères et piscines naturelles',
    destination: 'Ouzoud',
    latitude: 32.0153,
    longitude: -6.7158,
    distanceKm: 150,
    transportMode: 'car',
    transportDurationMin: 150,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Chutes d'Ouzoud (110m)",
      "Singes macaques",
      "Piscines naturelles",
      "Arc-en-ciel sur les cascades",
      "Villages berbères"
    ],
    tags: ['nature', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'marrakech'
  },
  {
    name: 'Essaouira',
    description: 'Port fortifié atlantique avec médina bleue et blanche, surf et fruits de mer',
    destination: 'Essaouira',
    latitude: 31.5085,
    longitude: -9.7595,
    distanceKm: 180,
    transportMode: 'bus',
    transportDurationMin: 180,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Médina fortifiée",
      "Remparts et canons portugais",
      "Port de pêche",
      "Plage et sports nautiques",
      "Galeries d'art"
    ],
    tags: ['culture', 'beach', 'gastronomy'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Ville plus fraîche et venteuse. Idéale en été pour échapper à la chaleur de Marrakech.",
    minDays: 5,
    fullDayRequired: true,
    fromCity: 'marrakech'
  },
  {
    name: 'Désert d\'Agafay',
    description: 'Désert de pierres proche de Marrakech avec dunes, dîner berbère et étoiles',
    destination: 'Agafay',
    latitude: 31.4978,
    longitude: -8.2508,
    distanceKm: 40,
    transportMode: 'car',
    transportDurationMin: 45,
    estimatedCostPerPerson: 30,
    keyAttractions: [
      "Paysages désertiques",
      "Balades à dos de chameau",
      "Dîner berbère sous tente",
      "Observation des étoiles",
      "Quad ou buggy (optionnel)"
    ],
    tags: ['nature', 'adventure', 'gastronomy'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Souvent vendu en package avec transport + repas.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'marrakech'
  },
  {
    name: 'Vallée de l\'Ourika',
    description: 'Vallée verdoyante berbère avec cascades, villages et vues sur l\'Atlas',
    destination: 'Ourika',
    latitude: 31.3627,
    longitude: -7.8489,
    distanceKm: 60,
    transportMode: 'car',
    transportDurationMin: 60,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Cascades de Setti Fatma",
      "Villages berbères",
      "Montagnes de l'Atlas",
      "Jardins bio safran",
      "Marchés locaux (lundi)"
    ],
    tags: ['nature', 'culture', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bestSeason: "Spring-Fall",
    notes: "Plus frais que Marrakech. Apporter chaussures de randonnée pour les cascades.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'marrakech'
  },

  // ============================================
  // BALI (4 day trips)
  // ============================================
  {
    name: 'Ubud',
    description: 'Centre culturel de Bali avec forêt des singes, rizières et temples',
    destination: 'Ubud',
    latitude: -8.5069,
    longitude: 115.2625,
    distanceKm: 30,
    transportMode: 'car',
    transportDurationMin: 75,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Forêt des Singes",
      "Rizières en terrasses de Tegallalang",
      "Palais Royal d'Ubud",
      "Marchés d'artisanat",
      "Temples et danses balinaises"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'bali'
  },
  {
    name: 'Temple de Besakih',
    description: 'Plus grand temple hindou de Bali sur les pentes du Mont Agung',
    destination: 'Besakih',
    latitude: -8.3742,
    longitude: 115.4536,
    distanceKm: 60,
    transportMode: 'car',
    transportDurationMin: 120,
    estimatedCostPerPerson: 12,
    keyAttractions: [
      "Pura Besakih (mère des temples)",
      "Vue sur Mont Agung",
      "Complexe de 23 temples",
      "Rizières en route",
      "Villages traditionnels"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Tenue respectueuse requise (sarong). Guides locaux insistants.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'bali'
  },
  {
    name: 'Nusa Penida',
    description: 'Île sauvage avec falaises spectaculaires, plages paradisiaques et raies manta',
    destination: 'Nusa Penida',
    latitude: -8.7275,
    longitude: 115.5444,
    distanceKm: 20,
    transportMode: 'ferry',
    transportDurationMin: 45,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Kelingking Beach (T-Rex)",
      "Angel's Billabong",
      "Broken Beach",
      "Snorkeling avec raies manta",
      "Crystal Bay"
    ],
    tags: ['nature', 'beach', 'adventure'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Routes difficiles. Location scooter ou driver recommandé. Mer parfois agitée.",
    minDays: 5,
    fullDayRequired: true,
    fromCity: 'bali'
  },
  {
    name: 'Uluwatu',
    description: 'Temple sur falaise au-dessus de l\'océan avec danse Kecak au coucher du soleil',
    destination: 'Uluwatu',
    latitude: -8.8291,
    longitude: 115.0849,
    distanceKm: 25,
    transportMode: 'car',
    transportDurationMin: 60,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Temple Uluwatu (sur falaise)",
      "Danse Kecak au coucher du soleil",
      "Singes (attention aux objets)",
      "Plages de surf (Padang Padang)",
      "Restaurants de fruits de mer Jimbaran"
    ],
    tags: ['culture', 'nature', 'beach'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Réserver spectacle Kecak à l'avance. Attention aux singes voleurs.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'bali'
  },

  // ============================================
  // REYKJAVIK (4 day trips)
  // ============================================
  {
    name: 'Cercle d\'Or',
    description: 'Circuit classique avec geysers, cascades et parc national historique',
    destination: 'Golden Circle',
    latitude: 64.3271,
    longitude: -20.1199,
    distanceKm: 300,
    transportMode: 'car',
    transportDurationMin: 300,
    estimatedCostPerPerson: 25,
    keyAttractions: [
      "Parc national Thingvellir (UNESCO)",
      "Geyser Strokkur",
      "Cascade Gullfoss",
      "Cratère Kerið",
      "Ferme de tomates géothermique"
    ],
    tags: ['nature', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Circuit de 6-8h. Location voiture ou tour organisé.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'reykjavik'
  },
  {
    name: 'Blue Lagoon',
    description: 'Spa géothermique iconique avec eaux bleues laiteuses et masques de silice',
    destination: 'Blue Lagoon',
    latitude: 63.8803,
    longitude: -22.4495,
    distanceKm: 50,
    transportMode: 'bus',
    transportDurationMin: 50,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Lagune géothermique",
      "Masques de silice",
      "Bar dans l'eau",
      "Sauna et vapeur",
      "Paysage de lave"
    ],
    tags: ['wellness', 'nature'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'comfort',
    bookingRequired: true,
    notes: "Entrée ~70-100€. Réservation obligatoire à l'avance.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'reykjavik'
  },
  {
    name: 'Vík et Reynisfjara',
    description: 'Village côtier avec plage de sable noir, colonnes de basalte et falaises',
    destination: 'Vík',
    latitude: 63.4186,
    longitude: -19.0060,
    distanceKm: 180,
    transportMode: 'car',
    transportDurationMin: 180,
    estimatedCostPerPerson: 20,
    keyAttractions: [
      "Plage Reynisfjara (sable noir)",
      "Colonnes de basalte",
      "Stacks Reynisdrangar",
      "Cascade Skógafoss",
      "Cascade Seljalandsfoss"
    ],
    tags: ['nature', 'adventure'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Attention aux vagues traîtres à Reynisfjara. Journée complète recommandée.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'reykjavik'
  },
  {
    name: 'Presqu\'île de Snæfellsnes',
    description: 'Islande en miniature avec glacier, falaises, phoque et villages de pêcheurs',
    destination: 'Snaefellsnes',
    latitude: 64.7369,
    longitude: -23.7811,
    distanceKm: 180,
    transportMode: 'car',
    transportDurationMin: 180,
    estimatedCostPerPerson: 20,
    keyAttractions: [
      "Glacier Snæfellsjökull",
      "Kirkjufell (montagne emblématique)",
      "Villages Arnarstapi et Hellnar",
      "Colonies de phoques",
      "Plages et falaises"
    ],
    tags: ['nature', 'adventure'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    notes: "Journée complète. Météo changeante. Location 4x4 recommandée en hiver.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'reykjavik'
  },

  // ============================================
  // PRAGUE (3 day trips)
  // ============================================
  {
    name: 'Kutná Hora',
    description: 'Ville minière médiévale avec ossuaire décoré de 40000 squelettes',
    destination: 'Kutna Hora',
    latitude: 49.9481,
    longitude: 15.2681,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Ossuaire de Sedlec (église des os)",
      "Cathédrale Sainte-Barbe",
      "Centre historique UNESCO",
      "Musée de l'argent",
      "Cour italienne (ancienne monnaie)"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'prague'
  },
  {
    name: 'Český Krumlov',
    description: 'Village médiéval de conte de fées avec château et rivière Vltava',
    destination: 'Cesky Krumlov',
    latitude: 48.8127,
    longitude: 14.3175,
    distanceKm: 180,
    transportMode: 'bus',
    transportDurationMin: 180,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Château de Český Krumlov",
      "Vieille ville baroque UNESCO",
      "Tour du château (vue panoramique)",
      "Méandres de la Vltava",
      "Rafting et canoë"
    ],
    tags: ['culture', 'nature', 'adventure'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Très touristique en été. Envisager nuit sur place.",
    minDays: 5,
    fullDayRequired: true,
    fromCity: 'prague'
  },
  {
    name: 'Karlštejn',
    description: 'Château gothique sur colline, construit par Charles IV pour les joyaux royaux',
    destination: 'Karlstejn',
    latitude: 49.9390,
    longitude: 14.1882,
    distanceKm: 30,
    transportMode: 'train',
    transportDurationMin: 40,
    estimatedCostPerPerson: 4,
    keyAttractions: [
      "Château de Karlštejn",
      "Chapelle Sainte-Croix",
      "Randonnée depuis le village",
      "Vue panoramique",
      "Caves à vin locales"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bookingRequired: true,
    notes: "Visite guidée obligatoire. Réserver en ligne.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'prague'
  },

  // ============================================
  // LISBON (4 day trips)
  // ============================================
  {
    name: 'Sintra',
    description: 'Ville romantique avec palais colorés, châteaux mauresques et jardins luxuriants',
    destination: 'Sintra',
    latitude: 38.7975,
    longitude: -9.3907,
    distanceKm: 30,
    transportMode: 'train',
    transportDurationMin: 40,
    estimatedCostPerPerson: 4,
    keyAttractions: [
      "Palais de Pena (coloré)",
      "Château des Maures",
      "Quinta da Regaleira (jardins initiatiques)",
      "Palais de Monserrate",
      "Centre historique"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bookingRequired: true,
    notes: "Réserver billets Pena à l'avance. Bus touristique 434 pratique entre sites.",
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'lisbon'
  },
  {
    name: 'Cascais',
    description: 'Station balnéaire élégante avec plages, marina et promenade côtière',
    destination: 'Cascais',
    latitude: 38.6969,
    longitude: -9.4217,
    distanceKm: 30,
    transportMode: 'train',
    transportDurationMin: 40,
    estimatedCostPerPerson: 4,
    keyAttractions: [
      "Promenade côtière",
      "Boca do Inferno (falaises)",
      "Plages (Praia da Rainha)",
      "Centre historique",
      "Marina et restaurants"
    ],
    tags: ['beach', 'nature', 'culture'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Possibilité de combiner avec Sintra ou Cabo da Roca.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'lisbon'
  },
  {
    name: 'Óbidos',
    description: 'Village médiéval fortifié pittoresque avec château et ginja (liqueur locale)',
    destination: 'Obidos',
    latitude: 39.3626,
    longitude: -9.1571,
    distanceKm: 85,
    transportMode: 'bus',
    transportDurationMin: 75,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Murailles médiévales (balade)",
      "Château d'Óbidos",
      "Rues pavées fleuries",
      "Ginja dans tasse chocolat",
      "Librairie dans église"
    ],
    tags: ['culture', 'gastronomy'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'lisbon'
  },
  {
    name: 'Parc Naturel d\'Arrábida',
    description: 'Parc côtier avec falaises, plages sauvages et vignobles',
    destination: 'Arrabida',
    latitude: 38.4870,
    longitude: -8.9796,
    distanceKm: 50,
    transportMode: 'car',
    transportDurationMin: 45,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Plage de Galapinhos",
      "Couvent d'Arrábida",
      "Route panoramique N379-1",
      "Villages de Sesimbra et Setúbal",
      "Dégustation vins Moscatel"
    ],
    tags: ['nature', 'beach', 'gastronomy'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Location voiture recommandée. Combiner avec Setúbal pour fruits de mer.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'lisbon'
  },

  // ============================================
  // VIENNA (2 day trips)
  // ============================================
  {
    name: 'Vallée de Wachau',
    description: 'Vallée du Danube avec vignobles en terrasses, abbayes et villages médiévaux',
    destination: 'Wachau',
    latitude: 48.3667,
    longitude: 15.4167,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 70,
    estimatedCostPerPerson: 15,
    keyAttractions: [
      "Abbaye de Melk",
      "Dürnstein (village bleu)",
      "Croisière sur le Danube",
      "Vignobles Riesling",
      "Villages de Krems et Spitz"
    ],
    tags: ['nature', 'culture', 'gastronomy'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    bestSeason: "April-October",
    notes: "Très beau en automne pour les vignobles. Croisière Danube recommandée.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'vienna'
  },
  {
    name: 'Bratislava',
    description: 'Capitale slovaque proche avec château, vieille ville et Danube',
    destination: 'Bratislava',
    latitude: 48.1486,
    longitude: 17.1077,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 10,
    keyAttractions: [
      "Château de Bratislava",
      "Vieille ville",
      "Porte Saint-Michel",
      "Cathédrale Saint-Martin",
      "Statues humoristiques"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Possibilité de croisière Vienne-Bratislava sur le Danube (6h).",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'vienna'
  },

  // ============================================
  // BUDAPEST (3 day trips)
  // ============================================
  {
    name: 'Szentendre',
    description: 'Village d\'artistes au bord du Danube avec galeries, musées et architecture baroque',
    destination: 'Szentendre',
    latitude: 47.6696,
    longitude: 19.0762,
    distanceKm: 20,
    transportMode: 'train',
    transportDurationMin: 40,
    estimatedCostPerPerson: 3,
    keyAttractions: [
      "Vieille ville baroque",
      "Galeries d'art et artisanat",
      "Musée du Marzipan",
      "Église orthodoxe serbe",
      "Bord du Danube"
    ],
    tags: ['culture'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: false,
    fromCity: 'budapest'
  },
  {
    name: 'Esztergom',
    description: 'Ancienne capitale avec plus grande basilique de Hongrie et château royal',
    destination: 'Esztergom',
    latitude: 47.7936,
    longitude: 18.7405,
    distanceKm: 60,
    transportMode: 'train',
    transportDurationMin: 90,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Basilique d'Esztergom",
      "Château royal",
      "Vue sur le Danube",
      "Musée chrétien",
      "Pont vers Slovaquie"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'budapest'
  },
  {
    name: 'Visegrád',
    description: 'Forteresse royale sur colline avec vue panoramique sur le coude du Danube',
    destination: 'Visegrad',
    latitude: 47.7866,
    longitude: 18.9773,
    distanceKm: 40,
    transportMode: 'bus',
    transportDurationMin: 75,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Citadelle de Visegrád",
      "Palais royal renaissance",
      "Tour Salomon",
      "Vue sur le coude du Danube",
      "Spectacles médiévaux (été)"
    ],
    tags: ['culture', 'nature'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Possibilité de combiner avec Szentendre et Esztergom (coude du Danube).",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'budapest'
  },

  // ============================================
  // BANGKOK (3 day trips)
  // ============================================
  {
    name: 'Ayutthaya',
    description: 'Ancienne capitale du Siam avec temples en ruines classés UNESCO',
    destination: 'Ayutthaya',
    latitude: 14.3534,
    longitude: 100.5683,
    distanceKm: 80,
    transportMode: 'train',
    transportDurationMin: 90,
    estimatedCostPerPerson: 2,
    keyAttractions: [
      "Wat Mahathat (tête de Bouddha dans racines)",
      "Wat Phra Si Sanphet",
      "Wat Chaiwatthanaram",
      "Palais royal d'Ayutthaya",
      "Marchés flottants (à proximité)"
    ],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Location vélo sur place recommandée. Très chaud en journée.",
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'bangkok'
  },
  {
    name: 'Marchés Flottants',
    description: 'Marché traditionnel sur canaux avec vendeurs en barques (Damnoen Saduak)',
    destination: 'Damnoen Saduak',
    latitude: 13.5190,
    longitude: 99.9574,
    distanceKm: 100,
    transportMode: 'car',
    transportDurationMin: 90,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Marché flottant Damnoen Saduak",
      "Barques de vendeurs",
      "Nourriture thaïe authentique",
      "Artisanat local",
      "Tour en barque"
    ],
    tags: ['culture', 'gastronomy'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Arriver tôt (avant 9h) pour éviter les foules. Très touristique.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'bangkok'
  },
  {
    name: 'Kanchanaburi',
    description: 'Pont de la Rivière Kwai, cimetières de guerre et nature luxuriante',
    destination: 'Kanchanaburi',
    latitude: 14.0046,
    longitude: 99.5328,
    distanceKm: 130,
    transportMode: 'bus',
    transportDurationMin: 150,
    estimatedCostPerPerson: 5,
    keyAttractions: [
      "Pont de la Rivière Kwai",
      "Cimetière de guerre allié",
      "Musée JEATH",
      "Train sur Death Railway",
      "Cascades Erawan (parc national)"
    ],
    tags: ['culture', 'nature', 'adventure'],
    suitableFor: ['couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'economic',
    notes: "Combiner avec cascades Erawan pour journée complète. Histoire poignante WWII.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'bangkok'
  },

  // ============================================
  // SEOUL (3 day trips)
  // ============================================
  {
    name: 'Zone Démilitarisée (DMZ)',
    description: 'Frontière entre Corées avec tunnels, observatoires et village de la paix',
    destination: 'DMZ',
    latitude: 37.9534,
    longitude: 126.6802,
    distanceKm: 60,
    transportMode: 'bus',
    transportDurationMin: 90,
    estimatedCostPerPerson: 45,
    keyAttractions: [
      "3e tunnel d'infiltration",
      "Observatoire Dora",
      "Station Dorasan",
      "JSA Panmunjom (optionnel)",
      "Musée de la guerre"
    ],
    tags: ['culture', 'adventure'],
    suitableFor: ['solo', 'couple', 'friends', 'family_without_kids'],
    minBudgetLevel: 'moderate',
    bookingRequired: true,
    notes: "Réservation obligatoire via tours organisés. Passeport requis. Pas pour jeunes enfants.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'seoul'
  },
  {
    name: 'Suwon',
    description: 'Ville historique avec forteresse Hwaseong classée UNESCO',
    destination: 'Suwon',
    latitude: 37.2636,
    longitude: 127.0286,
    distanceKm: 45,
    transportMode: 'train',
    transportDurationMin: 30,
    estimatedCostPerPerson: 3,
    keyAttractions: [
      "Forteresse Hwaseong",
      "Palais Hwaseong Haenggung",
      "Spectacles militaires traditionnels",
      "Rue Paldalmun",
      "Galbi (côtes de bœuf marinées) spécialité"
    ],
    tags: ['culture', 'gastronomy'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'seoul'
  },
  {
    name: 'Île Nami',
    description: 'Île romantique en forme de demi-lune avec allées d\'arbres et nature',
    destination: 'Nami Island',
    latitude: 37.7909,
    longitude: 127.5254,
    distanceKm: 63,
    transportMode: 'bus',
    transportDurationMin: 90,
    estimatedCostPerPerson: 8,
    keyAttractions: [
      "Allées de métaséquoias",
      "Jardins thématiques",
      "Location vélo",
      "Cafés et restaurants",
      "Zip line d'accès (optionnel)"
    ],
    tags: ['nature', 'culture'],
    suitableFor: ['couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    bestSeason: "Autumn (foliage), Spring (blossoms)",
    notes: "Lieu de tournage K-dramas. Très populaire en automne.",
    minDays: 4,
    fullDayRequired: true,
    fromCity: 'seoul'
  },
];

// ============================================
// Main Suggestion Algorithm
// ============================================

/**
 * Suggests day trips for a given destination based on preferences.
 *
 * @param destination - Main destination city name
 * @param destCoords - Coordinates of the destination
 * @param preferences - Trip preferences (duration, group, budget, activities)
 * @returns Array of suitable day trip suggestions
 */
export function suggestDayTrips(
  destination: string,
  destCoords: { lat: number; lng: number },
  preferences: {
    durationDays: number;
    groupType: GroupType;
    budgetLevel: BudgetLevel;
    preferredActivities: ActivityType[];
    startDate?: Date;
    prePurchasedTickets?: Array<{ name: string; date?: string; notes?: string }>;
  }
): DayTripSuggestion[] {
  const normalizedDest = destination.toLowerCase().trim();

  // 1. Match by fromCity
  const destinationMatches = DAY_TRIP_DATABASE.filter((trip) => {
    return normalizedDest.includes(trip.fromCity) || trip.fromCity.includes(normalizedDest);
  });

  // If no curated matches, return empty (caller will use AI fallback)
  if (destinationMatches.length === 0) return [];

  // 2. Force pre-purchased tickets (bypass all filters)
  const forcedTrips: DayTripSuggestion[] = [];
  const tickets = preferences.prePurchasedTickets ?? [];
  for (const ticket of tickets) {
    const ticketName = ticket.name.toLowerCase();
    const match = destinationMatches.find(
      (t) => t.name.toLowerCase().includes(ticketName) || ticketName.includes(t.destination.toLowerCase())
    );
    if (match && !forcedTrips.includes(match)) {
      forcedTrips.push(match);
    }
  }

  // 3. Filter remaining by suitability
  const forcedIds = new Set(forcedTrips.map((t) => t.name));
  const suitable = destinationMatches.filter((trip) => {
    if (forcedIds.has(trip.name)) return false; // already forced

    // Check minDays
    if (preferences.durationDays < trip.minDays) return false;

    // Check group type
    if (!trip.suitableFor.includes(preferences.groupType)) return false;

    // Check budget level
    const budgetLevels: BudgetLevel[] = ['economic', 'moderate', 'comfort', 'luxury'];
    const userBudgetIndex = budgetLevels.indexOf(preferences.budgetLevel);
    const tripBudgetIndex = budgetLevels.indexOf(trip.minBudgetLevel);
    if (userBudgetIndex < tripBudgetIndex) return false;

    return true;
  });

  // 4. Score by activity preferences
  const scored = suitable.map((trip) => {
    let score = 0;
    // Match with preferred activities (+10 per matching tag)
    for (const tag of trip.tags) {
      if (preferences.preferredActivities.includes(tag)) score += 10;
    }
    // Popularity boost (more keyAttractions = more interesting)
    score += Math.min(trip.keyAttractions.length, 5) * 2;
    // Distance penalty (-1 per 10km)
    score -= Math.floor(trip.distanceKm / 10);
    // Prefer shorter transport for shorter trips
    if (preferences.durationDays <= 4 && trip.transportDurationMin <= 60) score += 5;
    return { trip, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // 5. Limit selection based on trip duration
  let maxDayTrips: number;
  if (preferences.durationDays <= 4) maxDayTrips = 1;
  else if (preferences.durationDays <= 7) maxDayTrips = 2;
  else maxDayTrips = 3;

  // Forced trips always included
  const selected = [...forcedTrips];
  const remaining = maxDayTrips - forcedTrips.length;
  if (remaining > 0) {
    selected.push(...scored.slice(0, remaining).map((s) => s.trip));
  }

  return selected;
}

// ============================================
// AI Fallback for Uncovered Destinations
// ============================================

/**
 * Generates day trip suggestions using Gemini AI for destinations not in the database.
 *
 * @param destination - Destination city name
 * @param destCoords - Coordinates of the destination
 * @param preferences - Trip preferences
 * @returns Array of AI-generated day trip suggestions
 */
export async function generateDayTripsWithAI(
  destination: string,
  destCoords: { lat: number; lng: number },
  preferences: {
    durationDays: number;
    groupType: string;
    budgetLevel: string;
    preferredActivities: string[];
  }
): Promise<DayTripSuggestion[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[Day Trips AI] No GOOGLE_AI_API_KEY — returning empty array');
    return [];
  }

  try {
    const prompt = `You are a travel expert. Generate 2-3 day trip suggestions from ${destination}.

REQUIREMENTS:
- Day trips should be within 200km from ${destination}
- Accessible by public transport (train/bus/ferry)
- Suitable for ${preferences.groupType} travelers
- Budget level: ${preferences.budgetLevel}
- Preferred activities: ${preferences.preferredActivities.join(', ')}

OUTPUT FORMAT - JSON array, no text before or after:
[
  {
    "name": "Day trip name",
    "description": "Brief description (1-2 sentences)",
    "destination": "City/location name",
    "latitude": 00.0000,
    "longitude": 00.0000,
    "distanceKm": 100,
    "transportMode": "train",
    "transportDurationMin": 90,
    "estimatedCostPerPerson": 15,
    "keyAttractions": ["Attraction 1", "Attraction 2", "Attraction 3"]
  }
]`;

    console.log('[Day Trips AI] Calling Gemini 2.0 Flash for day trip suggestions...');
    const startTime = Date.now();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Day Trips AI] Gemini API error: ${response.status} — ${errorText}`);
      return [];
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.warn('[Day Trips AI] No text in Gemini response');
      return [];
    }

    console.log(`[Day Trips AI] Gemini response received in ${durationMs}ms`);

    // Parse JSON response
    const rawTrips = JSON.parse(text);

    if (!Array.isArray(rawTrips)) {
      console.warn('[Day Trips AI] Response is not an array');
      return [];
    }

    // Enrich with default values and type-safe fields
    const enrichedTrips: DayTripSuggestion[] = rawTrips.map((trip) => ({
      name: trip.name || 'Unknown Day Trip',
      description: trip.description || '',
      destination: trip.destination || '',
      latitude: trip.latitude || destCoords.lat,
      longitude: trip.longitude || destCoords.lng,
      distanceKm: trip.distanceKm || 50,
      transportMode: trip.transportMode || 'bus',
      transportDurationMin: trip.transportDurationMin || 60,
      estimatedCostPerPerson: trip.estimatedCostPerPerson || 10,
      keyAttractions: trip.keyAttractions || [],
      tags: inferTagsFromAttractions(trip.keyAttractions || []),
      suitableFor: inferSuitableGroups(preferences.groupType as GroupType),
      minBudgetLevel: preferences.budgetLevel as BudgetLevel,
      notes: 'AI-generated suggestion. Verify details before booking.',
      minDays: trip.minDays || 3,
      fullDayRequired: trip.fullDayRequired ?? true,
      fromCity: destination.toLowerCase().trim(),
    }));

    return enrichedTrips;
  } catch (error) {
    console.error('[Day Trips AI] Error generating day trips:', error);
    return [];
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculates distance between two coordinates using Haversine formula.
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Infers activity tags from attraction names.
 */
function inferTagsFromAttractions(attractions: string[]): ActivityType[] {
  const tags = new Set<ActivityType>();
  const text = attractions.join(' ').toLowerCase();

  if (text.match(/museum|cathedral|palace|castle|temple|church|ruins/i)) {
    tags.add('culture');
  }
  if (text.match(/park|garden|mountain|waterfall|nature|forest|beach|island/i)) {
    tags.add('nature');
  }
  if (text.match(/hiking|trek|adventure|rafting|zip|climb/i)) {
    tags.add('adventure');
  }
  if (text.match(/beach|ocean|sea|coast/i)) {
    tags.add('beach');
  }
  if (text.match(/spa|thermal|hot spring|wellness/i)) {
    tags.add('wellness');
  }
  if (text.match(/food|restaurant|market|cuisine|wine/i)) {
    tags.add('gastronomy');
  }

  return Array.from(tags);
}

/**
 * Infers suitable group types based on user's group type.
 */
function inferSuitableGroups(groupType: GroupType): GroupType[] {
  // AI-generated trips default to all groups except family_with_kids (unless specified)
  if (groupType === 'family_with_kids') {
    return ['family_with_kids', 'family_without_kids'];
  }
  return ['solo', 'couple', 'friends', 'family_without_kids'];
}

/**
 * Service des attractions incontournables par destination
 *
 * Stratégie:
 * 1. Vérifier la base de données locale (attractions codées en dur)
 * 2. Si pas trouvé, utiliser Claude AI pour rechercher des attractions réelles
 * 3. Mettre en cache les résultats pour les prochaines requêtes
 */

import { ActivityType } from '../types';

export interface Attraction {
  id: string;
  name: string;
  type: ActivityType;
  description: string;
  duration: number; // en minutes
  estimatedCost: number; // en euros par personne
  latitude: number;
  longitude: number;
  rating: number;
  mustSee: boolean; // Incontournable
  bookingRequired: boolean;
  bookingUrl?: string;
  openingHours: { open: string; close: string }; // Format "HH:MM"
  tips?: string;
  dataReliability?: 'verified' | 'estimated' | 'generated'; // Source des données
  googleMapsUrl?: string; // Lien direct vers Google Maps
}

// Base de données des attractions par destination
const ATTRACTIONS: Record<string, Attraction[]> = {
  // Barcelone
  barcelone: [
    {
      id: 'sagrada-familia',
      name: 'Sagrada Familia',
      type: 'culture',
      description: 'Chef-d\'œuvre inachevé de Gaudí, basilique emblématique de Barcelone',
      duration: 120,
      estimatedCost: 26,
      latitude: 41.4036,
      longitude: 2.1744,
      rating: 4.8,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://sagradafamilia.org/tickets',
      openingHours: { open: '09:00', close: '18:00' }, // Fermeture 18h en hiver (nov-fév), 20h en été
      tips: 'Réservez plusieurs jours à l\'avance. Dernière entrée 1h avant fermeture.',
    },
    {
      id: 'park-guell',
      name: 'Parc Güell',
      type: 'nature',
      description: 'Parc public avec des œuvres architecturales de Gaudí',
      duration: 90,
      estimatedCost: 10,
      latitude: 41.4145,
      longitude: 2.1527,
      rating: 4.6,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://parkguell.barcelona/en/buy-tickets',
      openingHours: { open: '09:30', close: '19:30' },
    },
    {
      id: 'la-rambla',
      name: 'La Rambla',
      type: 'culture',
      description: 'Avenue emblématique avec artistes de rue',
      duration: 60,
      estimatedCost: 0,
      latitude: 41.3809,
      longitude: 2.1734,
      rating: 4.4,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
    {
      id: 'boqueria',
      name: 'Marché de la Boqueria',
      type: 'gastronomy',
      description: 'Marché couvert historique avec produits frais et tapas',
      duration: 60,
      estimatedCost: 15,
      latitude: 41.3816,
      longitude: 2.1719,
      rating: 4.5,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '08:00', close: '20:30' },
    },
    {
      id: 'casa-batllo',
      name: 'Casa Batlló',
      type: 'culture',
      description: 'Maison moderniste de Gaudí avec façade ondulée',
      duration: 90,
      estimatedCost: 35,
      latitude: 41.3917,
      longitude: 2.1650,
      rating: 4.7,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.casabatllo.es/en/tickets/',
      openingHours: { open: '09:00', close: '21:00' },
    },
    {
      id: 'barceloneta',
      name: 'Plage de la Barceloneta',
      type: 'beach',
      description: 'Plage la plus populaire de Barcelone',
      duration: 180,
      estimatedCost: 0,
      latitude: 41.3758,
      longitude: 2.1894,
      rating: 4.3,
      mustSee: false,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
    {
      id: 'gothic-quarter',
      name: 'Quartier Gothique',
      type: 'culture',
      description: 'Centre historique médiéval avec ruelles et places',
      duration: 90,
      estimatedCost: 0,
      latitude: 41.3833,
      longitude: 2.1761,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
    {
      id: 'camp-nou',
      name: 'Camp Nou - FC Barcelona',
      type: 'culture',
      description: 'Stade mythique du FC Barcelone avec musée',
      duration: 120,
      estimatedCost: 28,
      latitude: 41.3809,
      longitude: 2.1228,
      rating: 4.6,
      mustSee: false,
      bookingRequired: true,
      bookingUrl: 'https://www.fcbarcelona.com/en/tickets/camp-nou-experience',
      openingHours: { open: '09:30', close: '19:30' },
    },
  ],

  // Rome
  rome: [
    {
      id: 'colosseum',
      name: 'Colisée',
      type: 'culture',
      description: 'Amphithéâtre antique emblématique de Rome',
      duration: 120,
      estimatedCost: 18,
      latitude: 41.8902,
      longitude: 12.4922,
      rating: 4.8,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.coopculture.it/en/colosseo-e-shop.cfm',
      openingHours: { open: '09:00', close: '19:00' },
    },
    {
      id: 'vatican',
      name: 'Musées du Vatican & Chapelle Sixtine',
      type: 'culture',
      description: 'Collection d\'art exceptionnelle et chef-d\'œuvre de Michel-Ange',
      duration: 180,
      estimatedCost: 20,
      latitude: 41.9065,
      longitude: 12.4534,
      rating: 4.7,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.museivaticani.va/content/museivaticani/en.html',
      openingHours: { open: '09:00', close: '18:00' },
    },
    {
      id: 'trevi-fountain',
      name: 'Fontaine de Trevi',
      type: 'culture',
      description: 'Fontaine baroque monumentale',
      duration: 30,
      estimatedCost: 0,
      latitude: 41.9009,
      longitude: 12.4833,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
    {
      id: 'pantheon',
      name: 'Panthéon',
      type: 'culture',
      description: 'Temple romain antique avec dôme impressionnant',
      duration: 45,
      estimatedCost: 5,
      latitude: 41.8986,
      longitude: 12.4769,
      rating: 4.8,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '09:00', close: '19:00' },
    },
    {
      id: 'trastevere',
      name: 'Quartier du Trastevere',
      type: 'gastronomy',
      description: 'Quartier bohème avec restaurants traditionnels',
      duration: 120,
      estimatedCost: 0,
      latitude: 41.8867,
      longitude: 12.4692,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
  ],

  // Paris
  paris: [
    {
      id: 'eiffel-tower',
      name: 'Tour Eiffel',
      type: 'culture',
      description: 'Monument emblématique de Paris',
      duration: 120,
      estimatedCost: 29,
      latitude: 48.8584,
      longitude: 2.2945,
      rating: 4.7,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.toureiffel.paris/fr/tarifs-horaires',
      openingHours: { open: '09:30', close: '23:45' },
    },
    {
      id: 'louvre',
      name: 'Musée du Louvre',
      type: 'culture',
      description: 'Plus grand musée d\'art au monde, la Joconde',
      duration: 180,
      estimatedCost: 17,
      latitude: 48.8606,
      longitude: 2.3376,
      rating: 4.8,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.louvre.fr/visiter/billets',
      openingHours: { open: '09:00', close: '18:00' },
    },
    {
      id: 'montmartre',
      name: 'Montmartre & Sacré-Cœur',
      type: 'culture',
      description: 'Quartier artistique avec basilique panoramique',
      duration: 120,
      estimatedCost: 0,
      latitude: 48.8867,
      longitude: 2.3431,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '06:00', close: '22:30' },
    },
    {
      id: 'champs-elysees',
      name: 'Champs-Élysées & Arc de Triomphe',
      type: 'shopping',
      description: 'Avenue mythique avec boutiques de luxe',
      duration: 90,
      estimatedCost: 13,
      latitude: 48.8738,
      longitude: 2.2950,
      rating: 4.5,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '23:00' },
    },
  ],

  // Lisbonne
  lisbonne: [
    {
      id: 'belem-tower',
      name: 'Tour de Belém',
      type: 'culture',
      description: 'Fortification emblématique de l\'ère des découvertes',
      duration: 60,
      estimatedCost: 10,
      latitude: 38.6916,
      longitude: -9.2160,
      rating: 4.5,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '18:30' },
    },
    {
      id: 'alfama',
      name: 'Quartier de l\'Alfama',
      type: 'culture',
      description: 'Quartier historique avec ruelles et Fado',
      duration: 120,
      estimatedCost: 0,
      latitude: 38.7114,
      longitude: -9.1303,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
    {
      id: 'pasteis-belem',
      name: 'Pastéis de Belém',
      type: 'gastronomy',
      description: 'Pâtisserie historique des célèbres pastéis de nata',
      duration: 45,
      estimatedCost: 5,
      latitude: 38.6976,
      longitude: -9.2033,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '08:00', close: '23:00' },
    },
    {
      id: 'tram-28',
      name: 'Tramway 28',
      type: 'culture',
      description: 'Ligne de tram historique traversant les quartiers',
      duration: 60,
      estimatedCost: 3,
      latitude: 38.7139,
      longitude: -9.1334,
      rating: 4.4,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '06:00', close: '23:00' },
    },
  ],

  // Amsterdam
  amsterdam: [
    {
      id: 'anne-frank',
      name: 'Maison d\'Anne Frank',
      type: 'culture',
      description: 'Musée dans la maison où Anne Frank s\'est cachée',
      duration: 90,
      estimatedCost: 16,
      latitude: 52.3752,
      longitude: 4.8840,
      rating: 4.7,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.annefrank.org/en/museum/tickets/',
      openingHours: { open: '09:00', close: '22:00' },
    },
    {
      id: 'van-gogh',
      name: 'Musée Van Gogh',
      type: 'culture',
      description: 'Plus grande collection d\'œuvres de Van Gogh',
      duration: 120,
      estimatedCost: 22,
      latitude: 52.3584,
      longitude: 4.8811,
      rating: 4.8,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.vangoghmuseum.nl/en/tickets',
      openingHours: { open: '09:00', close: '18:00' },
    },
    {
      id: 'jordaan',
      name: 'Quartier du Jordaan',
      type: 'culture',
      description: 'Quartier pittoresque avec canaux et cafés',
      duration: 90,
      estimatedCost: 0,
      latitude: 52.3749,
      longitude: 4.8807,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
    {
      id: 'canals-cruise',
      name: 'Croisière sur les canaux',
      type: 'nature',
      description: 'Découverte de la ville par les canaux UNESCO',
      duration: 75,
      estimatedCost: 18,
      latitude: 52.3676,
      longitude: 4.9041,
      rating: 4.5,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '21:00' },
    },
  ],

  // Prague
  prague: [
    {
      id: 'charles-bridge',
      name: 'Pont Charles',
      type: 'culture',
      description: 'Pont gothique iconique avec statues baroques',
      duration: 45,
      estimatedCost: 0,
      latitude: 50.0865,
      longitude: 14.4114,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
      tips: 'Venez tôt le matin pour éviter la foule',
    },
    {
      id: 'prague-castle',
      name: 'Château de Prague',
      type: 'culture',
      description: 'Plus grand château ancien au monde',
      duration: 180,
      estimatedCost: 15,
      latitude: 50.0911,
      longitude: 14.4003,
      rating: 4.6,
      mustSee: true,
      bookingRequired: true,
      openingHours: { open: '09:00', close: '17:00' },
    },
    {
      id: 'old-town-square',
      name: 'Place de la Vieille-Ville',
      type: 'culture',
      description: 'Horloge astronomique et architecture médiévale',
      duration: 60,
      estimatedCost: 0,
      latitude: 50.0875,
      longitude: 14.4213,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
  ],

  // Malaga
  malaga: [
    {
      id: 'alcazaba',
      name: 'Alcazaba',
      type: 'culture',
      description: 'Forteresse palatiale mauresque du XIe siècle',
      duration: 90,
      estimatedCost: 3.5,
      latitude: 36.7213,
      longitude: -4.4165,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '09:00', close: '20:00' },
    },
    {
      id: 'picasso-museum',
      name: 'Musée Picasso',
      type: 'culture',
      description: 'Collection d\'œuvres du maître né à Malaga',
      duration: 90,
      estimatedCost: 12,
      latitude: 36.7215,
      longitude: -4.4188,
      rating: 4.5,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '19:00' },
    },
    {
      id: 'malagueta-beach',
      name: 'Plage de la Malagueta',
      type: 'beach',
      description: 'Plage principale de Malaga avec chiringuitos',
      duration: 180,
      estimatedCost: 0,
      latitude: 36.7179,
      longitude: -4.4096,
      rating: 4.3,
      mustSee: false,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
    },
  ],

  // Londres
  london: [
    {
      id: 'big-ben',
      name: 'Big Ben & Houses of Parliament',
      type: 'culture',
      description: 'Iconic clock tower and seat of UK Parliament',
      duration: 60,
      estimatedCost: 0,
      latitude: 51.5007,
      longitude: -0.1246,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
      tips: 'Best views from Westminster Bridge',
    },
    {
      id: 'tower-bridge',
      name: 'Tower Bridge',
      type: 'culture',
      description: 'Victorian bascule bridge over the Thames',
      duration: 60,
      estimatedCost: 12,
      latitude: 51.5055,
      longitude: -0.0754,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      bookingUrl: 'https://www.towerbridge.org.uk/tickets',
      openingHours: { open: '10:00', close: '18:00' },
    },
    {
      id: 'british-museum',
      name: 'British Museum',
      type: 'culture',
      description: 'World-famous museum with ancient artifacts including the Rosetta Stone',
      duration: 180,
      estimatedCost: 0,
      latitude: 51.5194,
      longitude: -0.1270,
      rating: 4.8,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '17:00' },
    },
    {
      id: 'tower-of-london',
      name: 'Tower of London',
      type: 'culture',
      description: 'Historic castle and home to the Crown Jewels',
      duration: 150,
      estimatedCost: 34,
      latitude: 51.5081,
      longitude: -0.0759,
      rating: 4.7,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.hrp.org.uk/tower-of-london/',
      openingHours: { open: '09:00', close: '17:30' },
    },
    {
      id: 'buckingham-palace',
      name: 'Buckingham Palace',
      type: 'culture',
      description: 'Official London residence of the British monarch',
      duration: 120,
      estimatedCost: 0,
      latitude: 51.5014,
      longitude: -0.1419,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '00:00', close: '23:59' },
      tips: 'Changing of the Guard at 11:00 (check schedule)',
    },
    {
      id: 'westminster-abbey',
      name: 'Westminster Abbey',
      type: 'culture',
      description: 'Gothic abbey and coronation church of British monarchs',
      duration: 90,
      estimatedCost: 27,
      latitude: 51.4993,
      longitude: -0.1273,
      rating: 4.7,
      mustSee: true,
      bookingRequired: true,
      bookingUrl: 'https://www.westminster-abbey.org/visit-us',
      openingHours: { open: '09:30', close: '15:30' },
    },
    {
      id: 'natural-history-museum',
      name: 'Natural History Museum',
      type: 'culture',
      description: 'Spectacular dinosaur exhibits and natural world collections',
      duration: 150,
      estimatedCost: 0,
      latitude: 51.4967,
      longitude: -0.1764,
      rating: 4.8,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '17:50' },
    },
    {
      id: 'hyde-park',
      name: 'Hyde Park',
      type: 'nature',
      description: 'Royal Park with Serpentine lake and Speaker\'s Corner',
      duration: 90,
      estimatedCost: 0,
      latitude: 51.5073,
      longitude: -0.1657,
      rating: 4.7,
      mustSee: false,
      bookingRequired: false,
      openingHours: { open: '05:00', close: '00:00' },
    },
    {
      id: 'tate-modern',
      name: 'Tate Modern',
      type: 'culture',
      description: 'Modern and contemporary art in a former power station',
      duration: 120,
      estimatedCost: 0,
      latitude: 51.5076,
      longitude: -0.0994,
      rating: 4.6,
      mustSee: false,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '18:00' },
    },
    {
      id: 'borough-market',
      name: 'Borough Market',
      type: 'gastronomy',
      description: 'Historic food market with gourmet vendors',
      duration: 90,
      estimatedCost: 20,
      latitude: 51.5055,
      longitude: -0.0910,
      rating: 4.6,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '10:00', close: '17:00' },
    },
    {
      id: 'london-eye',
      name: 'London Eye',
      type: 'culture',
      description: 'Giant observation wheel with panoramic city views',
      duration: 45,
      estimatedCost: 32,
      latitude: 51.5033,
      longitude: -0.1196,
      rating: 4.5,
      mustSee: false,
      bookingRequired: true,
      bookingUrl: 'https://www.londoneye.com/tickets/',
      openingHours: { open: '10:00', close: '20:00' },
    },
    {
      id: 'st-pauls-cathedral',
      name: 'St Paul\'s Cathedral',
      type: 'culture',
      description: 'Christopher Wren\'s masterpiece with iconic dome',
      duration: 90,
      estimatedCost: 23,
      latitude: 51.5138,
      longitude: -0.0984,
      rating: 4.7,
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '08:30', close: '16:30' },
    },
  ],
};

// Aliases pour les noms de villes
const CITY_ALIASES: Record<string, string> = {
  'barcelona': 'barcelone',
  'barca': 'barcelone',
  'roma': 'rome',
  'lisbon': 'lisbonne',
  'lisboa': 'lisbonne',
  'praha': 'prague',
  'málaga': 'malaga',
  'londres': 'london',
};

/**
 * Normalise le nom d'une ville
 */
export function normalizeCity(city: string): string {
  const normalized = city.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CITY_ALIASES[normalized] || normalized;
}

/**
 * Récupère les attractions pour une destination (synchrone, base locale uniquement)
 */
export function getAttractions(destination: string): Attraction[] {
  const normalized = normalizeCity(destination);
  return ATTRACTIONS[normalized] || [];
}

// NOTE: getAttractionsAsync est dans attractionsServer.ts (serveur uniquement)

/**
 * Récupère uniquement les incontournables
 */
export function getMustSeeAttractions(destination: string): Attraction[] {
  return getAttractions(destination).filter(a => a.mustSee);
}

/**
 * Récupère les attractions par type d'activité
 */
export function getAttractionsByType(destination: string, types: ActivityType[]): Attraction[] {
  return getAttractions(destination).filter(a => types.includes(a.type));
}

/**
 * Recherche d'attractions par texte (pour le champ mustSee)
 */
export function searchAttractions(destination: string, query: string): Attraction[] {
  const attractions = getAttractions(destination);
  const normalizedQuery = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return attractions.filter(a => {
    const normalizedName = a.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedDesc = a.description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return normalizedName.includes(normalizedQuery) || normalizedDesc.includes(normalizedQuery);
  });
}

/**
 * Calcule la distance entre 2 points (Haversine)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Estime le temps de trajet entre 2 attractions (en minutes)
 */
export function estimateTravelTime(from: Attraction, to: Attraction): number {
  const distance = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
  // En ville: ~4 km/h à pied, ~15 km/h en transport
  if (distance < 1) {
    return Math.ceil(distance / 4 * 60); // À pied
  } else if (distance < 5) {
    return Math.ceil(distance / 12 * 60) + 10; // Transport + attente
  } else {
    return Math.ceil(distance / 20 * 60) + 15; // Transport plus long
  }
}

/**
 * Sélectionne les meilleures attractions selon le temps disponible et les préférences
 * LIMITE: max 3 attractions principales par jour pour être réaliste
 */
export function selectAttractions(
  destination: string,
  availableMinutes: number,
  preferences: {
    types: ActivityType[];
    mustSeeQuery?: string;
    prioritizeMustSee?: boolean;
    maxPerDay?: number;
  }
): Attraction[] {
  let attractions = getAttractions(destination);

  if (attractions.length === 0) {
    return [];
  }

  return selectAttractionsFromList(attractions, availableMinutes, preferences);
}

// NOTE: selectAttractionsAsync est dans attractionsServer.ts (serveur uniquement)

/**
 * Logique commune de sélection des attractions
 */
export function selectAttractionsFromList(
  attractions: Attraction[],
  availableMinutes: number,
  preferences: {
    types: ActivityType[];
    mustSeeQuery?: string;
    prioritizeMustSee?: boolean;
    maxPerDay?: number;
  }
): Attraction[] {
  if (attractions.length === 0) {
    return [];
  }

  // Filtrer par mustSee si spécifié
  if (preferences.mustSeeQuery && preferences.mustSeeQuery.trim()) {
    const keywords = preferences.mustSeeQuery.toLowerCase().split(/[,;]+/).map(k => k.trim());
    const mustSeeMatches = attractions.filter(a => {
      const name = a.name.toLowerCase();
      return keywords.some(k => name.includes(k) || k.includes(name.split(' ')[0]));
    });

    if (mustSeeMatches.length > 0) {
      // Mettre les correspondances en premier
      attractions = [
        ...mustSeeMatches,
        ...attractions.filter(a => !mustSeeMatches.includes(a)),
      ];
    }
  }

  // Trier par priorité
  attractions.sort((a, b) => {
    // 1. Incontournables en premier
    if (preferences.prioritizeMustSee !== false) {
      if (a.mustSee && !b.mustSee) return -1;
      if (!a.mustSee && b.mustSee) return 1;
    }

    // 2. Types préférés
    const aTypeMatch = preferences.types.includes(a.type);
    const bTypeMatch = preferences.types.includes(b.type);
    if (aTypeMatch && !bTypeMatch) return -1;
    if (!aTypeMatch && bTypeMatch) return 1;

    // 3. Par note
    return b.rating - a.rating;
  });

  // Sélectionner selon le temps disponible avec temps de trajet réaliste
  const selected: Attraction[] = [];
  let totalDuration = 0;
  const maxAttractions = preferences.maxPerDay || 6; // Max total (environ 3 par jour pour 2 jours)

  for (const attraction of attractions) {
    if (selected.length >= maxAttractions) break;

    // Calculer le temps de trajet depuis la dernière attraction
    const travelTime = selected.length > 0
      ? estimateTravelTime(selected[selected.length - 1], attraction)
      : 0;

    const neededTime = attraction.duration + travelTime;

    if (totalDuration + neededTime <= availableMinutes) {
      selected.push(attraction);
      totalDuration += neededTime;
    }
  }

  return selected;
}

/**
 * Vérifie si une destination a des données d'attractions (base locale)
 * Note: Le cache AI est vérifié dynamiquement lors de l'appel async
 */
export function hasAttractionData(destination: string): boolean {
  const normalized = normalizeCity(destination);
  // Vérifier uniquement la base locale (le cache AI sera vérifié à l'exécution)
  return normalized in ATTRACTIONS;
}

/**
 * Liste toutes les destinations supportées
 */
export function getSupportedDestinations(): string[] {
  return Object.keys(ATTRACTIONS);
}

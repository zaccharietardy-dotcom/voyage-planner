/**
 * Métadonnées de transport par ville
 * Informations sur les systèmes de transport en commun, tarifs, et multiplicateurs VTC
 */

export interface CityTransportInfo {
  city: string;
  country: string;
  metroSystem?: {
    name: string;
    lines: number;
    hasLineColors: boolean;
    mapUrl?: string;
    ticketPrice?: number;
    dayPassPrice?: number;
  };
  busSystem?: {
    name: string;
    extensive: boolean;
  };
  tramSystem?: {
    name: string;
    lines: number;
  };
  rideHailingMultiplier: number; // Multiplicateur de prix VTC (1.0 = moyenne européenne)
  rideHailingServices: ('uber' | 'bolt' | 'freenow' | 'lyft' | 'grab' | 'local')[];
  publicTransportCard?: {
    name: string;
    description: string;
    purchaseUrl?: string;
  };
  transportTips: string[];
}

export const CITY_TRANSPORT_DATA: Record<string, CityTransportInfo> = {
  'paris': {
    city: 'Paris',
    country: 'France',
    metroSystem: {
      name: 'Métro de Paris',
      lines: 16,
      hasLineColors: true,
      mapUrl: 'https://www.ratp.fr/plan-metro',
      ticketPrice: 2.10,
      dayPassPrice: 8.45,
    },
    busSystem: {
      name: 'Bus RATP',
      extensive: true,
    },
    tramSystem: {
      name: 'Tramway',
      lines: 11,
    },
    rideHailingMultiplier: 1.2,
    rideHailingServices: ['uber', 'bolt', 'freenow'],
    publicTransportCard: {
      name: 'Pass Navigo Découverte',
      description: 'Carte rechargeable pour transports illimités',
      purchaseUrl: 'https://www.iledefrance-mobilites.fr',
    },
    transportTips: [
      'Le métro est le moyen le plus rapide de se déplacer',
      'Évitez les heures de pointe (8h-10h et 17h-20h)',
      'Les taxis sont chers - privilégiez Uber/Bolt ou le métro',
      'Pass Navigo Week à 30€ pour une semaine illimitée',
    ],
  },
  'london': {
    city: 'London',
    country: 'United Kingdom',
    metroSystem: {
      name: 'London Underground',
      lines: 11,
      hasLineColors: true,
      mapUrl: 'https://tfl.gov.uk/maps/track/tube',
      ticketPrice: 2.80,
      dayPassPrice: 8.10,
    },
    busSystem: {
      name: 'London Buses',
      extensive: true,
    },
    rideHailingMultiplier: 1.4,
    rideHailingServices: ['uber', 'bolt', 'freenow'],
    publicTransportCard: {
      name: 'Oyster Card',
      description: 'Carte à puce pour tous les transports',
      purchaseUrl: 'https://tfl.gov.uk/fares/how-to-pay-and-where-to-buy-tickets-and-oyster/oyster',
    },
    transportTips: [
      'Oyster Card obligatoire pour voyager moins cher',
      'Le Tube est très fréquenté aux heures de pointe',
      'Les bus rouges à impériale offrent de belles vues',
      'Contactless payment accepté partout',
    ],
  },
  'tokyo': {
    city: 'Tokyo',
    country: 'Japan',
    metroSystem: {
      name: 'Tokyo Metro',
      lines: 13,
      hasLineColors: true,
      mapUrl: 'https://www.tokyometro.jp/en/subwaymap/',
      ticketPrice: 1.70,
      dayPassPrice: 6.00,
    },
    busSystem: {
      name: 'Toei Bus',
      extensive: false,
    },
    rideHailingMultiplier: 1.5,
    rideHailingServices: ['uber', 'local'],
    publicTransportCard: {
      name: 'Suica / Pasmo',
      description: 'Carte IC pour métro, train, bus et achats',
      purchaseUrl: 'https://www.jreast.co.jp/e/pass/suica.html',
    },
    transportTips: [
      'Le réseau de métro est très dense mais complexe',
      'Suica/Pasmo indispensable - fonctionne partout',
      'Les taxis sont très chers - privilégiez le métro',
      'Google Maps fonctionne parfaitement pour le transit',
      'Respectez le silence dans les transports',
    ],
  },
  'barcelona': {
    city: 'Barcelona',
    country: 'Spain',
    metroSystem: {
      name: 'Metro de Barcelona',
      lines: 12,
      hasLineColors: true,
      mapUrl: 'https://www.tmb.cat/en/barcelona/metro',
      ticketPrice: 2.55,
      dayPassPrice: 10.50,
    },
    busSystem: {
      name: 'TMB Bus',
      extensive: true,
    },
    tramSystem: {
      name: 'Trambaix / Trambesòs',
      lines: 6,
    },
    rideHailingMultiplier: 0.9,
    rideHailingServices: ['uber', 'bolt', 'freenow'],
    publicTransportCard: {
      name: 'Hola Barcelona Card',
      description: 'Pass transport illimité + réductions',
      purchaseUrl: 'https://www.holabarcelona.com',
    },
    transportTips: [
      'Le métro couvre très bien la ville',
      'La plage est accessible en métro (ligne L4)',
      'T-10 ticket = 10 trajets à tarif réduit',
      'Le bus touristique est cher - préférez le métro',
    ],
  },
  'rome': {
    city: 'Rome',
    country: 'Italy',
    metroSystem: {
      name: 'Metropolitana di Roma',
      lines: 3,
      hasLineColors: true,
      mapUrl: 'https://www.atac.roma.it/en/metro',
      ticketPrice: 1.50,
      dayPassPrice: 7.00,
    },
    busSystem: {
      name: 'ATAC Bus',
      extensive: true,
    },
    tramSystem: {
      name: 'Tram',
      lines: 6,
    },
    rideHailingMultiplier: 0.95,
    rideHailingServices: ['uber', 'freenow', 'local'],
    publicTransportCard: {
      name: 'Roma Pass',
      description: 'Transport + entrées musées',
      purchaseUrl: 'https://www.romapass.it',
    },
    transportTips: [
      'Le métro a peu de lignes - beaucoup de marche nécessaire',
      'Les bus sont fréquents mais souvent en retard',
      'Le centre historique est très compact - marche recommandée',
      'Validez TOUJOURS votre ticket dans les transports',
    ],
  },
  'berlin': {
    city: 'Berlin',
    country: 'Germany',
    metroSystem: {
      name: 'U-Bahn',
      lines: 10,
      hasLineColors: true,
      mapUrl: 'https://www.bvg.de/en/connections/bvg-lines/network-maps',
      ticketPrice: 3.20,
      dayPassPrice: 9.00,
    },
    busSystem: {
      name: 'BVG Bus',
      extensive: true,
    },
    tramSystem: {
      name: 'Tram',
      lines: 22,
    },
    rideHailingMultiplier: 0.85,
    rideHailingServices: ['uber', 'bolt', 'freenow'],
    publicTransportCard: {
      name: 'Berlin WelcomeCard',
      description: 'Transport + réductions attractions',
      purchaseUrl: 'https://www.berlin-welcomecard.de',
    },
    transportTips: [
      'Le réseau de transport est excellent et ponctuel',
      'U-Bahn + S-Bahn + Tram = couverture totale',
      'La zone AB suffit pour le centre-ville',
      'Les transports fonctionnent 24h/24 le week-end',
    ],
  },
  'amsterdam': {
    city: 'Amsterdam',
    country: 'Netherlands',
    metroSystem: {
      name: 'Amsterdam Metro',
      lines: 5,
      hasLineColors: true,
      mapUrl: 'https://www.gvb.nl/en/travel-information/maps',
      ticketPrice: 3.40,
      dayPassPrice: 9.00,
    },
    busSystem: {
      name: 'GVB Bus',
      extensive: true,
    },
    tramSystem: {
      name: 'Tram',
      lines: 15,
    },
    rideHailingMultiplier: 1.1,
    rideHailingServices: ['uber', 'bolt', 'freenow'],
    publicTransportCard: {
      name: 'OV-chipkaart',
      description: 'Carte à puce pour tous les transports',
      purchaseUrl: 'https://www.ov-chipkaart.nl/en',
    },
    transportTips: [
      'Le tram est le meilleur moyen de se déplacer',
      'Louez un vélo - Amsterdam est ultra cyclable',
      'OV-chipkaart nécessaire pour les transports',
      'Le centre-ville est très compact et marchable',
    ],
  },
  'bangkok': {
    city: 'Bangkok',
    country: 'Thailand',
    metroSystem: {
      name: 'BTS Skytrain / MRT',
      lines: 5,
      hasLineColors: true,
      mapUrl: 'https://www.bts.co.th/eng/map.html',
      ticketPrice: 0.50,
      dayPassPrice: 3.50,
    },
    busSystem: {
      name: 'BMTA Bus',
      extensive: true,
    },
    rideHailingMultiplier: 0.3,
    rideHailingServices: ['grab', 'bolt', 'local'],
    publicTransportCard: {
      name: 'Rabbit Card',
      description: 'Carte pour BTS Skytrain',
      purchaseUrl: 'https://www.rabbitcard.com',
    },
    transportTips: [
      'BTS Skytrain est climatisé et rapide - idéal',
      'Grab (équivalent Uber) est très bon marché',
      'Évitez les taxis qui refusent le compteur',
      'Les bateaux express sur le fleuve sont pratiques',
      'Le trafic est terrible - privilégiez le BTS/MRT',
    ],
  },
  'marrakech': {
    city: 'Marrakech',
    country: 'Morocco',
    busSystem: {
      name: 'Alsa Bus',
      extensive: false,
    },
    rideHailingMultiplier: 0.4,
    rideHailingServices: ['uber', 'local'],
    transportTips: [
      'Pas de métro - transports limités',
      'Petits taxis (rouge) pour trajets en ville',
      'Négociez le prix avant de monter en taxi',
      'La médina se visite uniquement à pied',
      'Uber est moins cher que les taxis',
      'Grand taxis pour trajets hors ville',
    ],
  },
  'lisbon': {
    city: 'Lisbon',
    country: 'Portugal',
    metroSystem: {
      name: 'Metro de Lisboa',
      lines: 4,
      hasLineColors: true,
      mapUrl: 'https://www.metrolisboa.pt/en/travel/diagrams-and-maps/',
      ticketPrice: 1.65,
      dayPassPrice: 6.80,
    },
    busSystem: {
      name: 'Carris Bus',
      extensive: true,
    },
    tramSystem: {
      name: 'Tram',
      lines: 5,
    },
    rideHailingMultiplier: 0.8,
    rideHailingServices: ['uber', 'bolt', 'freenow'],
    publicTransportCard: {
      name: 'Lisboa Card',
      description: 'Transport + entrées gratuites',
      purchaseUrl: 'https://www.visitlisboa.com/en/lisboacard',
    },
    transportTips: [
      'Le tram 28 est iconique mais bondé',
      'Le métro couvre bien la ville',
      'Les collines sont raides - prenez les trams ou funiculaires',
      'Viva Viagem card pour tous les transports',
    ],
  },
  'new york': {
    city: 'New York',
    country: 'United States',
    metroSystem: {
      name: 'NYC Subway',
      lines: 28,
      hasLineColors: true,
      mapUrl: 'https://new.mta.info/maps',
      ticketPrice: 2.90,
      dayPassPrice: 34.00,
    },
    busSystem: {
      name: 'MTA Bus',
      extensive: true,
    },
    rideHailingMultiplier: 1.3,
    rideHailingServices: ['uber', 'lyft'],
    publicTransportCard: {
      name: 'MetroCard',
      description: 'Carte rechargeable pour métro + bus',
      purchaseUrl: 'https://new.mta.info/fares',
    },
    transportTips: [
      'Le subway fonctionne 24h/24',
      'MetroCard indispensable',
      'Les taxis jaunes sont chers - Uber plus pratique',
      'Le métro est le plus rapide mais peut être confus',
      'Évitez le métro tard le soir - préférez Uber',
    ],
  },
};

/**
 * Récupère les infos de transport d'une ville
 */
export function getCityTransportInfo(cityName: string): CityTransportInfo | null {
  const normalized = cityName.toLowerCase().trim();
  return CITY_TRANSPORT_DATA[normalized] || null;
}

/**
 * Récupère le multiplicateur VTC d'une ville
 */
export function getRideHailingMultiplier(cityName: string): number {
  const info = getCityTransportInfo(cityName);
  return info?.rideHailingMultiplier || 1.0;
}

/**
 * DayTripHandler - Gestion généralisée des excursions hors de la ville principale
 *
 * Cas d'usage:
 * - Villa d'Este à Tivoli depuis Rome
 * - Mont Fuji / Hakone depuis Tokyo
 * - Tolède depuis Madrid
 * - Versailles depuis Paris
 * - etc.
 *
 * Ce service crée une structure optimisée pour les day trips avec:
 * - Transport aller (train, bus, ou voiture)
 * - Activités groupées sur place
 * - Restaurant local (pas dans la ville principale)
 * - Transport retour
 */

import { TripPreferences, TripItem } from '../types';
import { calculateDistance, getCityCenterCoordsAsync } from './geocoding';
import { searchRestaurantsWithSerpApi } from './serpApiPlaces';
import { generateGoogleMapsDirectionsUrl, generateGoogleMapsSearchUrl } from './directions';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DayTripContext {
  mainDestination: string;        // Ex: "Rome", "Tokyo"
  dayTripDestination: string;     // Ex: "Tivoli", "Mont Fuji"
  dayTripCoords: Coordinates;     // Centre du day trip
  mainCoords: Coordinates;        // Centre ville principale
  date: Date;
  dayNumber: number;
  preferences: TripPreferences;
}

export interface DayTripTransport {
  mode: 'train' | 'bus' | 'car' | 'taxi';
  duration: number;  // minutes
  estimatedCost: number;
  departureStation?: string;
  arrivalStation?: string;
  googleMapsUrl: string;
}

export interface DayTripRestaurant {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating?: number;
  priceLevel?: string;
  googleMapsUrl: string;
}

export interface DayTripPlan {
  transportAller: DayTripTransport;
  transportRetour: DayTripTransport;
  suggestedRestaurant: DayTripRestaurant | null;
  nearbyAttractions: string[];  // Autres attractions à suggérer
  totalTransportTime: number;   // minutes
  totalTransportCost: number;
}

/**
 * Calcule le meilleur moyen de transport pour un day trip
 */
export function estimateDayTripTransport(
  mainCoords: Coordinates,
  dayTripCoords: Coordinates,
  mainCity: string,
  dayTripCity: string,
  groupSize: number
): DayTripTransport {
  const distance = calculateDistance(mainCoords.lat, mainCoords.lng, dayTripCoords.lat, dayTripCoords.lng);

  // Heuristiques basées sur la distance
  let mode: 'train' | 'bus' | 'car' | 'taxi';
  let duration: number;
  let costPerPerson: number;

  if (distance < 30) {
    // < 30km : bus ou train régional
    mode = 'train';
    duration = Math.round(distance * 2); // ~2 min/km en train régional
    costPerPerson = Math.round(distance * 0.15); // ~0.15€/km
  } else if (distance < 80) {
    // 30-80km : train intercity ou bus longue distance
    mode = 'train';
    duration = Math.round(distance * 1.5); // ~1.5 min/km
    costPerPerson = Math.round(distance * 0.12); // ~0.12€/km
  } else {
    // > 80km : voiture/taxi recommandé ou train rapide
    mode = groupSize >= 3 ? 'car' : 'train';
    duration = Math.round(distance * 1.2);
    costPerPerson = mode === 'car' ? Math.round(distance * 0.25 / groupSize) : Math.round(distance * 0.10);
  }

  // Arrondir la durée à 5 minutes près
  duration = Math.ceil(duration / 5) * 5;

  // URL Google Maps pour l'itinéraire
  const googleMapsUrl = generateGoogleMapsDirectionsUrl(
    mainCity,
    dayTripCity,
    '', // pas de ville car on a les noms complets
    mode === 'train' ? 'transit' : 'driving'
  );

  return {
    mode,
    duration,
    estimatedCost: costPerPerson * groupSize,
    departureStation: mode === 'train' ? `Gare centrale de ${mainCity}` : undefined,
    arrivalStation: mode === 'train' ? `Gare de ${dayTripCity}` : undefined,
    googleMapsUrl,
  };
}

/**
 * Recherche un restaurant local dans la zone du day trip
 */
export async function findDayTripRestaurant(
  dayTripDestination: string,
  dayTripCoords: Coordinates,
  preferences: TripPreferences
): Promise<DayTripRestaurant | null> {
  try {
    const restaurants = await searchRestaurantsWithSerpApi(dayTripDestination, {
      mealType: 'lunch',
      limit: 5,
    });

    if (restaurants.length === 0) return null;

    // Prendre le premier restaurant avec un bon rating
    const best = restaurants.sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];

    return {
      name: best.name,
      address: best.address || dayTripDestination,
      latitude: best.latitude,
      longitude: best.longitude,
      rating: best.rating,
      priceLevel: best.priceLevel?.toString(),
      googleMapsUrl: generateGoogleMapsSearchUrl(best.name, dayTripDestination),
    };
  } catch (error) {
    console.error(`[DayTrip] Erreur recherche restaurant ${dayTripDestination}:`, error);
    return null;
  }
}

/**
 * Attractions connues à proximité des destinations day trip populaires
 * Permet de suggérer d'autres sites intéressants dans la zone
 */
const NEARBY_ATTRACTIONS: Record<string, string[]> = {
  // Italie
  'tivoli': ['Villa d\'Este', 'Villa Adriana', 'Temple de Vesta'],
  'pompei': ['Pompéi', 'Herculanum', 'Mont Vésuve'],
  'cinque terre': ['Monterosso', 'Vernazza', 'Corniglia', 'Manarola', 'Riomaggiore'],

  // Japon
  'mont fuji': ['Lac Kawaguchi', 'Chureito Pagoda', 'Oshino Hakkai'],
  'hakone': ['Musée en plein air de Hakone', 'Lac Ashi', 'Owakudani'],
  'nikko': ['Toshogu Shrine', 'Kegon Falls', 'Lake Chuzenji'],
  'kamakura': ['Grand Bouddha', 'Hasedera Temple', 'Tsurugaoka Hachimangu'],

  // Espagne
  'tolede': ['Alcázar de Tolède', 'Cathédrale de Tolède', 'Synagogue Santa María la Blanca'],
  'segovia': ['Alcazar de Ségovie', 'Aqueduc romain', 'Cathédrale de Ségovie'],

  // France
  'versailles': ['Château de Versailles', 'Jardins de Versailles', 'Grand Trianon', 'Petit Trianon'],
  'giverny': ['Maison de Claude Monet', 'Jardins de Giverny'],
  'mont saint-michel': ['Abbaye du Mont-Saint-Michel', 'Baie du Mont-Saint-Michel'],

  // Royaume-Uni
  'stonehenge': ['Stonehenge', 'Avebury', 'Salisbury Cathedral'],
  'windsor': ['Château de Windsor', 'Eton College'],
  'bath': ['Roman Baths', 'Royal Crescent', 'Bath Abbey'],

  // Pays-Bas
  'zaanse schans': ['Moulins à vent', 'Maisons traditionnelles', 'Fromageries'],
  'keukenhof': ['Jardins de Keukenhof', 'Champs de tulipes'],
};

/**
 * Trouve les attractions à proximité d'une destination day trip
 */
export function findNearbyAttractions(dayTripDestination: string): string[] {
  const destLower = dayTripDestination.toLowerCase();

  for (const [key, attractions] of Object.entries(NEARBY_ATTRACTIONS)) {
    if (destLower.includes(key) || key.includes(destLower)) {
      return attractions;
    }
  }

  return [];
}

/**
 * Planifie un day trip complet
 */
export async function planDayTrip(context: DayTripContext): Promise<DayTripPlan> {
  const { mainDestination, dayTripDestination, dayTripCoords, mainCoords, preferences } = context;

  // 1. Calculer le transport aller
  const transportAller = estimateDayTripTransport(
    mainCoords,
    dayTripCoords,
    mainDestination,
    dayTripDestination,
    preferences.groupSize || 1
  );

  // 2. Transport retour (identique mais inversé)
  const transportRetour = {
    ...transportAller,
    departureStation: transportAller.arrivalStation,
    arrivalStation: transportAller.departureStation,
    googleMapsUrl: generateGoogleMapsDirectionsUrl(
      dayTripDestination,
      mainDestination,
      '',
      transportAller.mode === 'train' ? 'transit' : 'driving'
    ),
  };

  // 3. Rechercher un restaurant local
  const suggestedRestaurant = await findDayTripRestaurant(
    dayTripDestination,
    dayTripCoords,
    preferences
  );

  // 4. Trouver les attractions à proximité
  const nearbyAttractions = findNearbyAttractions(dayTripDestination);

  return {
    transportAller,
    transportRetour,
    suggestedRestaurant,
    nearbyAttractions,
    totalTransportTime: transportAller.duration * 2,
    totalTransportCost: transportAller.estimatedCost * 2,
  };
}

/**
 * Détecte si une attraction nécessite un day trip
 * (distance > seuil depuis le centre-ville principal)
 */
export function isDayTripRequired(
  attractionCoords: Coordinates,
  mainCityCoords: Coordinates,
  thresholdKm: number = 15
): boolean {
  const distance = calculateDistance(
    mainCityCoords.lat,
    mainCityCoords.lng,
    attractionCoords.lat,
    attractionCoords.lng
  );
  return distance > thresholdKm;
}

/**
 * Génère les TripItems de transport pour un day trip
 */
export function generateDayTripTransportItems(
  plan: DayTripPlan,
  context: DayTripContext,
  departureTime: string = '08:30'
): { outbound: Partial<TripItem>; inbound: Partial<TripItem> } {
  const { transportAller, transportRetour } = plan;
  const { mainDestination, dayTripDestination, dayNumber } = context;

  // Calculer l'heure d'arrivée
  const [depHours, depMinutes] = departureTime.split(':').map(Number);
  const arrivalMinutes = depHours * 60 + depMinutes + transportAller.duration;
  const arrivalHours = Math.floor(arrivalMinutes / 60);
  const arrivalMins = arrivalMinutes % 60;
  const arrivalTime = `${arrivalHours.toString().padStart(2, '0')}:${arrivalMins.toString().padStart(2, '0')}`;

  const outbound: Partial<TripItem> = {
    type: 'transport',
    title: `Transport ${mainDestination} → ${dayTripDestination}`,
    description: `${transportAller.mode === 'train' ? 'Train' : transportAller.mode === 'bus' ? 'Bus' : 'Voiture'} | ~${transportAller.duration}min | ~${transportAller.estimatedCost}€`,
    locationName: `${mainDestination} → ${dayTripDestination}`,
    estimatedCost: transportAller.estimatedCost,
    startTime: departureTime,
    endTime: arrivalTime,
    googleMapsUrl: transportAller.googleMapsUrl,
    dayNumber,
  };

  // Heure de retour par défaut: 17:00
  const returnDeparture = '17:00';
  const returnMinutes = 17 * 60 + transportRetour.duration;
  const returnArrHours = Math.floor(returnMinutes / 60);
  const returnArrMins = returnMinutes % 60;
  const returnArrival = `${returnArrHours.toString().padStart(2, '0')}:${returnArrMins.toString().padStart(2, '0')}`;

  const inbound: Partial<TripItem> = {
    type: 'transport',
    title: `Retour ${dayTripDestination} → ${mainDestination}`,
    description: `${transportRetour.mode === 'train' ? 'Train' : transportRetour.mode === 'bus' ? 'Bus' : 'Voiture'} | ~${transportRetour.duration}min`,
    locationName: `${dayTripDestination} → ${mainDestination}`,
    estimatedCost: 0, // Coût compté dans l'aller
    startTime: returnDeparture,
    endTime: returnArrival,
    googleMapsUrl: transportRetour.googleMapsUrl,
    dayNumber,
  };

  return { outbound, inbound };
}

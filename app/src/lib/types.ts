// Types pour le formulaire de planification

export type TransportType = 'optimal' | 'plane' | 'train' | 'car' | 'bus';

export type GroupType = 'solo' | 'couple' | 'friends' | 'family_with_kids' | 'family_without_kids';

export type ActivityType =
  | 'beach'
  | 'nature'
  | 'culture'
  | 'gastronomy'
  | 'nightlife'
  | 'shopping'
  | 'adventure'
  | 'wellness';

export type DietaryType = 'none' | 'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'gluten_free';

export type BudgetLevel = 'economic' | 'moderate' | 'comfort' | 'luxury';

export interface TripPreferences {
  // Étape 1 - Destination & Dates
  origin: string;
  originCoords?: { lat: number; lng: number };
  destination: string;
  destinationCoords?: { lat: number; lng: number };
  startDate: Date;
  durationDays: number;

  // Étape 2 - Transport
  transport: TransportType;
  carRental: boolean;

  // Étape 3 - Groupe
  groupSize: number;
  groupType: GroupType;

  // Étape 4 - Budget
  budgetLevel: BudgetLevel;
  budgetCustom?: number; // Budget personnalisé en €

  // Étape 5 - Activités & Préférences
  activities: ActivityType[];
  dietary: DietaryType[];
  mustSee: string;

  // Étape 6 (optionnel) - Détails logistiques
  homeAddress?: string;
  homeCoords?: { lat: number; lng: number };
  preferredAirport?: string;
  departureTimePreference?: 'morning' | 'afternoon' | 'evening' | 'any';
  needsParking?: boolean;
}

// ============================================
// Types pour les vols
// ============================================

export interface Flight {
  id: string;
  airline: string;
  airlineLogo?: string;
  flightNumber: string;
  departureAirport: string;
  departureAirportCode: string;
  departureCity: string;
  departureTime: string; // ISO string
  departureTimeDisplay?: string; // HH:MM format (heure locale aéroport, pour affichage)
  arrivalAirport: string;
  arrivalAirportCode: string;
  arrivalCity: string;
  arrivalTime: string;
  arrivalTimeDisplay?: string; // HH:MM format (heure locale aéroport, pour affichage)
  duration: number; // en minutes
  stops: number;
  stopCities?: string[];
  price: number; // Prix TOTAL pour tous les passagers
  pricePerPerson?: number; // Prix par personne (optionnel pour rétrocompatibilité)
  isRoundTripPrice?: boolean; // true si le prix vient d'une recherche aller-retour (plus fiable)
  currency: string;
  bookingUrl?: string;
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
  baggageIncluded: boolean;
}

export interface FlightSearchResult {
  outboundFlights: Flight[];
  returnFlights: Flight[];
  searchedAt: Date;
  error?: string; // Message d'erreur si aucun vol trouvé
}

// ============================================
// Types pour les parkings
// ============================================

export interface ParkingOption {
  id: string;
  name: string;
  type: 'airport' | 'station' | 'city';
  address: string;
  latitude: number;
  longitude: number;
  distanceToTerminal?: number; // en mètres
  pricePerDay: number;
  totalPrice?: number;
  currency: string;
  amenities: string[]; // 'shuttle', 'covered', '24h', 'ev_charging', etc.
  rating?: number;
  reviewCount?: number;
  bookingUrl?: string;
  availableSpots?: number;
}

// ============================================
// Types pour les restaurants
// ============================================

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviewCount: number;
  priceLevel: 1 | 2 | 3 | 4; // € to €€€€
  cuisineTypes: string[];
  dietaryOptions: DietaryType[];
  openingHours: {
    [day: string]: { open: string; close: string } | null; // null = fermé
  };
  isOpenNow?: boolean;
  phoneNumber?: string;
  website?: string;
  googleMapsUrl?: string;
  reservationUrl?: string; // URL de réservation (TheFork, etc.)
  photos?: string[];
  distance?: number; // distance par rapport à un point de référence
  walkingTime?: number; // temps à pied en minutes
  specialties?: string[]; // spécialités du restaurant
  description?: string; // description courte
  tips?: string; // conseils (réservation, plats signature, etc.)
}

// ============================================
// Types pour les hébergements
// ============================================

export interface Accommodation {
  id: string;
  name: string;
  type: 'hotel' | 'apartment' | 'hostel' | 'bnb' | 'resort';
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviewCount: number;
  stars?: number;
  pricePerNight: number;
  totalPrice?: number;
  currency: string;
  amenities: string[];
  photos?: string[];
  checkInTime: string;
  checkOutTime: string;
  bookingUrl?: string;
  distanceToCenter?: number;
  distanceToActivities?: { activityId: string; distance: number }[];
  breakfastIncluded?: boolean; // true si petit-déjeuner inclus dans le prix
  description?: string;
}

// ============================================
// Types pour les transports locaux
// ============================================

export interface LocalTransport {
  id: string;
  type: 'taxi' | 'uber' | 'public_transport' | 'rental_car' | 'shuttle' | 'walk';
  from: string;
  fromCoords: { lat: number; lng: number };
  to: string;
  toCoords: { lat: number; lng: number };
  duration: number; // en minutes
  distance: number; // en km
  estimatedPrice?: number;
  currency?: string;
  instructions?: string[];
  departureTime?: string;
  arrivalTime?: string;
}

// ============================================
// Types pour les segments de trajet
// ============================================

export type TripSegmentType =
  | 'home_to_airport'
  | 'parking'
  | 'check_in'
  | 'flight'
  | 'airport_to_hotel'
  | 'hotel_checkin'
  | 'activity'
  | 'restaurant'
  | 'hotel_checkout'
  | 'return_flight'
  | 'airport_to_home';

export interface TripSegment {
  id: string;
  type: TripSegmentType;
  dayNumber: number;
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  location: {
    name: string;
    address?: string;
    latitude: number;
    longitude: number;
  };
  // Données spécifiques selon le type
  flight?: Flight;
  parking?: ParkingOption;
  restaurant?: Restaurant;
  accommodation?: Accommodation;
  localTransport?: LocalTransport;
  // Méta
  estimatedCost?: number;
  currency?: string;
  bookingUrl?: string;
  bookingRequired?: boolean;
  isBooked?: boolean;
  notes?: string;
  orderIndex: number;
}

// Types pour l'itinéraire généré

export type TripItemType = 'activity' | 'restaurant' | 'hotel' | 'transport' | 'flight' | 'parking' | 'checkin' | 'checkout' | 'luggage';

export interface TripItem {
  id: string;
  dayNumber: number;
  startTime: string; // Format "HH:mm"
  endTime: string;
  type: TripItemType;
  title: string;
  description: string;
  locationName: string;
  latitude: number;
  longitude: number;
  orderIndex: number;
  estimatedCost?: number;
  duration?: number; // en minutes
  imageUrl?: string;
  bookingUrl?: string;
  rating?: number;
  // Données enrichies
  flight?: Flight;
  parking?: ParkingOption;
  restaurant?: Restaurant;
  accommodation?: Accommodation;
  localTransport?: LocalTransport;
  // Distance/temps par rapport à l'item précédent
  distanceFromPrevious?: number; // en km
  timeFromPrevious?: number; // en minutes
  transportToPrevious?: 'walk' | 'car' | 'public' | 'taxi';
  // Informations de transport détaillées
  transitInfo?: {
    lines: { number: string; mode: 'bus' | 'metro' | 'tram' | 'train' | 'ferry'; color?: string }[];
    walkingDistance?: number; // mètres de marche
    steps?: string[]; // Instructions textuelles
    source?: 'google' | 'openroute' | 'estimated';
  };
  googleMapsUrl?: string; // Lien pour ouvrir l'itinéraire dans Google Maps
  googleMapsPlaceUrl?: string; // Lien de recherche Google Maps par nom (plus fiable que GPS!)
  dataReliability?: 'verified' | 'estimated' | 'generated'; // Fiabilité des données
}

export interface TripDay {
  dayNumber: number;
  date: Date;
  items: TripItem[];
  // Résumé du jour
  totalDistance?: number;
  totalCost?: number;
  weatherForecast?: {
    condition: string;
    tempMin: number;
    tempMax: number;
    icon: string;
  };
  // Itinéraire intelligent (Claude curation)
  theme?: string;
  dayNarrative?: string;
  isDayTrip?: boolean;
  dayTripDestination?: string;
}

// Options de transport comparées
export interface TransportOptionSummary {
  id: string;
  mode: 'plane' | 'train' | 'bus' | 'car' | 'combined';
  totalDuration: number;      // minutes
  totalPrice: number;         // euros
  totalCO2: number;           // kg CO2
  score: number;              // note /10
  scoreDetails: {
    priceScore: number;       // /10
    timeScore: number;        // /10
    co2Score: number;         // /10
  };
  segments: {
    mode: string;
    from: string;
    to: string;
    duration: number;
    price: number;
    operator?: string;
  }[];
  bookingUrl?: string;
  recommended?: boolean;
  recommendationReason?: string;
  dataSource?: 'api' | 'estimated';
}

export interface Trip {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  preferences: TripPreferences;
  days: TripDay[];
  // Options de transport comparées (pour affichage)
  transportOptions?: TransportOptionSummary[];
  selectedTransport?: TransportOptionSummary;
  // Vols (si avion sélectionné)
  outboundFlight?: Flight;
  returnFlight?: Flight;
  // Hébergement principal
  accommodation?: Accommodation;
  // Options d'hébergement (pour sélection utilisateur)
  accommodationOptions?: Accommodation[];
  // Parking
  parking?: ParkingOption;
  // Coûts
  totalEstimatedCost?: number;
  costBreakdown?: {
    flights: number;
    accommodation: number;
    food: number;
    activities: number;
    transport: number;
    parking: number;
    other: number;
  };
  // Infos pratiques voyage
  travelTips?: {
    vocabulary: {
      language: string;
      phrases: { original: string; translation: string; phonetic?: string; context: string }[];
    };
    packing: {
      essentials: { item: string; reason: string }[];
      plugType?: string;
      voltage?: string;
    };
    legal: {
      visaInfo: { originCountry: string; requirement: string }[];
      importantLaws: string[];
      disclaimer: string;
    };
    emergency: {
      police: string;
      ambulance: string;
      fire: string;
      generalEmergency: string;
      embassy?: string;
      otherNumbers?: { label: string; number: string }[];
    };
  };
  // Empreinte carbone
  carbonFootprint?: {
    total: number; // kg CO2
    flights: number;
    accommodation: number;
    localTransport: number;
    rating: 'A' | 'B' | 'C' | 'D' | 'E';
    equivalents: {
      treesNeeded: number;
      carKmEquivalent: number;
    };
    tips: string[];
  };
}

// Types pour le Tricount (Phase 3)

export interface Participant {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface Expense {
  id: string;
  tripId: string;
  title: string;
  amount: number;
  currency: string;
  paidBy: string; // Participant ID
  splitBetween: string[]; // Participant IDs
  category: 'transport' | 'accommodation' | 'food' | 'activity' | 'other';
  date: Date;
  createdAt: Date;
}

export interface Balance {
  participantId: string;
  amount: number; // Positif = on lui doit, Négatif = il doit
}

// Labels pour l'UI

export const TRANSPORT_LABELS: Record<TransportType, string> = {
  optimal: 'Optimal (recommandé) 🎯',
  plane: 'Avion ✈️',
  train: 'Train 🚄',
  car: 'Voiture 🚗',
  bus: 'Bus 🚌',
};

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  solo: 'Solo 🧑',
  couple: 'Couple 💑',
  friends: 'Amis 👥',
  family_with_kids: 'Famille avec enfants 👨‍👩‍👧‍👦',
  family_without_kids: 'Famille sans enfants 👫',
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  beach: 'Plage & Détente 🏖️',
  nature: 'Nature & Randonnée 🥾',
  culture: 'Culture & Musées 🏛️',
  gastronomy: 'Gastronomie 🍽️',
  nightlife: 'Vie nocturne 🍸',
  shopping: 'Shopping 🛍️',
  adventure: 'Aventure & Sport 🏄',
  wellness: 'Bien-être & Spa 💆',
};

export const DIETARY_LABELS: Record<DietaryType, string> = {
  none: 'Aucun',
  vegetarian: 'Végétarien 🥗',
  vegan: 'Vegan 🌱',
  halal: 'Halal',
  kosher: 'Casher',
  gluten_free: 'Sans gluten',
};

export const BUDGET_LABELS: Record<BudgetLevel, { label: string; range: string; min: number; max: number }> = {
  economic: { label: 'Économique', range: '< 500€', min: 0, max: 500 },
  moderate: { label: 'Modéré', range: '500 - 1500€', min: 500, max: 1500 },
  comfort: { label: 'Confort', range: '1500 - 3000€', min: 1500, max: 3000 },
  luxury: { label: 'Luxe', range: '3000€+', min: 3000, max: 10000 },
};

export const TRIP_ITEM_COLORS: Record<TripItemType, string> = {
  activity: '#3B82F6', // blue
  restaurant: '#F97316', // orange
  hotel: '#8B5CF6', // purple
  transport: '#10B981', // green
  flight: '#EC4899', // pink
  parking: '#6B7280', // gray
  checkin: '#8B5CF6', // purple (same as hotel)
  checkout: '#8B5CF6', // purple (same as hotel)
  luggage: '#F59E0B', // amber - consigne bagages
};

import type { Attraction } from '../services/attractions';

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

export type MealStrategy = 'self_catered' | 'restaurant' | 'mixed';

// ============================================
// Types pour le multi-villes / road trip
// ============================================

export interface CityStage {
  city: string;
  days: number;
  coords?: { lat: number; lng: number };
}

// ============================================
// Types pour les suggestions AI
// ============================================

export interface DurationSuggestion {
  optimal: number;
  minimum: number;
  maximum: number;
  reasoning: string;
  highlights: Record<string, string>; // ex: { "3": "Essentiels", "5": "Confortable", "7": "Complet" }
}

export interface DestinationSuggestion {
  title: string;
  type: 'single_city' | 'multi_city' | 'road_trip';
  stages: CityStage[];
  highlights: string[];
  description: string;
  estimatedBudget: string;
  bestSeason?: string;
}

export interface BudgetStrategy {
  accommodationType: 'airbnb_with_kitchen' | 'hotel' | 'hostel';
  accommodationBudgetPerNight: number;
  mealsStrategy: {
    breakfast: MealStrategy;
    lunch: MealStrategy;
    dinner: MealStrategy;
  };
  groceryShoppingNeeded: boolean;
  activitiesLevel: 'mostly_free' | 'mixed' | 'premium';
  dailyActivityBudget: number;
  maxPricePerActivity: number; // Prix max par activité individuelle (€/personne)
  transportTips: string;
  reasoning: string;
}

export interface ResolvedBudget {
  totalBudget: number;
  perPersonBudget: number;
  perPersonPerDay: number;
  budgetLevel: BudgetLevel;
}

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
  budgetIsPerPerson?: boolean; // true = budgetCustom est par personne, false = total

  // Étape 5 - Activités & Préférences
  activities: ActivityType[];
  dietary: DietaryType[];
  mealPreference?: 'auto' | 'mostly_cooking' | 'mostly_restaurants' | 'balanced'; // Préférence repas
  mustSee: string;

  // Multi-villes / Road trip
  tripMode?: 'precise' | 'inspired';
  cityPlan?: CityStage[];

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
  badges?: string[]; // TripAdvisor badges (Michelin, Travelers' Choice, etc.)
  dataReliability?: 'verified' | 'estimated' | 'generated'; // Fiabilité des coordonnées GPS
  googlePlaceId?: string; // Google Places place_id pour récupérer la vraie photo
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
  dataReliability?: 'verified' | 'estimated' | 'generated'; // Fiabilité des coordonnées GPS
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

export type TripItemType = 'activity' | 'restaurant' | 'hotel' | 'transport' | 'flight' | 'parking' | 'checkin' | 'checkout' | 'luggage' | 'free_time';

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
  viatorUrl?: string;  // Lien Viator (activités/tours)
  tiqetsUrl?: string;  // Lien Tiqets (billets musées/attractions)
  rating?: number;
  // Données enrichies
  flight?: Flight;
  flightAlternatives?: Flight[]; // Autres vols disponibles (scrollable)
  aviasalesUrl?: string; // Lien affilié Aviasales (en plus du bookingUrl Google Flights)
  omioFlightUrl?: string; // Lien Omio pour les vols (en complément d'Aviasales)
  originalOmioUrl?: string; // URL Omio directe avant wrapping Impact tracking
  parking?: ParkingOption;
  restaurant?: Restaurant;
  restaurantAlternatives?: Restaurant[]; // Top 2-3 restaurants alternatifs classés par qualité/distance
  accommodation?: Accommodation;
  localTransport?: LocalTransport;
  // Distance/temps par rapport à l'item précédent
  distanceFromPrevious?: number; // en km
  timeFromPrevious?: number; // en minutes
  transportToPrevious?: 'walk' | 'car' | 'public' | 'taxi';
  // Normalized transport metadata for rendering/analytics
  transportMode?: 'train' | 'bus' | 'car' | 'ferry' | 'walking' | 'transit';
  transportRole?: 'longhaul' | 'hotel_depart' | 'hotel_return' | 'inter_item';
  // Informations de transport détaillées
  transitInfo?: {
    lines: { number: string; mode: 'bus' | 'metro' | 'tram' | 'train' | 'ferry'; color?: string }[];
    walkingDistance?: number; // mètres de marche
    steps?: string[]; // Instructions textuelles
    source?: 'google' | 'openroute' | 'estimated';
  };
  // Legs détaillés du trajet (DB HAFAS) — horaires réels, numéros de train, correspondances
  transitLegs?: {
    mode: 'train' | 'bus' | 'ferry';
    from: string;           // Gare de départ (ex: "Paris Gare du Nord")
    to: string;             // Gare d'arrivée (ex: "Amsterdam Centraal")
    departure: string;      // ISO datetime
    arrival: string;        // ISO datetime
    duration: number;       // minutes
    operator?: string;      // "Deutsche Bahn", "SNCF", etc.
    line?: string;          // "ICE 775", "TGV 9321", "Eurostar 9141"
  }[];
  transitDataSource?: 'api' | 'estimated'; // Source des données transit
  priceRange?: [number, number]; // [min, max] pour affichage "de X€ à Y€"
  googleMapsUrl?: string; // Lien pour ouvrir l'itinéraire dans Google Maps
  googleMapsPlaceUrl?: string; // Lien de recherche Google Maps par nom (plus fiable que GPS!)
  dataReliability?: 'verified' | 'estimated' | 'generated'; // Fiabilité des données
  // Titre de l'activité Viator (si différent du titre de l'activité)
  // Ex: "Piazza Navona" → "Rome Walking Tour: Pantheon, Piazza Navona and Trevi Fountain"
  viatorTitle?: string;
  // Viator product card data
  viatorImageUrl?: string;
  viatorRating?: number;
  viatorReviewCount?: number;
  viatorPrice?: number; // Prix du produit Viator (peut différer de estimatedCost qui est le prix d'entrée officiel)
  viatorDuration?: number; // Durée réelle du produit Viator en minutes
  // Viator flags
  freeCancellation?: boolean;
  instantConfirmation?: boolean;
}

export interface TripDay {
  dayNumber: number;
  date: Date;
  items: TripItem[];
  geoDiagnostics?: {
    maxLegKm: number;
    p95LegKm: number;
    totalTravelMin: number;
  };
  // Résumé du jour
  totalDistance?: number;
  totalCost?: number;
  weatherForecast?: {
    condition: string;
    tempMin: number;
    tempMax: number;
    icon: string;
  };
  // Budget détaillé par jour (€ par personne)
  dailyBudget?: {
    activities: number;
    food: number;
    transport: number;
    total: number;
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
  mode: 'plane' | 'train' | 'bus' | 'car' | 'combined' | 'ferry';
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
  priceRange?: [number, number]; // [min, max] prix pour affichage
  // Legs détaillés DB HAFAS (horaires réels, numéros de train, correspondances)
  transitLegs?: {
    mode: 'train' | 'bus' | 'ferry';
    from: string;
    to: string;
    departure: string;
    arrival: string;
    duration: number;
    operator?: string;
    line?: string;
  }[];
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
  // Pool d'activités rankées (pour swap et insert day intelligent)
  attractionPool?: Attraction[];
  // Activités alternatives (scorées mais non programmées, top 20 par score)
  alternativeActivities?: Attraction[];
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
  // Stratégie budget
  budgetStrategy?: BudgetStrategy;
  budgetStatus?: {
    target: number;
    estimated: number;
    difference: number;
    isOverBudget: boolean;
  };
  // Empreinte carbone
  carbonFootprint?: {
    total: number; // kg CO2
    flights: number;
    accommodation: number;
    localTransport: number;
    food: number;
    activities: number;
    rating: 'A' | 'B' | 'C' | 'D' | 'E';
    equivalents: {
      treesNeeded: number;
      carKmEquivalent: number;
    };
    tips: string[];
  };
  // État des réservations
  bookedItems?: Record<string, {
    booked: boolean;
    bookedAt?: string; // ISO date string
    notes?: string; // Numéro de confirmation, etc.
  }>;
  // Liste de bagages
  packingList?: {
    items: Array<{
      id: string;
      label: string;
      category: string;
      checked: boolean;
      isCustom?: boolean;
    }>;
  };
  // Documents et billets
  documents?: {
    items: Array<{
      id: string;
      name: string;
      type: 'flight_ticket' | 'hotel_booking' | 'activity_ticket' | 'insurance' | 'visa' | 'passport' | 'other';
      fileUrl?: string; // Supabase Storage URL
      fileSize?: number;
      mimeType?: string;
      uploadedAt: string;
      uploadedBy?: string;
      notes?: string;
      linkedActivityId?: string; // optional link to a specific activity
    }>;
  };
  // Lieux importés depuis Google Maps
  importedPlaces?: {
    items: ImportedPlace[];
    importedAt: string; // ISO date string
    source: string; // description de la source (filename, etc.)
  };
}

// Types pour les lieux importés
export interface ImportedPlace {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string;
  notes?: string;
  sourceUrl?: string;
  source: 'google_takeout' | 'kml' | 'url' | 'manual' | 'social_media';
}

// Types pour l'import depuis les réseaux sociaux
export interface SocialMediaExtraction {
  platform: 'instagram' | 'tiktok' | 'youtube' | 'blog' | 'unknown';
  sourceUrl?: string;
  places: ImportedPlace[];
  rawText?: string;
  confidence: number;
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
  free_time: '#22C55E', // green - temps libre
};

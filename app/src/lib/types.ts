import type { Attraction } from './services/attractions';

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
  dataReliability?: 'verified' | 'estimated' | 'generated'; // Fiabilité des coordonnées GPS
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

// ============================================
// Types pour le Chatbot de modification
// ============================================

export type ModificationIntentType =
  | 'shift_times'      // Décaler les horaires (me lever plus tard)
  | 'swap_activity'    // Remplacer une activité par une autre
  | 'add_activity'     // Ajouter une nouvelle activité
  | 'remove_activity'  // Supprimer une activité
  | 'extend_free_time' // Plus de temps libre
  | 'reorder_day'      // Réorganiser l'ordre des activités
  | 'change_restaurant'// Changer un restaurant
  | 'adjust_duration'  // Modifier la durée d'une activité
  | 'add_day'          // Ajouter un jour au voyage
  | 'clarification'    // Besoin de clarification
  | 'general_question';// Question générale (pas de modification)

export interface ModificationIntent {
  type: ModificationIntentType;
  confidence: number; // 0-1
  parameters: {
    dayNumbers?: number[];      // Jours concernés
    targetActivity?: string;    // Activité ciblée (nom ou id)
    targetItemId?: string;      // ID de l'item ciblé
    newValue?: string;          // Nouvelle valeur/activité
    timeShift?: number;         // Décalage en minutes
    direction?: 'later' | 'earlier'; // Direction du décalage
    scope?: 'morning_only' | 'afternoon_only' | 'full_day'; // Portée du décalage temporel
    mealType?: 'breakfast' | 'lunch' | 'dinner'; // Type de repas si restaurant
    cuisineType?: string;       // Type de cuisine demandée
    duration?: number;          // Durée souhaitée en minutes
    insertAfterDay?: number;    // Insérer un jour APRÈS ce numéro de jour
  };
  explanation: string; // Explication de ce que l'utilisateur veut
}

export type TripChangeType = 'add' | 'remove' | 'update' | 'move';

export interface TripChange {
  type: TripChangeType;
  dayNumber: number;
  itemId?: string;
  before?: Partial<TripItem>;
  after?: Partial<TripItem>;
  newItem?: TripItem; // Pour les ajouts
  description: string;
}

export interface ModificationResult {
  success: boolean;
  changes: TripChange[];
  explanation: string;      // Réponse conversationnelle
  warnings: string[];       // Avertissements (conflits potentiels)
  newDays: TripDay[];       // Nouvel état des jours après modification
  rollbackData: TripDay[];  // État avant modification (pour undo)
  errorInfo?: ChatErrorInfo; // Info d'erreur structurée (quand success === false)
}

export interface ChatMessage {
  id: string;
  tripId: string;
  userId?: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: ModificationIntent | null;
  changesApplied?: TripChange[] | null;
  errorInfo?: ChatErrorInfo | null;
  createdAt: Date;
}

export interface ChatResponse {
  reply: string;
  intent: ModificationIntent | null;
  changes: TripChange[] | null;
  previewDays: TripDay[] | null;
  requiresConfirmation: boolean;
  warnings: string[];
  suggestions?: ContextualSuggestion[];
  errorInfo?: ChatErrorInfo;
}

// ============================================
// Suggestions contextuelles
// ============================================

export interface ContextualSuggestion {
  label: string;    // Texte court affiché sur le chip
  prompt: string;   // Message complet envoyé au chatbot
  icon?: string;    // Emoji optionnel pour le chip
}

// ============================================
// Mémoire conversationnelle
// ============================================

export interface ConversationContext {
  recentExchanges: Array<{
    userMessage: string;
    assistantReply: string;
    intent?: string;
  }>;
}

// ============================================
// Erreurs structurées
// ============================================

export type ChatErrorType =
  | 'schedule_conflict'
  | 'budget_exceeded'
  | 'immutable_item'
  | 'item_not_found'
  | 'no_slot_available'
  | 'constraint_violation'
  | 'unknown';

export interface ChatErrorInfo {
  type: ChatErrorType;
  message: string;
  alternativeSuggestion?: ContextualSuggestion;
}

export interface TripConstraint {
  itemId: string;
  type: 'immutable' | 'time_locked' | 'booking_required';
  reason: string;
}

export const SUGGESTED_CHAT_PROMPTS = [
  { label: 'Me lever plus tard', prompt: 'Je veux me lever plus tard le matin' },
  { label: 'Plus de temps libre', prompt: "J'aimerais plus de temps libre l'après-midi" },
  { label: 'Changer un restaurant', prompt: 'Change le restaurant du ' },
  { label: 'Ajouter une activité', prompt: 'Ajoute ' },
  { label: 'Supprimer une visite', prompt: 'Supprime ' },
  { label: 'Réorganiser la journée', prompt: 'Réorganise le jour ' },
  { label: 'Ajouter un jour', prompt: 'Ajoute un jour libre entre le jour ' },
] as const;

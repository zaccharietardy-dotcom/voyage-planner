/**
 * Pipeline V2 — Types internes
 */

import type { Attraction } from '../services/attractions';
import type { DayTripSuggestion } from '../services/dayTripSuggestions';
import type { AirportInfo } from '../services/geocoding';
import type {
  Restaurant,
  Accommodation,
  TransportOptionSummary,
  BudgetStrategy,
  ResolvedBudget,
  TripPreferences,
  Flight,
} from '../types';

// ============================================
// Pipeline Event System — real-time monitoring
// ============================================
export type PipelineEvent = {
  type: 'step_start' | 'step_done' | 'api_call' | 'api_done' | 'info' | 'warning' | 'error';
  step?: number;
  stepName?: string;
  label?: string;
  durationMs?: number;
  detail?: string;
  timestamp: number;
};

export type OnPipelineEvent = (event: PipelineEvent) => void;

// ============================================
// Step 1: Fetched Data
// ============================================

export interface FetchedData {
  // Coordinates
  destCoords: { lat: number; lng: number };
  originCoords: { lat: number; lng: number };
  originAirports: AirportInfo[];
  destAirports: AirportInfo[];

  // Activities from multiple sources
  googlePlacesAttractions: Attraction[];
  serpApiAttractions: Attraction[];
  overpassAttractions: Attraction[];
  viatorActivities: Attraction[];
  mustSeeAttractions: Attraction[];

  // Restaurants from multiple sources
  tripAdvisorRestaurants: Restaurant[];
  serpApiRestaurants: Restaurant[];

  // Hotels
  bookingHotels: Accommodation[];

  // Transport
  transportOptions: TransportOptionSummary[];

  // Flights (resolved separately after transport selection)
  outboundFlight: Flight | null;
  returnFlight: Flight | null;
  flightAlternatives: { outbound: Flight[]; return: Flight[] };

  // Weather
  weatherForecasts: { date: string; tempMin: number; tempMax: number; condition: string; icon: string; weatherCode?: number }[];

  // Day Trips
  dayTripSuggestions: DayTripSuggestion[];
  dayTripActivities: Record<string, Attraction[]>;     // key = dayTripName (e.g. "Versailles")
  dayTripRestaurants: Record<string, Restaurant[]>;     // key = dayTripName

  // Ancillary
  travelTips: any;
  budgetStrategy: BudgetStrategy;
  resolvedBudget: ResolvedBudget;
}

// ============================================
// Step 2: Scored Activities
// ============================================

export interface ScoredActivity extends Attraction {
  score: number;
  source: 'google_places' | 'serpapi' | 'overpass' | 'viator' | 'mustsee';
  reviewCount: number;
}

// ============================================
// Step 3: Activity Clusters
// ============================================

export interface ActivityCluster {
  dayNumber: number;
  activities: ScoredActivity[];
  centroid: { lat: number; lng: number };
  totalIntraDistance: number; // km, within cluster
  maxRadius?: number; // km, max distance from centroid to any member
}

// ============================================
// Step 3b: City Density Profile
// ============================================

export interface CityDensityProfile {
  /** 75th percentile of all pairwise activity distances (km) */
  p75PairwiseDistance: number;
  /** Median of all pairwise activity distances (km) */
  medianPairwiseDistance: number;
  /** Derived maximum cluster radius for a single day (km) */
  maxClusterRadius: number;
  /** Density category for logging */
  densityCategory: 'dense' | 'medium' | 'spread';
}

// ============================================
// Step 4: Meal Assignments
// ============================================

export interface MealAssignment {
  dayNumber: number;
  mealType: 'breakfast' | 'lunch' | 'dinner';
  restaurant: Restaurant | null; // null = self-catered
  restaurantAlternatives: Restaurant[]; // 2e et 3e choix (classés par qualité/distance)
  referenceCoords: { lat: number; lng: number };
  fallbackMode?: 'self_catered'; // Suggestion explicite "cuisine maison" (budget balancing)
}

/** Return type of assignRestaurants() — includes the full geo-filtered restaurant pool
 *  for post-geoOptimize re-optimization in step 7 */
export interface RestaurantAssignmentResult {
  meals: MealAssignment[];
  restaurantGeoPool: Restaurant[]; // Full pool with valid coords for step7 re-optimization
}

// ============================================
// Step 6: Claude Balanced Plan
// ============================================

export interface BalancedDay {
  dayNumber: number;
  theme: string;
  dayNarrative: string;
  activityOrder: string[]; // Activity IDs in visit order
  suggestedStartTime: string; // e.g. "09:00"
  restBreak: boolean;
  isDayTrip: boolean;
  dayTripDestination?: string;
}

export interface BalancedPlan {
  days: BalancedDay[];
  dayOrderReason: string;
}

// ============================================
// Pipeline V2 LLM — Types
// ============================================

export interface LLMActivityInput {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  duration: number;
  rating: number;
  reviewCount: number;
  mustSee: boolean;
  estimatedCost: number;
  bookingRequired: boolean;
  openingHours?: Record<string, { open: string; close: string } | null>;
  viatorAvailable: boolean;
  isOutdoor: boolean;
  description?: string;
  dayTripDestination?: string; // non-null → activity belongs to a day trip
}

export interface LLMRestaurantInput {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number;
  priceLevel: number;
  cuisineTypes: string[];
  suitableFor: ('breakfast' | 'lunch' | 'dinner')[];
  openingHours?: Record<string, { open: string; close: string } | null>;
  dayTripDestination?: string; // non-null → restaurant at day trip destination
}

export interface LLMDistanceEntry {
  km: number;
  walkMin: number;
}

export interface LLMPlannerInput {
  trip: {
    destination: string;
    origin: string;
    startDate: string;
    durationDays: number;
    groupType: string;
    groupSize: number;
    budgetLevel: string;
    arrivalTime: string | null;
    departureTime: string | null;
    preferredActivities: string[];
    mustSeeRequested: string;
    dayTrips: Array<{
      name: string;
      destination: string;           // e.g. "Versailles"
      distanceKm: number;
      transportMode: string;
      transportDurationMin: number;
      transportCostPerPerson: number;
      forcedDate?: string;            // ISO date from prePurchasedTickets
      fullDayRequired: boolean;
      activityIds: string[];
      restaurantIds: string[];
      coordinates: { lat: number; lng: number };
    }>;
  };
  hotel: {
    name: string;
    lat: number;
    lng: number;
    checkIn: string;
    checkOut: string;
  } | null;
  activities: LLMActivityInput[];
  restaurants: LLMRestaurantInput[];
  distances: Record<string, LLMDistanceEntry>;
  weather: { day: number; condition: string; tempMin: number; tempMax: number }[];
}

// Output de Claude
export interface LLMDayItem {
  type: 'activity' | 'restaurant';
  activityId?: string;
  restaurantId?: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner';
  startTime: string;
  endTime: string;
  duration: number;
}

export interface LLMDayPlan {
  dayNumber: number;
  theme: string;
  narrative: string;
  items: LLMDayItem[];
  isDayTrip?: boolean;
  dayTripDestination?: string;
}

export interface LLMPlannerOutput {
  days: LLMDayPlan[];
  unusedActivities: string[];
  reasoning: string;
}

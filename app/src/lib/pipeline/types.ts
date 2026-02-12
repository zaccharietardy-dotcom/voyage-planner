/**
 * Pipeline V2 — Types internes
 */

import type { Attraction } from '../services/attractions';
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

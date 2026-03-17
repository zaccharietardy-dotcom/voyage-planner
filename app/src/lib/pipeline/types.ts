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

  // ── Trust layer (Phase 1 — internal planner fields, no prod surface impact) ──
  /** Confidence in GPS coordinates: high = verified multi-source, low = single source or geocode fallback */
  coordinateConfidence?: 'high' | 'medium' | 'low';
  /** Numeric coordinate confidence score (0-1) for ranking */
  coordinateConfidenceScore?: number;
  /** Confidence in duration estimate */
  durationConfidence?: 'high' | 'medium' | 'low';
  /** Affinity to a day trip destination (0 = city, 1 = strongly associated with a day trip) */
  dayTripAffinity?: number;
  /** Why this activity is protected from swaps/eviction */
  protectedReason?: 'must_see' | 'day_trip_anchor' | 'day_trip' | 'user_forced';
  /** Inferred geographic zone hint for clustering */
  zoneHint?: string;
  /** Coarse planner zone used by v3.2 for same-day and adjacent-day grouping */
  macroZoneId?: string;
  /** Planner-only family bucket used for diversity caps */
  poiFamily?: string;
  /** Arrival/departure fatigue tag assigned by planner heuristics */
  fatigueRole?: 'standard' | 'long_haul';
  /** Day-trip destination envelope identifier for atomic packs */
  destinationEnvelopeId?: string;
  /** Stable internal token for planner/scheduler repair coordination */
  planningToken?: string;
  /** Day trip pack source for protected atomic units */
  sourcePackId?: string;
  /** Preferred time of day for this activity (inferred from type/hours) */
  preferredTimeSlot?: 'morning' | 'afternoon' | 'evening' | 'anytime';
  /** Planner role assigned to the activity's day */
  plannerRole?: 'arrival' | 'full_city' | 'day_trip' | 'recovery' | 'departure' | 'short_full_day';
  /** Original day number from the planner before any repair pass */
  originalDayNumber?: number;
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
  isFullDay?: boolean; // true if cluster contains a single full-day activity (>=4h)
  isDayTrip?: boolean; // true if cluster is a day trip to a distant destination
  dayTripDestination?: string; // e.g. "Pompei"
  plannerRole?: 'arrival' | 'full_city' | 'day_trip' | 'recovery' | 'departure' | 'short_full_day';
}

// ============================================
// Step 2d: DayTripPack (Phase 2)
// ============================================

export interface DayTripPack {
  /** Stable internal pack ID */
  id: string;
  /** The primary must-see or anchor activity that triggers the day trip */
  anchor: ScoredActivity;
  /** All activities at the day trip destination (anchor + enrichment) */
  activities: ScoredActivity[];
  /** Destination name (e.g. "Pompei", "Versailles") */
  destination: string;
  /** Outbound travel time in minutes */
  outboundDurationMin: number;
  /** Return travel time in minutes */
  returnDurationMin: number;
  /** Slack buffer in minutes (default 60) */
  slackMin: number;
  /** Confidence in transport duration estimate */
  transportConfidence: 'high' | 'medium' | 'low';
  /** Transport mode */
  transportMode: string;
  /** Original scored activities that created this pack (for safe demotion) */
  originalCandidates?: ScoredActivity[];
  /** Total minimum useful window required for this pack, including lunch + slack */
  requiredWindowMin?: number;
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
  /** Hard cap on cluster radius (km). Adaptive: 5km for compact cities, up to 15km for spread cities. */
  hardRadiusCap: number;

  // ── Planner budgets (Phase 1) ──
  /** Max distance for an urban leg before penalty (km). Dense=2, Medium=3.5, Spread=6 */
  urbanLegBudgetKm?: number;
  /** Distance threshold to classify as day trip candidate (km). Dense=10, Medium=15, Spread=20 */
  dayTripThresholdKm?: number;
  /** Multiplier for swap radius during inter-cluster optimization. Dense=1.0, Medium=1.3, Spread=1.8 */
  swapRadiusFactor?: number;
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
  /** Pre-planned day-trip days (injected by step2, used by buildUserPrompt + buildFallbackPlan) */
  prePlannedDayTripDays?: LLMDayPlan[];
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

/**
 * Return type of prepareDataForLLM() — includes both the LLM input
 * and pre-planned day-trip days that bypass the LLM.
 */
export interface PreparedLLMData {
  llmInput: LLMPlannerInput;
  prePlannedDayTripDays: LLMDayPlan[];
  reservedDayNumbers: number[];
}

// ============================================
// Planner Diagnostics — structured per-run metrics
// ============================================

export interface PlannerDiagnostics {
  /** Which planner produced this result */
  plannerVersion: 'v3.0' | 'v3.1' | 'v3.2';
  /** Was beam search used (v3.1 only) */
  beamUsed: boolean;
  /** Did beam search fall back to greedy (v3.1 only) */
  beamFallbackUsed: boolean;
  /** Number of DayTripPack created (v3.1 only) */
  dayTripPackCount: number;
  /** Number of repairs rejected for quality (v3.1 only) */
  repairRejectedCount: number;
  /** Total zigzag turns across all days */
  zigzagTurnsTotal: number;
  /** Total route inefficiency across all days */
  routeInefficiencyTotal: number;
  /** Number of critical geo issues */
  criticalGeoCount: number;
  /** Whether contracts passed */
  contractsPassed: boolean;
  /** Active rescue stage for v3.1 */
  rescueStage?: number;
  /** Protected items broken by late passes */
  protectedBreakCount?: number;
  /** Meals replaced only at final integrity / late safety */
  lateMealReplacementCount?: number;
  /** Cluster day numbers without matching time windows */
  dayNumberMismatchCount?: number;
  /** Day trip items evicted or moved out of their original day */
  dayTripEvictionCount?: number;
  /** Final integrity issues left unresolved */
  finalIntegrityFailures?: number;
  /** Non-longhaul transport items left without valid adjacent stops */
  orphanTransportCount?: number;
  /** Large inter-stop legs left without explicit transport */
  teleportLegCount?: number;
  /** Day narratives/themes generated before final itinerary stabilization */
  staleNarrativeCount?: number;
  /** free_time blocks beyond v3.2 role budgets */
  freeTimeOverBudgetCount?: number;
  /** Number of self_meal_fallback meals in final output */
  mealFallbackCount?: number;
  /** Number of days whose inter-item transport chain was rebuilt */
  routeRebuildCount?: number;
  /** Protected must-see placements missing from the final plan */
  missingProtectedMustSeeCount?: number;
  /** Day-trip items that leaked out of a day-trip day, or city items that leaked in */
  dayTripAtomicityBreakCount?: number;
}

// ============================================
// V3.2 Semantic Scheduler — Internal Types
// ============================================

export interface ScheduledStop {
  id: string;
  dayNumber: number;
  kind: 'breakfast' | 'checkin' | 'activity' | 'lunch' | 'dinner' | 'checkout' | 'free_time' | 'outbound' | 'return';
  title: string;
  startTime: string;
  endTime: string;
  latitude: number;
  longitude: number;
  fixed?: boolean;
  mealType?: 'breakfast' | 'lunch' | 'dinner';
  activity?: ScoredActivity;
  restaurant?: Restaurant;
  qualityFlags?: string[];
  protectedReason?: ScoredActivity['protectedReason'];
}

export interface ScheduledDayPlan {
  dayNumber: number;
  role?: ActivityCluster['plannerRole'];
  isDayTrip?: boolean;
  dayTripDestination?: string;
  stops: ScheduledStop[];
}

export interface MaterializedLeg {
  fromId: string;
  toId: string;
  distanceKm: number;
  durationMinutes: number;
  mode: 'walk' | 'public' | 'car';
  polyline?: string;
}

/**
 * Pipeline V2 — Step 2: Prepare data for LLM
 *
 * Takes the raw fetched data from step1 and prepares structured JSON input for Claude.
 * This includes:
 * - Merging and deduplicating activities from multiple sources
 * - Scoring and selecting top N activities
 * - Selecting restaurants with meal type classification
 * - Building a distance matrix for efficient routing
 * - Formatting all data for LLM consumption
 */

import type {
  FetchedData,
  ScoredActivity,
  LLMPlannerInput,
  LLMActivityInput,
  LLMRestaurantInput,
  LLMDistanceEntry,
  PreparedLLMData,
} from './types';
import { buildDayTripDays } from './utils/day-trip-builder';
import type { DayTripSuggestion } from '../services/dayTripSuggestions';
import type {
  TripPreferences,
  Accommodation,
  Restaurant,
  TransportOptionSummary,
  Flight,
} from '../types';
import type { Attraction } from '../services/attractions';
import { calculateDistance } from '../services/geocoding';
import { dedupeActivitiesBySimilarity } from './utils/activityDedup';
import { getMinDuration, estimateActivityCost } from './utils/constants';
import { searchGooglePlacesAttractions } from './services/googlePlacesAttractions';
import { searchRestaurantsWithFallback } from '../services/serpApiPlaces';

// ============================================
// 1. Merge and deduplicate activities
// ============================================

/**
 * Merges activities from all sources and removes duplicates.
 */
function mergeAndDeduplicateActivities(data: FetchedData): Attraction[] {
  // Concatenate all sources — MUST-SEE FIRST so they win in dedup (first-seen-wins)
  const allActivities: Attraction[] = [
    ...data.mustSeeAttractions,        // Must-sees first: they survive dedup and keep their flag
    ...data.googlePlacesAttractions,
    ...data.serpApiAttractions,
    ...data.overpassAttractions,
    ...data.viatorActivities,
  ];

  // Apply deduplication
  const { deduped, dropped } = dedupeActivitiesBySimilarity(allActivities);

  console.log(
    `[Pipeline V2 LLM] Step 2: Merged ${allActivities.length} activities → ${deduped.length} after dedup (dropped ${dropped})`
  );

  return deduped;
}

// ============================================
// 2. Score and select activities for LLM
// ============================================

/**
 * Filters out invalid activities BEFORE scoring.
 */
function isValidActivity(a: Attraction, preferences: TripPreferences): boolean {
  // Exclude permanently closed
  if (a.businessStatus === 'CLOSED_PERMANENTLY') {
    return false;
  }

  // Exclude invalid GPS coordinates
  if (!a.latitude || !a.longitude || a.latitude === 0 || a.longitude === 0) {
    return false;
  }

  // Exclude low-quality filler activities (unless must-see)
  const reviewCount = a.reviewCount || 0;
  const duration = a.duration || 60;
  if (reviewCount < 30 && !a.mustSee && duration <= 30) {
    return false;
  }

  return true;
}

/**
 * Scores and selects the best activities for LLM planning.
 *
 * Scoring formula:
 * - Base: rating × log2(reviewCount + 2)
 * - Must-see boost: +50
 * - Activity type match: +10
 *
 * Selection:
 * - ALL must-sees are selected unconditionally
 * - Top (8 × durationDays) non-must-sees by score
 * - Cap at 50 total activities
 */
export function scoreAndSelectForLLM(
  activities: Attraction[],
  preferences: TripPreferences
): ScoredActivity[] {
  // Filter invalid activities
  const validActivities = activities.filter((a) => isValidActivity(a, preferences));

  // Score each activity
  const scored: ScoredActivity[] = validActivities.map((a) => {
    const rating = a.rating || 0;
    const reviewCount = a.reviewCount || 0;
    const typeMatchBoost = preferences.activities.includes(a.type as any) ? 10 : 0;
    const mustSeeBoost = a.mustSee ? 50 : 0;

    const score = rating * Math.log2(reviewCount + 2) + mustSeeBoost + typeMatchBoost;

    // Determine source
    let source: ScoredActivity['source'] = 'serpapi';
    if (a.viatorUrl) {
      source = 'viator';
    } else if (a.googlePlaceId) {
      source = 'google_places';
    } else if (a.mustSee) {
      source = 'mustsee';
    }

    return {
      ...a,
      score,
      source,
      reviewCount, // Ensure reviewCount is set
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Select must-sees unconditionally
  const mustSees = scored.filter((a) => a.mustSee);
  const nonMustSees = scored.filter((a) => !a.mustSee);

  // Select top N non-must-sees (6 per day for variety without overwhelming the LLM)
  const targetNonMustSees = 6 * preferences.durationDays;
  const selectedNonMustSees = nonMustSees.slice(0, targetNonMustSees);

  // Combine and cap at 35 (keeps prompt size manageable for Claude)
  const selected = [...mustSees, ...selectedNonMustSees].slice(0, 35);

  console.log(
    `[Pipeline V2 LLM] Step 2: Selected ${selected.length} activities (${mustSees.length} must-sees, ${selected.length - mustSees.length} others)`
  );

  return selected;
}

// ============================================
// 3. Select restaurants for LLM
// ============================================

/**
 * Normalizes a restaurant name for deduplication.
 */
function normalizeRestaurantName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Classifies a restaurant as suitable for breakfast, lunch, and/or dinner.
 */
function classifyMealSuitability(
  restaurant: Restaurant
): ('breakfast' | 'lunch' | 'dinner')[] {
  const nameLower = restaurant.name.toLowerCase();
  const suitableFor: ('breakfast' | 'lunch' | 'dinner')[] = [];

  // Check for breakfast keywords
  const breakfastKeywords = [
    'café',
    'coffee',
    'bakery',
    'boulangerie',
    'pâtisserie',
    'petit',
    'breakfast',
    'brunch',
  ];
  const isBreakfastPlace = breakfastKeywords.some((kw) => nameLower.includes(kw));

  // Check opening hours
  const hours = restaurant.openingHours;
  let hasEarlyOpening = false;
  let hasLunchHours = false;
  let hasDinnerHours = false;

  if (hours && Object.keys(hours).length > 0) {
    // Check if any day has early opening (before 10:00)
    for (const day of Object.values(hours)) {
      if (day && day.open) {
        const openHour = parseInt(day.open.split(':')[0], 10);
        if (openHour < 10) hasEarlyOpening = true;
        if (openHour >= 11 && openHour <= 15) hasLunchHours = true;
        if (openHour >= 18 && openHour <= 23) hasDinnerHours = true;
      }
    }
  }

  // Classify
  if (isBreakfastPlace || hasEarlyOpening) {
    suitableFor.push('breakfast');
  }
  if (hasLunchHours || Object.keys(hours).length === 0) {
    suitableFor.push('lunch');
  }
  if (hasDinnerHours || Object.keys(hours).length === 0) {
    suitableFor.push('dinner');
  }

  // Default: lunch and dinner if no specific classification
  if (suitableFor.length === 0) {
    suitableFor.push('lunch', 'dinner');
  }

  return suitableFor;
}

/**
 * Selects and formats restaurants for LLM planning.
 */
function selectRestaurantsForLLM(
  data: FetchedData,
  hotelCoords: { lat: number; lng: number } | null
): LLMRestaurantInput[] {
  // Merge all restaurant sources
  const allRestaurants = [...data.tripAdvisorRestaurants, ...data.serpApiRestaurants];

  // Filter: valid GPS and good rating
  const validRestaurants = allRestaurants.filter((r) => {
    if (!r.latitude || !r.longitude || r.latitude === 0 || r.longitude === 0) {
      return false;
    }
    if (r.rating < 3.5) {
      return false;
    }
    return true;
  });

  // Deduplicate by name similarity
  const deduped: Restaurant[] = [];
  const seenNormalized = new Set<string>();

  for (const restaurant of validRestaurants) {
    const normalized = normalizeRestaurantName(restaurant.name);
    if (!seenNormalized.has(normalized)) {
      deduped.push(restaurant);
      seenNormalized.add(normalized);
    }
  }

  // Score by rating and review count
  const scored = deduped.map((r) => ({
    restaurant: r,
    score: r.rating * Math.log2((r.reviewCount || 0) + 2),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Select top 18 (enough for 3 meals/day × 5 days with some variety)
  const selected = scored.slice(0, 18).map((s) => s.restaurant);

  // Map to LLMRestaurantInput
  const formatted: LLMRestaurantInput[] = selected.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.latitude,
    lng: r.longitude,
    rating: r.rating,
    priceLevel: r.priceLevel,
    cuisineTypes: r.cuisineTypes || [],
    suitableFor: classifyMealSuitability(r),
    openingHours: r.openingHours,
  }));

  console.log(
    `[Pipeline V2 LLM] Step 2: Selected ${formatted.length} restaurants from ${allRestaurants.length} total`
  );

  return formatted;
}

// ============================================
// 4. Build distance matrix
// ============================================

/**
 * Builds a distance matrix for all relevant pairs.
 *
 * Keys format:
 * - Activity to activity: "act-1→act-2"
 * - Hotel to activity: "hotel→act-1"
 * - Activity to restaurant: "act-1→rest-3"
 * - Hotel to restaurant: "hotel→rest-1"
 */
function buildDistanceMatrix(
  activities: LLMActivityInput[],
  restaurants: LLMRestaurantInput[],
  hotel: { lat: number; lng: number } | null
): Record<string, LLMDistanceEntry> {
  const distances: Record<string, LLMDistanceEntry> = {};

  // Helper to add a distance entry
  function addDistance(key: string, lat1: number, lng1: number, lat2: number, lng2: number) {
    const km = Math.round(calculateDistance(lat1, lng1, lat2, lng2) * 100) / 100; // 2 decimal places
    const walkMin = Math.ceil((km * 1000) / 80); // 80m/min ≈ 4.8km/h
    distances[key] = { km, walkMin };
  }

  // Activity to activity (if < 5km — tighter filter to reduce token count)
  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      const a1 = activities[i];
      const a2 = activities[j];
      const km = calculateDistance(a1.lat, a1.lng, a2.lat, a2.lng);
      if (km < 5) {
        addDistance(`act-${i}→act-${j}`, a1.lat, a1.lng, a2.lat, a2.lng);
      }
    }
  }

  // Hotel to all activities and restaurants
  if (hotel) {
    for (let i = 0; i < activities.length; i++) {
      const a = activities[i];
      addDistance(`hotel→act-${i}`, hotel.lat, hotel.lng, a.lat, a.lng);
    }
    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      addDistance(`hotel→rest-${i}`, hotel.lat, hotel.lng, r.lat, r.lng);
    }
  }

  // Activity to restaurant (if < 3km — tighter filter to reduce token count)
  for (let i = 0; i < activities.length; i++) {
    for (let j = 0; j < restaurants.length; j++) {
      const a = activities[i];
      const r = restaurants[j];
      const km = calculateDistance(a.lat, a.lng, r.lat, r.lng);
      if (km < 3) {
        addDistance(`act-${i}→rest-${j}`, a.lat, a.lng, r.lat, r.lng);
      }
    }
  }

  console.log(
    `[Pipeline V2 LLM] Step 2: Built distance matrix with ${Object.keys(distances).length} pairs`
  );

  return distances;
}

// ============================================
// 5. Resolve arrival/departure times
// ============================================

/**
 * Extracts arrival time from flight or transport.
 */
function resolveArrivalTime(
  outboundFlight: Flight | null,
  transport: TransportOptionSummary | null
): string | null {
  if (outboundFlight) {
    return outboundFlight.arrivalTimeDisplay || outboundFlight.arrivalTime || null;
  }

  if (transport && transport.transitLegs && transport.transitLegs.length > 0) {
    // Use last segment arrival time
    const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];
    if (lastLeg.arrival) {
      const arrivalDate = new Date(lastLeg.arrival);
      return `${arrivalDate.getHours().toString().padStart(2, '0')}:${arrivalDate.getMinutes().toString().padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Extracts departure time from flight or transport.
 */
function resolveDepartureTime(
  returnFlight: Flight | null,
  transport: TransportOptionSummary | null
): string | null {
  if (returnFlight) {
    return returnFlight.departureTimeDisplay || returnFlight.departureTime || null;
  }

  if (transport && transport.transitLegs && transport.transitLegs.length > 0) {
    // Use first segment departure time
    const firstLeg = transport.transitLegs[0];
    if (firstLeg.departure) {
      const departureDate = new Date(firstLeg.departure);
      return `${departureDate.getHours().toString().padStart(2, '0')}:${departureDate.getMinutes().toString().padStart(2, '0')}`;
    }
  }

  return null;
}

// ============================================
// 6. Format activity for LLM
// ============================================

/**
 * Maps a ScoredActivity to LLMActivityInput.
 */
function formatActivityForLLM(activity: ScoredActivity): LLMActivityInput {
  const name = activity.name || '';
  const type = activity.type || '';
  const rawDuration = activity.duration || 60;
  const minDur = getMinDuration(name, type);

  return {
    id: activity.id,
    name: activity.name,
    type: activity.type,
    lat: Math.round(activity.latitude * 10000) / 10000,
    lng: Math.round(activity.longitude * 10000) / 10000,
    duration: Math.max(rawDuration, minDur),
    rating: activity.rating || 0,
    reviewCount: activity.reviewCount || 0,
    mustSee: activity.mustSee || false,
    estimatedCost: activity.estimatedCost || estimateActivityCost(name, type),
    bookingRequired: activity.bookingRequired || false,
    openingHours: activity.openingHoursByDay || undefined,
    viatorAvailable: !!activity.viatorUrl,
    isOutdoor: activity.isOutdoor || false,
    dayTripDestination: (activity as any).dayTripDestination || undefined,
  };
}

// ============================================
// 7. Detect far must-sees as implicit day trips
// ============================================

/**
 * Detects must-see activities that are far from the destination (>10km)
 * and should be promoted to dedicated day-trip days instead of being
 * mixed into the city activity pool.
 *
 * Example: Pompei (25km from Naples), Kamakura (50km from Tokyo)
 */
function detectFarMustSees(
  llmActivities: LLMActivityInput[],
  destCoords: { lat: number; lng: number },
  hotelCoords: { lat: number; lng: number } | null,
  existingDayTrips: DayTripSuggestion[],
  durationDays: number
): LLMActivityInput[] {
  // No day trip possible for 1-day trips
  if (durationDays <= 1) return [];

  const FAR_THRESHOLD_KM = 10;

  // Max implicit day trips: keep at least 50% of days for city
  // For 2-day trip: max 1 implicit day trip
  // For 3-day trip: max 1
  // For 5-day trip: max 2
  const maxImplicit = Math.max(1, Math.floor((durationDays - 1) / 2));

  // Existing day-trip coords for dedup check
  const existingDtCoords = existingDayTrips.map(dt => ({
    lat: dt.latitude,
    lng: dt.longitude,
  }));

  const candidates: { activity: LLMActivityInput; distFromDest: number }[] = [];

  for (const act of llmActivities) {
    // Only consider must-sees or high-scoring activities (avoid promoting minor POIs)
    if (!act.mustSee) continue;

    const distFromDest = calculateDistance(act.lat, act.lng, destCoords.lat, destCoords.lng);

    // Must be far from destination
    if (distFromDest <= FAR_THRESHOLD_KM) continue;

    // Must also be far from hotel (if hotel is outside city center, don't flag nearby activities)
    if (hotelCoords) {
      const distFromHotel = calculateDistance(act.lat, act.lng, hotelCoords.lat, hotelCoords.lng);
      if (distFromHotel <= FAR_THRESHOLD_KM) continue;
    }

    // Check if there's already a curated day trip near this location (within 5km)
    const alreadyCovered = existingDtCoords.some(
      dt => calculateDistance(act.lat, act.lng, dt.lat, dt.lng) < 5
    );
    if (alreadyCovered) continue;

    candidates.push({ activity: act, distFromDest });
  }

  // Sort by distance (farthest first — they benefit most from dedicated days)
  candidates.sort((a, b) => b.distFromDest - a.distFromDest);

  // Also limit by remaining day budget (existing curated day trips count against total)
  const existingDayTripCount = existingDayTrips.length;
  const remainingSlots = Math.max(0, maxImplicit - existingDayTripCount);

  return candidates.slice(0, remainingSlots).map(c => c.activity);
}

/**
 * Fetches activities and restaurants near far must-sees to build
 * synthetic day-trip data (parallel fetches for all destinations).
 */
async function fetchImplicitDayTripData(
  farActivities: LLMActivityInput[],
  destCoords: { lat: number; lng: number }
): Promise<{
  syntheticDayTrips: {
    name: string;
    destination: string;
    distanceKm: number;
    transportMode: 'train' | 'bus' | 'car' | 'ferry' | 'RER' | 'metro';
    transportDurationMin: number;
    transportCostPerPerson: number;
    forcedDate: string | undefined;
    fullDayRequired: boolean;
    activityIds: string[];
    restaurantIds: string[];
    coordinates: { lat: number; lng: number };
  }[];
  additionalDayTripActivities: Record<string, Attraction[]>;
  additionalDayTripRestaurants: Record<string, Restaurant[]>;
}> {
  const syntheticDayTrips: {
    name: string;
    destination: string;
    distanceKm: number;
    transportMode: 'train' | 'bus' | 'car' | 'ferry' | 'RER' | 'metro';
    transportDurationMin: number;
    transportCostPerPerson: number;
    forcedDate: string | undefined;
    fullDayRequired: boolean;
    activityIds: string[];
    restaurantIds: string[];
    coordinates: { lat: number; lng: number };
  }[] = [];
  const additionalDayTripActivities: Record<string, Attraction[]> = {};
  const additionalDayTripRestaurants: Record<string, Restaurant[]> = {};

  // Fetch data for all far must-sees in parallel
  const fetches = farActivities.map(async (act) => {
    const dtName = act.name;
    const dtCoords = { lat: act.lat, lng: act.lng };
    const distFromDest = calculateDistance(act.lat, act.lng, destCoords.lat, destCoords.lng);

    try {
      const [actsResult, restosResult] = await Promise.allSettled([
        searchGooglePlacesAttractions(dtName, dtCoords, { limit: 10 }),
        searchRestaurantsWithFallback(dtName, {
          latitude: dtCoords.lat,
          longitude: dtCoords.lng,
          limit: 6,
        }),
      ]);

      const activities = actsResult.status === 'fulfilled' ? actsResult.value.slice(0, 10) : [];
      const restaurants = restosResult.status === 'fulfilled' ? restosResult.value.slice(0, 8) : [];

      // Tag activities with day trip destination
      for (const a of activities) {
        (a as any).dayTripDestination = dtName;
      }

      additionalDayTripActivities[dtName] = activities;
      additionalDayTripRestaurants[dtName] = restaurants;

      console.log(
        `[Pipeline V2 LLM] Step 2: Fetched implicit day-trip data for "${dtName}": ${activities.length} activities, ${restaurants.length} restaurants`
      );
    } catch (e) {
      console.warn(
        `[Pipeline V2 LLM] Step 2: Failed to fetch implicit day-trip data for "${dtName}":`,
        e instanceof Error ? e.message : e
      );
      additionalDayTripActivities[dtName] = [];
      additionalDayTripRestaurants[dtName] = [];
    }

    // Build synthetic day-trip object
    syntheticDayTrips.push({
      name: dtName,
      destination: dtName,
      distanceKm: Math.round(distFromDest),
      transportMode: distFromDest > 50 ? 'train' : 'bus',
      transportDurationMin: Math.round(distFromDest * 1.5),
      transportCostPerPerson: 0,
      forcedDate: undefined,
      fullDayRequired: true,
      activityIds: [],
      restaurantIds: [],
      coordinates: dtCoords,
    });
  });

  await Promise.allSettled(fetches);

  return { syntheticDayTrips, additionalDayTripActivities, additionalDayTripRestaurants };
}

// ============================================
// 8. Main function: Prepare data for LLM
// ============================================

/**
 * Prepares all fetched data for LLM consumption.
 *
 * This is the main entry point for step 2.
 */
export async function prepareDataForLLM(
  data: FetchedData,
  preferences: TripPreferences,
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  outboundFlight: Flight | null,
  returnFlight: Flight | null
): Promise<PreparedLLMData> {
  // 1. Merge and deduplicate activities
  const mergedActivities = mergeAndDeduplicateActivities(data);

  // 2. Score and select activities
  const selectedActivities = scoreAndSelectForLLM(mergedActivities, preferences);

  // 3. Format activities for LLM
  const llmActivities = selectedActivities.map(formatActivityForLLM);

  // 4. Select and format restaurants
  const hotelCoords = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;
  const llmRestaurants = selectRestaurantsForLLM(data, hotelCoords);

  // 5. Build hotel object
  const llmHotel = hotel
    ? {
        name: hotel.name,
        lat: hotel.latitude,
        lng: hotel.longitude,
        checkIn: hotel.checkInTime,
        checkOut: hotel.checkOutTime,
      }
    : null;

  // 6. Build day-trip days deterministically (NOT sent to LLM — merged after LLM planning)
  const dayTripSuggestions = data.dayTripSuggestions || [];

  const llmHotelForBuilder = llmHotel;

  const dayTripsForBuilder = dayTripSuggestions.map((dt) => {
    const dtName = dt.destination || dt.name;
    const tickets = preferences.prePurchasedTickets || [];
    const matchingTicket = tickets.find((t) => {
      const tName = t.name.toLowerCase();
      return tName.includes(dtName.toLowerCase()) || dtName.toLowerCase().includes(tName);
    });

    return {
      name: dt.name,
      destination: dtName,
      distanceKm: dt.distanceKm,
      transportMode: dt.transportMode,
      transportDurationMin: dt.transportDurationMin,
      transportCostPerPerson: dt.estimatedCostPerPerson,
      forcedDate: matchingTicket?.date,
      fullDayRequired: (dt as any).fullDayRequired ?? true,
      activityIds: [] as string[],  // built from raw data, not LLM pools
      restaurantIds: [] as string[],
      coordinates: { lat: dt.latitude, lng: dt.longitude },
    };
  });

  // 6b. Detect far must-sees and promote to implicit day trips
  const farMustSees = detectFarMustSees(
    llmActivities, data.destCoords, hotelCoords, dayTripSuggestions, preferences.durationDays
  );

  let allDayTripsForBuilder = dayTripsForBuilder;
  if (farMustSees.length > 0) {
    const { syntheticDayTrips, additionalDayTripActivities, additionalDayTripRestaurants } =
      await fetchImplicitDayTripData(farMustSees, data.destCoords);

    // Merge fetched data into FetchedData records so buildDayTripDays can find them
    for (const [dest, acts] of Object.entries(additionalDayTripActivities)) {
      data.dayTripActivities[dest] = acts;
    }
    for (const [dest, restos] of Object.entries(additionalDayTripRestaurants)) {
      data.dayTripRestaurants[dest] = restos;
    }

    allDayTripsForBuilder = [...dayTripsForBuilder, ...syntheticDayTrips];

    console.log(
      `[Pipeline V2 LLM] Step 2: Detected ${farMustSees.length} implicit day trip(s): ${farMustSees.map(a => a.name).join(', ')}`
    );
  }

  const { dayTripDays: prePlannedDayTripDays, reservedDayNumbers } = buildDayTripDays(
    allDayTripsForBuilder,
    data,
    llmHotelForBuilder,
    llmRestaurants,
    preferences.durationDays,
    preferences.startDate.toISOString().split('T')[0]
  );

  // 7. Filter out day-trip activities from LLM pool (they're handled by the pre-planned days)
  if (allDayTripsForBuilder.length > 0) {
    const dayTripCoords = allDayTripsForBuilder.map(dt => ({
      name: dt.destination || dt.name,
      lat: dt.coordinates.lat,
      lng: dt.coordinates.lng,
    }));

    const beforeCount = llmActivities.length;
    const dayTripActivityIds = new Set(
      prePlannedDayTripDays.flatMap(d => d.items.filter(i => i.activityId).map(i => i.activityId!))
    );

    // Remove activities that belong to a day-trip destination (by proximity or exact ID match)
    for (let i = llmActivities.length - 1; i >= 0; i--) {
      const act = llmActivities[i];
      // Check if this activity is in a pre-planned day-trip
      if (dayTripActivityIds.has(act.id)) {
        llmActivities.splice(i, 1);
        continue;
      }
      // Check proximity to any day-trip destination (within 5km = likely a day-trip activity)
      for (const dtCoord of dayTripCoords) {
        const dist = calculateDistance(act.lat, act.lng, dtCoord.lat, dtCoord.lng);
        if (dist < 5) {
          console.log(`[Pipeline V2 LLM] Step 2: Filtered "${act.name}" from LLM pool (${dist.toFixed(1)}km from ${dtCoord.name})`);
          llmActivities.splice(i, 1);
          break;
        }
      }
    }

    if (llmActivities.length < beforeCount) {
      console.log(`[Pipeline V2 LLM] Step 2: Removed ${beforeCount - llmActivities.length} day-trip activities from LLM pool`);
    }
  }

  if (prePlannedDayTripDays.length > 0) {
    console.log(`[Pipeline V2 LLM] Step 2: Day-trip days pre-planned — ${prePlannedDayTripDays.length} day(s) reserved (${reservedDayNumbers.join(', ')}), ${llmActivities.length} city activities sent to LLM`);
  }

  // 8. Build distance matrix (AFTER day-trip filtering to exclude day-trip activities)
  const distances = buildDistanceMatrix(llmActivities, llmRestaurants, hotelCoords);

  // 9. Format weather
  const weather = data.weatherForecasts.map((w, idx) => ({
    day: idx + 1,
    condition: w.condition,
    tempMin: w.tempMin,
    tempMax: w.tempMax,
  }));

  // 10. Resolve arrival/departure times
  const arrivalTime = resolveArrivalTime(outboundFlight, transport);
  const departureTime = resolveDepartureTime(returnFlight, transport);

  // 11. Build dayTrips metadata for step4-assemble (transport injection).
  //     Activities/restaurants are NOT in LLM pools — they're in prePlannedDayTripDays.
  const dayTripsForLLM = allDayTripsForBuilder;

  // 12. Assemble final LLMPlannerInput
  const input: LLMPlannerInput = {
    trip: {
      destination: preferences.destination,
      origin: preferences.origin,
      startDate: preferences.startDate.toISOString().split('T')[0],
      durationDays: preferences.durationDays,
      groupType: preferences.groupType,
      groupSize: preferences.groupSize,
      budgetLevel: preferences.budgetLevel,
      arrivalTime,
      departureTime,
      preferredActivities: preferences.activities,
      mustSeeRequested: preferences.mustSee || '',
      dayTrips: dayTripsForLLM,
    },
    hotel: llmHotel,
    activities: llmActivities,
    restaurants: llmRestaurants,
    distances,
    weather,
    prePlannedDayTripDays: prePlannedDayTripDays.length > 0 ? prePlannedDayTripDays : undefined,
  };

  // Log summary
  console.log(
    `[Pipeline V2 LLM] Step 2: ${llmActivities.length} city activities, ${llmRestaurants.length} restaurants, ${Object.keys(distances).length} distance pairs`
  );

  return {
    llmInput: input,
    prePlannedDayTripDays,
    reservedDayNumbers,
  };
}

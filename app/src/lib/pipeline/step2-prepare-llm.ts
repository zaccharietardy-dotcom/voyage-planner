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
} from './types';
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

// ============================================
// 1. Merge and deduplicate activities
// ============================================

/**
 * Merges activities from all sources and removes duplicates.
 */
function mergeAndDeduplicateActivities(data: FetchedData): Attraction[] {
  // Concatenate all sources
  const allActivities: Attraction[] = [
    ...data.googlePlacesAttractions,
    ...data.serpApiAttractions,
    ...data.overpassAttractions,
    ...data.viatorActivities,
    ...data.mustSeeAttractions,
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
  return {
    id: activity.id,
    name: activity.name,
    type: activity.type,
    lat: Math.round(activity.latitude * 10000) / 10000,
    lng: Math.round(activity.longitude * 10000) / 10000,
    duration: activity.duration || 60,
    rating: activity.rating || 0,
    reviewCount: activity.reviewCount || 0,
    mustSee: activity.mustSee || false,
    estimatedCost: activity.estimatedCost || 0,
    bookingRequired: activity.bookingRequired || false,
    openingHours: activity.openingHoursByDay || undefined,
    viatorAvailable: !!activity.viatorUrl,
    isOutdoor: activity.isOutdoor || false,
    // description omitted to save tokens — name + type is enough for planning
  };
}

// ============================================
// 7. Main function: Prepare data for LLM
// ============================================

/**
 * Prepares all fetched data for LLM consumption.
 *
 * This is the main entry point for step 2.
 */
export function prepareDataForLLM(
  data: FetchedData,
  preferences: TripPreferences,
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  outboundFlight: Flight | null,
  returnFlight: Flight | null
): LLMPlannerInput {
  // 1. Merge and deduplicate activities
  const mergedActivities = mergeAndDeduplicateActivities(data);

  // 2. Score and select activities
  const selectedActivities = scoreAndSelectForLLM(mergedActivities, preferences);

  // 3. Format activities for LLM
  const llmActivities = selectedActivities.map(formatActivityForLLM);

  // 4. Select and format restaurants
  const hotelCoords = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;
  const llmRestaurants = selectRestaurantsForLLM(data, hotelCoords);

  // 5. Build distance matrix
  const distances = buildDistanceMatrix(llmActivities, llmRestaurants, hotelCoords);

  // 6. Format weather
  const weather = data.weatherForecasts.map((w, idx) => ({
    day: idx + 1,
    condition: w.condition,
    tempMin: w.tempMin,
    tempMax: w.tempMax,
  }));

  // 7. Resolve arrival/departure times
  const arrivalTime = resolveArrivalTime(outboundFlight, transport);
  const departureTime = resolveDepartureTime(returnFlight, transport);

  // 8. Build hotel object
  const llmHotel = hotel
    ? {
        name: hotel.name,
        lat: hotel.latitude,
        lng: hotel.longitude,
        checkIn: hotel.checkInTime,
        checkOut: hotel.checkOutTime,
      }
    : null;

  // 9. Assemble final LLMPlannerInput
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
    },
    hotel: llmHotel,
    activities: llmActivities,
    restaurants: llmRestaurants,
    distances,
    weather,
  };

  // Log summary
  console.log(
    `[Pipeline V2 LLM] Step 2: ${llmActivities.length} activities, ${llmRestaurants.length} restaurants, ${Object.keys(distances).length} distance pairs`
  );

  return input;
}

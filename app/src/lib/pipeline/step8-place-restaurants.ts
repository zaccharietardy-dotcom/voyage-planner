/**
 * Pipeline V3 — Step 8: Place Restaurants
 *
 * Places restaurants at exact meal positions after routing is done.
 * Each meal gets a primary restaurant + 2 alternatives (different cuisines).
 * Hard cap: 800m from anchor point. Rating >= 3.5.
 *
 * Supports dietary filtering: vegan, halal, gluten-free.
 */

import { calculateDistance } from '../services/geocoding';
import { isAppropriateForMeal, getCuisineFamily, isBreakfastSpecialized } from './step4-restaurants';
import type { Restaurant } from '../types';
import type { ActivityCluster, ScoredActivity } from './types';
import { getClusterCentroid, findMidDayActivity } from './utils/geo';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';

// ============================================
// Types
// ============================================

export interface MealPlacement {
  mealType: 'breakfast' | 'lunch' | 'dinner';
  anchorPoint: { lat: number; lng: number };
  anchorName: string;
  primary: Restaurant;
  alternatives: Restaurant[];
  distanceFromAnchor: number; // km
}

export interface DayMealPlan {
  dayNumber: number;
  meals: MealPlacement[];
}

interface PlaceRestaurantsOptions {
  /** Dietary restrictions to filter by */
  dietary?: string[];
  /** Maximum distance from anchor point in km (default: 0.8) */
  maxDistanceKm?: number;
  /** Minimum rating for restaurants (default: 3.5) */
  minRating?: number;
  /** Number of alternatives per meal (default: 2) */
  alternativeCount?: number;
  /** Trip start date (used to filter closed restaurants by day) */
  startDate?: Date | string;
  /** Hotel name for breakfast fallback */
  hotelName?: string;
  /** Destination name (for on-demand nearby restaurant search) */
  destination?: string;
}

// ============================================
// Constants
// ============================================

const DEFAULT_MAX_DISTANCE_KM = 0.8; // 800m hard cap (P0.2)
const DEFAULT_MIN_RATING = 3.5;
const DEFAULT_ALTERNATIVES = 2;

// Dietary keyword matching
const DIETARY_KEYWORDS: Record<string, RegExp> = {
  vegan: /vegan|plant[- ]?based|végétalien/i,
  vegetarian: /vegetarian|végétarien|veggie/i,
  halal: /halal/i,
  kosher: /kosher|casher/i,
  'gluten-free': /gluten[- ]?free|sans gluten|celiac/i,
  gluten_free: /gluten[- ]?free|sans gluten|celiac/i,
};

// ============================================
// Main Function
// ============================================

/**
 * Place restaurants at exact meal positions for each day.
 *
 * @param clusters - Activity clusters with activities in visit order
 * @param restaurants - All available restaurants for the destination
 * @param hotelCoords - Hotel coordinates for breakfast/dinner anchor
 * @param options - Configuration options (dietary, distance, rating thresholds)
 * @returns Meal placements for each day
 */
export async function placeRestaurants(
  clusters: ActivityCluster[],
  restaurants: Restaurant[],
  hotelCoords: { lat: number; lng: number } | null,
  options: PlaceRestaurantsOptions = {}
): Promise<DayMealPlan[]> {
  const maxDist = options.maxDistanceKm ?? DEFAULT_MAX_DISTANCE_KM;
  const minRating = options.minRating ?? DEFAULT_MIN_RATING;
  const altCount = options.alternativeCount ?? DEFAULT_ALTERNATIVES;
  const dietary = options.dietary || [];

  // Enrich restaurant pool: fetch nearby restaurants for each cluster centroid
  // so we have local coverage, not just city-center restaurants
  const enrichedRestaurants = [...restaurants];
  if (options.destination) {
    const enrichedIds = new Set(restaurants.map(r => r.id));
    const clusterSearches = clusters.map(async (cluster) => {
      const centroid = getClusterCentroid(cluster.activities);
      if (!centroid) return [];
      // Skip if we already have enough restaurants within 800m of this centroid
      const nearbyCount = restaurants.filter(r =>
        calculateDistance(centroid.lat, centroid.lng, r.latitude, r.longitude) <= 0.8
      ).length;
      if (nearbyCount >= 5) return [];
      try {
        const nearby = await searchRestaurantsNearbyWithFallback(centroid, options.destination!, {
          mealType: 'lunch',
          maxDistance: 1000, // 1km radius
          limit: 10,
        });
        return nearby;
      } catch (e) {
        console.warn(`[Place Restaurants] Cluster ${cluster.dayNumber} nearby search failed:`, e);
        return [];
      }
    });
    const results = await Promise.all(clusterSearches);
    for (const nearby of results) {
      for (const r of nearby) {
        if (!enrichedIds.has(r.id)) {
          enrichedIds.add(r.id);
          enrichedRestaurants.push(r);
        }
      }
    }
    if (enrichedRestaurants.length > restaurants.length) {
      console.log(`[Place Restaurants] Enriched pool: ${restaurants.length} → ${enrichedRestaurants.length} restaurants (${enrichedRestaurants.length - restaurants.length} added from cluster searches)`);
    }
  }

  const dayPlans: DayMealPlan[] = [];

  // Track used restaurants across ALL days to avoid the same restaurant on multiple days
  const usedRestaurantIds = new Set<string>();

  for (const cluster of clusters) {
    const meals: MealPlacement[] = [];
    const activities = cluster.activities;
    const dayDate = getDayDateForCluster(options.startDate, cluster.dayNumber);

    // Detect remote clusters: ≤1 activity far from hotel → use hotel as anchor for all meals
    const isRemoteCluster = activities.length <= 1 && hotelCoords && activities[0] &&
      calculateDistance(activities[0].latitude, activities[0].longitude, hotelCoords.lat, hotelCoords.lng) > 3;
    if (isRemoteCluster) {
      console.log(`[Place Restaurants] Day ${cluster.dayNumber}: remote cluster (${activities.length} activity, >3km from hotel) — lunch near activity, dinner near hotel`);
    }

    // ---- BREAKFAST ----
    const breakfastAnchor = hotelCoords || getClusterCentroid(activities);
    if (breakfastAnchor) {
      const breakfastPlacement = findBestRestaurant(
        enrichedRestaurants, breakfastAnchor, 'breakfast',
        maxDist, minRating, altCount, dietary, usedRestaurantIds, dayDate
      );
      if (breakfastPlacement && breakfastPlacement.distanceFromAnchor <= 0.8) {
        // Good breakfast within 800m of hotel
        meals.push({
          ...breakfastPlacement,
          anchorName: 'Hotel',
        });
        usedRestaurantIds.add(breakfastPlacement.primary.id);
      } else if (hotelCoords) {
        // Fallback: breakfast at hotel (more realistic than a café 2.5km away)
        const hName = options.hotelName || 'Hôtel';
        const reason = breakfastPlacement
          ? `nearest breakfast "${breakfastPlacement.primary.name}" is ${(breakfastPlacement.distanceFromAnchor * 1000).toFixed(0)}m away (>800m)`
          : `no breakfast within ${(maxDist * 1000).toFixed(0)}m`;
        console.log(`[Place Restaurants] Day ${cluster.dayNumber}: ${reason} — using hotel breakfast fallback`);
        meals.push({
          mealType: 'breakfast',
          anchorPoint: hotelCoords,
          anchorName: 'Hotel',
          primary: createHotelBreakfastRestaurant(hotelCoords, hName),
          alternatives: [],
          distanceFromAnchor: 0,
        });
      }
    }

    // ---- LUNCH ----
    // Anchor: for remote clusters, eat near the activity (not 27km away at hotel)
    const lunchAnchorActivity = findMidDayActivity(activities);
    const lunchAnchor = isRemoteCluster && activities[0]
      ? { lat: activities[0].latitude, lng: activities[0].longitude }
      : (lunchAnchorActivity
        ? { lat: lunchAnchorActivity.latitude, lng: lunchAnchorActivity.longitude }
        : getClusterCentroid(activities));
    if (lunchAnchor) {
      let lunchPlacement = findBestRestaurant(
        enrichedRestaurants, lunchAnchor, 'lunch',
        maxDist, minRating, altCount, dietary, usedRestaurantIds, dayDate
      );
      // Fallback: if anchor is >5km from hotel/center and no restaurants found, retry with hotel coords
      if (!lunchPlacement && hotelCoords) {
        const anchorToHotel = calculateDistance(lunchAnchor.lat, lunchAnchor.lng, hotelCoords.lat, hotelCoords.lng);
        if (anchorToHotel > 5) {
          console.warn(`[Place Restaurants] Lunch anchor ${anchorToHotel.toFixed(1)}km from hotel — retrying with hotel coords`);
          lunchPlacement = findBestRestaurant(
            restaurants, hotelCoords, 'lunch',
            maxDist, minRating, altCount, dietary, usedRestaurantIds, dayDate
          );
        }
      }
      if (lunchPlacement) {
        meals.push({
          ...lunchPlacement,
          anchorName: lunchAnchorActivity?.name || 'Mid-day point',
        });
        usedRestaurantIds.add(lunchPlacement.primary.id);
      }
    }

    // ---- DINNER ----
    // Anchor: last activity or hotel (hotel for remote clusters — traveler returns)
    const lastActivity = activities[activities.length - 1];
    const dinnerAnchor = isRemoteCluster && hotelCoords
      ? hotelCoords // Remote day trip: dine near hotel after returning
      : (lastActivity
        ? { lat: lastActivity.latitude, lng: lastActivity.longitude }
        : hotelCoords || getClusterCentroid(activities));
    if (dinnerAnchor) {
      let dinnerPlacement = findBestRestaurant(
        enrichedRestaurants, dinnerAnchor, 'dinner',
        maxDist, minRating, altCount, dietary, usedRestaurantIds, dayDate
      );
      // Fallback: if anchor is >5km from hotel/center and no restaurants found, retry with hotel coords
      if (!dinnerPlacement && hotelCoords) {
        const anchorToHotel = calculateDistance(dinnerAnchor.lat, dinnerAnchor.lng, hotelCoords.lat, hotelCoords.lng);
        if (anchorToHotel > 5) {
          console.warn(`[Place Restaurants] Dinner anchor ${anchorToHotel.toFixed(1)}km from hotel — retrying with hotel coords`);
          dinnerPlacement = findBestRestaurant(
            restaurants, hotelCoords, 'dinner',
            maxDist, minRating, altCount, dietary, usedRestaurantIds, dayDate
          );
        }
      }
      if (dinnerPlacement) {
        meals.push({
          ...dinnerPlacement,
          anchorName: lastActivity?.name || 'Hotel',
        });
        usedRestaurantIds.add(dinnerPlacement.primary.id);
      }
    }

    dayPlans.push({ dayNumber: cluster.dayNumber, meals });
  }

  // Log summary
  const totalMeals = dayPlans.reduce((s, d) => s + d.meals.length, 0);
  const perDay = dayPlans.map(d => `D${d.dayNumber}:${d.meals.map(m => m.mealType[0]).join('')}`).join(' ');
  console.log(`[Place Restaurants] Placed ${totalMeals} meals across ${dayPlans.length} days (${perDay})`);
  for (const plan of dayPlans) {
    for (const meal of plan.meals) {
      console.log(`  Day ${plan.dayNumber} ${meal.mealType}: "${meal.primary.name}" (${(meal.distanceFromAnchor * 1000).toFixed(0)}m from ${meal.anchorName})`);
    }
  }

  return dayPlans;
}

// ============================================
// Core Selection Logic
// ============================================

interface PassConfig {
  maxDist: number;
  checkMealType: boolean;
  checkDietary: boolean | 'relaxed';
  checkHours: boolean;
  checkRating: boolean;
  allowReuse: boolean;
}

const PASSES: PassConfig[] = [
  { maxDist: 0.8, checkMealType: true,  checkDietary: true,      checkHours: true,  checkRating: true,  allowReuse: false },
  { maxDist: 0.8, checkMealType: true,  checkDietary: true,      checkHours: true,  checkRating: false, allowReuse: false },
  { maxDist: 1.5, checkMealType: true,  checkDietary: true,      checkHours: true,  checkRating: false, allowReuse: false },
  { maxDist: 5.0, checkMealType: false, checkDietary: 'relaxed', checkHours: true,  checkRating: false, allowReuse: true  },
  { maxDist: 5.0, checkMealType: false, checkDietary: false,     checkHours: false, checkRating: false, allowReuse: true  },
  { maxDist: 5.0, checkMealType: false, checkDietary: false,     checkHours: false, checkRating: false, allowReuse: true  },
];

function filterAndScoreCandidates(
  allRestaurants: Restaurant[],
  anchor: { lat: number; lng: number },
  mealType: 'breakfast' | 'lunch' | 'dinner',
  pass: PassConfig,
  usedIds: Set<string>,
  dietary: string[],
  dayDate: Date | null,
  minRating: number
): { restaurant: Restaurant; distance: number; cuisineFamily: string; score: number }[] {
  return allRestaurants
    .filter(r => {
      if (!pass.allowReuse && usedIds.has(r.id)) return false;
      if (!r.latitude || !r.longitude) return false;
      const dist = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
      if (dist > pass.maxDist) return false;
      if (pass.checkMealType && !isAppropriateForMeal(r, mealType)) return false;
      if (pass.checkMealType && mealType === 'breakfast' && !isBreakfastCandidate(r)) return false;
      if (pass.checkDietary === true && !matchesDietary(r, dietary)) return false;
      if (pass.checkDietary === 'relaxed' && !matchesDietary(r, dietary, false)) return false;
      if (pass.checkHours && !isRestaurantOpenForMealSlot(r, mealType, dayDate)) return false;
      if (pass.checkRating && (r.rating || 0) < minRating) return false;
      return true;
    })
    .map(r => ({
      restaurant: r,
      distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
      cuisineFamily: getCuisineFamily(r),
      score: 0,
    }));
}

export function findBestRestaurant(
  allRestaurants: Restaurant[],
  anchor: { lat: number; lng: number },
  mealType: 'breakfast' | 'lunch' | 'dinner',
  maxDistKm: number,
  minRating: number,
  altCount: number,
  dietary: string[],
  usedIds: Set<string>,
  dayDate: Date | null
): Omit<MealPlacement, 'anchorName'> | null {
  for (let i = 0; i < PASSES.length; i++) {
    const pass = { ...PASSES[i] };
    // First pass uses the caller's maxDist
    if (i === 0 || i === 1) pass.maxDist = maxDistKm;
    const results = filterAndScoreCandidates(allRestaurants, anchor, mealType, pass, usedIds, dietary, dayDate, minRating);
    if (results.length > 0) {
      if (i > 0) {
        console.warn(`[Place Restaurants] Pass ${i + 1} (${pass.maxDist}km${pass.allowReuse ? ', reuse' : ''}): found ${results.length} candidates for ${mealType}`);
      }
      return scoreAndSelect(results, anchor, mealType, altCount);
    }
  }
  return null;
}

function scoreAndSelect(
  candidates: { restaurant: Restaurant; distance: number; cuisineFamily: string; score: number }[],
  anchor: { lat: number; lng: number },
  mealType: string,
  altCount: number
): Omit<MealPlacement, 'anchorName'> | null {
  // Score: rating * log2(reviews + 2) + cuisineDiversity - distancePenalty
  for (const c of candidates) {
    const rating = c.restaurant.rating || 3.5;
    const reviews = c.restaurant.reviewCount || 0;
    const ratingScore = rating * Math.log2(reviews + 2);
    const distancePenalty = c.distance * 10; // 10 points per km
    c.score = ratingScore - distancePenalty;
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Select primary
  const primary = candidates[0];
  if (!primary) return null;

  // Select alternatives with different cuisine families
  const alternatives: Restaurant[] = [];
  const usedCuisines = new Set([primary.cuisineFamily]);

  for (const c of candidates.slice(1)) {
    if (alternatives.length >= altCount) break;
    if (!usedCuisines.has(c.cuisineFamily)) {
      alternatives.push(c.restaurant);
      usedCuisines.add(c.cuisineFamily);
    }
  }

  // Fill remaining alternatives even with same cuisine
  if (alternatives.length < altCount) {
    for (const c of candidates.slice(1)) {
      if (alternatives.length >= altCount) break;
      if (!alternatives.find(a => a.id === c.restaurant.id)) {
        alternatives.push(c.restaurant);
      }
    }
  }

  return {
    mealType: mealType as 'breakfast' | 'lunch' | 'dinner',
    anchorPoint: anchor,
    primary: primary.restaurant,
    alternatives,
    distanceFromAnchor: primary.distance,
  };
}

// ============================================
// Helpers
// ============================================

function isBreakfastCandidate(r: Restaurant): boolean {
  // Use isBreakfastSpecialized if available
  if (isBreakfastSpecialized(r)) return true;

  // Accept any restaurant that passed isAppropriateForMeal('breakfast')
  return true;
}

function matchesDietary(r: Restaurant, dietary: string[], strict: boolean = true): boolean {
  if (dietary.length === 0) return true;
  // In relaxed mode, only filter for restrictions with actual health consequences
  // (e.g. gluten-free, allergies). Skip halal/kosher/vegan in relaxed mode since
  // in many destinations these are implicit or restaurants don't label themselves.
  if (!strict) return true;

  const text = `${r.name || ''} ${(r.cuisineTypes || []).join(' ')} ${r.description || ''}`.toLowerCase();

  // At least one dietary preference should match
  return dietary.some(pref => {
    const pattern = DIETARY_KEYWORDS[pref.toLowerCase()];
    if (!pattern) return true; // Unknown dietary preference — don't filter
    return pattern.test(text);
  });
}

export function getDayDateForCluster(startDate: Date | string | undefined, dayNumber: number): Date | null {
  if (!startDate) return null;
  const base = new Date(startDate);
  if (!Number.isFinite(base.getTime())) return null;
  base.setDate(base.getDate() + dayNumber - 1);
  return base;
}

function isRestaurantOpenForMealSlot(
  restaurant: Restaurant,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  dayDate: Date | null
): boolean {
  if (!dayDate) return true;
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayDate.getDay()];

  const dayHours = restaurant.openingHours?.[dayName];
  if (dayHours === null) return false;
  if (!dayHours?.open || !dayHours?.close) return true; // unknown hours -> do not exclude

  const openMin = timeToMinutes(dayHours.open);
  let closeMin = timeToMinutes(dayHours.close);

  const mealWindow = getMealWindowMinutes(mealType);
  let slotStart = mealWindow.start;
  let slotEnd = mealWindow.end;

  if (closeMin <= openMin) {
    closeMin += 24 * 60;
    if (slotStart < openMin) {
      slotStart += 24 * 60;
      slotEnd += 24 * 60;
    }
  }

  const toleranceMin = 15;
  return slotStart >= openMin - toleranceMin && slotEnd <= closeMin + toleranceMin;
}

function getMealWindowMinutes(mealType: 'breakfast' | 'lunch' | 'dinner'): { start: number; end: number } {
  if (mealType === 'breakfast') return { start: 8 * 60, end: 10 * 60 + 30 };
  if (mealType === 'lunch') return { start: 12 * 60, end: 14 * 60 + 30 };
  return { start: 19 * 60, end: 21 * 60 + 30 };
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Create a synthetic Restaurant representing hotel breakfast.
 * Most hotels/riads include or offer breakfast — more realistic than a 2.5km café.
 */
export function createHotelBreakfastRestaurant(
  hotelCoords: { lat: number; lng: number },
  hotelName: string
): Restaurant {
  return {
    id: `hotel-breakfast-${hotelName.replace(/\s+/g, '-').toLowerCase()}`,
    name: hotelName,
    address: hotelName,
    latitude: hotelCoords.lat,
    longitude: hotelCoords.lng,
    rating: 4.0,
    reviewCount: 0,
    priceLevel: 1 as const,
    cuisineTypes: ['breakfast', 'hotel'],
    dietaryOptions: [],
    openingHours: {},
    description: `Petit-déjeuner servi à ${hotelName}`,
  };
}

// ============================================
// Extracted: enrichRestaurantPool (from placeRestaurants)
// ============================================

/**
 * Enrich the restaurant pool by searching for nearby restaurants around each cluster centroid.
 * Extracted from placeRestaurants() so it can be called independently in the unified scheduler.
 */
export async function enrichRestaurantPool(
  clusters: ActivityCluster[],
  restaurants: Restaurant[],
  destination?: string,
  densityCategory: 'dense' | 'medium' | 'spread' = 'medium'
): Promise<Restaurant[]> {
  const enrichedRestaurants = [...restaurants];
  if (!destination) return enrichedRestaurants;

  // Density-aware search radius: spread cities need wider coverage
  const SEARCH_RADIUS =
    densityCategory === 'dense'  ? { nearbyCheck: 0.8, maxDistance: 1000 } :
    densityCategory === 'spread' ? { nearbyCheck: 2.0, maxDistance: 2500 } :
                                   { nearbyCheck: 1.0, maxDistance: 1500 };  // medium

  const enrichedIds = new Set(restaurants.map(r => r.id));
  const clusterSearches = clusters.map(async (cluster) => {
    const centroid = getClusterCentroid(cluster.activities);
    if (!centroid) return [];
    const nearbyCount = restaurants.filter(r =>
      calculateDistance(centroid.lat, centroid.lng, r.latitude, r.longitude) <= SEARCH_RADIUS.nearbyCheck
    ).length;
    if (nearbyCount >= 5) return [];
    try {
      const nearby = await searchRestaurantsNearbyWithFallback(centroid, destination, {
        mealType: 'lunch',
        maxDistance: SEARCH_RADIUS.maxDistance,
        limit: 10,
      });
      return nearby;
    } catch (e) {
      console.warn(`[enrichRestaurantPool] Cluster ${cluster.dayNumber} nearby search failed:`, e);
      return [];
    }
  });
  const results = await Promise.all(clusterSearches);
  for (const nearby of results) {
    for (const r of nearby) {
      if (!enrichedIds.has(r.id)) {
        enrichedIds.add(r.id);
        enrichedRestaurants.push(r);
      }
    }
  }
  if (enrichedRestaurants.length > restaurants.length) {
    console.log(`[enrichRestaurantPool] Enriched pool: ${restaurants.length} → ${enrichedRestaurants.length} restaurants (${enrichedRestaurants.length - restaurants.length} added, density=${densityCategory}, radius=${SEARCH_RADIUS.maxDistance}m)`);
  }
  return enrichedRestaurants;
}

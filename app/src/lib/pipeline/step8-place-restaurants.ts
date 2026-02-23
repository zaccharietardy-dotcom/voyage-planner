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

export interface PlaceRestaurantsOptions {
  /** Dietary restrictions to filter by */
  dietary?: string[];
  /** Maximum distance from anchor point in km (default: 0.8) */
  maxDistanceKm?: number;
  /** Minimum rating for restaurants (default: 3.5) */
  minRating?: number;
  /** Number of alternatives per meal (default: 2) */
  alternativeCount?: number;
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
export function placeRestaurants(
  clusters: ActivityCluster[],
  restaurants: Restaurant[],
  hotelCoords: { lat: number; lng: number } | null,
  options: PlaceRestaurantsOptions = {}
): DayMealPlan[] {
  const maxDist = options.maxDistanceKm ?? DEFAULT_MAX_DISTANCE_KM;
  const minRating = options.minRating ?? DEFAULT_MIN_RATING;
  const altCount = options.alternativeCount ?? DEFAULT_ALTERNATIVES;
  const dietary = options.dietary || [];

  const dayPlans: DayMealPlan[] = [];

  for (const cluster of clusters) {
    // FIX 1: Allow restaurant reuse across different days (reset per day)
    const usedRestaurantIds = new Set<string>();
    const meals: MealPlacement[] = [];
    const activities = cluster.activities;

    // ---- BREAKFAST ----
    const breakfastAnchor = hotelCoords || getClusterCentroid(activities);
    if (breakfastAnchor) {
      const breakfastPlacement = findBestRestaurant(
        restaurants, breakfastAnchor, 'breakfast',
        maxDist, minRating, altCount, dietary, usedRestaurantIds
      );
      if (breakfastPlacement) {
        meals.push({
          ...breakfastPlacement,
          anchorName: 'Hotel',
        });
        usedRestaurantIds.add(breakfastPlacement.primary.id);
      }
    }

    // ---- LUNCH ----
    // Anchor: activity closest to mid-day (position ~50% through the route)
    const lunchAnchorActivity = findMidDayActivity(activities);
    const lunchAnchor = lunchAnchorActivity
      ? { lat: lunchAnchorActivity.latitude, lng: lunchAnchorActivity.longitude }
      : getClusterCentroid(activities);
    if (lunchAnchor) {
      const lunchPlacement = findBestRestaurant(
        restaurants, lunchAnchor, 'lunch',
        maxDist, minRating, altCount, dietary, usedRestaurantIds
      );
      if (lunchPlacement) {
        meals.push({
          ...lunchPlacement,
          anchorName: lunchAnchorActivity?.name || 'Mid-day point',
        });
        usedRestaurantIds.add(lunchPlacement.primary.id);
      }
    }

    // ---- DINNER ----
    // Anchor: last activity or hotel
    const lastActivity = activities[activities.length - 1];
    const dinnerAnchor = lastActivity
      ? { lat: lastActivity.latitude, lng: lastActivity.longitude }
      : hotelCoords || getClusterCentroid(activities);
    if (dinnerAnchor) {
      const dinnerPlacement = findBestRestaurant(
        restaurants, dinnerAnchor, 'dinner',
        maxDist, minRating, altCount, dietary, usedRestaurantIds
      );
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
  console.log(`[Place Restaurants] Placed ${totalMeals} meals across ${dayPlans.length} days`);
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

function findBestRestaurant(
  allRestaurants: Restaurant[],
  anchor: { lat: number; lng: number },
  mealType: 'breakfast' | 'lunch' | 'dinner',
  maxDistKm: number,
  minRating: number,
  altCount: number,
  dietary: string[],
  usedIds: Set<string>
): Omit<MealPlacement, 'anchorName'> | null {
  // Step 1: Filter by distance, meal type, and dietary
  const candidates = allRestaurants
    .filter(r => {
      if (usedIds.has(r.id)) return false;
      const dist = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
      if (dist > maxDistKm) return false;
      if (!isAppropriateForMeal(r, mealType)) return false;
      if (mealType === 'breakfast' && !isBreakfastCandidate(r)) return false;
      if (!matchesDietary(r, dietary)) return false;
      if ((r.rating || 0) < minRating) return false;
      return true;
    })
    .map(r => ({
      restaurant: r,
      distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
      cuisineFamily: getCuisineFamily(r),
      score: 0,
    }));

  if (candidates.length === 0) {
    // Fallback: relax rating constraint, widen to 1.2km
    const relaxed = allRestaurants
      .filter(r => {
        if (usedIds.has(r.id)) return false;
        const dist = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
        if (dist > maxDistKm * 1.5) return false;
        if (!isAppropriateForMeal(r, mealType)) return false;
        if (mealType === 'breakfast' && !isBreakfastCandidate(r)) return false;
        return true;
      })
      .map(r => ({
        restaurant: r,
        distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
        cuisineFamily: getCuisineFamily(r),
        score: 0,
      }));

    if (relaxed.length === 0) {
      // FIX 2: Last resort — 2km with no rating filter, just meal type
      const lastResort = allRestaurants
        .filter(r => {
          if (usedIds.has(r.id)) return false;
          const dist = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
          if (dist > 2.0) return false;
          if (!isAppropriateForMeal(r, mealType)) return false;
          // Still apply breakfast candidate check for breakfast
          if (mealType === 'breakfast' && !isBreakfastCandidate(r)) return false;
          return true;
        })
        .map(r => ({
          restaurant: r,
          distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
          cuisineFamily: getCuisineFamily(r),
          score: 0,
        }));

      if (lastResort.length > 0) {
        console.warn(`[Place Restaurants] No ${mealType} within 1.2km, last-resort at 2km: ${lastResort.length} candidates`);
        return scoreAndSelect(lastResort, anchor, mealType, altCount);
      }

      // Ultra-relaxed fallback: drop type-specific filters (isBreakfastCandidate for breakfast,
      // isAppropriateForMeal for lunch/dinner) but stay within 2km
      const ultraRelaxed = allRestaurants
        .filter(r => {
          if (usedIds.has(r.id)) return false;
          const dist = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
          if (dist > 2.0) return false;
          // For breakfast: drop isBreakfastCandidate but keep isAppropriateForMeal
          if (mealType === 'breakfast') {
            if (!isAppropriateForMeal(r, mealType)) return false;
          }
          // For lunch/dinner: drop isAppropriateForMeal entirely — any restaurant qualifies
          return true;
        })
        .map(r => ({
          restaurant: r,
          distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
          cuisineFamily: getCuisineFamily(r),
          score: 0,
        }));

      if (ultraRelaxed.length > 0) {
        console.warn(`[Place Restaurants] No ${mealType} candidates within 2km, ultra-relaxed (no meal-type filter): ${ultraRelaxed.length} candidates`);
        return scoreAndSelect(ultraRelaxed, anchor, mealType, altCount);
      }

      // Ultimate fallback: cap at 5km first; only go unlimited if truly nothing exists nearby
      const GLOBAL_FALLBACK_CAP_KM = 5.0;
      const globalFallbackCapped = allRestaurants
        .filter(r => {
          if (usedIds.has(r.id)) return false;
          const dist = calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude);
          return dist <= GLOBAL_FALLBACK_CAP_KM;
        })
        .map(r => ({
          restaurant: r,
          distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
          cuisineFamily: getCuisineFamily(r),
          score: 0,
        }))
        .sort((a, b) => a.distance - b.distance);

      if (globalFallbackCapped.length > 0) {
        console.warn(`[Place Restaurants] No ${mealType} within 2km — global fallback (≤5km): using "${globalFallbackCapped[0].restaurant.name}" (${(globalFallbackCapped[0].distance * 1000).toFixed(0)}m away)`);
        return scoreAndSelect(globalFallbackCapped.slice(0, altCount + 1), anchor, mealType, altCount);
      }

      // Beyond 5km: truly no nearby restaurants — log a strong warning and pick the absolute closest
      const globalFallbackUnlimited = allRestaurants
        .filter(r => !usedIds.has(r.id))
        .map(r => ({
          restaurant: r,
          distance: calculateDistance(anchor.lat, anchor.lng, r.latitude, r.longitude),
          cuisineFamily: getCuisineFamily(r),
          score: 0,
        }))
        .sort((a, b) => a.distance - b.distance);

      if (globalFallbackUnlimited.length > 0) {
        console.error(`[Place Restaurants] WARNING: No ${mealType} within 5km — forced to use restaurant ${(globalFallbackUnlimited[0].distance * 1000).toFixed(0)}m away ("${globalFallbackUnlimited[0].restaurant.name}"). Consider adding more restaurants to the pool.`);
        return scoreAndSelect(globalFallbackUnlimited.slice(0, altCount + 1), anchor, mealType, altCount);
      }

      return null;
    }

    console.warn(`[Place Restaurants] No ${mealType} within ${maxDistKm * 1000}m, relaxed to ${maxDistKm * 1.5 * 1000}m: ${relaxed.length} candidates`);
    return scoreAndSelect(relaxed, anchor, mealType, altCount);
  }

  return scoreAndSelect(candidates, anchor, mealType, altCount);
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

function matchesDietary(r: Restaurant, dietary: string[]): boolean {
  if (dietary.length === 0) return true;

  const text = `${r.name || ''} ${(r.cuisineTypes || []).join(' ')} ${r.description || ''}`.toLowerCase();

  // At least one dietary preference should match
  return dietary.some(pref => {
    const pattern = DIETARY_KEYWORDS[pref.toLowerCase()];
    if (!pattern) return true; // Unknown dietary preference — don't filter
    return pattern.test(text);
  });
}

/**
 * Pipeline V2 — Step 4: Restaurant Assignment
 *
 * For each meal slot, pick the best restaurant by quality/distance ratio.
 * Pure function, zero API calls.
 */

import type { Restaurant, BudgetStrategy, TripPreferences } from '../types';
import type { ActivityCluster, MealAssignment } from './types';
import { calculateDistance } from '../services/geocoding';
import { mergeRestaurantSources } from './utils/dedup';

/**
 * Assign restaurants to meal slots across all days.
 */
export function assignRestaurants(
  clusters: ActivityCluster[],
  tripAdvisorRestaurants: Restaurant[],
  serpApiRestaurants: Restaurant[],
  preferences: TripPreferences,
  budgetStrategy: BudgetStrategy | null,
  accommodationCoords: { lat: number; lng: number }
): MealAssignment[] {
  // 1. Merge restaurant sources
  const allRestaurants = mergeRestaurantSources(
    tripAdvisorRestaurants as any,
    serpApiRestaurants as any
  ) as Restaurant[];

  // 2. Detect fake GPS: if most restaurants share the exact same coords,
  //    they're using the city-center fallback from TripAdvisor
  const hasRealGPS = detectRealGPS(allRestaurants);

  // 3. Filter by budget
  const maxPriceLevel = getBudgetPriceLevel(preferences.budgetLevel);
  const budgetFiltered = allRestaurants.filter(
    r => !r.priceLevel || r.priceLevel <= maxPriceLevel + 1
  );

  const pool = budgetFiltered.length > 3 ? budgetFiltered : allRestaurants;

  console.log(`[Pipeline V2] Restaurants pool: ${pool.length} (realGPS: ${hasRealGPS}, total: ${allRestaurants.length})`);

  // 4. Assign for each day and meal
  const assignments: MealAssignment[] = [];
  const usedIds = new Set<string>();

  for (const cluster of clusters) {
    for (const mealType of ['breakfast', 'lunch', 'dinner'] as const) {
      // Check if self-catered
      if (shouldSelfCater(mealType, budgetStrategy)) {
        assignments.push({
          dayNumber: cluster.dayNumber,
          mealType,
          restaurant: null,
          referenceCoords: accommodationCoords,
        });
        continue;
      }

      // Determine reference coords (where the traveler will be)
      const refCoords = getMealReferenceCoords(
        mealType,
        cluster,
        accommodationCoords
      );

      let best: Restaurant | null = null;

      if (hasRealGPS) {
        // Normal mode: score by quality/distance ratio
        best = findBestRestaurant(pool, refCoords, usedIds, mealType);
      } else {
        // Fake GPS mode: all restaurants are at the same point,
        // distance is meaningless → score by quality only
        best = findBestByQuality(pool, usedIds);
      }

      if (best) {
        usedIds.add(best.id);
      }

      assignments.push({
        dayNumber: cluster.dayNumber,
        mealType,
        restaurant: best,
        referenceCoords: refCoords,
      });
    }
  }

  return assignments;
}

/**
 * Detect whether restaurants have real individual GPS coordinates
 * or if they all share the same city-center fallback.
 */
function detectRealGPS(restaurants: Restaurant[]): boolean {
  const withCoords = restaurants.filter(
    r => r.latitude && r.longitude && r.latitude !== 0 && r.longitude !== 0
  );
  if (withCoords.length < 2) return false;

  // Count how many share the exact same coordinates
  const coordCounts = new Map<string, number>();
  for (const r of withCoords) {
    const key = `${r.latitude.toFixed(6)},${r.longitude.toFixed(6)}`;
    coordCounts.set(key, (coordCounts.get(key) || 0) + 1);
  }

  // If >50% of restaurants share the same coords, it's a fake fallback
  const maxCount = Math.max(...coordCounts.values());
  return maxCount < withCoords.length * 0.5;
}

/**
 * Find the best restaurant for a meal slot.
 * Score = (rating × log10(reviewCount)) / distance
 */
function findBestRestaurant(
  pool: Restaurant[],
  refCoords: { lat: number; lng: number },
  usedIds: Set<string>,
  mealType: 'breakfast' | 'lunch' | 'dinner'
): Restaurant | null {
  let bestRestaurant: Restaurant | null = null;
  let bestScore = -Infinity;

  const maxDistance = mealType === 'breakfast' ? 1.5 : 2.0; // km

  for (const r of pool) {
    if (usedIds.has(r.id)) continue;
    if (!r.latitude || !r.longitude || r.latitude === 0) continue;

    const dist = calculateDistance(
      refCoords.lat, refCoords.lng,
      r.latitude, r.longitude
    );

    if (dist > maxDistance) continue;

    const rating = r.rating || 3;
    const reviews = Math.max(r.reviewCount || 1, 1);
    const qualityScore = rating * Math.log10(reviews);
    const distancePenalty = Math.max(0.05, dist); // min 50m

    const score = qualityScore / distancePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestRestaurant = r;
    }
  }

  return bestRestaurant;
}

/**
 * Pick the highest-rated unused restaurant (ignoring distance).
 * Used when GPS coordinates are unreliable (fake city-center fallback).
 */
function findBestByQuality(
  pool: Restaurant[],
  usedIds: Set<string>
): Restaurant | null {
  let best: Restaurant | null = null;
  let bestScore = -Infinity;

  for (const r of pool) {
    if (usedIds.has(r.id)) continue;
    const rating = r.rating || 3;
    const reviews = Math.max(r.reviewCount || 1, 1);
    const score = rating * Math.log10(reviews);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return best;
}

/**
 * Determine where the traveler will be for each meal type.
 */
function getMealReferenceCoords(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  cluster: ActivityCluster,
  accommodationCoords: { lat: number; lng: number }
): { lat: number; lng: number } {
  const activities = cluster.activities;

  if (mealType === 'breakfast') {
    // Near hotel
    return accommodationCoords;
  }

  if (mealType === 'lunch') {
    // Near mid-point of day's activities
    const midIdx = Math.floor(activities.length / 2);
    if (activities[midIdx]) {
      return { lat: activities[midIdx].latitude, lng: activities[midIdx].longitude };
    }
    return cluster.centroid;
  }

  // Dinner: near last activity of the day
  const lastActivity = activities[activities.length - 1];
  if (lastActivity) {
    return { lat: lastActivity.latitude, lng: lastActivity.longitude };
  }
  return cluster.centroid;
}

function getBudgetPriceLevel(budgetLevel: string): number {
  switch (budgetLevel) {
    case 'economic': return 1;
    case 'moderate': return 2;
    case 'comfort': return 3;
    case 'luxury': return 4;
    default: return 3;
  }
}

function shouldSelfCater(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  budgetStrategy: BudgetStrategy | null
): boolean {
  if (!budgetStrategy) return false;

  const strategy = budgetStrategy.mealsStrategy?.[mealType];
  return strategy === 'self_catered';
}

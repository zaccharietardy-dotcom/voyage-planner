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
  accommodationCoords: { lat: number; lng: number },
  hotel?: { breakfastIncluded?: boolean } | null
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
          restaurantAlternatives: [],
          referenceCoords: accommodationCoords,
        });
        continue;
      }

      // Skip breakfast restaurant if hotel includes breakfast
      if (mealType === 'breakfast' && hotel?.breakfastIncluded) {
        assignments.push({
          dayNumber: cluster.dayNumber,
          mealType,
          restaurant: null, // Will be handled as hotel breakfast in step7
          restaurantAlternatives: [],
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

      let topRestaurants: Restaurant[] = [];

      if (hasRealGPS) {
        // Normal mode: score by quality/distance ratio — get top 3
        topRestaurants = findTopRestaurants(pool, refCoords, usedIds, mealType, 3);
      } else {
        // Fake GPS mode: most TripAdvisor restaurants have city-center fallback coords.
        // Strategy: try SerpAPI restaurants first (they have real GPS from Google),
        // then fall back to quality-only scoring for the rest.
        const realGPSPool = pool.filter(r => {
          // SerpAPI restaurants have real GPS — identify by source or coords uniqueness
          if (r.id.startsWith('serp-')) return true;
          // Also include any restaurant with non-default coords (not the fake center)
          const coordKey = `${(r.latitude || 0).toFixed(2)},${(r.longitude || 0).toFixed(2)}`;
          const isFakeCenter = coordKey === `${(refCoords.lat || 0).toFixed(2)},${(refCoords.lng || 0).toFixed(2)}`;
          return !isFakeCenter && r.latitude && r.longitude;
        });

        if (realGPSPool.length > 0) {
          topRestaurants = findTopRestaurants(realGPSPool, refCoords, usedIds, mealType, 3);
        }
        // Fallback: quality-only from full pool
        if (topRestaurants.length === 0) {
          topRestaurants = findTopByQuality(pool, usedIds, mealType, 3);
        }
      }

      // Fallback robuste : ne jamais laisser restaurant: null
      if (topRestaurants.length === 0) {
        // Retry 1: distance étendue (5km) sans filtre cuisine
        const extendedResults = findTopRestaurants(pool, refCoords, new Set(), 'lunch', 3); // 'lunch' = pas de filtre cuisine strict, 3km
        if (extendedResults.length > 0) {
          topRestaurants = extendedResults;
        }
      }

      if (topRestaurants.length === 0) {
        // Retry 2: qualité seule sans filtre usedIds
        const qualityResults = findTopByQuality(pool, new Set(), mealType, 3);
        if (qualityResults.length > 0) {
          topRestaurants = qualityResults;
        }
      }

      if (topRestaurants.length === 0) {
        // Fallback générique — restaurant fictif
        const fallbackName = mealType === 'breakfast' ? 'Café local' : 'Restaurant local';
        topRestaurants = [{
          id: `fallback-${cluster.dayNumber}-${mealType}`,
          name: fallbackName,
          address: '',
          latitude: refCoords.lat,
          longitude: refCoords.lng,
          rating: 0,
          reviewCount: 0,
          priceLevel: 2 as const,
          cuisineTypes: ['locale'],
          dietaryOptions: [],
          openingHours: {},
          dataReliability: 'generated' as const,
        }];
      }

      const best = topRestaurants[0];
      const alternatives = topRestaurants.slice(1);

      if (best) {
        usedIds.add(best.id);
      }

      assignments.push({
        dayNumber: cluster.dayNumber,
        mealType,
        restaurant: best,
        restaurantAlternatives: alternatives,
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
 * Cuisine types that are inappropriate for breakfast.
 * These serve heavy dinner-style food, not breakfast items.
 */
const BREAKFAST_EXCLUDED_CUISINES = [
  'steakhouse', 'steak', 'grill', 'bbq', 'barbecue',
  'sushi', 'ramen', 'chinese', 'indian', 'thai', 'korean',
  'mexican', 'tapas', 'fondue', 'raclette',
  'seafood', 'fish', 'fruits de mer', 'poisson',
  'pub', 'bar', 'cocktail', 'wine bar',
  'nightclub', 'disco',
  'fast food', 'burger', 'pizza', 'kebab', 'shawarma',
  // Asian cuisine subtypes not covered above
  'nepali', 'nepalese', 'népalais', 'asian', 'asiatique',
  'vietnamese', 'vietnamien', 'japanese', 'japonais',
  'indonesian', 'indonésien', 'malaysian', 'malaisien',
  'tibetan', 'tibétain', 'sri lankan',
];

/**
 * Check if a restaurant is appropriate for a given meal type.
 */
function isAppropriateForMeal(restaurant: Restaurant, mealType: 'breakfast' | 'lunch' | 'dinner'): boolean {
  if (mealType !== 'breakfast') return true; // No filtering for lunch/dinner

  const name = (restaurant.name || '').toLowerCase();
  // Read both singular field and plural array (different API sources use different formats)
  const cuisineTypesArr = (restaurant as any).cuisineTypes || [];
  const cuisineStr = Array.isArray(cuisineTypesArr)
    ? cuisineTypesArr.join(' ').toLowerCase()
    : String(cuisineTypesArr).toLowerCase();
  const cuisineSingular = ((restaurant as any).cuisineType || (restaurant as any).cuisine || '').toLowerCase();
  const type = ((restaurant as any).type || '').toLowerCase();
  const allText = `${name} ${cuisineStr} ${cuisineSingular} ${type}`;

  // Exclude inappropriate cuisine types for breakfast
  for (const excluded of BREAKFAST_EXCLUDED_CUISINES) {
    if (allText.includes(excluded)) return false;
  }

  // Bonus: prefer places with breakfast-friendly keywords
  // (but don't require them — a generic restaurant is still OK for breakfast)
  return true;
}

/**
 * Find the top N restaurants for a meal slot, ranked by quality/distance.
 * Score = (rating × log10(reviewCount) + mealTypeBonus) / distance
 * For breakfast: filters out inappropriate cuisines (steakhouse, BBQ, etc.)
 * Returns restaurants enriched with `distance` field.
 */
function findTopRestaurants(
  pool: Restaurant[],
  refCoords: { lat: number; lng: number },
  usedIds: Set<string>,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  count: number = 3
): Restaurant[] {
  const scored: { restaurant: Restaurant; score: number; distance: number }[] = [];

  const maxDistance = mealType === 'breakfast' ? 2.0 : 3.0; // km (generous — city-scale walking/transit)

  for (const r of pool) {
    if (usedIds.has(r.id)) continue;
    if (!r.latitude || !r.longitude || r.latitude === 0) continue;

    // Filter by cuisine appropriateness for the meal type
    if (!isAppropriateForMeal(r, mealType)) continue;

    const dist = calculateDistance(
      refCoords.lat, refCoords.lng,
      r.latitude, r.longitude
    );

    if (dist > maxDistance) continue;

    const rating = r.rating || 3;
    const reviews = Math.max(r.reviewCount || 1, 1);
    const qualityScore = rating * Math.log10(reviews);
    const distancePenalty = Math.max(0.05, dist); // min 50m

    // For breakfast: boost cafés, bakeries, and breakfast-oriented places
    let mealTypeBonus = 0;
    if (mealType === 'breakfast') {
      const nameAndCuisine = `${(r.name || '').toLowerCase()} ${((r as any).cuisineType || '').toLowerCase()}`;
      const isBreakfastFriendly = ['café', 'cafe', 'bakery', 'boulangerie', 'pâtisserie', 'patisserie',
        'brunch', 'breakfast', 'petit-déjeuner', 'coffeeshop', 'coffee', 'tea', 'thé',
        'croissant', 'pancake', 'deli'].some(k => nameAndCuisine.includes(k));
      if (isBreakfastFriendly) mealTypeBonus = 3;
    }

    const score = (qualityScore + mealTypeBonus) / distancePenalty;
    scored.push({ restaurant: r, score, distance: dist });
  }

  scored.sort((a, b) => b.score - a.score);

  // Enrichir chaque restaurant avec le champ `distance`
  return scored.slice(0, count).map(s => ({
    ...s.restaurant,
    distance: s.distance,
  }));
}

/**
 * Pick the top N highest-rated unused restaurants (ignoring distance).
 * Used when GPS coordinates are unreliable (fake city-center fallback).
 * Still applies meal type filtering (e.g. no steakhouse for breakfast).
 */
function findTopByQuality(
  pool: Restaurant[],
  usedIds: Set<string>,
  mealType: 'breakfast' | 'lunch' | 'dinner' = 'lunch',
  count: number = 3
): Restaurant[] {
  const scored: { restaurant: Restaurant; score: number }[] = [];

  for (const r of pool) {
    if (usedIds.has(r.id)) continue;

    // Filter by cuisine appropriateness for the meal type
    if (!isAppropriateForMeal(r, mealType)) continue;

    const rating = r.rating || 3;
    const reviews = Math.max(r.reviewCount || 1, 1);
    let score = rating * Math.log10(reviews);

    // For breakfast: boost café/bakery types
    if (mealType === 'breakfast') {
      const nameAndCuisine = `${(r.name || '').toLowerCase()} ${((r as any).cuisineType || '').toLowerCase()}`;
      const isBreakfastFriendly = ['café', 'cafe', 'bakery', 'boulangerie', 'pâtisserie', 'patisserie',
        'brunch', 'breakfast', 'petit-déjeuner', 'coffeeshop', 'coffee', 'tea', 'thé',
        'croissant', 'pancake', 'deli'].some(k => nameAndCuisine.includes(k));
      if (isBreakfastFriendly) score += 3;
    }

    scored.push({ restaurant: r, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => s.restaurant);
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

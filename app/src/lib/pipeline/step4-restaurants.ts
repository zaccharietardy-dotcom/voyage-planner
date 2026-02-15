/**
 * Pipeline V2 — Step 4: Restaurant Assignment
 *
 * Proximity-first meal assignment:
 * - Hard distance constraints by meal type
 * - Quality ranking inside the local radius
 * - No "quality-only" fallback that can create long detours
 * Pure function, zero API calls.
 */

import type { Restaurant, BudgetStrategy, TripPreferences } from '../types';
import type { ActivityCluster, MealAssignment, RestaurantAssignmentResult } from './types';
import { calculateDistance } from '../services/geocoding';
import { mergeRestaurantSources } from './utils/dedup';

type MealType = 'breakfast' | 'lunch' | 'dinner';

const MEAL_DISTANCE_LIMITS: Record<MealType, { idealKm: number; hardKm: number; absoluteKm: number }> = {
  // Breakfast should stay very close to the hotel.
  breakfast: { idealKm: 0.4, hardKm: 0.8, absoluteKm: 1.2 },
  // Lunch/dinner: allow up to 2km in step4 (cluster centroids can differ from final activity positions).
  // Step7 re-optimization will tighten to <500m after activity reordering.
  lunch: { idealKm: 0.5, hardKm: 1.0, absoluteKm: 2.0 },
  dinner: { idealKm: 0.5, hardKm: 1.0, absoluteKm: 2.0 },
};

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
  'nepali', 'nepalese', 'népalais', 'asian', 'asiatique',
  'vietnamese', 'vietnamien', 'japanese', 'japonais',
  'indonesian', 'indonésien', 'malaysian', 'malaisien',
  'tibetan', 'tibétain', 'sri lankan',
];

const BREAKFAST_SPECIALIZED_KEYWORDS = [
  'boulangerie', 'bakery', 'pâtisserie', 'patisserie',
  'café', 'cafe', 'coffee', 'coffee shop', 'caffè', 'cafe bar',
  'brunch', 'breakfast', 'petit-déjeuner', 'petit dejeuner',
  'viennoiserie', 'croissant', 'tea room', 'salon de thé', 'salon de the',
];

const DINNER_EXCLUDED_KEYWORDS = [
  'brunch', 'breakfast', 'petit-déjeuner', 'petit dejeuner',
  'bakery', 'boulangerie', 'pâtisserie', 'patisserie',
  'coffee shop', 'salon de thé', 'salon de the', 'tea room',
  'viennoiserie', 'croissanterie',
];

const LUNCH_EXCLUDED_KEYWORDS = [
  'brunch', 'breakfast', 'petit-déjeuner', 'petit dejeuner',
];

const LOCAL_CUISINE_KEYWORDS: Record<string, string[]> = {
  france: ['français', 'francais', 'french', 'bistro', 'brasserie', 'provençal', 'lyonnais', 'normand', 'breton', 'alsacien', 'savoyard', 'gascon', 'basque'],
  italy: ['italien', 'italian', 'pizzeria', 'trattoria', 'osteria', 'ristorante'],
  spain: ['espagnol', 'spanish', 'tapas', 'paella', 'catalan', 'andalou'],
  germany: ['allemand', 'german', 'biergarten', 'brauhaus'],
  japan: ['japonais', 'japanese', 'sushi', 'ramen', 'izakaya'],
  greece: ['grec', 'greek', 'taverna'],
  morocco: ['marocain', 'moroccan', 'tagine', 'couscous'],
  usa: ['american', 'américain', 'diner', 'bbq', 'burger'],
  uk: ['british', 'anglais', 'pub', 'fish and chips'],
  portugal: ['portugais', 'portuguese'],
  thailand: ['thaï', 'thai', 'thaïlandais'],
  india: ['indien', 'indian', 'curry'],
  china: ['chinois', 'chinese', 'dim sum', 'cantonais'],
  lebanon: ['libanais', 'lebanese', 'mezze'],
  mexico: ['mexicain', 'mexican', 'tacos', 'taqueria'],
  vietnam: ['vietnamien', 'vietnamese', 'pho'],
  korea: ['coréen', 'korean', 'bibimbap'],
  turkey: ['turc', 'turkish', 'kebab'],
  peru: ['péruvien', 'peruvian', 'ceviche'],
};

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
  hotel?: { breakfastIncluded?: boolean } | null,
  previouslyUsedIds?: Set<string>
): RestaurantAssignmentResult {
  // 1. Merge real API sources only.
  const allRestaurants = mergeRestaurantSources(
    tripAdvisorRestaurants as any,
    serpApiRestaurants as any
  ) as Restaurant[];

  // 2. Filter by budget.
  const maxPriceLevel = getBudgetPriceLevel(preferences.budgetLevel);
  const budgetFiltered = allRestaurants.filter(
    r => !r.priceLevel || r.priceLevel <= maxPriceLevel + 1
  );
  const pool = budgetFiltered.length > 5 ? budgetFiltered : allRestaurants;

  // Keep only restaurants with valid coordinates for distance-aware assignment.
  const geoPool = pool.filter(hasValidCoordinates);
  console.log(
    `[Pipeline V2] Restaurants pool: total=${allRestaurants.length}, budgetFiltered=${pool.length}, geo=${geoPool.length}`
  );

  // 3. Assign for each day and meal.
  const assignments: MealAssignment[] = [];
  const usedIds = new Set<string>(previouslyUsedIds || []);
  const mealOrder: MealType[] = ['breakfast', 'lunch', 'dinner'];
  const cuisineHistoryByMeal: Record<MealType, string[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
  };

  for (const cluster of clusters) {
    const dayCuisineFamilies = new Set<string>();
    for (const mealType of mealOrder) {
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

      if (mealType === 'breakfast' && hotel?.breakfastIncluded) {
        assignments.push({
          dayNumber: cluster.dayNumber,
          mealType,
          restaurant: null, // handled as hotel breakfast in step7
          restaurantAlternatives: [],
          referenceCoords: accommodationCoords,
        });
        continue;
      }

      const refCoords = getMealReferenceCoords(mealType, cluster, accommodationCoords);

      const topRestaurants = prioritizeCuisineVariety(
        selectTopNearbyRestaurants(
        geoPool,
        refCoords,
        usedIds,
        mealType,
        3,
        preferences.destination
        ),
        mealType,
        dayCuisineFamilies,
        cuisineHistoryByMeal[mealType]
      );

      // If no reasonable local restaurant exists, leave it null.
      // The pipeline should then fetch better data (API issue) rather than fake a local item.
      if (topRestaurants.length === 0) {
        assignments.push({
          dayNumber: cluster.dayNumber,
          mealType,
          restaurant: null,
          restaurantAlternatives: [],
          referenceCoords: refCoords,
        });
        continue;
      }

      const best = topRestaurants[0];
      const alternatives = topRestaurants.slice(1);

      if (best) {
        usedIds.add(best.id);
        const selectedFamily = getCuisineFamily(best);
        dayCuisineFamilies.add(selectedFamily);
        cuisineHistoryByMeal[mealType].push(selectedFamily);
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

  return {
    meals: assignments,
    restaurantGeoPool: geoPool,
  };
}

function prioritizeCuisineVariety(
  candidates: Restaurant[],
  mealType: MealType,
  dayCuisineFamilies: Set<string>,
  mealHistory: string[]
): Restaurant[] {
  if (candidates.length <= 1) return candidates;

  const recentFamilies = new Set(mealHistory.slice(-2));
  const rescored = candidates.map((restaurant, index) => {
    const family = getCuisineFamily(restaurant);
    let diversityScore = 0;

    // Avoid repeating the same cuisine multiple times in a single day.
    if (dayCuisineFamilies.has(family)) diversityScore -= 2.5;

    // Avoid repeating the exact same cuisine for the same meal across recent days.
    if (recentFamilies.has(family)) diversityScore -= mealType === 'breakfast' ? 1.25 : 1.75;

    // Slightly prefer explicit cuisine labels over generic buckets.
    if (family !== 'generic') diversityScore += 0.6;

    return { restaurant, index, diversityScore };
  });

  rescored.sort((a, b) => {
    if (b.diversityScore !== a.diversityScore) return b.diversityScore - a.diversityScore;
    return a.index - b.index;
  });

  return rescored.map((entry) => entry.restaurant);
}

function hasValidCoordinates(restaurant: Restaurant): boolean {
  return Boolean(
    restaurant.latitude &&
    restaurant.longitude &&
    restaurant.latitude !== 0 &&
    restaurant.longitude !== 0
  );
}

/**
 * Check if a restaurant is appropriate for a given meal type.
 */
export function isAppropriateForMeal(restaurant: Restaurant, mealType: MealType): boolean {
  const name = (restaurant.name || '').toLowerCase();
  const cuisineTypesArr = (restaurant as any).cuisineTypes || [];
  const cuisineStr = Array.isArray(cuisineTypesArr)
    ? cuisineTypesArr.join(' ').toLowerCase()
    : String(cuisineTypesArr).toLowerCase();
  const cuisineSingular = ((restaurant as any).cuisineType || (restaurant as any).cuisine || '').toLowerCase();
  const type = ((restaurant as any).type || '').toLowerCase();
  const allText = `${name} ${cuisineStr} ${cuisineSingular} ${type}`;

  if (mealType === 'breakfast') {
    for (const excluded of BREAKFAST_EXCLUDED_CUISINES) {
      if (allText.includes(excluded)) return false;
    }
    return true;
  }

  if (mealType === 'dinner') {
    for (const excluded of DINNER_EXCLUDED_KEYWORDS) {
      if (allText.includes(excluded)) return false;
    }
    return true;
  }

  if (mealType === 'lunch') {
    for (const excluded of LUNCH_EXCLUDED_KEYWORDS) {
      if (allText.includes(excluded)) return false;
    }
    return true;
  }

  return true;
}

/**
 * Strict breakfast predicate:
 * - Excludes heavy/non-breakfast cuisines
 * - Requires explicit breakfast-oriented signals (bakery/cafe/brunch/etc.)
 */
export function isBreakfastSpecialized(restaurant: Restaurant): boolean {
  if (!restaurant) return false;
  if (!isAppropriateForMeal(restaurant, 'breakfast')) return false;

  const type = String((restaurant as any).type || '').toLowerCase();
  const name = String(restaurant.name || '').toLowerCase();
  const cuisines = Array.isArray(restaurant.cuisineTypes)
    ? restaurant.cuisineTypes.join(' ').toLowerCase()
    : '';
  const description = String((restaurant as any).description || '').toLowerCase();
  const specialties = Array.isArray((restaurant as any).specialties)
    ? (restaurant as any).specialties.join(' ').toLowerCase()
    : '';
  const allText = `${name} ${cuisines} ${type} ${description} ${specialties}`;

  return BREAKFAST_SPECIALIZED_KEYWORDS.some((keyword) => allText.includes(keyword));
}

function detectDestinationCountry(destination: string): string {
  const d = destination.toLowerCase();
  if (d.includes('paris') || d.includes('lyon') || d.includes('marseille') || d.includes('france')) return 'france';
  if (d.includes('rome') || d.includes('milan') || d.includes('florence') || d.includes('italy') || d.includes('italie')) return 'italy';
  if (d.includes('madrid') || d.includes('barcelona') || d.includes('spain') || d.includes('espagne')) return 'spain';
  if (d.includes('berlin') || d.includes('munich') || d.includes('germany') || d.includes('allemagne')) return 'germany';
  if (d.includes('tokyo') || d.includes('kyoto') || d.includes('japan') || d.includes('japon')) return 'japan';
  if (d.includes('athens') || d.includes('greece') || d.includes('grèce')) return 'greece';
  if (d.includes('marrakech') || d.includes('morocco') || d.includes('maroc')) return 'morocco';
  if (d.includes('london') || d.includes('uk') || d.includes('angleterre')) return 'uk';
  if (d.includes('lisbon') || d.includes('portugal')) return 'portugal';
  if (d.includes('bangkok') || d.includes('thailand') || d.includes('thaïlande')) return 'thailand';
  return 'france'; // default
}

/**
 * Fine-grained cuisine family detection.
 * Returns a specific cuisine tag (e.g. "italian", "japanese", "brasserie")
 * instead of just a country code, so the diversity algorithm can distinguish
 * between e.g. a brasserie and a boulangerie (both "france").
 */
export function getCuisineFamily(restaurant: Restaurant): string {
  const text = `${restaurant.name || ''} ${(restaurant.cuisineTypes || []).join(' ')}`.toLowerCase();

  // Check fine-grained categories first (more specific = earlier match)
  const FINE_CUISINE_MAP: Record<string, string[]> = {
    'japanese': ['sushi', 'ramen', 'izakaya', 'japonais', 'japanese', 'yakitori', 'tempura', 'udon', 'sashimi', 'maki'],
    'italian': ['italien', 'italian', 'pizza', 'pizzeria', 'trattoria', 'osteria', 'ristorante', 'pasta', 'risotto'],
    'chinese': ['chinois', 'chinese', 'dim sum', 'cantonais', 'szechuan', 'wok'],
    'indian': ['indien', 'indian', 'curry', 'tandoori', 'naan', 'masala'],
    'thai': ['thaï', 'thai', 'thaïlandais', 'pad thai'],
    'vietnamese': ['vietnamien', 'vietnamese', 'pho', 'banh mi', 'bo bun'],
    'korean': ['coréen', 'korean', 'bibimbap', 'kimchi'],
    'mexican': ['mexicain', 'mexican', 'tacos', 'taqueria', 'burrito', 'guacamole'],
    'lebanese': ['libanais', 'lebanese', 'mezze', 'falafel', 'shawarma'],
    'moroccan': ['marocain', 'moroccan', 'tagine', 'couscous'],
    'greek': ['grec', 'greek', 'taverna', 'gyros', 'souvlaki'],
    'turkish': ['turc', 'turkish', 'kebab', 'döner'],
    'spanish': ['espagnol', 'spanish', 'tapas', 'paella'],
    'peruvian': ['péruvien', 'peruvian', 'ceviche'],
    'american': ['american', 'américain', 'burger', 'diner', 'bbq', 'barbecue'],
    'brasserie': ['brasserie'],
    'bistro': ['bistro', 'bistrot'],
    'french-gastro': ['gastronomique', 'étoilé', 'michelin', 'gastro'],
    'bakery': ['boulangerie', 'bakery', 'pain', 'bread'],
    'patisserie': ['pâtisserie', 'patisserie'],
    'seafood': ['fruits de mer', 'seafood', 'poisson', 'fish', 'crustacé', 'huître', 'oyster'],
    'steakhouse': ['steakhouse', 'steak', 'grill', 'viande', 'boucherie'],
    'french': ['français', 'francais', 'french', 'provençal', 'lyonnais', 'normand', 'breton', 'alsacien', 'savoyard'],
  };

  for (const [family, keywords] of Object.entries(FINE_CUISINE_MAP)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return family;
    }
  }

  // Fallback to country-level detection
  for (const [country, keywords] of Object.entries(LOCAL_CUISINE_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return country;
    }
  }
  return 'generic';
}

function isLocalCuisine(restaurant: Restaurant, country: string): boolean {
  const keywords = LOCAL_CUISINE_KEYWORDS[country] || [];
  const text = `${restaurant.name || ''} ${(restaurant.cuisineTypes || []).join(' ')}`.toLowerCase();
  return keywords.some(kw => text.includes(kw));
}

/**
 * Score candidates with strong distance penalties.
 * Proximity dominates once we are outside the ideal radius.
 */
function scoreCandidate(restaurant: Restaurant, mealType: MealType, distanceKm: number): number {
  const rating = restaurant.rating || 3;
  const reviews = Math.max(restaurant.reviewCount || 1, 1);
  const quality = rating * 2 + Math.log10(reviews + 1) * 1.5;

  const limits = MEAL_DISTANCE_LIMITS[mealType];
  const distanceWeight = mealType === 'breakfast' ? 4.0 : 3.5;
  let score = quality - distanceKm * distanceWeight;

  if (distanceKm > limits.idealKm) {
    score -= (distanceKm - limits.idealKm) * 3.0;
  }

  if (mealType === 'breakfast' && isBreakfastSpecialized(restaurant)) {
    score += 1.5;
  }

  return score;
}

/**
 * Select top nearby restaurants with strict radius handling:
 * 1) ideal radius, 2) hard radius, 3) absolute radius.
 * No quality-only fallback beyond absolute radius.
 */
function selectTopNearbyRestaurants(
  pool: Restaurant[],
  refCoords: { lat: number; lng: number },
  usedIds: Set<string>,
  mealType: MealType,
  count: number = 3,
  destination?: string
): Restaurant[] {
  const limits = MEAL_DISTANCE_LIMITS[mealType];
  const scored: { restaurant: Restaurant; score: number; distanceKm: number }[] = [];

  for (const r of pool) {
    if (usedIds.has(r.id)) continue;
    if (!hasValidCoordinates(r)) continue;
    if (!isAppropriateForMeal(r, mealType)) continue;
    if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;

    const distanceKm = calculateDistance(
      refCoords.lat, refCoords.lng,
      r.latitude, r.longitude
    );

    if (distanceKm > limits.absoluteKm) continue;
    scored.push({
      restaurant: r,
      score: scoreCandidate(r, mealType, distanceKm),
      distanceKm,
    });
  }

  if (scored.length === 0) return [];

  const inIdeal = scored.filter(s => s.distanceKm <= limits.idealKm);
  const inHard = scored.filter(s => s.distanceKm <= limits.hardKm);
  const shortlist = inIdeal.length >= count
    ? inIdeal
    : inHard.length >= count
      ? inHard
      : scored;

  shortlist.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.distanceKm - b.distanceKm;
  });

  // Diversity selection: maximize cuisine variety across the 3 picks.
  // Goal: brasserie + italian + sushi (for Paris), not 3x "restaurant français".
  if (count >= 3 && shortlist.length >= 3 && destination) {
    const country = detectDestinationCountry(destination);
    // Also mark fine-grained local sub-families as "local"
    const LOCAL_SUB_FAMILIES: Record<string, string[]> = {
      france: ['french', 'brasserie', 'bistro', 'french-gastro', 'bakery', 'patisserie'],
      italy: ['italian'],
      spain: ['spanish'],
      japan: ['japanese'],
      germany: [],
      greece: ['greek'],
      morocco: ['moroccan'],
      usa: ['american'],
      uk: [],
    };
    const localSubs = new Set<string>(LOCAL_SUB_FAMILIES[country] || []);
    localSubs.add(country);

    const result: typeof shortlist = [];
    const usedFamilies = new Set<string>();

    // Pick 1: best local/destination cuisine
    const bestLocal = shortlist.find(s => {
      const fam = getCuisineFamily(s.restaurant);
      return localSubs.has(fam) || isLocalCuisine(s.restaurant, country);
    });
    if (bestLocal) {
      result.push(bestLocal);
      const fam = getCuisineFamily(bestLocal.restaurant);
      usedFamilies.add(fam);
      // Also block all local sub-families to avoid picking brasserie + bistro
      for (const sub of localSubs) usedFamilies.add(sub);
    }

    // Pick 2 & 3: maximize diversity — pick restaurants with different cuisine families
    for (const s of shortlist) {
      if (result.length >= count) break;
      if (result.some(r => r.restaurant.id === s.restaurant.id)) continue;
      const family = getCuisineFamily(s.restaurant);
      if (!usedFamilies.has(family)) {
        result.push(s);
        usedFamilies.add(family);
      }
    }

    // If we still need more, accept "generic" restaurants too
    for (const s of shortlist) {
      if (result.length >= count) break;
      if (result.some(r => r.restaurant.id === s.restaurant.id)) continue;
      result.push(s);
    }

    return result.slice(0, count).map(s => ({ ...s.restaurant, distance: s.distanceKm }));
  }

  return shortlist.slice(0, count).map(s => ({
    ...s.restaurant,
    distance: s.distanceKm,
  }));
}

/**
 * Find the activity closest to the cluster centroid.
 * This is the "real heart" of the cluster — an actual place the traveler
 * will be, unlike the geometric centroid which can fall in the middle of a river.
 */
function getNearestActivityToCentroid(
  cluster: ActivityCluster
): { lat: number; lng: number } {
  if (!cluster.activities.length) return cluster.centroid;

  let bestLat = cluster.centroid.lat;
  let bestLng = cluster.centroid.lng;
  let bestDist = Infinity;

  for (const a of cluster.activities) {
    if (!a.latitude || !a.longitude) continue;
    const d = calculateDistance(a.latitude, a.longitude, cluster.centroid.lat, cluster.centroid.lng);
    if (d < bestDist) {
      bestDist = d;
      bestLat = a.latitude;
      bestLng = a.longitude;
    }
  }

  return { lat: bestLat, lng: bestLng };
}

/**
 * Determine where the traveler will be for each meal type.
 */
function getMealReferenceCoords(
  mealType: MealType,
  cluster: ActivityCluster,
  accommodationCoords: { lat: number; lng: number }
): { lat: number; lng: number } {
  if (mealType === 'breakfast') {
    return accommodationCoords;
  }

  const activities = cluster.activities;
  if (activities.length === 0) return cluster.centroid;

  if (mealType === 'lunch') {
    // Use middle activity (where traveler will be at lunchtime)
    const midIdx = Math.max(0, Math.floor(activities.length / 2) - 1);
    const mid = activities[midIdx];
    if (mid.latitude && mid.longitude) {
      return { lat: mid.latitude, lng: mid.longitude };
    }
    return cluster.centroid;
  }

  // Dinner: last activity with slight hotel pull (20%)
  const last = activities[activities.length - 1];
  if (last.latitude && last.longitude) {
    return {
      lat: last.latitude * 0.8 + accommodationCoords.lat * 0.2,
      lng: last.longitude * 0.8 + accommodationCoords.lng * 0.2,
    };
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
  mealType: MealType,
  budgetStrategy: BudgetStrategy | null
): boolean {
  if (!budgetStrategy) return false;
  return budgetStrategy.mealsStrategy?.[mealType] === 'self_catered';
}

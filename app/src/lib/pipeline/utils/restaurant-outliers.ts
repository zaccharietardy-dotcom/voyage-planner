/**
 * Restaurant outlier detection and replacement.
 *
 * Extracted from step7-assemble.ts — this is the only function from that
 * legacy file still used by the V3 pipeline.
 */

import type { TripDay, TripItem, Restaurant } from '../../types';
import {
  type AnchorPoint,
  hasValidCoords,
  restaurantAnchorPoints as restaurantAnchorPointsFromSorted,
  minDistanceToAnchorsKm,
} from './restaurant-proximity';
import { RESTAURANT_ABSOLUTE_MAX_KM } from '../qualityPolicy';
import { searchRestaurantsNearbyWithFallback } from '../../services/serpApiPlaces';
import { isAppropriateForMeal, isBreakfastSpecialized } from '../step4-restaurants';
import { calculateDistance } from '../../services/geocoding';
import { sanitizeApiKeyLeaksInString, sanitizeGoogleMapsUrl } from '../../services/googlePlacePhoto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BREAKFAST_RESTAURANT_MAX_KM = 1.2;
const DEFAULT_MEAL_RESTAURANT_MAX_KM = 1.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RestaurantFixStats = { replaced: number; flaggedFallback: number };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseHHMMToMinutes(time: string): number {
  const [h, m] = time.split(':').map((v) => Number(v));
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;
  return hour * 60 + minute;
}

function sortItemsByTime(items: TripItem[]): TripItem[] {
  return [...items].sort((a, b) => {
    const startDiff = parseHHMMToMinutes(a.startTime) - parseHHMMToMinutes(b.startTime);
    if (startDiff !== 0) return startDiff;
    const endDiff = parseHHMMToMinutes(a.endTime) - parseHHMMToMinutes(b.endTime);
    if (endDiff !== 0) return endDiff;
    return (a.orderIndex || 0) - (b.orderIndex || 0);
  });
}

function isBudgetSelfCateredItem(item: TripItem): boolean {
  const flags = Array.isArray(item.qualityFlags) ? item.qualityFlags : [];
  if (flags.includes('budget_self_catered_meal')) return true;
  return (item.title || '').toLowerCase().includes('cuisine maison');
}

function stripMealPrefix(title: string): string {
  return title.replace(/^(Petit-déjeuner|Déjeuner|Dîner)\s+—\s+/, '').trim();
}

function normalizeRestaurantName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractMealLabel(title: string): string {
  if (title.startsWith('Petit-déjeuner')) return 'Petit-déjeuner';
  if (title.startsWith('Déjeuner')) return 'Déjeuner';
  if (title.startsWith('Dîner')) return 'Dîner';
  return title.split(' — ')[0] || title;
}

function normalizeRestaurantGooglePhotoUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const sanitized = sanitizeApiKeyLeaksInString(sanitizeGoogleMapsUrl(raw));
  if (sanitized.startsWith('/api/place-photo?')) return sanitized;
  if (sanitized.includes('maps.googleapis.com/maps/api/place/photo')) {
    return sanitizeGoogleMapsUrl(sanitized);
  }
  return undefined;
}

function extractGoogleRestaurantPhotos(restaurant?: Partial<Restaurant>): string[] {
  const photos = Array.isArray(restaurant?.photos) ? restaurant.photos : [];
  const normalized = photos
    .map((photo) => normalizeRestaurantGooglePhotoUrl(photo))
    .filter((photo): photo is string => Boolean(photo));
  return [...new Set(normalized)];
}

function enforceGoogleRestaurantPhotoPolicy(restaurant?: Restaurant): void {
  if (!restaurant) return;
  const googlePhotos = extractGoogleRestaurantPhotos(restaurant);
  if (googlePhotos.length > 0) {
    restaurant.photos = googlePhotos;
  } else {
    delete restaurant.photos;
  }
}

function getRestaurantMealType(item: TripItem): 'breakfast' | 'lunch' | 'dinner' {
  const title = item.title || '';
  if (title.includes('Petit-déjeuner')) return 'breakfast';
  if (title.includes('Déjeuner')) return 'lunch';
  return 'dinner';
}

function applyRestaurantCandidateToItem(
  item: TripItem,
  candidate: Restaurant,
  source: TripItem['selectionSource'],
  destination: string
): void {
  const mealLabel = extractMealLabel(item.title);
  const baseRestaurant: Restaurant = { ...candidate };
  enforceGoogleRestaurantPhotoPolicy(baseRestaurant);

  item.title = `${mealLabel} — ${baseRestaurant.name}`;
  item.locationName = baseRestaurant.address || baseRestaurant.name;
  item.latitude = baseRestaurant.latitude || item.latitude;
  item.longitude = baseRestaurant.longitude || item.longitude;
  item.rating = baseRestaurant.rating ?? item.rating;
  item.estimatedCost = baseRestaurant.priceLevel ? baseRestaurant.priceLevel * 15 : item.estimatedCost;
  item.bookingUrl = baseRestaurant.googleMapsUrl || baseRestaurant.website || item.bookingUrl;
  item.googleMapsPlaceUrl = baseRestaurant.googleMapsUrl
    || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${baseRestaurant.name}, ${destination}`)}`;
  if (baseRestaurant.latitude && baseRestaurant.longitude) {
    item.googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${baseRestaurant.latitude},${baseRestaurant.longitude}`;
  }
  item.restaurant = baseRestaurant;
  item.imageUrl = baseRestaurant.photos?.[0];
  item.selectionSource = source;
  item.dataReliability = source === 'fallback' ? 'estimated' : 'verified';
}

function rankRestaurantCandidate(
  candidate: Restaurant,
  anchors: AnchorPoint[],
  usedNames: Set<string>,
  currentRestaurantId: string | undefined,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  maxDistanceKm: number
): { restaurant: Restaurant; distance: number } | null {
  if (!candidate.latitude || !candidate.longitude) return null;
  if (currentRestaurantId && candidate.id === currentRestaurantId) return null;
  if (!isAppropriateForMeal(candidate, mealType)) return null;
  if (mealType === 'breakfast' && !isBreakfastSpecialized(candidate)) return null;

  const normalizedName = normalizeRestaurantName(candidate.name || '');
  if (!normalizedName || usedNames.has(normalizedName)) return null;

  const distances = anchors.map((anchor) => calculateDistance(candidate.latitude!, candidate.longitude!, anchor.latitude, anchor.longitude));
  const distance = distances.length > 0 ? Math.min(...distances) : Infinity;
  if (!Number.isFinite(distance) || distance > maxDistanceKm) return null;

  // Absolute hard cap: no restaurant beyond 5km regardless of profile
  if (distance > RESTAURANT_ABSOLUTE_MAX_KM) return null;

  return { restaurant: candidate, distance };
}

/**
 * Extract normalized cuisine types from a restaurant.
 * Used for cuisine diversity tracking in restaurant selection.
 */
function extractCuisineTypes(restaurant: Restaurant | undefined): Set<string> {
  const cuisines = new Set<string>();
  if (!restaurant?.cuisineTypes) return cuisines;
  for (const ct of restaurant.cuisineTypes) {
    cuisines.add(ct.toLowerCase().trim());
  }
  return cuisines;
}

/**
 * Check if a restaurant has any cuisine that's NOT in the existing cuisines set.
 * Returns true if the restaurant introduces at least one new cuisine family.
 */
function hasNewCuisineFamily(restaurant: Restaurant | undefined, existingCuisines: Set<string>): boolean {
  if (!restaurant?.cuisineTypes || restaurant.cuisineTypes.length === 0) return false;
  for (const ct of restaurant.cuisineTypes) {
    const normalized = ct.toLowerCase().trim();
    if (!existingCuisines.has(normalized)) return true;
  }
  return false;
}

/**
 * Add all cuisines from a restaurant to the existing cuisines set (mutates the set).
 */
function addCuisinesToSet(restaurant: Restaurant | undefined, cuisinesSet: Set<string>): void {
  if (!restaurant?.cuisineTypes) return;
  for (const ct of restaurant.cuisineTypes) {
    cuisinesSet.add(ct.toLowerCase().trim());
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function fixRestaurantOutliers(
  days: TripDay[],
  altPool: Restaurant[],
  destination: string,
  options: {
    allowApiFallback?: boolean;
    breakfastMaxKm?: number;
    mealMaxKm?: number;
    hotelCoords?: AnchorPoint;
  } = {}
): Promise<RestaurantFixStats> {
  const allowApiFallback = options.allowApiFallback ?? true;
  const breakfastMaxKm = options.breakfastMaxKm || DEFAULT_BREAKFAST_RESTAURANT_MAX_KM;
  const mealMaxKm = options.mealMaxKm || DEFAULT_MEAL_RESTAURANT_MAX_KM;
  const defaultHotelAnchor = options.hotelCoords && hasValidCoords(options.hotelCoords)
    ? options.hotelCoords
    : undefined;
  const stats: RestaurantFixStats = { replaced: 0, flaggedFallback: 0 };
  let apiCalls = 0;
  const MAX_API_CALLS = 8;

  // Collect existing cuisine types across all trip days for diversity tracking
  const existingCuisines = new Set<string>();
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'restaurant' && item.restaurant) {
        const cuisines = extractCuisineTypes(item.restaurant);
        cuisines.forEach(c => existingCuisines.add(c));
      }
    }
  }

  for (const day of days) {
    const sorted = sortItemsByTime(day.items);
    const usedNames = new Set<string>();
    let dayOutliers = 0;

    for (let idx = 0; idx < sorted.length; idx++) {
      const item = sorted[idx];
      if (item.type !== 'restaurant') continue;
      if (isBudgetSelfCateredItem(item)) continue;

      const mealType = getRestaurantMealType(item);
      const maxDistanceKm = mealType === 'breakfast' ? breakfastMaxKm : mealMaxKm;
      const anchors = restaurantAnchorPointsFromSorted(sorted, idx, mealType, defaultHotelAnchor);
      const currentName = normalizeRestaurantName(item.restaurant?.name || item.locationName || stripMealPrefix(item.title));
      const duplicateInDay = currentName.length > 0 && usedNames.has(currentName);
      const currentDistanceKm = minDistanceToAnchorsKm(item, anchors);
      const absoluteDistanceOutlier = Number.isFinite(currentDistanceKm) && currentDistanceKm > RESTAURANT_ABSOLUTE_MAX_KM;
      const isOutlier =
        (Number.isFinite(currentDistanceKm) && currentDistanceKm > maxDistanceKm)
        || absoluteDistanceOutlier;

      if (!duplicateInDay && !isOutlier) {
        if (currentName) usedNames.add(currentName);
        if (!item.selectionSource) item.selectionSource = 'pool';
        continue;
      }

      let best: { restaurant: Restaurant; distance: number; source: TripItem['selectionSource'] } | null = null;
      const combinedPool = [
        ...(item.restaurantAlternatives || []),
        ...altPool,
      ];

      for (const candidate of combinedPool) {
        const ranked = rankRestaurantCandidate(
          candidate,
          anchors,
          usedNames,
          item.restaurant?.id,
          mealType,
          maxDistanceKm
        );
        if (!ranked) continue;

        // Check if this candidate introduces a new cuisine family (diversity bonus)
        const candidateHasNewCuisine = hasNewCuisineFamily(ranked.restaurant, existingCuisines);

        if (!best) {
          best = { ...ranked, source: 'pool' };
        } else {
          const bestRestaurantHasNewCuisine = hasNewCuisineFamily(best.restaurant, existingCuisines);
          const distanceSimilar = Math.abs(ranked.distance - best.distance) < 0.2; // within 200m

          // Prefer candidate if:
          // 1. It's closer by more than 200m, OR
          // 2. Similar distance and has new cuisine (diversity bonus), OR
          // 3. Similar distance, same cuisine novelty, but better rating
          if (ranked.distance < best.distance - 0.2) {
            best = { ...ranked, source: 'pool' };
          } else if (distanceSimilar && candidateHasNewCuisine && !bestRestaurantHasNewCuisine) {
            best = { ...ranked, source: 'pool' };
          } else if (distanceSimilar && candidateHasNewCuisine === bestRestaurantHasNewCuisine && (ranked.restaurant.rating || 0) > (best.restaurant.rating || 0)) {
            best = { ...ranked, source: 'pool' };
          }
        }
      }

      if (!best && allowApiFallback && anchors.length > 0 && apiCalls < MAX_API_CALLS) {
        apiCalls++;
        try {
          const anchor = anchors[0];
          const apiCandidates = await searchRestaurantsNearbyWithFallback(
            { lat: anchor.latitude, lng: anchor.longitude },
            destination,
            { mealType, maxDistance: Math.round(maxDistanceKm * 1000), limit: 8 }
          );
          for (const apiCandidate of apiCandidates) {
            const ranked = rankRestaurantCandidate(
              apiCandidate,
              anchors,
              usedNames,
              item.restaurant?.id,
              mealType,
              maxDistanceKm
            );
            if (!ranked) continue;

            // Check if this candidate introduces a new cuisine family (diversity bonus)
            const candidateHasNewCuisine = hasNewCuisineFamily(ranked.restaurant, existingCuisines);

            if (!best) {
              best = { ...ranked, source: 'api' };
            } else {
              const bestRestaurantHasNewCuisine = hasNewCuisineFamily(best.restaurant, existingCuisines);
              const distanceSimilar = Math.abs(ranked.distance - best.distance) < 0.2; // within 200m

              // Same logic as pool selection: prefer closer, then diversity, then rating
              if (ranked.distance < best.distance - 0.2) {
                best = { ...ranked, source: 'api' };
              } else if (distanceSimilar && candidateHasNewCuisine && !bestRestaurantHasNewCuisine) {
                best = { ...ranked, source: 'api' };
              } else if (distanceSimilar && candidateHasNewCuisine === bestRestaurantHasNewCuisine && (ranked.restaurant.rating || 0) > (best.restaurant.rating || 0)) {
                best = { ...ranked, source: 'api' };
              }
            }
          }
          if (apiCandidates.length > 0) {
            altPool.push(...apiCandidates);
          }
        } catch {
          // Non-blocking: keep fallback below.
        }
      }

      if (best) {
        applyRestaurantCandidateToItem(item, best.restaurant, best.source, destination);
        usedNames.add(normalizeRestaurantName(best.restaurant.name || item.locationName || ''));
        // Track newly added cuisines for ongoing diversity scoring
        addCuisinesToSet(best.restaurant, existingCuisines);
        stats.replaced++;
        continue;
      }

      item.selectionSource = 'fallback';
      item.dataReliability = 'estimated';
      item.description = item.description
        ? `${item.description} · Restaurant conservé faute d'alternative proche`
        : "Restaurant conservé faute d'alternative proche";
      if (currentName) usedNames.add(currentName);
      dayOutliers++;
      stats.flaggedFallback++;
    }

    day.items = sortItemsByTime(sorted).map((item, orderIndex) => ({ ...item, orderIndex }));
    day.scheduleDiagnostics = {
      ...(day.scheduleDiagnostics || {}),
      outlierRestaurantsCount: dayOutliers,
      loadRebalanced: day.scheduleDiagnostics?.loadRebalanced || false,
    };
  }

  return stats;
}

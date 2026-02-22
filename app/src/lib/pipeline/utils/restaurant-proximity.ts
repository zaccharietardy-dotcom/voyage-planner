/**
 * Shared restaurant proximity utilities.
 *
 * Computes "anchor points" for restaurant placement validation:
 * - Breakfast → anchored near the hotel
 * - Lunch/dinner → anchored between adjacent activities/transport
 *
 * Used by step7 (restaurant outlier fixing) and step8 (geo scoring).
 */

import type { TripItem } from '../../types';
import { calculateDistance } from '../../services/geocoding';

export type AnchorPoint = { latitude: number; longitude: number };

/**
 * Type guard: checks that a point has valid (non-zero) coordinates.
 */
export function hasValidCoords(
  point?: { latitude?: number; longitude?: number }
): point is AnchorPoint {
  if (!point) return false;
  if (typeof point.latitude !== 'number' || typeof point.longitude !== 'number') return false;
  return point.latitude !== 0 && point.longitude !== 0;
}

/**
 * Computes the anchor points for a restaurant at `restaurantIndex` in a
 * time-sorted list of items.
 *
 * @param sortedItems - Day items already sorted by start time
 * @param restaurantIndex - Index of the restaurant in sortedItems
 * @param mealType - breakfast, lunch, or dinner
 * @param defaultHotelAnchor - Fallback hotel coords (from accommodation)
 */
export function restaurantAnchorPoints(
  sortedItems: TripItem[],
  restaurantIndex: number,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  defaultHotelAnchor?: AnchorPoint
): AnchorPoint[] {
  const points: AnchorPoint[] = [];

  // Find hotel anchor from checkin/checkout in the day
  const hotelAnchorItem = sortedItems.find(
    (item) => (item.type === 'checkin' || item.type === 'checkout') && hasValidCoords(item)
  );
  const hotelAnchor = hotelAnchorItem && hasValidCoords(hotelAnchorItem)
    ? { latitude: hotelAnchorItem.latitude, longitude: hotelAnchorItem.longitude }
    : defaultHotelAnchor;

  const firstActivity = sortedItems.find(
    (item) => item.type === 'activity' && hasValidCoords(item)
  );

  if (mealType === 'breakfast') {
    // Breakfast anchored on hotel ONLY — must be near where you wake up.
    if (hotelAnchor) {
      points.push({ latitude: hotelAnchor.latitude, longitude: hotelAnchor.longitude });
    }
    // Fallback: use first activity if no hotel
    if (points.length === 0 && firstActivity && hasValidCoords(firstActivity)) {
      points.push({ latitude: firstActivity.latitude, longitude: firstActivity.longitude });
    }
    return points;
  }

  // Lunch/dinner: find nearest backward anchor (activity or transport)
  for (let i = restaurantIndex - 1; i >= 0; i--) {
    const candidate = sortedItems[i];
    if ((candidate.type === 'activity' || candidate.type === 'transport') && hasValidCoords(candidate)) {
      points.push({ latitude: candidate.latitude, longitude: candidate.longitude });
      break;
    }
  }

  // Find nearest forward anchor (activity, checkin, or checkout)
  for (let i = restaurantIndex + 1; i < sortedItems.length; i++) {
    const candidate = sortedItems[i];
    if (
      (candidate.type === 'activity' || candidate.type === 'checkin' || candidate.type === 'checkout') &&
      hasValidCoords(candidate)
    ) {
      points.push({ latitude: candidate.latitude, longitude: candidate.longitude });
      break;
    }
  }

  // Fallback if no adjacent items found
  if (points.length === 0) {
    if (hotelAnchor) {
      points.push({ latitude: hotelAnchor.latitude, longitude: hotelAnchor.longitude });
    }
    if (firstActivity && hasValidCoords(firstActivity)) {
      points.push({ latitude: firstActivity.latitude, longitude: firstActivity.longitude });
    }
  }

  return points;
}

/**
 * Returns the minimum distance (km) from a restaurant to any of its anchor points.
 */
export function minDistanceToAnchorsKm(
  restaurant: { latitude?: number; longitude?: number },
  anchors: AnchorPoint[]
): number {
  if (!hasValidCoords(restaurant) || anchors.length === 0) return Infinity;
  let minDistance = Infinity;
  for (const anchor of anchors) {
    const dist = calculateDistance(
      restaurant.latitude, restaurant.longitude,
      anchor.latitude, anchor.longitude
    );
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance;
}

/**
 * Simple nearest-item proximity: finds the minimum distance from a restaurant
 * to any non-restaurant item in the day, including hotel.
 *
 * This is a simpler alternative to anchor-based scoring, useful when you just
 * want the closest "anything" distance.
 */
export function nearestNonRestaurantDistKm(
  restaurant: { latitude: number; longitude: number },
  sortedItems: TripItem[],
  restaurantIndex: number,
  accommodation?: { latitude?: number; longitude?: number }
): number {
  let minDist = Infinity;
  for (let j = 0; j < sortedItems.length; j++) {
    if (j === restaurantIndex) continue;
    const other = sortedItems[j];
    if (!other.latitude || other.type === 'restaurant') continue;
    const dist = calculateDistance(
      restaurant.latitude, restaurant.longitude,
      other.latitude, other.longitude
    );
    minDist = Math.min(minDist, dist);
  }
  // Also check hotel proximity
  if (accommodation?.latitude && accommodation?.longitude) {
    const hotelDist = calculateDistance(
      restaurant.latitude, restaurant.longitude,
      accommodation.latitude, accommodation.longitude
    );
    minDist = Math.min(minDist, hotelDist);
  }
  return minDist;
}

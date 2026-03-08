/**
 * GPS coordinate validation and auto-correction utilities.
 * Detects invalid coordinates (0,0), out-of-range values, swapped lat/lng,
 * and coordinates too far from the trip destination.
 */

import { calculateDistance, findNearbyAirportByCoords } from '../../services/geocoding';

// ============================================
// Types
// ============================================

export interface CoordinateValidationResult {
  valid: boolean;
  /** If coordinates were auto-corrected (e.g., lat/lng swap), contains the corrected values */
  corrected?: { lat: number; lng: number };
  /** Human-readable reason for invalidity or correction */
  reason?: string;
}

// ============================================
// Main Validation Function
// ============================================

/**
 * Validate GPS coordinates for an activity/restaurant.
 *
 * Checks:
 * 1. Not null/undefined/NaN
 * 2. Not (0, 0) — common API default for missing data
 * 3. lat in [-90, 90], lng in [-180, 180]
 * 4. Not at a known airport (geocoding error) — returns city center coords instead
 * 5. Not too far from destination (default 100km) — catches cross-country errors (Naples FL vs Naples IT)
 * 6. Auto-corrects swapped lat/lng if the swap brings it closer to destination
 *
 * @param lat - Latitude to validate
 * @param lng - Longitude to validate
 * @param destCoords - Destination center coordinates for proximity check
 * @param maxDistanceKm - Maximum allowed distance from destination (default: 100km)
 */
export function validateCoordinate(
  lat: number,
  lng: number,
  destCoords: { lat: number; lng: number },
  maxDistanceKm: number = 100
): CoordinateValidationResult {
  // Check 1: null/undefined/NaN
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return { valid: false, reason: 'Coordinates are null, undefined, or NaN' };
  }

  // Check 2: (0, 0) — common API default
  if (lat === 0 && lng === 0) {
    return { valid: false, reason: 'Coordinates are (0, 0) — likely missing data' };
  }

  // Check 3: Out of range
  if (lat < -90 || lat > 90) {
    return { valid: false, reason: `Latitude ${lat} out of range [-90, 90]` };
  }
  if (lng < -180 || lng > 180) {
    return { valid: false, reason: `Longitude ${lng} out of range [-180, 180]` };
  }

  // Check 4: Airport proximity — activities at airports are likely geocoding errors
  const nearbyAirport = findNearbyAirportByCoords(lat, lng, 2);
  if (nearbyAirport) {
    // Only flag if the destination itself is NOT at the airport (i.e., destCoords is far from this airport)
    const destToAirport = calculateDistance(destCoords.lat, destCoords.lng, nearbyAirport.latitude, nearbyAirport.longitude);
    if (destToAirport > 3) {
      return {
        valid: false,
        corrected: { lat: destCoords.lat, lng: destCoords.lng },
        reason: `Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)}) are at ${nearbyAirport.name} airport — using city center instead`,
      };
    }
  }

  // Check 5: Distance from destination
  const distance = calculateDistance(lat, lng, destCoords.lat, destCoords.lng);

  if (distance > maxDistanceKm) {
    // Check 6: Try swapping lat/lng — sometimes APIs return (lng, lat) instead of (lat, lng)
    if (lng >= -90 && lng <= 90) {
      const swappedDistance = calculateDistance(lng, lat, destCoords.lat, destCoords.lng);
      if (swappedDistance <= maxDistanceKm) {
        return {
          valid: true,
          corrected: { lat: lng, lng: lat },
          reason: `Swapped lat/lng: (${lat}, ${lng}) → (${lng}, ${lat}), distance ${swappedDistance.toFixed(1)}km`,
        };
      }
    }

    return {
      valid: false,
      reason: `Too far from destination: ${distance.toFixed(1)}km > ${maxDistanceKm}km limit`,
    };
  }

  return { valid: true };
}

/**
 * Check if coordinates are plausible (non-zero, in-range).
 * Quick check without distance validation — useful when destination coords aren't available.
 */
export function isPlausibleCoordinate(lat: number, lng: number): boolean {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

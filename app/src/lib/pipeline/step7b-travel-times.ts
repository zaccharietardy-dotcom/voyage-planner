/**
 * Pipeline V3 — Step 7b: Compute Travel Times (Selective)
 *
 * Calls Google Directions API only for legs where it adds value:
 * - Distance > 1km (short walks are reliably estimated)
 * - Day-trip transit legs (hotel → station → destination)
 *
 * For short legs (<1km), uses walking estimate: distance / 4.5 km/h.
 * This reduces API calls from ~30-40/trip to ~10-15/trip.
 *
 * Flag: PIPELINE_DIRECTIONS_MODE=selective|all|off (default: selective)
 */

import { getDirections, type DirectionsRequest } from '../services/directions';
import { calculateDistance } from '../services/geocoding';
import type { ActivityCluster, ScoredActivity } from './types';

// ============================================
// Types
// ============================================

export interface TravelLeg {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  distanceKm: number;
  durationMinutes: number;
  mode: 'walk' | 'transit' | 'drive';
  /** Whether this time comes from a real API call or estimation */
  isEstimate: boolean;
}

export interface DayTravelTimes {
  dayNumber: number;
  legs: TravelLeg[];
  totalTravelMinutes: number;
}

// ============================================
// Constants
// ============================================

/** Distance threshold below which we use walking estimates */
const WALK_ESTIMATE_THRESHOLD_KM = 1.0;

/** Walking speed for estimation (km/h) */
const WALKING_SPEED_KMH = 4.5;

/** Maximum number of API calls per trip to control costs */
const MAX_API_CALLS_PER_TRIP = 20;

// ============================================
// Main Function
// ============================================

/**
 * Compute travel times between consecutive activities in each cluster.
 * Uses selective Directions API calls based on distance.
 *
 * @param clusters - Activity clusters (one per day), with activities in visit order
 * @param hotelCoords - Hotel coordinates for first/last leg of each day
 * @param mode - Directions mode: 'selective' (default), 'all', or 'off'
 * @returns Travel times for each day
 */
export async function computeTravelTimes(
  clusters: ActivityCluster[],
  hotelCoords: { lat: number; lng: number } | null,
  mode: 'selective' | 'all' | 'off' = 'selective'
): Promise<DayTravelTimes[]> {
  if (mode === 'off') {
    // Pure estimation mode — no API calls
    return clusters.map(cluster => estimateAllLegs(cluster, hotelCoords));
  }

  const results: DayTravelTimes[] = [];
  let apiCallsUsed = 0;

  for (const cluster of clusters) {
    const legs: TravelLeg[] = [];
    const activities = cluster.activities;

    // Build list of points: hotel → activity1 → activity2 → ... → hotel
    const points: { id: string; name: string; lat: number; lng: number }[] = [];

    if (hotelCoords) {
      points.push({ id: 'hotel-start', name: 'Hotel', lat: hotelCoords.lat, lng: hotelCoords.lng });
    }

    for (const act of activities) {
      points.push({ id: act.id, name: act.name || 'Activity', lat: act.latitude, lng: act.longitude });
    }

    if (hotelCoords) {
      points.push({ id: 'hotel-end', name: 'Hotel', lat: hotelCoords.lat, lng: hotelCoords.lng });
    }

    // Compute travel time for each consecutive pair
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      const distance = calculateDistance(from.lat, from.lng, to.lat, to.lng);

      const shouldCallApi = mode === 'all'
        || (mode === 'selective' && distance > WALK_ESTIMATE_THRESHOLD_KM && apiCallsUsed < MAX_API_CALLS_PER_TRIP);

      if (shouldCallApi) {
        try {
          const request: DirectionsRequest = {
            from: { lat: from.lat, lng: from.lng },
            to: { lat: to.lat, lng: to.lng },
            mode: distance > 2 ? 'transit' : 'walking',
          };

          const directions = await getDirections(request);

          if (directions && directions.duration > 0) {
            legs.push({
              fromId: from.id,
              toId: to.id,
              fromName: from.name,
              toName: to.name,
              distanceKm: directions.distance || distance,
              durationMinutes: Math.ceil(directions.duration / 5) * 5, // Round to 5min
              mode: distance > 2 ? 'transit' : 'walk',
              isEstimate: false,
            });
            apiCallsUsed++;
            continue;
          }
        } catch (err) {
          console.warn(`[Travel Times] API call failed for ${from.name} → ${to.name}, using estimate`);
        }
      }

      // Fallback: walking estimate
      const walkingMinutes = Math.ceil((distance / WALKING_SPEED_KMH) * 60);
      const roundedMinutes = Math.ceil(walkingMinutes / 5) * 5; // Round to 5min
      legs.push({
        fromId: from.id,
        toId: to.id,
        fromName: from.name,
        toName: to.name,
        distanceKm: distance,
        durationMinutes: Math.max(5, roundedMinutes), // Minimum 5 minutes
        mode: distance > 2 ? 'transit' : 'walk',
        isEstimate: true,
      });
    }

    const totalTravel = legs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
    results.push({
      dayNumber: cluster.dayNumber,
      legs,
      totalTravelMinutes: totalTravel,
    });
  }

  console.log(`[Travel Times] Computed travel times for ${clusters.length} days (${apiCallsUsed} API calls)`);
  return results;
}

// ============================================
// Estimation Helpers
// ============================================

function estimateAllLegs(
  cluster: ActivityCluster,
  hotelCoords: { lat: number; lng: number } | null
): DayTravelTimes {
  const legs: TravelLeg[] = [];
  const activities = cluster.activities;

  const points: { id: string; name: string; lat: number; lng: number }[] = [];

  if (hotelCoords) {
    points.push({ id: 'hotel-start', name: 'Hotel', lat: hotelCoords.lat, lng: hotelCoords.lng });
  }
  for (const act of activities) {
    points.push({ id: act.id, name: act.name || 'Activity', lat: act.latitude, lng: act.longitude });
  }
  if (hotelCoords) {
    points.push({ id: 'hotel-end', name: 'Hotel', lat: hotelCoords.lat, lng: hotelCoords.lng });
  }

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const distance = calculateDistance(from.lat, from.lng, to.lat, to.lng);
    const walkingMinutes = Math.ceil((distance / WALKING_SPEED_KMH) * 60);
    const roundedMinutes = Math.ceil(walkingMinutes / 5) * 5;

    legs.push({
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      distanceKm: distance,
      durationMinutes: Math.max(5, roundedMinutes),
      mode: distance > 2 ? 'transit' : 'walk',
      isEstimate: true,
    });
  }

  return {
    dayNumber: cluster.dayNumber,
    legs,
    totalTravelMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
  };
}

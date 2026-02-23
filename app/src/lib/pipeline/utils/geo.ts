/**
 * Pipeline V3 — Canonical geo helpers.
 * Single source of truth for cluster centroid and mid-day activity selection.
 */

import { calculateDistance } from '../../services/geocoding';
import type { ScoredActivity } from '../types';

/**
 * Compute the geographic centroid of a set of activities.
 * Returns null if the array is empty.
 */
export function getClusterCentroid(activities: ScoredActivity[]): { lat: number; lng: number } | null {
  if (activities.length === 0) return null;
  return {
    lat: activities.reduce((s, a) => s + a.latitude, 0) / activities.length,
    lng: activities.reduce((s, a) => s + a.longitude, 0) / activities.length,
  };
}

/**
 * Return the activity closest to the mid-point of the route (for lunch anchor).
 * Returns null if the array is empty.
 */
export function findMidDayActivity(activities: ScoredActivity[]): ScoredActivity | null {
  if (activities.length === 0) return null;
  if (activities.length <= 2) return activities[0];
  return activities[Math.floor(activities.length / 2)];
}

/**
 * Haversine distance between two GPS coordinates, in kilometres.
 * Delegates to the shared geocoding service so rounding/formula stays consistent.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return calculateDistance(lat1, lng1, lat2, lng2);
}

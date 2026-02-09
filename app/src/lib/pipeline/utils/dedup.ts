/**
 * Pipeline V2 — Deduplication utilities
 */

import { calculateDistance } from '../../services/geocoding';
import type { ScoredActivity } from '../types';

/**
 * Deduplicate activities by GPS proximity.
 * When two activities are within `thresholdKm`, keep the one with more reviews.
 */
export function deduplicateByProximity(
  activities: ScoredActivity[],
  thresholdKm: number = 0.1
): ScoredActivity[] {
  const result: ScoredActivity[] = [];

  for (const activity of activities) {
    if (!activity.latitude || !activity.longitude) continue;

    const duplicate = result.find(
      (existing) =>
        existing.latitude &&
        existing.longitude &&
        calculateDistance(
          activity.latitude,
          activity.longitude,
          existing.latitude,
          existing.longitude
        ) < thresholdKm
    );

    if (duplicate) {
      // Keep the one with more reviews (better data)
      if ((activity.reviewCount || 0) > (duplicate.reviewCount || 0)) {
        const idx = result.indexOf(duplicate);
        result[idx] = activity;
      }
    } else {
      result.push(activity);
    }
  }

  return result;
}

/**
 * Filter out irrelevant attraction types (restaurants, cinemas, gyms, etc.)
 */
export function isIrrelevantAttraction(activity: ScoredActivity): boolean {
  const name = (activity.name || '').toLowerCase();
  const type = (activity.type || '').toLowerCase();

  const irrelevantTypes = [
    'restaurant', 'cafe', 'bar', 'pub', 'nightclub',
    'cinema', 'movie_theater', 'gym', 'fitness',
    'hospital', 'clinic', 'pharmacy', 'dentist',
    'bank', 'atm', 'post_office',
    'car_rental', 'gas_station', 'parking',
    'supermarket', 'grocery', 'convenience_store',
    'hotel', 'hostel', 'motel', 'lodging',
    'airport', 'train_station', 'bus_station',
  ];

  if (irrelevantTypes.some(t => type.includes(t))) return true;

  const irrelevantNames = [
    'madame tussaud', 'selfie museum', 'escape room',
    'hard rock cafe', 'starbucks', 'mcdonalds', 'mcdonald',
    'burger king', 'kfc', 'subway',
  ];

  if (irrelevantNames.some(n => name.includes(n))) return true;

  return false;
}

/**
 * Merge restaurants from TripAdvisor (quality/cuisine) + SerpAPI (GPS/reviews).
 * TripAdvisor often lacks GPS, SerpAPI has it.
 * Match by name similarity and enrich TripAdvisor entries with SerpAPI GPS.
 */
export function mergeRestaurantSources(
  tripAdvisor: { id: string; name: string; latitude: number; longitude: number; rating: number; reviewCount: number; [key: string]: any }[],
  serpApi: { id: string; name: string; latitude: number; longitude: number; rating: number; reviewCount: number; [key: string]: any }[]
): any[] {
  const merged = [...tripAdvisor];
  const taNames = new Set(tripAdvisor.map(r => normalizeName(r.name)));

  // Add SerpAPI restaurants that don't exist in TripAdvisor
  for (const sr of serpApi) {
    if (!taNames.has(normalizeName(sr.name))) {
      merged.push(sr);
    }
  }

  // Enrich TripAdvisor entries with GPS from SerpAPI if missing
  for (const ta of merged) {
    if (!ta.latitude || !ta.longitude || (ta.latitude === 0 && ta.longitude === 0)) {
      const match = serpApi.find(
        sr => normalizeName(sr.name) === normalizeName(ta.name) && sr.latitude && sr.longitude
      );
      if (match) {
        ta.latitude = match.latitude;
        ta.longitude = match.longitude;
      }
    }
  }

  return merged;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

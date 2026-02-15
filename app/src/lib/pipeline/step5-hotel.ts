/**
 * Pipeline V2 — Step 5: Hotel Selection by Barycenter
 *
 * Pick the hotel closest to the barycenter of all activities, filtered by budget.
 * Pure function, zero API calls.
 */

import type { Accommodation, BudgetLevel } from '../types';
import type { ActivityCluster } from './types';
import { calculateDistance } from '../services/geocoding';

/**
 * Select the best hotel near the barycenter of all activities.
 */
export function selectHotelByBarycenter(
  clusters: ActivityCluster[],
  hotels: Accommodation[],
  budgetLevel: BudgetLevel,
  maxPerNight?: number
): Accommodation | null {
  if (hotels.length === 0) return null;

  // 1. Compute global barycenter of ALL activities
  const allActivities = clusters.flatMap(c => c.activities);
  if (allActivities.length === 0) {
    // Fallback: just pick the highest-rated hotel
    return [...hotels].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;
  }

  const barycenter = {
    lat: allActivities.reduce((s, a) => s + a.latitude, 0) / allActivities.length,
    lng: allActivities.reduce((s, a) => s + a.longitude, 0) / allActivities.length,
  };

  // 2. Filter by budget (with 30% tolerance)
  const budgetMax = maxPerNight || getBudgetMaxPerNight(budgetLevel);
  const tolerance = budgetMax * 1.3;

  let candidates = hotels.filter(h =>
    h.pricePerNight > 0 && h.pricePerNight <= tolerance &&
    h.latitude && h.longitude
  );

  // If too few candidates, relax constraint
  if (candidates.length < 3) {
    candidates = hotels
      .filter(h => h.latitude && h.longitude)
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 10);
  }

  if (candidates.length === 0) return hotels[0] || null;

  // 2b. Distance filter: keep the search anchored around the activity barycenter.
  // If the city is spread out and no close options exist, keep only the nearest slice.
  const MAX_HOTEL_DIST_KM = 5;
  const RELAXED_HOTEL_DIST_KM = 8;
  const MAX_ACCEPTABLE_DIST_KM = 12;

  const candidatesByDistance = candidates
    .map((hotel) => ({
      hotel,
      distanceKm: calculateDistance(barycenter.lat, barycenter.lng, hotel.latitude, hotel.longitude),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearCandidates = candidatesByDistance
    .filter((entry) => entry.distanceKm <= MAX_HOTEL_DIST_KM)
    .map((entry) => entry.hotel);
  if (nearCandidates.length >= 2) {
    candidates = nearCandidates;
  } else {
    const relaxedCandidates = candidatesByDistance
      .filter((entry) => entry.distanceKm <= RELAXED_HOTEL_DIST_KM)
      .map((entry) => entry.hotel);
    if (relaxedCandidates.length >= 2) {
      candidates = relaxedCandidates;
    } else {
      const acceptableCandidates = candidatesByDistance
        .filter((entry) => entry.distanceKm <= MAX_ACCEPTABLE_DIST_KM)
        .map((entry) => entry.hotel);
      if (acceptableCandidates.length >= 2) {
        candidates = acceptableCandidates;
      } else if (candidatesByDistance.length > 3) {
        const nearestSliceSize = Math.min(8, Math.max(3, Math.ceil(candidatesByDistance.length * 0.5)));
        candidates = candidatesByDistance.slice(0, nearestSliceSize).map((entry) => entry.hotel);
      }
    }
  }

  // 3. Score: lower distance + higher rating = better
  // Distance dominates; rating refines among similarly located options.
  const scored = candidates.map(h => {
    const dist = calculateDistance(
      barycenter.lat, barycenter.lng,
      h.latitude, h.longitude
    );
    const ratingNorm = Math.max(0, Math.min(1, normalizeHotelRating(h) / 10)); // 0-1 scale
    const ratingBoost = 0.75 + ratingNorm * 0.25; // clamp rating influence (0.75..1.0)
    const overBudgetPenalty =
      h.pricePerNight > budgetMax
        ? ((h.pricePerNight - budgetMax) / Math.max(1, budgetMax)) * 4
        : 0;
    return {
      hotel: h,
      score: Math.pow(dist, 2.15) / ratingBoost + overBudgetPenalty,
      distanceKm: dist,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  const selected = scored[0];
  console.log(
    `[Pipeline V2] Step 5: Hotel selected: "${selected.hotel.name}" ` +
    `(${selected.score.toFixed(2)} score, ${selected.distanceKm.toFixed(1)}km from barycenter)`
  );

  return selected.hotel;
}

/**
 * Normalize hotel rating to 0-10 scale.
 * Booking.com uses 0-10, Airbnb uses 0-5.
 */
function normalizeHotelRating(hotel: Accommodation): number {
  const raw = hotel.rating || 5;
  // Airbnb/similar: ratings <= 5 are on a 0-5 scale → double to normalize
  // Booking.com: ratings > 5 are already on a 0-10 scale
  if (raw <= 5) return raw * 2;
  return raw;
}

function getBudgetMaxPerNight(budgetLevel: BudgetLevel): number {
  switch (budgetLevel) {
    case 'economic': return 60;
    case 'moderate': return 120;
    case 'comfort': return 250;
    case 'luxury': return 1000;
    default: return 150;
  }
}

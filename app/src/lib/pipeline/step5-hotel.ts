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
    return hotels.sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;
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

  // 3. Score: lower distance + higher rating = better
  const scored = candidates.map(h => {
    const dist = calculateDistance(
      barycenter.lat, barycenter.lng,
      h.latitude, h.longitude
    );
    const ratingNorm = normalizeHotelRating(h) / 10; // 0-1 scale
    // Lower score = better
    return { hotel: h, score: dist / Math.max(ratingNorm, 0.1) };
  });

  scored.sort((a, b) => a.score - b.score);

  console.log(`[Pipeline V2] Step 5: Hotel selected: "${scored[0].hotel.name}" (${scored[0].score.toFixed(2)} score, ${calculateDistance(barycenter.lat, barycenter.lng, scored[0].hotel.latitude, scored[0].hotel.longitude).toFixed(1)}km from barycenter)`);

  return scored[0].hotel;
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

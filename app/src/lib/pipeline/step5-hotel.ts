/**
 * Pipeline V2 — Step 5: Hotel Selection by Barycenter
 *
 * Pick the hotel closest to the weighted activity center, filtered by budget and city profile.
 * Pure function, zero API calls.
 */

import type { Accommodation, BudgetLevel } from '../types';
import type { ActivityCluster } from './types';
import { calculateDistance } from '../services/geocoding';
import { getHotelHardCapKmForProfile, resolveQualityCityProfile } from './qualityPolicy';

type SelectHotelOptions = {
  destination?: string;
};

/**
 * Select the best hotel near the weighted activity center.
 */
export function selectHotelByBarycenter(
  clusters: ActivityCluster[],
  hotels: Accommodation[],
  budgetLevel: BudgetLevel,
  maxPerNight?: number,
  durationDays?: number,
  options?: SelectHotelOptions
): Accommodation | null {
  if (hotels.length === 0) return null;

  const profile = resolveQualityCityProfile({
    destination: options?.destination,
    clusters,
  });

  // 1. Compute weighted center from activities (duration + must-see priority + score signal).
  const weightedCenter = computeWeightedActivityCenter(clusters);
  if (!weightedCenter) {
    return [...hotels]
      .filter((hotel) => Number.isFinite(hotel.latitude) && Number.isFinite(hotel.longitude))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;
  }

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
      .filter(h => h.latitude && h.longitude && h.pricePerNight > 0)
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 10);
  }

  if (candidates.length === 0) return hotels[0] || null;

  // 2b. Distance hard-filter with controlled relaxations (+0.4km, max 2 passes).
  const hardCapKm = getHotelHardCapKmForProfile(profile, durationDays);
  const activityAnchors = collectDailyBoundaryAnchors(clusters);
  const candidatesByDistance = candidates
    .map((hotel) => ({
      hotel,
      distanceToCenterKm: calculateDistance(weightedCenter.lat, weightedCenter.lng, hotel.latitude, hotel.longitude),
      boundaryDistanceKm: averageBoundaryDistance(hotel, activityAnchors),
    }))
    .sort((a, b) => a.distanceToCenterKm - b.distanceToCenterKm);

  let selectedPass = 0;
  let filteredByRadius: typeof candidatesByDistance = [];
  for (let pass = 0; pass <= 2; pass++) {
    const radius = hardCapKm + pass * 0.4;
    const local = candidatesByDistance.filter((entry) => entry.distanceToCenterKm <= radius);
    if (local.length > 0) {
      filteredByRadius = local;
      selectedPass = pass;
      break;
    }
  }

  if (filteredByRadius.length > 0) {
    candidates = filteredByRadius.map((entry) => entry.hotel);
  } else {
    const nearestSliceSize = Math.min(8, Math.max(3, Math.ceil(candidatesByDistance.length * 0.4)));
    candidates = candidatesByDistance.slice(0, nearestSliceSize).map((entry) => entry.hotel);
    selectedPass = 3;
  }

  // 3. Score: center distance dominates; boundary distance + rating refine.
  const scored = candidates.map(h => {
    const dist = calculateDistance(weightedCenter.lat, weightedCenter.lng, h.latitude, h.longitude);
    const boundaryDist = averageBoundaryDistance(h, activityAnchors);
    const ratingNorm = Math.max(0, Math.min(1, normalizeHotelRating(h) / 10)); // 0-1 scale
    const ratingBoost = 0.75 + ratingNorm * 0.25;
    const overBudgetPenalty =
      h.pricePerNight > budgetMax
        ? ((h.pricePerNight - budgetMax) / Math.max(1, budgetMax)) * 4
        : 0;
    const distanceScore = Math.pow(dist / Math.max(0.35, profile.hotelTargetKm), 2.3);
    const boundaryPenalty = boundaryDist * 0.55;
    return {
      hotel: h,
      score: (distanceScore + boundaryPenalty) / ratingBoost + overBudgetPenalty,
      distanceKm: dist,
      boundaryDistanceKm: boundaryDist,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  const selected = scored[0];
  let selectedHotel = selected.hotel;
  if (selectedPass > 0) {
    selectedHotel = appendHotelQualityFlag(
      selectedHotel,
      selectedPass >= 3 ? 'hotel_distance_no_candidate_under_relaxed_cap' : `hotel_distance_relaxed_pass_${selectedPass}`
    );
  }

  console.log(
    `[Pipeline V2] Step 5: Hotel selected: "${selectedHotel.name}" ` +
    `(${selected.score.toFixed(2)} score, ${selected.distanceKm.toFixed(2)}km center, ${selected.boundaryDistanceKm.toFixed(2)}km boundary avg, profile=${profile.id})`
  );

  return selectedHotel;
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

function computeWeightedActivityCenter(clusters: ActivityCluster[]): { lat: number; lng: number } | null {
  const weightedPoints: Array<{ lat: number; lng: number; weight: number }> = [];

  for (const cluster of clusters) {
    for (const activity of cluster.activities || []) {
      if (!Number.isFinite(activity.latitude) || !Number.isFinite(activity.longitude)) continue;
      if (activity.latitude === 0 || activity.longitude === 0) continue;
      const durationWeight = Math.max(0.6, (activity.duration || 60) / 60);
      const mustSeeWeight = activity.mustSee ? 1.5 : 1;
      const scoreWeight = Number.isFinite(activity.score) ? Math.max(0.4, Math.min(2.5, activity.score / 10)) : 1;
      weightedPoints.push({
        lat: activity.latitude,
        lng: activity.longitude,
        weight: durationWeight * mustSeeWeight * scoreWeight,
      });
    }
  }

  if (weightedPoints.length === 0) return null;
  const totalWeight = weightedPoints.reduce((sum, point) => sum + point.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  return {
    lat: weightedPoints.reduce((sum, point) => sum + point.lat * point.weight, 0) / totalWeight,
    lng: weightedPoints.reduce((sum, point) => sum + point.lng * point.weight, 0) / totalWeight,
  };
}

function collectDailyBoundaryAnchors(clusters: ActivityCluster[]): Array<{ lat: number; lng: number }> {
  const anchors: Array<{ lat: number; lng: number }> = [];
  for (const cluster of clusters) {
    if (!cluster.activities || cluster.activities.length === 0) continue;
    const first = cluster.activities[0];
    const last = cluster.activities[cluster.activities.length - 1];
    if (Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
      anchors.push({ lat: first.latitude, lng: first.longitude });
    }
    if (last && (last.id !== first.id) && Number.isFinite(last.latitude) && Number.isFinite(last.longitude)) {
      anchors.push({ lat: last.latitude, lng: last.longitude });
    }
  }
  return anchors;
}

function averageBoundaryDistance(hotel: Accommodation, anchors: Array<{ lat: number; lng: number }>): number {
  if (anchors.length === 0) return 0;
  const distances = anchors.map((anchor) => calculateDistance(hotel.latitude, hotel.longitude, anchor.lat, anchor.lng));
  return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}

function appendHotelQualityFlag(hotel: Accommodation, flag: string): Accommodation {
  return {
    ...hotel,
    qualityFlags: Array.from(new Set([...(hotel.qualityFlags || []), flag])),
  };
}

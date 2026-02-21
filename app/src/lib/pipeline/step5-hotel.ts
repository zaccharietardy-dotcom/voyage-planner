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
 * Returns true when a hotel has a real price AND a bookingUrl that resolves to
 * booking.com (not the hotel's own website or another third-party domain).
 *
 * Used to reject hotels with price=0 or bad URLs before selection so the
 * pipeline picks a hotel that the user can actually book.
 */
function hasValidPriceAndBookingUrl(hotel: Accommodation): boolean {
  if (!hotel.pricePerNight || hotel.pricePerNight <= 0) return false;
  const url = hotel.bookingUrl;
  if (!url) return false;
  return url.toLowerCase().includes('booking.com');
}

/** Absolute maximum distance for any hotel, even in fallback/last-resort scenarios. */
const ABSOLUTE_MAX_HOTEL_DISTANCE_KM = 5.0;

/**
 * Build a last-resort Accommodation that has an estimated price and a
 * Booking.com search URL. Only used when NO hotel in the pool passes the
 * hasValidPriceAndBookingUrl() filter.
 * If centerCoords is provided, the hotel's coordinates are overridden to the
 * weighted activity center (avoids placing route calculations 17km from activities).
 */
function buildLastResortHotel(
  hotel: Accommodation,
  budgetLevel: BudgetLevel,
  destination?: string,
  centerCoords?: { lat: number; lng: number }
): Accommodation {
  const estimatedPrice = estimatePriceFromBudget(budgetLevel);
  const searchUrl = destination
    ? `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&group_adults=2&no_rooms=1`
    : 'https://www.booking.com/searchresults.html?group_adults=2&no_rooms=1';
  const coords = centerCoords
    ? { latitude: centerCoords.lat, longitude: centerCoords.lng }
    : { latitude: hotel.latitude, longitude: hotel.longitude };
  return appendHotelQualityFlag(
    { ...hotel, ...coords, pricePerNight: estimatedPrice, bookingUrl: searchUrl },
    'hotel_price_estimated'
  );
}

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

  // 2. Filter by budget (with 30% tolerance), price > 0, and valid Booking.com URL
  const budgetMax = maxPerNight || getBudgetMaxPerNight(budgetLevel);
  const tolerance = budgetMax * 1.3;

  // Primary filter: requires valid price AND valid booking.com URL
  let candidates = hotels.filter(h =>
    hasValidPriceAndBookingUrl(h) && h.pricePerNight <= tolerance &&
    h.latitude && h.longitude
  );

  // Relax budget constraint — still require valid price + URL
  if (candidates.length < 3) {
    candidates = hotels
      .filter(h => hasValidPriceAndBookingUrl(h) && h.latitude && h.longitude)
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 10);
  }

  if (candidates.length === 0) {
    // LAST RESORT: no hotel passes the price+URL filter.
    // Pick the best available hotel and synthesize an estimated price + booking.com search URL.
    // Use weightedCenter coords so route calculations stay near activities.
    const fallback = hotels.find(h => h.latitude && h.longitude) || hotels[0] || null;
    if (fallback) {
      return buildLastResortHotel(fallback, budgetLevel, options?.destination, weightedCenter || undefined);
    }
    return null;
  }

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
    // All 3 relaxation passes failed — apply absolute distance cap to prevent 17km hotels
    const cappedByAbsolute = candidatesByDistance.filter(
      (entry) => entry.distanceToCenterKm <= ABSOLUTE_MAX_HOTEL_DISTANCE_KM
    );
    if (cappedByAbsolute.length > 0) {
      const nearestSliceSize = Math.min(8, Math.max(3, Math.ceil(cappedByAbsolute.length * 0.4)));
      candidates = cappedByAbsolute.slice(0, nearestSliceSize).map((entry) => entry.hotel);
    } else {
      // No hotel within 5km — use last resort with center coordinates
      const fallback = candidatesByDistance[0]?.hotel;
      if (fallback) {
        return buildLastResortHotel(fallback, budgetLevel, options?.destination, weightedCenter);
      }
      return null;
    }
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
 * Select the top N hotels ranked by the barycenter scoring algorithm.
 * Used for accommodationOptions (hotel alternatives shown to user).
 */
export function selectTopHotelsByBarycenter(
  clusters: ActivityCluster[],
  hotels: Accommodation[],
  budgetLevel: BudgetLevel,
  maxPerNight?: number,
  durationDays?: number,
  options?: SelectHotelOptions,
  count: number = 3
): Accommodation[] {
  if (hotels.length === 0) return [];

  const profile = resolveQualityCityProfile({
    destination: options?.destination,
    clusters,
  });

  const weightedCenter = computeWeightedActivityCenter(clusters);
  if (!weightedCenter) {
    return hotels
      .filter(h => Number.isFinite(h.latitude) && Number.isFinite(h.longitude) && hasValidPriceAndBookingUrl(h))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, count);
  }

  const budgetMax = maxPerNight || getBudgetMaxPerNight(budgetLevel);
  const tolerance = budgetMax * 1.5;

  // Require valid price AND valid booking.com URL for all alternatives
  let candidates = hotels.filter(h =>
    hasValidPriceAndBookingUrl(h) && h.pricePerNight <= tolerance &&
    h.latitude && h.longitude
  );

  if (candidates.length < count) {
    candidates = hotels
      .filter(h => hasValidPriceAndBookingUrl(h) && h.latitude && h.longitude)
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, Math.max(count * 3, 10));
  }

  if (candidates.length === 0) {
    // Last resort: return hotels that at least have a price (URL may be missing)
    return hotels.filter(h => h.pricePerNight > 0).slice(0, count);
  }

  const activityAnchors = collectDailyBoundaryAnchors(clusters);
  const scored = candidates.map(h => {
    const dist = calculateDistance(weightedCenter.lat, weightedCenter.lng, h.latitude, h.longitude);
    const boundaryDist = averageBoundaryDistance(h, activityAnchors);
    const ratingNorm = Math.max(0, Math.min(1, normalizeHotelRating(h) / 10));
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
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map(s => s.hotel);
}

/**
 * Select hotels from 3 distance tiers for diverse user choice.
 * Tier 1 "Central": 0-2km (best quality within walking distance)
 * Tier 2 "Comfortable": 2-5km (best value at moderate distance)
 * Tier 3 "Value": 5-8km (cheapest option, further out)
 *
 * Each tier picks the single best-scored hotel within its distance band.
 * Hotels are annotated with distanceToCenter and distanceTier.
 */
export function selectTieredHotels(
  clusters: ActivityCluster[],
  hotels: Accommodation[],
  budgetLevel: BudgetLevel,
  maxPerNight?: number,
  durationDays?: number,
  options?: SelectHotelOptions & { destCoords?: { lat: number; lng: number } }
): Accommodation[] {
  if (hotels.length === 0) return [];

  // Compute center: use weighted activity center if clusters available, else destCoords
  const weightedCenter = computeWeightedActivityCenter(clusters);
  const center = weightedCenter || options?.destCoords;

  if (!center) {
    // No center available — fall back to rating-sorted
    return hotels
      .filter(h => Number.isFinite(h.latitude) && Number.isFinite(h.longitude) && hasValidPriceAndBookingUrl(h))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 3);
  }

  const budgetMax = maxPerNight || getBudgetMaxPerNight(budgetLevel);
  const tolerance = budgetMax * 1.5;

  console.log(`[Hotel Tiers] Input: ${hotels.length} hotels, budget max: ${budgetMax}/night`);

  // Filter candidates: valid booking URL + valid price + valid coords
  let candidates = hotels.filter(h =>
    hasValidPriceAndBookingUrl(h) &&
    h.pricePerNight <= tolerance &&
    h.latitude && h.longitude
  );
  // Relax price tolerance if not enough candidates
  if (candidates.length < 3) {
    candidates = hotels
      .filter(h => hasValidPriceAndBookingUrl(h) && h.latitude && h.longitude)
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 15);
  }

  // If still <3, accept hotels with valid coords + booking URL even if price is 0
  // (API often returns price=0 for available hotels, especially central ones)
  if (candidates.length < 3) {
    const hasUrl = (h: Accommodation) => {
      const url = h.bookingUrl;
      return url && url.toLowerCase().includes('booking.com');
    };
    candidates = hotels
      .filter(h => hasUrl(h) && h.latitude && h.longitude)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 15);
  }

  // Last resort: any hotel with valid coords
  if (candidates.length < 3) {
    candidates = hotels
      .filter(h => h.latitude && h.longitude)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 15);
  }

  if (candidates.length === 0) {
    return [];
  }

  // Compute distance for each candidate
  const withDistance = candidates.map(h => ({
    hotel: h,
    distance: calculateDistance(center.lat, center.lng, h.latitude, h.longitude),
  }));

  // 2 central options (<2km) + 1 value option (<5km)
  // Pick 1: cheapest within 2km
  // Pick 2: best-rated within 2km (different from pick1)
  // Pick 3: cheapest within 5km (the "bon plan")

  // Sort by price (cheapest first), rating as tiebreaker
  const sortedByPrice = [...withDistance].sort((a, b) => {
    const priceA = a.hotel.pricePerNight || 9999;
    const priceB = b.hotel.pricePerNight || 9999;
    if (priceA !== priceB) return priceA - priceB;
    return (b.hotel.rating || 0) - (a.hotel.rating || 0);
  });

  // Sort by rating (best first) for pick2
  const sortedByRating = [...withDistance].sort((a, b) => {
    return (b.hotel.rating || 0) - (a.hotel.rating || 0);
  });

  const pickFrom = (
    sorted: typeof withDistance,
    maxDist: number,
    exclude: Set<string>
  ): typeof withDistance[0] | null => {
    return sorted.find(c => c.distance <= maxDist && !exclude.has(c.hotel.id)) || null;
  };

  const usedIds = new Set<string>();

  // Pick 1: cheapest within 2km
  let pick1 = pickFrom(sortedByPrice, 2.0, usedIds);
  if (pick1) usedIds.add(pick1.hotel.id);

  // Pick 2: best-rated within 2km (different hotel)
  let pick2 = pickFrom(sortedByRating, 2.0, usedIds);
  if (pick2) usedIds.add(pick2.hotel.id);

  // Pick 3: cheapest within 5km
  let pick3 = pickFrom(sortedByPrice, 5.0, usedIds);
  if (pick3) usedIds.add(pick3.hotel.id);

  // Fallback: fill empty slots from remaining candidates (any distance)
  const remaining = sortedByPrice.filter(c => !usedIds.has(c.hotel.id));
  if (!pick1 && remaining.length > 0) { pick1 = remaining.shift()!; usedIds.add(pick1.hotel.id); }
  if (!pick2 && remaining.length > 0) { pick2 = remaining.shift()!; usedIds.add(pick2.hotel.id); }
  if (!pick3 && remaining.length > 0) { pick3 = remaining.shift()!; usedIds.add(pick3.hotel.id); }

  // Build result, removing duplicates and nulls
  const result: Accommodation[] = [];
  const seen = new Set<string>();

  const tierLabels: Array<{ pick: typeof pick1; tier: 'central' | 'comfortable' | 'value' }> = [
    { pick: pick1, tier: 'central' },       // cheapest <2km
    { pick: pick2, tier: 'comfortable' },    // best-rated <2km
    { pick: pick3, tier: 'value' },          // cheapest <5km
  ];

  for (const { pick, tier } of tierLabels) {
    if (pick && !seen.has(pick.hotel.id)) {
      seen.add(pick.hotel.id);
      const annotated: Accommodation = {
        ...pick.hotel,
        distanceToCenter: Math.round(pick.distance * 10) / 10,
        distanceTier: tier,
      };
      result.push(annotated);
    }
  }

  console.log(`[Hotel Tiers] Selected ${result.length} hotels: ${result.map(h => `${h.distanceTier}="${h.name}" (${h.distanceToCenter}km)`).join(', ')}`);

  return result;
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

function estimatePriceFromBudget(budgetLevel: BudgetLevel): number {
  switch (budgetLevel) {
    case 'economic': return 55;
    case 'moderate': return 110;
    case 'comfort': return 180;
    case 'luxury': return 300;
    default: return 100;
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

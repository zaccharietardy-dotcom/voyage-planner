/**
 * trust-layer.ts — Phase 1: Internal trust annotations for planner decisions
 *
 * Enriches ScoredActivity with confidence scores and normalization metadata.
 * These fields are internal to the planner — they never surface in Trip output.
 *
 * Called between step 2 (scoring) and step 3 (clustering).
 */

import type { ScoredActivity, FetchedData } from './types';
import type { DayTripSuggestion } from '../services/dayTripSuggestions';
import { calculateDistance } from '../services/geocoding';
import { getMinDuration, getMaxDuration } from './utils/constants';

// ============================================
// Coordinate Confidence
// ============================================

interface ConfidenceFactors {
  /** How many sources agree on similar coordinates */
  sourceAgreement: number;
  /** Does the name match what you'd expect at these coordinates */
  nameCoherence: boolean;
  /** Does the POI have opening hours (sign of a real, verified place) */
  hasOpeningHours: boolean;
  /** Is the distance from destination plausible */
  distancePlausible: boolean;
  /** GPS source quality */
  geoSourceQuality: number;
}

function computeConfidenceFactors(
  activity: ScoredActivity,
  allActivities: ScoredActivity[],
  destCoords: { lat: number; lng: number }
): ConfidenceFactors {
  // Source agreement: count other activities within 200m with similar names
  const similarNearby = allActivities.filter(other => {
    if (other.id === activity.id) return false;
    if (!other.latitude || !other.longitude) return false;
    const dist = calculateDistance(
      activity.latitude, activity.longitude,
      other.latitude, other.longitude
    );
    return dist < 0.2; // 200m
  });
  const sourceAgreement = Math.min(similarNearby.length, 3); // cap at 3

  // Name coherence: not a generic name
  const genericNames = /^(point|place|location|site|spot|area|zone|region|center|centre)$/i;
  const nameCoherence = !genericNames.test(activity.name.trim());

  // Opening hours: verified places usually have them
  const hasOpeningHours = !!(
    activity.openingHoursByDay ||
    (activity.openingHours?.open && activity.openingHours.open !== '00:00')
  );

  // Distance plausible: within 100km of destination
  const distFromDest = calculateDistance(
    activity.latitude, activity.longitude,
    destCoords.lat, destCoords.lng
  );
  const distancePlausible = distFromDest < 100;

  // Geo source quality
  const geoSourceScores: Record<string, number> = {
    place: 1.0,      // Google Places — high quality
    known_product: 0.9, // Viator known product — curated
    geocode: 0.5,    // Geocoded from name — medium
    city_fallback: 0.1, // Fell back to city center — low
  };
  const geoSourceQuality = geoSourceScores[activity.geoSource || ''] ?? 0.6;

  return {
    sourceAgreement,
    nameCoherence,
    hasOpeningHours,
    distancePlausible,
    geoSourceQuality,
  };
}

function computeCoordinateConfidenceScore(factors: ConfidenceFactors): number {
  let score = 0;

  // Geo source is the strongest signal (0-0.4)
  score += factors.geoSourceQuality * 0.4;

  // Source agreement (0-0.2)
  score += Math.min(factors.sourceAgreement / 3, 1) * 0.2;

  // Opening hours presence (0-0.15)
  if (factors.hasOpeningHours) score += 0.15;

  // Name coherence (0-0.1)
  if (factors.nameCoherence) score += 0.1;

  // Distance plausibility (0-0.15)
  if (factors.distancePlausible) score += 0.15;

  return Math.min(1, Math.max(0, score));
}

function scoreToLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

// ============================================
// Duration Confidence
// ============================================

function computeDurationConfidence(activity: ScoredActivity): 'high' | 'medium' | 'low' {
  // High: has Viator duration or Google Places duration (provider-sourced)
  if (activity.source === 'viator') return 'high';

  // Check if duration is within known bounds for the type
  const minDur = getMinDuration(activity.name, activity.type);
  const maxDur = getMaxDuration(activity.name, activity.type);

  if (activity.duration >= minDur && (!maxDur || activity.duration <= maxDur)) {
    // Duration is within bounds — medium confidence (could be estimated but reasonable)
    return activity.source === 'google_places' ? 'medium' : 'low';
  }

  // Duration outside expected range — low confidence
  return 'low';
}

// ============================================
// Day Trip Affinity
// ============================================

function computeDayTripAffinity(
  activity: ScoredActivity,
  dayTripSuggestions: DayTripSuggestion[],
  destCoords: { lat: number; lng: number }
): number {
  if (!dayTripSuggestions.length) return 0;

  const distFromDest = calculateDistance(
    activity.latitude, activity.longitude,
    destCoords.lat, destCoords.lng
  );

  // Activities very close to city center have zero day trip affinity
  if (distFromDest < 5) return 0;

  // Check proximity to day trip destinations
  let maxAffinity = 0;
  for (const suggestion of dayTripSuggestions) {
    if (!suggestion.latitude || !suggestion.longitude) continue;
    const distToSuggestion = calculateDistance(
      activity.latitude, activity.longitude,
      suggestion.latitude, suggestion.longitude
    );

    // Within 5km of a day trip destination = high affinity
    if (distToSuggestion < 5) {
      maxAffinity = Math.max(maxAffinity, 1.0);
    } else if (distToSuggestion < 15) {
      // 5-15km = partial affinity
      const partial = 1 - (distToSuggestion - 5) / 10;
      maxAffinity = Math.max(maxAffinity, partial);
    }
  }

  return maxAffinity;
}

// ============================================
// POI Normalization
// ============================================

/**
 * Clamp duration to plausible bounds for the activity type.
 * Only adjusts if confidence is low and duration is way off.
 */
function normalizeDuration(activity: ScoredActivity): void {
  const minDur = getMinDuration(activity.name, activity.type);
  const maxDur = getMaxDuration(activity.name, activity.type);

  if (activity.durationConfidence === 'low') {
    // Clamp gently — don't override provider data
    if (activity.duration < minDur) {
      activity.duration = minDur;
    } else if (maxDur && activity.duration > maxDur) {
      activity.duration = maxDur;
    }
  }
}

/**
 * Set protectedReason for activities that should not be evicted.
 */
function assignProtection(activity: ScoredActivity): void {
  if (activity.mustSee) {
    activity.protectedReason = 'must_see';
  }
  // Day trip anchors set in Phase 2 (DayTripPack)
}

// ============================================
// Public API
// ============================================

/**
 * Enrich ScoredActivities with trust metadata.
 * Called once between step 2 (scoring) and step 3 (clustering).
 *
 * Mutates activities in place — no new array created.
 */
export function applyTrustLayer(
  activities: ScoredActivity[],
  data: FetchedData,
  destCoords: { lat: number; lng: number }
): void {
  const t0 = Date.now();

  for (const activity of activities) {
    // Coordinate confidence
    const factors = computeConfidenceFactors(activity, activities, destCoords);
    activity.coordinateConfidenceScore = computeCoordinateConfidenceScore(factors);
    activity.coordinateConfidence = scoreToLevel(activity.coordinateConfidenceScore);

    // Duration confidence
    activity.durationConfidence = computeDurationConfidence(activity);

    // Day trip affinity
    activity.dayTripAffinity = computeDayTripAffinity(
      activity, data.dayTripSuggestions || [], destCoords
    );

    // Protection
    assignProtection(activity);

    // Normalize duration for low-confidence items
    normalizeDuration(activity);
  }

  // Stats for logging
  const high = activities.filter(a => a.coordinateConfidence === 'high').length;
  const medium = activities.filter(a => a.coordinateConfidence === 'medium').length;
  const low = activities.filter(a => a.coordinateConfidence === 'low').length;
  const protectedCount = activities.filter(a => a.protectedReason).length;
  const dayTripAffinityCount = activities.filter(a => (a.dayTripAffinity ?? 0) > 0.5).length;

  console.log(
    `[Trust Layer] ${activities.length} activities enriched in ${Date.now() - t0}ms — ` +
    `coords: ${high}H/${medium}M/${low}L, protected: ${protectedCount}, dayTripAffinity: ${dayTripAffinityCount}`
  );
}

/**
 * Pipeline V3 — Step 11: Contract Layer
 *
 * Validates P0 invariants on the final trip plan.
 * Invariants are either BLOCKING (pipeline should report failure)
 * or WARNING (logged for quality monitoring).
 *
 * P0 Invariants:
 *   P0.1: No activity outside opening hours
 *   P0.2: No restaurant >800m from its meal anchor
 *   P0.3: No full day without lunch or dinner
 *   P0.4: No silent geo fallback (already handled in step1)
 *   P0.5: No coordinates (0,0) or out-of-zone
 *   P0.6: No POI cross-country (distance > 100km from dest)
 *   P0.7: Activity durations within min/max bounds
 *   P0.8: All must-sees present in final plan
 */

import type { TripDay, TripItem } from '../types';
import type { ScoredActivity } from './types';
import { isOpenAtTime, isActivityOpenOnDay } from './utils/opening-hours';
import { isPlausibleCoordinate } from './utils/coordinate-validator';
import { calculateDistance } from '../services/geocoding';
import { getMinDuration, getMaxDuration } from './utils/constants';
import { normalizeForMatching } from './utils/dedup';

// ============================================
// Types
// ============================================

export interface ContractResult {
  /** Whether all P0 invariants pass */
  invariantsPassed: boolean;
  /** Quality score 0-100 */
  score: number;
  /** List of P0 violations found (after repair) */
  violations: string[];
  /** User-facing quality warnings */
  qualityWarnings: string[];
  /** Detailed metrics */
  metrics: QualityMetrics;
}

export interface QualityMetrics {
  totalActivities: number;
  totalRestaurants: number;
  mustSeesPlanned: number;
  mustSeesTotal: number;
  avgRestaurantDistance: number;
  activitiesOutsideHours: number;
  restaurantsOverMaxDistance: number;
  daysWithoutLunch: number;
  daysWithoutDinner: number;
  invalidCoordinates: number;
  durationViolations: number;
}

// ============================================
// Main Function
// ============================================

/**
 * Validate P0 invariants on the final trip plan.
 *
 * @param days - Final trip days after repair pass
 * @param startDate - Trip start date "YYYY-MM-DD"
 * @param mustSeeIds - Set of must-see activity IDs
 * @param destCoords - Destination center coordinates
 * @param mustSeeActivities - Optional list of must-see activities (for name-based fallback in P0.8)
 * @returns Contract validation result with score, violations, and warnings
 */
export function validateContracts(
  days: TripDay[],
  startDate: string,
  mustSeeIds: Set<string>,
  destCoords: { lat: number; lng: number },
  mustSeeActivities?: Array<{ id: string; name: string }>
): ContractResult {
  const violations: string[] = [];
  const qualityWarnings: string[] = [];
  const metrics: QualityMetrics = {
    totalActivities: 0,
    totalRestaurants: 0,
    mustSeesPlanned: 0,
    mustSeesTotal: mustSeeIds.size,
    avgRestaurantDistance: 0,
    activitiesOutsideHours: 0,
    restaurantsOverMaxDistance: 0,
    daysWithoutLunch: 0,
    daysWithoutDinner: 0,
    invalidCoordinates: 0,
    durationViolations: 0,
  };

  const plannedActivityIds = new Set<string>();
  // Collect normalized planned names for P0.8 name-based fallback matching.
  const plannedActivityNamesNorm: string[] = [];
  let totalRestaurantDist = 0;
  let restaurantDistCount = 0;

  for (const day of days) {
    const dayDate = getDayDate(startDate, day.dayNumber);
    let hasLunch = false;
    let hasDinner = false;

    for (const item of day.items) {
      // P0.5: Coordinate validation
      if (item.latitude != null && item.longitude != null) {
        if (!isPlausibleCoordinate(item.latitude, item.longitude)) {
          violations.push(`P0.5: "${item.title}" has invalid coordinates (${item.latitude}, ${item.longitude})`);
          metrics.invalidCoordinates++;
        }

        // P0.6: Cross-country check (>100km from destination)
        if (item.latitude !== 0 && item.longitude !== 0) {
          const dist = calculateDistance(item.latitude, item.longitude, destCoords.lat, destCoords.lng);
          if (dist > 100) {
            violations.push(`P0.6: "${item.title}" is ${dist.toFixed(0)}km from destination (cross-country?)`);
            metrics.invalidCoordinates++;
          }
        }
      }

      if (item.type === 'activity') {
        metrics.totalActivities++;

        // Track activity IDs and normalized names for must-see check (P0.8)
        if (item.id) plannedActivityIds.add(item.id);
        if (item.title) plannedActivityNamesNorm.push(normalizeForMatching(item.title));

        // P0.1: Opening hours check
        if (item.openingHours || item.openingHoursByDay) {
          const mockActivity: ScoredActivity = {
            id: item.id || '',
            name: item.title || '',
            type: 'culture',
            description: '',
            duration: item.duration || 60,
            estimatedCost: item.estimatedCost || 0,
            latitude: item.latitude || 0,
            longitude: item.longitude || 0,
            rating: item.rating || 0,
            mustSee: false,
            bookingRequired: false,
            openingHours: item.openingHours || { open: '00:00', close: '23:59' },
            openingHoursByDay: item.openingHoursByDay,
            score: 0,
            source: 'google_places',
            reviewCount: 0,
          };

          if (!isOpenAtTime(mockActivity, dayDate, item.startTime, item.endTime)) {
            violations.push(`P0.1: Day ${day.dayNumber} "${item.title}" outside opening hours (${item.startTime}-${item.endTime})`);
            metrics.activitiesOutsideHours++;
          }
        }

        // P0.7: Duration bounds
        const minDur = getMinDuration(item.title || '', item.type || '');
        const maxDur = getMaxDuration(item.title || '', item.type || '');
        if (item.duration) {
          if (item.duration < minDur * 0.8) { // 20% tolerance
            qualityWarnings.push(`P0.7: "${item.title}" duration ${item.duration}min below minimum ${minDur}min`);
            metrics.durationViolations++;
          }
          if (maxDur && item.duration > maxDur * 1.2) { // 20% tolerance
            qualityWarnings.push(`P0.7: "${item.title}" duration ${item.duration}min above maximum ${maxDur}min`);
            metrics.durationViolations++;
          }
        }
      }

      if (item.type === 'restaurant') {
        metrics.totalRestaurants++;
        const isSelfMealFallback = item.qualityFlags?.includes('self_meal_fallback') === true;

        // Check meal type from mealType field or title
        const mealType = item.mealType;
        const titleLower = (item.title || '').toLowerCase();
        const isLunchMeal = mealType === 'lunch' || titleLower.includes('lunch') || titleLower.includes('déjeuner');
        const isDinnerMeal = mealType === 'dinner' || titleLower.includes('dinner') || titleLower.includes('dîner') || titleLower.includes('diner');

        if (isLunchMeal) {
          hasLunch = true;
        }
        if (isDinnerMeal) {
          hasDinner = true;
        }

        if (!isSelfMealFallback && !isRestaurantOpenAtTime(item, dayDate, item.startTime, item.endTime)) {
          violations.push(`P0.1: Day ${day.dayNumber} "${item.title}" outside opening hours (${item.startTime}-${item.endTime})`);
          metrics.activitiesOutsideHours++;
        }

        // P0.2: Lunch/dinner only, strict 800m, and self-meal fallback is excluded.
        if (!isSelfMealFallback && (isLunchMeal || isDinnerMeal) && item.latitude && item.longitude) {
          const maxDistKm = 0.8;

          const nearestActivity = day.items
            .filter(i => i.type === 'activity' && i.latitude && i.longitude)
            .reduce((closest, act) => {
              const dist = calculateDistance(item.latitude!, item.longitude!, act.latitude!, act.longitude!);
              return dist < closest.dist ? { dist, item: act } : closest;
            }, { dist: Infinity, item: null as TripItem | null });

          if (nearestActivity.dist !== Infinity) {
            totalRestaurantDist += nearestActivity.dist;
            restaurantDistCount++;
            if (nearestActivity.dist > maxDistKm) {
              violations.push(`P0.2: Day ${day.dayNumber} "${item.title}" is ${(nearestActivity.dist * 1000).toFixed(0)}m from nearest activity (max ${maxDistKm * 1000}m)`);
              metrics.restaurantsOverMaxDistance++;
            }
          }
        }
      }
    }

    // P0.3: Missing meals check (skip first/last day if transport-constrained)
    const isFirstDay = day.dayNumber === 1;
    const isLastDay = day.dayNumber === days.length;

    // Skip lunch check for first and last day (arrival/departure — constrained time windows)
    if (!hasLunch && !isFirstDay && !isLastDay) {
      violations.push(`P0.3: Day ${day.dayNumber} has no lunch`);
      metrics.daysWithoutLunch++;
    }
    if (!hasDinner && !isLastDay) {
      violations.push(`P0.3: Day ${day.dayNumber} has no dinner`);
      metrics.daysWithoutDinner++;
    }
  }

  // P0.8: Must-sees presence
  // Primary check: by activity ID. Fallback: by normalized name (handles accent
  // differences like "Sagrada Família" vs "Sagrada Familia", and cross-language
  // names like "Buckingham Palace" vs "Palais de Buckingham").
  const mustSeeIdArray = Array.from(mustSeeIds);
  for (const mustSeeId of mustSeeIdArray) {
    if (plannedActivityIds.has(mustSeeId)) {
      metrics.mustSeesPlanned++;
      continue;
    }

    // Name-based fallback: look up the must-see name from the provided activity list
    const mustSeeActivity = mustSeeActivities?.find(a => a.id === mustSeeId);
    if (mustSeeActivity) {
      const mustSeeNorm = normalizeForMatching(mustSeeActivity.name);
      const foundByName = mustSeeNorm.length >= 5 && plannedActivityNamesNorm.some(
        plannedNorm => plannedNorm.includes(mustSeeNorm) || mustSeeNorm.includes(plannedNorm)
      );
      if (foundByName) {
        metrics.mustSeesPlanned++;
        console.log(`[Contracts] P0.8 must-see "${mustSeeActivity.name}" matched by name (ID mismatch — accent/language variant)`);
        continue;
      }
    }

    violations.push(`P0.8: Must-see ID "${mustSeeId}" not found in final plan`);
  }

  // Calculate average restaurant distance
  metrics.avgRestaurantDistance = restaurantDistCount > 0
    ? totalRestaurantDist / restaurantDistCount
    : 0;

  // Calculate quality score (0-100)
  let score = 100;
  score -= violations.length * 5; // -5 per P0 violation
  score -= qualityWarnings.length * 2; // -2 per warning
  score -= metrics.activitiesOutsideHours * 10; // Extra penalty for time violations
  if (metrics.mustSeesTotal > 0) {
    const mustSeeRatio = metrics.mustSeesPlanned / metrics.mustSeesTotal;
    if (mustSeeRatio < 1) score -= (1 - mustSeeRatio) * 20;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const invariantsPassed = violations.length === 0;

  console.log(`[Contracts] Score: ${score}/100, Invariants: ${invariantsPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  Activities: ${metrics.totalActivities}, Restaurants: ${metrics.totalRestaurants}`);
  console.log(`  Must-sees: ${metrics.mustSeesPlanned}/${metrics.mustSeesTotal}`);
  if (violations.length > 0) {
    console.log(`  Violations (${violations.length}):`);
    for (const v of violations) console.log(`    - ${v}`);
  }
  if (qualityWarnings.length > 0) {
    console.log(`  Warnings (${qualityWarnings.length}):`);
    for (const w of qualityWarnings) console.log(`    - ${w}`);
  }

  return { invariantsPassed, score, violations, qualityWarnings, metrics };
}

// ============================================
// Helpers
// ============================================

function getDayDate(startDate: string, dayNumber: number): Date {
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayNumber - 1);
  return date;
}

function isRestaurantOpenAtTime(
  item: TripItem,
  dayDate: Date,
  startTime: string,
  endTime: string
): boolean {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const dayName = dayNames[dayDate.getDay()];

  const dayHoursFromItem = item.openingHoursByDay?.[dayName];
  const dayHoursFromRestaurant = item.restaurant?.openingHours?.[dayName];
  const simpleHours = item.openingHours;
  const dayHours = dayHoursFromItem ?? dayHoursFromRestaurant ?? simpleHours;

  if (dayHours === null) return false;
  if (!dayHours || !dayHours.open || !dayHours.close) return true; // Unknown hours -> do not block

  const toleranceMin = 15;
  const openMin = toMinutes(dayHours.open);
  let closeMin = toMinutes(dayHours.close);
  let slotStart = toMinutes(startTime);
  let slotEnd = toMinutes(endTime);

  if (closeMin <= openMin) {
    closeMin += 24 * 60;
    if (slotStart < openMin) {
      slotStart += 24 * 60;
      slotEnd += 24 * 60;
    }
  }

  return slotStart >= openMin - toleranceMin && slotEnd <= closeMin + toleranceMin;
}

function toMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

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
import type { DayTimeWindow } from './step4-anchor-transport';
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
  // Distribution & routing quality (Phase v3.2)
  /** Std dev of activity counts across full days — lower = better balanced */
  dayLoadImbalance: number;
  /** Total intra-day travel minutes across all days */
  totalTravelMinutes: number;
  /** Number of intra-city legs > 4km (non day-trip) */
  longUrbanLegCount: number;
  /** Total zigzag turns across all days */
  zigzagTurnsTotal: number;
  /** Number of days with 0-1 activities (excluding arrival/departure with short windows) */
  nearEmptyDayCount: number;
  /** Number of days with > 6 activities */
  overloadedDayCount: number;
  /** Number of "Repas libre" fallbacks */
  mealFallbackCount: number;
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
  mustSeeActivities?: Array<{ id: string; name: string }>,
  timeWindows?: DayTimeWindow[]
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
    dayLoadImbalance: 0,
    totalTravelMinutes: 0,
    longUrbanLegCount: 0,
    zigzagTurnsTotal: 0,
    nearEmptyDayCount: 0,
    overloadedDayCount: 0,
    mealFallbackCount: 0,
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
        if (
          item.latitude !== 0
          && item.longitude !== 0
          && item.type !== 'flight'
          && !(item.type === 'transport' && item.transportRole === 'longhaul')
        ) {
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
        // "déjeuner" matches lunch but NOT "petit-déjeuner" (breakfast)
        const isLunchMeal = mealType === 'lunch' || titleLower.includes('lunch') || (titleLower.includes('déjeuner') && !titleLower.includes('petit-déjeuner'));
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

        // P0.2: Lunch/dinner only, 1.5km max (aligned with pass 3 search radius), self-meal fallback excluded.
        if (!isSelfMealFallback && (isLunchMeal || isDinnerMeal) && item.latitude && item.longitude) {
          const maxDistKm = 1.5;

          // Include hotel-related items as valid anchor points (restaurant near hotel is valid,
          // especially on arrival/departure days with few activities)
          const anchorTypes = new Set(['activity', 'checkin', 'checkout', 'hotel']);
          const nearestActivity = day.items
            .filter(i => anchorTypes.has(i.type) && i.latitude && i.longitude)
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

    // P0.3: Missing meals — use time-window-derived eligibility (not blanket day exemptions)
    const tw = timeWindows?.find(w => w.dayNumber === day.dayNumber);
    const twStartMin = tw ? toMinutes(tw.activityStartTime) : 0;
    const twEndMin = tw ? toMinutes(tw.activityEndTime) : 22 * 60;
    const hasUsableWindow = twEndMin > twStartMin;
    // Check actual arrival/departure transport (more reliable than time window flags,
    // which are set before transport injection in step 11b)
    const isFirstDay = day.dayNumber === days[0]?.dayNumber;
    const isLastDay = day.dayNumber === days[days.length - 1]?.dayNumber;
    const arrivalItem = day.items.find(i =>
      (isFirstDay && i.type === 'flight') || (i.type === 'transport' && (i as any).transportDirection === 'outbound')
    );
    const departureItem = day.items.find(i =>
      (isLastDay && i.type === 'flight') || (i.type === 'transport' && (i as any).transportDirection === 'return')
    );
    // For arrival days, effective start = arrival end time + buffer (customs/transport)
    const effectiveStartMin = arrivalItem?.endTime
      ? toMinutes(arrivalItem.endTime) + 60  // 1h buffer after arrival
      : twStartMin;
    const expectLunch = hasUsableWindow && effectiveStartMin < 13 * 60 && twEndMin > 12 * 60;
    const hasDeparture = !!(tw?.hasDepartureTransport || departureItem);
    const effectiveEndMin = departureItem
      ? toMinutes(departureItem.startTime || '23:59')
      : twEndMin;
    // Departure days: need dinner feasible before departure (20:00 threshold)
    const dinnerThreshold = hasDeparture ? 20 * 60 : 18 * 60;
    const expectDinner = hasUsableWindow && effectiveEndMin >= dinnerThreshold;

    if (!hasLunch && expectLunch) {
      violations.push(`P0.3: Day ${day.dayNumber} has no lunch`);
      metrics.daysWithoutLunch++;
    }
    if (!hasDinner && expectDinner) {
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
      const foundByName = mustSeeNorm.length >= 5 && plannedActivityNamesNorm.some(plannedNorm => {
        if (plannedNorm.includes(mustSeeNorm) || mustSeeNorm.includes(plannedNorm)) {
          const shorter = Math.min(plannedNorm.length, mustSeeNorm.length);
          const longer = Math.max(plannedNorm.length, mustSeeNorm.length);
          return shorter / longer >= 0.3;
        }
        return false;
      });
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

  // ── Distribution & routing quality metrics ──
  const LOGISTICS_TYPES = new Set(['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage', 'free_time']);
  const dayActivityCounts: number[] = [];

  for (const day of days) {
    const tw = timeWindows?.find(w => w.dayNumber === day.dayNumber);
    const twStartMin = tw ? toMinutes(tw.activityStartTime) : 0;
    const twEndMin = tw ? toMinutes(tw.activityEndTime) : 22 * 60;
    const windowMin = twEndMin - twStartMin;
    const isShortWindow = windowMin < 300; // < 5h

    const activities = day.items.filter(i => i.type === 'activity');
    const actCount = activities.length;
    dayActivityCounts.push(actCount);

    // Near-empty days (skip short-window arrival/departure)
    if (actCount <= 1 && !isShortWindow && !day.isDayTrip) {
      metrics.nearEmptyDayCount++;
    }
    // Overloaded days
    if (actCount > 6) {
      metrics.overloadedDayCount++;
    }

    // Meal fallbacks
    metrics.mealFallbackCount += day.items.filter(
      i => i.type === 'restaurant' && i.qualityFlags?.includes('self_meal_fallback')
    ).length;

    // Intra-day travel and routing
    const nonLogistics = day.items
      .filter(i => !LOGISTICS_TYPES.has(i.type))
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

    for (let i = 0; i < nonLogistics.length - 1; i++) {
      const curr = nonLogistics[i];
      const next = nonLogistics[i + 1];
      if (!curr.latitude || !curr.longitude || !next.latitude || !next.longitude) continue;
      if (curr.latitude === 0 || next.latitude === 0) continue;

      const dist = calculateDistance(curr.latitude, curr.longitude, next.latitude, next.longitude);
      // Travel time estimate: 30km/h urban
      metrics.totalTravelMinutes += Math.round((dist / 30) * 60);

      // Long urban legs (non day-trip)
      if (dist > 4 && !day.isDayTrip) {
        metrics.longUrbanLegCount++;
      }
    }

    // Zigzag detection
    if (nonLogistics.length >= 3) {
      const points = nonLogistics
        .filter(i => i.latitude && i.longitude && i.latitude !== 0)
        .map(i => ({ lat: i.latitude!, lng: i.longitude! }));

      for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];
        const v1x = curr.lng - prev.lng;
        const v1y = curr.lat - prev.lat;
        const v2x = next.lng - curr.lng;
        const v2y = next.lat - curr.lat;
        const norm1 = Math.hypot(v1x, v1y);
        const norm2 = Math.hypot(v2x, v2y);
        if (norm1 < 1e-6 || norm2 < 1e-6) continue;
        const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (norm1 * norm2)));
        const angleDeg = Math.acos(cosTheta) * (180 / Math.PI);
        if (angleDeg >= 115) metrics.zigzagTurnsTotal++;
      }
    }
  }

  // Day load imbalance: std dev of activity counts across non-trivial days
  const fullDayCounts = dayActivityCounts.filter(c => c > 0);
  if (fullDayCounts.length >= 2) {
    const mean = fullDayCounts.reduce((s, c) => s + c, 0) / fullDayCounts.length;
    const variance = fullDayCounts.reduce((s, c) => s + (c - mean) ** 2, 0) / fullDayCounts.length;
    metrics.dayLoadImbalance = Math.sqrt(variance);
  }

  // ── Quality score (0-100) — weighted across all dimensions ──
  let score = 100;

  // P0 violations: -5 each (hard failures)
  score -= violations.length * 5;

  // Warnings: -2 each
  score -= qualityWarnings.length * 2;

  // Opening hours: -10 extra per violation
  score -= metrics.activitiesOutsideHours * 10;

  // Must-sees missing: already penalized -5 each via P0.8 violations above — no double-counting

  // Distribution penalties (NEW)
  // Near-empty full days: -4 each (wasted day)
  score -= metrics.nearEmptyDayCount * 4;

  // Overloaded days: -3 each (exhausting)
  score -= metrics.overloadedDayCount * 3;

  // Day load imbalance: -2 per unit of std dev (1 act on day A, 6 on day B = bad)
  score -= Math.min(8, metrics.dayLoadImbalance * 2);

  // Routing penalties (NEW)
  // Long urban legs: -2 each (inefficient routing)
  score -= Math.min(8, metrics.longUrbanLegCount * 2);

  // Zigzag: -1 per turn, capped at -3 (115° turns are common in cities)
  score -= Math.min(3, metrics.zigzagTurnsTotal * 1);

  // Excessive travel: -1 per 30min above 60min total (some travel is normal)
  const excessTravelMin = Math.max(0, metrics.totalTravelMinutes - 60 * days.length);
  score -= Math.min(6, Math.floor(excessTravelMin / 30));

  // Meal fallbacks: -2 each (bad restaurant coverage)
  score -= Math.min(8, metrics.mealFallbackCount * 2);

  score = Math.max(0, Math.min(100, Math.round(score)));

  const invariantsPassed = violations.length === 0;

  console.log(`[Contracts] Score: ${score}/100, Invariants: ${invariantsPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  Activities: ${metrics.totalActivities}, Restaurants: ${metrics.totalRestaurants}`);
  console.log(`  Must-sees: ${metrics.mustSeesPlanned}/${metrics.mustSeesTotal}`);
  console.log(`  Distribution: imbalance=${metrics.dayLoadImbalance.toFixed(1)}, empty=${metrics.nearEmptyDayCount}, overloaded=${metrics.overloadedDayCount}`);
  console.log(`  Routing: travel=${metrics.totalTravelMinutes}min, longLegs=${metrics.longUrbanLegCount}, zigzag=${metrics.zigzagTurnsTotal}`);
  console.log(`  Meals: fallbacks=${metrics.mealFallbackCount}`);
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

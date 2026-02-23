/**
 * Pipeline V3 — Step 9: Schedule Timeline
 *
 * Assembles per-day TripItem timelines from clusters, meal plans, travel times,
 * and transport time windows. Produces the ordered list of TripDay objects that
 * form the core of the Trip output.
 *
 * Responsibilities:
 *   - Place breakfast / lunch / dinner at correct times
 *   - Walk activities in geo-routed order, inserting travel gaps
 *   - Respect opening hours (skip or adjust must-sees)
 *   - Force-inject must-sees that were skipped (evict lowest-scored activity)
 *   - Prevent temporal overlaps via a cascade-shift pass
 *   - Enrich activity items with ticketing links (Viator, Tiqets, official)
 */

import type { TripPreferences, Restaurant, Accommodation } from '../types';
import type { TripDay, TripItem } from '../types/trip';
import type { ActivityCluster, ScoredActivity, FetchedData } from './types';
import type { DayMealPlan, MealPlacement } from './step8-place-restaurants';
import type { DayTravelTimes } from './step7b-travel-times';
import type { DayTimeWindow } from './step4-anchor-transport';
import { timeToMin, minToTime, addMinutes, isPastEnd, ensureAfter } from './utils/time';
import { getClusterCentroid, findMidDayActivity } from './utils/geo';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble V3 days from clusters, meals, travel times, and time windows.
 * This is the single entry-point exported from this module.
 */
export function assembleV3Days(
  clusters: ActivityCluster[],
  mealPlans: DayMealPlan[],
  travelTimes: DayTravelTimes[],
  timeWindows: DayTimeWindow[],
  hotel: Accommodation | null,
  preferences: TripPreferences,
  data: FetchedData
): TripDay[] {
  const days: TripDay[] = [];
  const startDate = preferences.startDate || new Date();

  // Build a flat global restaurant pool once for fallback meal injection.
  // Sorted by distance to each anchor on demand below.
  const globalRestaurantPool: Restaurant[] = [
    ...(data.tripAdvisorRestaurants || []),
    ...(data.serpApiRestaurants || []),
  ];

  /**
   * Returns the closest restaurant from the global pool to a given point.
   * Prefers restaurants within 5km; only falls back to unlimited distance when
   * no restaurant exists within that radius.
   * Used as a last-resort fallback when step8 returned no placement for a meal.
   */
  function pickClosestRestaurant(
    anchor: { lat: number; lng: number },
    excludeIds: Set<string>
  ): MealPlacement['primary'] | null {
    // Degree-based approximation for 5km (~0.045°). Exact haversine check follows.
    const MAX_PREFERRED_KM = 5.0;
    const KM_PER_DEG = 111.0; // approximate degrees-per-km for rough pre-filter

    let bestWithin5km: Restaurant | null = null;
    let bestWithin5kmDist = Infinity;
    let bestUnlimited: Restaurant | null = null;
    let bestUnlimitedDist = Infinity;

    for (const r of globalRestaurantPool) {
      if (excludeIds.has(r.id)) continue;
      // Use Euclidean degrees as a cheap pre-screen to avoid slow Math.hypot on large pools
      const dLat = r.latitude - anchor.lat;
      const dLng = r.longitude - anchor.lng;
      const dKmApprox = Math.sqrt(dLat * dLat + dLng * dLng) * KM_PER_DEG;

      if (dKmApprox < bestUnlimitedDist) {
        bestUnlimitedDist = dKmApprox;
        bestUnlimited = r;
      }
      if (dKmApprox <= MAX_PREFERRED_KM && dKmApprox < bestWithin5kmDist) {
        bestWithin5kmDist = dKmApprox;
        bestWithin5km = r;
      }
    }

    if (bestWithin5km) return bestWithin5km;

    // Nothing within 5km — log a strong warning and return the global closest
    if (bestUnlimited) {
      console.error(`[assembleV3Days] pickClosestRestaurant: no restaurant within 5km — forced to use "${bestUnlimited.name}" (~${(bestUnlimitedDist).toFixed(1)}km away). Consider enriching the restaurant pool.`);
    }
    return bestUnlimited;
  }

  /**
   * Builds a synthetic MealPlacement for use when step8 returned no result.
   */
  function buildFallbackMealPlacement(
    mealType: 'breakfast' | 'lunch' | 'dinner',
    anchor: { lat: number; lng: number },
    anchorName: string,
    excludeIds: Set<string>
  ): MealPlacement | null {
    const restaurant = pickClosestRestaurant(anchor, excludeIds);
    if (!restaurant) return null;
    console.warn(`[assembleV3Days] Fallback meal injection: ${mealType} — using "${restaurant.name}" (global closest)`);
    return {
      mealType,
      anchorPoint: anchor,
      anchorName,
      primary: restaurant,
      alternatives: [],
      distanceFromAnchor: Math.hypot(restaurant.latitude - anchor.lat, restaurant.longitude - anchor.lng),
    };
  }

  // Global dedup: track activity IDs already placed across all days
  const globalPlacedIds = new Set<string>();

  for (const cluster of clusters) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + cluster.dayNumber - 1);

    // Dedup activities within this cluster (same ID should not appear twice)
    const seenIds = new Set<string>();
    cluster.activities = cluster.activities.filter(act => {
      const id = act.id || act.name;
      if (seenIds.has(id) || globalPlacedIds.has(id)) {
        console.log(`[assembleV3Days] Dedup: removing duplicate "${act.name}" from Day ${cluster.dayNumber}`);
        return false;
      }
      seenIds.add(id);
      return true;
    });

    const timeWindow = timeWindows.find(w => w.dayNumber === cluster.dayNumber);
    const mealPlan = mealPlans.find(m => m.dayNumber === cluster.dayNumber);
    const dayTravel = travelTimes.find(t => t.dayNumber === cluster.dayNumber);

    const dayStartTime = timeWindow?.activityStartTime || '08:30';
    const dayEndTime = timeWindow?.activityEndTime || '21:00';

    const items: TripItem[] = [];
    let currentTime = dayStartTime;
    let orderIndex = 0;
    let lunchPlaced = false;
    let activitiesPlaced = 0;

    // isPastEnd and timeToMin are imported from ./utils/time

    // Track meal IDs already placed this day for fallback dedup
    const dayUsedMealIds = new Set<string>();

    // Breakfast — use step8 result or inject global-closest fallback
    const hotelLatLng = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;
    const breakfastAnchor = hotelLatLng || getClusterCentroid(cluster.activities);
    const breakfast: MealPlacement | undefined =
      mealPlan?.meals.find(m => m.mealType === 'breakfast') ??
      (breakfastAnchor
        ? buildFallbackMealPlacement('breakfast', breakfastAnchor, 'Hotel', dayUsedMealIds) ?? undefined
        : undefined);
    if (breakfast) {
      dayUsedMealIds.add(breakfast.primary.id);
      items.push(createRestaurantItem(breakfast, 'breakfast', currentTime, 45, cluster.dayNumber, orderIndex++));
      currentTime = addMinutes(currentTime, 60); // 45min eat + 15min travel
    }

    // Activities with travel times between them
    const lunchAnchorAct = findMidDayActivity(cluster.activities);
    const lunchAnchor = lunchAnchorAct
      ? { lat: lunchAnchorAct.latitude, lng: lunchAnchorAct.longitude }
      : getClusterCentroid(cluster.activities);
    const lunch: MealPlacement | undefined =
      mealPlan?.meals.find(m => m.mealType === 'lunch') ??
      (lunchAnchor
        ? buildFallbackMealPlacement('lunch', lunchAnchor, lunchAnchorAct?.name || 'Mid-day point', dayUsedMealIds) ?? undefined
        : undefined);

    for (let i = 0; i < cluster.activities.length; i++) {
      // Check if we have enough time left for this activity
      if (isPastEnd(currentTime, dayEndTime)) {
        console.log(`[assembleV3Days] Day ${cluster.dayNumber}: stopping at activity ${i}/${cluster.activities.length} (${currentTime} >= ${dayEndTime})`);
        break;
      }

      const act = cluster.activities[i];
      const travelLeg = dayTravel?.legs.find(l => l.toId === act.id);

      // Add travel time (but don't exceed day end)
      if (travelLeg && travelLeg.durationMinutes > 5) {
        const afterTravel = addMinutes(currentTime, travelLeg.durationMinutes);
        if (!isPastEnd(afterTravel, dayEndTime)) {
          currentTime = afterTravel;
        }
      }

      // Place lunch before this activity if it's past 12:15 and we haven't placed it yet
      if (!lunchPlaced && lunch && activitiesPlaced >= 2 && timeToMin(currentTime) >= 12 * 60 + 15) {
        items.push(createRestaurantItem(lunch, 'lunch', currentTime, 75, cluster.dayNumber, orderIndex++));
        currentTime = addMinutes(currentTime, 90); // 75min eat + 15min travel
        lunchPlaced = true;

        // Check time again after lunch
        if (isPastEnd(currentTime, dayEndTime)) {
          console.log(`[assembleV3Days] Day ${cluster.dayNumber}: stopping after lunch (${currentTime} >= ${dayEndTime})`);
          break;
        }
      }

      const duration = act.duration || 60;

      // Check if this activity fits within the day
      const hardEndTime = addMinutes(dayEndTime, 30);
      if (isPastEnd(currentTime, hardEndTime)) {
        console.log(`[assembleV3Days] Day ${cluster.dayNumber}: skipping "${act.name}" (${currentTime} past hard end ${hardEndTime})`);
        break;
      }

      // Check opening hours: skip if the activity would start/end outside opening hours
      const actCloseTime = getActivityCloseTime(act, dayDate);
      if (actCloseTime) {
        const actEnd = addMinutes(currentTime, duration);
        if (isPastEnd(actEnd, actCloseTime)) {
          if (act.mustSee) {
            // Fix 1: For must-sees, try to move the start time earlier so the visit
            // finishes within closing time instead of silently skipping it.
            const closeMin = timeToMin(actCloseTime);
            const dayStartMin = timeToMin(dayStartTime);
            const candidateStartMin = closeMin - duration;
            if (candidateStartMin >= dayStartMin) {
              // There is room earlier in the day — pull start time back to fit
              const candidateStart = minToTime(candidateStartMin);
              console.warn(
                `[assembleV3Days] Day ${cluster.dayNumber}: must-see "${act.name}" ends ${actEnd} past close ${actCloseTime}` +
                ` — shifting start to ${candidateStart} to fit within hours`
              );
              currentTime = candidateStart;
              // Re-derive actEnd with the adjusted start — it will fit, fall through
            } else {
              // The window before closing is shorter than the activity duration.
              // Place it at the closest possible start and let it run a bit past close;
              // a truncated visit is better than no visit for a must-see.
              const earliestFitStart = minToTime(Math.max(dayStartMin, closeMin - duration));
              console.warn(
                `[assembleV3Days] Day ${cluster.dayNumber}: must-see "${act.name}" cannot fully fit before close ${actCloseTime}` +
                ` — placing at ${earliestFitStart} (truncated visit, must-see priority)`
              );
              currentTime = earliestFitStart;
              // Fall through and place it anyway
            }
          } else {
            // Normal activity: skip and try the next one
            console.log(`[assembleV3Days] Day ${cluster.dayNumber}: skipping "${act.name}" (ends ${actEnd} past close ${actCloseTime})`);
            continue;
          }
        }
      }
      const actOpenTime = getActivityOpenTime(act, dayDate);
      if (actOpenTime && !isPastEnd(currentTime, actOpenTime)) {
        // Activity hasn't opened yet — push currentTime to opening time
        currentTime = actOpenTime;
      }

      items.push(createActivityItem(act, currentTime, duration, cluster.dayNumber, orderIndex++));
      globalPlacedIds.add(act.id || act.name);
      currentTime = addMinutes(currentTime, duration + 10); // 10min buffer between activities
      activitiesPlaced++;
    }

    // Fix 2: Final must-see verification pass.
    // Any mustSee in this cluster that was not placed (still missing from globalPlacedIds)
    // gets force-injected by evicting the lowest-scored non-must-see activity already in items.
    const missingMustSees = cluster.activities.filter(
      act => act.mustSee && !globalPlacedIds.has(act.id || act.name)
    );
    if (missingMustSees.length > 0) {
      // Find indices of non-must-see activity items (type 'activity') already placed this day
      const nonMustSeeIndices = items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.type === 'activity' && !item.mustSee);

      for (const missing of missingMustSees) {
        if (nonMustSeeIndices.length === 0) break; // No candidates to evict

        // Evict the lowest-scored non-must-see (use rating as proxy; lower = more expendable)
        nonMustSeeIndices.sort((a, b) => (a.item.rating ?? 0) - (b.item.rating ?? 0));
        const victim = nonMustSeeIndices.shift()!;

        const replaceDuration = missing.duration || 60;
        const replaceStart = victim.item.startTime;
        const replaceItem = createActivityItem(missing, replaceStart, replaceDuration, cluster.dayNumber, victim.item.orderIndex);

        console.warn(
          `[assembleV3Days] Day ${cluster.dayNumber}: must-see "${missing.name}" was not placed — ` +
          `evicting "${victim.item.title}" (rating ${victim.item.rating ?? 'n/a'}) to inject it`
        );

        items[victim.idx] = replaceItem;
        globalPlacedIds.add(missing.id || missing.name);
      }

      // Re-sort and re-index after potential replacements
      items.sort((a, b) => timeToMin(a.startTime || '00:00') - timeToMin(b.startTime || '00:00'));
      items.forEach((item, idx) => { item.orderIndex = idx; });
    }

    // Place lunch if not yet placed (early days or few activities) — includes fallback
    if (!lunchPlaced && lunch && activitiesPlaced > 0) {
      const lunchTime = ensureAfter(currentTime, '12:15');
      if (!isPastEnd(lunchTime, addMinutes(dayEndTime, 30))) {
        items.push(createRestaurantItem(lunch, 'lunch', lunchTime, 75, cluster.dayNumber, orderIndex++));
        currentTime = addMinutes(lunchTime, 90);
        lunchPlaced = true;
      }
    }

    // Dinner — use step8 result or inject global-closest fallback
    if (lunch) dayUsedMealIds.add(lunch.primary.id);
    const lastAct = cluster.activities[cluster.activities.length - 1];
    const dinnerAnchor = lastAct
      ? { lat: lastAct.latitude, lng: lastAct.longitude }
      : hotelLatLng || getClusterCentroid(cluster.activities);
    const dinner: MealPlacement | undefined =
      mealPlan?.meals.find(m => m.mealType === 'dinner') ??
      (dinnerAnchor
        ? buildFallbackMealPlacement('dinner', dinnerAnchor, lastAct?.name || 'Hotel', dayUsedMealIds) ?? undefined
        : undefined);
    if (dinner) {
      // Dinner between 19:00 and 21:30
      let dinnerTime = ensureAfter(currentTime, '19:00');
      // Cap dinner start at 21:30 max
      if (isPastEnd(dinnerTime, '21:30')) {
        dinnerTime = '21:00';
      }
      items.push(createRestaurantItem(dinner, 'dinner', dinnerTime, 90, cluster.dayNumber, orderIndex++));
    }

    days.push({
      dayNumber: cluster.dayNumber,
      date: dayDate,
      items,
      theme: '',
      dayNarrative: '',
    });
  }

  // Sort each day's items by start time
  for (const day of days) {
    day.items.sort((a, b) => {
      const [ha, ma] = (a.startTime || '00:00').split(':').map(Number);
      const [hb, mb] = (b.startTime || '00:00').split(':').map(Number);
      return (ha * 60 + ma) - (hb * 60 + mb);
    });
    // Re-assign orderIndex after sorting
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Temporal overlap prevention: sweep each day and cascade-shift overlapping items
  for (const day of days) {
    const timeWindow = timeWindows.find(w => w.dayNumber === day.dayNumber);
    const dayEndStr = timeWindow?.activityEndTime || '21:00';
    // Allow a small buffer past the nominal end for dinner
    const hardEndMin = timeToMin(addMinutes(dayEndStr, 120)); // dinner can run until 23:00

    for (let i = 0; i < day.items.length - 1; i++) {
      const curr = day.items[i];
      const next = day.items[i + 1];

      const currEndMin = timeToMin(curr.endTime || '00:00');
      const nextStartMin = timeToMin(next.startTime || '00:00');

      if (currEndMin > nextStartMin) {
        // Overlap detected: shift next item to currEnd + 5min buffer
        const shiftedStart = currEndMin + 5;
        const itemDuration = timeToMin(next.endTime || '00:00') - nextStartMin;
        const shiftedEnd = shiftedStart + Math.max(itemDuration, 0);

        // If the shifted item would push past hard end, drop it
        if (shiftedStart >= hardEndMin) {
          console.log(`[assembleV3Days] Overlap fix: dropping "${next.title}" on Day ${day.dayNumber} (shifted start ${minToTime(shiftedStart)} past hard end ${minToTime(hardEndMin)})`);
          day.items.splice(i + 1, 1);
          i--; // Re-check from current position
          continue;
        }

        next.startTime = minToTime(shiftedStart);
        next.endTime = minToTime(shiftedEnd);
      }
    }

    // Re-assign orderIndex after potential removals
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Enrich all activity items with ticketing links (official + Viator + Tiqets)
  const destination = preferences.destination || '';
  for (const day of days) {
    const { enrichWithTicketingLinks } = require('../services/officialTicketing');
    enrichWithTicketingLinks(day.items, destination);
  }

  return days;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Helper: Create a TripItem for an activity
 */
function createActivityItem(
  activity: ScoredActivity,
  startTime: string,
  duration: number,
  dayNumber: number,
  orderIndex: number
): TripItem {
  return {
    id: activity.id || `activity-${Date.now()}-${Math.random()}`,
    dayNumber,
    startTime,
    endTime: addMinutes(startTime, duration),
    type: 'activity',
    title: activity.name || 'Activity',
    description: activity.description || '',
    locationName: activity.name || '',
    latitude: activity.latitude,
    longitude: activity.longitude,
    orderIndex,
    duration,
    rating: activity.rating,
    estimatedCost: activity.estimatedCost,
    imageUrl: activity.imageUrl,
    bookingUrl: activity.bookingUrl,
    mustSee: activity.mustSee,
    openingHours: activity.openingHours,
    openingHoursByDay: activity.openingHoursByDay,
  };
}

/**
 * Helper: Create a TripItem for a restaurant
 */
function createRestaurantItem(
  meal: MealPlacement,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  startTime: string,
  duration: number,
  dayNumber: number,
  orderIndex: number
): TripItem {
  const restaurant = meal.primary;
  return {
    id: `meal-${dayNumber}-${mealType}`,
    dayNumber,
    startTime,
    endTime: addMinutes(startTime, duration),
    type: 'restaurant',
    title: restaurant.name || 'Restaurant',
    description: `${mealType.charAt(0).toUpperCase() + mealType.slice(1)} at ${restaurant.name}`,
    locationName: restaurant.name || '',
    latitude: restaurant.latitude || 0,
    longitude: restaurant.longitude || 0,
    orderIndex,
    duration,
    mealType,
    restaurant,
    restaurantAlternatives: meal.alternatives,
    rating: restaurant.rating,
    estimatedCost: restaurant.priceLevel ? restaurant.priceLevel * 15 : undefined,
  };
}

/**
 * Helper: Get closing time for an activity on a given day
 */
function getActivityCloseTime(activity: ScoredActivity, dayDate: Date): string | null {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayDate.getDay()];

  // Always-open public spaces (piazzas, parks, streets) — no closing time
  const alwaysOpenKeywords = /piazza|plaza|place|park|jardin|garden|fontaine|fountain|bridge|pont|quartier|street|via|campo|square/i;
  if (alwaysOpenKeywords.test(activity.name || '')) return null;

  // Check day-specific hours first
  if (activity.openingHoursByDay) {
    const dayHours = activity.openingHoursByDay[dayName];
    if (dayHours === null) {
      // Day is null in data — fall back to generic hours (don't assume closed)
      // Only treat as closed if generic hours also indicate closure
      if (activity.openingHours?.close && activity.openingHours.close !== '23:59' && activity.openingHours.close !== '00:00') {
        // Has specific generic hours — likely a museum or similar. Null day = closed
        return '00:00';
      }
      // Generic hours are always-open or missing — treat as open
      return null;
    }
    if (dayHours && dayHours.close) {
      // Close at 23:59 or 00:00 means always open
      if (dayHours.close === '23:59' || dayHours.close === '00:00') return null;
      return dayHours.close;
    }
  }

  // Fall back to generic hours
  if (activity.openingHours?.close) {
    if (activity.openingHours.close === '23:59' || activity.openingHours.close === '00:00') return null;
    return activity.openingHours.close;
  }

  return null; // No hours info — treat as always open
}

/**
 * Helper: Get opening time for an activity on a given day
 */
function getActivityOpenTime(activity: ScoredActivity, dayDate: Date): string | null {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayDate.getDay()];

  if (activity.openingHoursByDay) {
    const dayHours = activity.openingHoursByDay[dayName];
    if (dayHours === null) return null;
    if (dayHours && dayHours.open) return dayHours.open;
  }

  if (activity.openingHours?.open) {
    return activity.openingHours.open;
  }

  return null;
}

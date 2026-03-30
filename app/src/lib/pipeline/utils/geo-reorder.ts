/**
 * Geographic reordering of trip items within a day.
 *
 * Applies nearest-neighbor + 2-opt optimization to minimize total walking distance
 * for activities within a single day. Anchors (transport, checkin, checkout, flights)
 * and restaurants are kept in place — only activities are reordered.
 *
 * Used in step4-assemble-llm.ts before the scheduler to ensure activities
 * are visited in a geographically efficient order.
 */

import type { TripItem } from '../../types';
import { calculateDistance } from '../../services/geocoding';
import { getActivityMaxEndTime, getActivityMinStartTime } from './opening-hours';
import type { ScoredActivity } from '../types';

/**
 * Compute opening hours penalty for a route order.
 * Activities that close early should be visited earlier in the route.
 * Activities that open late should be visited later.
 *
 * Returns a penalty in "equivalent km" (0-2km range) to be added to route cost.
 */
function openingHoursPenalty(
  activities: TripItem[],
  dayDate: Date
): number {
  let penalty = 0;
  const n = activities.length;
  if (n <= 1) return 0;

  for (let i = 0; i < n; i++) {
    const position = i / (n - 1); // 0 = first, 1 = last

    // Cast to ScoredActivity to access opening hours data
    const activity = activities[i] as unknown as ScoredActivity;

    // Penalty for early-closing venues placed late in the route
    const maxEnd = getActivityMaxEndTime(activity, dayDate);
    if (maxEnd) {
      const closeHour = maxEnd.getHours() + maxEnd.getMinutes() / 60;
      if (closeHour <= 17 && position > 0.6) {
        // Venue closes at 17h or earlier but is placed in the last 40% of the route
        penalty += (position - 0.4) * 1.5; // Up to ~0.9km equivalent penalty
      }
    }

    // Penalty for late-opening venues placed first in the route
    const minStart = getActivityMinStartTime(activity, dayDate);
    if (minStart) {
      const openHour = minStart.getHours() + minStart.getMinutes() / 60;
      if (openHour >= 10 && position < 0.3) {
        // Venue opens at 10h or later but is placed in the first 30% of the route
        penalty += (0.3 - position) * 1.0; // Up to ~0.3km equivalent penalty
      }
    }
  }

  return penalty;
}

/**
 * Reorders activity items in a day to minimize total travel distance.
 *
 * @param items - All items for the day (activities, restaurants, transport, etc.)
 * @param hotelLat - Hotel latitude (start/end point for the route)
 * @param hotelLng - Hotel longitude
 * @param dayDate - Optional day date for opening hours penalty (defaults to neutral Monday)
 * @returns New array with activities reordered; non-activity items unchanged
 */
export function geoReorderDayItems(
  items: TripItem[],
  hotelLat: number,
  hotelLng: number,
  dayDate?: Date
): TripItem[] {
  // Default to neutral Monday if no date provided
  const effectiveDate = dayDate || new Date(2026, 0, 5); // Monday, Jan 5, 2026
  // Separate activities (reorderable) from anchors (fixed)
  const activities = items.filter(
    (it) =>
      it.type === 'activity' &&
      it.latitude && it.longitude &&
      it.latitude !== 0 && it.longitude !== 0
  );
  const anchors = items.filter(
    (it) => it.type !== 'activity' || !it.latitude || !it.longitude || it.latitude === 0 || it.longitude === 0
  );

  if (activities.length <= 2) {
    // No point optimizing 0-2 activities
    items.forEach((item, idx) => { item.orderIndex = idx; });
    return items;
  }

  // Cost function: total distance of the route (hotel → activities → hotel) + opening hours penalty
  const routeCost = (route: TripItem[]): number => {
    if (route.length === 0) return 0;
    let total = 0;
    let maxLeg = 0;
    let longLegPenalty = 0;

    // Hotel to first activity
    const firstLeg = calculateDistance(hotelLat, hotelLng, route[0].latitude, route[0].longitude);
    total += firstLeg;
    maxLeg = Math.max(maxLeg, firstLeg);
    if (firstLeg > 3) longLegPenalty += (firstLeg - 3) * 1.4;

    // Activity to activity
    for (let i = 1; i < route.length; i++) {
      const leg = calculateDistance(
        route[i - 1].latitude, route[i - 1].longitude,
        route[i].latitude, route[i].longitude
      );
      total += leg;
      maxLeg = Math.max(maxLeg, leg);
      if (leg > 3) longLegPenalty += (leg - 3) * 1.4;
    }

    // Last activity back to hotel (50% weight — we don't always return right away)
    const lastAct = route[route.length - 1];
    const returnLeg = calculateDistance(lastAct.latitude, lastAct.longitude, hotelLat, hotelLng);
    total += returnLeg * 0.5;

    // Penalize any single leg > 4km heavily
    const maxLegPenalty = Math.max(0, maxLeg - 4) * 2.5;

    // Add opening hours penalty (activities with early closing should come earlier in route)
    const hoursPenalty = openingHoursPenalty(route, effectiveDate);

    return total + longLegPenalty + maxLegPenalty + hoursPenalty;
  };

  // Phase 1: Greedy nearest-neighbor from each possible starting activity
  const buildGreedyFromFirst = (firstIndex: number): TripItem[] => {
    const ordered: TripItem[] = [];
    const remaining = [...activities];
    const first = remaining.splice(firstIndex, 1)[0];
    ordered.push(first);

    let curLat = first.latitude;
    let curLng = first.longitude;
    while (remaining.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = calculateDistance(curLat, curLng, remaining[i].latitude, remaining[i].longitude);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      const next = remaining.splice(nearestIdx, 1)[0];
      ordered.push(next);
      curLat = next.latitude;
      curLng = next.longitude;
    }
    return ordered;
  };

  let bestRoute: TripItem[] = [];
  let bestCost = Infinity;
  for (let i = 0; i < activities.length; i++) {
    const candidate = buildGreedyFromFirst(i);
    const candidateCost = routeCost(candidate);
    if (candidateCost < bestCost) {
      bestCost = candidateCost;
      bestRoute = candidate;
    }
  }

  // Phase 2: 2-opt local search
  let improved = true;
  let route = [...bestRoute];
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 2; i++) {
      for (let k = i + 1; k < route.length - 1; k++) {
        const nextRoute = [
          ...route.slice(0, i + 1),
          ...route.slice(i + 1, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const nextCost = routeCost(nextRoute);
        if (nextCost + 0.01 < bestCost) {
          route = nextRoute;
          bestCost = nextCost;
          improved = true;
        }
      }
    }
  }

  // Log improvement
  const originalCost = routeCost(activities);
  if (bestCost < originalCost - 0.1) {
    const saved = originalCost - bestCost;
    console.log(`[Geo-Reorder] Improved route by ${saved.toFixed(1)}km (${originalCost.toFixed(1)}km → ${bestCost.toFixed(1)}km) for ${activities.length} activities`);
  }

  // Reassign orderIndex based on new geographic order
  for (let i = 0; i < route.length; i++) {
    route[i].orderIndex = i;
  }

  // Rebuild items list: anchors + reordered activities
  return [...anchors, ...route];
}

/**
 * Post-scheduler geographic reorder for a single scheduled day.
 *
 * Unlike geoReorderDayItems() which works on unscheduled items,
 * this function works on ALREADY SCHEDULED items with fixed time slots.
 *
 * Algorithm:
 * 1. Extract all activity-type items (not restaurants, transport, checkin, etc.)
 * 2. Find the optimal geographic order via greedy NN + 2-opt
 * 3. Swap the time slots: activity N in optimal order gets the time slot of activity N in original order
 * 4. Re-sort all items by startTime to rebuild the correct timeline
 *
 * This preserves restaurant slots (lunch at 12:30, dinner at 20:00) while
 * eliminating zigzag patterns in the activity ordering.
 */
export function geoReorderScheduledDay(
  items: TripItem[],
  hotelLat?: number,
  hotelLng?: number,
): TripItem[] {
  // Extract only activities with valid coords
  const activities = items.filter(
    (it) =>
      it.type === 'activity' &&
      it.latitude && it.longitude &&
      it.latitude !== 0 && it.longitude !== 0
  );

  if (activities.length <= 2) return items; // Nothing to optimize

  // Save original time slots in order
  const originalSlots = activities
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((a) => ({
      startTime: a.startTime,
      endTime: a.endTime,
      orderIndex: a.orderIndex,
    }));

  // Find optimal geographic order using greedy NN + 2-opt
  const dist = (a: TripItem, b: TripItem): number =>
    calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);

  // Greedy nearest-neighbor from all starting points
  const buildGreedy = (startIdx: number): TripItem[] => {
    const remaining = [...activities];
    const route: TripItem[] = [remaining.splice(startIdx, 1)[0]];
    while (remaining.length > 0) {
      const last = route[route.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = dist(last, remaining[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      route.push(remaining.splice(bestIdx, 1)[0]);
    }
    return route;
  };

  const routeCost = (route: TripItem[]): number => {
    let total = 0;
    // Start from hotel if available
    if (hotelLat && hotelLng && route.length > 0) {
      total += calculateDistance(hotelLat, hotelLng, route[0].latitude, route[0].longitude);
    }
    for (let i = 0; i < route.length - 1; i++) {
      total += dist(route[i], route[i + 1]);
    }
    return total;
  };

  // Try all starting points
  let bestRoute: TripItem[] = [];
  let bestCost = Infinity;
  for (let i = 0; i < activities.length; i++) {
    const candidate = buildGreedy(i);
    const cost = routeCost(candidate);
    if (cost < bestCost) {
      bestCost = cost;
      bestRoute = candidate;
    }
  }

  // 2-opt improvement
  let improved = true;
  let route = [...bestRoute];
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 2; i++) {
      for (let k = i + 1; k < route.length - 1; k++) {
        const nextRoute = [
          ...route.slice(0, i + 1),
          ...route.slice(i + 1, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const nextCost = routeCost(nextRoute);
        if (nextCost + 0.01 < bestCost) {
          route = nextRoute;
          bestCost = nextCost;
          improved = true;
        }
      }
    }
  }

  // Swap time slots: optimized activity i gets the time slot of original activity i
  const originalCost = routeCost(activities.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  for (let i = 0; i < route.length; i++) {
    route[i].startTime = originalSlots[i].startTime;
    route[i].endTime = originalSlots[i].endTime;
    route[i].orderIndex = originalSlots[i].orderIndex;
  }

  if (bestCost < originalCost - 0.1) {
    const saved = originalCost - bestCost;
    console.log(`[Geo-Reorder-Post] Day optimized: saved ${saved.toFixed(1)}km (${originalCost.toFixed(1)}km → ${bestCost.toFixed(1)}km) for ${activities.length} activities`);
  }

  // Re-sort all items by startTime
  return items.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

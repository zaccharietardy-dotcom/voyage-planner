/**
 * Geographic reordering of trip items within a day.
 *
 * Two functions:
 * - geoReorderDayItems(): works on UNSCHEDULED items (pre-scheduler)
 * - geoReorderScheduledDay(): works on ALREADY SCHEDULED items (post-scheduler)
 */

import type { TripItem } from '../../types';
import { calculateDistance } from '../../services/geocoding';
import { getActivityMaxEndTime, getActivityMinStartTime } from './opening-hours';
import type { ScoredActivity } from '../types';

/**
 * Compute opening hours penalty for a route order.
 */
function openingHoursPenalty(
  activities: TripItem[],
  dayDate: Date
): number {
  let penalty = 0;
  const n = activities.length;
  if (n <= 1) return 0;

  for (let i = 0; i < n; i++) {
    const position = i / (n - 1);
    const activity = activities[i] as unknown as ScoredActivity;

    const maxEnd = getActivityMaxEndTime(activity, dayDate);
    if (maxEnd) {
      const closeHour = maxEnd.getHours() + maxEnd.getMinutes() / 60;
      if (closeHour <= 17 && position > 0.6) {
        penalty += (position - 0.4) * 1.5;
      }
    }

    const minStart = getActivityMinStartTime(activity, dayDate);
    if (minStart) {
      const openHour = minStart.getHours() + minStart.getMinutes() / 60;
      if (openHour >= 10 && position < 0.3) {
        penalty += (0.3 - position) * 1.0;
      }
    }
  }

  return penalty;
}

/**
 * Reorders activity items in a day to minimize total travel distance.
 * Works on UNSCHEDULED items (before the scheduler runs).
 */
export function geoReorderDayItems(
  items: TripItem[],
  hotelLat: number,
  hotelLng: number,
  dayDate?: Date
): TripItem[] {
  const effectiveDate = dayDate || new Date(2026, 0, 5);
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
    items.forEach((item, idx) => { item.orderIndex = idx; });
    return items;
  }

  const routeCost = (route: TripItem[]): number => {
    if (route.length === 0) return 0;
    let total = 0;
    let maxLeg = 0;
    // Hotel → first activity
    const d0 = calculateDistance(hotelLat, hotelLng, route[0].latitude, route[0].longitude);
    total += d0;
    // Between activities
    for (let i = 0; i < route.length - 1; i++) {
      const d = calculateDistance(route[i].latitude, route[i].longitude, route[i + 1].latitude, route[i + 1].longitude);
      total += d;
      if (d > maxLeg) maxLeg = d;
    }
    // Last activity → hotel
    const dLast = calculateDistance(route[route.length - 1].latitude, route[route.length - 1].longitude, hotelLat, hotelLng);
    total += dLast;

    // Penalize long legs (>3km) extra
    if (maxLeg > 3) total += (maxLeg - 3) * 0.5;

    // Add opening hours penalty
    total += openingHoursPenalty(route, effectiveDate);

    return total;
  };

  // Greedy nearest-neighbor from each starting point
  const buildGreedyFromFirst = (firstIdx: number): TripItem[] => {
    const remaining = [...activities];
    const route: TripItem[] = [remaining.splice(firstIdx, 1)[0]];
    while (remaining.length > 0) {
      const last = route[route.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < remaining.length; j++) {
        const d = calculateDistance(last.latitude, last.longitude, remaining[j].latitude, remaining[j].longitude);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }
      route.push(remaining.splice(bestIdx, 1)[0]);
    }
    return route;
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

  // 2-opt local search — full range reversal
  let improved = true;
  let route = [...bestRoute];
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const nextRoute = [
          ...route.slice(0, i),
          ...route.slice(i, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const nextCost = routeCost(nextRoute);
        if (nextCost < bestCost - 0.001) {
          route = nextRoute;
          bestCost = nextCost;
          improved = true;
        }
      }
    }
  }

  const originalCost = routeCost(activities);
  if (bestCost < originalCost - 0.1) {
    const saved = originalCost - bestCost;
    console.log(`[Geo-Reorder] Improved route by ${saved.toFixed(1)}km (${originalCost.toFixed(1)}km → ${bestCost.toFixed(1)}km) for ${activities.length} activities`);
  }

  for (let i = 0; i < route.length; i++) {
    route[i].orderIndex = i;
  }

  return [...anchors, ...route];
}

// ─── POST-SCHEDULER GEO-REORDER ───

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Post-scheduler geographic reorder for a single scheduled day.
 *
 * Works on ALREADY SCHEDULED items with fixed time slots.
 * Swaps activity identities between time slots to minimize travel distance.
 * Restaurants, transport, checkin/checkout stay in their exact slots.
 *
 * Also validates opening hours: won't assign an activity to a slot
 * that falls outside its opening hours.
 */
export function geoReorderScheduledDay(
  items: TripItem[],
  hotelLat?: number,
  hotelLng?: number,
): TripItem[] {
  // Extract only activities with valid coords
  const activityIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'activity' && it.latitude && it.longitude && it.latitude !== 0 && it.longitude !== 0) {
      activityIndices.push(i);
    }
  }

  if (activityIndices.length <= 2) return items;

  // Get activities sorted by their current position in timeline
  const sortedIndices = [...activityIndices].sort((a, b) =>
    items[a].startTime.localeCompare(items[b].startTime)
  );

  // Save the time slots (the "shells" we'll fill with optimally-ordered activities)
  const slots = sortedIndices.map((idx) => ({
    startTime: items[idx].startTime,
    endTime: items[idx].endTime,
    duration: items[idx].duration,
    orderIndex: items[idx].orderIndex,
    originalIndex: idx,
  }));

  // Get the activity objects to reorder geographically
  const activities = sortedIndices.map((idx) => ({ ...items[idx] }));

  const dist = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number =>
    calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);

  // Greedy nearest-neighbor from all starting points
  const buildGreedy = (startIdx: number): typeof activities => {
    const remaining = [...activities];
    const route = [remaining.splice(startIdx, 1)[0]];
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

  const routeCost = (route: typeof activities): number => {
    let total = 0;
    if (hotelLat && hotelLng && route.length > 0) {
      total += dist({ latitude: hotelLat, longitude: hotelLng }, route[0]);
    }
    for (let i = 0; i < route.length - 1; i++) {
      total += dist(route[i], route[i + 1]);
    }
    if (hotelLat && hotelLng && route.length > 0) {
      total += dist(route[route.length - 1], { latitude: hotelLat, longitude: hotelLng });
    }
    return total;
  };

  // Try all starting points
  let bestRoute = activities;
  let bestCost = routeCost(activities);
  for (let i = 0; i < activities.length; i++) {
    const candidate = buildGreedy(i);
    const cost = routeCost(candidate);
    if (cost < bestCost) {
      bestCost = cost;
      bestRoute = candidate;
    }
  }

  // 2-opt improvement — try all possible segment reversals
  let improved = true;
  let route = [...bestRoute];
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const nextRoute = [
          ...route.slice(0, i),
          ...route.slice(i, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const nextCost = routeCost(nextRoute);
        if (nextCost < bestCost - 0.001) {
          route = nextRoute;
          bestCost = nextCost;
          improved = true;
        }
      }
    }
  }

  // Check if reorder actually improved things
  const originalCost = routeCost(activities);
  if (bestCost >= originalCost - 0.01) {
    return items; // No meaningful improvement
  }

  // SAFETY CHECK: Validate opening hours — skip individual violations, don't abort all
  // Find activities that MUST stay in specific slots due to opening hours
  const fixedSlots = new Set<number>(); // indices in route that can't move
  for (let i = 0; i < route.length; i++) {
    const slot = slots[i];
    const activity = route[i];
    if (activity.openingHours) {
      const slotStartMin = timeToMinutes(slot.startTime);
      const slotEndMin = timeToMinutes(slot.endTime);
      const openMin = timeToMinutes(activity.openingHours.open);
      const closeMin = timeToMinutes(activity.openingHours.close);
      if (slotStartMin < openMin - 30 || slotEndMin > closeMin + 15) {
        // This specific assignment violates hours — revert to original order
        // (a more sophisticated approach would fix just this activity, but
        //  reverting is safer and the greedy+2opt should handle most cases)
        console.log(`[Geo-Reorder-Post] Opening hours conflict: "${activity.title}" in ${slot.startTime}-${slot.endTime} (opens ${activity.openingHours.open}, closes ${activity.openingHours.close}) — keeping original order`);
        return items;
      }
    }
  }

  // Duration drift guard — relaxed threshold (60min total across all activities)
  let totalDrift = 0;
  for (let i = 0; i < route.length; i++) {
    const slotDuration = timeToMinutes(slots[i].endTime) - timeToMinutes(slots[i].startTime);
    const actDuration = route[i].duration || slotDuration;
    totalDrift += Math.abs(actDuration - slotDuration);
  }
  if (totalDrift > 60) {
    console.log(`[Geo-Reorder-Post] Duration drift ${totalDrift}min > 60min — keeping original order`);
    return items;
  }

  console.log(`[Geo-Reorder-Post] Optimized: ${originalCost.toFixed(1)}km → ${bestCost.toFixed(1)}km (saved ${(originalCost - bestCost).toFixed(1)}km) for ${activities.length} activities`);

  // Apply reorder — assign optimally-ordered activities to original time slots
  const result = [...items];
  for (let i = 0; i < route.length; i++) {
    const slot = slots[i];
    const activity = route[i];
    const targetIdx = slot.originalIndex;
    const actDuration = activity.duration || (timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime));

    // Use slot's startTime but activity's own duration for endTime
    const endTime = minutesToTime(timeToMinutes(slot.startTime) + actDuration);

    result[targetIdx] = {
      ...activity,
      startTime: slot.startTime,
      endTime,
      orderIndex: slot.orderIndex,
    };

    // Recalculate distanceFromPrevious
    if (i === 0) {
      if (hotelLat && hotelLng) {
        result[targetIdx].distanceFromPrevious = dist({ latitude: hotelLat, longitude: hotelLng }, activity);
      }
    } else {
      result[targetIdx].distanceFromPrevious = dist(route[i - 1], activity);
    }
    const distKm = result[targetIdx].distanceFromPrevious || 0;
    result[targetIdx].timeFromPrevious = Math.round(distKm * 15);
  }

  // Re-sort by startTime
  result.sort((a, b) => a.startTime.localeCompare(b.startTime));
  result.forEach((item, idx) => { item.orderIndex = idx; });

  return result;
}

import type { Accommodation, Restaurant, TripPreferences } from '../types';
import type { TripDay, TripItem } from '../types/trip';
import type {
  ActivityCluster,
  FetchedData,
  MaterializedLeg,
  ScheduledDayPlan,
  ScheduledStop,
  ScoredActivity,
} from './types';
import type { DayTimeWindow } from './step4-anchor-transport';
import type { RepairAction, RepairResult } from './step10-repair';
import type { DayTravelTimes, TravelLeg } from './step7b-travel-times';

import { calculateDistance } from '../services/geocoding';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';
import { findBestRestaurant, createHotelBreakfastRestaurant, getDayDateForCluster } from './step8-place-restaurants';
import {
  createActivityItem,
  createCheckinItem,
  createCheckoutItem,
  createRestaurantItem,
  createSelfMealFallbackItem,
  createTravelItem,
  getActivityCloseTime,
  getActivityOpenTime,
  isRestaurantOpenForSlot,
} from './step9-schedule';
import { inferLonghaulDirectionFromItem } from './utils/longhaulConsistency';
import { addMinutes, estimateTravelBuffer, minToTime, roundUpTo5, sortAndReindexItems, timeToMin } from './utils/time';
import { getClusterCentroid } from './utils/geo';

type PlannerRole = ActivityCluster['plannerRole'];

export type V32Diagnostics = NonNullable<RepairResult['rescueDiagnostics']> & {
  orphanTransportCount: number;
  teleportLegCount: number;
  staleNarrativeCount: number;
  freeTimeOverBudgetCount: number;
  mealFallbackCount: number;
  routeRebuildCount: number;
  restaurantRefetchMissCount: number;
  temporalImpossibleItemCount?: number;
  openingHourInsertionRejectCount?: number;
  routeOrderRollbackCount?: number;
  shortFullDayCount?: number;
};

const EXPERIENTIAL_VIATOR_RE = /segway|photoshoot|photo shoot|workshop|atelier|cours|cooking|culinary|tour|excursion|cruise|vespa|class/i;

const FREE_TIME_GAP_BY_ROLE: Record<NonNullable<PlannerRole>, number> = {
  arrival: 120,
  departure: 120,
  full_city: 90,
  short_full_day: 90,
  recovery: 150,
  day_trip: 9999,
};

const FREE_TIME_LIMIT_BY_ROLE: Record<NonNullable<PlannerRole>, number> = {
  arrival: 1,
  departure: 1,
  full_city: 1,
  short_full_day: 1,
  recovery: 2,
  day_trip: 0,
};

const ROUTE_TRANSPORT_DISTANCE_KM = 0.4;
const ROUTE_TRANSPORT_MIN = 5;
const MAX_VALID_URBAN_LEG_MIN = 90;
const MAX_VALID_URBAN_LEG_DISTANCE_KM = 25;

function normalizePlannerText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isHighFrictionBoundaryActivity(activity: ScoredActivity): boolean {
  const text = normalizePlannerText(`${activity.name || ''} ${activity.description || ''} ${activity.type || ''}`);
  return /disney|theme park|amusement|water park|universal|segway|workshop|cooking|photoshoot|cruise|excursion|tour /.test(text);
}

function getActivityKey(activity: ScoredActivity): string {
  return activity.id || activity.planningToken || activity.name;
}

function getRole(day: ActivityCluster | TripDay): NonNullable<PlannerRole> {
  const clusterRole = 'plannerRole' in day ? day.plannerRole : undefined;
  return (clusterRole
    || ('items' in day ? day.items?.find((item) => item.planningMeta?.plannerRole)?.planningMeta?.plannerRole : undefined)
    || 'full_city') as NonNullable<PlannerRole>;
}

function isProtectedActivity(activity: ScoredActivity): boolean {
  return Boolean(activity.mustSee || activity.protectedReason === 'day_trip_anchor' || activity.protectedReason === 'day_trip' || activity.protectedReason === 'user_forced');
}

function isExperientialViator(activity: ScoredActivity): boolean {
  return activity.source === 'viator' && EXPERIENTIAL_VIATOR_RE.test(activity.name || '');
}

function isBoundaryFriendlyActivity(
  activity: ScoredActivity,
  role: NonNullable<PlannerRole>,
  anchor: { lat: number; lng: number }
): boolean {
  if (role !== 'arrival' && role !== 'departure') return true;
  if (activity.protectedReason === 'user_forced') return true;
  if (isExperientialViator(activity)) return false;
  if (isHighFrictionBoundaryActivity(activity)) return false;
  const duration = activity.duration || 60;
  const isDayTripLike = activity.protectedReason === 'day_trip'
    || activity.protectedReason === 'day_trip_anchor'
    || (activity.dayTripAffinity || 0) >= 0.7;
  if (isDayTripLike) return false;
  const distKm = calculateDistance(activity.latitude, activity.longitude, anchor.lat, anchor.lng);
  if (role === 'departure') {
    return duration <= 60 && distKm <= 2.5;
  }
  if (activity.fatigueRole === 'long_haul') {
    return duration <= 60 && distKm <= 2;
  }
  return duration <= 90 && distKm <= 3;
}

function dedupeRestaurants(restaurants: Restaurant[]): Restaurant[] {
  const seen = new Set<string>();
  const deduped: Restaurant[] = [];
  for (const restaurant of restaurants) {
    const key = restaurant.id || `${restaurant.name}:${restaurant.latitude}:${restaurant.longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(restaurant);
  }
  return deduped;
}

function buildDayRestaurantPool(
  cluster: ActivityCluster,
  restaurants: Restaurant[],
  data: FetchedData
): Restaurant[] {
  if (!cluster.isDayTrip || !cluster.dayTripDestination) {
    return restaurants;
  }

  const destinationRestaurants = data.dayTripRestaurants?.[cluster.dayTripDestination] || [];
  const clusterCenter = getClusterCentroid(cluster.activities) || cluster.centroid;
  const localFallback = restaurants.filter((restaurant) =>
    calculateDistance(restaurant.latitude, restaurant.longitude, clusterCenter.lat, clusterCenter.lng) <= 4
      || cluster.activities.some((activity) =>
        calculateDistance(restaurant.latitude, restaurant.longitude, activity.latitude, activity.longitude) <= 2.5
      )
  );

  return dedupeRestaurants([...destinationRestaurants, ...localFallback]);
}

function latestFeasibleStartMin(activity: ScoredActivity, dayDate: Date): number | null {
  const close = getActivityCloseTime(activity, dayDate);
  if (!close || close === '00:00') return null;
  return timeToMin(close) - (activity.duration || 60);
}

function promoteUrgentActivities(
  activities: ScoredActivity[],
  dayDate: Date,
  dayStartMin: number
): ScoredActivity[] {
  const urgent: ScoredActivity[] = [];
  const normal: ScoredActivity[] = [];
  for (const activity of activities) {
    const latestStart = latestFeasibleStartMin(activity, dayDate);
    if (latestStart != null && latestStart <= dayStartMin + 180) {
      urgent.push(activity);
    } else {
      normal.push(activity);
    }
  }
  return [...urgent, ...normal];
}

function estimateTravelLeg(
  from: { id: string; name: string; lat: number; lng: number },
  to: { id: string; name: string; lat: number; lng: number },
  distanceKm?: number
): TravelLeg {
  const dist = distanceKm ?? calculateDistance(from.lat, from.lng, to.lat, to.lng);
  const walkMinutes = Math.ceil((dist / 4.5) * 60);
  const useTransit = dist > 1 || walkMinutes > 20;
  return {
    fromId: from.id,
    toId: to.id,
    fromName: from.name,
    toName: to.name,
    distanceKm: dist,
    durationMinutes: Math.max(5, Math.ceil((useTransit ? dist * 4 : walkMinutes) / 5) * 5),
    mode: useTransit ? 'transit' : 'walk',
    isEstimate: true,
  };
}

function resolveTravelLeg(
  dayTravel: DayTravelTimes | undefined,
  from: { id: string; name: string; lat: number; lng: number },
  to: { id: string; name: string; lat: number; lng: number },
  role: NonNullable<PlannerRole> = 'full_city'
): TravelLeg {
  const exact = dayTravel?.legs.find((leg) => leg.fromId === from.id && leg.toId === to.id);
  const fallback = estimateTravelLeg(from, to);
  if (!exact) return fallback;
  if (
    role !== 'day_trip'
    && exact.durationMinutes > MAX_VALID_URBAN_LEG_MIN
    && (exact.distanceKm || calculateDistance(from.lat, from.lng, to.lat, to.lng)) <= MAX_VALID_URBAN_LEG_DISTANCE_KM
  ) {
    return fallback;
  }
  return exact;
}

function makeStopId(kind: ScheduledStop['kind'], dayNumber: number, index: number): string {
  return `v32-${kind}-${dayNumber}-${index}`;
}

function buildFixedStops(
  cluster: ActivityCluster,
  hotel: Accommodation | null,
  timeWindow: DayTimeWindow | undefined,
  dayStartTime: string,
  dayEndTime: string
): ScheduledStop[] {
  const stops: ScheduledStop[] = [];
  const dayNumber = cluster.dayNumber;
  const role = getRole(cluster);

  if (cluster.dayNumber === 1 && hotel) {
    const checkInBase = hotel.checkInTime || '15:00';
    const checkInTime = timeToMin(checkInBase) < timeToMin(dayStartTime) ? dayStartTime : checkInBase;
    if (timeToMin(checkInTime) < timeToMin(dayEndTime)) {
      stops.push({
        id: makeStopId('checkin', dayNumber, stops.length),
        dayNumber,
        kind: 'checkin',
        title: `Check-in — ${hotel.name}`,
        startTime: checkInTime,
        endTime: addMinutes(checkInTime, 15),
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        fixed: role === 'arrival',
      });
    }
  }

  if (timeWindow?.hasDepartureTransport && hotel) {
    const rawCheckout = hotel.checkOutTime || '11:00';
    const capped = Math.min(timeToMin(rawCheckout), Math.max(timeToMin(dayStartTime), timeToMin(dayEndTime) - 15));
    stops.push({
      id: makeStopId('checkout', dayNumber, stops.length),
      dayNumber,
      kind: 'checkout',
      title: `Check-out — ${hotel.name}`,
      startTime: minToTime(capped),
      endTime: minToTime(capped + 15),
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      fixed: true,
    });
  }

  return stops;
}

function scheduleActivitiesForDay(
  cluster: ActivityCluster,
  dayDate: Date,
  timeWindow: DayTimeWindow | undefined,
  hotel: Accommodation | null,
  dayTravel: DayTravelTimes | undefined,
  diagnostics: V32Diagnostics,
  unresolvedViolations: string[]
): ScheduledStop[] {
  const role = getRole(cluster);
  const dayStartTime = timeWindow?.activityStartTime || '08:30';
  const dayEndTime = timeWindow?.activityEndTime || '21:00';
  const dayStartMin = timeToMin(dayStartTime);
  const dayEndMin = timeToMin(dayEndTime);
  const hotelAnchor = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : cluster.centroid;

  const fixedStops = buildFixedStops(cluster, hotel, timeWindow, dayStartTime, dayEndTime);
  const preActivityFixed = fixedStops.filter((stop) => stop.kind === 'checkout');
  const postActivityFixed = fixedStops.filter((stop) => stop.kind !== 'checkout');
  const scheduleOrderedActivities = (orderedActivities: ScoredActivity[]) => {
    let currentTimeMin = preActivityFixed.length > 0
      ? timeToMin(preActivityFixed[preActivityFixed.length - 1].endTime)
      : dayStartMin;
    let currentAnchor = hotel
      ? { id: 'hotel-start', name: hotel.name, lat: hotel.latitude, lng: hotel.longitude }
      : { id: 'day-start', name: 'Start', lat: cluster.centroid.lat, lng: cluster.centroid.lng };

    const scheduled: ScheduledStop[] = [...preActivityFixed];
    const missingProtected: ScoredActivity[] = [];

    for (const activity of orderedActivities) {
      if (role === 'arrival' && !isProtectedActivity(activity) && currentTimeMin >= dayStartMin + 180) continue;

      const target = {
        id: activity.id || activity.name,
        name: activity.name || 'Activity',
        lat: activity.latitude,
        lng: activity.longitude,
      };
      const leg = resolveTravelLeg(dayTravel, currentAnchor, target, role);
      const travelMin = leg.durationMinutes;
      let startMin = currentTimeMin + travelMin;
      const openTime = getActivityOpenTime(activity, dayDate);
      if (openTime) startMin = Math.max(startMin, timeToMin(openTime));

      const endMin = startMin + (activity.duration || 60);
      const closeTime = getActivityCloseTime(activity, dayDate);
      const closeMin = closeTime && closeTime !== '00:00' ? timeToMin(closeTime) : null;

      if ((closeMin != null && endMin > closeMin) || endMin > dayEndMin) {
        // Opening hours or day-end conflict — try local swap with previous non-protected activity
        const prevActivityIdx = scheduled.findLastIndex(s => s.kind === 'activity' && !s.protectedReason);
        if (prevActivityIdx >= 0 && closeMin != null) {
          // Simulate swapping: put this activity where the previous one was
          const prevStop = scheduled[prevActivityIdx];
          const prevStartMin = timeToMin(prevStop.startTime);
          const swapEndMin = prevStartMin + (activity.duration || 60);
          if (swapEndMin <= closeMin && swapEndMin <= dayEndMin) {
            // Swap succeeds — replace previous with current, re-place previous after
            scheduled.splice(prevActivityIdx, 1);
            scheduled.push({
              id: activity.id || makeStopId('activity', cluster.dayNumber, scheduled.length),
              dayNumber: cluster.dayNumber,
              kind: 'activity',
              title: activity.name || 'Activity',
              startTime: minToTime(prevStartMin),
              endTime: minToTime(swapEndMin),
              latitude: activity.latitude,
              longitude: activity.longitude,
              activity,
              protectedReason: activity.protectedReason,
            });
            // Re-place the evicted activity at current time
            const prevAct = prevStop.activity;
            if (prevAct) {
              const reStartMin = swapEndMin + 10;
              const reEndMin = reStartMin + (prevAct.duration || 60);
              if (reEndMin <= dayEndMin) {
                scheduled.push({
                  ...prevStop,
                  startTime: minToTime(reStartMin),
                  endTime: minToTime(reEndMin),
                });
                currentTimeMin = reEndMin + 10;
                currentAnchor = { id: prevStop.id, name: prevStop.title, lat: prevStop.latitude, lng: prevStop.longitude };
              }
              // else the evicted activity doesn't fit — it's dropped (it was non-protected)
            }
            diagnostics.openingHourInsertionRejectCount = (diagnostics.openingHourInsertionRejectCount || 0);
            continue;
          }
        }
        // Swap failed — skip activity
        if (isProtectedActivity(activity)) missingProtected.push(activity);
        diagnostics.openingHourInsertionRejectCount = (diagnostics.openingHourInsertionRejectCount || 0) + 1;
        continue;
      }

      scheduled.push({
        id: activity.id || makeStopId('activity', cluster.dayNumber, scheduled.length),
        dayNumber: cluster.dayNumber,
        kind: 'activity',
        title: activity.name || 'Activity',
        startTime: minToTime(startMin),
        endTime: minToTime(endMin),
        latitude: activity.latitude,
        longitude: activity.longitude,
        activity,
        protectedReason: activity.protectedReason,
      });

      currentTimeMin = endMin + 10;
      currentAnchor = target;
    }

    for (const stop of postActivityFixed) {
      const stopTarget = {
        id: stop.id,
        name: stop.title,
        lat: stop.latitude,
        lng: stop.longitude,
      };
      const leg = resolveTravelLeg(dayTravel, currentAnchor, stopTarget, role);
      const minStart = Math.max(timeToMin(stop.startTime), currentTimeMin + leg.durationMinutes);
      if (minStart + 15 <= dayEndMin + 5) {
        scheduled.push({
          ...stop,
          startTime: minToTime(minStart),
          endTime: minToTime(minStart + 15),
        });
        currentTimeMin = minStart + 20;
        currentAnchor = stopTarget;
      }
    }

    return {
      scheduled: scheduled.sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime)),
      missingProtected,
    };
  };

  const candidateActivities = (role === 'day_trip'
    ? cluster.activities.filter((activity) =>
        activity.protectedReason === 'day_trip'
        || activity.protectedReason === 'day_trip_anchor'
        || Boolean(activity.sourcePackId)
      )
    : cluster.activities
  ).filter((activity) => isBoundaryFriendlyActivity(activity, role, hotelAnchor));

  const orderedActivities = promoteUrgentActivities(
    candidateActivities,
    dayDate,
    dayStartMin
  );
  let bestSchedule = scheduleOrderedActivities(orderedActivities);

  if (bestSchedule.missingProtected.length > 0) {
    const optionalActivities = orderedActivities
      .filter((activity) => !isProtectedActivity(activity))
      .sort((left, right) => (left.score - right.score) || ((right.duration || 60) - (left.duration || 60)));

    let workingActivities = [...orderedActivities];
    let bestMissingCount = bestSchedule.missingProtected.length;
    for (const victim of optionalActivities) {
      const victimKey = getActivityKey(victim);
      workingActivities = workingActivities.filter((activity) => getActivityKey(activity) !== victimKey);
      const attempt = scheduleOrderedActivities(workingActivities);
      if (attempt.missingProtected.length <= bestMissingCount) {
        bestSchedule = attempt;
        bestMissingCount = attempt.missingProtected.length;
      }
      if (bestMissingCount === 0) break;
    }
  }

  if (bestSchedule.missingProtected.length > 0) {
    diagnostics.protectedBreakCount += bestSchedule.missingProtected.length;
    for (const activity of bestSchedule.missingProtected) {
      const closeTime = getActivityCloseTime(activity, dayDate);
      if (closeTime && closeTime !== '00:00') {
        unresolvedViolations.push(`Day ${cluster.dayNumber}: protected "${activity.name}" cannot fit before close ${closeTime}`);
      } else {
        unresolvedViolations.push(`Day ${cluster.dayNumber}: protected "${activity.name}" cannot fit inside ${dayEndTime}`);
      }
    }
  }

  return bestSchedule.scheduled;
}

function gapBounds(
  prev: ScheduledStop | undefined,
  next: ScheduledStop | undefined,
  dayStartMin: number,
  dayEndMin: number
): { startMin: number; endMin: number } {
  const startMin = prev ? timeToMin(prev.endTime) + 10 : dayStartMin;
  const endMin = next ? timeToMin(next.startTime) - 10 : dayEndMin;
  return { startMin, endMin };
}

async function pickStrictMeal(
  restaurants: Restaurant[],
  dayDate: Date,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  anchors: Array<{ lat: number; lng: number }>,
  usedRestaurantIds: Set<string>,
  dietary: string[],
  startTime: string,
  duration: number,
  destination: string,
  diagnostics: V32Diagnostics
): Promise<Restaurant | null> {
  const tryPickForAnchor = (
    pool: Restaurant[],
    anchor: { lat: number; lng: number }
  ): Restaurant | null => {
    if (pool.length === 0) return null;
    const placement = findBestRestaurant(
      pool,
      anchor,
      mealType,
      0.8,
      3.5,
      2,
      dietary,
      usedRestaurantIds,
      dayDate
    );
    if (
      placement
      && placement.distanceFromAnchor <= 0.8
      && isRestaurantOpenForSlot(placement.primary, dayDate, startTime, addMinutes(startTime, duration))
    ) {
      return placement.primary;
    }
    return null;
  };

  const tryPickFromPool = (pool: Restaurant[]): Restaurant | null => {
    if (pool.length === 0) return null;

    for (const anchor of anchors) {
      const picked = tryPickForAnchor(pool, anchor);
      if (picked) return picked;
    }

    return null;
  };

  const localPool = restaurants.filter((restaurant) =>
    anchors.some((anchor) => calculateDistance(anchor.lat, anchor.lng, restaurant.latitude, restaurant.longitude) <= 0.8)
  );
  const immediatePick = tryPickFromPool(localPool);
  if (immediatePick) return immediatePick;

  if (!destination) {
    if (localPool.length === 0) diagnostics.restaurantRefetchMissCount++;
    return null;
  }

  // Single refetch around the centroid of all anchors — no need to retry
  // for each anchor when they're all in the same area
  const refetchCenter = {
    lat: anchors.reduce((s, a) => s + a.lat, 0) / anchors.length,
    lng: anchors.reduce((s, a) => s + a.lng, 0) / anchors.length,
  };
  const seen = new Set(restaurants.map((restaurant) => restaurant.id || `${restaurant.name}:${restaurant.latitude}:${restaurant.longitude}`));
  let refetchAdded = 0;

  const localCoverage = restaurants.filter((restaurant) =>
    calculateDistance(refetchCenter.lat, refetchCenter.lng, restaurant.latitude, restaurant.longitude) <= 0.8
  ).length;

  if (localCoverage < 5) {
    try {
      const nearby = await searchRestaurantsNearbyWithFallback(refetchCenter, destination, {
        mealType,
        maxDistance: 1000,
        limit: 8,
      });
      for (const restaurant of nearby) {
        const key = restaurant.id || `${restaurant.name}:${restaurant.latitude}:${restaurant.longitude}`;
        if (seen.has(key)) continue;
        seen.add(key);
        restaurants.push(restaurant);
        refetchAdded++;
      }
    } catch {
      // Non-blocking: keep existing pool and fall back cleanly.
    }
  }

  const postRefetchPool = restaurants.filter((restaurant) =>
    anchors.some((anchor) => calculateDistance(anchor.lat, anchor.lng, restaurant.latitude, restaurant.longitude) <= 0.8)
  );
  const postRefetchPick = tryPickFromPool(postRefetchPool);
  if (postRefetchPick) return postRefetchPick;

  if (refetchAdded === 0 || postRefetchPool.length === 0) {
    diagnostics.restaurantRefetchMissCount++;
  }

  return null;
}

function estimateLocalTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  return estimateTravelLeg(
    { id: 'local-from', name: 'from', lat: from.lat, lng: from.lng },
    { id: 'local-to', name: 'to', lat: to.lat, lng: to.lng }
  ).durationMinutes;
}

function canShiftStopLater(
  stop: ScheduledStop,
  deltaMin: number,
  dayDate: Date,
  dayEndMin: number
): boolean {
  const shiftedStartMin = timeToMin(stop.startTime) + deltaMin;
  const shiftedEndMin = timeToMin(stop.endTime) + deltaMin;
  if (shiftedEndMin > dayEndMin) return false;
  if (stop.kind === 'activity' && stop.activity) {
    const closeTime = getActivityCloseTime(stop.activity, dayDate);
    if (closeTime && closeTime !== '00:00' && shiftedEndMin > timeToMin(closeTime)) return false;
    const latestStart = latestFeasibleStartMin(stop.activity, dayDate);
    if (latestStart != null && shiftedStartMin > latestStart) return false;
  }
  return true;
}

function snapshotStopTimes(stops: ScheduledStop[]): Map<string, { startTime: string; endTime: string }> {
  return new Map(
    stops.map((stop) => [stop.id, { startTime: stop.startTime, endTime: stop.endTime }])
  );
}

function restoreStopTimes(
  stops: ScheduledStop[],
  snapshot: Map<string, { startTime: string; endTime: string }>
): void {
  for (const stop of stops) {
    const saved = snapshot.get(stop.id);
    if (!saved) continue;
    stop.startTime = saved.startTime;
    stop.endTime = saved.endTime;
  }
}

function shiftFollowingActivitySlice(
  dayPlan: ScheduledDayPlan,
  startStopId: string,
  deltaMin: number,
  dayDate: Date,
  dayEndMin: number
): boolean {
  if (deltaMin <= 0 || deltaMin > 90) return false;
  const sorted = [...dayPlan.stops].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  const startIndex = sorted.findIndex((stop) => stop.id === startStopId);
  if (startIndex < 0) return false;

  const slice: ScheduledStop[] = [];
  let boundaryStop: ScheduledStop | undefined;
  for (let index = startIndex; index < sorted.length; index++) {
    const stop = sorted[index];
    if (stop.kind !== 'activity' || !stop.activity) {
      if (slice.length === 0) return false;
      boundaryStop = stop;
      break;
    }
    slice.push(stop);
    const next = sorted[index + 1];
    if (!next) break;
    if (next.kind !== 'activity' || !next.activity) {
      boundaryStop = next;
      break;
    }
  }

  if (slice.length === 0) return false;
  if (slice.some((stop) => !canShiftStopLater(stop, deltaMin, dayDate, dayEndMin))) return false;
  if (boundaryStop) {
    const last = slice[slice.length - 1];
    if (timeToMin(last.endTime) + deltaMin + 10 > timeToMin(boundaryStop.startTime)) return false;
  }

  const shiftedIds = new Set(slice.map((stop) => stop.id));
  for (const stop of dayPlan.stops) {
    if (!shiftedIds.has(stop.id)) continue;
    stop.startTime = minToTime(timeToMin(stop.startTime) + deltaMin);
    stop.endTime = minToTime(timeToMin(stop.endTime) + deltaMin);
  }
  return true;
}

async function insertMealsForDay(
  dayPlan: ScheduledDayPlan,
  cluster: ActivityCluster,
  dayDate: Date,
  timeWindow: DayTimeWindow | undefined,
  hotel: Accommodation | null,
  restaurants: Restaurant[],
  destination: string,
  dietary: string[],
  usedRestaurantIds: Set<string>,
  diagnostics: V32Diagnostics
): Promise<void> {
  const role = dayPlan.role || getRole(cluster);
  const dayStartMin = timeToMin(timeWindow?.activityStartTime || '08:30');
  const dayEndMin = timeToMin(timeWindow?.activityEndTime || '21:00');
  const hotelAnchor = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : { lat: cluster.centroid.lat, lng: cluster.centroid.lng };

  const stops = [...dayPlan.stops].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  const mealSpecs: Array<{ type: 'breakfast' | 'lunch' | 'dinner'; idealMin: number; duration: number; enabled: boolean }> = [
    {
      type: 'breakfast',
      idealMin: Math.max(dayStartMin, 8 * 60 + 30),
      duration: 45,
      enabled: role !== 'arrival' && dayStartMin < 9 * 60 + 15,
    },
    {
      type: 'lunch',
      idealMin: 13 * 60,
      duration: 75,
      enabled: dayStartMin < 13 * 60 && dayEndMin > 12 * 60,
    },
    {
      type: 'dinner',
      idealMin: 19 * 60,
      duration: 90,
      enabled: dayEndMin >= 19 * 60,
    },
  ];
  let fallbackMealsInserted = 0;

  for (const meal of mealSpecs) {
    if (!meal.enabled) continue;
    const mealWindow =
      meal.type === 'breakfast'
        ? { startMin: Math.max(dayStartMin, 7 * 60 + 30), endMin: Math.min(dayEndMin, 10 * 60 + 30) }
        : meal.type === 'lunch'
          ? { startMin: Math.max(dayStartMin, 12 * 60), endMin: Math.min(dayEndMin, 14 * 60 + 30) }
          : { startMin: Math.max(dayStartMin, 19 * 60), endMin: Math.min(dayEndMin, 21 * 60 + 30) };
    const tryInsertMeal = async (): Promise<boolean> => {
      const currentStops = [...dayPlan.stops].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
      for (let index = 0; index <= currentStops.length; index++) {
        const prev = index > 0 ? currentStops[index - 1] : undefined;
        const next = index < currentStops.length ? currentStops[index] : undefined;
        const { startMin, endMin } = gapBounds(prev, next, dayStartMin, dayEndMin);
        const slotStartMin = Math.max(startMin, mealWindow.startMin);
        const latestMealStartMin = Math.min(endMin - meal.duration, mealWindow.endMin);
        if (latestMealStartMin < slotStartMin) continue;

        const naturalStart = Math.max(slotStartMin, Math.min(meal.idealMin, latestMealStartMin));
        const prevAnchor = prev ? { lat: prev.latitude, lng: prev.longitude } : hotelAnchor;
        const nextAnchor = next ? { lat: next.latitude, lng: next.longitude } : prevAnchor;
        const midpoint = {
          lat: (prevAnchor.lat + nextAnchor.lat) / 2,
          lng: (prevAnchor.lng + nextAnchor.lng) / 2,
        };
        const anchorCandidates = [prevAnchor, nextAnchor];
        const mealStart = minToTime(naturalStart);
        const restaurant = meal.type === 'breakfast' && hotel
          ? createHotelBreakfastRestaurant(hotelAnchor, hotel.name || 'Hôtel')
          : await pickStrictMeal(
              restaurants,
              dayDate,
              meal.type,
              anchorCandidates,
              usedRestaurantIds,
              dietary,
              mealStart,
              meal.duration,
              destination,
              diagnostics
            );

        if (!restaurant && fallbackMealsInserted >= 1) {
          continue;
        }

        const stop: ScheduledStop = restaurant
          ? {
              id: makeStopId(meal.type, dayPlan.dayNumber, index),
              dayNumber: dayPlan.dayNumber,
              kind: meal.type,
              title: restaurant.name,
              startTime: mealStart,
              endTime: addMinutes(mealStart, meal.duration),
              latitude: restaurant.latitude,
              longitude: restaurant.longitude,
              mealType: meal.type,
              restaurant,
            }
          : {
              id: makeStopId(meal.type, dayPlan.dayNumber, index),
              dayNumber: dayPlan.dayNumber,
              kind: meal.type,
              title: 'Repas libre',
              startTime: mealStart,
              endTime: addMinutes(mealStart, meal.duration),
              latitude: midpoint.lat,
              longitude: midpoint.lng,
              mealType: meal.type,
              qualityFlags: ['self_meal_fallback'],
            };

        const mealPoint = { lat: stop.latitude, lng: stop.longitude };
        if (restaurant && meal.type !== 'breakfast') {
          const nearestAnchorDist = Math.min(
            calculateDistance(prevAnchor.lat, prevAnchor.lng, mealPoint.lat, mealPoint.lng),
            calculateDistance(nextAnchor.lat, nextAnchor.lng, mealPoint.lat, mealPoint.lng)
          );
          if (nearestAnchorDist > 1.5) {
            if (restaurant.id) usedRestaurantIds.delete(restaurant.id);
            continue;
          }
        }
        const travelBefore = prev ? estimateLocalTravelMinutes(prevAnchor, mealPoint) : 0;
        const travelAfter = next ? estimateLocalTravelMinutes(mealPoint, nextAnchor) : 0;
        const feasibleStartMin = Math.max(slotStartMin, startMin + travelBefore);
        const feasibleLatestStartMin = Math.min(latestMealStartMin, endMin - meal.duration - travelAfter);
        if (feasibleLatestStartMin < feasibleStartMin) {
          if (restaurant?.id) usedRestaurantIds.delete(restaurant.id);
          continue;
        }

        stop.startTime = minToTime(Math.max(feasibleStartMin, Math.min(naturalStart, feasibleLatestStartMin)));
        stop.endTime = addMinutes(stop.startTime, meal.duration);

        if (restaurant?.id) usedRestaurantIds.add(restaurant.id);
        if (!restaurant) {
          diagnostics.mealFallbackCount++;
          fallbackMealsInserted++;
        }
        dayPlan.stops.push(stop);
        return true;
      }
      return false;
    };

    const tryReslotActivitySlice = async (): Promise<boolean> => {
      const currentStops = [...dayPlan.stops].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
      const shiftCandidates = [10, 15, 20, 25, 30, 45, 60, 75, 90];
      for (const stop of currentStops) {
        if (stop.kind !== 'activity' || !stop.activity) continue;
        const originalTimes = snapshotStopTimes(dayPlan.stops);
        for (const deltaMin of shiftCandidates) {
          restoreStopTimes(dayPlan.stops, originalTimes);
          if (!shiftFollowingActivitySlice(dayPlan, stop.id, deltaMin, dayDate, dayEndMin)) continue;
          if (await tryInsertMeal()) return true;
        }
        restoreStopTimes(dayPlan.stops, originalTimes);
      }
      return false;
    };

    let inserted = await tryInsertMeal();
    if (!inserted && (meal.type === 'lunch' || meal.type === 'dinner')) {
      inserted = await tryReslotActivitySlice();
    }
    if (!inserted && (meal.type === 'lunch' || meal.type === 'dinner')) {
      const optionalCandidates = [...dayPlan.stops]
        .filter((stop) => stop.kind === 'activity' && stop.activity && !isProtectedActivity(stop.activity))
        .sort((left, right) => {
          const leftStart = timeToMin(left.startTime);
          const leftEnd = timeToMin(left.endTime);
          const rightStart = timeToMin(right.startTime);
          const rightEnd = timeToMin(right.endTime);
          const leftOverlaps = leftStart < mealWindow.endMin && leftEnd > mealWindow.startMin ? 0 : 1;
          const rightOverlaps = rightStart < mealWindow.endMin && rightEnd > mealWindow.startMin ? 0 : 1;
          if (leftOverlaps !== rightOverlaps) return leftOverlaps - rightOverlaps;
          return ((left.activity?.score || 0) - (right.activity?.score || 0))
            || ((right.activity?.duration || 60) - (left.activity?.duration || 60));
        });

      for (const candidate of optionalCandidates) {
        const originalStops = dayPlan.stops;
        dayPlan.stops = originalStops.filter((stop) => stop.id !== candidate.id);
        inserted = await tryInsertMeal();
        if (inserted) break;
        dayPlan.stops = originalStops;
      }
    }
  }
}

function insertFreeTimeForDay(
  dayPlan: ScheduledDayPlan,
  timeWindow: DayTimeWindow | undefined,
  diagnostics: V32Diagnostics
): void {
  const role = dayPlan.role || 'full_city';
  const activityCount = dayPlan.stops.filter((stop) => stop.kind === 'activity').length;
  if (activityCount <= 1) return;
  const maxBlocks = FREE_TIME_LIMIT_BY_ROLE[role];
  if (maxBlocks <= 0) return;
  const threshold = FREE_TIME_GAP_BY_ROLE[role];
  const dayStartMin = timeToMin(timeWindow?.activityStartTime || '08:30');
  const dayEndMin = timeToMin(timeWindow?.activityEndTime || '21:00');
  const sorted = [...dayPlan.stops].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  let inserted = 0;

  for (let index = 0; index <= sorted.length && inserted < maxBlocks; index++) {
    const prev = index > 0 ? sorted[index - 1] : undefined;
    const next = index < sorted.length ? sorted[index] : undefined;
    if (!prev && next?.kind === 'activity') continue;
    if (role === 'departure' && (prev?.kind === 'checkout' || next?.kind === 'checkout' || !prev)) continue;

    const prevEnd = prev ? timeToMin(prev.endTime) : dayStartMin;
    const nextStart = next ? timeToMin(next.startTime) : dayEndMin;

    const startMin = prevEnd + 10; // 10min leading buffer

    // Dynamic trailing buffer based on distance to next item
    const prevLat = prev?.latitude ?? 0;
    const prevLng = prev?.longitude ?? 0;
    const nextLat = next?.latitude ?? 0;
    const nextLng = next?.longitude ?? 0;
    const hasCoords = prevLat !== 0 && prevLng !== 0 && nextLat !== 0 && nextLng !== 0;
    const distToNext = hasCoords ? calculateDistance(prevLat, prevLng, nextLat, nextLng) : 0;
    const trailingBuffer = hasCoords ? estimateTravelBuffer(distToNext) : 10;

    const endMin = nextStart - trailingBuffer;
    const gap = endMin - startMin;
    if (gap <= threshold || gap < 30) continue;

    const lat = prev?.latitude ?? next?.latitude ?? 0;
    const lng = prev?.longitude ?? next?.longitude ?? 0;
    const stop: ScheduledStop = {
      id: makeStopId('free_time', dayPlan.dayNumber, index + inserted),
      dayNumber: dayPlan.dayNumber,
      kind: 'free_time',
      title: 'Temps libre — Exploration du quartier',
      startTime: minToTime(startMin),
      endTime: minToTime(endMin),
      latitude: lat,
      longitude: lng,
    };
    dayPlan.stops.push(stop);
    inserted++;
  }

  if (inserted > maxBlocks) {
    diagnostics.freeTimeOverBudgetCount += inserted - maxBlocks;
  }
}

function stampPlanningMeta(item: TripItem, activity?: ScoredActivity, role?: PlannerRole): void {
  item.planningMeta = {
    planningToken: activity?.planningToken || item.planningMeta?.planningToken || `${item.id}:${item.dayNumber}`,
    protectedReason: activity?.protectedReason || item.planningMeta?.protectedReason,
    sourcePackId: activity?.sourcePackId || item.planningMeta?.sourcePackId,
    plannerRole: activity?.plannerRole || role || item.planningMeta?.plannerRole,
    originalDayNumber: activity?.originalDayNumber ?? item.planningMeta?.originalDayNumber ?? item.dayNumber,
  };
}

function materializeStops(dayPlan: ScheduledDayPlan, hotel: Accommodation | null, destination?: string): TripDay {
  const role = dayPlan.role;
  const items: TripItem[] = [];
  const sortedStops = [...dayPlan.stops].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));

  for (const stop of sortedStops) {
    let item: TripItem;
    if (stop.kind === 'activity' && stop.activity) {
      item = createActivityItem(
        stop.activity,
        stop.startTime,
        timeToMin(stop.endTime) - timeToMin(stop.startTime),
        stop.dayNumber,
        items.length,
        destination
      );
      stampPlanningMeta(item, stop.activity, role);
    } else if ((stop.kind === 'breakfast' || stop.kind === 'lunch' || stop.kind === 'dinner') && stop.restaurant) {
      item = createRestaurantItem(
        {
          mealType: stop.kind,
          anchorPoint: { lat: stop.latitude, lng: stop.longitude },
          anchorName: 'Position actuelle',
          primary: stop.restaurant,
          alternatives: [],
          distanceFromAnchor: 0,
        },
        stop.kind,
        stop.startTime,
        timeToMin(stop.endTime) - timeToMin(stop.startTime),
        stop.dayNumber,
        items.length
      );
    } else if (stop.kind === 'breakfast' || stop.kind === 'lunch' || stop.kind === 'dinner') {
      item = createSelfMealFallbackItem(
        stop.kind,
        stop.startTime,
        timeToMin(stop.endTime) - timeToMin(stop.startTime),
        stop.dayNumber,
        items.length,
        { lat: stop.latitude, lng: stop.longitude }
      );
    } else if (stop.kind === 'checkin' && hotel) {
      item = createCheckinItem(hotel, stop.startTime, stop.dayNumber, items.length);
    } else if (stop.kind === 'checkout' && hotel) {
      item = createCheckoutItem(hotel, stop.startTime, stop.dayNumber, items.length);
    } else {
      item = {
        id: stop.id,
        dayNumber: stop.dayNumber,
        startTime: stop.startTime,
        endTime: stop.endTime,
        type: 'free_time',
        title: stop.title,
        description: 'Profitez de ce temps libre pour flâner dans le quartier, faire du shopping ou prendre un café',
        locationName: '',
        latitude: stop.latitude,
        longitude: stop.longitude,
        orderIndex: items.length,
        duration: timeToMin(stop.endTime) - timeToMin(stop.startTime),
        imageUrl: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=600&h=400&fit=crop',
        estimatedCost: 0,
      };
    }
    items.push(item);
  }

  return {
    dayNumber: dayPlan.dayNumber,
    date: new Date(),
    items,
    theme: '',
    dayNarrative: '',
    ...(role === 'day_trip' ? { isDayTrip: true } : {}),
    ...(dayPlan.dayTripDestination ? { dayTripDestination: dayPlan.dayTripDestination } : {}),
  };
}

function shouldSkipInterItemLeg(prev: TripItem, current: TripItem, isFirstDay: boolean): boolean {
  if (prev.type === 'flight' && isFirstDay) return true;
  if (prev.type === 'transport' && prev.transportRole === 'longhaul' && inferLonghaulDirectionFromItem(prev) === 'outbound') {
    return true;
  }
  return false;
}

function materializeLeg(
  from: TripItem,
  to: TripItem,
  dayTravel: DayTravelTimes | undefined,
  role: NonNullable<PlannerRole>
): MaterializedLeg | null {
  const distanceKm = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
  const leg = resolveTravelLeg(
    dayTravel,
    { id: from.id, name: from.locationName || from.title, lat: from.latitude, lng: from.longitude },
    { id: to.id, name: to.locationName || to.title, lat: to.latitude, lng: to.longitude },
    role
  );
  const durationMinutes = leg.durationMinutes;
  if (distanceKm <= ROUTE_TRANSPORT_DISTANCE_KM && durationMinutes <= ROUTE_TRANSPORT_MIN) return null;
  return {
    fromId: from.id,
    toId: to.id,
    distanceKm: leg.distanceKm || distanceKm,
    durationMinutes,
    mode: leg.mode === 'transit' ? 'public' : leg.mode === 'drive' ? 'car' : 'walk',
    polyline: leg.polyline,
  };
}

function computeDayGeoDiagnostics(day: TripDay): void {
  const routeItems = day.items.filter((item) => item.type !== 'transport' && item.latitude && item.longitude);
  const points = routeItems.map((item) => ({ latitude: item.latitude, longitude: item.longitude }));
  let totalLegKm = 0;
  const distances: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dist = calculateDistance(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
    totalLegKm += dist;
    distances.push(dist);
  }
  let zigzagTurns = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const v1x = points[i].longitude - points[i - 1].longitude;
    const v1y = points[i].latitude - points[i - 1].latitude;
    const v2x = points[i + 1].longitude - points[i].longitude;
    const v2y = points[i + 1].latitude - points[i].latitude;
    const norm1 = Math.hypot(v1x, v1y);
    const norm2 = Math.hypot(v2x, v2y);
    if (norm1 < 1e-6 || norm2 < 1e-6) continue;
    const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (norm1 * norm2)));
    const angle = Math.acos(cosTheta) * (180 / Math.PI);
    if (angle >= 115) zigzagTurns++;
  }

  let mstLowerBoundKm = 0;
  if (points.length > 1) {
    const visited = new Array<boolean>(points.length).fill(false);
    const bestEdge = new Array<number>(points.length).fill(Number.POSITIVE_INFINITY);
    bestEdge[0] = 0;
    for (let step = 0; step < points.length; step++) {
      let bestIndex = -1;
      let bestValue = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i++) {
        if (!visited[i] && bestEdge[i] < bestValue) {
          bestValue = bestEdge[i];
          bestIndex = i;
        }
      }
      if (bestIndex < 0) break;
      visited[bestIndex] = true;
      mstLowerBoundKm += bestValue;
      for (let i = 0; i < points.length; i++) {
        if (visited[i]) continue;
        const dist = calculateDistance(points[bestIndex].latitude, points[bestIndex].longitude, points[i].latitude, points[i].longitude);
        if (dist < bestEdge[i]) bestEdge[i] = dist;
      }
    }
  }

  day.geoDiagnostics = {
    maxLegKm: distances.length ? Math.max(...distances) : 0,
    p95LegKm: distances.length ? distances.sort((a, b) => a - b)[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] : 0,
    totalTravelMin: day.items.filter((item) => item.type === 'transport').reduce((sum, item) => sum + (item.duration || 0), 0),
    totalLegKm,
    zigzagTurns,
    routeInefficiencyRatio: mstLowerBoundKm > 0.05 ? Number((totalLegKm / mstLowerBoundKm).toFixed(2)) : 1,
    mstLowerBoundKm: Number(mstLowerBoundKm.toFixed(2)),
  };

  let largestGapMin = 0;
  for (let i = 1; i < day.items.length; i++) {
    const gap = timeToMin(day.items[i].startTime) - timeToMin(day.items[i - 1].endTime);
    if (gap > largestGapMin) largestGapMin = gap;
  }
  day.scheduleDiagnostics = {
    ...(day.scheduleDiagnostics || {}),
    largestGapMin,
  };
}

export function rebuildInterItemTravelForDays(
  days: TripDay[],
  travelTimes: DayTravelTimes[],
  diagnostics: V32Diagnostics
): void {
  for (const day of days) {
    const dayTravel = travelTimes.find((travel) => travel.dayNumber === day.dayNumber);
    const role = getRole(day);
    const kept = day.items.filter((item) => item.type !== 'transport' || item.transportRole === 'longhaul');
    const rebuilt: TripItem[] = [];

    for (let index = 0; index < kept.length; index++) {
      const item = { ...kept[index] };
      const prev = rebuilt.length > 0 ? rebuilt[rebuilt.length - 1] : undefined;

      if (prev && prev.type !== 'transport' && item.type !== 'transport' && !shouldSkipInterItemLeg(prev, item, day.dayNumber === 1)) {
        const leg = materializeLeg(prev, item, dayTravel, role);
        const directDistance = calculateDistance(prev.latitude, prev.longitude, item.latitude, item.longitude);
        const estimatedMinutes = Math.max(5, Math.ceil(((directDistance > 1 ? directDistance * 4 : (directDistance / 4.5) * 60)) / 5) * 5);
        const legDistance = leg?.distanceKm ?? directDistance;
        const legMinutes = leg?.durationMinutes ?? estimatedMinutes;
        const legMode = leg?.mode ?? (directDistance > 1 ? 'public' : 'walk');

        item.distanceFromPrevious = Number(legDistance.toFixed(3));
        item.timeFromPrevious = legMinutes;
        item.transportToPrevious = legMode;

        if (leg) {
          const transportItem = createTravelItem(
            {
              fromId: prev.id,
              toId: item.id,
              fromName: prev.locationName || prev.title,
              toName: item.locationName || item.title,
              distanceKm: leg.distanceKm,
              durationMinutes: leg.durationMinutes,
              mode: leg.mode === 'public' ? 'transit' : leg.mode === 'car' ? 'drive' : 'walk',
              isEstimate: !leg.polyline,
              polyline: leg.polyline,
            },
            prev.endTime,
            leg.durationMinutes,
            day.dayNumber,
            rebuilt.length,
            {
              id: item.id,
              name: item.locationName || item.title,
              latitude: item.latitude,
              longitude: item.longitude,
              duration: item.duration || Math.max(5, timeToMin(item.endTime) - timeToMin(item.startTime)),
              score: item.rating || 0,
              source: 'google_places',
              reviewCount: item.reviewCount || 0,
            } as ScoredActivity
          );
          transportItem.transportRole = 'inter_item';
          transportItem.description = `${prev.locationName || prev.title} → ${item.locationName || item.title}`;
          rebuilt.push(transportItem);
        } else if (directDistance > ROUTE_TRANSPORT_DISTANCE_KM || estimatedMinutes > ROUTE_TRANSPORT_MIN) {
          diagnostics.teleportLegCount++;
        }
      }

      rebuilt.push(item);
    }

    day.items = rebuilt;
    sortAndReindexItems(day.items);
    computeDayGeoDiagnostics(day);
    diagnostics.routeRebuildCount++;
  }

  diagnostics.orphanTransportCount = days.reduce((sum, day) => sum + day.items.filter((item, index) => {
    if (item.type !== 'transport' || item.transportRole === 'longhaul') return false;
    const prev = day.items[index - 1];
    const next = day.items[index + 1];
    return !prev || !next || prev.type === 'transport' || next.type === 'transport';
  }).length, 0);
}

export async function semanticScheduleV32Days(
  clusters: ActivityCluster[],
  travelTimes: DayTravelTimes[],
  timeWindows: DayTimeWindow[],
  hotel: Accommodation | null,
  preferences: TripPreferences,
  data: FetchedData,
  restaurants: Restaurant[],
  _allActivities: ScoredActivity[],
  _destCoords: { lat: number; lng: number }
): Promise<RepairResult> {
  const repairs: RepairAction[] = [];
  const unresolvedViolations: string[] = [];
  const diagnostics: V32Diagnostics = {
    protectedBreakCount: 0,
    lateMealReplacementCount: 0,
    dayTripEvictionCount: 0,
    finalIntegrityFailures: 0,
    orphanTransportCount: 0,
    teleportLegCount: 0,
    staleNarrativeCount: 0,
    freeTimeOverBudgetCount: 0,
    mealFallbackCount: 0,
    routeRebuildCount: 0,
    restaurantRefetchMissCount: 0,
  };

  const usedRestaurantIds = new Set<string>();
  const dayPlans: ScheduledDayPlan[] = [];

  for (const cluster of clusters) {
    const dayDate = getDayDateForCluster(preferences.startDate, cluster.dayNumber) || new Date(preferences.startDate);
    const timeWindow = timeWindows.find((window) => window.dayNumber === cluster.dayNumber);
    const dayTravel = travelTimes.find((travel) => travel.dayNumber === cluster.dayNumber);
    const role = getRole(cluster);
    const dayRestaurants = buildDayRestaurantPool(cluster, restaurants, data);

    const stops = scheduleActivitiesForDay(cluster, dayDate, timeWindow, hotel, dayTravel, diagnostics, unresolvedViolations);
    const dayPlan: ScheduledDayPlan = {
      dayNumber: cluster.dayNumber,
      role,
      isDayTrip: Boolean(cluster.isDayTrip),
      dayTripDestination: cluster.dayTripDestination,
      stops,
    };

    await insertMealsForDay(
      dayPlan,
      cluster,
      dayDate,
      timeWindow,
      hotel,
      dayRestaurants,
      preferences.destination,
      preferences.dietary || [],
      usedRestaurantIds,
      diagnostics
    );
    insertFreeTimeForDay(dayPlan, timeWindow, diagnostics);
    dayPlans.push(dayPlan);
  }

  const days = dayPlans.map((plan) => materializeStops(plan, hotel, preferences.destination));
  rebuildInterItemTravelForDays(days, travelTimes, diagnostics);

  return {
    days,
    repairs,
    unresolvedViolations,
    rescueDiagnostics: diagnostics,
  };
}

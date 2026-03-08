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
import { isDuplicateActivityCandidate } from './utils/activityDedup';

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

  // Global dedup: track activity IDs already placed across all days
  const globalPlacedIds = new Set<string>();

  for (const cluster of clusters) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + cluster.dayNumber - 1);

    // Dedup activities within this cluster: by ID + by similarity (name/proximity)
    const seenInDay: Array<{ id?: string; name?: string; latitude?: number; longitude?: number }> = [];
    cluster.activities = cluster.activities.filter(act => {
      const id = act.id || act.name;
      // ID-based global dedup
      if (globalPlacedIds.has(id)) {
        console.log(`[assembleV3Days] Dedup: removing globally placed "${act.name}" from Day ${cluster.dayNumber}`);
        return false;
      }
      // Similarity-based per-day dedup (catches "Parc Guell" vs "Park Guell Tour" at same location)
      const candidate = { id: act.id, name: act.name, latitude: act.latitude, longitude: act.longitude };
      const duplicateOf = seenInDay.find(existing => isDuplicateActivityCandidate(candidate, existing));
      if (duplicateOf) {
        console.log(`[assembleV3Days] Dedup: removing similar "${act.name}" (duplicate of "${duplicateOf.name}") from Day ${cluster.dayNumber}`);
        return false;
      }
      seenInDay.push(candidate);
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
    const isLastDay = cluster.dayNumber === clusters.length;

    // isPastEnd and timeToMin are imported from ./utils/time

    // Inject checkout item on the last day
    if (isLastDay && hotel) {
      const checkoutTime = hotel.checkOutTime || '11:00';
      items.push(createCheckoutItem(hotel, checkoutTime, cluster.dayNumber, orderIndex++));
      // If checkout is after current activity start, push activities to after checkout
      if (timeToMin(checkoutTime) > timeToMin(currentTime)) {
        currentTime = addMinutes(checkoutTime, 15); // 15min buffer after checkout
      }
    }

    // Meal anchors used for Repas libre fallback when no valid restaurant can be placed.
    const hotelLatLng = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;
    const breakfastAnchor = hotelLatLng || getClusterCentroid(cluster.activities);
    const breakfast = mealPlan?.meals.find(m => m.mealType === 'breakfast');
    const breakfastResolved = resolveMealPlacementForSlot(breakfast, dayDate, currentTime, 45);
    if (breakfastResolved) {
      items.push(createRestaurantItem(breakfastResolved, 'breakfast', currentTime, 45, cluster.dayNumber, orderIndex++));
    } else {
      items.push(createSelfMealFallbackItem('breakfast', currentTime, 45, cluster.dayNumber, orderIndex++, breakfastAnchor));
    }
    currentTime = addMinutes(currentTime, 60); // 45min eat + 15min travel

    // Activities with travel times between them
    const lunchAnchorAct = findMidDayActivity(cluster.activities);
    const lunchAnchor = lunchAnchorAct
      ? { lat: lunchAnchorAct.latitude, lng: lunchAnchorAct.longitude }
      : getClusterCentroid(cluster.activities);
    const lunch = mealPlan?.meals.find(m => m.mealType === 'lunch');

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

      // Place lunch before this activity if it's past 12:15 and we haven't placed it yet.
      if (!lunchPlaced && activitiesPlaced >= 2 && timeToMin(currentTime) >= 12 * 60 + 15) {
        const resolvedLunch = resolveMealPlacementForSlot(lunch, dayDate, currentTime, 75);
        if (resolvedLunch) {
          items.push(createRestaurantItem(resolvedLunch, 'lunch', currentTime, 75, cluster.dayNumber, orderIndex++));
        } else {
          items.push(createSelfMealFallbackItem('lunch', currentTime, 75, cluster.dayNumber, orderIndex++, lunchAnchor));
        }
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

    // Place lunch if not yet placed (early days or few activities).
    if (!lunchPlaced && activitiesPlaced > 0) {
      const lunchTime = ensureAfter(currentTime, '12:15');
      if (!isPastEnd(lunchTime, addMinutes(dayEndTime, 30))) {
        const resolvedLunch = resolveMealPlacementForSlot(lunch, dayDate, lunchTime, 75);
        if (resolvedLunch) {
          items.push(createRestaurantItem(resolvedLunch, 'lunch', lunchTime, 75, cluster.dayNumber, orderIndex++));
        } else {
          items.push(createSelfMealFallbackItem('lunch', lunchTime, 75, cluster.dayNumber, orderIndex++, lunchAnchor));
        }
        currentTime = addMinutes(lunchTime, 90);
        lunchPlaced = true;
      }
    }

    // Dinner
    const lastAct = cluster.activities[cluster.activities.length - 1];
    const dinnerAnchor = lastAct
      ? { lat: lastAct.latitude, lng: lastAct.longitude }
      : hotelLatLng || getClusterCentroid(cluster.activities);
    const dinner = mealPlan?.meals.find(m => m.mealType === 'dinner');
    // Dinner between 19:00 and 21:30
    let dinnerTime = ensureAfter(currentTime, '19:00');
    // Cap dinner start at 21:30 max
    if (isPastEnd(dinnerTime, '21:30')) {
      dinnerTime = '21:00';
    }
    const resolvedDinner = resolveMealPlacementForSlot(dinner, dayDate, dinnerTime, 90);
    if (resolvedDinner) {
      items.push(createRestaurantItem(resolvedDinner, 'dinner', dinnerTime, 90, cluster.dayNumber, orderIndex++));
    } else {
      items.push(createSelfMealFallbackItem('dinner', dinnerTime, 90, cluster.dayNumber, orderIndex++, dinnerAnchor));
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

  // Final guardrail after overlap shifts: ensure restaurants are still valid.
  for (const day of days) {
    enforceRestaurantSafetyForDay(day);
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

function resolveMealPlacementForSlot(
  meal: MealPlacement | undefined,
  dayDate: Date,
  startTime: string,
  durationMin: number
): MealPlacement | null {
  if (!meal) return null;
  const endTime = addMinutes(startTime, durationMin);
  const candidates: Restaurant[] = [meal.primary, ...(meal.alternatives || [])];
  const openCandidate = candidates.find((restaurant) => isRestaurantOpenForSlot(restaurant, dayDate, startTime, endTime));
  if (!openCandidate) return null;
  if (openCandidate.id === meal.primary.id) return meal;

  const remainingAlternatives = candidates.filter((candidate) => candidate.id !== openCandidate.id);
  return {
    ...meal,
    primary: openCandidate,
    alternatives: remainingAlternatives,
  };
}

function isRestaurantOpenForSlot(
  restaurant: Restaurant,
  dayDate: Date,
  startTime: string,
  endTime: string
): boolean {
  const dayHours = getRestaurantHoursForDay(restaurant, dayDate);
  if (dayHours === null) return false; // explicitly closed on this day
  if (!dayHours?.open || !dayHours?.close) return true; // unknown -> do not block scheduling

  const tolerance = 15;
  const openMin = timeToMin(dayHours.open);
  let closeMin = timeToMin(dayHours.close);
  let slotStart = timeToMin(startTime);
  let slotEnd = timeToMin(endTime);

  if (closeMin <= openMin) {
    closeMin += 24 * 60;
    if (slotStart < openMin) {
      slotStart += 24 * 60;
      slotEnd += 24 * 60;
    }
  }

  return slotStart >= openMin - tolerance && slotEnd <= closeMin + tolerance;
}

function getRestaurantHoursForDay(
  restaurant: Restaurant,
  dayDate: Date
): { open: string; close: string } | null | undefined {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const dayName = dayNames[dayDate.getDay()];
  const dayHours = restaurant.openingHours?.[dayName];
  if (dayHours === null) return null;
  if (dayHours && dayHours.open && dayHours.close) return dayHours;
  return undefined;
}

function createSelfMealFallbackItem(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  startTime: string,
  duration: number,
  dayNumber: number,
  orderIndex: number,
  anchor: { lat: number; lng: number } | null
): TripItem {
  const mealLabel = getMealLabel(mealType);
  const latitude = anchor?.lat ?? 0;
  const longitude = anchor?.lng ?? 0;

  return {
    id: `meal-self-${dayNumber}-${mealType}`,
    dayNumber,
    startTime,
    endTime: addMinutes(startTime, duration),
    type: 'restaurant',
    title: `${mealLabel} — Repas libre`,
    description: 'Pique-nique / courses / repas maison',
    locationName: 'Repas libre',
    latitude,
    longitude,
    orderIndex,
    duration,
    mealType,
    estimatedCost: 0,
    restaurant: undefined,
    restaurantAlternatives: undefined,
    qualityFlags: ['self_meal_fallback'],
  };
}

function getMealLabel(mealType: 'breakfast' | 'lunch' | 'dinner'): string {
  if (mealType === 'breakfast') return 'Petit-déjeuner';
  if (mealType === 'lunch') return 'Déjeuner';
  return 'Dîner';
}

function enforceRestaurantSafetyForDay(day: TripDay): void {
  const activityPoints = day.items
    .filter((item) => item.type === 'activity' && item.latitude && item.longitude)
    .map((item) => ({ lat: item.latitude as number, lng: item.longitude as number }));

  for (let i = 0; i < day.items.length; i++) {
    const item = day.items[i];
    if (item.type !== 'restaurant') continue;
    if (item.qualityFlags?.includes('self_meal_fallback')) continue;

    const mealType = item.mealType;
    if (!mealType) continue;

    const isLunchOrDinner = mealType === 'lunch' || mealType === 'dinner';
    const currentRestaurant = item.restaurant;
    const currentOpen = currentRestaurant
      ? isRestaurantOpenForSlot(currentRestaurant, day.date, item.startTime, item.endTime)
      : true;
    const currentDist = (currentRestaurant && isLunchOrDinner)
      ? nearestActivityDistanceKm(currentRestaurant.latitude, currentRestaurant.longitude, activityPoints)
      : 0;
    const currentDistanceOk = !isLunchOrDinner || currentDist <= 0.8;

    if (currentOpen && currentDistanceOk) continue;

    const replacement = findRestaurantReplacementForSlot(
      mealType,
      day.date,
      item.startTime,
      item.endTime,
      [item.restaurant, ...(item.restaurantAlternatives || [])].filter(Boolean) as Restaurant[],
      activityPoints
    );

    if (replacement) {
      const mealLabel = getMealLabel(mealType);
      day.items[i] = {
        ...item,
        title: `${mealLabel} — ${replacement.restaurant.name}`,
        description: `${mealLabel} à ${replacement.restaurant.name}`,
        locationName: replacement.restaurant.address || replacement.restaurant.name,
        latitude: replacement.restaurant.latitude,
        longitude: replacement.restaurant.longitude,
        rating: replacement.restaurant.rating,
        bookingUrl: replacement.restaurant.reservationUrl || replacement.restaurant.googleMapsUrl,
        restaurant: replacement.restaurant,
        restaurantAlternatives: replacement.alternatives.length > 0 ? replacement.alternatives : undefined,
        openingHoursByDay: replacement.restaurant.openingHours,
      };
      continue;
    }

    day.items[i] = {
      ...item,
      title: `${getMealLabel(mealType)} — Repas libre`,
      description: 'Pique-nique / courses / repas maison',
      locationName: 'Repas libre',
      estimatedCost: 0,
      bookingUrl: undefined,
      restaurant: undefined,
      restaurantAlternatives: undefined,
      qualityFlags: Array.from(new Set([...(item.qualityFlags || []), 'self_meal_fallback'])),
    };
  }
}

function findRestaurantReplacementForSlot(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  dayDate: Date,
  startTime: string,
  endTime: string,
  candidates: Restaurant[],
  activityPoints: Array<{ lat: number; lng: number }>
): { restaurant: Restaurant; alternatives: Restaurant[] } | null {
  const isLunchOrDinner = mealType === 'lunch' || mealType === 'dinner';
  const uniqueById = new Map<string, Restaurant>();
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    if (!uniqueById.has(candidate.id)) uniqueById.set(candidate.id, candidate);
  }
  const uniqueCandidates = [...uniqueById.values()];

  const valid = uniqueCandidates.filter((candidate) => {
    if (!isRestaurantOpenForSlot(candidate, dayDate, startTime, endTime)) return false;
    if (!isLunchOrDinner) return true;
    return nearestActivityDistanceKm(candidate.latitude, candidate.longitude, activityPoints) <= 0.8;
  });

  if (valid.length === 0) return null;
  const selected = valid[0];
  const alternatives = valid.slice(1);
  return { restaurant: selected, alternatives };
}

function nearestActivityDistanceKm(
  lat: number,
  lng: number,
  activityPoints: Array<{ lat: number; lng: number }>
): number {
  if (activityPoints.length === 0) return Infinity;
  let minDist = Infinity;
  for (const point of activityPoints) {
    const dist = Math.hypot(lat - point.lat, lng - point.lng) * 111;
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

/**
 * Helper: Create a TripItem for hotel checkout
 */
function createCheckoutItem(
  hotel: Accommodation,
  checkoutTime: string,
  dayNumber: number,
  orderIndex: number
): TripItem {
  return {
    id: `checkout-${dayNumber}`,
    dayNumber,
    startTime: addMinutes(checkoutTime, -30),
    endTime: checkoutTime,
    type: 'checkout',
    title: `Check-out — ${hotel.name}`,
    description: `Libérer la chambre avant ${checkoutTime}`,
    locationName: hotel.name || '',
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    orderIndex,
    duration: 30,
    estimatedCost: 0,
  };
}

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
    bookingUrl: restaurant.reservationUrl || restaurant.googleMapsUrl,
    openingHoursByDay: restaurant.openingHours,
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

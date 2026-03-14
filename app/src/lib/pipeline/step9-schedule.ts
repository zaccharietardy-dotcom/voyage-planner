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
import type { DayTravelTimes, TravelLeg } from './step7b-travel-times';
import type { DayTimeWindow } from './step4-anchor-transport';
import { timeToMin, minToTime, addMinutes, isPastEnd, ensureAfter } from './utils/time';
import { getClusterCentroid, findMidDayActivity } from './utils/geo';
import { isDuplicateActivityCandidate } from './utils/activityDedup';
import { isOpenAtTime } from './utils/opening-hours';
import { enrichWithTicketingLinks } from '../services/officialTicketing';

// ---------------------------------------------------------------------------
// Default images for items without their own photo
// ---------------------------------------------------------------------------
const DEFAULT_IMAGES = {
  breakfast: 'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=600&h=400&fit=crop',
  lunch: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=400&fit=crop',
  dinner: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop',
  checkin: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop',
  checkout: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop',
  free_time: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=600&h=400&fit=crop',
} as const;

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
  const destination = preferences.destination || '';

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
    const isLastDay = cluster.dayNumber === clusters.length;

    // isPastEnd and timeToMin are imported from ./utils/time

    // Meal anchors used for Repas libre fallback when no valid restaurant can be placed.
    const hotelLatLng = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;
    const breakfastAnchor = hotelLatLng || getClusterCentroid(cluster.activities);

    // Place breakfast BEFORE checkout so the last day isn't: checkout 10:30 → breakfast 12:15
    const breakfast = mealPlan?.meals.find(m => m.mealType === 'breakfast');
    const breakfastResolved = resolveMealPlacementForSlot(breakfast, dayDate, currentTime, 45);
    if (breakfastResolved) {
      items.push(createRestaurantItem(breakfastResolved, 'breakfast', currentTime, 45, cluster.dayNumber, orderIndex++));
    } else {
      items.push(createSelfMealFallbackItem('breakfast', currentTime, 45, cluster.dayNumber, orderIndex++, breakfastAnchor));
    }
    currentTime = addMinutes(currentTime, 60); // 45min eat + 15min travel

    // Inject checkout item on the last day (AFTER breakfast)
    if (isLastDay && hotel) {
      const checkoutTime = hotel.checkOutTime || '11:00';
      items.push(createCheckoutItem(hotel, checkoutTime, cluster.dayNumber, orderIndex++));
      // Only push currentTime if checkout fits before day end
      // On departure days with early flights, checkout may be after dayEndTime — don't block activities
      const afterCheckout = addMinutes(checkoutTime, 15);
      if (!isPastEnd(afterCheckout, dayEndTime)) {
        currentTime = afterCheckout;
      }
      // If checkout is past dayEndTime, keep currentTime as-is (after breakfast)
      // so any remaining activities between breakfast and dayEnd can still be placed
    }

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

      // Compute travel time but DON'T create the item yet — we need to confirm the activity will be placed first
      let pendingTravelTime = 0;
      if (travelLeg && travelLeg.durationMinutes > 5) {
        const afterTravel = addMinutes(currentTime, travelLeg.durationMinutes);
        if (!isPastEnd(afterTravel, dayEndTime)) {
          pendingTravelTime = travelLeg.durationMinutes;
        }
      }
      const timeAfterTravel = pendingTravelTime > 0 ? addMinutes(currentTime, pendingTravelTime) : currentTime;

      // Place lunch when entering the lunch window (12:00-14:30) — purely temporal, no activity count check
      if (!lunchPlaced && timeToMin(timeAfterTravel) >= 12 * 60) {
        // Commit any pending travel before lunch
        if (pendingTravelTime > 0 && travelLeg) {
          items.push(createTravelItem(travelLeg, currentTime, pendingTravelTime, cluster.dayNumber, orderIndex++, act));
          currentTime = timeAfterTravel;
          pendingTravelTime = 0;
        }
        // Try multiple slots for lunch to avoid "Repas libre"
        const lunchSlots = [currentTime, '12:30', '13:00', '13:30'];
        let resolvedLunch: MealPlacement | null = null;
        let finalLunchTime = currentTime;
        for (const slot of lunchSlots) {
          resolvedLunch = resolveMealPlacementForSlot(lunch, dayDate, slot, 75);
          if (resolvedLunch) { finalLunchTime = slot; break; }
        }
        if (resolvedLunch) {
          items.push(createRestaurantItem(resolvedLunch, 'lunch', finalLunchTime, 75, cluster.dayNumber, orderIndex++));
        } else {
          items.push(createSelfMealFallbackItem('lunch', currentTime, 75, cluster.dayNumber, orderIndex++, lunchAnchor));
        }
        currentTime = addMinutes(finalLunchTime, 90); // 75min eat + 15min travel
        lunchPlaced = true;

        // Check time again after lunch
        if (isPastEnd(currentTime, dayEndTime)) {
          console.log(`[assembleV3Days] Day ${cluster.dayNumber}: stopping after lunch (${currentTime} >= ${dayEndTime})`);
          break;
        }
      }

      const duration = act.duration || 60;
      // Use timeAfterTravel for placement checks (activity would start after travel)
      const checkTime = pendingTravelTime > 0 ? timeAfterTravel : currentTime;

      // Check if this activity fits within the day
      const hardEndTime = addMinutes(dayEndTime, 30);
      if (isPastEnd(checkTime, hardEndTime)) {
        console.log(`[assembleV3Days] Day ${cluster.dayNumber}: skipping "${act.name}" (${checkTime} past hard end ${hardEndTime})`);
        break;
      }

      // Check opening hours: skip if the activity would start/end outside opening hours
      let placementTime = checkTime;
      const actCloseTime = getActivityCloseTime(act, dayDate);
      if (actCloseTime) {
        const actEnd = addMinutes(placementTime, duration);
        if (isPastEnd(actEnd, actCloseTime)) {
          if (act.mustSee) {
            const closeMin = timeToMin(actCloseTime);
            const dayStartMin = timeToMin(dayStartTime);
            const candidateStartMin = closeMin - duration;
            if (candidateStartMin >= dayStartMin) {
              const candidateStart = minToTime(candidateStartMin);
              console.warn(
                `[assembleV3Days] Day ${cluster.dayNumber}: must-see "${act.name}" ends ${actEnd} past close ${actCloseTime}` +
                ` — shifting start to ${candidateStart} to fit within hours`
              );
              placementTime = candidateStart;
            } else {
              const earliestFitStart = minToTime(Math.max(dayStartMin, closeMin - duration));
              console.warn(
                `[assembleV3Days] Day ${cluster.dayNumber}: must-see "${act.name}" cannot fully fit before close ${actCloseTime}` +
                ` — placing at ${earliestFitStart} (truncated visit, must-see priority)`
              );
              placementTime = earliestFitStart;
            }
          } else {
            // Normal activity: skip — do NOT emit travel item
            console.log(`[assembleV3Days] Day ${cluster.dayNumber}: skipping "${act.name}" (ends ${actEnd} past close ${actCloseTime})`);
            continue;
          }
        }
      }
      const actOpenTime = getActivityOpenTime(act, dayDate);
      if (actOpenTime && !isPastEnd(placementTime, actOpenTime)) {
        placementTime = actOpenTime;
      }

      // Activity confirmed — now commit the travel item if pending
      if (pendingTravelTime > 0 && travelLeg) {
        items.push(createTravelItem(travelLeg, currentTime, pendingTravelTime, cluster.dayNumber, orderIndex++, act));
        currentTime = timeAfterTravel;
      }
      // If placement was shifted earlier (must-see), use that time instead
      currentTime = placementTime;

      items.push(createActivityItem(act, currentTime, duration, cluster.dayNumber, orderIndex++, destination));
      globalPlacedIds.add(act.id || act.name);
      currentTime = addMinutes(currentTime, duration + 10); // 10min buffer between activities
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
        const replaceItem = createActivityItem(missing, replaceStart, replaceDuration, cluster.dayNumber, victim.item.orderIndex, destination);

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

    // Place lunch if not yet placed — hard cap at 14:30 (never lunch after 14:30)
    if (!lunchPlaced) {
      // Use 12:00 as earliest, cap at 14:30
      const idealLunch = ensureAfter(currentTime, '12:00');
      const lunchTime = isPastEnd(idealLunch, '14:30') ? '14:30' : idealLunch;
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

    // Dinner — skip on departure days with early end time (before 18:00)
    if (!isLastDay || timeToMin(dayEndTime) >= 18 * 60) {
      const lastAct = cluster.activities[cluster.activities.length - 1];
      const dinnerAnchor = lastAct
        ? { lat: lastAct.latitude, lng: lastAct.longitude }
        : hotelLatLng || getClusterCentroid(cluster.activities);
      const dinner = mealPlan?.meals.find(m => m.mealType === 'dinner');
      // Dinner between 19:00 and 21:30 — try multiple slots to avoid "Repas libre"
      let dinnerTime = ensureAfter(currentTime, '19:00');
      // Cap dinner start at 21:30 max
      if (isPastEnd(dinnerTime, '21:30')) {
        dinnerTime = '21:00';
      }
      // Try the primary slot first, then alternate slots
      const dinnerSlots = [dinnerTime, '19:30', '20:00', '20:30'];
      let resolvedDinner: MealPlacement | null = null;
      let finalDinnerTime = dinnerTime;
      for (const slot of dinnerSlots) {
        resolvedDinner = resolveMealPlacementForSlot(dinner, dayDate, slot, 90);
        if (resolvedDinner) { finalDinnerTime = slot; break; }
      }
      if (resolvedDinner) {
        items.push(createRestaurantItem(resolvedDinner, 'dinner', finalDinnerTime, 90, cluster.dayNumber, orderIndex++));
      } else {
        items.push(createSelfMealFallbackItem('dinner', dinnerTime, 90, cluster.dayNumber, orderIndex++, dinnerAnchor));
      }
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
        const itemDuration = next.duration
          ? next.duration
          : Math.max(0, timeToMin(next.endTime || '00:00') - nextStartMin);
        const shiftedEnd = shiftedStart + Math.max(itemDuration, 0);

        // If the shifted item would push past hard end, drop it
        if (shiftedStart >= hardEndMin) {
          console.log(`[assembleV3Days] Overlap fix: dropping "${next.title}" on Day ${day.dayNumber} (shifted start ${minToTime(shiftedStart)} past hard end ${minToTime(hardEndMin)})`);
          day.items.splice(i + 1, 1);
          i--; // Re-check from current position
          continue;
        }

        // If shifting an activity past its closing time, drop it instead of creating a violation
        if (next.type === 'activity') {
          // Check using isOpenAtTime (covers both openingHours and openingHoursByDay)
          const mockAct = {
            name: next.title || '',
            openingHours: next.openingHours as { open: string; close: string } | undefined,
            openingHoursByDay: next.openingHoursByDay as Record<string, { open: string; close: string } | null> | undefined,
          } as ScoredActivity;
          if (!isOpenAtTime(mockAct, day.date, minToTime(shiftedStart), minToTime(shiftedEnd))) {
            console.log(`[assembleV3Days] Overlap fix: dropping "${next.title}" on Day ${day.dayNumber} (shifted ${minToTime(shiftedStart)}-${minToTime(shiftedEnd)} outside opening hours)`);
            day.items.splice(i + 1, 1);
            i--;
            continue;
          }
        }

        next.startTime = minToTime(shiftedStart);
        // For activities, always derive endTime from the duration field to prevent mismatches
        if (next.type === 'activity' && next.duration) {
          next.endTime = addMinutes(next.startTime, next.duration);
        } else {
          next.endTime = minToTime(shiftedEnd);
        }
      }
    }

    // Re-assign orderIndex after potential removals
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Hard stop: drop activities starting after 22:00 (parks at midnight = nonsensical)
  for (const day of days) {
    const beforeCount = day.items.length;
    day.items = day.items.filter(item => {
      if (item.type !== 'activity') return true; // keep restaurants, transport
      const startMin = timeToMin(item.startTime || '00:00');
      if (startMin >= 22 * 60) {
        console.log(`[assembleV3Days] Hard stop: dropping "${item.title}" on Day ${day.dayNumber} (starts at ${item.startTime}, past 22:00)`);
        return false;
      }
      return true;
    });
    if (day.items.length < beforeCount) {
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }

  // Final guardrail after overlap shifts: ensure restaurants are still valid.
  for (const day of days) {
    enforceRestaurantSafetyForDay(day);
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Enrich all activity items with ticketing links (official + Viator + Tiqets)
  for (const day of days) {
    enrichWithTicketingLinks(day.items, destination);
  }

  // Consolidate bookingUrl: copy enriched ticketing links into main bookingUrl if empty
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity' && !item.bookingUrl) {
        const enriched = item as any;
        item.bookingUrl = enriched.officialBookingUrl || enriched.viatorUrl || enriched.tiqetsUrl || undefined;
      }
    }
  }

  // Empty day rescue: if a day has 0 activities, steal from the busiest day
  for (const day of days) {
    const activityCount = day.items.filter(i => i.type === 'activity').length;
    if (activityCount > 0) continue;

    // Find the busiest day (most activities)
    let busiestDay: TripDay | null = null;
    let busiestCount = 0;
    for (const other of days) {
      if (other.dayNumber === day.dayNumber) continue;
      const otherCount = other.items.filter(i => i.type === 'activity').length;
      if (otherCount > busiestCount) {
        busiestCount = otherCount;
        busiestDay = other;
      }
    }
    if (!busiestDay || busiestCount < 2) continue; // Can't steal if donor has ≤1

    // Steal the lowest-scored non-must-see activity
    const donorActivities = busiestDay.items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.type === 'activity' && !item.mustSee)
      .sort((a, b) => (a.item.rating ?? 0) - (b.item.rating ?? 0));

    const toSteal = Math.min(2, donorActivities.length, Math.floor(busiestCount / 2));
    for (let s = 0; s < toSteal; s++) {
      const victim = donorActivities[s];
      const stolenItem = { ...victim.item, dayNumber: day.dayNumber };
      day.items.push(stolenItem);
      busiestDay.items.splice(victim.idx - s, 1); // adjust index for prior removals
      console.log(`[assembleV3Days] Empty day rescue: moved "${stolenItem.title}" from Day ${busiestDay.dayNumber} → Day ${day.dayNumber}`);
    }

    // Remove orphan transport items (pointing to removed activities)
    busiestDay.items = busiestDay.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      const next = busiestDay!.items[i + 1];
      const prev = busiestDay!.items[i - 1];
      // Keep transport only if it connects two real items
      return next && prev;
    });

    // Re-sort and re-index both days
    for (const d of [day, busiestDay]) {
      d.items.sort((a, b) => timeToMin(a.startTime || '00:00') - timeToMin(b.startTime || '00:00'));
      d.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }

  // Remove orphan transport items from all days (transport with no adjacent activity)
  for (const day of days) {
    day.items = day.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      const prev = day.items[i - 1];
      const next = day.items[i + 1];
      // Drop transport that has no activity neighbor
      const hasActivityNeighbor = (prev && prev.type === 'activity') || (next && next.type === 'activity');
      if (!hasActivityNeighbor) {
        console.log(`[assembleV3Days] Removing orphan transport "${item.description}" on Day ${day.dayNumber}`);
        return false;
      }
      return true;
    });
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Fix transport labels: update description to reference actual adjacent items
  // (repair/swap may have changed which activities are adjacent)
  for (const day of days) {
    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i];
      if (item.type !== 'transport') continue;
      const prev = day.items[i - 1];
      const next = day.items[i + 1];
      const fromName = prev ? (prev.locationName || prev.title || '?') : 'Hôtel';
      const toName = next ? (next.locationName || next.title || '?') : '?';
      item.description = `${fromName} → ${toName}`;
    }
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
  if (!openCandidate) {
    // No candidate confirmed open, but returning the primary is better than "Repas libre"
    console.warn(`[Schedule] No open restaurant for ${meal.mealType} at ${startTime} — using primary "${meal.primary.name}" anyway`);
    return meal;
  }
  if (openCandidate.id === meal.primary.id) return meal;

  const remainingAlternatives = candidates.filter((candidate) => candidate.id !== openCandidate.id);
  return {
    ...meal,
    primary: openCandidate,
    alternatives: remainingAlternatives,
  };
}

export function isRestaurantOpenForSlot(
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

export function createSelfMealFallbackItem(
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
    imageUrl: DEFAULT_IMAGES[mealType],
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

export function enforceRestaurantSafetyForDay(day: TripDay): void {
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

    // Keep the original restaurant rather than showing "Repas libre"
    // A real restaurant with uncertain hours/distance is better than no suggestion
    console.warn(`[Schedule Safety] Day ${day.dayNumber}: keeping "${item.title}" despite validation issue (no better alternative found)`);
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
export function createCheckoutItem(
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
    imageUrl: hotel.photos?.[0] || DEFAULT_IMAGES.checkout,
    estimatedCost: 0,
  };
}

/**
 * Helper: Create a TripItem for hotel check-in (Day 1)
 */
export function createCheckinItem(
  hotel: Accommodation,
  checkinTime: string,
  dayNumber: number,
  orderIndex: number
): TripItem {
  return {
    id: `checkin-${dayNumber}`,
    dayNumber,
    startTime: checkinTime,
    endTime: addMinutes(checkinTime, 15),
    type: 'checkin',
    title: `Check-in — ${hotel.name}`,
    description: `Arrivée et installation à l'hôtel`,
    locationName: hotel.name || '',
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    orderIndex,
    duration: 15,
    imageUrl: hotel.photos?.[0] || DEFAULT_IMAGES.checkin,
    estimatedCost: 0,
    accommodation: hotel,
  };
}

/**
 * Helper: Create a TripItem for an activity
 */
/**
 * Normalize activity titles: convert all-caps or all-lowercase to Title Case.
 * Preserves mixed-case titles that are already correct.
 */
export function normalizeActivityTitle(title: string, destination?: string): string {
  if (!title) return 'Activity';
  let cleaned = title.trim();
  if (!cleaned) return 'Activity';

  // Strip pipe/em-dash SEO suffixes: "Jardin Majorelle | Musée Berbère" → "Jardin Majorelle"
  cleaned = cleaned.split(/\s*[|—]\s*/)[0].trim();

  // Remove trailing city name ONLY when separated by delimiter: "Place Jemaa el-Fna - Marrakech" → "Place Jemaa el-Fna"
  // But NOT "Les Bains de Marrakech" (city is part of the proper name)
  if (destination) {
    const destLower = destination.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffixPattern = new RegExp(`\\s*[-–,]\\s*${destLower}\\s*$`, 'i');
    cleaned = cleaned.replace(suffixPattern, '').trim();
  }

  // Truncate to 60 chars at word boundary
  if (cleaned.length > 60) {
    const truncated = cleaned.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');
    cleaned = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  }

  if (!cleaned) return title.trim().split(/\s*[|—]\s*/)[0]; // Safety fallback

  // Case normalization: detect all-uppercase, all-lowercase, or mostly-uppercase
  const letters = cleaned.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (letters.length === 0) return cleaned;

  const upperCount = letters.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length;
  const isAllUpper = letters === letters.toUpperCase() && letters.length > 3;
  const isAllLower = letters === letters.toLowerCase() && letters.length > 3;
  // "musée YVES SAINT LAURENT marrakech" → mostly uppercase, needs normalizing
  const isMostlyUpper = !isAllUpper && letters.length > 5 && (upperCount / letters.length) > 0.5;

  if (!isAllUpper && !isAllLower && !isMostlyUpper) return cleaned; // Already mixed case

  // Articles/prepositions to keep lowercase (FR + EN)
  const smallWords = new Set([
    'de', 'du', 'des', 'le', 'la', 'les', 'l', 'un', 'une', 'et', 'ou', 'à', 'au', 'aux', 'en',
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'with', 'by',
  ]);

  return cleaned
    .toLowerCase()
    .split(/(\s+|-|'|')/)
    .map((part, index) => {
      if (/^\s+$/.test(part) || part === '-' || part === "'" || part === '\u2019') return part;
      // Always capitalize first word
      if (index === 0) return part.charAt(0).toUpperCase() + part.slice(1);
      // Keep small words lowercase (unless first)
      if (smallWords.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

export function createTravelItem(
  leg: TravelLeg,
  startTime: string,
  durationMinutes: number,
  dayNumber: number,
  orderIndex: number,
  toActivity: ScoredActivity
): TripItem {
  const modeLabels: Record<string, string> = { walk: 'Marche', transit: 'Transport en commun', drive: 'Trajet en voiture' };
  const modeLabel = modeLabels[leg.mode] || 'Trajet';
  const distLabel = leg.distanceKm < 1
    ? `${Math.round(leg.distanceKm * 1000)}m`
    : `${leg.distanceKm.toFixed(1)}km`;
  return {
    id: `travel-${dayNumber}-${orderIndex}`,
    dayNumber,
    startTime,
    endTime: addMinutes(startTime, durationMinutes),
    type: 'transport',
    title: `${modeLabel} — ${distLabel}`,
    description: `${leg.fromName} → ${leg.toName}`,
    locationName: '',
    latitude: toActivity.latitude,
    longitude: toActivity.longitude,
    orderIndex,
    duration: durationMinutes,
    estimatedCost: 0,
    routePolylineFromPrevious: leg.polyline,
  };
}

function generateFallbackDescription(title: string, activityType?: string, destination?: string): string {
  if (!destination) return title;
  const typeLabels: Record<string, string> = {
    culture: 'ce lieu culturel',
    nature: 'cet espace naturel',
    museum: 'ce musée',
    monument: 'ce monument',
    park: 'ce parc',
    market: 'ce marché',
    religious: 'ce lieu de culte',
    viewpoint: 'ce point de vue',
    entertainment: 'ce lieu de divertissement',
  };
  const label = activityType && typeLabels[activityType];
  if (label) return `Découvrez ${label} à ${destination}`;
  return `${title} à ${destination}`;
}

export function createActivityItem(
  activity: ScoredActivity,
  startTime: string,
  duration: number,
  dayNumber: number,
  orderIndex: number,
  destination?: string
): TripItem {
  const title = normalizeActivityTitle(activity.name || 'Activity', destination);
  const description = activity.description || generateFallbackDescription(title, activity.type, destination);
  // Generate Google Maps place URL for every activity
  const googleMapsPlaceUrl = activity.googlePlaceId
    ? `https://www.google.com/maps/place/?q=place_id:${activity.googlePlaceId}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name || title)}&query=${activity.latitude},${activity.longitude}`;
  return {
    id: activity.id || `activity-${Date.now()}-${Math.random()}`,
    dayNumber,
    startTime,
    endTime: addMinutes(startTime, duration),
    type: 'activity',
    title,
    description,
    locationName: activity.name || '',
    latitude: activity.latitude,
    longitude: activity.longitude,
    orderIndex,
    duration,
    rating: activity.rating,
    estimatedCost: activity.estimatedCost,
    imageUrl: activity.imageUrl,
    photoGallery: activity.photoGallery,
    bookingUrl: activity.bookingUrl,
    googleMapsPlaceUrl,
    mustSee: activity.mustSee,
    openingHours: activity.openingHours,
    openingHoursByDay: activity.openingHoursByDay,
    website: activity.website,
  };
}

/**
 * Helper: Create a TripItem for a restaurant
 */
export function createRestaurantItem(
  meal: MealPlacement,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  startTime: string,
  duration: number,
  dayNumber: number,
  orderIndex: number
): TripItem {
  const restaurant = meal.primary;
  const mealLabel = getMealLabel(mealType);
  return {
    id: `meal-${dayNumber}-${mealType}`,
    dayNumber,
    startTime,
    endTime: addMinutes(startTime, duration),
    type: 'restaurant',
    title: `${mealLabel} — ${restaurant.name || 'Restaurant'}`,
    description: `${mealLabel} à ${restaurant.name}`,
    locationName: restaurant.name || '',
    latitude: restaurant.latitude || 0,
    longitude: restaurant.longitude || 0,
    orderIndex,
    duration,
    mealType,
    imageUrl: DEFAULT_IMAGES[mealType],
    restaurant,
    restaurantAlternatives: meal.alternatives,
    rating: restaurant.rating,
    estimatedCost: restaurant.priceLevel ? restaurant.priceLevel * 15 : undefined,
    bookingUrl: restaurant.reservationUrl || restaurant.googleMapsUrl,
    googleMapsPlaceUrl: restaurant.googlePlaceId
      ? `https://www.google.com/maps/place/?q=place_id:${restaurant.googlePlaceId}`
      : restaurant.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.name || '')}`,
    openingHoursByDay: restaurant.openingHours,
  };
}

/**
 * Helper: Get closing time for an activity on a given day
 */
export function getActivityCloseTime(activity: ScoredActivity, dayDate: Date): string | null {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayDate.getDay()];

  // Always-open public spaces (piazzas, parks, streets) — no closing time
  // BUT only if no explicit opening hours are provided (e.g. "Le Jardin Secret" has hours)
  const hasExplicitHours = activity.openingHoursByDay || activity.openingHours;
  if (!hasExplicitHours) {
    const alwaysOpenKeywords = /piazza|plaza|place|park|jardin|garden|fontaine|fountain|bridge|pont|quartier|street|via|campo|square/i;
    if (alwaysOpenKeywords.test(activity.name || '')) return null;
  }

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
    // Skip default 18:00 when no per-day data exists (hard-coded fallback, not real)
    if (!activity.openingHoursByDay && activity.openingHours.close === '18:00' && activity.openingHours.open === '09:00') return null;
    return activity.openingHours.close;
  }

  return null; // No hours info — treat as always open
}

/**
 * Helper: Get opening time for an activity on a given day
 */
export function getActivityOpenTime(activity: ScoredActivity, dayDate: Date): string | null {
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

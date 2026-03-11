/**
 * Pipeline V3 — Step 8+9+10 Unified Scheduler
 *
 * Single-pass scheduler that replaces the sequential step8 (place restaurants) →
 * step9 (schedule timeline) → step10 (repair pass) with a unified approach.
 *
 * Key improvement: restaurants are placed IN-SITU at the traveler's real position
 * instead of at cluster centroids.
 *
 * Reuses helpers from step8, step9, step10 — no logic duplication.
 */

import type { TripPreferences, Restaurant, Accommodation } from '../types';
import type { TripDay, TripItem } from '../types/trip';
import type { ActivityCluster, ScoredActivity, FetchedData } from './types';
import type { DayTravelTimes, TravelLeg } from './step7b-travel-times';
import type { DayTimeWindow } from './step4-anchor-transport';
import type { RepairResult, RepairAction } from './step10-repair';

import { calculateDistance } from '../services/geocoding';

// Helpers from step8 (restaurant selection)
import {
  findBestRestaurant,
  createHotelBreakfastRestaurant,
  getDayDateForCluster,
} from './step8-place-restaurants';

// Helpers from step9 (item factories + scheduling logic)
import {
  createTravelItem,
  createActivityItem,
  createRestaurantItem,
  createCheckoutItem,
  createCheckinItem,
  createSelfMealFallbackItem,
  getActivityCloseTime,
  getActivityOpenTime,
  enforceRestaurantSafetyForDay,
  isRestaurantOpenForSlot,
} from './step9-schedule';

// Helpers from step10 (cross-day repair)
import {
  fixOpeningHoursViolations,
  ensureMustSees,
  fillGapsByExtension,
  fillLargeGapsWithFreeTime,
} from './step10-repair';

// Utils
import { timeToMin, minToTime, addMinutes, isPastEnd, ensureAfter, sortAndReindexItems } from './utils/time';
import { getClusterCentroid } from './utils/geo';
import { isDuplicateActivityCandidate } from './utils/activityDedup';
import { isOpenAtTime } from './utils/opening-hours';
import { enrichWithTicketingLinks } from '../services/officialTicketing';

// ============================================
// Public API
// ============================================

/**
 * Unified scheduler: schedules activities + restaurants + repair in a single pass.
 * Restaurants are placed IN-SITU at the traveler's real position.
 *
 * Returns the same shape as repairPass() → drop-in replacement for step8+9+10.
 */
export function unifiedScheduleV3Days(
  clusters: ActivityCluster[],
  travelTimes: DayTravelTimes[],
  timeWindows: DayTimeWindow[],
  hotel: Accommodation | null,
  preferences: TripPreferences,
  data: FetchedData,
  restaurants: Restaurant[],
  allActivities: ScoredActivity[],
  destCoords: { lat: number; lng: number }
): RepairResult {
  const repairs: RepairAction[] = [];
  const unresolvedViolations: string[] = [];

  const startDate = preferences.startDate || new Date();
  const startDateStr = (startDate instanceof Date ? startDate : new Date(startDate)).toISOString().split('T')[0];
  const destination = preferences.destination || '';
  const dietary = preferences.dietary || [];
  const hotelLatLng = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;

  // Track used restaurants across ALL days to avoid the same restaurant on multiple days
  const usedRestaurantIds = new Set<string>();
  // Global dedup: track activity IDs already placed across all days
  const globalPlacedIds = new Set<string>();

  const days: TripDay[] = [];

  // ----------------------------------------------------------------
  // PER-DAY SCHEDULING
  // ----------------------------------------------------------------
  for (const cluster of clusters) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + cluster.dayNumber - 1);
    const dayDateForRestaurant = getDayDateForCluster(startDate, cluster.dayNumber);

    const timeWindow = timeWindows.find(w => w.dayNumber === cluster.dayNumber);
    const dayTravel = travelTimes.find(t => t.dayNumber === cluster.dayNumber);

    const dayStartTime = timeWindow?.activityStartTime || '08:30';
    const dayEndTime = timeWindow?.activityEndTime || '21:00';

    const items: TripItem[] = [];
    let currentTime = dayStartTime;
    let currentPosition = hotelLatLng || getClusterCentroid(cluster.activities);
    let orderIndex = 0;
    let lunchPlaced = false;
    const isLastDay = cluster.dayNumber === clusters.length;

    // Detect remote clusters: ≤1 activity far from hotel → use hotel as dinner anchor
    const isRemoteCluster = cluster.activities.length <= 1 && hotelLatLng && cluster.activities[0] &&
      calculateDistance(cluster.activities[0].latitude, cluster.activities[0].longitude, hotelLatLng.lat, hotelLatLng.lng) > 3;
    if (isRemoteCluster) {
      console.log(`[Unified] Day ${cluster.dayNumber}: remote cluster — dinner will anchor near hotel`);
    }

    // 1. DEDUP activities (ID global + similarity intra-day)
    const seenInDay: Array<{ id?: string; name?: string; latitude?: number; longitude?: number }> = [];
    cluster.activities = cluster.activities.filter(act => {
      const id = act.id || act.name;
      if (globalPlacedIds.has(id)) {
        console.log(`[Unified] Dedup: removing globally placed "${act.name}" from Day ${cluster.dayNumber}`);
        return false;
      }
      const candidate = { id: act.id, name: act.name, latitude: act.latitude, longitude: act.longitude };
      const duplicateOf = seenInDay.find(existing => isDuplicateActivityCandidate(candidate, existing));
      if (duplicateOf) {
        console.log(`[Unified] Dedup: removing similar "${act.name}" (duplicate of "${duplicateOf.name}") from Day ${cluster.dayNumber}`);
        return false;
      }
      seenInDay.push(candidate);
      return true;
    });

    // Meal eligibility: derived from time window, not ad-hoc heuristics
    const dayStartMin = timeToMin(dayStartTime);
    const dayEndMin = timeToMin(dayEndTime);
    const canHaveBreakfast = dayStartMin < 10 * 60 && dayStartMin < dayEndMin;   // start before 10:00 AND window exists
    const canHaveLunch = dayStartMin < 13 * 60 && dayEndMin > 12 * 60; // window spans lunch hours
    const canHaveDinner = dayEndMin >= 19 * 60;        // day extends past 19:00

    if (!canHaveLunch) {
      lunchPlaced = true; // prevent lunch trigger
    }
    if (!canHaveBreakfast || !canHaveLunch) {
      console.log(`[Unified] Day ${cluster.dayNumber}: constrained window (${dayStartTime}–${dayEndTime}) — breakfast:${canHaveBreakfast} lunch:${canHaveLunch} dinner:${canHaveDinner}`);
    }

    // 2. BREAKFAST (anchor = hotel or cluster centroid) — only if day starts early enough
    if (canHaveBreakfast) {
      const breakfastAnchor = hotelLatLng || getClusterCentroid(cluster.activities);
      if (breakfastAnchor) {
        const breakfastPlacement = findBestRestaurant(
          restaurants, breakfastAnchor, 'breakfast',
          0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
        );
        // Validate restaurant is actually open at the specific slot time (not just generic meal window)
        const breakfastEnd = addMinutes(currentTime, 45);
        const breakfastOpenAtSlot = breakfastPlacement && dayDateForRestaurant
          ? isRestaurantOpenForSlot(breakfastPlacement.primary, dayDateForRestaurant, currentTime, breakfastEnd)
          : true; // no date → skip check
        if (breakfastPlacement && breakfastPlacement.distanceFromAnchor <= 0.8 && breakfastOpenAtSlot) {
          items.push(createRestaurantItem(
            { ...breakfastPlacement, anchorName: 'Hotel' },
            'breakfast', currentTime, 45, cluster.dayNumber, orderIndex++
          ));
          usedRestaurantIds.add(breakfastPlacement.primary.id);
        } else if (hotelLatLng && hotel) {
          // Hotel breakfast fallback
          const hotelBreakfast = createHotelBreakfastRestaurant(hotelLatLng, hotel.name || 'Hôtel');
          items.push(createRestaurantItem(
            { mealType: 'breakfast', anchorPoint: hotelLatLng, anchorName: 'Hotel', primary: hotelBreakfast, alternatives: [], distanceFromAnchor: 0 },
            'breakfast', currentTime, 45, cluster.dayNumber, orderIndex++
          ));
        } else {
          // No hotel — "Repas libre"
          items.push(createSelfMealFallbackItem('breakfast', currentTime, 45, cluster.dayNumber, orderIndex++, breakfastAnchor));
        }
      }
      currentTime = addMinutes(currentTime, 60); // 45min eat + 15min travel
    }

    // 2b. CHECKIN (Day 1, after breakfast — before activities)
    if (cluster.dayNumber === 1 && hotel) {
      const checkinTime = hotel.checkInTime || '15:00';
      items.push(createCheckinItem(hotel, checkinTime, cluster.dayNumber, orderIndex++));
    }

    // 3. CHECKOUT (last day, after breakfast)
    if (isLastDay && hotel) {
      let checkoutTime = hotel.checkOutTime || '11:00';
      // Cap checkout before departure cutoff (early flights need early checkout)
      if (timeWindow?.hasDepartureTransport && timeToMin(checkoutTime) > dayEndMin) {
        checkoutTime = minToTime(Math.max(dayEndMin - 15, dayStartMin));
        console.log(`[Unified] Day ${cluster.dayNumber}: capping checkout to ${checkoutTime} (departure constraint)`);
      }
      items.push(createCheckoutItem(hotel, checkoutTime, cluster.dayNumber, orderIndex++));
      const afterCheckout = addMinutes(checkoutTime, 15);
      if (!isPastEnd(afterCheckout, dayEndTime)) {
        currentTime = afterCheckout;
      }
    }

    // 4. SORT activities: must-sees that close early go first
    cluster.activities.sort((a, b) => {
      if (a.mustSee && !b.mustSee) return -1;
      if (!a.mustSee && b.mustSee) return 1;
      // Among must-sees, those that close early go first
      if (a.mustSee && b.mustSee) {
        const aClose = getActivityCloseTime(a, dayDate);
        const bClose = getActivityCloseTime(b, dayDate);
        if (aClose && bClose) return timeToMin(aClose) - timeToMin(bClose);
        if (aClose) return -1;
        if (bClose) return 1;
      }
      return 0;
    });

    // 5. ACTIVITY LOOP
    for (let i = 0; i < cluster.activities.length; i++) {
      // 5a. Check budget time
      if (isPastEnd(currentTime, dayEndTime)) {
        console.log(`[Unified] Day ${cluster.dayNumber}: stopping at activity ${i}/${cluster.activities.length} (${currentTime} >= ${dayEndTime})`);
        break;
      }

      const act = cluster.activities[i];
      const travelLeg = dayTravel?.legs.find(l => l.toId === act.id);

      // Compute travel time
      let pendingTravelTime = 0;
      if (travelLeg && travelLeg.durationMinutes > 5) {
        const afterTravel = addMinutes(currentTime, travelLeg.durationMinutes);
        if (!isPastEnd(afterTravel, dayEndTime)) {
          pendingTravelTime = travelLeg.durationMinutes;
        }
      }
      const timeAfterTravel = pendingTravelTime > 0 ? addMinutes(currentTime, pendingTravelTime) : currentTime;

      // 5c. LUNCH WINDOW — place lunch IN-SITU at real position
      if (!lunchPlaced && timeToMin(timeAfterTravel) >= 12 * 60) {
        // Commit pending travel before lunch
        if (pendingTravelTime > 0 && travelLeg) {
          items.push(createTravelItem(travelLeg, currentTime, pendingTravelTime, cluster.dayNumber, orderIndex++, act));
          currentTime = timeAfterTravel;
          currentPosition = { lat: act.latitude, lng: act.longitude };
          pendingTravelTime = 0;
        }

        // Place lunch at REAL position (not centroid!) — try multiple slots
        const lunchAnchor = currentPosition || getClusterCentroid(cluster.activities);
        if (lunchAnchor) {
          const lunchSlots = [currentTime, '12:30', '13:00', '13:30'];
          let lunchPlacement: ReturnType<typeof findBestRestaurant> = null;
          let finalLunchTime = currentTime;
          const candidatePlacement = findBestRestaurant(
            restaurants, lunchAnchor, 'lunch',
            0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
          );
          if (candidatePlacement) {
            // Verify restaurant is actually open at the specific slot time
            for (const slot of lunchSlots) {
              const slotEnd = addMinutes(slot, 75);
              if (isRestaurantOpenForSlot(candidatePlacement.primary, dayDate, slot, slotEnd)) {
                lunchPlacement = candidatePlacement;
                finalLunchTime = slot;
                break;
              }
            }
          }
          // Skip hotel-fallback: on day trips, prefer "Repas libre" over a restaurant 16km away
          if (lunchPlacement) {
            items.push(createRestaurantItem(
              { ...lunchPlacement, anchorName: 'Position actuelle' },
              'lunch', finalLunchTime, 75, cluster.dayNumber, orderIndex++
            ));
            usedRestaurantIds.add(lunchPlacement.primary.id);
          } else {
            items.push(createSelfMealFallbackItem('lunch', currentTime, 75, cluster.dayNumber, orderIndex++, lunchAnchor));
          }
          currentTime = addMinutes(finalLunchTime, 90);
        } else {
          currentTime = addMinutes(currentTime, 90);
        }
        lunchPlaced = true;

        if (isPastEnd(currentTime, dayEndTime)) {
          console.log(`[Unified] Day ${cluster.dayNumber}: stopping after lunch (${currentTime} >= ${dayEndTime})`);
          break;
        }
      }

      // 5d. CHECK opening hours BEFORE placement
      const duration = act.duration || 60;
      const checkTime = pendingTravelTime > 0 ? timeAfterTravel : currentTime;

      // Departure day: skip activities that would END past the departure window
      const hasDepartureWindow = timeWindow?.hasDepartureTransport ?? false;
      if (hasDepartureWindow) {
        const actEndTime = addMinutes(checkTime, duration);
        if (isPastEnd(actEndTime, dayEndTime)) {
          console.log(`[Unified] Day ${cluster.dayNumber}: skipping "${act.name}" (ends ${actEndTime} past departure ${dayEndTime})`);
          continue;  // continue, pas break — une activité plus courte pourrait tenir
        }
      }

      const hardEndTime = addMinutes(dayEndTime, 30);
      if (isPastEnd(checkTime, hardEndTime)) {
        break;
      }

      let placementTime = checkTime;
      const actCloseTime = getActivityCloseTime(act, dayDate);
      if (actCloseTime) {
        const actEnd = addMinutes(placementTime, duration);
        if (isPastEnd(actEnd, actCloseTime)) {
          if (act.mustSee) {
            // Shift start to fit within hours
            const closeMin = timeToMin(actCloseTime);
            const dayStartMin = timeToMin(dayStartTime);
            const candidateStartMin = closeMin - duration;
            if (candidateStartMin >= dayStartMin) {
              placementTime = minToTime(candidateStartMin);
              console.warn(`[Unified] Day ${cluster.dayNumber}: must-see "${act.name}" shifted to ${placementTime} to fit before close ${actCloseTime}`);
            } else {
              placementTime = minToTime(Math.max(dayStartMin, closeMin - duration));
              console.warn(`[Unified] Day ${cluster.dayNumber}: must-see "${act.name}" placed at ${placementTime} (truncated, must-see priority)`);
            }
          } else {
            // Non must-see: skip
            console.log(`[Unified] Day ${cluster.dayNumber}: skipping "${act.name}" (ends past close ${actCloseTime})`);
            continue;
          }
        }
      }

      // 5e. Wait for opening if too early
      const actOpenTime = getActivityOpenTime(act, dayDate);
      if (actOpenTime && !isPastEnd(placementTime, actOpenTime)) {
        placementTime = actOpenTime;
      }

      // 5f. Commit travel + place activity
      if (pendingTravelTime > 0 && travelLeg) {
        items.push(createTravelItem(travelLeg, currentTime, pendingTravelTime, cluster.dayNumber, orderIndex++, act));
        currentTime = timeAfterTravel;
      }
      currentTime = placementTime;

      items.push(createActivityItem(act, currentTime, duration, cluster.dayNumber, orderIndex++, destination));
      globalPlacedIds.add(act.id || act.name);
      currentPosition = { lat: act.latitude, lng: act.longitude };
      currentTime = addMinutes(currentTime, duration + 10); // 10min buffer
    }

    // 6. LUNCH FALLBACK if not placed (cap at 14:30)
    if (!lunchPlaced) {
      const idealLunch = ensureAfter(currentTime, '12:00');
      const lunchTime = isPastEnd(idealLunch, '14:30') ? '14:30' : idealLunch;
      if (!isPastEnd(lunchTime, addMinutes(dayEndTime, 30))) {
        const lunchAnchor = currentPosition || getClusterCentroid(cluster.activities);
        if (lunchAnchor) {
          const lunchPlacement = findBestRestaurant(
            restaurants, lunchAnchor, 'lunch',
            0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
          );
          if (lunchPlacement) {
            items.push(createRestaurantItem(
              { ...lunchPlacement, anchorName: 'Position actuelle' },
              'lunch', lunchTime, 75, cluster.dayNumber, orderIndex++
            ));
            usedRestaurantIds.add(lunchPlacement.primary.id);
          } else {
            items.push(createSelfMealFallbackItem('lunch', lunchTime, 75, cluster.dayNumber, orderIndex++, lunchAnchor));
          }
        }
        currentTime = addMinutes(lunchTime, 90);
        lunchPlaced = true;
      }
    }

    // 7. DINNER (anchor = last activity position; remote clusters → hotel)
    if (canHaveDinner) {
      // Remote day trip: dine near hotel after returning
      const dinnerAnchor = isRemoteCluster && hotelLatLng
        ? hotelLatLng
        : (currentPosition || hotelLatLng || getClusterCentroid(cluster.activities));
      if (dinnerAnchor) {
        let dinnerTime = ensureAfter(currentTime, '19:00');
        if (isPastEnd(dinnerTime, '21:30')) {
          dinnerTime = '21:00';
        }
        // Try multiple slots for dinner
        const dinnerSlots = [dinnerTime, '19:30', '20:00', '20:30'];
        let dinnerPlacement: ReturnType<typeof findBestRestaurant> = null;
        let finalDinnerTime = dinnerTime;
        const candidateDinner = findBestRestaurant(
          restaurants, dinnerAnchor, 'dinner',
          0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
        );
        if (candidateDinner) {
          // Verify restaurant is actually open at the specific slot time
          for (const slot of dinnerSlots) {
            const slotEnd = addMinutes(slot, 90);
            if (isRestaurantOpenForSlot(candidateDinner.primary, dayDate, slot, slotEnd)) {
              dinnerPlacement = candidateDinner;
              finalDinnerTime = slot;
              break;
            }
          }
        }
        // Skip hotel-fallback: on day trips, prefer "Repas libre" over a restaurant 16km away
        if (dinnerPlacement) {
          items.push(createRestaurantItem(
            { ...dinnerPlacement, anchorName: 'Position actuelle' },
            'dinner', finalDinnerTime, 90, cluster.dayNumber, orderIndex++
          ));
          usedRestaurantIds.add(dinnerPlacement.primary.id);
        } else {
          items.push(createSelfMealFallbackItem('dinner', dinnerTime, 90, cluster.dayNumber, orderIndex++, dinnerAnchor));
        }
      }
    }

    // 8. MUST-SEE FORCE-INJECTION: evict weakest if must-see missing
    const missingMustSees = cluster.activities.filter(
      act => act.mustSee && !globalPlacedIds.has(act.id || act.name)
    );
    if (missingMustSees.length > 0) {
      const nonMustSeeIndices = items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.type === 'activity' && !item.mustSee);

      for (const missing of missingMustSees) {
        if (nonMustSeeIndices.length === 0) break;
        nonMustSeeIndices.sort((a, b) => (a.item.rating ?? 0) - (b.item.rating ?? 0));
        const victim = nonMustSeeIndices.shift()!;

        const replaceDuration = missing.duration || 60;
        const replaceItem = createActivityItem(missing, victim.item.startTime, replaceDuration, cluster.dayNumber, victim.item.orderIndex, destination);
        console.warn(`[Unified] Day ${cluster.dayNumber}: must-see "${missing.name}" forced — evicting "${victim.item.title}"`);
        items[victim.idx] = replaceItem;
        globalPlacedIds.add(missing.id || missing.name);
      }

      sortAndReindexItems(items);
    }

    days.push({
      dayNumber: cluster.dayNumber,
      date: dayDate,
      items,
      theme: '',
      dayNarrative: '',
    });
  }

  // ----------------------------------------------------------------
  // POST-PROCESSING (same logic as step9)
  // ----------------------------------------------------------------

  // 9. Sort items by startTime
  for (const day of days) {
    sortAndReindexItems(day.items);
  }

  // 10. Cascade-shift overlaps (+5min buffer)
  for (const day of days) {
    const timeWindow = timeWindows.find(w => w.dayNumber === day.dayNumber);
    const dayEndStr = timeWindow?.activityEndTime || '21:00';
    const hasDeparture = timeWindow?.hasDepartureTransport ?? false;
    const cascadeBuffer = hasDeparture ? 30 : 120;
    const hardEndMin = timeToMin(addMinutes(dayEndStr, cascadeBuffer));

    for (let i = 0; i < day.items.length - 1; i++) {
      const curr = day.items[i];
      const next = day.items[i + 1];

      const currEndMin = timeToMin(curr.endTime || '00:00');
      const nextStartMin = timeToMin(next.startTime || '00:00');

      if (currEndMin > nextStartMin) {
        const shiftedStart = currEndMin + 5;
        const itemDuration = next.duration
          ? next.duration
          : Math.max(0, timeToMin(next.endTime || '00:00') - nextStartMin);
        const shiftedEnd = shiftedStart + Math.max(itemDuration, 0);

        if (shiftedStart >= hardEndMin) {
          console.log(`[Unified] Overlap fix: dropping "${next.title}" on Day ${day.dayNumber} (past hard end)`);
          day.items.splice(i + 1, 1);
          i--;
          continue;
        }

        // Convert to "Repas libre" if shifting restaurant outside opening hours
        if (next.type === 'restaurant' && next.restaurant && !next.qualityFlags?.includes('self_meal_fallback')) {
          const newStart = minToTime(shiftedStart);
          const newEnd = minToTime(shiftedEnd);
          if (!isRestaurantOpenForSlot(next.restaurant, day.date, newStart, newEnd)) {
            const mealLabel = next.mealType === 'breakfast' ? 'Petit-déjeuner' : next.mealType === 'lunch' ? 'Déjeuner' : 'Dîner';
            console.log(`[Unified] Overlap fix: converting "${next.title}" to Repas libre on Day ${day.dayNumber} (restaurant closed after shift to ${newStart})`);
            next.title = `${mealLabel} — Repas libre`;
            next.description = 'Pique-nique / courses / repas maison';
            next.locationName = 'Repas libre';
            next.restaurant = undefined;
            next.restaurantAlternatives = undefined;
            next.qualityFlags = ['self_meal_fallback'];
          }
        }

        // Drop if shifting activity outside opening hours
        if (next.type === 'activity') {
          const mockAct = {
            name: next.title || '',
            openingHours: next.openingHours as { open: string; close: string } | undefined,
            openingHoursByDay: next.openingHoursByDay as Record<string, { open: string; close: string } | null> | undefined,
          } as ScoredActivity;
          if (!isOpenAtTime(mockAct, day.date, minToTime(shiftedStart), minToTime(shiftedEnd))) {
            console.log(`[Unified] Overlap fix: dropping "${next.title}" on Day ${day.dayNumber} (outside opening hours after shift)`);
            day.items.splice(i + 1, 1);
            i--;
            continue;
          }
        }

        next.startTime = minToTime(shiftedStart);
        if (next.type === 'activity' && next.duration) {
          next.endTime = addMinutes(next.startTime, next.duration);
        } else {
          next.endTime = minToTime(shiftedEnd);
        }
      }
    }
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // 11. Hard stop: drop activities after dayEndTime (departure days) or 22:00
  for (const day of days) {
    const timeWindow = timeWindows.find(w => w.dayNumber === day.dayNumber);
    const hasDeparture = timeWindow?.hasDepartureTransport ?? false;
    const dayEndForHardStop = hasDeparture
      ? timeToMin(timeWindow?.activityEndTime || '22:00')
      : 22 * 60;
    const beforeCount = day.items.length;
    day.items = day.items.filter(item => {
      if (item.type !== 'activity') return true;
      const startMin = timeToMin(item.startTime || '00:00');
      if (startMin >= dayEndForHardStop) {
        console.log(`[Unified] Hard stop: dropping "${item.title}" on Day ${day.dayNumber} (past ${minToTime(dayEndForHardStop)})`);
        return false;
      }
      // Departure days: also check END time
      if (hasDeparture && item.endTime) {
        const endMin = timeToMin(item.endTime);
        if (endMin > dayEndForHardStop) {
          console.log(`[Unified] Hard stop: dropping "${item.title}" on Day ${day.dayNumber} (ends past departure window)`);
          return false;
        }
      }
      return true;
    });
    if (day.items.length < beforeCount) {
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }

  // 12. Restaurant safety: revalidate after shifts
  for (const day of days) {
    enforceRestaurantSafetyForDay(day);
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // 13. Enrichissement ticketing (Viator, Tiqets, official)
  for (const day of days) {
    enrichWithTicketingLinks(day.items, destination);
  }

  // Consolidate bookingUrl
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity' && !item.bookingUrl) {
        const enriched = item as any;
        item.bookingUrl = enriched.officialBookingUrl || enriched.viatorUrl || enriched.tiqetsUrl || undefined;
      }
    }
  }

  // 14. Empty day rescue: steal from busiest day
  for (const day of days) {
    const activityCount = day.items.filter(i => i.type === 'activity').length;
    if (activityCount > 0) continue;

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
    if (!busiestDay || busiestCount < 2) continue;

    const donorActivities = busiestDay.items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.type === 'activity' && !item.mustSee)
      .sort((a, b) => (a.item.rating ?? 0) - (b.item.rating ?? 0));

    const toSteal = Math.min(2, donorActivities.length, Math.floor(busiestCount / 2));
    for (let s = 0; s < toSteal; s++) {
      const victim = donorActivities[s];
      const stolenItem = { ...victim.item, dayNumber: day.dayNumber };
      day.items.push(stolenItem);
      busiestDay.items.splice(victim.idx - s, 1);
      console.log(`[Unified] Empty day rescue: moved "${stolenItem.title}" from Day ${busiestDay.dayNumber} → Day ${day.dayNumber}`);
    }

    // Remove orphan transport items
    busiestDay.items = busiestDay.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      const next = busiestDay!.items[i + 1];
      const prev = busiestDay!.items[i - 1];
      return next && prev;
    });

    for (const d of [day, busiestDay]) {
      sortAndReindexItems(d.items);
    }
  }

  // 15. Remove orphan transport items
  for (const day of days) {
    day.items = day.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      const prev = day.items[i - 1];
      const next = day.items[i + 1];
      const hasActivityNeighbor = (prev && prev.type === 'activity') || (next && next.type === 'activity');
      if (!hasActivityNeighbor) {
        console.log(`[Unified] Removing orphan transport "${item.description}" on Day ${day.dayNumber}`);
        return false;
      }
      return true;
    });
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // 16. Fix transport labels
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

  // ----------------------------------------------------------------
  // REPAIR CROSS-DAY (step10 simplified — no validateRestaurantDistances)
  // ----------------------------------------------------------------

  // 17. Cross-day swap for opening hours violations
  fixOpeningHoursViolations(days, startDateStr, repairs, unresolvedViolations);

  // 18. Must-see injection from the full pool
  ensureMustSees(days, allActivities, startDateStr, repairs, unresolvedViolations);

  // 19. Extension gaps 30-90min
  fillGapsByExtension(days, startDateStr, repairs);

  // 20. Insert free time for gaps >90min
  fillLargeGapsWithFreeTime(days);

  // 21. P0.2 distance sweep: replace restaurants >1.5km from nearest activity with self-meal fallback
  // Runs AFTER repairs (cross-day swaps + must-see injection can change which activities are on each day)
  const P02_MAX_KM = 1.5;
  const anchorTypes = new Set(['activity', 'checkin', 'checkout', 'hotel']);
  for (const day of days) {
    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i];
      if (item.type !== 'restaurant') continue;
      if (item.qualityFlags?.includes('self_meal_fallback')) continue;
      const mealType = item.mealType;
      if (!mealType || mealType === 'breakfast') continue;
      if (!item.latitude || !item.longitude) continue;

      const nearestDist = day.items
        .filter(a => anchorTypes.has(a.type) && a.latitude && a.longitude)
        .reduce((min, a) => {
          const d = calculateDistance(item.latitude!, item.longitude!, a.latitude!, a.longitude!);
          return d < min ? d : min;
        }, Infinity);

      if (nearestDist > P02_MAX_KM) {
        console.warn(`[Unified P0.2] Day ${day.dayNumber}: "${item.title}" is ${(nearestDist * 1000).toFixed(0)}m from nearest activity — replacing with self-meal`);
        const anchor = item.latitude && item.longitude ? { lat: item.latitude, lng: item.longitude } : null;
        day.items[i] = createSelfMealFallbackItem(mealType as 'lunch' | 'dinner', item.startTime, item.duration || 75, day.dayNumber, item.orderIndex, anchor);
      }
    }
  }

  // 22. Final departure-day sweep: remove items past departure window
  // Runs AFTER all repairs to catch items injected by steps 14, 17, 18, 20
  for (const day of days) {
    const tw = timeWindows.find(w => w.dayNumber === day.dayNumber);
    if (!tw?.hasDepartureTransport) continue;

    const cutoffMin = timeToMin(tw.activityEndTime);
    const beforeCount = day.items.length;

    day.items = day.items.filter(item => {
      // Keep transport, restaurants, checkin/checkout, hotel — handled separately
      if (item.type !== 'activity' && item.type !== 'free_time') return true;

      const startMin = timeToMin(item.startTime || '00:00');
      if (startMin >= cutoffMin) {
        console.log(`[Unified] Departure sweep: dropping "${item.title}" on Day ${day.dayNumber} (starts ${item.startTime} past ${tw.activityEndTime})`);
        return false;
      }
      // Also check END for activities
      if (item.type === 'activity' && item.endTime) {
        const endMin = timeToMin(item.endTime);
        if (endMin > cutoffMin) {
          console.log(`[Unified] Departure sweep: dropping "${item.title}" on Day ${day.dayNumber} (ends ${item.endTime} past ${tw.activityEndTime})`);
          return false;
        }
      }
      return true;
    });

    if (day.items.length < beforeCount) {
      sortAndReindexItems(day.items);
    }
  }

  // 23. Re-run orphan transport removal after all repairs + departure sweep
  for (const day of days) {
    const beforeLen = day.items.length;
    day.items = day.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      const prev = day.items[i - 1];
      const next = day.items[i + 1];
      const hasActivityNeighbor = (prev && prev.type === 'activity') || (next && next.type === 'activity');
      if (!hasActivityNeighbor) {
        console.log(`[Unified] Post-repair orphan transport: removing "${item.description}" on Day ${day.dayNumber}`);
        return false;
      }
      return true;
    });
    if (day.items.length < beforeLen) {
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }

  // 24. Re-fix transport labels
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

  // Final sort after repairs
  for (const day of days) {
    sortAndReindexItems(day.items);
  }

  // Log summary
  console.log(`[Unified] ${repairs.length} repairs performed, ${unresolvedViolations.length} unresolved`);
  for (const r of repairs) {
    console.log(`  [${r.type}] Day ${r.dayNumber}: "${r.itemTitle}" — ${r.description}`);
  }
  for (const v of unresolvedViolations) {
    console.warn(`  [UNRESOLVED] ${v}`);
  }

  return { days, repairs, unresolvedViolations };
}

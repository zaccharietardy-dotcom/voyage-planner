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
import { generateTrainOmioLink, buildDirectionsUrl } from '../services/linkGenerator';

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
import { timeToMin, minToTime, addMinutes, isPastEnd, ensureAfter, sortAndReindexItems, roundUpTo5 } from './utils/time';
import { getClusterCentroid } from './utils/geo';
import { isDuplicateActivityCandidate } from './utils/activityDedup';
import { isOpenAtTime } from './utils/opening-hours';
import { enrichWithTicketingLinks } from '../services/officialTicketing';
import { isNightlifeActivity } from './step2-score';
import {
  getV31RescueStage,
  isProtectedTripItem,
  rescueStageAtLeast,
  type PlannerRole,
} from './v31-rescue';

function strictMealPlacement(
  placement: ReturnType<typeof findBestRestaurant>,
  dayDate: Date,
  startTime: string,
  duration: number,
  maxDistKm: number
): boolean {
  if (!placement) return false;
  if (placement.distanceFromAnchor > maxDistKm) return false;
  return isRestaurantOpenForSlot(
    placement.primary,
    dayDate,
    startTime,
    addMinutes(startTime, duration)
  );
}

function stampDayPlanningMeta(day: TripDay, role?: PlannerRole): void {
  for (const item of day.items) {
    item.planningMeta = {
      planningToken: item.planningMeta?.planningToken || `${item.id}:${day.dayNumber}:${item.orderIndex}`,
      protectedReason: item.planningMeta?.protectedReason,
      sourcePackId: item.planningMeta?.sourcePackId,
      plannerRole: item.planningMeta?.plannerRole || role,
      originalDayNumber: item.planningMeta?.originalDayNumber ?? day.dayNumber,
    };
  }
}

function findDayRole(day: TripDay): PlannerRole | undefined {
  for (const item of day.items) {
    if (item.planningMeta?.plannerRole) return item.planningMeta.plannerRole;
  }
  return undefined;
}

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
  destCoords: { lat: number; lng: number },
  options: { plannerVersion?: 'v3.0' | 'v3.1'; rescueStage?: number } = {}
): RepairResult {
  const repairs: RepairAction[] = [];
  const unresolvedViolations: string[] = [];
  const plannerVersion = options.plannerVersion || 'v3.0';
  const rescueStage = plannerVersion === 'v3.1'
    ? (options.rescueStage ?? getV31RescueStage())
    : 0;
  const rescueDiagnostics = {
    protectedBreakCount: 0,
    lateMealReplacementCount: 0,
    dayTripEvictionCount: 0,
    finalIntegrityFailures: 0,
  };

  const startDate = preferences.startDate || new Date();
  const startDateStr = (startDate instanceof Date ? startDate : new Date(startDate)).toISOString().split('T')[0];
  const destination = preferences.destination || '';
  const dietary = preferences.dietary || [];
  const hotelLatLng = hotel ? { lat: hotel.latitude, lng: hotel.longitude } : null;

  // Track used restaurants across ALL days to avoid the same restaurant on multiple days
  const usedRestaurantIds = new Set<string>();
  // Global dedup: track activity IDs already placed across all days
  const globalPlacedIds = new Set<string>();
  const dayRestaurantPools = new Map<number, Restaurant[]>();
  const expectedProtectedItems = new Map<string, { dayNumber: number; reason?: string }>();

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

    // Transit-only day: no activities possible (e.g., late arrival after 21:00)
    const isTransitOnly = dayStartTime === dayEndTime;
    if (isTransitOnly) {
      console.log(`[Unified] Day ${cluster.dayNumber}: transit-only (${dayStartTime} == ${dayEndTime}), skipping all scheduling`);
      days.push({
        dayNumber: cluster.dayNumber,
        date: dayDate,
        items: [],
        theme: '',
        dayNarrative: '',
      });
      continue;
    }

    const items: TripItem[] = [];
    let currentTime = dayStartTime;
    let currentPosition = hotelLatLng || getClusterCentroid(cluster.activities);
    let orderIndex = 0;
    let lunchPlaced = false;
    let dinnerPlaced = false;
    const isLastDay = cluster.dayNumber === clusters.length;
    // Per-day restaurant pool (may be enriched for day trip clusters)
    let dayRestaurants = restaurants;

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
    let canHaveBreakfast = dayStartMin < 10 * 60 && dayStartMin < dayEndMin;   // start before 10:00 AND window exists
    const canHaveLunch = dayStartMin < 13 * 60 && dayEndMin > 12 * 60; // window spans lunch hours
    const canHaveDinner = dayEndMin >= 19 * 60;        // day extends past 19:00

    if (rescueStageAtLeast(rescueStage, 3) && canHaveBreakfast) {
      const breakfastConsumesUntil = dayStartMin + 60;
      const breakfastBlockingActivity = cluster.activities.find((activity) => {
        const closeTime = getActivityCloseTime(activity, dayDate);
        if (!closeTime) return false;
        const latestStart = timeToMin(closeTime) - (activity.duration || 60);
        return latestStart <= breakfastConsumesUntil;
      });
      if (breakfastBlockingActivity) {
        canHaveBreakfast = false;
        console.log(
          `[Unified] Day ${cluster.dayNumber}: skipping breakfast to protect early-closing "${breakfastBlockingActivity.name}"`
        );
      }
    }

    if (!canHaveLunch) {
      lunchPlaced = true; // prevent lunch trigger
    }
    if (!canHaveDinner) {
      dinnerPlaced = true; // no dinner possible, skip
    }
    if (!canHaveBreakfast || !canHaveLunch) {
      console.log(`[Unified] Day ${cluster.dayNumber}: constrained window (${dayStartTime}–${dayEndTime}) — breakfast:${canHaveBreakfast} lunch:${canHaveLunch} dinner:${canHaveDinner}`);
    }

    // 2. BREAKFAST (anchor = hotel or cluster centroid) — only if day starts early enough
    if (canHaveBreakfast) {
      const breakfastAnchor = hotelLatLng || getClusterCentroid(cluster.activities);
      if (breakfastAnchor) {
        const breakfastPlacement = findBestRestaurant(
          dayRestaurants, breakfastAnchor, 'breakfast',
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

    // 3b. DAY TRIP: override outbound travel time using curated suggestion data
    // The haversine fallback gives dist*4 min which is wildly wrong for long distances
    // (e.g. 90km → 360min instead of the real 120min bus). Use the suggestion's transport duration.
    let dayTripOutboundMin: number | undefined;
    let dayTripSuggestion: typeof data.dayTripSuggestions[number] | undefined;
    if (cluster.isDayTrip && cluster.dayTripDestination && data.dayTripSuggestions) {
      dayTripSuggestion = data.dayTripSuggestions.find(s =>
        s.destination === cluster.dayTripDestination || s.name?.includes(cluster.dayTripDestination!)
      );
      if (dayTripSuggestion) {
        dayTripOutboundMin = dayTripSuggestion.transportDurationMin;
        console.log(`[Unified] Day ${cluster.dayNumber}: day trip "${cluster.dayTripDestination}" — outbound ${dayTripOutboundMin}min (${dayTripSuggestion.transportMode})`);
      }
      // Merge day trip destination restaurants into pool for this day
      const dtRestaurants = data.dayTripRestaurants?.[cluster.dayTripDestination!];
      if (dtRestaurants?.length) {
        dayRestaurants = [...restaurants, ...dtRestaurants];
        console.log(`[Unified] Day ${cluster.dayNumber}: added ${dtRestaurants.length} restaurants from "${cluster.dayTripDestination}"`);
      }
    }
    dayRestaurantPools.set(cluster.dayNumber, dayRestaurants);

    // 4. SORT activities: only promote must-sees with truly urgent close times
    // Preserves the geographic order from the intra-day router for everything else
    cluster.activities.sort((a, b) => {
      const aClose = a.mustSee ? getActivityCloseTime(a, dayDate) : null;
      const bClose = b.mustSee ? getActivityCloseTime(b, dayDate) : null;
      const aUrgent = aClose && (timeToMin(aClose) - (a.duration || 60)) <= dayStartMin + 120;
      const bUrgent = bClose && (timeToMin(bClose) - (b.duration || 60)) <= dayStartMin + 120;
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      return 0; // preserve router's geographic order
    });

    // 5. ACTIVITY LOOP
    for (let i = 0; i < cluster.activities.length; i++) {
      // 5a. Check budget time
      if (isPastEnd(currentTime, dayEndTime)) {
        console.log(`[Unified] Day ${cluster.dayNumber}: stopping at activity ${i}/${cluster.activities.length} (${currentTime} >= ${dayEndTime})`);
        break;
      }

      const act = cluster.activities[i];
      const prevId = items.length > 0 ? (items[items.length - 1].id || '') : (hotel?.id || 'hotel');
      // Match travel leg: exact IDs first, then by toId only, prefer legs with polyline data
      let travelLeg = dayTravel?.legs.find(l => l.toId === act.id && l.fromId === prevId)
        || dayTravel?.legs.find(l => (l.toId === act.id || l.toId === act.name) && l.polyline)
        || dayTravel?.legs.find(l => l.toId === act.id || l.toId === act.name);
      if (!travelLeg && currentPosition) {
        // Fallback: estimate from haversine distance
        const dist = calculateDistance(currentPosition.lat, currentPosition.lng, act.latitude, act.longitude);
        const walkSpeed = 4.5; // km/h
        let duration = dist <= 1 ? Math.ceil((dist / walkSpeed) * 60) : Math.ceil(dist * 4);

        // Day trip override: use curated transport duration for the first long leg (hotel → destination)
        if (dayTripOutboundMin && i === 0 && dist > 10) {
          duration = dayTripOutboundMin;
        }

        travelLeg = {
          fromId: prevId || 'current',
          toId: act.id || act.name,
          fromName: '',
          toName: act.name,
          distanceKm: dist,
          durationMinutes: Math.max(duration, 5),
          mode: dist <= 1 ? 'walk' : 'transit',
          isEstimate: true,
        };
      }

      // Compute travel time (cap with day trip suggestion if available)
      let pendingTravelTime = 0;
      if (travelLeg && travelLeg.durationMinutes > 5) {
        let legDuration = travelLeg.durationMinutes;
        if (cluster.isDayTrip) {
          if (dayTripOutboundMin && i === 0 && travelLeg.distanceKm > 10) {
            // First leg (hotel → destination): cap with curated duration
            legDuration = Math.min(legDuration, dayTripOutboundMin);
          } else if (i > 0 && travelLeg.distanceKm <= 20) {
            // Intra-destination legs: cap at reasonable local transit (Directions API
            // often routes back through origin city for remote areas like Kawaguchiko)
            const maxLocalMin = Math.max(15, Math.ceil(travelLeg.distanceKm * 3));
            if (legDuration > maxLocalMin) {
              console.log(`[Unified] Day ${cluster.dayNumber}: capping intra-day-trip travel ${travelLeg.fromName}→${travelLeg.toName} from ${legDuration}min to ${maxLocalMin}min (local estimate)`);
              legDuration = maxLocalMin;
            }
          }
        }
        const afterTravel = addMinutes(currentTime, legDuration);
        if (!isPastEnd(afterTravel, dayEndTime)) {
          pendingTravelTime = legDuration;
        }
      }
      const timeAfterTravel = pendingTravelTime > 0 ? roundUpTo5(addMinutes(currentTime, pendingTravelTime)) : currentTime;

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
            dayRestaurants, lunchAnchor, 'lunch',
            0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
          );
          if (candidatePlacement) {
            // Verify restaurant is actually open at the specific slot time
            for (const slot of lunchSlots) {
              if (strictMealPlacement(candidatePlacement, dayDate, slot, 75, 0.8)) {
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
      // Ensure placement respects travel end time (no backward jumps)
      if (pendingTravelTime > 0 && travelLeg) {
        // Travel cannot start before previous activity ended
        const travelStart = currentTime;
        items.push(createTravelItem(travelLeg, travelStart, pendingTravelTime, cluster.dayNumber, orderIndex++, act));
        currentTime = timeAfterTravel;
      }
      // Placement must be >= currentTime (can't start activity before arriving)
      if (timeToMin(placementTime) < timeToMin(currentTime)) {
        placementTime = currentTime;
      }
      // Re-check: override may have pushed past closing → skip activity
      if (actCloseTime && isPastEnd(addMinutes(placementTime, duration), actCloseTime)) {
        console.warn(`[Unified] Day ${cluster.dayNumber}: skipping "${act.name}" — too late for close ${actCloseTime}`);
        continue;
      }
      currentTime = placementTime;

      items.push(createActivityItem(act, currentTime, duration, cluster.dayNumber, orderIndex++, destination));
      globalPlacedIds.add(act.id || act.name);
      currentPosition = { lat: act.latitude, lng: act.longitude };
      currentTime = roundUpTo5(addMinutes(currentTime, duration + 10)); // 10min buffer, rounded to 5min

      // 5f-bis. LUNCH CATCH-UP — activity crossed noon without triggering lunch
      if (!lunchPlaced && timeToMin(currentTime) >= 12 * 60) {
        const lunchAnchor = currentPosition || getClusterCentroid(cluster.activities);
        if (lunchAnchor) {
          const lunchSlots = [currentTime, '12:30', '13:00', '13:30'];
          let lunchPlacement: ReturnType<typeof findBestRestaurant> = null;
          let finalLunchTime = currentTime;
          const candidatePlacement = findBestRestaurant(
            dayRestaurants, lunchAnchor, 'lunch',
            0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
          );
          if (candidatePlacement) {
            for (const slot of lunchSlots) {
              if (strictMealPlacement(candidatePlacement, dayDate, slot, 75, 0.8)) {
                lunchPlacement = candidatePlacement;
                finalLunchTime = slot;
                break;
              }
            }
          }
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
        }
        lunchPlaced = true;
      }

      // 5g. DINNER WINDOW — place dinner IN-SITU when time >= 19:00
      if (!dinnerPlaced && timeToMin(currentTime) >= 19 * 60) {
        const dinnerAnchorInSitu = currentPosition || hotelLatLng || getClusterCentroid(cluster.activities);
        if (dinnerAnchorInSitu) {
          const dinnerStartCap = timeToMin(currentTime) <= 21 * 60 ? currentTime : '21:00';
          const dinnerSlots = [dinnerStartCap, '19:30', '20:00', '20:30'];
          let dinnerPlacement: ReturnType<typeof findBestRestaurant> = null;
          let finalDinnerTime = currentTime;
          const candidateDinner = findBestRestaurant(
            dayRestaurants, dinnerAnchorInSitu, 'dinner',
            0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
          );
          if (candidateDinner) {
            for (const slot of dinnerSlots) {
              if (strictMealPlacement(candidateDinner, dayDate, slot, 90, 0.8)) {
                dinnerPlacement = candidateDinner;
                finalDinnerTime = slot;
                break;
              }
            }
          }
          if (dinnerPlacement) {
            items.push(createRestaurantItem(
              { ...dinnerPlacement, anchorName: 'Position actuelle' },
              'dinner', finalDinnerTime, 90, cluster.dayNumber, orderIndex++
            ));
            usedRestaurantIds.add(dinnerPlacement.primary.id);
          } else {
            items.push(createSelfMealFallbackItem('dinner', currentTime, 90, cluster.dayNumber, orderIndex++, dinnerAnchorInSitu));
          }
          currentTime = addMinutes(finalDinnerTime, 100); // 90min dinner + 10min buffer
          dinnerPlaced = true;
        }
      }
    }

    // 6. LUNCH FALLBACK if not placed — a late lunch beats no lunch
    if (!lunchPlaced) {
      const idealLunch = ensureAfter(currentTime, '12:00');
      const lunchTime = isPastEnd(idealLunch, '14:30') ? '14:30' : idealLunch;
      {
        const lunchAnchor = currentPosition || getClusterCentroid(cluster.activities);
        if (lunchAnchor) {
          const lunchPlacement = findBestRestaurant(
            dayRestaurants, lunchAnchor, 'lunch',
            0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
          );
          if (lunchPlacement && strictMealPlacement(lunchPlacement, dayDate, lunchTime, 75, 0.8)) {
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
    if (canHaveDinner && !dinnerPlaced) {
      // Remote day trip: dine near hotel after returning
      const dinnerAnchor = isRemoteCluster && hotelLatLng
        ? hotelLatLng
        : (currentPosition || hotelLatLng || getClusterCentroid(cluster.activities));
      if (dinnerAnchor) {
        let dinnerTime = ensureAfter(currentTime, '19:00');
        if (isPastEnd(dinnerTime, '21:00')) {
          dinnerTime = '21:00';
        }
        // Try multiple slots for dinner
        const dinnerSlots = [dinnerTime, '19:30', '20:00', '20:30'];
        let dinnerPlacement: ReturnType<typeof findBestRestaurant> = null;
        let finalDinnerTime = dinnerTime;
        const candidateDinner = findBestRestaurant(
          dayRestaurants, dinnerAnchor, 'dinner',
          0.8, 3.5, 2, dietary, usedRestaurantIds, dayDateForRestaurant
        );
        if (candidateDinner) {
          // Verify restaurant is actually open at the specific slot time
          for (const slot of dinnerSlots) {
            if (strictMealPlacement(candidateDinner, dayDate, slot, 90, 0.8)) {
              dinnerPlacement = candidateDinner;
              finalDinnerTime = slot;
              break;
            }
          }
        }
        // Skip hotel-fallback: on day trips, prefer "Repas libre" over a restaurant 16km away
        if (dinnerPlacement && strictMealPlacement(dinnerPlacement, dayDate, finalDinnerTime, 90, 0.8)) {
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

    // 7b. NIGHTLIFE — place 1-2 nightlife activities after dinner (22:00–23:59)
    const hasNightlifePref = preferences.activities?.includes('nightlife');
    const isArrivalDay = timeWindow?.hasArrivalTransport ?? false;
    const isDepartureDay = timeWindow?.hasDepartureTransport ?? false;
    const nextDayIsDeparture = timeWindows.find(w => w.dayNumber === cluster.dayNumber + 1)?.hasDepartureTransport ?? false;
    const isEligibleForNightlife = hasNightlifePref && !isDepartureDay && !nextDayIsDeparture && !isTransitOnly;

    if (isEligibleForNightlife) {
      // Arrival day: cap at 1 nightlife activity (traveler just arrived)
      const MAX_NIGHTLIFE = isArrivalDay ? 1 : 2;
      const MAX_NIGHTLIFE_DIST_KM = 2;
      const nightlifeAnchor = currentPosition || hotelLatLng || getClusterCentroid(cluster.activities);

      const nightlifeCandidates = allActivities
        .filter(act => isNightlifeActivity(act))
        .filter(act => !globalPlacedIds.has(act.id || act.name))
        // Proximity filter: only venues within 2km of current position
        .filter(act => {
          if (!nightlifeAnchor) return true;
          const dist = calculateDistance(act.latitude, act.longitude, nightlifeAnchor.lat, nightlifeAnchor.lng);
          return dist <= MAX_NIGHTLIFE_DIST_KM;
        })
        .sort((a, b) => b.score - a.score);

      let nightlifeTime = '22:00';
      let nightlifePlaced = 0;
      const placedNightlifeTypes = new Set<string>();

      for (const act of nightlifeCandidates) {
        if (nightlifePlaced >= MAX_NIGHTLIFE) break;

        // Variety guard: classify nightlife sub-type, skip if already placed
        const nightlifeType = classifyNightlifeType(act.name || '');
        if (nightlifeType && placedNightlifeTypes.has(nightlifeType)) continue;

        const duration = Math.min(act.duration || 90, 120);
        const endMin = timeToMin(nightlifeTime) + duration;
        if (endMin > 23 * 60 + 59) break;

        items.push(createActivityItem(act, nightlifeTime, duration, cluster.dayNumber, orderIndex++, destination));
        globalPlacedIds.add(act.id || act.name);
        currentPosition = { lat: act.latitude, lng: act.longitude };
        nightlifeTime = roundUpTo5(addMinutes(nightlifeTime, duration + 10));
        nightlifePlaced++;
        if (nightlifeType) placedNightlifeTypes.add(nightlifeType);

        console.log(`[Unified] Day ${cluster.dayNumber}: nightlife "${act.name}" placed at ${nightlifeTime} (type=${nightlifeType || 'other'})`);
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

    const dayEntry: TripDay = {
      dayNumber: cluster.dayNumber,
      date: dayDate,
      items,
      theme: '',
      dayNarrative: '',
      ...(cluster.isDayTrip ? {
        isDayTrip: true,
        dayTripDestination: cluster.dayTripDestination,
      } : {}),
    };

    // Enrich day trip transport items with Omio booking link
    if (cluster.isDayTrip && cluster.dayTripDestination) {
      const suggestion = data.dayTripSuggestions?.find(s =>
        s.destination === cluster.dayTripDestination || s.name?.includes(cluster.dayTripDestination!)
      );
      const dayDateStr = dayDate instanceof Date
        ? dayDate.toISOString().split('T')[0]
        : String(dayDate).split('T')[0];

      // Find the first long transport item (>5km = going to day trip destination)
      const outboundTransport = dayEntry.items.find(item =>
        item.type === 'transport' && (item.distanceFromPrevious ?? 0) > 5
      );
      if (outboundTransport) {
        const dest = cluster.dayTripDestination;
        const origin = preferences.destination;
        const mode = suggestion?.transportMode || 'train';

        if (mode === 'train' || mode === 'bus') {
          outboundTransport.bookingUrl = generateTrainOmioLink(
            origin, dest, dayDateStr, preferences.groupSize || 2
          );
          outboundTransport.title = `${mode === 'train' ? 'Train' : 'Bus'} → ${dest} — ${outboundTransport.title.split('—').pop()?.trim() || ''}`;
        }
        if (suggestion) {
          outboundTransport.description = `${origin} → ${dest} (${suggestion.transportMode}, ~${suggestion.transportDurationMin}min, ~${suggestion.estimatedCostPerPerson}€/pers)`;
        }
      }

      // Add return transport item after the last activity/restaurant
      const returnDurationMin = dayTripSuggestion?.transportDurationMin || dayTripOutboundMin || 60;
      const lastItem = dayEntry.items[dayEntry.items.length - 1];
      if (lastItem) {
        const returnStartTime = lastItem.endTime || '20:00';
        const returnEndTime = addMinutes(returnStartTime, returnDurationMin);
        const dest = cluster.dayTripDestination!;
        const origin = preferences.destination;
        const mode = suggestion?.transportMode || 'train';
        const modeLabel = mode === 'train' ? 'Train' : mode === 'bus' ? 'Bus' : 'Transport';
        const distKm = suggestion?.distanceKm || 0;

        const returnItem: TripItem = {
          id: `travel-return-${cluster.dayNumber}`,
          dayNumber: cluster.dayNumber,
          startTime: returnStartTime,
          endTime: returnEndTime,
          type: 'transport',
          title: `${modeLabel} retour → ${origin} — ${distKm ? distKm + 'km' : ''}`,
          description: `${dest} → ${origin} (~${returnDurationMin}min)`,
          locationName: '',
          latitude: hotelLatLng?.lat || destCoords.lat,
          longitude: hotelLatLng?.lng || destCoords.lng,
          orderIndex: dayEntry.items.length,
          duration: returnDurationMin,
          estimatedCost: suggestion?.estimatedCostPerPerson || 0,
          transportToPrevious: 'public',
          distanceFromPrevious: distKm,
          timeFromPrevious: returnDurationMin,
          bookingUrl: (mode === 'train' || mode === 'bus')
            ? generateTrainOmioLink(dest, origin, dayDateStr, preferences.groupSize || 2)
            : undefined,
        };
        dayEntry.items.push(returnItem);
      }
    }

    stampDayPlanningMeta(dayEntry, cluster.plannerRole);
    for (const item of dayEntry.items) {
      if (!item.planningMeta?.planningToken || !item.planningMeta?.protectedReason) continue;
      expectedProtectedItems.set(item.planningMeta.planningToken, {
        dayNumber: item.planningMeta.originalDayNumber ?? dayEntry.dayNumber,
        reason: item.planningMeta.protectedReason,
      });
    }
    days.push(dayEntry);
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

        // Re-search restaurant if shifting outside opening hours
        if (next.type === 'restaurant' && next.restaurant && !next.qualityFlags?.includes('self_meal_fallback')) {
          const newStart = minToTime(shiftedStart);
          const newEnd = minToTime(shiftedEnd);
          if (!isRestaurantOpenForSlot(next.restaurant, day.date, newStart, newEnd)) {
            const mealLabel = next.mealType === 'breakfast' ? 'Petit-déjeuner' : next.mealType === 'lunch' ? 'Déjeuner' : 'Dîner';
            const mealType = next.mealType as 'breakfast' | 'lunch' | 'dinner';
            // Try to find a replacement restaurant open at the new time
            const anchor = next.latitude && next.longitude
              ? { lat: next.latitude, lng: next.longitude }
              : null;
            let replaced = false;
            if (anchor) {
              const replacement = findBestRestaurant(
                dayRestaurantPools.get(day.dayNumber) || restaurants, anchor, mealType,
                0.8, 3.5, 2, dietary, usedRestaurantIds,
                day.date
              );
              if (replacement && strictMealPlacement(replacement, day.date, newStart, itemDuration || 75, 0.8)) {
                console.log(`[Unified] Overlap fix: replaced "${next.title}" with "${replacement.primary.name}" on Day ${day.dayNumber} (open at ${newStart})`);
                next.title = `${mealLabel} — ${replacement.primary.name}`;
                next.restaurant = replacement.primary;
                next.restaurantAlternatives = replacement.alternatives;
                next.latitude = replacement.primary.latitude;
                next.longitude = replacement.primary.longitude;
                next.locationName = replacement.primary.name;
                usedRestaurantIds.add(replacement.primary.id);
                replaced = true;
              }
            }
            if (!replaced) {
              console.log(`[Unified] Overlap fix: converting "${next.title}" to Repas libre on Day ${day.dayNumber} (no restaurant open after shift to ${newStart})`);
              next.title = `${mealLabel} — Repas libre`;
              next.description = 'Pique-nique / courses / repas maison';
              next.locationName = 'Repas libre';
              next.restaurant = undefined;
              next.restaurantAlternatives = undefined;
              next.qualityFlags = ['self_meal_fallback'];
            }
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

  // 10b. Re-label meals shifted outside their natural window
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'restaurant' || !item.mealType) continue;
      const startMin = timeToMin(item.startTime || '00:00');

      const actualMealType =
        startMin < 11 * 60 ? 'breakfast' :
        startMin < 15 * 60 ? 'lunch' : 'dinner';

      if (actualMealType !== item.mealType && item.mealType !== 'breakfast') {
        const oldLabel = item.mealType === 'lunch' ? 'Déjeuner' : 'Dîner';
        const newLabel = actualMealType === 'lunch' ? 'Déjeuner' : 'Dîner';
        if (item.title) {
          item.title = item.title.replace(oldLabel, newLabel);
        }
        item.mealType = actualMealType;
        console.log(`[Unified] Meal relabel: ${oldLabel} → ${newLabel} at ${item.startTime} on Day ${day.dayNumber}`);
      }
    }
  }

  // 11. Hard stop: drop activities after dayEndTime (departure days) or 22:00
  const hasNightlifePrefGlobal = preferences.activities?.includes('nightlife');
  for (const day of days) {
    const timeWindow = timeWindows.find(w => w.dayNumber === day.dayNumber);
    const hasDeparture = timeWindow?.hasDepartureTransport ?? false;
    const dayEndForHardStop = hasDeparture
      ? timeToMin(timeWindow?.activityEndTime || '22:00')
      : 22 * 60;
    const beforeCount = day.items.length;
    day.items = day.items.filter(item => {
      if (item.type === 'flight' || item.type === 'checkout') return true;
      const startMin = timeToMin(item.startTime || '00:00');
      if (startMin >= dayEndForHardStop) {
        // Exempt nightlife items on non-departure days
        if (hasNightlifePrefGlobal && !hasDeparture && startMin < 24 * 60
            && item.type === 'activity' && isNightlifeActivity({ name: item.title })) {
          return true;
        }
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
    rescueDiagnostics.lateMealReplacementCount += enforceRestaurantSafetyForDay(day, {
      strictLunchDinner: rescueStageAtLeast(rescueStage, 2),
      dayRestaurants: dayRestaurantPools.get(day.dayNumber),
      dietary,
      usedRestaurantIds,
    });
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

    if (rescueStageAtLeast(rescueStage, 1)) {
      const dayRole = findDayRole(day);
      const twRescue = timeWindows.find(w => w.dayNumber === day.dayNumber);
      const rescueStartMin = timeToMin(twRescue?.activityStartTime || '00:00');
      const rescueEndMin = timeToMin(twRescue?.activityEndTime || '00:00');
      if (dayRole === 'arrival' || dayRole === 'departure' || rescueStartMin >= rescueEndMin) {
        console.log(`[Unified] Empty day rescue: skipping Day ${day.dayNumber} (${dayRole || 'constrained'}, no safe rescue window)`);
        continue;
      }
    }

    // Skip departure days with no activity window — stealing activities that will
    // be removed by the departure sweep is destructive (loses them from both days)
    const twRescue = timeWindows.find(w => w.dayNumber === day.dayNumber);
    if (twRescue?.hasDepartureTransport) {
      const rescueStartMin = timeToMin(twRescue.activityStartTime);
      const rescueEndMin = timeToMin(twRescue.activityEndTime);
      if (rescueStartMin >= rescueEndMin) {
        console.log(`[Unified] Empty day rescue: skipping Day ${day.dayNumber} (departure, no activity window)`);
        continue;
      }
    }

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
      .filter(({ item }) => item.type === 'activity' && !item.mustSee && timeToMin(item.startTime || '00:00') < 22 * 60)
      .sort((a, b) => (a.item.rating ?? 0) - (b.item.rating ?? 0));

    const toSteal = Math.min(2, donorActivities.length, Math.floor(busiestCount / 2));
    for (let s = 0; s < toSteal; s++) {
      const victim = donorActivities[s];
      const stolenItem = { ...victim.item, dayNumber: day.dayNumber };
      day.items.push(stolenItem);
      busiestDay.items.splice(victim.idx - s, 1);
      console.log(`[Unified] Empty day rescue: moved "${stolenItem.title}" from Day ${busiestDay.dayNumber} → Day ${day.dayNumber}`);
    }

    // Remove orphan transport items (but keep day trip return transport)
    busiestDay.items = busiestDay.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      if (item.id?.startsWith('travel-return-')) return true;
      const next = busiestDay!.items[i + 1];
      const prev = busiestDay!.items[i - 1];
      return next && prev;
    });

    for (const d of [day, busiestDay]) {
      sortAndReindexItems(d.items);
    }
  }

  // 15. Remove orphan transport items (but keep day trip return transport)
  for (const day of days) {
    day.items = day.items.filter((item, i) => {
      if (item.type !== 'transport') return true;
      if (item.id?.startsWith('travel-return-')) return true; // day trip return transport
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
  const changedDays = new Set<number>();

  // 17. Cross-day swap for opening hours violations
  fixOpeningHoursViolations(days, startDateStr, repairs, unresolvedViolations, { rescueStage, changedDays });

  // 18. Must-see injection from the full pool
  ensureMustSees(days, allActivities, startDateStr, repairs, unresolvedViolations, globalPlacedIds, { rescueStage, changedDays });

  // 19. Extension gaps 30-90min
  fillGapsByExtension(days, startDateStr, repairs);

  // 20. Insert free time for gaps >90min
  fillLargeGapsWithFreeTime(days);

  // 20b. Re-cascade overlaps after repairs (must-see injection can create new overlaps)
  for (const day of days) {
    sortAndReindexItems(day.items);
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
        next.startTime = minToTime(shiftedStart);
        next.endTime = minToTime(shiftedStart + Math.max(itemDuration, 0));
        if (next.type === 'activity' && next.duration) {
          next.endTime = minToTime(shiftedStart + next.duration);
        }
      }
    }
  }

  if (rescueStageAtLeast(rescueStage, 2)) {
    for (const day of days) {
      rescueDiagnostics.lateMealReplacementCount += enforceRestaurantSafetyForDay(day, {
        strictLunchDinner: true,
        dayRestaurants: dayRestaurantPools.get(day.dayNumber),
        dietary,
        usedRestaurantIds,
      });
      stampDayPlanningMeta(day, findDayRole(day));
      sortAndReindexItems(day.items);
    }
  }

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
        rescueDiagnostics.lateMealReplacementCount++;
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
      // Keep flights (departure flight is past cutoff by definition)
      if (item.type === 'flight') return true;
      // Keep checkout (already capped by pass 3)
      if (item.type === 'checkout') return true;

      const startMin = timeToMin(item.startTime || '00:00');
      if (startMin >= cutoffMin) {
        if (rescueStageAtLeast(rescueStage, 3) && isProtectedTripItem(item)) {
          unresolvedViolations.push(`Day ${day.dayNumber}: protected "${item.title}" exceeds departure cutoff`);
          rescueDiagnostics.protectedBreakCount++;
          rescueDiagnostics.finalIntegrityFailures++;
          return true;
        }
        console.log(`[Unified] Departure sweep: dropping "${item.title}" on Day ${day.dayNumber} (starts ${item.startTime} past ${tw.activityEndTime})`);
        return false;
      }
      if (item.endTime && timeToMin(item.endTime) > cutoffMin) {
        if (rescueStageAtLeast(rescueStage, 3) && isProtectedTripItem(item)) {
          unresolvedViolations.push(`Day ${day.dayNumber}: protected "${item.title}" ends past departure cutoff`);
          rescueDiagnostics.protectedBreakCount++;
          rescueDiagnostics.finalIntegrityFailures++;
          return true;
        }
        console.log(`[Unified] Departure sweep: dropping "${item.title}" on Day ${day.dayNumber} (ends ${item.endTime} past ${tw.activityEndTime})`);
        return false;
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
      if (item.id?.startsWith('travel-return-')) return true; // day trip return transport
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
    stampDayPlanningMeta(day, findDayRole(day));
  }

  if (rescueStageAtLeast(rescueStage, 3)) {
    for (const day of days) {
      rescueDiagnostics.lateMealReplacementCount += enforceRestaurantSafetyForDay(day, {
        strictLunchDinner: true,
        dayRestaurants: dayRestaurantPools.get(day.dayNumber),
        dietary,
        usedRestaurantIds,
      });

      const filteredItems: TripItem[] = [];
      for (const item of day.items) {
        if (
          item.type === 'activity'
          && (item.openingHours || item.openingHoursByDay)
          && !isOpenAtTime(item as unknown as ScoredActivity, day.date, item.startTime, item.endTime)
        ) {
          if (isProtectedTripItem(item)) {
            unresolvedViolations.push(`Day ${day.dayNumber}: protected "${item.title}" outside opening hours (${item.startTime}-${item.endTime})`);
            rescueDiagnostics.protectedBreakCount++;
            rescueDiagnostics.finalIntegrityFailures++;
            filteredItems.push(item);
          } else {
            console.log(`[Unified Integrity] Dropping optional "${item.title}" on Day ${day.dayNumber} (outside opening hours)`);
          }
          continue;
        }
        filteredItems.push(item);
      }

      day.items = filteredItems;
      sortAndReindexItems(day.items);
      stampDayPlanningMeta(day, findDayRole(day));
    }

    const finalProtectedTokens = new Map<string, { dayNumber: number; reason?: string }>();
    for (const day of days) {
      for (const item of day.items) {
        if (!item.planningMeta?.planningToken || !item.planningMeta?.protectedReason) continue;
        finalProtectedTokens.set(item.planningMeta.planningToken, {
          dayNumber: day.dayNumber,
          reason: item.planningMeta.protectedReason,
        });
      }
    }

    for (const [token, expected] of expectedProtectedItems.entries()) {
      const current = finalProtectedTokens.get(token);
      if (!current) {
        rescueDiagnostics.protectedBreakCount++;
        rescueDiagnostics.finalIntegrityFailures++;
        if (expected.reason === 'day_trip' || expected.reason === 'day_trip_anchor') {
          rescueDiagnostics.dayTripEvictionCount++;
        }
        unresolvedViolations.push(`Protected planner item "${token}" missing after repairs`);
        continue;
      }
      if (current.dayNumber !== expected.dayNumber) {
        rescueDiagnostics.protectedBreakCount++;
        rescueDiagnostics.finalIntegrityFailures++;
        if (expected.reason === 'day_trip' || expected.reason === 'day_trip_anchor') {
          rescueDiagnostics.dayTripEvictionCount++;
        }
        unresolvedViolations.push(`Protected planner item "${token}" moved from Day ${expected.dayNumber} to Day ${current.dayNumber}`);
      }
    }
  }

  // Log summary
  console.log(`[Unified] ${repairs.length} repairs performed, ${unresolvedViolations.length} unresolved`);
  for (const r of repairs) {
    console.log(`  [${r.type}] Day ${r.dayNumber}: "${r.itemTitle}" — ${r.description}`);
  }
  for (const v of unresolvedViolations) {
    console.warn(`  [UNRESOLVED] ${v}`);
  }

  return { days, repairs, unresolvedViolations, rescueDiagnostics };
}

// ── Nightlife sub-type classification ───────────────────────────────────────

const NIGHTLIFE_TYPE_RULES: Array<{ type: string; keywords: RegExp }> = [
  { type: 'bar', keywords: /\b(bar|pub|brewery|brasserie|cocktail|rooftop bar|speakeasy|tavern)\b/i },
  { type: 'club', keywords: /\b(club|disco|discoteca|discotheque|nightclub)\b/i },
  { type: 'live_music', keywords: /\b(jazz|concert|live music|musique live|blues|fado|flamenco)\b/i },
  { type: 'show', keywords: /\b(show|cabaret|opera|ballet|spectacle|burlesque|comedy|stand.?up)\b/i },
];

function classifyNightlifeType(name: string): string | null {
  for (const rule of NIGHTLIFE_TYPE_RULES) {
    if (rule.keywords.test(name)) return rule.type;
  }
  return null;
}

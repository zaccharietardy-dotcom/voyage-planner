/**
 * Pipeline V3 — Step 10: Repair Pass
 *
 * Post-scheduling repair to fix remaining violations:
 * 1. Cross-day swap for activities outside opening hours
 * 2. Replacement with alternative activities from the pool
 * 3. Extension of adjacent activities to fill gaps
 * 4. Restaurant re-search if >800m from anchor
 *
 * Returns the repaired plan and a list of repairs performed.
 */

import type { TripDay, TripItem } from '../types/trip';
import type { ScoredActivity } from './types';
import { isOpenAtTime, isActivityOpenOnDay, DAY_NAMES_EN } from './utils/opening-hours';
import { calculateDistance } from '../services/geocoding';
import { getMinDuration, getMaxDuration } from './utils/constants';
import { normalizeForMatching } from './utils/dedup';
import { timeToMin, addMinutes, estimateTravelBuffer } from './utils/time';
import { normalizeActivityTitle, getActivityCloseTime } from './step9-schedule';
import {
  arePlannerRolesCompatible,
  getDayPlannerRole,
  getV31RescueStage,
  isProtectedTripItem,
  rescueStageAtLeast,
} from './planning-meta';

// ============================================
// Types
// ============================================

export interface RepairResult {
  days: TripDay[];
  repairs: RepairAction[];
  unresolvedViolations: string[];
  rescueDiagnostics?: {
    protectedBreakCount: number;
    lateMealReplacementCount: number;
    dayTripEvictionCount: number;
    finalIntegrityFailures: number;
    orphanTransportCount?: number;
    teleportLegCount?: number;
    staleNarrativeCount?: number;
    freeTimeOverBudgetCount?: number;
    mealFallbackCount?: number;
    routeRebuildCount?: number;
    restaurantRefetchMissCount?: number;
    temporalImpossibleItemCount?: number;
  };
}

export interface RepairAction {
  type: 'cross-day-swap' | 'replacement' | 'extension' | 'restaurant-reanchor' | 'drop';
  dayNumber: number;
  itemTitle: string;
  description: string;
}

interface RepairGuardOptions {
  rescueStage?: number;
  changedDays?: Set<number>;
}

// ============================================
// Main Function
// ============================================

/**
 * Repair pass: fix remaining violations in the scheduled plan.
 *
 * @param days - Scheduled trip days
 * @param startDate - Trip start date (ISO string "YYYY-MM-DD")
 * @param activityPool - Pool of unused scored activities for replacements
 * @param destCoords - Destination coordinates for distance checks
 * @returns Repaired days + list of repairs + unresolved violations
 */
export function repairPass(
  days: TripDay[],
  startDate: string,
  activityPool: ScoredActivity[],
  destCoords: { lat: number; lng: number }
): RepairResult {
  const repairs: RepairAction[] = [];
  const unresolvedViolations: string[] = [];
  const repairedDays = days.map(d => ({ ...d, items: [...d.items] }));
  const rescueStage = getV31RescueStage();
  const changedDays = new Set<number>();

  // Pass 1: Fix opening hours violations (cross-day swap)
  fixOpeningHoursViolations(repairedDays, startDate, repairs, unresolvedViolations, { rescueStage, changedDays });

  // Pass 2: Validate restaurant distances (>800m from anchor → unresolved violation)
  validateRestaurantDistances(repairedDays, repairs, unresolvedViolations);

  // Pass 3: Ensure must-sees are present
  ensureMustSees(repairedDays, activityPool, startDate, repairs, unresolvedViolations, undefined, { rescueStage, changedDays });

  // Pass 4: Fill large gaps by extending adjacent activities
  fillGapsByExtension(repairedDays, startDate, repairs);

  // Pass 5: Fill remaining large gaps (>90min) — try unassigned activities first, then free_time
  fillLargeGapsWithFreeTime(repairedDays, activityPool, startDate, repairs);

  // Log summary
  console.log(`[Repair] ${repairs.length} repairs performed, ${unresolvedViolations.length} unresolved`);
  for (const r of repairs) {
    console.log(`  [${r.type}] Day ${r.dayNumber}: "${r.itemTitle}" — ${r.description}`);
  }
  for (const v of unresolvedViolations) {
    console.warn(`  [UNRESOLVED] ${v}`);
  }

  return {
    days: repairedDays,
    repairs,
    unresolvedViolations,
    rescueDiagnostics: {
      protectedBreakCount: 0,
      lateMealReplacementCount: 0,
      dayTripEvictionCount: 0,
      finalIntegrityFailures: unresolvedViolations.length,
    },
  };
}

// ============================================
// Pass 1: Opening Hours Violations
// ============================================

export function fixOpeningHoursViolations(
  days: TripDay[],
  startDate: string,
  repairs: RepairAction[],
  unresolvedViolations: string[],
  options: RepairGuardOptions = {}
): void {
  // Track activities that have already been involved in a swap to prevent double-swapping
  const swappedIds = new Set<string>();
  const rescueStage = options.rescueStage ?? 0;

  for (const day of days) {
    const dayDate = getDayDate(startDate, day.dayNumber);
    const violations: TripItem[] = [];

    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      if (!item.openingHours && !item.openingHoursByDay) continue;

      const mockActivity = itemToScoredActivity(item);
      if (!mockActivity) continue;

      if (!isOpenAtTime(mockActivity, dayDate, item.startTime, item.endTime)) {
        violations.push(item);
      }
    }

    for (const violating of violations) {
      // Skip if this activity has already been swapped
      if (swappedIds.has(violating.id || '')) continue;
      if (rescueStageAtLeast(rescueStage, 1) && isProtectedTripItem(violating)) {
        unresolvedViolations.push(
          `Day ${day.dayNumber}: "${violating.title}" outside opening hours but is protected`
        );
        continue;
      }

      const mockAct = itemToScoredActivity(violating)!;
      let swapped = false;

      // Try to swap with an activity from another day
      for (const otherDay of days) {
        if (otherDay.dayNumber === day.dayNumber) continue;
        if (rescueStageAtLeast(rescueStage, 1)
          && !arePlannerRolesCompatible(getDayPlannerRole(day), getDayPlannerRole(otherDay))) {
          continue;
        }
        const otherDate = getDayDate(startDate, otherDay.dayNumber);

        // Check if the violating activity is open on the other day
        if (!isActivityOpenOnDay(mockAct, otherDate)) continue;

        // Find an activity in the other day that could work here
        for (const otherItem of otherDay.items) {
          if (otherItem.type !== 'activity') continue;
          if (rescueStageAtLeast(rescueStage, 1) && isProtectedTripItem(otherItem)) continue;

          // Skip if this activity has already been swapped
          if (swappedIds.has(otherItem.id || '')) continue;

          const otherMock = itemToScoredActivity(otherItem);
          if (!otherMock) continue;

          // Check both directions: violating→otherDay, otherItem→thisDay
          const violatingFitsOtherDay = isOpenAtTime(mockAct, otherDate, otherItem.startTime, otherItem.endTime);
          const otherFitsThisDay = isOpenAtTime(otherMock, dayDate, violating.startTime, violating.endTime);

          if (violatingFitsOtherDay && otherFitsThisDay) {
            // Perform swap: exchange items AND their time slots
            const dayIdx = day.items.indexOf(violating);
            const otherIdx = otherDay.items.indexOf(otherItem);
            if (dayIdx >= 0 && otherIdx >= 0) {
              // Save time slots from both positions
              const violatingTime = { start: violating.startTime, end: violating.endTime, dayNum: day.dayNumber, orderIdx: violating.orderIndex };
              const otherTime = { start: otherItem.startTime, end: otherItem.endTime, dayNum: otherDay.dayNumber, orderIdx: otherItem.orderIndex };

              // Swap items — recalculate endTime from each activity's own duration
              const swappedEndA = otherItem.duration
                ? addMinutes(violatingTime.start, otherItem.duration)
                : addMinutes(violatingTime.start, timeToMin(violatingTime.end) - timeToMin(violatingTime.start));
              const swappedEndB = violating.duration
                ? addMinutes(otherTime.start, violating.duration)
                : addMinutes(otherTime.start, timeToMin(otherTime.end) - timeToMin(otherTime.start));
              day.items[dayIdx] = { ...otherItem, startTime: violatingTime.start, endTime: swappedEndA, dayNumber: violatingTime.dayNum, orderIndex: violatingTime.orderIdx };
              otherDay.items[otherIdx] = { ...violating, startTime: otherTime.start, endTime: swappedEndB, dayNumber: otherTime.dayNum, orderIndex: otherTime.orderIdx };

              // Mark both activities as swapped
              if (violating.id) swappedIds.add(violating.id);
              if (otherItem.id) swappedIds.add(otherItem.id);
              options.changedDays?.add(day.dayNumber);
              options.changedDays?.add(otherDay.dayNumber);

              repairs.push({
                type: 'cross-day-swap',
                dayNumber: day.dayNumber,
                itemTitle: violating.title || '',
                description: `Swapped with "${otherItem.title}" from Day ${otherDay.dayNumber} (${DAY_NAMES_EN[dayDate.getDay()]} closure)`,
              });
              swapped = true;
              break;
            }
          }
        }
        if (swapped) break;
      }

      if (!swapped) {
        unresolvedViolations.push(
          `Day ${day.dayNumber}: "${violating.title}" outside opening hours (${violating.startTime}-${violating.endTime})`
        );
      }
    }
  }
}

// ============================================
// Pass 2: Restaurant Distance Violations
// ============================================

function validateRestaurantDistances(
  days: TripDay[],
  repairs: RepairAction[],
  unresolvedViolations: string[]
): void {
  const MAX_RESTAURANT_DISTANCE_KM = 0.8; // 800m P0.2

  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'restaurant') continue;
      if (item.qualityFlags?.includes('self_meal_fallback')) continue;
      if (!item.latitude || !item.longitude) continue;
      // Skip breakfast — only validate lunch/dinner proximity (consistent with P0.2 in contracts)
      const titleLower = (item.title || '').toLowerCase();
      const isBreakfast = item.mealType === 'breakfast' || titleLower.includes('petit-déjeuner') || titleLower.includes('breakfast');
      if (isBreakfast) continue;

      // Find the nearest activity (anchor point for this meal)
      const nearestActivity = day.items
        .filter(i => i.type === 'activity' && i.latitude && i.longitude)
        .sort((a, b) => {
          const distA = calculateDistance(item.latitude!, item.longitude!, a.latitude!, a.longitude!);
          const distB = calculateDistance(item.latitude!, item.longitude!, b.latitude!, b.longitude!);
          return distA - distB;
        })[0];

      if (nearestActivity) {
        const dist = calculateDistance(
          item.latitude, item.longitude,
          nearestActivity.latitude!, nearestActivity.longitude!
        );
        if (dist > MAX_RESTAURANT_DISTANCE_KM) {
          unresolvedViolations.push(
            `Day ${day.dayNumber}: Restaurant "${item.title}" is ${(dist * 1000).toFixed(0)}m from nearest activity (max ${MAX_RESTAURANT_DISTANCE_KM * 1000}m)`
          );
        }
      }
    }
  }
}

// ============================================
// Pass 3: Must-See Presence Check
// ============================================

export function ensureMustSees(
  days: TripDay[],
  activityPool: ScoredActivity[],
  startDate: string,
  repairs: RepairAction[],
  unresolvedViolations: string[],
  globalPlacedIds?: Set<string>,
  options: RepairGuardOptions = {}
): void {
  const mustSees = activityPool.filter(a => a.mustSee);
  const rescueStage = options.rescueStage ?? 0;

  // Collect normalized planned activity names for fuzzy must-see matching.
  // Uses accent-insensitive normalization so "Sagrada Família" matches "Sagrada Familia".
  const plannedActivityNamesNorm = new Set<string>();
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity' && item.title) {
        plannedActivityNamesNorm.add(normalizeForMatching(item.title));
      }
    }
  }

  /**
   * Check if a must-see is already represented in the planned activities.
   * Primary: exact normalized name match.
   * Fallback: substring inclusion in either direction (handles cross-language names
   * like "Buckingham Palace" vs "Palais de Buckingham" sharing "buckingham").
   */
  function isMustSeeAlreadyPlanned(mustSee: ScoredActivity): boolean {
    // Check by ID first (most reliable)
    const id = mustSee.id || mustSee.name;
    if (globalPlacedIds?.has(id)) return true;
    // Check all item IDs in the plan
    for (const day of days) {
      for (const item of day.items) {
        if (item.type === 'activity' && item.id === mustSee.id) return true;
      }
    }
    // Fuzzy name check
    const mustSeeNorm = normalizeForMatching(mustSee.name);
    if (plannedActivityNamesNorm.has(mustSeeNorm)) return true;
    // Substring fallback — require at least 5 chars to avoid false positives
    if (mustSeeNorm.length >= 5) {
      for (const plannedNorm of plannedActivityNamesNorm) {
        if (plannedNorm.includes(mustSeeNorm) || mustSeeNorm.includes(plannedNorm)) {
          const shorter = Math.min(plannedNorm.length, mustSeeNorm.length);
          const longer = Math.max(plannedNorm.length, mustSeeNorm.length);
          if (shorter / longer >= 0.3) return true;
        }
      }
    }
    return false;
  }

  for (const mustSee of mustSees) {
    if (isMustSeeAlreadyPlanned(mustSee)) continue;

    // Must-see not in plan — try to inject
    let injected = false;

    for (const day of days) {
      if (rescueStageAtLeast(rescueStage, 1)) {
        const role = getDayPlannerRole(day);
        if (role === 'day_trip' || role === 'arrival' || role === 'departure') continue;
      }
      const dayDate = getDayDate(startDate, day.dayNumber);
      if (!isActivityOpenOnDay(mustSee as any, dayDate)) continue;

      // Find lowest-scored non-must-see activity to evict, but only if the
      // must-see's opening hours cover the evicted activity's time slot.
      const evictCandidates = day.items
        .filter(i => i.type === 'activity' && !i.mustSee)
        .filter(i => !rescueStageAtLeast(rescueStage, 1) || !isProtectedTripItem(i))
        .sort((a, b) => (a.rating || 0) - (b.rating || 0));

      for (const evicted of evictCandidates) {
        const idx = day.items.indexOf(evicted);
        if (idx < 0) continue;

        // Check that the must-see is open during the slot using ITS OWN duration
        // (not the evicted activity's endTime, which could be shorter)
        const slotStart = evicted.startTime || '09:00';
        const mustSeeDuration = mustSee.duration || 60;
        const slotEnd = addMinutes(slotStart, mustSeeDuration);
        const mockMustSee = {
          ...mustSee,
          openingHours: mustSee.openingHours,
          openingHoursByDay: mustSee.openingHoursByDay,
        } as ScoredActivity;
        if ((mustSee.openingHours || mustSee.openingHoursByDay) &&
            !isOpenAtTime(mockMustSee, dayDate, slotStart, slotEnd)) {
          continue; // Must-see not open during this time slot — try next candidate
        }
        // Also check keyword-based closing time (gardens/parks without explicit hours)
        const closeTime = getActivityCloseTime(mustSee as ScoredActivity, dayDate);
        if (closeTime && timeToMin(slotEnd) > timeToMin(closeTime)) {
          continue; // Activity would end after closing time
        }

        // Replace with must-see (update ID to match the must-see's real ID)
        const newDuration = mustSee.duration || 60;
        const newStart = day.items[idx].startTime || '09:00';
        day.items[idx] = {
          ...day.items[idx],
          id: mustSee.id || day.items[idx].id,
          title: normalizeActivityTitle(mustSee.name),
          latitude: mustSee.latitude,
          longitude: mustSee.longitude,
          duration: newDuration,
          endTime: addMinutes(newStart, newDuration),
          rating: mustSee.rating,
          mustSee: true,
          description: mustSee.description || '',
          locationName: mustSee.name,
          openingHours: mustSee.openingHours,
          openingHoursByDay: mustSee.openingHoursByDay,
          bookingUrl: mustSee.bookingUrl,
          imageUrl: mustSee.imageUrl,
          photoGallery: mustSee.photoGallery,
          // Update Google Maps URL to the must-see's actual location
          googleMapsPlaceUrl: (mustSee as any).googlePlaceId
            ? `https://www.google.com/maps/place/?q=place_id:${(mustSee as any).googlePlaceId}`
            : mustSee.latitude && mustSee.longitude
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}&query=${mustSee.latitude},${mustSee.longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}`,
          planningMeta: {
            planningToken: mustSee.planningToken || `mustsee:${mustSee.id || mustSee.name}:${day.dayNumber}`,
            protectedReason: 'must_see',
            sourcePackId: mustSee.sourcePackId,
            plannerRole: getDayPlannerRole(day),
            originalDayNumber: day.dayNumber,
          },
        };
        repairs.push({
          type: 'replacement',
          dayNumber: day.dayNumber,
          itemTitle: mustSee.name,
          description: `Injected must-see "${mustSee.name}", evicted "${evicted.title}" (lower rated)`,
        });
        // Mark as planned so duplicate must-see pool entries don't re-inject
        plannedActivityNamesNorm.add(normalizeForMatching(mustSee.name));
        globalPlacedIds?.add(mustSee.id || mustSee.name);
        options.changedDays?.add(day.dayNumber);
        injected = true;
        break; // break evictCandidates loop
      }
      if (injected) break; // break days loop
    }

    // Fallback: place must-see at its own preferred time, evict lowest-rated regardless of time
    if (!injected && !rescueStageAtLeast(rescueStage, 1)) {
      for (const day of days) {
        if (rescueStageAtLeast(rescueStage, 1) && getDayPlannerRole(day) === 'day_trip') continue;
        const dayDate = getDayDate(startDate, day.dayNumber);
        if (!isActivityOpenOnDay(mustSee as any, dayDate)) continue;

        const evictCandidates = day.items
          .filter(i => i.type === 'activity' && !i.mustSee)
          .filter(i => !rescueStageAtLeast(rescueStage, 1) || !isProtectedTripItem(i))
          .sort((a, b) => (a.rating || 0) - (b.rating || 0));

        if (evictCandidates.length === 0) continue;

        const evicted = evictCandidates[0];
        const idx = day.items.indexOf(evicted);
        if (idx < 0) continue;

        // Use must-see's own opening hours for start time, or early morning default
        const preferredStart = mustSee.openingHours?.open || '09:00';
        const mustSeeDuration = mustSee.duration || 60;

        // Check keyword-based closing time (gardens/parks without explicit hours)
        const closeTime = getActivityCloseTime(mustSee as ScoredActivity, dayDate);
        const preferredEnd = addMinutes(preferredStart, mustSeeDuration);
        if (closeTime && timeToMin(preferredEnd) > timeToMin(closeTime)) {
          // Would end after closing — try to fit before close instead
          const fitStart = addMinutes(closeTime, -mustSeeDuration);
          if (timeToMin(fitStart) >= timeToMin('09:00')) {
            // Can fit earlier in the day
            const adjustedStart = fitStart;
            const adjustedEnd = closeTime;
            day.items[idx] = {
              ...day.items[idx],
              id: mustSee.id || day.items[idx].id,
              title: normalizeActivityTitle(mustSee.name),
              latitude: mustSee.latitude,
              longitude: mustSee.longitude,
              duration: mustSeeDuration,
              startTime: adjustedStart,
              endTime: adjustedEnd,
              rating: mustSee.rating,
              mustSee: true,
              description: mustSee.description || '',
              locationName: mustSee.name,
              openingHours: mustSee.openingHours,
              openingHoursByDay: mustSee.openingHoursByDay,
              bookingUrl: mustSee.bookingUrl,
              imageUrl: mustSee.imageUrl,
              photoGallery: mustSee.photoGallery,
              googleMapsPlaceUrl: (mustSee as any).googlePlaceId
                ? `https://www.google.com/maps/place/?q=place_id:${(mustSee as any).googlePlaceId}`
                : mustSee.latitude && mustSee.longitude
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}&query=${mustSee.latitude},${mustSee.longitude}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}`,
              planningMeta: {
                planningToken: mustSee.planningToken || `mustsee:${mustSee.id || mustSee.name}:${day.dayNumber}`,
                protectedReason: 'must_see',
                sourcePackId: mustSee.sourcePackId,
                plannerRole: getDayPlannerRole(day),
                originalDayNumber: day.dayNumber,
              },
            };
            repairs.push({
              type: 'replacement',
              dayNumber: day.dayNumber,
              itemTitle: mustSee.name,
              description: `Injected must-see "${mustSee.name}" at ${adjustedStart} (adjusted to fit before close ${closeTime}), evicted "${evicted.title}"`,
            });
            plannedActivityNamesNorm.add(normalizeForMatching(mustSee.name));
            globalPlacedIds?.add(mustSee.id || mustSee.name);
            options.changedDays?.add(day.dayNumber);
            injected = true;
            break;
          }
          // Can't fit at all on this day — try next day
          continue;
        }

        day.items[idx] = {
          ...day.items[idx],
          id: mustSee.id || day.items[idx].id,
          title: normalizeActivityTitle(mustSee.name),
          latitude: mustSee.latitude,
          longitude: mustSee.longitude,
          duration: mustSeeDuration,
          startTime: preferredStart,
          endTime: addMinutes(preferredStart, mustSeeDuration),
          rating: mustSee.rating,
          mustSee: true,
          description: mustSee.description || '',
          locationName: mustSee.name,
          openingHours: mustSee.openingHours,
          openingHoursByDay: mustSee.openingHoursByDay,
          bookingUrl: mustSee.bookingUrl,
          imageUrl: mustSee.imageUrl,
          photoGallery: mustSee.photoGallery,
          googleMapsPlaceUrl: (mustSee as any).googlePlaceId
            ? `https://www.google.com/maps/place/?q=place_id:${(mustSee as any).googlePlaceId}`
            : mustSee.latitude && mustSee.longitude
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}&query=${mustSee.latitude},${mustSee.longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}`,
          planningMeta: {
            planningToken: mustSee.planningToken || `mustsee:${mustSee.id || mustSee.name}:${day.dayNumber}`,
            protectedReason: 'must_see',
            sourcePackId: mustSee.sourcePackId,
            plannerRole: getDayPlannerRole(day),
            originalDayNumber: day.dayNumber,
          },
        };
        repairs.push({
          type: 'replacement',
          dayNumber: day.dayNumber,
          itemTitle: mustSee.name,
          description: `Injected must-see "${mustSee.name}" at ${preferredStart}, evicted "${evicted.title}" (time-unconstrained fallback)`,
        });
        plannedActivityNamesNorm.add(normalizeForMatching(mustSee.name));
        globalPlacedIds?.add(mustSee.id || mustSee.name);
        options.changedDays?.add(day.dayNumber);
        injected = true;
        break;
      }
    }

    // Last resort: INSERT must-see as a new item on a day with available time
    // (no eviction needed — works even on days with 0 activities)
    if (!injected) {
      for (const day of days) {
        const dayDate = getDayDate(startDate, day.dayNumber);
        if (!isActivityOpenOnDay(mustSee as any, dayDate)) continue;

        // Find the best insertion slot: after last non-transport/flight item before dayEnd
        const lastActivityIdx = day.items.reduce((best, item, idx) => {
          if (item.type === 'activity' || item.type === 'restaurant' || item.type === 'checkin' || item.type === 'checkout') {
            return idx;
          }
          return best;
        }, -1);

        // Determine start time for the new must-see
        const anchorItem = lastActivityIdx >= 0 ? day.items[lastActivityIdx] : null;
        const insertAfterIdx = lastActivityIdx >= 0 ? lastActivityIdx + 1 : 0;
        const mustSeeDuration = mustSee.duration || 60;
        const candidateStart = anchorItem?.endTime || mustSee.openingHours?.open || '10:00';
        const candidateEnd = addMinutes(candidateStart, mustSeeDuration);

        // Check opening hours
        const mockMustSee = { ...mustSee } as ScoredActivity;
        if ((mustSee.openingHours || mustSee.openingHoursByDay) &&
            !isOpenAtTime(mockMustSee, dayDate, candidateStart, candidateEnd)) {
          continue;
        }

        const newItem: TripItem = {
          id: mustSee.id || `mustsee-${mustSee.name}`,
          dayNumber: day.dayNumber,
          type: 'activity',
          title: normalizeActivityTitle(mustSee.name),
          description: mustSee.description || '',
          locationName: mustSee.name,
          startTime: candidateStart,
          endTime: candidateEnd,
          duration: mustSeeDuration,
          latitude: mustSee.latitude,
          longitude: mustSee.longitude,
          rating: mustSee.rating,
          mustSee: true,
          orderIndex: insertAfterIdx,
          openingHours: mustSee.openingHours,
          openingHoursByDay: mustSee.openingHoursByDay,
          bookingUrl: mustSee.bookingUrl,
          imageUrl: mustSee.imageUrl,
          photoGallery: mustSee.photoGallery,
          googleMapsPlaceUrl: (mustSee as any).googlePlaceId
            ? `https://www.google.com/maps/place/?q=place_id:${(mustSee as any).googlePlaceId}`
            : mustSee.latitude && mustSee.longitude
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}&query=${mustSee.latitude},${mustSee.longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}`,
          planningMeta: {
            planningToken: mustSee.planningToken || `mustsee:${mustSee.id || mustSee.name}:${day.dayNumber}`,
            protectedReason: 'must_see',
            sourcePackId: mustSee.sourcePackId,
            plannerRole: getDayPlannerRole(day),
            originalDayNumber: day.dayNumber,
          },
        } as TripItem;

        day.items.splice(insertAfterIdx, 0, newItem);
        day.items.forEach((item, idx) => { item.orderIndex = idx; });

        repairs.push({
          type: 'replacement',
          dayNumber: day.dayNumber,
          itemTitle: mustSee.name,
          description: `Inserted must-see "${mustSee.name}" at ${candidateStart} on Day ${day.dayNumber} (no eviction needed)`,
        });
        plannedActivityNamesNorm.add(normalizeForMatching(mustSee.name));
        globalPlacedIds?.add(mustSee.id || mustSee.name);
        options.changedDays?.add(day.dayNumber);
        injected = true;
        console.log(`[Repair] Inserted must-see "${mustSee.name}" at ${candidateStart} on Day ${day.dayNumber} (last-resort injection)`);
        break;
      }
    }

    if (!injected) {
      unresolvedViolations.push(`Must-see "${mustSee.name}" not in plan and could not be injected`);
    }
  }
}

// ============================================
// Pass 4: Gap Extension
// ============================================

export function fillGapsByExtension(
  days: TripDay[],
  startDate: string,
  repairs: RepairAction[]
): void {
  for (const day of days) {
    for (let i = 0; i < day.items.length - 1; i++) {
      const current = day.items[i];
      const next = day.items[i + 1];

      if (current.type !== 'activity' || !current.endTime || !next.startTime) continue;

      const gapMinutes = timeToMin(next.startTime) - timeToMin(current.endTime);

      // Only extend for moderate gaps (30-90 minutes)
      if (gapMinutes >= 30 && gapMinutes <= 90) {
        const maxDur = getMaxDuration(current.title || '', current.type || '');
        const currentDuration = current.duration || 60;

        if (maxDur && currentDuration < maxDur) {
          const extension = Math.min(gapMinutes, maxDur - currentDuration);
          if (extension >= 15) {
            // Check close time before extending
            if (current.openingHours || current.openingHoursByDay) {
              const mockAct = itemToScoredActivity(current);
              if (mockAct) {
                const dayDate = getDayDate(startDate, day.dayNumber);
                const newEnd = addMinutes(current.endTime, extension);
                if (!isOpenAtTime(mockAct, dayDate, current.startTime!, newEnd)) {
                  continue; // Don't extend past closing time
                }
              }
            }
            const newDuration = currentDuration + extension;
            const newEndTime = addMinutes(current.endTime, extension);
            day.items[i] = { ...current, duration: newDuration, endTime: newEndTime };
            repairs.push({
              type: 'extension',
              dayNumber: day.dayNumber,
              itemTitle: current.title || '',
              description: `Extended by ${extension}min to fill gap (${currentDuration}→${newDuration}min)`,
            });
          }
        }
      }
    }
  }
}

// ============================================
// Pass 5: Fill large gaps with free_time
// ============================================

export function fillLargeGapsWithFreeTime(
  days: TripDay[],
  activityPool?: ScoredActivity[],
  startDate?: string,
  repairs?: RepairAction[]
): void {
  // Build set of already-placed activity IDs to find unassigned pool activities
  const placedIds = new Set<string>();
  const placedNamesNorm = new Set<string>();
  for (const day of days) {
    for (const item of day.items) {
      if (item.id) placedIds.add(item.id);
      if (item.title) placedNamesNorm.add(normalizeForMatching(item.title));
    }
  }

  const unassigned = activityPool?.filter(a => {
    if (placedIds.has(a.id || '')) return false;
    if (placedNamesNorm.has(normalizeForMatching(a.name))) return false;
    return true;
  }) || [];

  // Sort unassigned by score descending so we insert the best candidates first
  unassigned.sort((a, b) => (b.score || 0) - (a.score || 0));

  const MIN_CANDIDATE_SCORE = 5; // Minimum quality threshold

  for (const day of days) {
    const insertions: Array<{ index: number; item: TripItem }> = [];

    for (let i = 0; i < day.items.length - 1; i++) {
      const current = day.items[i];
      const next = day.items[i + 1];

      if (!current.endTime || !next.startTime) continue;

      const gapMinutes = timeToMin(next.startTime) - timeToMin(current.endTime);

      // Only fill gaps >90 min (smaller gaps are normal breathing room)
      if (gapMinutes <= 90) continue;

      const refItem = (current.latitude && current.longitude) ? current
        : (next.latitude && next.longitude) ? next : null;
      if (!refItem) continue;
      const lat = refItem.latitude!;
      const lng = refItem.longitude!;

      // Dynamic trailing buffer based on distance to next item
      const hasNextCoords = next.latitude && next.longitude && !(next.latitude === 0 && next.longitude === 0);
      const distToNext = hasNextCoords
        ? calculateDistance(lat, lng, next.latitude!, next.longitude!)
        : 0;
      const trailingBuffer = hasNextCoords ? estimateTravelBuffer(distToNext) : 10;

      const availableMinutes = gapMinutes - 10 - trailingBuffer; // 10min leading buffer
      if (availableMinutes < 30) continue;

      // Try to fill with an unassigned activity from the pool
      let filled = false;
      if (startDate) {
        const dayDate = getDayDate(startDate, day.dayNumber);
        const candidateStart = addMinutes(current.endTime, 10);

        for (let j = 0; j < unassigned.length; j++) {
          const candidate = unassigned[j];
          if ((candidate.score || 0) < MIN_CANDIDATE_SCORE) break; // sorted, so all below threshold

          // Distance check: <3km from current position
          const dist = calculateDistance(lat, lng, candidate.latitude, candidate.longitude);
          if (dist > 3) continue;

          // Duration check: activity must fit in the gap (with transport margins)
          const actDuration = candidate.duration || 60;
          const transportIn = estimateTravelBuffer(dist);
          if (actDuration + transportIn > availableMinutes) continue;

          // Opening hours check
          const actStart = addMinutes(candidateStart, transportIn);
          const actEnd = addMinutes(actStart, actDuration);
          if (candidate.openingHours || candidate.openingHoursByDay) {
            if (!isOpenAtTime(candidate, dayDate, actStart, actEnd)) continue;
          }
          const closeTime = getActivityCloseTime(candidate, dayDate);
          if (closeTime && timeToMin(actEnd) > timeToMin(closeTime)) continue;

          // Insert the activity
          const newItem: TripItem = {
            id: candidate.id || `gapfill-${day.dayNumber}-${i}`,
            dayNumber: day.dayNumber,
            type: 'activity',
            title: normalizeActivityTitle(candidate.name),
            description: candidate.description || '',
            locationName: candidate.name,
            startTime: actStart,
            endTime: actEnd,
            duration: actDuration,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            rating: candidate.rating,
            mustSee: candidate.mustSee,
            orderIndex: 0,
            openingHours: candidate.openingHours,
            openingHoursByDay: candidate.openingHoursByDay,
            bookingUrl: candidate.bookingUrl,
            imageUrl: candidate.imageUrl,
            photoGallery: candidate.photoGallery,
            googleMapsPlaceUrl: candidate.latitude && candidate.longitude
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(candidate.name)}&query=${candidate.latitude},${candidate.longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(candidate.name)}`,
          } as TripItem;

          insertions.push({ index: i + 1, item: newItem });

          // Remove from unassigned pool so it's not placed twice
          unassigned.splice(j, 1);
          placedIds.add(candidate.id || '');
          placedNamesNorm.add(normalizeForMatching(candidate.name));

          repairs?.push({
            type: 'replacement',
            dayNumber: day.dayNumber,
            itemTitle: candidate.name,
            description: `Gap-fill: inserted "${candidate.name}" (${actDuration}min, ${(dist * 1000).toFixed(0)}m away) into ${gapMinutes}min gap`,
          });

          console.log(`[Repair] Gap-fill: "${candidate.name}" on Day ${day.dayNumber} at ${actStart} (${(dist * 1000).toFixed(0)}m, ${actDuration}min)`);
          filled = true;
          break;
        }
      }

      // Fallback: insert free_time if no suitable activity found
      if (!filled) {
        const freeStart = addMinutes(current.endTime, 10);
        const freeDuration = availableMinutes;
        const freeEnd = addMinutes(freeStart, freeDuration);

        insertions.push({
          index: i + 1,
          item: {
            id: `free-time-${day.dayNumber}-${i}`,
            dayNumber: day.dayNumber,
            startTime: freeStart,
            endTime: freeEnd,
            type: 'free_time',
            title: 'Temps libre — Exploration du quartier',
            description: 'Profitez de ce temps libre pour flâner dans le quartier, faire du shopping ou prendre un café',
            locationName: '',
            latitude: lat,
            longitude: lng,
            orderIndex: 0,
            duration: freeDuration,
            imageUrl: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=600&h=400&fit=crop',
            estimatedCost: 0,
          },
        });
      }
    }

    // Insert in reverse order to preserve indices
    for (const ins of insertions.reverse()) {
      day.items.splice(ins.index, 0, ins.item);
    }

    // Re-index
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }
}

// ============================================
// Helpers
// ============================================

export function getDayDate(startDate: string, dayNumber: number): Date {
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayNumber - 1);
  return date;
}

function itemToScoredActivity(item: TripItem): ScoredActivity | null {
  if (!item.latitude || !item.longitude) return null;
  return {
    id: item.id || '',
    name: item.title || '',
    latitude: item.latitude,
    longitude: item.longitude,
    rating: item.rating,
    openingHours: item.openingHours,
    openingHoursByDay: item.openingHoursByDay,
    duration: item.duration,
    mustSee: item.mustSee,
    // Fill minimal required fields from ScoredActivity interface
    score: item.rating || 0,
    source: 'google_places' as const,
    reviewCount: 0,
    protectedReason: item.planningMeta?.protectedReason,
    sourcePackId: item.planningMeta?.sourcePackId,
    plannerRole: item.planningMeta?.plannerRole,
    originalDayNumber: item.planningMeta?.originalDayNumber,
    planningToken: item.planningMeta?.planningToken,
  } as ScoredActivity;
}

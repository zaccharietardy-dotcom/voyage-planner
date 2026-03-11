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
import { timeToMin, addMinutes } from './utils/time';
import { normalizeActivityTitle } from './step9-schedule';

// ============================================
// Types
// ============================================

export interface RepairResult {
  days: TripDay[];
  repairs: RepairAction[];
  unresolvedViolations: string[];
}

export interface RepairAction {
  type: 'cross-day-swap' | 'replacement' | 'extension' | 'restaurant-reanchor' | 'drop';
  dayNumber: number;
  itemTitle: string;
  description: string;
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

  // Pass 1: Fix opening hours violations (cross-day swap)
  fixOpeningHoursViolations(repairedDays, startDate, repairs, unresolvedViolations);

  // Pass 2: Validate restaurant distances (>800m from anchor → unresolved violation)
  validateRestaurantDistances(repairedDays, repairs, unresolvedViolations);

  // Pass 3: Ensure must-sees are present
  ensureMustSees(repairedDays, activityPool, startDate, repairs, unresolvedViolations);

  // Pass 4: Fill large gaps by extending adjacent activities
  fillGapsByExtension(repairedDays, startDate, repairs);

  // Pass 5: Fill remaining large gaps (>90min) with explicit free_time items
  fillLargeGapsWithFreeTime(repairedDays);

  // Log summary
  console.log(`[Repair] ${repairs.length} repairs performed, ${unresolvedViolations.length} unresolved`);
  for (const r of repairs) {
    console.log(`  [${r.type}] Day ${r.dayNumber}: "${r.itemTitle}" — ${r.description}`);
  }
  for (const v of unresolvedViolations) {
    console.warn(`  [UNRESOLVED] ${v}`);
  }

  return { days: repairedDays, repairs, unresolvedViolations };
}

// ============================================
// Pass 1: Opening Hours Violations
// ============================================

export function fixOpeningHoursViolations(
  days: TripDay[],
  startDate: string,
  repairs: RepairAction[],
  unresolvedViolations: string[]
): void {
  // Track activities that have already been involved in a swap to prevent double-swapping
  const swappedIds = new Set<string>();

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

      const mockAct = itemToScoredActivity(violating)!;
      let swapped = false;

      // Try to swap with an activity from another day
      for (const otherDay of days) {
        if (otherDay.dayNumber === day.dayNumber) continue;
        const otherDate = getDayDate(startDate, otherDay.dayNumber);

        // Check if the violating activity is open on the other day
        if (!isActivityOpenOnDay(mockAct, otherDate)) continue;

        // Find an activity in the other day that could work here
        for (const otherItem of otherDay.items) {
          if (otherItem.type !== 'activity') continue;

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
  unresolvedViolations: string[]
): void {
  const mustSees = activityPool.filter(a => a.mustSee);

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
  function isMustSeeAlreadyPlanned(mustSeeName: string): boolean {
    const mustSeeNorm = normalizeForMatching(mustSeeName);
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
    if (isMustSeeAlreadyPlanned(mustSee.name)) continue;

    // Must-see not in plan — try to inject
    let injected = false;

    for (const day of days) {
      const dayDate = getDayDate(startDate, day.dayNumber);
      if (!isActivityOpenOnDay(mustSee as any, dayDate)) continue;

      // Find lowest-scored non-must-see activity to evict, but only if the
      // must-see's opening hours cover the evicted activity's time slot.
      const evictCandidates = day.items
        .filter(i => i.type === 'activity' && !i.mustSee)
        .sort((a, b) => (a.rating || 0) - (b.rating || 0));

      for (const evicted of evictCandidates) {
        const idx = day.items.indexOf(evicted);
        if (idx < 0) continue;

        // Check that the must-see is open during the evicted slot's time
        const slotStart = evicted.startTime || '09:00';
        const mustSeeDuration = mustSee.duration || 60;
        const slotEnd = evicted.endTime || addMinutes(slotStart, mustSeeDuration);
        const mockMustSee = {
          ...mustSee,
          openingHours: mustSee.openingHours,
          openingHoursByDay: mustSee.openingHoursByDay,
        } as ScoredActivity;
        if ((mustSee.openingHours || mustSee.openingHoursByDay) &&
            !isOpenAtTime(mockMustSee, dayDate, slotStart, slotEnd)) {
          continue; // Must-see not open during this time slot — try next candidate
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
          // Update Google Maps URL to the must-see's actual location
          googleMapsPlaceUrl: (mustSee as any).googlePlaceId
            ? `https://www.google.com/maps/place/?q=place_id:${(mustSee as any).googlePlaceId}`
            : mustSee.latitude && mustSee.longitude
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}&query=${mustSee.latitude},${mustSee.longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}`,
        };
        repairs.push({
          type: 'replacement',
          dayNumber: day.dayNumber,
          itemTitle: mustSee.name,
          description: `Injected must-see "${mustSee.name}", evicted "${evicted.title}" (lower rated)`,
        });
        // Mark as planned so duplicate must-see pool entries don't re-inject
        plannedActivityNamesNorm.add(normalizeForMatching(mustSee.name));
        injected = true;
        break; // break evictCandidates loop
      }
      if (injected) break; // break days loop
    }

    // Fallback: place must-see at its own preferred time, evict lowest-rated regardless of time
    if (!injected) {
      for (const day of days) {
        const dayDate = getDayDate(startDate, day.dayNumber);
        if (!isActivityOpenOnDay(mustSee as any, dayDate)) continue;

        const evictCandidates = day.items
          .filter(i => i.type === 'activity' && !i.mustSee)
          .sort((a, b) => (a.rating || 0) - (b.rating || 0));

        if (evictCandidates.length === 0) continue;

        const evicted = evictCandidates[0];
        const idx = day.items.indexOf(evicted);
        if (idx < 0) continue;

        // Use must-see's own opening hours for start time, or early morning default
        const preferredStart = mustSee.openingHours?.open || '09:00';
        const mustSeeDuration = mustSee.duration || 60;

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
          googleMapsPlaceUrl: (mustSee as any).googlePlaceId
            ? `https://www.google.com/maps/place/?q=place_id:${(mustSee as any).googlePlaceId}`
            : mustSee.latitude && mustSee.longitude
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}&query=${mustSee.latitude},${mustSee.longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mustSee.name)}`,
        };
        repairs.push({
          type: 'replacement',
          dayNumber: day.dayNumber,
          itemTitle: mustSee.name,
          description: `Injected must-see "${mustSee.name}" at ${preferredStart}, evicted "${evicted.title}" (time-unconstrained fallback)`,
        });
        plannedActivityNamesNorm.add(normalizeForMatching(mustSee.name));
        injected = true;
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

export function fillLargeGapsWithFreeTime(days: TripDay[]): void {
  for (const day of days) {
    const insertions: Array<{ index: number; item: TripItem }> = [];

    for (let i = 0; i < day.items.length - 1; i++) {
      const current = day.items[i];
      const next = day.items[i + 1];

      if (!current.endTime || !next.startTime) continue;

      const gapMinutes = timeToMin(next.startTime) - timeToMin(current.endTime);

      // Only fill gaps >90 min (smaller gaps are normal breathing room)
      if (gapMinutes > 90) {
        // Place free_time with 10min margin on each side
        const freeStart = addMinutes(current.endTime, 10);
        const freeDuration = gapMinutes - 20;
        const freeEnd = addMinutes(freeStart, freeDuration);

        // Midpoint coordinates between the two items
        if (!current.latitude || !current.longitude || !next.latitude || !next.longitude) continue;
        const lat = (current.latitude + next.latitude) / 2;
        const lng = (current.longitude + next.longitude) / 2;

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
  } as ScoredActivity;
}

/**
 * Pipeline V2 — Single-pass Day Scheduler
 *
 * Replaces the 8 cascading post-processing functions in step4-assemble-llm.ts
 * with a single placement engine that:
 * 1. Places immovable anchors (transport, checkin, checkout)
 * 2. Reserves meal slots (breakfast, lunch, dinner)
 * 3. Places activities one by one — SKIPS if no slot found (no cascade)
 * 4. Fills empty meal slots from restaurant pool
 * 5. Labels meals based on final time
 */

import type {
  TripItem,
  TripDay,
  Accommodation,
  Restaurant,
  TransportOptionSummary,
} from '../types';
import { calculateDistance } from '../services/geocoding';
import { sanitizeGoogleMapsUrl } from '../services/googlePlacePhoto';

// ============================================
// Local helpers (self-contained, no imports from step4)
// ============================================

function parseHHMM(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 55, Math.round(totalMinutes)));
  const rounded = Math.round(clamped / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function ceil5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

function hasValidCoords(item: { latitude?: number; longitude?: number }): boolean {
  return (
    item.latitude !== undefined &&
    item.longitude !== undefined &&
    item.latitude !== 0 &&
    item.longitude !== 0 &&
    !isNaN(item.latitude) &&
    !isNaN(item.longitude)
  );
}

function buildGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function mealTypeFromMinutes(startMin: number): TripItem['mealType'] {
  if (startMin < 10 * 60 + 30) return 'breakfast';
  if (startMin < 18 * 60) return 'lunch';
  return 'dinner';
}

function mealLabelFromType(mealType: TripItem['mealType']): string {
  if (mealType === 'breakfast') return 'Petit-déjeuner';
  if (mealType === 'lunch') return 'Déjeuner';
  return 'Dîner';
}

// ============================================
// Interfaces
// ============================================

interface SchedulerAnchor {
  startMin: number;
  endMin: number;
  item: TripItem;
}

interface SchedulerCandidate {
  item: TripItem;
  priority: number;
  preferredStartMin: number;
  durationMin: number;
  lat: number;
  lng: number;
}

export interface MealSlot {
  type: 'breakfast' | 'lunch' | 'dinner';
  idealStartMin: number;
  windowStartMin: number;
  windowEndMin: number;
  durationMin: number;
  filled: boolean;
  item?: TripItem;
}

export interface DayWindow {
  dayNumber: number;
  dayType: 'first' | 'full' | 'last' | 'single' | 'daytrip';
  startMin: number;
  endMin: number;
  anchors: SchedulerAnchor[];
  hotel: Accommodation | null;
  destCoords: { lat: number; lng: number };
}

// ============================================
// Travel gap computation
// ============================================

export function computeTravelGap(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  if (!fromLat || !fromLng || !toLat || !toLng) return 5;

  const dist = calculateDistance(fromLat, fromLng, toLat, toLng);

  if (dist < 0.3) return 0;
  if (dist <= 3.0) return ceil5(Math.ceil(dist * 1000 / 80) + 5);
  return ceil5(Math.max(Math.ceil((dist / 15) * 60) + 10, 20));
}

// ============================================
// DayWindow builder
// ============================================

export function buildDayWindow(
  day: TripDay,
  totalDays: number,
  transport: TransportOptionSummary | null,
  hotel: Accommodation | null,
  destCoords: { lat: number; lng: number }
): DayWindow {
  const isFirst = day.dayNumber === 1;
  const isLast = day.dayNumber === totalDays;
  const isSingle = totalDays === 1;
  const isDayTrip = day.isDayTrip || false;

  let dayType: DayWindow['dayType'] = 'full';
  if (isSingle) dayType = 'single';
  else if (isDayTrip) dayType = 'daytrip';
  else if (isFirst) dayType = 'first';
  else if (isLast) dayType = 'last';

  // Extract anchors from existing items
  const anchors: SchedulerAnchor[] = [];
  let windowStart = 7 * 60 + 30; // 07:30 default
  let windowEnd = 22 * 60;       // 22:00 default

  for (const item of day.items) {
    if (['transport', 'flight', 'checkin', 'checkout'].includes(item.type)) {
      const startMin = parseHHMM(item.startTime);
      const endMin = parseHHMM(item.endTime);
      anchors.push({ startMin, endMin, item });
    }
  }

  // Adjust window based on transport
  if (isFirst || isSingle) {
    // Find arrival transport (usually the first transport item)
    const arrivalAnchor = anchors.find(a =>
      (a.item.type === 'transport' || a.item.type === 'flight') &&
      a.item.transportRole !== 'daytrip_outbound' &&
      a.item.transportRole !== 'daytrip_return'
    );
    if (arrivalAnchor) {
      windowStart = Math.max(windowStart, arrivalAnchor.endMin + 30);
    }
  }

  if (isLast || isSingle) {
    // Find departure transport
    const departureAnchor = anchors
      .filter(a =>
        (a.item.type === 'transport' || a.item.type === 'flight') &&
        a.item.transportRole !== 'daytrip_outbound' &&
        a.item.transportRole !== 'daytrip_return'
      )
      .sort((a, b) => b.startMin - a.startMin)[0]; // latest transport = departure

    if (departureAnchor && (isLast || (isSingle && departureAnchor.startMin > 12 * 60))) {
      windowEnd = Math.min(windowEnd, departureAnchor.startMin - 30);
    }
  }

  if (isDayTrip) {
    const outbound = anchors.find(a => a.item.transportRole === 'daytrip_outbound');
    const returnT = anchors.find(a => a.item.transportRole === 'daytrip_return');
    if (outbound) windowStart = outbound.endMin + 15;
    if (returnT) windowEnd = returnT.startMin - 15;
  }

  // Ensure window is valid
  windowEnd = Math.max(windowEnd, windowStart + 60);

  return {
    dayNumber: day.dayNumber,
    dayType,
    startMin: windowStart,
    endMin: windowEnd,
    anchors,
    hotel,
    destCoords,
  };
}

// ============================================
// Meal slots builder
// ============================================

export function buildMealSlots(window: DayWindow): MealSlot[] {
  const slots: MealSlot[] = [];

  // Breakfast: if day starts early enough
  if (window.startMin <= 9 * 60 + 30) {
    const bkfStart = Math.max(window.startMin, 7 * 60 + 30);
    slots.push({
      type: 'breakfast',
      idealStartMin: Math.max(8 * 60, bkfStart),
      windowStartMin: bkfStart,
      windowEndMin: 9 * 60 + 30,
      durationMin: 30,
      filled: false,
    });
  }

  // Lunch: if window covers the lunch period
  if (window.startMin <= 13 * 60 + 30 && window.endMin >= 12 * 60 + 30) {
    slots.push({
      type: 'lunch',
      idealStartMin: 12 * 60 + 30,
      windowStartMin: 11 * 60 + 30,
      windowEndMin: 14 * 60,
      durationMin: 60,
      filled: false,
    });
  }

  // Dinner: if window goes late enough (skip on last day unless very late departure)
  if (window.endMin >= 20 * 60 + 30) {
    slots.push({
      type: 'dinner',
      idealStartMin: 19 * 60 + 30,
      windowStartMin: 18 * 60 + 30,
      windowEndMin: 21 * 60 + 30,
      durationMin: 75,
      filled: false,
    });
  }

  return slots;
}

// ============================================
// Candidate builder
// ============================================

export function buildCandidates(items: TripItem[]): SchedulerCandidate[] {
  const candidates: SchedulerCandidate[] = [];

  for (const item of items) {
    // Skip anchors (transport, checkin, checkout) — already placed
    if (['transport', 'flight', 'checkin', 'checkout'].includes(item.type)) continue;

    const preferredStart = parseHHMM(item.startTime);
    const preferredEnd = parseHHMM(item.endTime);
    const timeRange = Math.max(0, preferredEnd - preferredStart);
    // Prefer item.duration (already capped by step4 min/max rules) over the raw time range.
    // Only fall back to timeRange when item.duration is missing/zero.
    const duration = Math.max(item.duration || timeRange || 30, 15);

    // Priority: mustSee > restaurants (must eat) > regular activities
    let priority = 100 - (item.orderIndex || 0); // LLM order matters
    if (item.mustSee) priority += 1000;
    if (item.type === 'restaurant') priority += 500; // Meals are important

    candidates.push({
      item,
      priority,
      preferredStartMin: preferredStart,
      durationMin: duration,
      lat: item.latitude || 0,
      lng: item.longitude || 0,
    });
  }

  // Sort by priority DESC (highest first), then by preferred start time ASC
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.preferredStartMin - b.preferredStartMin;
  });

  return candidates;
}

// ============================================
// Slot validation
// ============================================

interface PlacedItem {
  startMin: number;
  endMin: number;
  lat: number;
  lng: number;
  type: string;
}

function getPlacedItems(items: TripItem[]): PlacedItem[] {
  return items.map(item => ({
    startMin: parseHHMM(item.startTime),
    endMin: parseHHMM(item.endTime),
    lat: item.latitude || 0,
    lng: item.longitude || 0,
    type: item.type,
  }));
}

function isSlotValid(
  startMin: number,
  durationMin: number,
  candidateLat: number,
  candidateLng: number,
  candidateType: string,
  placed: PlacedItem[],
  mealSlots: MealSlot[],
  window: DayWindow
): boolean {
  const endMin = startMin + durationMin;

  // 1. Within day window
  if (startMin < window.startMin || endMin > window.endMin) return false;

  // 2. Activity cutoff at 21:00 (leave room for dinner; no one visits a museum at 21h)
  if (candidateType === 'activity' && startMin >= 21 * 60) return false;

  // 3. No overlap with placed items (including travel gaps)
  for (const p of placed) {
    // Compute travel gaps
    let gapAfterPrev = 0; // gap needed between p.end and candidate.start
    let gapBeforeNext = 0; // gap needed between candidate.end and p.start

    if (hasValidCoords({ latitude: candidateLat, longitude: candidateLng }) &&
        hasValidCoords({ latitude: p.lat, longitude: p.lng })) {
      const travelTime = computeTravelGap(p.lat, p.lng, candidateLat, candidateLng);
      gapAfterPrev = travelTime;
      gapBeforeNext = travelTime;
    } else {
      gapAfterPrev = 5;
      gapBeforeNext = 5;
    }

    // Check: candidate starts after prev ends + travel gap
    // AND candidate ends before next starts - travel gap
    if (p.endMin <= startMin) {
      // p is before candidate — check gap after p
      if (startMin - p.endMin < gapAfterPrev) return false;
    } else if (p.startMin >= endMin) {
      // p is after candidate — check gap before p
      if (p.startMin - endMin < gapBeforeNext) return false;
    } else {
      // Overlap!
      return false;
    }
  }

  // 4. Don't block reserved meal slots (only for non-restaurant items)
  //    Check ALL placed items + this candidate together to determine
  //    whether the meal can still fit in its window with travel gaps.
  if (candidateType !== 'restaurant') {
    // Build a combined list of all blockers: already-placed items + the candidate
    const allBlockers = [
      ...placed.map(p => ({ start: p.startMin, end: p.endMin, lat: p.lat, lng: p.lng })),
      { start: startMin, end: endMin, lat: candidateLat, lng: candidateLng },
    ];

    for (const meal of mealSlots) {
      if (meal.filled) continue;

      // Would this placement overlap or be adjacent to the meal window?
      // Include a 30min travel buffer — a candidate starting right after the meal window
      // can still block it if there's not enough travel gap.
      const travelBuffer = 30;
      const mealWindowNearby = startMin < meal.windowEndMin + travelBuffer && endMin > meal.windowStartMin - travelBuffer;
      if (!mealWindowNearby) continue;

      // Estimate meal location: hotel coords for breakfast, destCoords otherwise
      const mealLat = window.hotel?.latitude || window.destCoords.lat;
      const mealLng = window.hotel?.longitude || window.destCoords.lng;

      // Check if meal can still fit somewhere in its window considering ALL blockers
      let canFitMeal = false;
      for (let t = meal.windowStartMin; t + meal.durationMin <= meal.windowEndMin; t += 5) {
        const mealEnd = t + meal.durationMin;
        let fits = true;

        for (const b of allBlockers) {
          // Check time overlap
          if (t < b.end && mealEnd > b.start) {
            fits = false;
            break;
          }

          // Check travel gap: meal must have enough travel time to/from adjacent items
          if (mealLat && mealLng && b.lat && b.lng) {
            const travelGap = computeTravelGap(mealLat, mealLng, b.lat, b.lng);
            // Blocker is before meal: blocker.end + travelGap <= meal.start
            if (b.end <= t && t - b.end < travelGap) {
              fits = false;
              break;
            }
            // Blocker is after meal: meal.end + travelGap <= blocker.start
            if (b.start >= mealEnd && b.start - mealEnd < travelGap) {
              fits = false;
              break;
            }
          }
        }

        if (fits) {
          canFitMeal = true;
          break;
        }
      }

      if (!canFitMeal) return false;
    }
  }

  return true;
}

// ============================================
// Find best slot for a candidate
// ============================================

function findBestSlot(
  candidate: SchedulerCandidate,
  placed: PlacedItem[],
  mealSlots: MealSlot[],
  window: DayWindow
): number | null {
  const { durationMin, lat, lng, preferredStartMin } = candidate;
  const type = candidate.item.type;

  // Try preferred time first
  if (isSlotValid(preferredStartMin, durationMin, lat, lng, type, placed, mealSlots, window)) {
    return preferredStartMin;
  }

  // Try sliding forward from preferred time (in 5-min increments)
  const maxForward = window.endMin - durationMin;
  for (let t = preferredStartMin + 5; t <= maxForward; t += 5) {
    if (isSlotValid(t, durationMin, lat, lng, type, placed, mealSlots, window)) {
      return t;
    }
  }

  // Try sliding backward from preferred time
  for (let t = preferredStartMin - 5; t >= window.startMin; t -= 5) {
    if (isSlotValid(t, durationMin, lat, lng, type, placed, mealSlots, window)) {
      return t;
    }
  }

  return null; // No valid slot found — SKIP this item
}

// ============================================
// Find closest unused restaurant
// ============================================

function findClosestUnusedRestaurant(
  restaurants: Restaurant[],
  coords: { lat: number; lng: number },
  usedNames: Set<string>
): Restaurant | null {
  let best: Restaurant | null = null;
  let bestDist = Infinity;

  for (const r of restaurants) {
    if (!r.latitude || !r.longitude) continue;
    if (usedNames.has(r.name.toLowerCase().trim())) continue;

    const dist = calculateDistance(coords.lat, coords.lng, r.latitude, r.longitude);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }

  // Fallback: allow reuse if all are used
  if (!best) {
    for (const r of restaurants) {
      if (!r.latitude || !r.longitude) continue;
      const dist = calculateDistance(coords.lat, coords.lng, r.latitude, r.longitude);
      if (dist < bestDist) {
        bestDist = dist;
        best = r;
      }
    }
  }

  return best;
}

// ============================================
// Build a meal TripItem
// ============================================

function buildMealItem(
  slot: MealSlot,
  startMin: number,
  restaurant: Restaurant | null,
  dayNumber: number,
  hotel: Accommodation | null,
  destCoords: { lat: number; lng: number }
): TripItem {
  const label = slot.type === 'breakfast' ? 'Petit-déjeuner'
    : slot.type === 'lunch' ? 'Déjeuner'
    : 'Dîner';

  // For breakfast: use hotel if available
  if (slot.type === 'breakfast' && hotel) {
    return {
      id: `breakfast-${dayNumber}`,
      dayNumber,
      startTime: minutesToHHMM(startMin),
      endTime: minutesToHHMM(startMin + slot.durationMin),
      type: 'restaurant',
      title: `Petit-déjeuner à l'hôtel`,
      description: hotel.breakfastIncluded ? 'Petit-déjeuner inclus' : 'Petit-déjeuner',
      locationName: hotel.name || 'Hôtel',
      latitude: hotel.latitude || destCoords.lat,
      longitude: hotel.longitude || destCoords.lng,
      orderIndex: 0,
      duration: slot.durationMin,
      estimatedCost: hotel.breakfastIncluded ? 0 : 8,
      mealType: 'breakfast',
      restaurant: {
        name: hotel.name || 'Hôtel',
        latitude: hotel.latitude || destCoords.lat,
        longitude: hotel.longitude || destCoords.lng,
      } as any,
    };
  }

  const name = restaurant ? restaurant.name : 'Restaurant local';
  const lat = restaurant ? restaurant.latitude : destCoords.lat;
  const lng = restaurant ? restaurant.longitude : destCoords.lng;

  return {
    id: `${slot.type}-${dayNumber}`,
    dayNumber,
    startTime: minutesToHHMM(startMin),
    endTime: minutesToHHMM(startMin + slot.durationMin),
    type: 'restaurant',
    title: `${label} — ${name}`,
    description: restaurant?.description || label,
    locationName: restaurant?.address || name,
    latitude: lat,
    longitude: lng,
    orderIndex: 0,
    duration: slot.durationMin,
    estimatedCost: restaurant?.priceLevel
      ? restaurant.priceLevel * (slot.type === 'dinner' ? 15 : 12)
      : (slot.type === 'dinner' ? 25 : 15),
    rating: restaurant?.rating,
    googleMapsUrl: sanitizeGoogleMapsUrl(buildGoogleMapsUrl(lat, lng)),
    mealType: slot.type,
    restaurant: restaurant || { name, latitude: lat, longitude: lng } as any,
  };
}

// ============================================
// Label a meal based on its final start time
// ============================================

function fixMealLabel(item: TripItem): void {
  if (item.type !== 'restaurant') return;

  const startMin = parseHHMM(item.startTime);
  const normalizedMealType = mealTypeFromMinutes(startMin);
  const correctLabel = mealLabelFromType(normalizedMealType);
  item.mealType = normalizedMealType;

  const restaurantName = item.restaurant?.name
    || item.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner)\s*(—)?\s*/i, '').trim();
  const isHotelMeal = /a l'hotel|à l'hôtel|at hotel/i.test(
    (item.title || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );

  item.title = isHotelMeal
    ? `${correctLabel} à l'hôtel`
    : `${correctLabel} — ${restaurantName || 'Restaurant local'}`;

  if (item.description) {
    item.description = item.description.replace(/^(Petit-déjeuner|Déjeuner|Dîner)/, correctLabel);
  }
}

// ============================================
// MAIN: Schedule all items for a single day
// ============================================

export function scheduleDayItems(
  candidates: SchedulerCandidate[],
  mealSlots: MealSlot[],
  window: DayWindow,
  restaurantPool: Restaurant[],
  usedRestaurantNames: Set<string>
): TripItem[] {
  // 1. Start with anchor items (transport, checkin, checkout)
  const result: TripItem[] = window.anchors.map(a => a.item);

  // Build placed items tracker
  let placed = getPlacedItems(result);

  // 1b. Pre-place breakfast for full/last days to prevent activities from crowding it out.
  //     On these days the window starts early (07:30) and high-priority mustSee activities
  //     can consume the entire breakfast window before the meal slot filler runs.
  const breakfastSlot = mealSlots.find(s => s.type === 'breakfast' && !s.filled);
  if (breakfastSlot && (window.dayType === 'full' || window.dayType === 'last')) {
    const bkfRestaurant = window.hotel
      ? null // breakfast at hotel
      : findClosestUnusedRestaurant(restaurantPool, window.destCoords, usedRestaurantNames);
    const bkfItem = buildMealItem(
      breakfastSlot,
      breakfastSlot.idealStartMin,
      bkfRestaurant,
      window.dayNumber,
      window.hotel,
      window.destCoords
    );
    const bkfLat = bkfItem.latitude || 0;
    const bkfLng = bkfItem.longitude || 0;

    // Find the earliest valid slot within the breakfast window
    let bkfStart: number | null = null;
    for (let t = breakfastSlot.windowStartMin; t + breakfastSlot.durationMin <= breakfastSlot.windowEndMin; t += 5) {
      if (isSlotValid(t, breakfastSlot.durationMin, bkfLat, bkfLng, 'restaurant', placed, [], window)) {
        bkfStart = t;
        break;
      }
    }

    if (bkfStart !== null) {
      bkfItem.startTime = minutesToHHMM(bkfStart);
      bkfItem.endTime = minutesToHHMM(bkfStart + breakfastSlot.durationMin);
      result.push(bkfItem);
      placed.push({
        startMin: bkfStart,
        endMin: bkfStart + breakfastSlot.durationMin,
        lat: bkfLat,
        lng: bkfLng,
        type: 'restaurant',
      });
      breakfastSlot.filled = true;
      breakfastSlot.item = bkfItem;
      if (bkfRestaurant) usedRestaurantNames.add(bkfRestaurant.name.toLowerCase().trim());
      console.log(`[Scheduler] Day ${window.dayNumber}: pre-placed breakfast at ${bkfItem.startTime}`);
    }
  }

  // 2. Place candidates one by one
  for (const candidate of candidates) {
    if (candidate.item.type === 'restaurant') {
      const preferredMin = candidate.preferredStartMin;

      // Skip restaurants that would land in the "goûter" window (15:00-18:00).
      // We only plan 3 meals: breakfast, lunch, dinner.
      // Extra LLM restaurants in the afternoon gap are unwanted filler.
      if (preferredMin >= 15 * 60 && preferredMin < 18 * 60) {
        console.log(`[Scheduler] Day ${window.dayNumber}: SKIPPED goûter-window restaurant "${candidate.item.title}" (preferred ${minutesToHHMM(preferredMin)})`);
        continue;
      }

      // Skip duplicate restaurants in the same meal window
      // (e.g., LLM planned 2 dinner restaurants — keep only 1 per meal slot)
      const isDuplicate = mealSlots.some(slot =>
        slot.filled &&
        preferredMin >= slot.windowStartMin - 30 &&
        preferredMin < slot.windowEndMin + 30
      );
      if (isDuplicate) {
        console.log(`[Scheduler] Day ${window.dayNumber}: SKIPPED duplicate meal "${candidate.item.title}"`);
        continue;
      }
    }

    const slotStart = findBestSlot(candidate, placed, mealSlots, window);

    if (slotStart === null) {
      console.log(`[Scheduler] Day ${window.dayNumber}: SKIPPED "${candidate.item.title}" — no valid slot`);
      continue;
    }

    // Reject restaurants that slid into the goûter window (15:00-18:00)
    // even though they were originally aimed at lunch or dinner.
    if (candidate.item.type === 'restaurant' && slotStart >= 15 * 60 && slotStart < 18 * 60) {
      console.log(`[Scheduler] Day ${window.dayNumber}: SKIPPED "${candidate.item.title}" — slid into goûter window (${minutesToHHMM(slotStart)})`);
      continue;
    }

    // Place the item
    candidate.item.startTime = minutesToHHMM(slotStart);
    candidate.item.endTime = minutesToHHMM(slotStart + candidate.durationMin);
    candidate.item.duration = candidate.durationMin;
    result.push(candidate.item);

    // Update placed tracker
    placed.push({
      startMin: slotStart,
      endMin: slotStart + candidate.durationMin,
      lat: candidate.lat,
      lng: candidate.lng,
      type: candidate.item.type,
    });

    // Mark meal slot as filled if this is a restaurant in a meal window
    if (candidate.item.type === 'restaurant') {
      for (const slot of mealSlots) {
        if (slot.filled) continue;
        if (slotStart >= slot.windowStartMin && slotStart < slot.windowEndMin) {
          slot.filled = true;
          slot.item = candidate.item;
          break;
        }
      }
    }
  }

  // 3. Fill empty meal slots
  for (const slot of mealSlots) {
    if (slot.filled) continue;

    // Double-check: if any placed restaurant already falls within this meal window,
    // treat the slot as filled (the candidate placement loop may have missed marking it)
    const alreadyHasRestaurant = placed.some(p =>
      p.type === 'restaurant' &&
      p.startMin >= slot.windowStartMin - 30 &&
      p.startMin < slot.windowEndMin + 30
    );
    if (alreadyHasRestaurant) {
      slot.filled = true;
      continue;
    }

    // Find reference coordinates (centroid of nearby placed items)
    const nearbyItems = result.filter(i => {
      if (!i.latitude || !i.longitude || i.latitude === 0) return false;
      const start = parseHHMM(i.startTime);
      return Math.abs(start - slot.idealStartMin) < 120;
    });

    const refCoords = nearbyItems.length > 0
      ? {
          lat: nearbyItems.reduce((s, i) => s + i.latitude!, 0) / nearbyItems.length,
          lng: nearbyItems.reduce((s, i) => s + i.longitude!, 0) / nearbyItems.length,
        }
      : window.destCoords;

    // Find restaurant
    const restaurant = slot.type === 'breakfast' && window.hotel
      ? null // Will use hotel for breakfast
      : findClosestUnusedRestaurant(restaurantPool, refCoords, usedRestaurantNames);

    // Build meal item
    const mealItem = buildMealItem(slot, slot.idealStartMin, restaurant, window.dayNumber, window.hotel, window.destCoords);

    // Find a valid slot for this meal within its window
    const mealCandidate: SchedulerCandidate = {
      item: mealItem,
      priority: 0,
      preferredStartMin: slot.idealStartMin,
      durationMin: slot.durationMin,
      lat: mealItem.latitude || 0,
      lng: mealItem.longitude || 0,
    };

    // Try placing within meal window only
    let mealStart: number | null = null;
    for (let t = slot.windowStartMin; t + slot.durationMin <= slot.windowEndMin; t += 5) {
      if (isSlotValid(t, slot.durationMin, mealCandidate.lat, mealCandidate.lng, 'restaurant', placed, [], window)) {
        mealStart = t;
        break;
      }
    }

    // Fallback: try ideal time ± 30min
    if (mealStart === null) {
      for (let t = slot.idealStartMin; t + slot.durationMin <= slot.windowEndMin + 30; t += 5) {
        if (isSlotValid(t, slot.durationMin, mealCandidate.lat, mealCandidate.lng, 'restaurant', placed, [], window)) {
          mealStart = t;
          break;
        }
      }
    }

    if (mealStart !== null) {
      mealItem.startTime = minutesToHHMM(mealStart);
      mealItem.endTime = minutesToHHMM(mealStart + slot.durationMin);
      result.push(mealItem);

      placed.push({
        startMin: mealStart,
        endMin: mealStart + slot.durationMin,
        lat: mealItem.latitude || 0,
        lng: mealItem.longitude || 0,
        type: 'restaurant',
      });

      if (restaurant) usedRestaurantNames.add(restaurant.name.toLowerCase().trim());
      console.log(`[Scheduler] Day ${window.dayNumber}: injected ${slot.type} at ${mealItem.startTime} — ${mealItem.title}`);
    } else {
      console.log(`[Scheduler] Day ${window.dayNumber}: could not find slot for ${slot.type}`);
    }
  }

  // 4. Fix meal labels based on final times
  for (const item of result) {
    fixMealLabel(item);
  }

  // 4b. Deduplicate: max 1 restaurant per meal window (keep first).
  //     Only 3 windows: breakfast (<10:30), lunch (10:30-18:00), dinner (>=18:00).
  //     No separate goûter window — we only want 3 meals per day.
  const usedMealWindows = new Set<string>();
  const deduped = result.filter(item => {
    if (item.type !== 'restaurant') return true;
    const mealWindow = item.mealType || mealTypeFromMinutes(parseHHMM(item.startTime));
    if (usedMealWindows.has(mealWindow)) {
      console.log(`[Scheduler] Day ${window.dayNumber}: removed duplicate ${mealWindow} "${item.title}"`);
      return false;
    }
    usedMealWindows.add(mealWindow);
    return true;
  });

  // 5. Sort by time and assign orderIndex
  deduped.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
  deduped.forEach((item, idx) => { item.orderIndex = idx; });

  return deduped;
}

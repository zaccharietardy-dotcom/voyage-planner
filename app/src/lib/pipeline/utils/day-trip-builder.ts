/**
 * Deterministic day-trip day builder.
 *
 * Pre-plans day-trip days (e.g., Versailles from Paris) so the LLM
 * only needs to plan city days. Day trips are formulaic: go there,
 * visit top attractions, eat lunch on-site, come back for dinner.
 *
 * Also provides a merge function to combine pre-planned day-trip days
 * with LLM-planned city days into a complete trip plan.
 */

import type {
  LLMPlannerInput,
  LLMPlannerOutput,
  LLMDayPlan,
  LLMDayItem,
  LLMRestaurantInput,
} from '../types';
import type { FetchedData } from '../types';
import type { Restaurant } from '../../types';

// ============================================
// Shared helpers (simple, self-contained)
// ============================================

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function ensureTimeAfter(time: string, minTime: string): string {
  const [h1, m1] = time.split(':').map(Number);
  const [h2, m2] = minTime.split(':').map(Number);
  return h1 * 60 + m1 >= h2 * 60 + m2 ? time : minTime;
}

function haversineDistance(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function selectClosestRestaurant(
  restaurants: { id: string; lat: number; lng: number; suitableFor: string[] }[],
  coords: { lat: number; lng: number },
  mealType: string,
  usedIds?: Set<string>
): { id: string } | null {
  const suitable = restaurants.filter(
    (r) => r.suitableFor.includes(mealType) && (!usedIds || !usedIds.has(r.id))
  );
  const candidates =
    suitable.length > 0
      ? suitable
      : restaurants.filter((r) => r.suitableFor.includes(mealType));
  if (candidates.length === 0) return null;

  let closest = candidates[0];
  let minDist = haversineDistance(coords, closest);
  for (let i = 1; i < candidates.length; i++) {
    const dist = haversineDistance(coords, candidates[i]);
    if (dist < minDist) {
      minDist = dist;
      closest = candidates[i];
    }
  }
  return { id: closest.id };
}

// ============================================
// Build Day-Trip Days
// ============================================

/**
 * Pre-plans day-trip days deterministically.
 *
 * For each day trip:
 * - Assigns a day number (middle days preferred, forcedDate honored)
 * - Builds a structured schedule: breakfast → transit → activities → lunch → transit → dinner
 * - Returns the pre-planned days and their reserved day numbers
 */
export function buildDayTripDays(
  dayTrips: LLMPlannerInput['trip']['dayTrips'] | undefined,
  data: FetchedData,
  hotel: LLMPlannerInput['hotel'],
  cityRestaurants: LLMRestaurantInput[],
  durationDays: number,
  startDate: string
): { dayTripDays: LLMDayPlan[]; reservedDayNumbers: number[] } {
  if (!dayTrips || dayTrips.length === 0) {
    return { dayTripDays: [], reservedDayNumbers: [] };
  }

  const dayTripDays: LLMDayPlan[] = [];
  const reservedDayNumbers: number[] = [];
  const usedRestaurantIds = new Set<string>();

  // Assign day numbers for each day trip
  for (let i = 0; i < dayTrips.length; i++) {
    const dt = dayTrips[i];
    let dayNum: number;

    if (dt.forcedDate) {
      // Convert forced ISO date to day number
      const tripStart = new Date(startDate);
      const forced = new Date(dt.forcedDate);
      dayNum = Math.round((forced.getTime() - tripStart.getTime()) / (86400 * 1000)) + 1;
      dayNum = Math.max(1, Math.min(dayNum, durationDays));
    } else {
      // Place on middle days (avoid first and last day)
      dayNum = Math.min(2 + i, durationDays - 1);
      // If that day is already taken, find next available
      while (reservedDayNumbers.includes(dayNum) && dayNum < durationDays) {
        dayNum++;
      }
    }

    reservedDayNumbers.push(dayNum);

    // Get day-trip activities and restaurants
    const dest = dt.destination;
    const dtActivities = (data.dayTripActivities?.[dest] || [])
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 4);
    const dtRestaurants = data.dayTripRestaurants?.[dest] || [];

    // Format day-trip restaurants for selection
    const dtRestoFormatted: { id: string; lat: number; lng: number; suitableFor: string[] }[] =
      dtRestaurants.map((r) => ({
        id: r.id,
        lat: r.latitude,
        lng: r.longitude,
        suitableFor: classifyMealSuitabilitySimple(r),
      }));

    const dtCentroid = dtActivities.length > 0
      ? {
          lat: dtActivities.reduce((s, a) => s + (a.latitude || 0), 0) / dtActivities.length,
          lng: dtActivities.reduce((s, a) => s + (a.longitude || 0), 0) / dtActivities.length,
        }
      : dt.coordinates;

    // Build schedule
    const items: LLMDayItem[] = [];
    let currentTime = '08:00';
    const transitDuration = dt.transportDurationMin || 45;

    // Breakfast near hotel before departure
    const hotelCoords = hotel ? { lat: hotel.lat, lng: hotel.lng } : dtCentroid;
    const breakfast = selectClosestRestaurant(
      cityRestaurants as any,
      hotelCoords,
      'breakfast',
      usedRestaurantIds
    );
    if (breakfast) {
      usedRestaurantIds.add(breakfast.id);
      items.push({
        type: 'restaurant',
        restaurantId: breakfast.id,
        mealType: 'breakfast',
        startTime: currentTime,
        endTime: addMinutes(currentTime, 45),
        duration: 45,
      });
      currentTime = addMinutes(currentTime, 60);
    }

    // Activities start after transit
    const activityStart = addMinutes(currentTime, transitDuration);
    currentTime = activityStart;

    for (const act of dtActivities) {
      const dur = act.duration || 60;
      items.push({
        type: 'activity',
        activityId: act.id,
        startTime: currentTime,
        endTime: addMinutes(currentTime, dur),
        duration: dur,
      });
      currentTime = addMinutes(currentTime, dur + 20);
    }

    // Lunch at day-trip destination
    const lunchPool = dtRestoFormatted.length > 0 ? dtRestoFormatted : (cityRestaurants as any);
    const lunch = selectClosestRestaurant(lunchPool, dtCentroid, 'lunch', usedRestaurantIds);
    if (lunch) {
      usedRestaurantIds.add(lunch.id);
      currentTime = ensureTimeAfter(currentTime, '12:15');
      items.push({
        type: 'restaurant',
        restaurantId: lunch.id,
        mealType: 'lunch',
        startTime: currentTime,
        endTime: addMinutes(currentTime, 75),
        duration: 75,
      });
      currentTime = addMinutes(currentTime, 90);
    }

    // Dinner back in city (after return transit)
    const dinner = selectClosestRestaurant(
      cityRestaurants as any,
      hotelCoords,
      'dinner',
      usedRestaurantIds
    );
    if (dinner) {
      usedRestaurantIds.add(dinner.id);
      const dinnerTime = ensureTimeAfter(addMinutes(currentTime, transitDuration), '19:00');
      items.push({
        type: 'restaurant',
        restaurantId: dinner.id,
        mealType: 'dinner',
        startTime: dinnerTime,
        endTime: addMinutes(dinnerTime, 90),
        duration: 90,
      });
    }

    dayTripDays.push({
      dayNumber: dayNum,
      theme: dest,
      narrative: `Excursion ${dest}`,
      isDayTrip: true,
      dayTripDestination: dest,
      items,
    });

    console.log(
      `[Day-Trip Builder] Day ${dayNum}: ${dest} — ${dtActivities.length} activities, ${items.length} items total`
    );
  }

  return { dayTripDays, reservedDayNumbers };
}

// ============================================
// Merge Day-Trip Days with LLM Plan
// ============================================

/**
 * Merges pre-planned day-trip days with LLM-planned city days.
 *
 * The LLM may number its days contiguously (1, 2) when told to plan days 1 and 3.
 * This function renumbers LLM days to fill non-reserved slots, then inserts
 * day-trip days at their reserved positions.
 */
export function mergeDayTripDaysWithLLMPlan(
  llmPlan: LLMPlannerOutput,
  dayTripDays: LLMDayPlan[],
  reservedDayNumbers: number[],
  totalDays: number
): LLMDayPlan[] {
  if (dayTripDays.length === 0) return llmPlan.days;

  const reservedSet = new Set(reservedDayNumbers);

  // Determine available (non-reserved) day slots
  const availableSlots: number[] = [];
  for (let d = 1; d <= totalDays; d++) {
    if (!reservedSet.has(d)) availableSlots.push(d);
  }

  // Sort LLM days by their current dayNumber
  const llmDays = [...llmPlan.days].sort((a, b) => a.dayNumber - b.dayNumber);

  // Renumber LLM days to fill available slots
  const renumbered: LLMDayPlan[] = [];
  for (let i = 0; i < llmDays.length && i < availableSlots.length; i++) {
    renumbered.push({
      ...llmDays[i],
      dayNumber: availableSlots[i],
    });
  }

  // Combine with day-trip days
  const allDays = [...renumbered, ...dayTripDays];
  allDays.sort((a, b) => a.dayNumber - b.dayNumber);

  return allDays;
}

// ============================================
// Simple meal type classifier (for day-trip restaurants)
// ============================================

function classifyMealSuitabilitySimple(restaurant: Restaurant): ('breakfast' | 'lunch' | 'dinner')[] {
  const name = (restaurant.name || '').toLowerCase();
  const types = (restaurant.cuisineTypes || []).join(' ').toLowerCase();
  const text = `${name} ${types}`;

  const meals: ('breakfast' | 'lunch' | 'dinner')[] = [];

  // Breakfast keywords
  if (/breakfast|brunch|café|cafe|bakery|boulangerie|pâtisserie|patisserie|petit[- ]?déj/i.test(text)) {
    meals.push('breakfast');
  }

  // Most restaurants serve lunch and dinner
  meals.push('lunch', 'dinner');

  return meals;
}

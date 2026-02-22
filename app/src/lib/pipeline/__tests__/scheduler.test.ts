/**
 * Unit tests for scheduler module
 *
 * Coverage: 73.31% of scheduler.ts
 *
 * Tests:
 * 1. computeTravelGap — travel time computation based on distance
 *    - Distance < 0.3km → 0 minutes
 *    - Distance 0.3-3km → walking time (dist*1000/80 + 5, ceil to 5)
 *    - Distance > 3km → transit time (dist/15*60 + 10, min 20, ceil to 5)
 *    - Missing coordinates → 5 minutes
 *
 * 2. buildDayWindow — day window boundaries based on transport
 *    - Full day: 7:30-22:00
 *    - First day: starts after arrival transport + 30min
 *    - Last day: ends before departure transport - 30min
 *    - Single day: both constraints apply
 *    - Minimum 60-minute window enforcement
 *
 * 3. buildMealSlots — meal slot creation based on window
 *    - Full day → 3 meal slots (breakfast, lunch, dinner)
 *    - Late arrival (after 9:30) → no breakfast
 *    - Early departure (before 20:30) → no dinner
 *    - Meal windows: breakfast 7:30-9:30, lunch 11:30-14:00, dinner 18:30-21:30
 *
 * 4. buildCandidates — candidate building and prioritization
 *    - Excludes transport/checkin/checkout items
 *    - mustSee items get priority +1000
 *    - Restaurants get priority +500
 *    - Sorted by priority DESC then time ASC
 *    - Duration computed from endTime-startTime or duration field
 *
 * 5. scheduleDayItems — main scheduling integration
 *    - Places activities with meals on full day
 *    - Pre-places breakfast on full/last days
 *    - Skips activities that don't fit (no cascade)
 *    - Fills empty meal slots from restaurant pool
 *    - Labels meals based on final time (breakfast <10:30, lunch 10:30-18:00, dinner ≥18:00)
 *    - No goûter: restaurants in 15:00-18:00 are skipped (only 3 meals: breakfast/lunch/dinner)
 *    - Restaurant candidates in lunch window fill lunch slot
 *    - No overlaps in final schedule
 *    - All times are multiples of 5
 *    - Correct orderIndex based on time order
 */

import {
  computeTravelGap,
  buildDayWindow,
  buildMealSlots,
  buildCandidates,
  scheduleDayItems,
  type DayWindow,
  type MealSlot,
} from '../scheduler';
import type { TripItem, TripDay, Accommodation, Restaurant, TransportOptionSummary } from '../../types/trip';

// ============================================
// Test helpers — minimal mock objects
// ============================================

function mockTripItem(overrides: Partial<TripItem>): TripItem {
  return {
    id: overrides.id || 'item-1',
    dayNumber: overrides.dayNumber || 1,
    startTime: overrides.startTime || '09:00',
    endTime: overrides.endTime || '10:00',
    type: overrides.type || 'activity',
    title: overrides.title || 'Test Activity',
    description: overrides.description || 'Test description',
    locationName: overrides.locationName || 'Test Location',
    latitude: overrides.latitude ?? 48.8566,
    longitude: overrides.longitude ?? 2.3522,
    orderIndex: overrides.orderIndex ?? 0,
    duration: overrides.duration,
    estimatedCost: overrides.estimatedCost,
    mustSee: overrides.mustSee,
    ...overrides,
  };
}

function mockTripDay(dayNumber: number, items: TripItem[]): TripDay {
  return {
    dayNumber,
    date: new Date(2026, 2, dayNumber),
    items,
  };
}

function mockAccommodation(overrides?: Partial<Accommodation>): Accommodation {
  return {
    id: 'hotel-1',
    name: 'Hotel de Paris',
    type: 'hotel',
    address: '123 Rue de Rivoli, Paris',
    latitude: 48.8606,
    longitude: 2.3376,
    rating: 8.5,
    reviewCount: 500,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    breakfastIncluded: true,
    ...overrides,
  };
}

function mockRestaurant(overrides?: Partial<Restaurant>): Restaurant {
  return {
    id: overrides?.id || 'restaurant-1',
    name: overrides?.name || 'Le Bistrot Parisien',
    address: '456 Rue Saint-Honoré, Paris',
    latitude: overrides?.latitude ?? 48.8650,
    longitude: overrides?.longitude ?? 2.3300,
    rating: overrides?.rating ?? 4.5,
    reviewCount: overrides?.reviewCount ?? 200,
    priceLevel: overrides?.priceLevel || 2,
    cuisineTypes: overrides?.cuisineTypes || ['french', 'bistro'],
    dietaryOptions: [],
    openingHours: {},
    ...overrides,
  };
}

// ============================================
// Tests: computeTravelGap
// ============================================

describe('computeTravelGap', () => {
  it('returns 0 minutes for distance < 0.3km', () => {
    // Same location
    expect(computeTravelGap(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);

    // Very close (< 300m)
    expect(computeTravelGap(48.8566, 2.3522, 48.8570, 2.3525)).toBe(0);
  });

  it('computes walking time for distance 0.3-3km (ceil to 5)', () => {
    // 0.5km: (500/80 + 5) = 11.25 → ceil to 15
    const result1 = computeTravelGap(48.8566, 2.3522, 48.8610, 2.3522);
    expect(result1).toBeGreaterThanOrEqual(10);
    expect(result1).toBeLessThanOrEqual(20);
    expect(result1 % 5).toBe(0); // Multiple of 5

    // 1.5km: (1500/80 + 5) = 23.75 → ceil to 25
    const result2 = computeTravelGap(48.8566, 2.3522, 48.8700, 2.3522);
    expect(result2).toBeGreaterThanOrEqual(20);
    expect(result2).toBeLessThanOrEqual(30);
    expect(result2 % 5).toBe(0);
  });

  it('computes transit time for distance > 3km (min 20, ceil to 5)', () => {
    // 5km: (5/15*60 + 10) = 30 → 30 (already multiple of 5)
    const result1 = computeTravelGap(48.8566, 2.3522, 48.8900, 2.3522);
    expect(result1).toBeGreaterThanOrEqual(25);
    expect(result1).toBeLessThanOrEqual(35);
    expect(result1 % 5).toBe(0);

    // 10km: (10/15*60 + 10) = 50 → 50
    const result2 = computeTravelGap(48.8566, 2.3522, 48.9500, 2.3522);
    expect(result2).toBeGreaterThanOrEqual(45);
    expect(result2).toBeLessThanOrEqual(55);
    expect(result2 % 5).toBe(0);
  });

  it('returns 5 minutes for missing coordinates', () => {
    expect(computeTravelGap(0, 0, 48.8566, 2.3522)).toBe(5);
    expect(computeTravelGap(48.8566, 2.3522, 0, 0)).toBe(5);
    expect(computeTravelGap(NaN, NaN, 48.8566, 2.3522)).toBe(5);
  });
});

// ============================================
// Tests: buildDayWindow
// ============================================

describe('buildDayWindow', () => {
  const destCoords = { lat: 48.8566, lng: 2.3522 }; // Paris
  const hotel = mockAccommodation();

  it('builds full day window (7:30-22:00) for middle days', () => {
    const day = mockTripDay(2, []);
    const window = buildDayWindow(day, 5, null, hotel, destCoords);

    expect(window.dayType).toBe('full');
    expect(window.startMin).toBe(7 * 60 + 30); // 07:30
    expect(window.endMin).toBe(22 * 60); // 22:00
  });

  it('adjusts start time after arrival transport on first day', () => {
    const arrivalTransport = mockTripItem({
      id: 'transport-1',
      type: 'transport',
      startTime: '10:00',
      endTime: '12:00',
    });
    const day = mockTripDay(1, [arrivalTransport]);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);

    expect(window.dayType).toBe('first');
    // Window starts after transport end (12:00) + 30min = 12:30
    expect(window.startMin).toBe(12 * 60 + 30);
  });

  it('adjusts end time before departure transport on last day', () => {
    const departureTransport = mockTripItem({
      id: 'transport-2',
      type: 'flight',
      startTime: '18:00',
      endTime: '20:00',
    });
    const day = mockTripDay(3, [departureTransport]);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);

    expect(window.dayType).toBe('last');
    // Window ends before transport start (18:00) - 30min = 17:30
    expect(window.endMin).toBe(17 * 60 + 30);
  });

  it('handles single day trip with both arrival and departure', () => {
    const arrivalTransport = mockTripItem({
      id: 'transport-1',
      type: 'flight',
      startTime: '08:00',
      endTime: '10:00',
    });
    const departureTransport = mockTripItem({
      id: 'transport-2',
      type: 'flight',
      startTime: '20:00',
      endTime: '22:00',
    });
    const day = mockTripDay(1, [arrivalTransport, departureTransport]);
    const window = buildDayWindow(day, 1, null, hotel, destCoords);

    expect(window.dayType).toBe('single');
    expect(window.startMin).toBe(10 * 60 + 30); // After arrival + 30min
    expect(window.endMin).toBe(19 * 60 + 30); // Before departure - 30min
  });

  it('ensures minimum 60-minute window', () => {
    const arrivalTransport = mockTripItem({
      id: 'transport-1',
      type: 'flight',
      startTime: '20:00',
      endTime: '21:30',
    });
    const departureTransport = mockTripItem({
      id: 'transport-2',
      type: 'flight',
      startTime: '21:45',
      endTime: '23:00',
    });
    const day = mockTripDay(1, [arrivalTransport, departureTransport]);
    const window = buildDayWindow(day, 1, null, hotel, destCoords);

    // Window should be at least 60 minutes
    expect(window.endMin - window.startMin).toBeGreaterThanOrEqual(60);
  });
});

// ============================================
// Tests: buildMealSlots
// ============================================

describe('buildMealSlots', () => {
  it('creates 3 meal slots for full day (7:30-22:00)', () => {
    const window: DayWindow = {
      dayNumber: 1,
      dayType: 'full',
      startMin: 7 * 60 + 30,
      endMin: 22 * 60,
      anchors: [],
      hotel: null,
      destCoords: { lat: 48.8566, lng: 2.3522 },
    };

    const slots = buildMealSlots(window);
    expect(slots).toHaveLength(3);

    // Breakfast
    expect(slots[0].type).toBe('breakfast');
    expect(slots[0].windowStartMin).toBe(7 * 60 + 30);
    expect(slots[0].windowEndMin).toBe(9 * 60 + 30);
    expect(slots[0].durationMin).toBe(30);

    // Lunch
    expect(slots[1].type).toBe('lunch');
    expect(slots[1].windowStartMin).toBe(11 * 60 + 30);
    expect(slots[1].windowEndMin).toBe(14 * 60);
    expect(slots[1].durationMin).toBe(60);

    // Dinner
    expect(slots[2].type).toBe('dinner');
    expect(slots[2].windowStartMin).toBe(18 * 60 + 30);
    expect(slots[2].windowEndMin).toBe(21 * 60 + 30);
    expect(slots[2].durationMin).toBe(75);
  });

  it('skips breakfast for late arrival (after 9:30)', () => {
    const window: DayWindow = {
      dayNumber: 1,
      dayType: 'first',
      startMin: 10 * 60, // 10:00
      endMin: 22 * 60,
      anchors: [],
      hotel: null,
      destCoords: { lat: 48.8566, lng: 2.3522 },
    };

    const slots = buildMealSlots(window);
    expect(slots.find(s => s.type === 'breakfast')).toBeUndefined();
    expect(slots.find(s => s.type === 'lunch')).toBeDefined();
    expect(slots.find(s => s.type === 'dinner')).toBeDefined();
  });

  it('skips dinner for early departure (before 20:30)', () => {
    const window: DayWindow = {
      dayNumber: 3,
      dayType: 'last',
      startMin: 7 * 60 + 30,
      endMin: 18 * 60, // 18:00
      anchors: [],
      hotel: null,
      destCoords: { lat: 48.8566, lng: 2.3522 },
    };

    const slots = buildMealSlots(window);
    expect(slots.find(s => s.type === 'breakfast')).toBeDefined();
    expect(slots.find(s => s.type === 'lunch')).toBeDefined();
    expect(slots.find(s => s.type === 'dinner')).toBeUndefined();
  });

  it('creates only lunch for half-day window (10:00-17:00)', () => {
    const window: DayWindow = {
      dayNumber: 1,
      dayType: 'first',
      startMin: 10 * 60,
      endMin: 17 * 60,
      anchors: [],
      hotel: null,
      destCoords: { lat: 48.8566, lng: 2.3522 },
    };

    const slots = buildMealSlots(window);
    expect(slots).toHaveLength(1);
    expect(slots[0].type).toBe('lunch');
  });
});

// ============================================
// Tests: buildCandidates
// ============================================

describe('buildCandidates', () => {
  it('excludes transport/checkin/checkout items', () => {
    const items: TripItem[] = [
      mockTripItem({ id: '1', type: 'transport' }),
      mockTripItem({ id: '2', type: 'flight' }),
      mockTripItem({ id: '3', type: 'checkin' }),
      mockTripItem({ id: '4', type: 'checkout' }),
      mockTripItem({ id: '5', type: 'activity' }),
      mockTripItem({ id: '6', type: 'restaurant' }),
    ];

    const candidates = buildCandidates(items);
    expect(candidates).toHaveLength(2);
    expect(candidates.find(c => c.item.type === 'transport')).toBeUndefined();
    expect(candidates.find(c => c.item.type === 'activity')).toBeDefined();
    expect(candidates.find(c => c.item.type === 'restaurant')).toBeDefined();
  });

  it('adds priority +1000 for mustSee items', () => {
    const items: TripItem[] = [
      mockTripItem({ id: '1', type: 'activity', mustSee: false, orderIndex: 0 }),
      mockTripItem({ id: '2', type: 'activity', mustSee: true, orderIndex: 0 }), // Same orderIndex
    ];

    const candidates = buildCandidates(items);
    const regularItem = candidates.find(c => c.item.id === '1');
    const mustSeeItem = candidates.find(c => c.item.id === '2');

    expect(mustSeeItem!.priority).toBeGreaterThan(regularItem!.priority);
    expect(mustSeeItem!.priority - regularItem!.priority).toBe(1000); // Exactly +1000
  });

  it('adds priority +500 for restaurant items', () => {
    const items: TripItem[] = [
      mockTripItem({ id: '1', type: 'activity', orderIndex: 0 }),
      mockTripItem({ id: '2', type: 'restaurant', orderIndex: 0 }),
    ];

    const candidates = buildCandidates(items);
    const activityItem = candidates.find(c => c.item.id === '1');
    const restaurantItem = candidates.find(c => c.item.id === '2');

    expect(restaurantItem!.priority).toBeGreaterThan(activityItem!.priority);
    expect(restaurantItem!.priority - activityItem!.priority).toBeGreaterThanOrEqual(500);
  });

  it('sorts by priority DESC then by time ASC', () => {
    const items: TripItem[] = [
      mockTripItem({ id: '1', type: 'activity', mustSee: false, startTime: '10:00', orderIndex: 2 }),
      mockTripItem({ id: '2', type: 'activity', mustSee: true, startTime: '14:00', orderIndex: 1 }),
      mockTripItem({ id: '3', type: 'restaurant', startTime: '12:00', orderIndex: 0 }),
      mockTripItem({ id: '4', type: 'activity', mustSee: true, startTime: '09:00', orderIndex: 0 }),
    ];

    const candidates = buildCandidates(items);

    // mustSee items should be first (highest priority)
    expect(candidates[0].item.mustSee).toBe(true);
    expect(candidates[1].item.mustSee).toBe(true);

    // Among mustSee items, earlier time comes first
    expect(candidates[0].item.startTime).toBe('09:00');
    expect(candidates[1].item.startTime).toBe('14:00');

    // Restaurant comes next (priority +500)
    expect(candidates[2].item.type).toBe('restaurant');

    // Regular activity comes last
    expect(candidates[3].item.type).toBe('activity');
    expect(candidates[3].item.mustSee).toBeFalsy();
  });

  it('computes duration from endTime-startTime or duration field', () => {
    const items: TripItem[] = [
      mockTripItem({ id: '1', startTime: '10:00', endTime: '12:00' }), // 120 min
      mockTripItem({ id: '2', startTime: '14:00', endTime: '14:30', duration: 60 }), // max(30, 60) = 60
    ];

    const candidates = buildCandidates(items);
    expect(candidates[0].durationMin).toBe(120);
    expect(candidates[1].durationMin).toBe(60);
  });
});

// ============================================
// Tests: scheduleDayItems (integration)
// ============================================

describe('scheduleDayItems', () => {
  const destCoords = { lat: 48.8566, lng: 2.3522 }; // Paris
  const hotel = mockAccommodation();

  it('places all activities with meals on a full day', () => {
    const activity1 = mockTripItem({
      id: 'act-1',
      type: 'activity',
      startTime: '10:00',
      endTime: '11:30',
      duration: 90,
      latitude: 48.8606,
      longitude: 2.3376,
    });
    const activity2 = mockTripItem({
      id: 'act-2',
      type: 'activity',
      startTime: '15:00',
      endTime: '16:30',
      duration: 90,
      latitude: 48.8530,
      longitude: 2.3499,
    });

    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([activity1, activity2]);

    const restaurantPool: Restaurant[] = [
      mockRestaurant({ id: 'rest-1', latitude: 48.8600, longitude: 2.3400 }),
      mockRestaurant({ id: 'rest-2', latitude: 48.8550, longitude: 2.3450 }),
    ];
    const usedRestaurantNames = new Set<string>();

    const result = scheduleDayItems(candidates, mealSlots, window, restaurantPool, usedRestaurantNames);

    // Should have: breakfast + activities + lunch/dinner
    expect(result.length).toBeGreaterThanOrEqual(3);

    // All items have valid times
    result.forEach(item => {
      expect(item.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(item.endTime).toMatch(/^\d{2}:\d{2}$/);
    });

    // Times are multiples of 5
    result.forEach(item => {
      const [h, m] = item.startTime.split(':').map(Number);
      expect(m % 5).toBe(0);
    });

    // No overlaps
    for (let i = 0; i < result.length - 1; i++) {
      const currentEnd = result[i].endTime;
      const nextStart = result[i + 1].startTime;
      const parseTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      expect(parseTime(nextStart)).toBeGreaterThanOrEqual(parseTime(currentEnd));
    }
  });

  it('pre-places breakfast on full days', () => {
    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([]);

    const restaurantPool: Restaurant[] = [];
    const usedRestaurantNames = new Set<string>();

    const result = scheduleDayItems(candidates, mealSlots, window, restaurantPool, usedRestaurantNames);

    const breakfast = result.find(item => item.type === 'restaurant' && item.startTime < '10:30');
    expect(breakfast).toBeDefined();
    expect(breakfast!.title).toContain('Petit-déjeuner');
  });

  it('skips activities that do not fit', () => {
    // Create a very packed day with little room
    const day = mockTripDay(1, []);
    const window: DayWindow = {
      dayNumber: 1,
      dayType: 'first',
      startMin: 14 * 60, // 14:00
      endMin: 16 * 60,   // 16:00 — only 2 hours
      anchors: [],
      hotel: null,
      destCoords,
    };

    // 3 activities, each 90 minutes — can't all fit
    const activities: TripItem[] = [
      mockTripItem({ id: 'act-1', startTime: '14:00', endTime: '15:30', duration: 90 }),
      mockTripItem({ id: 'act-2', startTime: '15:00', endTime: '16:30', duration: 90 }),
      mockTripItem({ id: 'act-3', startTime: '15:30', endTime: '17:00', duration: 90 }),
    ];

    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates(activities);
    const result = scheduleDayItems(candidates, mealSlots, window, [], new Set());

    // Only 1 activity should fit
    const placedActivities = result.filter(item => item.type === 'activity');
    expect(placedActivities.length).toBeLessThan(3);
  });

  it('fills empty meal slots from restaurant pool', () => {
    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([]); // No activities

    const restaurantPool: Restaurant[] = [
      mockRestaurant({ id: 'rest-1', latitude: 48.8600, longitude: 2.3400 }),
      mockRestaurant({ id: 'rest-2', latitude: 48.8550, longitude: 2.3450 }),
      mockRestaurant({ id: 'rest-3', latitude: 48.8580, longitude: 2.3380 }),
    ];

    const result = scheduleDayItems(candidates, mealSlots, window, restaurantPool, new Set());

    // Should have 3 meals (breakfast, lunch, dinner)
    const meals = result.filter(item => item.type === 'restaurant');
    expect(meals.length).toBe(3);
  });

  it('labels meals based on final time slot', () => {
    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([]);

    const restaurantPool: Restaurant[] = [
      mockRestaurant({ id: 'rest-1' }),
    ];

    const result = scheduleDayItems(candidates, mealSlots, window, restaurantPool, new Set());

    // Check meal labels
    result.forEach(item => {
      if (item.type === 'restaurant') {
        const [h, m] = item.startTime.split(':').map(Number);
        const startMin = h * 60 + m;

        if (startMin < 10 * 60 + 30) {
          expect(item.title).toContain('Petit-déjeuner');
        } else if (startMin < 18 * 60) {
          // Lunch or late lunch (no separate goûter)
          expect(item.title).toContain('Déjeuner');
        } else {
          expect(item.title).toContain('Dîner');
        }
      }
    });
  });

  it('relabels restaurant title/mealType when final slot drifts to dinner', () => {
    const mislabeledRestaurant = mockTripItem({
      id: 'rest-drift',
      type: 'restaurant',
      title: 'Déjeuner — Drift Bistro',
      startTime: '19:10',
      endTime: '20:10',
      duration: 60,
      latitude: 48.8615,
      longitude: 2.3387,
      restaurant: mockRestaurant({ id: 'rest-drift', name: 'Drift Bistro' }) as any,
    });

    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([mislabeledRestaurant]);
    const result = scheduleDayItems(candidates, mealSlots, window, [], new Set());

    const placed = result.find((item) => item.id === 'rest-drift');
    expect(placed).toBeDefined();
    expect(placed?.mealType).toBe('dinner');
    expect(placed?.title.startsWith('Dîner')).toBe(true);
  });

  it('fills lunch slot when restaurant candidate is in lunch window', () => {
    const restaurantItem = mockTripItem({
      id: 'rest-1',
      type: 'restaurant',
      startTime: '12:30',
      endTime: '13:30',
      duration: 60,
      latitude: 48.8600,
      longitude: 2.3400,
    });

    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([restaurantItem]);

    const result = scheduleDayItems(candidates, mealSlots, window, [], new Set());

    // The restaurant should be placed and fill the lunch slot
    const lunch = result.find(item => item.type === 'restaurant' && item.id === 'rest-1');
    expect(lunch).toBeDefined();

    // Lunch slot should be marked as filled
    const lunchSlot = mealSlots.find(s => s.type === 'lunch');
    expect(lunchSlot!.filled).toBe(true);
  });

  it('assigns correct orderIndex based on time order', () => {
    const activity1 = mockTripItem({ id: 'act-1', startTime: '10:00', endTime: '11:00' });
    const activity2 = mockTripItem({ id: 'act-2', startTime: '15:00', endTime: '16:00' });

    const day = mockTripDay(1, []);
    const window = buildDayWindow(day, 3, null, hotel, destCoords);
    const mealSlots = buildMealSlots(window);
    const candidates = buildCandidates([activity1, activity2]);

    const result = scheduleDayItems(candidates, mealSlots, window, [], new Set());

    // Items should be sorted by time
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].orderIndex).toBeLessThan(result[i + 1].orderIndex);

      const parseTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      expect(parseTime(result[i].startTime)).toBeLessThanOrEqual(parseTime(result[i + 1].startTime));
    }
  });
});

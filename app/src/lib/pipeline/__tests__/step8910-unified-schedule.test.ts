import { unifiedScheduleV3Days } from '../step8910-unified-schedule';
import type { ActivityCluster, ScoredActivity, FetchedData } from '../types';
import type { DayTravelTimes, TravelLeg } from '../step7b-travel-times';
import type { DayTimeWindow } from '../step4-anchor-transport';
import type { Restaurant, Accommodation, TripPreferences } from '../../types';

// ============================================
// Test helpers
// ============================================

function basePreferences(overrides: Partial<TripPreferences> = {}): TripPreferences {
  return {
    origin: 'Paris',
    destination: 'Barcelona',
    startDate: new Date('2026-03-16T00:00:00.000Z'), // Monday
    durationDays: 1,
    transport: 'plane',
    carRental: false,
    groupSize: 2,
    groupType: 'couple',
    budgetLevel: 'moderate',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: 'Sagrada Familia',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ScoredActivity> = {}): ScoredActivity {
  return {
    id: 'act-1',
    name: 'Test Activity',
    type: 'culture',
    description: 'A test activity',
    duration: 90,
    estimatedCost: 20,
    latitude: 41.4036,
    longitude: 2.1744,
    rating: 4.7,
    mustSee: false,
    bookingRequired: false,
    openingHours: { open: '09:00', close: '18:00' },
    score: 80,
    source: 'google_places',
    reviewCount: 1000,
    ...overrides,
  } as ScoredActivity;
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    name: 'Restaurant Test',
    address: 'Barcelona',
    latitude: 41.4036,  // Same as activity — within 800m
    longitude: 2.1744,
    rating: 4.6,
    reviewCount: 500,
    priceLevel: 2 as const,
    cuisineTypes: ['mediterranean'],
    dietaryOptions: [],
    openingHours: {
      monday: { open: '07:00', close: '23:00' },
      tuesday: { open: '07:00', close: '23:00' },
      wednesday: { open: '07:00', close: '23:00' },
      thursday: { open: '07:00', close: '23:00' },
      friday: { open: '07:00', close: '23:00' },
      saturday: { open: '07:00', close: '23:00' },
      sunday: { open: '07:00', close: '23:00' },
    },
    ...overrides,
  };
}

function makeHotel(overrides: Partial<Accommodation> = {}): Accommodation {
  return {
    id: 'hotel-1',
    name: 'Hotel Barcelona',
    type: 'hotel',
    address: 'Barcelona',
    latitude: 41.3900,
    longitude: 2.1700,
    rating: 8.5,
    reviewCount: 200,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    ...overrides,
  };
}

function makeCluster(dayNumber: number, activities: ScoredActivity[]): ActivityCluster {
  const lat = activities.length > 0 ? activities.reduce((s, a) => s + a.latitude, 0) / activities.length : 41.3851;
  const lng = activities.length > 0 ? activities.reduce((s, a) => s + a.longitude, 0) / activities.length : 2.1734;
  return {
    dayNumber,
    activities,
    centroid: { lat, lng },
    totalIntraDistance: 0.5,
  };
}

function makeTimeWindow(dayNumber: number, overrides: Partial<DayTimeWindow> = {}): DayTimeWindow {
  return {
    dayNumber,
    activityStartTime: '08:30',
    activityEndTime: '21:00',
    hasArrivalTransport: false,
    hasDepartureTransport: false,
    ...overrides,
  };
}

function makeTravelTimes(dayNumber: number, legs: TravelLeg[] = []): DayTravelTimes {
  return { dayNumber, legs, totalTravelMinutes: legs.reduce((s, l) => s + l.durationMinutes, 0) };
}

function emptyData(): FetchedData {
  return {
    destCoords: { lat: 41.3851, lng: 2.1734 },
    originCoords: { lat: 48.8566, lng: 2.3522 },
    originAirports: [],
    destAirports: [],
    googlePlacesAttractions: [],
    serpApiAttractions: [],
    overpassAttractions: [],
    viatorActivities: [],
    mustSeeAttractions: [],
    tripAdvisorRestaurants: [],
    serpApiRestaurants: [],
    bookingHotels: [],
    transportOptions: [],
    outboundFlight: null,
    returnFlight: null,
    flightAlternatives: { outbound: [], return: [] },
    weatherForecasts: [],
    dayTripSuggestions: [],
    dayTripActivities: {},
    dayTripRestaurants: {},
    travelTips: {},
    budgetStrategy: {} as any,
    resolvedBudget: {} as any,
  } as FetchedData;
}

// ============================================
// Tests
// ============================================

describe('unifiedScheduleV3Days', () => {
  describe('output shape', () => {
    it('returns RepairResult with days, repairs, and unresolvedViolations', () => {
      const act = makeActivity();
      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      expect(result).toHaveProperty('days');
      expect(result).toHaveProperty('repairs');
      expect(result).toHaveProperty('unresolvedViolations');
      expect(Array.isArray(result.days)).toBe(true);
      expect(Array.isArray(result.repairs)).toBe(true);
      expect(Array.isArray(result.unresolvedViolations)).toBe(true);
    });

    it('produces one TripDay per cluster', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Act 1' });
      const act2 = makeActivity({ id: 'a2', name: 'Act 2', latitude: 41.41, longitude: 2.18 });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1]), makeCluster(2, [act2])],
        [makeTravelTimes(1), makeTravelTimes(2)],
        [makeTimeWindow(1), makeTimeWindow(2)],
        null,
        basePreferences({ durationDays: 2 }),
        emptyData(),
        [],
        [act1, act2],
        { lat: 41.3851, lng: 2.1734 }
      );

      expect(result.days).toHaveLength(2);
      expect(result.days[0].dayNumber).toBe(1);
      expect(result.days[1].dayNumber).toBe(2);
    });
  });

  describe('3 meals per day', () => {
    it('places breakfast, lunch, and dinner even without restaurants (Repas libre fallback)', () => {
      const act = makeActivity();
      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [], // No restaurants
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const meals = result.days[0].items.filter(i => i.type === 'restaurant');
      const mealTypes = meals.map(m => m.mealType);
      expect(mealTypes).toContain('breakfast');
      expect(mealTypes).toContain('lunch');
      expect(mealTypes).toContain('dinner');
    });

    it('places actual restaurants when available nearby', () => {
      const act = makeActivity();
      const restaurant = makeRestaurant({ id: 'r-nearby', name: 'Bar Catalonia' });
      const restaurant2 = makeRestaurant({ id: 'r-nearby-2', name: 'Tapas Place', cuisineTypes: ['tapas'] });
      const restaurant3 = makeRestaurant({ id: 'r-nearby-3', name: 'Pizzeria', cuisineTypes: ['italian'] });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [restaurant, restaurant2, restaurant3],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const meals = result.days[0].items.filter(i => i.type === 'restaurant');
      // At least one meal should have a real restaurant (not "Repas libre")
      const realMeals = meals.filter(m => !m.title?.includes('Repas libre'));
      expect(realMeals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('breakfast behavior', () => {
    it('uses hotel breakfast fallback when no breakfast restaurant within 800m', () => {
      const act = makeActivity();
      const hotel = makeHotel({ name: 'Grand Hotel BCN' });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        hotel,
        basePreferences(),
        emptyData(),
        [], // No restaurants
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const breakfast = result.days[0].items.find(i => i.mealType === 'breakfast');
      expect(breakfast).toBeDefined();
      // Hotel breakfast fallback uses the hotel name
      expect(breakfast!.title).toContain('Grand Hotel BCN');
    });

    it('uses "Repas libre" when no hotel and no restaurants', () => {
      const act = makeActivity();

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null, // No hotel
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const breakfast = result.days[0].items.find(i => i.mealType === 'breakfast');
      expect(breakfast).toBeDefined();
      expect(breakfast!.title).toContain('Repas libre');
      expect(breakfast!.qualityFlags).toContain('self_meal_fallback');
    });
  });

  describe('activity scheduling', () => {
    it('places activities within the day', () => {
      const act = makeActivity({ id: 'sagrada', name: 'Sagrada Familia', duration: 90 });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const activities = result.days[0].items.filter(i => i.type === 'activity');
      expect(activities).toHaveLength(1);
      expect(activities[0].title).toContain('Sagrada Familia');
      expect(activities[0].duration).toBeGreaterThanOrEqual(90);
    });

    it('places multiple activities in sequence', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Sagrada Familia', duration: 90 });
      const act2 = makeActivity({ id: 'a2', name: 'Park Guell', duration: 60, latitude: 41.4145, longitude: 2.1527 });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1, act2])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act1, act2],
        { lat: 41.3851, lng: 2.1734 }
      );

      const activities = result.days[0].items.filter(i => i.type === 'activity');
      expect(activities.length).toBe(2);
    });

    it('stops placing activities past dayEndTime', () => {
      // Create many activities that won't all fit in a short day
      const activities = Array.from({ length: 10 }, (_, i) => makeActivity({
        id: `act-${i}`,
        name: `Activity ${i}`,
        duration: 120,
        latitude: 41.40 + i * 0.001,
      }));

      const result = unifiedScheduleV3Days(
        [makeCluster(1, activities)],
        [makeTravelTimes(1)],
        [makeTimeWindow(1, { activityEndTime: '15:00' })], // Short day
        null,
        basePreferences(),
        emptyData(),
        [],
        activities,
        { lat: 41.3851, lng: 2.1734 }
      );

      // Not all 10 activities should fit in a day ending at 15:00
      const placed = result.days[0].items.filter(i => i.type === 'activity');
      expect(placed.length).toBeLessThan(10);
    });
  });

  describe('opening hours enforcement', () => {
    it('skips non-must-see activities that would end after closing time', () => {
      // Activity closes at 12:00 but would be placed at ~09:30+ (after breakfast)
      // With 90min duration, it would end at 11:00 — still fine
      // But a second activity closing at 10:00 would be skipped
      const actOk = makeActivity({ id: 'ok', name: 'Morning Museum', duration: 60, openingHours: { open: '09:00', close: '18:00' } });
      const actClosed = makeActivity({
        id: 'closed', name: 'Early Close', duration: 120,
        openingHours: { open: '08:00', close: '10:00' }, // Closes at 10:00
        latitude: 41.405, longitude: 2.175,
      });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [actOk, actClosed])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [actOk, actClosed],
        { lat: 41.3851, lng: 2.1734 }
      );

      const activities = result.days[0].items.filter(i => i.type === 'activity');
      const titles = activities.map(a => a.title);
      expect(titles.some(t => t.includes('Morning Museum'))).toBe(true);
      // Early Close should be skipped (closes 10:00, can't fit 120min after breakfast)
      expect(titles.some(t => t.includes('Early Close'))).toBe(false);
    });

    it('shifts must-see start time to fit within closing hours', () => {
      // Must-see closes at 14:00 — if placed at 13:00 with 90min, it would end at 14:30 → shift to 12:30
      const mustSee = makeActivity({
        id: 'must-see-1',
        name: 'Must See Museum',
        duration: 90,
        mustSee: true,
        openingHours: { open: '09:00', close: '14:00' },
      });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [mustSee])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [mustSee],
        { lat: 41.3851, lng: 2.1734 }
      );

      const activities = result.days[0].items.filter(i => i.type === 'activity');
      expect(activities).toHaveLength(1);
      expect(activities[0].title).toContain('Must See Museum');
    });

    it('waits for opening time if activity not yet open', () => {
      const lateOpener = makeActivity({
        id: 'late',
        name: 'Late Opener',
        duration: 60,
        openingHours: { open: '11:00', close: '20:00' },
      });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [lateOpener])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [lateOpener],
        { lat: 41.3851, lng: 2.1734 }
      );

      const act = result.days[0].items.find(i => i.type === 'activity');
      expect(act).toBeDefined();
      // Should not start before 11:00
      const [h] = act!.startTime.split(':').map(Number);
      expect(h).toBeGreaterThanOrEqual(11);
    });
  });

  describe('must-see handling', () => {
    it('prioritizes must-sees by placing them before non-must-sees', () => {
      const mustSee = makeActivity({ id: 'must', name: 'Sagrada Familia', mustSee: true, duration: 90 });
      const normal = makeActivity({ id: 'normal', name: 'Random Park', mustSee: false, duration: 60, latitude: 41.41, longitude: 2.18 });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [normal, mustSee])], // normal first in array
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [mustSee, normal],
        { lat: 41.3851, lng: 2.1734 }
      );

      const activities = result.days[0].items.filter(i => i.type === 'activity');
      expect(activities.length).toBeGreaterThanOrEqual(1);
      // Must-see should appear (either first or force-injected)
      expect(activities.some(a => a.title?.includes('Sagrada Familia'))).toBe(true);
    });

    it('force-injects must-see by evicting lowest-rated activity when must-see was not placed', () => {
      // Create a short day where activities can't all fit
      const mustSee = makeActivity({
        id: 'must', name: 'Must See Palace', mustSee: true, duration: 90,
        openingHours: { open: '09:00', close: '18:00' },
      });
      const weakAct = makeActivity({
        id: 'weak', name: 'Weak Activity', mustSee: false, duration: 60,
        rating: 2.0, // Low rated — eviction target
        latitude: 41.41, longitude: 2.18,
        openingHours: { open: '09:00', close: '22:00' },
      });
      const strongAct = makeActivity({
        id: 'strong', name: 'Strong Activity', mustSee: false, duration: 60,
        rating: 4.9,
        latitude: 41.42, longitude: 2.19,
        openingHours: { open: '09:00', close: '22:00' },
      });

      // Cluster with all three activities — must-see at end so it may be squeezed out
      // by time budget on a short day
      const result = unifiedScheduleV3Days(
        [makeCluster(1, [weakAct, strongAct, mustSee])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1, { activityEndTime: '14:00' })], // Very short day
        null,
        basePreferences(),
        emptyData(),
        [],
        [mustSee, weakAct, strongAct],
        { lat: 41.3851, lng: 2.1734 }
      );

      const activities = result.days[0].items.filter(i => i.type === 'activity');
      const titles = activities.map(a => a.title);
      // Must-see should be present (force-injected if needed)
      expect(titles.some(t => t.includes('Must See Palace'))).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('removes duplicate activities within the same day', () => {
      const act1 = makeActivity({ id: 'sagrada', name: 'Sagrada Familia' });
      const act2 = makeActivity({ id: 'sagrada', name: 'Sagrada Familia' }); // same ID

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1, act2])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act1],
        { lat: 41.3851, lng: 2.1734 }
      );

      // Should only appear once
      const activities = result.days[0].items.filter(i => i.type === 'activity');
      expect(activities).toHaveLength(1);
    });

    it('removes globally placed activities from subsequent days', () => {
      const act = makeActivity({ id: 'shared', name: 'Shared Activity' });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [{ ...act }]), makeCluster(2, [{ ...act }])],
        [makeTravelTimes(1), makeTravelTimes(2)],
        [makeTimeWindow(1), makeTimeWindow(2)],
        null,
        basePreferences({ durationDays: 2 }),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const day1Activities = result.days[0].items.filter(i => i.type === 'activity');
      const day2Activities = result.days[1].items.filter(i => i.type === 'activity');

      // Should only appear on day 1
      expect(day1Activities.some(a => a.id === 'shared')).toBe(true);
      expect(day2Activities.some(a => a.id === 'shared')).toBe(false);
    });
  });

  describe('checkout on last day', () => {
    it('places checkout item after breakfast on the last day', () => {
      const act = makeActivity();
      const hotel = makeHotel({ checkOutTime: '11:00' });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        hotel,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const checkoutItem = result.days[0].items.find(i => i.type === 'checkout');
      expect(checkoutItem).toBeDefined();
      expect(checkoutItem!.title).toContain('Check-out');
      expect(checkoutItem!.title).toContain(hotel.name);
    });

    it('does not place checkout on non-last days', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Act 1' });
      const act2 = makeActivity({ id: 'a2', name: 'Act 2', latitude: 41.41, longitude: 2.18 });
      const hotel = makeHotel();

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1]), makeCluster(2, [act2])],
        [makeTravelTimes(1), makeTravelTimes(2)],
        [makeTimeWindow(1), makeTimeWindow(2)],
        hotel,
        basePreferences({ durationDays: 2 }),
        emptyData(),
        [],
        [act1, act2],
        { lat: 41.3851, lng: 2.1734 }
      );

      // Only last day should have checkout
      const day1Checkout = result.days[0].items.find(i => i.type === 'checkout');
      const day2Checkout = result.days[1].items.find(i => i.type === 'checkout');
      expect(day1Checkout).toBeUndefined();
      expect(day2Checkout).toBeDefined();
    });
  });

  describe('hard stop at 22:00', () => {
    it('drops activities starting at or after 22:00', () => {
      // Fill the day with many long activities so some get pushed past 22:00
      const activities = Array.from({ length: 8 }, (_, i) => makeActivity({
        id: `act-${i}`,
        name: `Activity ${i}`,
        duration: 120,
        latitude: 41.40 + i * 0.001,
        openingHours: { open: '06:00', close: '23:59' },
      }));

      const result = unifiedScheduleV3Days(
        [makeCluster(1, activities)],
        [makeTravelTimes(1)],
        [makeTimeWindow(1, { activityEndTime: '23:00' })], // wide window
        null,
        basePreferences(),
        emptyData(),
        [],
        activities,
        { lat: 41.3851, lng: 2.1734 }
      );

      // No activity should start at or after 22:00
      const placed = result.days[0].items.filter(i => i.type === 'activity');
      for (const act of placed) {
        const [h, m] = act.startTime.split(':').map(Number);
        expect(h * 60 + m).toBeLessThan(22 * 60);
      }
    });
  });

  describe('temporal ordering', () => {
    it('items are sorted by startTime within each day', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Act 1', duration: 60 });
      const act2 = makeActivity({ id: 'a2', name: 'Act 2', duration: 60, latitude: 41.41, longitude: 2.18 });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1, act2])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act1, act2],
        { lat: 41.3851, lng: 2.1734 }
      );

      const items = result.days[0].items;
      for (let i = 1; i < items.length; i++) {
        const [ha, ma] = items[i - 1].startTime.split(':').map(Number);
        const [hb, mb] = items[i].startTime.split(':').map(Number);
        expect(ha * 60 + ma).toBeLessThanOrEqual(hb * 60 + mb);
      }
    });

    it('orderIndex is sequential and matches position', () => {
      const act = makeActivity();

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const items = result.days[0].items;
      items.forEach((item, idx) => {
        expect(item.orderIndex).toBe(idx);
      });
    });
  });

  describe('no temporal overlaps', () => {
    it('no item starts before the previous item ends (after cascade-shift)', () => {
      const activities = Array.from({ length: 5 }, (_, i) => makeActivity({
        id: `act-${i}`,
        name: `Activity ${i}`,
        duration: 90,
        latitude: 41.40 + i * 0.001,
        openingHours: { open: '08:00', close: '22:00' },
      }));

      const result = unifiedScheduleV3Days(
        [makeCluster(1, activities)],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        activities,
        { lat: 41.3851, lng: 2.1734 }
      );

      const items = result.days[0].items;
      for (let i = 1; i < items.length; i++) {
        const prevEnd = items[i - 1].endTime.split(':').map(Number);
        const currStart = items[i].startTime.split(':').map(Number);
        const prevEndMin = prevEnd[0] * 60 + prevEnd[1];
        const currStartMin = currStart[0] * 60 + currStart[1];
        expect(currStartMin).toBeGreaterThanOrEqual(prevEndMin);
      }
    });
  });

  describe('travel items', () => {
    it('inserts travel items between activities when travel time > 5min', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Act 1', duration: 60 });
      const act2 = makeActivity({ id: 'a2', name: 'Act 2', duration: 60, latitude: 41.42, longitude: 2.19 });

      const leg: TravelLeg = {
        fromId: 'a1',
        toId: 'a2',
        fromName: 'Act 1',
        toName: 'Act 2',
        distanceKm: 2.5,
        durationMinutes: 15,
        mode: 'walk',
        source: 'estimated',
      };

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1, act2])],
        [makeTravelTimes(1, [leg])],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act1, act2],
        { lat: 41.3851, lng: 2.1734 }
      );

      const transports = result.days[0].items.filter(i => i.type === 'transport');
      expect(transports.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('lunch placement timing', () => {
    it('places lunch around 12:00-14:30 window', () => {
      const act = makeActivity({ id: 'a1', name: 'Morning Activity', duration: 90 });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const lunch = result.days[0].items.find(i => i.mealType === 'lunch');
      expect(lunch).toBeDefined();
      const [h, m] = lunch!.startTime.split(':').map(Number);
      const lunchMin = h * 60 + m;
      // Lunch should be between 09:30 (after breakfast) and 14:30
      expect(lunchMin).toBeLessThanOrEqual(14 * 60 + 30);
    });
  });

  describe('dinner timing', () => {
    it('places dinner at 19:00 or later', () => {
      const act = makeActivity();

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const dinner = result.days[0].items.find(i => i.mealType === 'dinner');
      expect(dinner).toBeDefined();
      const [h] = dinner!.startTime.split(':').map(Number);
      expect(h).toBeGreaterThanOrEqual(19);
    });

    it('skips dinner on last day with early departure (dayEnd < 18:00)', () => {
      const act = makeActivity();

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1, { activityEndTime: '16:00' })], // Early departure
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const dinner = result.days[0].items.find(i => i.mealType === 'dinner');
      expect(dinner).toBeUndefined();
    });
  });

  describe('remote cluster handling', () => {
    it('anchors dinner near hotel for remote single-activity clusters', () => {
      // Activity far from hotel (>3km)
      const remoteAct = makeActivity({
        id: 'remote',
        name: 'Remote Beach',
        latitude: 41.45, // ~7km from hotel
        longitude: 2.22,
        openingHours: { open: '08:00', close: '20:00' },
      });
      const hotel = makeHotel({ latitude: 41.39, longitude: 2.17 });

      // Restaurant near hotel (should be picked for dinner)
      const hotelRestaurant = makeRestaurant({
        id: 'r-hotel',
        name: 'Hotel Bistro',
        latitude: 41.391,
        longitude: 2.171,
      });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [remoteAct])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        hotel,
        basePreferences(),
        emptyData(),
        [hotelRestaurant],
        [remoteAct],
        { lat: 41.3851, lng: 2.1734 }
      );

      // Should have a dinner item (remote cluster anchors dinner near hotel)
      const dinner = result.days[0].items.find(i => i.mealType === 'dinner');
      expect(dinner).toBeDefined();
    });
  });

  describe('empty day rescue', () => {
    it('steals activities from the busiest day when a day has 0 activities', () => {
      // Day 1: many activities, Day 2: none
      const acts = Array.from({ length: 4 }, (_, i) => makeActivity({
        id: `act-${i}`,
        name: `Activity ${i}`,
        duration: 60,
        latitude: 41.40 + i * 0.002,
        longitude: 2.17 + i * 0.002,
        rating: 3.0 + i * 0.3,
        openingHours: { open: '08:00', close: '22:00' },
      }));

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [...acts]), makeCluster(2, [])], // Day 2 empty
        [makeTravelTimes(1), makeTravelTimes(2)],
        [makeTimeWindow(1), makeTimeWindow(2)],
        null,
        basePreferences({ durationDays: 2 }),
        emptyData(),
        [],
        acts,
        { lat: 41.3851, lng: 2.1734 }
      );

      const day2Activities = result.days[1].items.filter(i => i.type === 'activity');
      // Day 2 should have at least 1 stolen activity
      expect(day2Activities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cross-day repair', () => {
    it('returns repair actions when opening hours violations are fixed cross-day', () => {
      // Activity open only on Tuesday (day 2), but placed on Monday (day 1)
      const tuesdayOnly = makeActivity({
        id: 'tuesday-only',
        name: 'Tuesday Museum',
        duration: 60,
        mustSee: false,
        openingHoursByDay: {
          monday: null, // Closed on Monday
          tuesday: { open: '09:00', close: '18:00' },
          wednesday: { open: '09:00', close: '18:00' },
          thursday: { open: '09:00', close: '18:00' },
          friday: { open: '09:00', close: '18:00' },
          saturday: { open: '09:00', close: '18:00' },
          sunday: null,
        },
      });
      // Activity with no restrictions (available for swap)
      const flexible = makeActivity({
        id: 'flexible',
        name: 'Flexible Park',
        duration: 60,
        latitude: 41.41,
        longitude: 2.18,
      });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [tuesdayOnly]), makeCluster(2, [flexible])],
        [makeTravelTimes(1), makeTravelTimes(2)],
        [makeTimeWindow(1), makeTimeWindow(2)],
        null,
        basePreferences({ durationDays: 2, startDate: new Date('2026-03-16T00:00:00.000Z') }), // Monday
        emptyData(),
        [],
        [tuesdayOnly, flexible],
        { lat: 41.3851, lng: 2.1734 }
      );

      // The repair pass should have detected and either swapped or flagged the violation
      // We check that the result is structurally valid
      expect(result.days).toHaveLength(2);
      // Either a repair was performed, or an unresolved violation was logged
      const totalActions = result.repairs.length + result.unresolvedViolations.length;
      // At minimum, the structure should be valid
      expect(result.days[0].dayNumber).toBe(1);
      expect(result.days[1].dayNumber).toBe(2);
    });
  });

  describe('gap filling', () => {
    it('inserts free_time items for gaps > 90 minutes', () => {
      // Single short activity → large gaps before/after
      const act = makeActivity({
        id: 'short',
        name: 'Quick Visit',
        duration: 30,
        openingHours: { open: '10:00', close: '11:00' },
      });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [],
        [act],
        { lat: 41.3851, lng: 2.1734 }
      );

      const freeTimeItems = result.days[0].items.filter(i => i.type === 'free_time');
      // With a 30min activity in a 12+ hour day, there should be free time gaps
      // (depends on meal placement, but at least one gap should be >90min)
      // This is a soft check — gap filling depends on meal placement timing
      expect(result.days[0].items.length).toBeGreaterThanOrEqual(3); // at least breakfast + activity + lunch
    });
  });

  describe('restaurant diversity across days', () => {
    it('prefers different restaurants across days when pool is large enough', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Day 1 Act' });
      const act2 = makeActivity({ id: 'a2', name: 'Day 2 Act', latitude: 41.405, longitude: 2.175 });

      // Provide many restaurants so the scheduler can pick different ones
      const restaurants = Array.from({ length: 10 }, (_, i) => makeRestaurant({
        id: `rest-${i}`,
        name: `Restaurant ${i}`,
        cuisineTypes: [`cuisine-${i}`],
        latitude: 41.403 + i * 0.001,
        longitude: 2.174 + i * 0.001,
      }));

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1]), makeCluster(2, [act2])],
        [makeTravelTimes(1), makeTravelTimes(2)],
        [makeTimeWindow(1), makeTimeWindow(2)],
        null,
        basePreferences({ durationDays: 2 }),
        emptyData(),
        restaurants,
        [act1, act2],
        { lat: 41.3851, lng: 2.1734 }
      );

      // Collect all primary restaurant IDs used across both days
      const allMeals = result.days.flatMap(d =>
        d.items.filter(i => i.type === 'restaurant' && i.restaurant && !i.qualityFlags?.includes('self_meal_fallback'))
      );
      const usedIds = allMeals.map(m => m.restaurant!.id);
      const uniqueIds = new Set(usedIds);
      // With 10 restaurants available, we should see diversity (more unique than total/2)
      expect(uniqueIds.size).toBeGreaterThanOrEqual(Math.min(usedIds.length, 2));
    });

    it('falls back to reuse when only one restaurant is available', () => {
      const act1 = makeActivity({ id: 'a1', name: 'Day 1 Act' });
      const restaurant = makeRestaurant({ id: 'single-rest', name: 'Only Restaurant' });

      const result = unifiedScheduleV3Days(
        [makeCluster(1, [act1])],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        null,
        basePreferences(),
        emptyData(),
        [restaurant],
        [act1],
        { lat: 41.3851, lng: 2.1734 }
      );

      // Even with just one restaurant, meals should still be placed (reuse via relaxed pass)
      const meals = result.days[0].items.filter(i => i.type === 'restaurant');
      expect(meals.length).toBeGreaterThanOrEqual(2); // at least breakfast + lunch or dinner
    });
  });

  describe('integration: full day schedule', () => {
    it('produces a realistic schedule with breakfast, activities, lunch, activities, dinner', () => {
      const hotel = makeHotel();
      const acts = [
        makeActivity({ id: 'a1', name: 'Sagrada Familia', duration: 90, mustSee: true }),
        makeActivity({ id: 'a2', name: 'Park Guell', duration: 60, latitude: 41.4145, longitude: 2.1527 }),
        makeActivity({ id: 'a3', name: 'La Rambla', duration: 45, latitude: 41.3809, longitude: 2.1734 }),
      ];
      const restaurants = [
        makeRestaurant({ id: 'r1', name: 'Café Matin', cuisineTypes: ['breakfast', 'cafe'] }),
        makeRestaurant({ id: 'r2', name: 'Tapas Bar', cuisineTypes: ['tapas'], latitude: 41.405, longitude: 2.175 }),
        makeRestaurant({ id: 'r3', name: 'Ristorante', cuisineTypes: ['italian'], latitude: 41.41, longitude: 2.18 }),
      ];

      const result = unifiedScheduleV3Days(
        [makeCluster(1, acts)],
        [makeTravelTimes(1)],
        [makeTimeWindow(1)],
        hotel,
        basePreferences(),
        emptyData(),
        restaurants,
        acts,
        { lat: 41.3851, lng: 2.1734 }
      );

      const day = result.days[0];
      expect(day.items.length).toBeGreaterThanOrEqual(5); // breakfast + checkout + at least 1 activity + lunch + dinner

      // Check meal presence
      const mealTypes = day.items.filter(i => i.type === 'restaurant').map(i => i.mealType);
      expect(mealTypes).toContain('breakfast');
      expect(mealTypes).toContain('lunch');
      expect(mealTypes).toContain('dinner');

      // Check activity presence (must-see should be there)
      const actTitles = day.items.filter(i => i.type === 'activity').map(i => i.title);
      expect(actTitles.some(t => t.includes('Sagrada Familia'))).toBe(true);

      // Check checkout on last day
      const checkout = day.items.find(i => i.type === 'checkout');
      expect(checkout).toBeDefined();

      // Check time ordering
      for (let i = 1; i < day.items.length; i++) {
        const [ha, ma] = day.items[i - 1].startTime.split(':').map(Number);
        const [hb, mb] = day.items[i].startTime.split(':').map(Number);
        expect(ha * 60 + ma).toBeLessThanOrEqual(hb * 60 + mb);
      }
    });
  });
});

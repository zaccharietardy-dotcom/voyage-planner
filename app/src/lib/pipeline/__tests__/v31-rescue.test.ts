import { buildDayTripPacks } from '../day-trip-pack';
import { buildPlannerClustersV31 } from '../planner-v31';
import { enforceRestaurantSafetyForDay } from '../step9-schedule';
import { unifiedScheduleV3Days } from '../step8910-unified-schedule';
import { ensureMustSees, fixOpeningHoursViolations } from '../step10-repair';
import { validateContracts } from '../step11-contracts';
import type { DayTimeWindow } from '../step4-anchor-transport';
import type { ActivityCluster, FetchedData, ScoredActivity } from '../types';
import type { DayTripSuggestion } from '../../services/dayTripSuggestions';
import type { Restaurant } from '../../types';
import type { TripDay, TripItem } from '../../types/trip';

function makeActivity(overrides: Partial<ScoredActivity> = {}): ScoredActivity {
  return {
    id: 'act-1',
    name: 'Test Activity',
    type: 'culture',
    description: 'A test activity',
    duration: 90,
    estimatedCost: 20,
    latitude: 48.8566,
    longitude: 2.3522,
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

function makeTripItem(activity: ScoredActivity, overrides: Partial<TripItem> = {}): TripItem {
  return {
    id: activity.id || activity.name,
    dayNumber: 1,
    startTime: '10:00',
    endTime: '11:30',
    type: 'activity',
    title: activity.name,
    description: activity.description || '',
    locationName: activity.name,
    latitude: activity.latitude,
    longitude: activity.longitude,
    orderIndex: 0,
    duration: activity.duration,
    rating: activity.rating,
    mustSee: activity.mustSee,
    openingHours: activity.openingHours,
    openingHoursByDay: activity.openingHoursByDay,
    planningMeta: {
      planningToken: activity.planningToken,
      protectedReason: activity.protectedReason as any,
      sourcePackId: activity.sourcePackId,
      plannerRole: activity.plannerRole as any,
      originalDayNumber: activity.originalDayNumber,
    },
    ...overrides,
  };
}

function makeDay(dayNumber: number, items: TripItem[]): TripDay {
  return {
    dayNumber,
    date: new Date(`2026-03-${15 + dayNumber}T00:00:00.000Z`),
    items: items.map((item, index) => ({ ...item, dayNumber, orderIndex: index })),
    theme: '',
    dayNarrative: '',
  };
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    name: 'Restaurant Test',
    address: 'Paris',
    latitude: 48.8568,
    longitude: 2.3524,
    rating: 4.6,
    reviewCount: 500,
    priceLevel: 2,
    cuisineTypes: ['french'],
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

function makeCluster(dayNumber: number, activities: ScoredActivity[]): ActivityCluster {
  const lat = activities.length > 0 ? activities.reduce((sum, activity) => sum + activity.latitude, 0) / activities.length : 48.8566;
  const lng = activities.length > 0 ? activities.reduce((sum, activity) => sum + activity.longitude, 0) / activities.length : 2.3522;
  return {
    dayNumber,
    activities,
    centroid: { lat, lng },
    totalIntraDistance: 0.5,
  };
}

function makeSuggestion(overrides: Partial<DayTripSuggestion> = {}): DayTripSuggestion {
  return {
    name: 'Day Trip',
    description: 'Curated day trip',
    destination: 'Day Trip',
    latitude: 49.0,
    longitude: 2.5,
    distanceKm: 40,
    transportMode: 'train',
    transportDurationMin: 60,
    estimatedCostPerPerson: 20,
    keyAttractions: [],
    tags: ['culture'],
    suitableFor: ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'],
    minBudgetLevel: 'economic',
    minDays: 3,
    fullDayRequired: true,
    fromCity: 'paris',
    ...overrides,
  };
}

function emptyFetchedData(overrides: Partial<FetchedData> = {}): FetchedData {
  return {
    destCoords: { lat: 48.8566, lng: 2.3522 },
    originCoords: { lat: 45.764, lng: 4.8357 },
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
    ...overrides,
  } as FetchedData;
}

describe('v3.1 rescue invariants', () => {
  it('does not cross-day swap a protected activity during opening-hours repair', () => {
    const protectedItem = makeTripItem(
      makeActivity({
        id: 'day-trip-anchor',
        name: 'Protected Day Trip',
        openingHours: { open: '09:00', close: '10:00' },
        protectedReason: 'day_trip_anchor',
        plannerRole: 'day_trip',
        originalDayNumber: 1,
      }),
      {
        startTime: '15:00',
        endTime: '16:30',
        planningMeta: {
          planningToken: 'pack-1:anchor',
          protectedReason: 'day_trip_anchor',
          plannerRole: 'day_trip',
          originalDayNumber: 1,
        },
      }
    );
    const cityItem = makeTripItem(
      makeActivity({
        id: 'city-museum',
        name: 'City Museum',
        openingHours: { open: '09:00', close: '18:00' },
        plannerRole: 'full_city',
      }),
      {
        dayNumber: 2,
        startTime: '11:00',
        endTime: '12:30',
        planningMeta: {
          planningToken: 'city-museum:2',
          plannerRole: 'full_city',
          originalDayNumber: 2,
        },
      }
    );
    const days = [makeDay(1, [protectedItem]), makeDay(2, [cityItem])];
    const repairs: any[] = [];
    const unresolved: string[] = [];

    fixOpeningHoursViolations(days, '2026-03-16', repairs, unresolved, { rescueStage: 1 });

    expect(repairs).toHaveLength(0);
    expect(unresolved).toEqual(
      expect.arrayContaining([expect.stringContaining('outside opening hours but is protected')])
    );
    expect(days[0].items[0].title).toBe('Protected Day Trip');
    expect(days[0].items[0].dayNumber).toBe(1);
  });

  it('refuses to evict a protected victim when injecting a must-see in rescue mode', () => {
    const protectedVictim = makeTripItem(
      makeActivity({
        id: 'locked-optional',
        name: 'Locked Optional',
        protectedReason: 'user_forced',
        plannerRole: 'full_city',
      }),
      {
        planningMeta: {
          planningToken: 'locked-optional:1',
          protectedReason: 'user_forced',
          plannerRole: 'full_city',
          originalDayNumber: 1,
        },
      }
    );
    const days = [makeDay(1, [protectedVictim])];
    const repairs: any[] = [];
    const unresolved: string[] = [];
    const mustSee = makeActivity({
      id: 'missing-must-see',
      name: 'Missing Must See',
      mustSee: true,
      score: 100,
    });

    ensureMustSees(days, [mustSee], '2026-03-16', repairs, unresolved, new Set<string>(), { rescueStage: 1 });

    expect(repairs).toHaveLength(0);
    expect(days[0].items[0].title).toBe('Locked Optional');
    expect(unresolved).toEqual(
      expect.arrayContaining([expect.stringContaining('Missing Must See')])
    );
  });

  it('does not inject a must-see into arrival or departure days in rescue mode', () => {
    const arrivalVictim = makeTripItem(
      makeActivity({ id: 'arrival-victim', name: 'Arrival Victim', plannerRole: 'arrival' }),
      {
        planningMeta: {
          planningToken: 'arrival-victim:1',
          plannerRole: 'arrival',
          originalDayNumber: 1,
        },
      }
    );
    const departureVictim = makeTripItem(
      makeActivity({ id: 'departure-victim', name: 'Departure Victim', plannerRole: 'departure' }),
      {
        dayNumber: 2,
        planningMeta: {
          planningToken: 'departure-victim:2',
          plannerRole: 'departure',
          originalDayNumber: 2,
        },
      }
    );
    const days = [makeDay(1, [arrivalVictim]), makeDay(2, [departureVictim])];
    const repairs: any[] = [];
    const unresolved: string[] = [];
    const mustSee = makeActivity({
      id: 'late-must-see',
      name: 'Late Must See',
      mustSee: true,
      score: 100,
    });

    ensureMustSees(days, [mustSee], '2026-03-16', repairs, unresolved, new Set<string>(), { rescueStage: 1 });

    expect(repairs).toHaveLength(0);
    expect(days[0].items[0].title).toBe('Arrival Victim');
    expect(days[1].items[0].title).toBe('Departure Victim');
    expect(unresolved).toEqual(
      expect.arrayContaining([expect.stringContaining('Late Must See')])
    );
  });

  it('restores all original candidates when a day-trip pack is demoted', () => {
    const fujiTemple = makeActivity({
      id: 'fuji-temple',
      name: 'Fuji Temple',
      latitude: 35.36,
      longitude: 138.73,
      mustSee: true,
      score: 70,
    });
    const fujiLake = makeActivity({
      id: 'fuji-lake',
      name: 'Lake Kawaguchi',
      latitude: 35.50,
      longitude: 138.76,
      mustSee: true,
      score: 65,
    });
    const nikko = makeActivity({
      id: 'nikko-shrine',
      name: 'Nikko Shrine',
      latitude: 36.75,
      longitude: 139.60,
      mustSee: true,
      score: 95,
    });

    const data = emptyFetchedData({
      dayTripSuggestions: [
        makeSuggestion({
          name: 'Mount Fuji',
          destination: 'Kawaguchiko',
          latitude: 35.50,
          longitude: 138.76,
          transportDurationMin: 95,
        }),
        makeSuggestion({
          name: 'Nikko',
          destination: 'Nikko',
          latitude: 36.75,
          longitude: 139.60,
          transportDurationMin: 80,
        }),
      ],
    });

    const result = buildDayTripPacks(
      [fujiTemple, fujiLake, nikko],
      data,
      { lat: 35.6764, lng: 139.6500 },
      4,
      12 * 60
    );

    expect(result.packs).toHaveLength(1);
    expect(result.packs[0].destination).toBe('Nikko');
    expect(result.cityActivities.map((activity) => activity.name)).toEqual(
      expect.arrayContaining(['Fuji Temple', 'Lake Kawaguchi'])
    );
  });

  it('preserves original day numbers when building planner clusters', () => {
    const activities = [
      makeActivity({ id: 'a-1', name: 'Museum A', score: 90 }),
      makeActivity({ id: 'a-2', name: 'Museum B', score: 85, latitude: 48.8666, longitude: 2.3622 }),
    ];
    const result = buildPlannerClustersV31(
      activities,
      [],
      [makeTimeWindow(1), makeTimeWindow(2), makeTimeWindow(3)],
      3,
      { lat: 48.8566, lng: 2.3522 },
      undefined,
      { rescueStage: 1 }
    );

    expect(result.clusters.map((cluster) => cluster.dayNumber)).toEqual([1, 2, 3]);
    expect(result.dayNumberMismatchCount).toBe(0);
  });

  it('keeps an early-closing activity off a late arrival day', () => {
    const earlyClose = makeActivity({
      id: 'early-close',
      name: 'Early Close Museum',
      mustSee: true,
      score: 100,
      duration: 90,
      openingHours: { open: '09:00', close: '17:00' },
    });
    const flexible = makeActivity({
      id: 'flexible',
      name: 'Flexible Park',
      score: 60,
      latitude: 48.8666,
      longitude: 2.3622,
    });

    const result = buildPlannerClustersV31(
      [earlyClose, flexible],
      [],
      [
        makeTimeWindow(1, { activityStartTime: '16:30', activityEndTime: '22:00', hasArrivalTransport: true }),
        makeTimeWindow(2),
      ],
      2,
      { lat: 48.8566, lng: 2.3522 },
      undefined,
      { rescueStage: 1, startDate: new Date('2026-03-16T00:00:00.000Z') }
    );

    const assignedDay = result.clusters.find((cluster) =>
      cluster.activities.some((activity) => activity.id === 'early-close')
    )?.dayNumber;

    expect(assignedDay).toBe(2);
  });

  it('classifies a late transfer day as departure when the cutoff is early evening', () => {
    const result = buildPlannerClustersV31(
      [makeActivity({ id: 'single', name: 'Single Activity', score: 50 })],
      [],
      [
        makeTimeWindow(1),
        makeTimeWindow(2, { activityEndTime: '17:30', hasDepartureTransport: true }),
      ],
      2,
      { lat: 48.8566, lng: 2.3522 },
      undefined,
      { rescueStage: 1, startDate: new Date('2026-03-16T00:00:00.000Z') }
    );

    expect(result.dayRoles[1].role).toBe('departure');
  });

  it('reuses the local day restaurant pool for strict rescue replacements', () => {
    const lunchActivity = makeTripItem(makeActivity({ id: 'act-lunch', name: 'Lunch Activity' }));
    const invalidRestaurant = makeRestaurant({
      id: 'far-lunch',
      name: 'Far Lunch',
      latitude: 48.9000,
      longitude: 2.4500,
    });
    const localRestaurant = makeRestaurant({
      id: 'near-lunch',
      name: 'Near Lunch',
      latitude: 48.8567,
      longitude: 2.3523,
    });
    const lunchItem: TripItem = {
      id: 'meal-1-lunch',
      dayNumber: 1,
      startTime: '12:30',
      endTime: '13:45',
      type: 'restaurant',
      title: 'Déjeuner — Far Lunch',
      description: 'Déjeuner à Far Lunch',
      locationName: 'Far Lunch',
      latitude: invalidRestaurant.latitude,
      longitude: invalidRestaurant.longitude,
      orderIndex: 1,
      duration: 75,
      mealType: 'lunch',
      restaurant: invalidRestaurant,
      restaurantAlternatives: [invalidRestaurant],
    };
    const day = makeDay(1, [lunchActivity, lunchItem]);

    const replacements = enforceRestaurantSafetyForDay(day, {
      strictLunchDinner: true,
      dayRestaurants: [localRestaurant],
      dietary: [],
      usedRestaurantIds: new Set<string>(),
    });

    expect(replacements).toBe(0);
    expect(day.items[1].restaurant?.id).toBe('near-lunch');
    expect(day.items[1].title).toContain('Near Lunch');
  });

  it('falls back to self meal when strict rescue cannot find a valid local restaurant', () => {
    const lunchActivity = makeTripItem(makeActivity({ id: 'act-lunch', name: 'Lunch Activity' }));
    const invalidRestaurant = makeRestaurant({
      id: 'far-lunch',
      name: 'Far Lunch',
      latitude: 48.9000,
      longitude: 2.4500,
    });
    const lunchItem: TripItem = {
      id: 'meal-1-lunch',
      dayNumber: 1,
      startTime: '12:30',
      endTime: '13:45',
      type: 'restaurant',
      title: 'Déjeuner — Far Lunch',
      description: 'Déjeuner à Far Lunch',
      locationName: 'Far Lunch',
      latitude: invalidRestaurant.latitude,
      longitude: invalidRestaurant.longitude,
      orderIndex: 1,
      duration: 75,
      mealType: 'lunch',
      restaurant: invalidRestaurant,
      restaurantAlternatives: [invalidRestaurant],
    };
    const day = makeDay(1, [lunchActivity, lunchItem]);

    const replacements = enforceRestaurantSafetyForDay(day, {
      strictLunchDinner: true,
      dayRestaurants: [],
      dietary: [],
      usedRestaurantIds: new Set<string>(),
    });

    expect(replacements).toBe(1);
    expect(day.items[1].qualityFlags).toContain('self_meal_fallback');
    expect(day.items[1].title).toContain('Repas libre');
  });

  it('skips breakfast when it would push an early-closing activity outside its feasible window', () => {
    const urgentMorning = makeActivity({
      id: 'morning-urgent',
      name: 'Morning Urgent',
      mustSee: true,
      duration: 180,
      openingHours: { open: '09:30', close: '12:30' },
      protectedReason: 'must_see',
      plannerRole: 'full_city',
      originalDayNumber: 1,
    });
    const result = unifiedScheduleV3Days(
      [makeCluster(1, [urgentMorning])],
      [],
      [makeTimeWindow(1)],
      null,
      {
        origin: 'Paris',
        destination: 'Tokyo',
        startDate: new Date('2026-03-16T00:00:00.000Z'),
        durationDays: 1,
        transport: 'plane',
        carRental: false,
        groupSize: 2,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: ['none'],
        mustSee: urgentMorning.name,
      },
      emptyFetchedData(),
      [makeRestaurant()],
      [urgentMorning],
      { lat: 35.6764, lng: 139.6500 },
      { plannerVersion: 'v3.1', rescueStage: 3 }
    );

    expect(result.days[0].items.some((item) => item.type === 'restaurant' && item.mealType === 'breakfast')).toBe(false);
  });

  it('does not require lunch or dinner on a transit-only day with no usable window', () => {
    const result = validateContracts(
      [{
        dayNumber: 1,
        date: new Date('2026-03-16T00:00:00.000Z'),
        items: [],
        theme: '',
        dayNarrative: '',
      }],
      '2026-03-16',
      new Set<string>(),
      { lat: 35.6764, lng: 139.6500 },
      [],
      [makeTimeWindow(1, { activityStartTime: '23:59', activityEndTime: '23:59', hasArrivalTransport: true })]
    );

    expect(result.violations.some((violation) => violation.includes('P0.3'))).toBe(false);
  });
});

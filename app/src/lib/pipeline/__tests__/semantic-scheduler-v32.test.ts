import { semanticScheduleV32Days } from '../semantic-scheduler-v32';
import type { DayTravelTimes } from '../step7b-travel-times';
import type { DayTimeWindow } from '../step4-anchor-transport';
import type { ActivityCluster, FetchedData, ScoredActivity } from '../types';
import type { Accommodation, Restaurant, TripPreferences } from '../../types';

function makeActivity(overrides: Partial<ScoredActivity> = {}): ScoredActivity {
  return {
    id: 'act-1',
    name: 'Test Activity',
    type: 'culture',
    description: 'A test activity',
    duration: 60,
    estimatedCost: 0,
    latitude: 48.8566,
    longitude: 2.3522,
    rating: 4.7,
    mustSee: false,
    bookingRequired: false,
    openingHours: { open: '09:00', close: '20:00' },
    score: 80,
    source: 'google_places',
    reviewCount: 1000,
    ...overrides,
  } as ScoredActivity;
}

function makeCluster(
  dayNumber: number,
  activities: ScoredActivity[],
  plannerRole: ActivityCluster['plannerRole'] = 'full_city'
): ActivityCluster {
  const lat = activities.reduce((sum, activity) => sum + activity.latitude, 0) / Math.max(activities.length, 1);
  const lng = activities.reduce((sum, activity) => sum + activity.longitude, 0) / Math.max(activities.length, 1);
  return {
    dayNumber,
    activities,
    centroid: { lat: Number.isFinite(lat) ? lat : 48.8566, lng: Number.isFinite(lng) ? lng : 2.3522 },
    totalIntraDistance: 0,
    plannerRole,
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

function makeHotel(overrides: Partial<Accommodation> = {}): Accommodation {
  return {
    id: 'hotel-1',
    name: 'Hotel Test',
    type: 'hotel',
    address: 'Paris',
    latitude: 48.85,
    longitude: 2.34,
    rating: 4.2,
    reviewCount: 100,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    ...overrides,
  } as Accommodation;
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    name: 'Restaurant Test',
    address: 'Paris',
    latitude: 48.8568,
    longitude: 2.3524,
    rating: 4.5,
    reviewCount: 500,
    priceLevel: 2,
    cuisineTypes: ['french'],
    dietaryOptions: [],
    openingHours: {
      monday: { open: '08:00', close: '23:00' },
      tuesday: { open: '08:00', close: '23:00' },
      wednesday: { open: '08:00', close: '23:00' },
      thursday: { open: '08:00', close: '23:00' },
      friday: { open: '08:00', close: '23:00' },
      saturday: { open: '08:00', close: '23:00' },
      sunday: { open: '08:00', close: '23:00' },
    },
    ...overrides,
  };
}

function makePreferences(overrides: Partial<TripPreferences> = {}): TripPreferences {
  return {
    origin: 'Paris',
    destination: 'Rome',
    startDate: new Date('2026-05-06T09:00:00.000Z'),
    durationDays: 1,
    transport: 'optimal',
    carRental: false,
    groupSize: 2,
    groupType: 'couple',
    budgetLevel: 'moderate',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: '',
    tripMode: 'precise',
    cityPlan: [{ city: 'Rome', days: 1 }],
    ...overrides,
  };
}

function emptyFetchedData(overrides: Partial<FetchedData> = {}): FetchedData {
  return {
    destCoords: { lat: 41.9028, lng: 12.4964 },
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
    ...overrides,
  } as FetchedData;
}

function makeTravelTimes(dayNumber: number, legs: DayTravelTimes['legs']): DayTravelTimes[] {
  return [{ dayNumber, legs, totalTravelMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0) }];
}

describe('semantic scheduler v3.2', () => {
  it('does not insert breakfast when travel to the first activity would overlap it', () => {
    const hotel = makeHotel({ latitude: 48.85, longitude: 2.34 });
    const museum = makeActivity({
      id: 'museum',
      name: 'Museum',
      latitude: 48.90,
      longitude: 2.40,
    });

    const result = semanticScheduleV32Days(
      [makeCluster(1, [museum])],
      makeTravelTimes(1, [{
        fromId: 'hotel-start',
        toId: 'museum',
        fromName: 'Hotel',
        toName: 'Museum',
        distanceKm: 7.2,
        durationMinutes: 35,
        mode: 'transit',
        isEstimate: false,
      }]),
      [makeTimeWindow(1, { activityStartTime: '08:30', activityEndTime: '12:00' })],
      hotel,
      makePreferences(),
      emptyFetchedData(),
      [makeRestaurant({ latitude: hotel.latitude, longitude: hotel.longitude })],
      [museum],
      { lat: 41.9028, lng: 12.4964 }
    );

    expect(result.days[0].items.some((item) => item.type === 'restaurant' && item.mealType === 'breakfast')).toBe(false);
  });

  it('regenerates transport metrics from the final neighboring stops', () => {
    const act1 = makeActivity({
      id: 'act-1',
      name: 'Act 1',
      latitude: 48.8566,
      longitude: 2.3522,
    });
    const act2 = makeActivity({
      id: 'act-2',
      name: 'Act 2',
      latitude: 48.8738,
      longitude: 2.2950,
    });

    const result = semanticScheduleV32Days(
      [makeCluster(1, [act1, act2])],
      makeTravelTimes(1, [{
        fromId: 'act-1',
        toId: 'act-2',
        fromName: 'Act 1',
        toName: 'Act 2',
        distanceKm: 4.9,
        durationMinutes: 25,
        mode: 'transit',
        isEstimate: false,
      }]),
      [makeTimeWindow(1, { activityStartTime: '10:00', activityEndTime: '18:00' })],
      null,
      makePreferences(),
      emptyFetchedData(),
      [],
      [act1, act2],
      { lat: 41.9028, lng: 12.4964 }
    );

    const items = result.days[0].items;
    const transport = items.find((item) => item.type === 'transport');
    const secondActivity = items.find((item) => item.type === 'activity' && item.title === 'Act 2');

    expect(transport).toBeDefined();
    expect(secondActivity).toBeDefined();
    expect(secondActivity?.distanceFromPrevious).toBeCloseTo(4.9, 3);
    expect(secondActivity?.timeFromPrevious).toBe(25);
    expect(transport?.description).toContain('Act 1');
    expect(transport?.description).toContain('Act 2');
  });

  it('never commits a lunch outside the lunch window', () => {
    const morning = makeActivity({
      id: 'morning',
      name: 'Morning Visit',
      duration: 180,
      latitude: 48.8566,
      longitude: 2.3522,
    });
    const evening = makeActivity({
      id: 'evening',
      name: 'Evening Visit',
      duration: 240,
      latitude: 48.8738,
      longitude: 2.295,
    });

    const result = semanticScheduleV32Days(
      [makeCluster(1, [morning, evening])],
      makeTravelTimes(1, [{
        fromId: 'morning',
        toId: 'evening',
        fromName: 'Morning Visit',
        toName: 'Evening Visit',
        distanceKm: 4.9,
        durationMinutes: 25,
        mode: 'transit',
        isEstimate: false,
      }]),
      [makeTimeWindow(1, { activityStartTime: '10:00', activityEndTime: '22:00' })],
      null,
      makePreferences(),
      emptyFetchedData(),
      [makeRestaurant()],
      [morning, evening],
      { lat: 41.9028, lng: 12.4964 }
    );

    const lunchItems = result.days[0].items.filter((item) => item.type === 'restaurant' && item.mealType === 'lunch');
    expect(lunchItems.every((item) => item.startTime <= '14:30')).toBe(true);
  });

  it('falls back to self meal instead of committing a far restaurant', () => {
    const act1 = makeActivity({
      id: 'act-a',
      name: 'Act A',
      duration: 90,
      latitude: 48.8566,
      longitude: 2.3522,
    });
    const act2 = makeActivity({
      id: 'act-b',
      name: 'Act B',
      duration: 90,
      latitude: 48.8567,
      longitude: 2.3523,
      openingHours: { open: '15:00', close: '20:00' },
    });

    const result = semanticScheduleV32Days(
      [makeCluster(1, [act1, act2])],
      makeTravelTimes(1, []),
      [makeTimeWindow(1, { activityStartTime: '10:00', activityEndTime: '18:00' })],
      null,
      makePreferences(),
      emptyFetchedData(),
      [makeRestaurant({ id: 'far-resto', latitude: 48.95, longitude: 2.45 })],
      [act1, act2],
      { lat: 41.9028, lng: 12.4964 }
    );

    const lunch = result.days[0].items.find((item) => item.type === 'restaurant' && item.mealType === 'lunch');
    expect(lunch?.qualityFlags).toContain('self_meal_fallback');
    expect(lunch?.title).toContain('Repas libre');
  });

  it('drops a low-value optional to preserve a protected must-see on the same day', () => {
    const optional = makeActivity({
      id: 'optional',
      name: 'Optional Visit',
      duration: 240,
      latitude: 48.8566,
      longitude: 2.3522,
      score: 20,
      mustSee: false,
      openingHours: { open: '09:00', close: '14:00' },
    });
    const protectedMustSee = makeActivity({
      id: 'must-see',
      name: 'Protected Must See',
      duration: 240,
      latitude: 48.8567,
      longitude: 2.3523,
      score: 95,
      mustSee: true,
      protectedReason: 'must_see',
      openingHours: { open: '13:00', close: '17:00' },
    });

    const result = semanticScheduleV32Days(
      [makeCluster(1, [optional, protectedMustSee])],
      makeTravelTimes(1, []),
      [makeTimeWindow(1, { activityStartTime: '09:00', activityEndTime: '17:00' })],
      null,
      makePreferences(),
      emptyFetchedData(),
      [],
      [optional, protectedMustSee],
      { lat: 41.9028, lng: 12.4964 }
    );

    const titles = result.days[0].items.filter((item) => item.type === 'activity').map((item) => item.title);
    expect(titles).toContain('Protected Must See');
    expect(titles).not.toContain('Optional Visit');
  });

  it('does not inject free time before checkout on a departure day', () => {
    const hotel = makeHotel();

    const result = semanticScheduleV32Days(
      [makeCluster(1, [], 'departure')],
      makeTravelTimes(1, []),
      [makeTimeWindow(1, { activityStartTime: '08:30', activityEndTime: '17:00', hasDepartureTransport: true })],
      hotel,
      makePreferences(),
      emptyFetchedData(),
      [],
      [],
      { lat: 41.9028, lng: 12.4964 }
    );

    expect(result.days[0].items.some((item) => item.type === 'free_time')).toBe(false);
  });
});

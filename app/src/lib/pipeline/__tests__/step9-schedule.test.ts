import { assembleV3Days } from '../step9-schedule';
import type { ActivityCluster } from '../types';
import type { DayMealPlan } from '../step8-place-restaurants';
import type { DayTravelTimes } from '../step7b-travel-times';
import type { DayTimeWindow } from '../step4-anchor-transport';
import type { Restaurant, TripPreferences } from '../../types';

function basePreferences(): TripPreferences {
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
  };
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: overrides.id || 'rest-1',
    name: overrides.name || 'Restaurant Test',
    address: overrides.address || 'Barcelona',
    latitude: overrides.latitude ?? 41.3851,
    longitude: overrides.longitude ?? 2.1734,
    rating: overrides.rating ?? 4.6,
    reviewCount: overrides.reviewCount ?? 500,
    priceLevel: overrides.priceLevel ?? 2,
    cuisineTypes: overrides.cuisineTypes || ['mediterranean'],
    dietaryOptions: overrides.dietaryOptions || ['none'],
    openingHours: overrides.openingHours || {
      monday: { open: '08:00', close: '22:00' },
      tuesday: { open: '08:00', close: '22:00' },
      wednesday: { open: '08:00', close: '22:00' },
      thursday: { open: '08:00', close: '22:00' },
      friday: { open: '08:00', close: '22:00' },
      saturday: { open: '08:00', close: '22:00' },
      sunday: { open: '08:00', close: '22:00' },
    },
    ...overrides,
  };
}

describe('step9-schedule meal fallback behavior', () => {
  const clusters: ActivityCluster[] = [
    {
      dayNumber: 1,
      centroid: { lat: 41.3851, lng: 2.1734 },
      totalIntraDistance: 0.5,
      activities: [
        {
          id: 'act-1',
          name: 'Sagrada Familia',
          type: 'culture',
          description: 'Desc',
          duration: 90,
          estimatedCost: 20,
          latitude: 41.4036,
          longitude: 2.1744,
          rating: 4.7,
          mustSee: true,
          bookingRequired: true,
          openingHours: { open: '09:00', close: '18:00' },
          score: 90,
          source: 'google_places',
          reviewCount: 1000,
        },
      ],
    },
  ];

  const travelTimes: DayTravelTimes[] = [{ dayNumber: 1, legs: [], totalTravelMinutes: 0 }];
  const windows: DayTimeWindow[] = [{
    dayNumber: 1,
    activityStartTime: '08:30',
    activityEndTime: '21:00',
    hasArrivalTransport: false,
    hasDepartureTransport: false,
  }];

  it('creates "Repas libre" when no valid restaurant is available for the slot', () => {
    const mealPlans: DayMealPlan[] = [{ dayNumber: 1, meals: [] }];

    const days = assembleV3Days(
      clusters,
      mealPlans,
      travelTimes,
      windows,
      null,
      basePreferences(),
      {} as any
    );

    const lunch = days[0].items.find(item => item.type === 'restaurant' && item.mealType === 'lunch');
    expect(lunch).toBeDefined();
    expect(lunch?.title).toContain('Repas libre');
    expect(lunch?.qualityFlags).toContain('self_meal_fallback');
    expect(lunch?.restaurant).toBeUndefined();
    expect(lunch?.restaurantAlternatives).toBeUndefined();
    expect(lunch?.estimatedCost).toBe(0);
  });

  it('prefers an open alternative when the primary restaurant is closed at slot time', () => {
    const primaryClosedAtLunch = makeRestaurant({
      id: 'closed-primary',
      name: 'Closed Primary',
      latitude: 41.40355,
      longitude: 2.17435,
      openingHours: {
        monday: { open: '19:00', close: '22:00' },
        tuesday: { open: '19:00', close: '22:00' },
        wednesday: { open: '19:00', close: '22:00' },
        thursday: { open: '19:00', close: '22:00' },
        friday: { open: '19:00', close: '22:00' },
        saturday: { open: '19:00', close: '22:00' },
        sunday: { open: '19:00', close: '22:00' },
      },
    });
    const openAlternative = makeRestaurant({
      id: 'open-alt',
      name: 'Open Alternative',
      latitude: 41.40358,
      longitude: 2.17442,
      openingHours: {
        monday: { open: '11:00', close: '15:00' },
        tuesday: { open: '11:00', close: '15:00' },
        wednesday: { open: '11:00', close: '15:00' },
        thursday: { open: '11:00', close: '15:00' },
        friday: { open: '11:00', close: '15:00' },
        saturday: { open: '11:00', close: '15:00' },
        sunday: { open: '11:00', close: '15:00' },
      },
    });

    const mealPlans: DayMealPlan[] = [{
      dayNumber: 1,
      meals: [{
        mealType: 'lunch',
        anchorPoint: { lat: 41.3851, lng: 2.1734 },
        anchorName: 'Mid-day point',
        primary: primaryClosedAtLunch,
        alternatives: [openAlternative],
        distanceFromAnchor: 0.2,
      }],
    }];

    const days = assembleV3Days(
      clusters,
      mealPlans,
      travelTimes,
      windows,
      null,
      basePreferences(),
      {} as any
    );

    const lunch = days[0].items.find(item => item.type === 'restaurant' && item.mealType === 'lunch');
    expect(lunch).toBeDefined();
    expect(lunch?.restaurant?.id).toBe('open-alt');
    expect(lunch?.title).not.toContain('Repas libre');
    expect(lunch?.qualityFlags).toBeUndefined();
  });
});

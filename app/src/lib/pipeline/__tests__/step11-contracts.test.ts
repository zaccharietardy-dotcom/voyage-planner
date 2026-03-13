import { validateContracts } from '../step11-contracts';
import type { TripDay, TripItem, Restaurant } from '../../types/trip';

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

function makeActivityItem(): TripItem {
  return {
    id: 'act-1',
    dayNumber: 1,
    startTime: '10:00',
    endTime: '11:00',
    type: 'activity',
    title: 'Sagrada Familia',
    description: 'Desc',
    locationName: 'Barcelona',
    latitude: 41.4036,
    longitude: 2.1744,
    orderIndex: 0,
    estimatedCost: 20,
    duration: 60,
    openingHours: { open: '09:00', close: '18:00' },
  };
}

describe('step11-contracts restaurant invariants', () => {
  it('flags a restaurant scheduled outside opening hours', () => {
    const closedAtLunch = makeRestaurant({
      id: 'rest-closed',
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

    const day: TripDay = {
      dayNumber: 1,
      date: new Date('2026-03-16T00:00:00.000Z'), // Monday
      isDayTrip: false,
      items: [
        makeActivityItem(),
        {
          id: 'meal-1-lunch',
          dayNumber: 1,
          startTime: '12:30',
          endTime: '13:30',
          type: 'restaurant',
          title: 'Déjeuner — Closed',
          description: 'Lunch',
          locationName: 'Barcelona',
          latitude: 41.4038,
          longitude: 2.1745,
          orderIndex: 1,
          duration: 60,
          mealType: 'lunch',
          restaurant: closedAtLunch,
          estimatedCost: 20,
        },
      ],
    };

    const result = validateContracts(
      [day],
      '2026-03-16',
      new Set<string>(),
      { lat: 41.3851, lng: 2.1734 }
    );

    expect(result.violations.some(v => v.includes('outside opening hours'))).toBe(true);
  });

  it('ignores P0.1/P0.2 for self_meal_fallback and counts it as a valid meal for P0.3', () => {
    const days: TripDay[] = [
      {
        dayNumber: 1,
        date: new Date('2026-03-16T00:00:00.000Z'),
        isDayTrip: false,
        items: [makeActivityItem()],
      },
      {
        dayNumber: 2,
        date: new Date('2026-03-17T00:00:00.000Z'),
        isDayTrip: false,
        items: [
          {
            id: 'meal-2-lunch-self',
            dayNumber: 2,
            startTime: '12:30',
            endTime: '13:30',
            type: 'restaurant',
            title: 'Déjeuner — Repas libre',
            description: 'Repas libre',
            locationName: 'Repas libre',
            latitude: 41.3851,
            longitude: 2.1734,
            orderIndex: 0,
            duration: 60,
            mealType: 'lunch',
            estimatedCost: 0,
            qualityFlags: ['self_meal_fallback'],
          },
          {
            id: 'meal-2-dinner-self',
            dayNumber: 2,
            startTime: '20:00',
            endTime: '21:30',
            type: 'restaurant',
            title: 'Dîner — Repas libre',
            description: 'Repas libre',
            locationName: 'Repas libre',
            latitude: 41.3851,
            longitude: 2.1734,
            orderIndex: 1,
            duration: 90,
            mealType: 'dinner',
            estimatedCost: 0,
            qualityFlags: ['self_meal_fallback'],
          },
        ],
      },
      {
        dayNumber: 3,
        date: new Date('2026-03-18T00:00:00.000Z'),
        isDayTrip: false,
        items: [makeActivityItem(), { ...makeActivityItem(), id: 'act-3', dayNumber: 3 }],
      },
    ];

    const result = validateContracts(
      days,
      '2026-03-16',
      new Set<string>(),
      { lat: 41.3851, lng: 2.1734 }
    );

    expect(result.violations.some(v => v.includes('Day 2 has no lunch'))).toBe(false);
    expect(result.violations.some(v => v.includes('Day 2 has no dinner'))).toBe(false);
    expect(result.violations.some(v => v.includes('P0.2: Day 2'))).toBe(false);
    expect(result.violations.some(v => v.includes('outside opening hours') && v.includes('Day 2'))).toBe(false);
  });
});

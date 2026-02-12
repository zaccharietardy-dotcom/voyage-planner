import type { TripPreferences, Restaurant } from '../types';
import type { ActivityCluster, ScoredActivity } from '../pipeline/types';
import { assignRestaurants } from '../pipeline/step4-restaurants';

function makePreferences(): TripPreferences {
  return {
    origin: 'Lyon',
    destination: 'Paris',
    startDate: new Date('2026-02-25T11:00:00.000Z'),
    durationDays: 3,
    transport: 'train',
    carRental: false,
    groupSize: 2,
    groupType: 'couple',
    budgetLevel: 'comfort',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: '',
  };
}

function makeActivity(id: string, name: string, latitude: number, longitude: number): ScoredActivity {
  return {
    id,
    name,
    type: 'culture',
    description: '',
    duration: 90,
    estimatedCost: 15,
    latitude,
    longitude,
    rating: 4.6,
    mustSee: false,
    bookingRequired: false,
    openingHours: { open: '09:00', close: '18:00' },
    dataReliability: 'verified',
    reviewCount: 2000,
    source: 'google_places',
    score: 120,
  };
}

function makeRestaurant(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  rating: number = 4.5
): Restaurant {
  return {
    id,
    name,
    address: `${name} address`,
    latitude,
    longitude,
    rating,
    reviewCount: 1200,
    priceLevel: 2,
    cuisineTypes: ['restaurant français'],
    dietaryOptions: ['none'],
    openingHours: {},
    dataReliability: 'verified',
  };
}

describe('Restaurant proximity assignment', () => {
  const preferences = makePreferences();
  // Hotel near Batignolles: 48.8830, 2.3230
  const accommodationCoords = { lat: 48.8830632, lng: 2.3230198 };

  it('prefers nearby dinner over distant higher-rated option', () => {
    // Activities around Trocadero area
    const cluster: ActivityCluster = {
      dayNumber: 1,
      activities: [
        makeActivity('a1', 'Arc de Triomphe', 48.8738, 2.295),
        makeActivity('a2', 'Tour Eiffel', 48.8584, 2.2945),
        makeActivity('a3', 'Trocadero', 48.8626, 2.2874),
      ],
      centroid: { lat: 48.8649, lng: 2.2923 },
      totalIntraDistance: 3,
    };

    // Restaurants placed VERY close to activities and hotel (~200-400m)
    const restaurants = [
      // Breakfast: 200m from hotel
      makeRestaurant('r-breakfast', 'Cafe Batignolles', 48.8845, 2.3215, 4.2),
      // Lunch: ~300m from Trocadero (nearest to centroid)
      makeRestaurant('r-lunch', 'Bistro Trocadero', 48.8640, 2.2900, 4.4),
      // Dinner: ~250m from dinner reference point (70% Trocadero + 30% hotel)
      makeRestaurant('r-dinner', 'Diner Passy', 48.8695, 2.2930, 4.4),
      // Far: 5km away — should never be picked
      makeRestaurant('r-far', 'Far Top Rated', 48.871889, 2.366516, 4.95),
    ];

    const { meals } = assignRestaurants(
      [cluster],
      [],
      restaurants,
      preferences,
      null,
      accommodationCoords,
      null
    );

    const dinner = meals.find(m => m.dayNumber === 1 && m.mealType === 'dinner');
    expect(dinner?.restaurant).toBeDefined();
    expect(dinner?.restaurant?.id).not.toBe('r-far');
    expect(['r-lunch', 'r-dinner']).toContain(dinner?.restaurant?.id);
    expect(dinner?.restaurant?.distance).toBeDefined();
    expect((dinner?.restaurant?.distance || 0)).toBeLessThanOrEqual(1.2);
  });

  it('never reuses the same real restaurant id across meals', () => {
    // Activities around Louvre/Notre-Dame
    const cluster: ActivityCluster = {
      dayNumber: 1,
      activities: [
        makeActivity('a1', 'Louvre', 48.8606, 2.3376),
        makeActivity('a2', 'Notre-Dame', 48.853, 2.3499),
      ],
      centroid: { lat: 48.8568, lng: 2.3438 },
      totalIntraDistance: 1.8,
    };

    // Restaurants: one near hotel for breakfast, others near activities
    const restaurants = [
      // Near hotel (~50m)
      makeRestaurant('r1', 'Near Hotel', 48.8835, 2.3234, 4.4),
      // Near Notre-Dame (~200m) — usable for lunch/dinner
      makeRestaurant('r2', 'Near Notre-Dame', 48.8540, 2.3480, 4.3),
      // Near Louvre (~150m) — another lunch/dinner option
      makeRestaurant('r3', 'Near Louvre', 48.8615, 2.3360, 4.5),
    ];

    const { meals } = assignRestaurants(
      [cluster],
      [],
      restaurants,
      preferences,
      null,
      accommodationCoords,
      null
    );

    const assignedIds = meals
      .map(m => m.restaurant?.id)
      .filter((id): id is string => typeof id === 'string');

    const unique = new Set(assignedIds);
    expect(unique.size).toBe(assignedIds.length);
  });

  it('returns null restaurant when all options are too far', () => {
    const cluster: ActivityCluster = {
      dayNumber: 1,
      activities: [
        makeActivity('a1', 'Louvre', 48.8606, 2.3376),
      ],
      centroid: { lat: 48.8606, lng: 2.3376 },
      totalIntraDistance: 0,
    };

    // 12km away — well beyond any limit
    const farRestaurants = [
      makeRestaurant('r-far-1', 'Very Far Restaurant', 48.95, 2.45, 4.9),
    ];

    const { meals } = assignRestaurants(
      [cluster],
      [],
      farRestaurants,
      preferences,
      null,
      accommodationCoords,
      null
    );

    const breakfast = meals.find(m => m.dayNumber === 1 && m.mealType === 'breakfast');
    expect(breakfast?.restaurant).toBeNull();
  });

  it('assigns restaurants within 1.2km absolute limit', () => {
    // Single activity cluster
    const cluster: ActivityCluster = {
      dayNumber: 1,
      activities: [
        makeActivity('a1', 'Sacre-Coeur', 48.8867, 2.3431),
      ],
      centroid: { lat: 48.8867, lng: 2.3431 },
      totalIntraDistance: 0,
    };

    // Restaurant at 400m from activity and 500m from hotel
    const restaurants = [
      makeRestaurant('r1', 'Cafe Montmartre', 48.8870, 2.3395, 4.3),
      makeRestaurant('r2', 'Bistro Abbesses', 48.8845, 2.3385, 4.6),
    ];

    const { meals } = assignRestaurants(
      [cluster],
      [],
      restaurants,
      preferences,
      null,
      accommodationCoords,
      null
    );

    // All assigned restaurants should be within the 1.2km absolute limit
    for (const meal of meals) {
      if (meal.restaurant?.distance) {
        expect(meal.restaurant.distance).toBeLessThanOrEqual(1.2);
      }
    }
  });
});

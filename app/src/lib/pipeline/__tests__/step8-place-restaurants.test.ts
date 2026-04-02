import { placeRestaurants } from '../step8-place-restaurants';
import type { ActivityCluster, ScoredActivity } from '../types';
import type { Restaurant } from '../../types';

function makeActivity(overrides: Partial<ScoredActivity> = {}): ScoredActivity {
  return {
    id: overrides.id || 'act-1',
    name: overrides.name || 'Test Activity',
    type: overrides.type || 'culture',
    description: overrides.description || 'Desc',
    duration: overrides.duration || 90,
    estimatedCost: overrides.estimatedCost || 0,
    latitude: overrides.latitude ?? 41.3851,
    longitude: overrides.longitude ?? 2.1734,
    rating: overrides.rating ?? 4.6,
    mustSee: overrides.mustSee ?? false,
    bookingRequired: overrides.bookingRequired ?? false,
    openingHours: overrides.openingHours || { open: '09:00', close: '18:00' },
    score: overrides.score ?? 80,
    source: overrides.source || 'google_places',
    reviewCount: overrides.reviewCount ?? 1000,
    ...overrides,
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

describe('step8-place-restaurants strict placement', () => {
  const cluster: ActivityCluster = {
    dayNumber: 1,
    activities: [makeActivity()],
    centroid: { lat: 41.3851, lng: 2.1734 },
    totalIntraDistance: 0.2,
  };

  it('skips restaurants beyond 1.5km cap rather than placing far-away ones', async () => {
    const farRestaurant = makeRestaurant({
      id: 'far-1',
      latitude: 41.4151, // ~3.3km north — beyond 1.5km cap
      longitude: 2.1734,
    });

    const plans = await placeRestaurants(
      [cluster],
      [farRestaurant],
      { lat: 41.3851, lng: 2.1734 },
      {
        maxDistanceKm: 0.8,
        minRating: 3.5,
        alternativeCount: 2,
        startDate: new Date('2026-03-16T00:00:00.000Z'),
      }
    );

    expect(plans[0]).toBeDefined();
    // Only breakfast (hotel fallback) — lunch/dinner skipped because restaurant is 3.3km away
    expect(plans[0].meals.length).toBe(1);
    expect(plans[0].meals.find(m => m.mealType === 'breakfast')).toBeDefined();
  });

  it('places restaurants even when closed on that day via ultimate fallback', async () => {
    const closedOnMonday = makeRestaurant({
      id: 'closed-1',
      openingHours: {
        monday: null,
        tuesday: { open: '08:00', close: '22:00' },
        wednesday: { open: '08:00', close: '22:00' },
        thursday: { open: '08:00', close: '22:00' },
        friday: { open: '08:00', close: '22:00' },
        saturday: { open: '08:00', close: '22:00' },
        sunday: { open: '08:00', close: '22:00' },
      },
    });

    const plans = await placeRestaurants(
      [cluster],
      [closedOnMonday],
      { lat: 41.3851, lng: 2.1734 },
      {
        maxDistanceKm: 0.8,
        minRating: 3.5,
        alternativeCount: 2,
        startDate: new Date('2026-03-16T00:00:00.000Z'), // Monday
      }
    );

    expect(plans[0]).toBeDefined();
    // All 3 meals placed — closed restaurant used as fallback rather than no restaurant
    expect(plans[0].meals.length).toBe(3);
    expect(plans[0].meals[0].mealType).toBe('breakfast');
  });
});

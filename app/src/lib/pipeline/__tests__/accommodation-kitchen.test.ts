import type { Accommodation, Restaurant } from '../../types';
import type { MealAssignment } from '../types';
import {
  accommodationHasKitchen,
  sanitizeBudgetStrategyForKitchen,
  stripSelfCateredFallbacks,
} from '../utils/accommodation';

function makeHotel(overrides: Partial<Accommodation> = {}): Accommodation {
  return {
    id: 'hotel-1',
    name: 'City Hotel',
    type: 'hotel',
    address: 'Paris',
    latitude: 48.8566,
    longitude: 2.3522,
    rating: 8.4,
    reviewCount: 1000,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    ...overrides,
  };
}

function makeRestaurant(id: string): Restaurant {
  return {
    id,
    name: id,
    address: 'Paris',
    latitude: 48.8566,
    longitude: 2.3522,
    rating: 4.5,
    reviewCount: 100,
    priceLevel: 2,
    cuisineTypes: ['restaurant'],
    dietaryOptions: ['none'],
    openingHours: {},
  };
}

describe('accommodation kitchen guards', () => {
  it('detects kitchen from amenities and apartment type', () => {
    expect(
      accommodationHasKitchen(makeHotel({ type: 'apartment' }))
    ).toBe(true);
    expect(
      accommodationHasKitchen(makeHotel({ amenities: ['Kitchenette', 'WiFi'] }))
    ).toBe(true);
    expect(
      accommodationHasKitchen(makeHotel({ amenities: ['WiFi', 'Air conditioning'] }))
    ).toBe(false);
  });

  it('sanitizes self-catered strategy when no kitchen is available', () => {
    const strategy = {
      accommodationType: 'hotel',
      accommodationBudgetPerNight: 120,
      mealsStrategy: {
        breakfast: 'self_catered',
        lunch: 'restaurant',
        dinner: 'self_catered',
      },
      groceryShoppingNeeded: true,
      activitiesLevel: 'mixed',
      dailyActivityBudget: 35,
      maxPricePerActivity: 45,
      transportTips: '',
      reasoning: 'Budget serré',
    } as const;

    const sanitized = sanitizeBudgetStrategyForKitchen(strategy as any, false);
    expect(sanitized.adjusted).toBe(true);
    expect(sanitized.strategy?.mealsStrategy.breakfast).toBe('restaurant');
    expect(sanitized.strategy?.mealsStrategy.dinner).toBe('restaurant');
    expect(sanitized.strategy?.groceryShoppingNeeded).toBe(false);
  });

  it('removes self-catered fallback meals when no kitchen exists', () => {
    const fallbackRestaurant = makeRestaurant('alt-1');
    const meals: MealAssignment[] = [
      {
        dayNumber: 1,
        mealType: 'dinner',
        restaurant: null,
        restaurantAlternatives: [fallbackRestaurant],
        referenceCoords: { lat: 48.8566, lng: 2.3522 },
        fallbackMode: 'self_catered',
      },
    ];

    const sanitized = stripSelfCateredFallbacks(meals, false);
    expect(sanitized.changed).toBe(1);
    expect(sanitized.meals[0].fallbackMode).toBeUndefined();
    expect(sanitized.meals[0].restaurant?.id).toBe('alt-1');
  });
});

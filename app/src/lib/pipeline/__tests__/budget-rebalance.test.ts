import { selectSelfCateredMealsForBudget } from '../index';
import type { MealAssignment } from '../types';
import type { Restaurant } from '../../types';

function makeRestaurant(id: string, priceLevel: 1 | 2 | 3 | 4): Restaurant {
  return {
    id,
    name: id,
    address: 'Paris',
    latitude: 48.8566,
    longitude: 2.3522,
    rating: 4.5,
    reviewCount: 100,
    priceLevel,
    cuisineTypes: ['restaurant'],
    dietaryOptions: ['none'],
    openingHours: {},
  };
}

describe('budget rebalance self-catered fallback', () => {
  it('switches expensive meals to self-catered when reduction is needed', () => {
    const lunch = makeRestaurant('lunch-resto', 2);
    const dinner = makeRestaurant('dinner-resto', 3);
    const meals: MealAssignment[] = [
      {
        dayNumber: 1,
        mealType: 'lunch',
        restaurant: lunch,
        restaurantAlternatives: [],
        referenceCoords: { lat: 48.8566, lng: 2.3522 },
      },
      {
        dayNumber: 1,
        mealType: 'dinner',
        restaurant: dinner,
        restaurantAlternatives: [],
        referenceCoords: { lat: 48.8566, lng: 2.3522 },
      },
    ];

    const result = selectSelfCateredMealsForBudget(meals, 20);

    expect(result.changed).toBe(1);
    expect(result.estimatedSavings).toBeGreaterThanOrEqual(20);
    const selfCateredMeal = result.meals.find((meal) => meal.fallbackMode === 'self_catered');
    expect(selfCateredMeal).toBeDefined();
    expect(selfCateredMeal?.restaurant).toBeNull();
    expect(selfCateredMeal?.mealType).toBe('dinner');
  });

  it('does not change meals when no reduction is required', () => {
    const meals: MealAssignment[] = [
      {
        dayNumber: 1,
        mealType: 'lunch',
        restaurant: makeRestaurant('lunch-resto', 2),
        restaurantAlternatives: [],
        referenceCoords: { lat: 48.8566, lng: 2.3522 },
      },
    ];

    const result = selectSelfCateredMealsForBudget(meals, 0);

    expect(result.changed).toBe(0);
    expect(result.estimatedSavings).toBe(0);
    expect(result.meals[0].restaurant?.id).toBe('lunch-resto');
  });
});


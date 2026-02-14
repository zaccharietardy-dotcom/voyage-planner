import type { Restaurant } from '../types';
import { isAppropriateForMeal, isBreakfastSpecialized } from '../pipeline/step4-restaurants';

function makeRestaurant(overrides: Partial<Restaurant>): Restaurant {
  return {
    id: 'r-1',
    name: 'Restaurant',
    address: 'Adresse',
    latitude: 45.0,
    longitude: 7.0,
    rating: 4.4,
    reviewCount: 120,
    priceLevel: 2,
    cuisineTypes: [],
    dietaryOptions: [],
    openingHours: {},
    ...overrides,
  };
}

describe('breakfast filtering', () => {
  it('rejects heavy or non-breakfast restaurants for breakfast', () => {
    const pizza = makeRestaurant({
      id: 'pizza',
      name: 'Pizza Napoli',
      cuisineTypes: ['Italian', 'Pizza'],
    });
    const sushi = makeRestaurant({
      id: 'sushi',
      name: 'Sushi Palace',
      cuisineTypes: ['Japanese', 'Sushi'],
    });
    const grill = makeRestaurant({
      id: 'grill',
      name: 'Steak Grill House',
      cuisineTypes: ['Steakhouse'],
    });

    expect(isAppropriateForMeal(pizza, 'breakfast')).toBe(false);
    expect(isAppropriateForMeal(sushi, 'breakfast')).toBe(false);
    expect(isAppropriateForMeal(grill, 'breakfast')).toBe(false);

    expect(isBreakfastSpecialized(pizza)).toBe(false);
    expect(isBreakfastSpecialized(sushi)).toBe(false);
    expect(isBreakfastSpecialized(grill)).toBe(false);
  });

  it('accepts bakery/cafe/patisserie places for breakfast', () => {
    const bakery = makeRestaurant({
      id: 'bakery',
      name: 'Boulangerie Saint-Honoré',
      cuisineTypes: ['Bakery', 'Cafe'],
    });
    const coffee = makeRestaurant({
      id: 'coffee',
      name: 'Morning Coffee Brunch',
      cuisineTypes: ['Coffee shop', 'Brunch'],
    });
    const patisserie = makeRestaurant({
      id: 'patisserie',
      name: 'Pâtisserie Milano',
      cuisineTypes: ['Pâtisserie'],
    });

    expect(isAppropriateForMeal(bakery, 'breakfast')).toBe(true);
    expect(isAppropriateForMeal(coffee, 'breakfast')).toBe(true);
    expect(isAppropriateForMeal(patisserie, 'breakfast')).toBe(true);

    expect(isBreakfastSpecialized(bakery)).toBe(true);
    expect(isBreakfastSpecialized(coffee)).toBe(true);
    expect(isBreakfastSpecialized(patisserie)).toBe(true);
  });
});


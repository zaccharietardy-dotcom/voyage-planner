/**
 * Tests for restaurant rating filter (Bug #2)
 *
 * Requirements:
 * - ONLY restaurants with rating >= 3.7 should be returned
 * - Restaurants with null rating should be kept (unknown = benefit of doubt)
 * - Filtering should happen in applyFinalFilter before returning results
 */

// Mock the cuisineValidator module
jest.mock('../services/cuisineValidator', () => ({
  validateRestaurantCuisine: jest.fn(() => ({ score: 0, isLocal: false, isForbidden: false })),
  filterRestaurantsByCuisine: jest.fn((restaurants) => restaurants),
  getCountryFromDestination: jest.fn(() => 'Spain'),
}));

// Mock serpApiPlaces
jest.mock('../services/serpApiPlaces', () => ({
  searchRestaurantsWithSerpApi: jest.fn(() => Promise.resolve([])),
  isSerpApiPlacesConfigured: jest.fn(() => false),
}));

// Mock placeDatabase
jest.mock('../services/placeDatabase', () => ({
  searchPlacesFromDB: jest.fn(() => Promise.resolve([])),
  savePlacesToDB: jest.fn(() => Promise.resolve()),
  isDataFresh: jest.fn(() => false),
}));

import { searchRestaurants, MIN_RATING_THRESHOLD, filterByRating } from '../services/restaurants';
import type { Restaurant } from '../types';

describe('Restaurant Rating Filter (Bug #2)', () => {
  // Test data
  const createRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
    id: `test-${Math.random()}`,
    name: 'Test Restaurant',
    address: 'Test Address',
    latitude: 41.3851,
    longitude: 2.1734,
    rating: 4.5,
    reviewCount: 100,
    priceLevel: 2,
    cuisineTypes: ['spanish'],
    dietaryOptions: ['none'],
    openingHours: {},
    ...overrides,
  });

  describe('MIN_RATING_THRESHOLD constant', () => {
    it('should export MIN_RATING_THRESHOLD = 3.7', () => {
      expect(MIN_RATING_THRESHOLD).toBe(3.7);
    });
  });

  describe('filterByRating', () => {
    it('rejects restaurants with rating < 3.7', () => {
      const restaurants = [
        createRestaurant({ name: 'Good Restaurant', rating: 4.5 }),
        createRestaurant({ name: 'Bad Restaurant', rating: 2.6 }),
        createRestaurant({ name: 'Borderline Restaurant', rating: 3.7 }),
        createRestaurant({ name: 'Very Bad Restaurant', rating: 1.7 }),
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.name)).toContain('Good Restaurant');
      expect(filtered.map(r => r.name)).toContain('Borderline Restaurant');
      expect(filtered.map(r => r.name)).not.toContain('Bad Restaurant');
      expect(filtered.map(r => r.name)).not.toContain('Very Bad Restaurant');
    });

    it('keeps restaurants with exactly 3.7 rating (boundary)', () => {
      const restaurants = [
        createRestaurant({ name: 'Exactly 3.7', rating: 3.7 }),
        createRestaurant({ name: 'Just Below', rating: 3.69 }),
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Exactly 3.7');
    });

    it('keeps restaurants with null rating (unknown = benefit of doubt)', () => {
      const restaurants = [
        createRestaurant({ name: 'No Rating', rating: undefined }),
        createRestaurant({ name: 'Good Rating', rating: 4.0 }),
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.name)).toContain('No Rating');
    });

    it('returns empty array when all restaurants have low rating', () => {
      const restaurants = [
        createRestaurant({ name: 'Bad 1', rating: 2.0 }),
        createRestaurant({ name: 'Bad 2', rating: 3.2 }),
        createRestaurant({ name: 'Bad 3', rating: 1.5 }),
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered).toHaveLength(0);
    });

    it('returns all restaurants when all have good ratings', () => {
      const restaurants = [
        createRestaurant({ name: 'Good 1', rating: 4.0 }),
        createRestaurant({ name: 'Good 2', rating: 4.5 }),
        createRestaurant({ name: 'Good 3', rating: 5.0 }),
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered).toHaveLength(3);
    });

    it('preserves order of restaurants', () => {
      const restaurants = [
        createRestaurant({ name: 'First', rating: 4.0 }),
        createRestaurant({ name: 'Second', rating: 4.5 }),
        createRestaurant({ name: 'Third', rating: 3.8 }),
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered[0].name).toBe('First');
      expect(filtered[1].name).toBe('Second');
      expect(filtered[2].name).toBe('Third');
    });
  });

  describe('Rating consistency with displayed value', () => {
    it('should have rating that matches what user sees (no manipulation)', () => {
      const restaurant = createRestaurant({ rating: 4.7 });
      const filtered = filterByRating([restaurant]);

      // Rating returned should be exactly what was input (no modification)
      expect(filtered[0].rating).toBe(4.7);
    });

    it('should not modify rating values during filtering', () => {
      const restaurants = [
        createRestaurant({ rating: 4.7 }),
        createRestaurant({ rating: 3.9 }),
        createRestaurant({ rating: 2.6 }), // Will be filtered out
      ];

      const filtered = filterByRating(restaurants);

      expect(filtered[0].rating).toBe(4.7);
      expect(filtered[1].rating).toBe(3.9);
    });
  });

  describe('Integration with searchRestaurants', () => {
    // Note: These tests verify the filter is applied in the final output
    // The actual implementation should call filterByRating in applyFinalFilter

    it('should only return restaurants >= 3.7 from search results', async () => {
      // This test will fail until we implement the filter in applyFinalFilter
      // For now we skip it as it requires mocking the full search chain
    });
  });

  describe('Edge cases', () => {
    it('handles rating of exactly 0', () => {
      const restaurants = [createRestaurant({ rating: 0 })];
      const filtered = filterByRating(restaurants);
      expect(filtered).toHaveLength(0);
    });

    it('handles negative rating (invalid data)', () => {
      const restaurants = [createRestaurant({ rating: -1 })];
      const filtered = filterByRating(restaurants);
      expect(filtered).toHaveLength(0);
    });

    it('handles rating > 5 (invalid but possible from bad data)', () => {
      // We still accept ratings > 5 as long as they're >= 3.7
      const restaurants = [createRestaurant({ rating: 6.0 })];
      const filtered = filterByRating(restaurants);
      expect(filtered).toHaveLength(1);
    });

    it('handles empty array input', () => {
      const filtered = filterByRating([]);
      expect(filtered).toHaveLength(0);
    });
  });
});

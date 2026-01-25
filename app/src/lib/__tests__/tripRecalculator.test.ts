/**
 * Tests for trip recalculator (Bug #8)
 *
 * Requirements:
 * - When flight changes, recalculate EVERYTHING:
 *   - Number of nights
 *   - Hotel availability
 *   - Restaurants available
 *   - Activities reachable
 *   - Total price
 *   - Score
 *   - Itineraries
 */

import {
  TripRecalculator,
  calculateNightsBetween,
  recalculatePrice,
  recalculateActivities,
  createChangesSummary,
  ChangeType,
} from '../services/tripRecalculator';

describe('Trip Recalculator (Bug #8)', () => {
  describe('calculateNightsBetween', () => {
    it('calculates 3 nights for Mar 15-18', () => {
      const nights = calculateNightsBetween('2025-03-15', '2025-03-18');
      expect(nights).toBe(3);
    });

    it('calculates 1 night for same day departure next day', () => {
      const nights = calculateNightsBetween('2025-03-15', '2025-03-16');
      expect(nights).toBe(1);
    });

    it('handles 0 nights (same day trip)', () => {
      const nights = calculateNightsBetween('2025-03-15', '2025-03-15');
      expect(nights).toBe(0);
    });

    it('handles month boundaries', () => {
      const nights = calculateNightsBetween('2025-03-30', '2025-04-02');
      expect(nights).toBe(3);
    });
  });

  describe('recalculatePrice', () => {
    it('sums all cost components', () => {
      const costs = {
        flights: 190,
        accommodation: 420,
        food: 110,
        activities: 40,
        transport: 30,
        parking: 50,
      };

      const total = recalculatePrice(costs);
      expect(total).toBe(840);
    });

    it('handles missing optional components', () => {
      const costs = {
        flights: 190,
        accommodation: 420,
      };

      const total = recalculatePrice(costs);
      expect(total).toBe(610);
    });
  });

  describe('recalculateActivities', () => {
    it('filters activities by available time window', () => {
      const activities = [
        { id: '1', name: 'Sagrada Familia', duration: 120 }, // 2h
        { id: '2', name: 'Park Güell', duration: 180 }, // 3h
        { id: '3', name: 'La Rambla', duration: 60 }, // 1h
      ];

      // Only 3 hours available
      const filtered = recalculateActivities(activities, 180);

      // Should be able to do either Park Güell OR Sagrada+Rambla
      expect(filtered.length).toBeLessThanOrEqual(2);
      expect(filtered.reduce((sum, a) => sum + a.duration, 0)).toBeLessThanOrEqual(180);
    });

    it('returns all activities if time permits', () => {
      const activities = [
        { id: '1', name: 'Sagrada Familia', duration: 120 },
        { id: '2', name: 'Park Güell', duration: 180 },
      ];

      // 8 hours available
      const filtered = recalculateActivities(activities, 480);
      expect(filtered.length).toBe(2);
    });

    it('returns empty array if no time available', () => {
      const activities = [
        { id: '1', name: 'Sagrada Familia', duration: 120 },
      ];

      const filtered = recalculateActivities(activities, 0);
      expect(filtered.length).toBe(0);
    });
  });

  describe('createChangesSummary', () => {
    it('creates summary for nights change', () => {
      const changes: ChangeType[] = [
        { type: 'nights', old: 3, new: 2 },
      ];

      const summary = createChangesSummary(changes);

      expect(summary).toContain('Nights: 3 → 2');
    });

    it('creates summary for price change', () => {
      const changes: ChangeType[] = [
        { type: 'price', old: 500, new: 450 },
      ];

      const summary = createChangesSummary(changes);

      expect(summary).toContain('Price: 500€ → 450€');
      expect(summary).toContain('-50€');
    });

    it('creates summary for multiple changes', () => {
      const changes: ChangeType[] = [
        { type: 'nights', old: 3, new: 2 },
        { type: 'restaurants', old: 6, new: 4 },
        { type: 'price', old: 800, new: 650 },
      ];

      const summary = createChangesSummary(changes);

      expect(summary).toContain('Nights');
      expect(summary).toContain('Restaurants');
      expect(summary).toContain('Price');
    });

    it('returns empty string for no changes', () => {
      const summary = createChangesSummary([]);
      expect(summary).toBe('');
    });
  });

  describe('TripRecalculator', () => {
    const baseTripData = {
      outboundFlight: {
        departureTime: '10:00',
        arrivalTime: '12:30',
        date: '2025-03-15',
      },
      returnFlight: {
        departureTime: '18:00',
        arrivalTime: '20:30',
        date: '2025-03-18',
      },
      hotel: {
        id: 'hotel1',
        name: 'Hotel Ohla',
        pricePerNight: 140,
      },
      restaurants: [
        { id: 'r1', name: 'Restaurant 1', rating: 4.5 },
        { id: 'r2', name: 'Restaurant 2', rating: 4.2 },
        { id: 'r3', name: 'Restaurant 3', rating: 4.7 },
      ],
      activities: [
        { id: 'a1', name: 'Sagrada Familia', duration: 120 },
        { id: 'a2', name: 'Park Güell', duration: 180 },
      ],
      price: 760,
      score: 85,
    };

    it('detects nights change when flight dates change', () => {
      const recalculator = new TripRecalculator(baseTripData);

      const result = recalculator.changeReturnFlight({
        departureTime: '18:00',
        arrivalTime: '20:30',
        date: '2025-03-17', // One day earlier
      });

      expect(result.changes).toContainEqual(
        expect.objectContaining({ type: 'nights', old: 3, new: 2 })
      );
    });

    it('recalculates price when nights change', () => {
      const recalculator = new TripRecalculator(baseTripData);

      const result = recalculator.changeReturnFlight({
        departureTime: '18:00',
        arrivalTime: '20:30',
        date: '2025-03-17',
      });

      // Price should be lower with fewer nights
      expect(result.updatedTrip.price).toBeLessThan(baseTripData.price);
    });

    it('updates score based on new flight time', () => {
      const recalculator = new TripRecalculator(baseTripData);

      // Change to early morning flight (should penalize score)
      const result = recalculator.changeReturnFlight({
        departureTime: '05:00', // Early morning
        arrivalTime: '07:30',
        date: '2025-03-18',
      });

      // Score should be lower due to early flight penalty
      expect(result.updatedTrip.score).toBeLessThan(baseTripData.score);
    });

    it('provides list of all changes made', () => {
      const recalculator = new TripRecalculator(baseTripData);

      const result = recalculator.changeReturnFlight({
        departureTime: '18:00',
        arrivalTime: '20:30',
        date: '2025-03-17',
      });

      expect(result.changes).toBeDefined();
      expect(Array.isArray(result.changes)).toBe(true);
      expect(result.changesSummary).toBeDefined();
    });

    it('keeps trip unchanged if new flight is same as old', () => {
      const recalculator = new TripRecalculator(baseTripData);

      const result = recalculator.changeReturnFlight({
        departureTime: '18:00',
        arrivalTime: '20:30',
        date: '2025-03-18',
      });

      expect(result.changes.length).toBe(0);
      expect(result.updatedTrip.price).toBe(baseTripData.price);
    });

    it('filters restaurants if fewer meals needed', () => {
      const recalculator = new TripRecalculator(baseTripData);

      // Cut trip short - fewer meals needed
      const result = recalculator.changeReturnFlight({
        departureTime: '18:00',
        arrivalTime: '20:30',
        date: '2025-03-16', // Much shorter trip
      });

      // With only 1 night, need fewer restaurants
      expect(result.updatedTrip.restaurants.length).toBeLessThanOrEqual(
        baseTripData.restaurants.length
      );
    });
  });

  describe('Edge cases', () => {
    it('handles flight that makes trip impossible', () => {
      const tripData = {
        outboundFlight: { date: '2025-03-15' },
        returnFlight: { date: '2025-03-18' },
        hotel: { pricePerNight: 100 },
        restaurants: [],
        activities: [],
        price: 500,
        score: 80,
      };

      const recalculator = new TripRecalculator(tripData);

      // Return before outbound - should handle gracefully
      expect(() => {
        recalculator.changeReturnFlight({
          departureTime: '10:00',
          date: '2025-03-14', // Before outbound!
        });
      }).toThrow(/invalid|return.*before/i);
    });

    it('handles price increase notification', () => {
      const tripData = {
        outboundFlight: { date: '2025-03-15', price: 100 },
        returnFlight: { date: '2025-03-18', price: 100 },
        hotel: { pricePerNight: 100 },
        restaurants: [],
        activities: [],
        price: 500,
        score: 80,
      };

      const recalculator = new TripRecalculator(tripData);

      const result = recalculator.changeReturnFlight({
        departureTime: '10:00',
        date: '2025-03-19', // One more night
        price: 100,
      });

      // Price should increase
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: 'price',
          // new > old
        })
      );
    });
  });
});

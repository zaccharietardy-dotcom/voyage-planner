/**
 * Tests for itinerary logic validation (Bug #3)
 *
 * Requirements:
 * - No itinerary between same-building locations (check-in → boarding)
 * - No cross-city itineraries without flight
 * - Walking distance max 2km
 * - Realistic transport times
 */

import {
  Location,
  isLogicalItinerary,
  validateTransportMode,
  shouldCreateItinerary,
  MAX_WALKING_DISTANCE_KM,
} from '../services/itineraryValidator';

describe('Itinerary Logic Validation (Bug #3)', () => {
  describe('Location types', () => {
    it('should support all location types', () => {
      const locations: Location[] = [
        { type: 'home', name: 'Home', city: 'Paris', coords: { lat: 48.8, lng: 2.3 } },
        { type: 'airport_terminal', name: 'CDG T2E', city: 'Paris', coords: { lat: 49.0, lng: 2.5 } },
        { type: 'airport_parking', name: 'CDG P4', city: 'Paris', coords: { lat: 49.0, lng: 2.5 } },
        { type: 'city_location', name: 'Sagrada', city: 'Barcelona', coords: { lat: 41.4, lng: 2.1 } },
      ];

      locations.forEach(loc => {
        expect(loc.type).toBeDefined();
        expect(loc.city).toBeDefined();
      });
    });
  });

  describe('MAX_WALKING_DISTANCE_KM constant', () => {
    it('should be 2 km', () => {
      expect(MAX_WALKING_DISTANCE_KM).toBe(2);
    });
  });

  describe('isLogicalItinerary', () => {
    describe('Same location rules', () => {
      it('rejects itinerary between same location', () => {
        const location: Location = {
          type: 'airport_terminal',
          name: 'CDG Terminal 2E',
          city: 'Paris',
          coords: { lat: 49.0, lng: 2.55 },
        };

        const result = isLogicalItinerary(location, location);

        expect(result.logical).toBe(false);
        expect(result.reason).toContain('same location');
      });

      it('rejects itinerary between check-in and boarding (same building)', () => {
        const checkIn: Location = {
          type: 'airport_terminal',
          name: 'CDG Terminal 2E Check-in',
          city: 'Paris',
          coords: { lat: 49.01, lng: 2.55 },
        };

        const boarding: Location = {
          type: 'airport_terminal',
          name: 'CDG Gate 45',
          city: 'Paris',
          coords: { lat: 49.01, lng: 2.55 },
        };

        const result = isLogicalItinerary(checkIn, boarding);

        expect(result.logical).toBe(false);
        expect(result.reason).toContain('same airport');
      });
    });

    describe('Cross-city rules', () => {
      it('rejects 59-minute walk from CDG parking to Barcelona', () => {
        const cdgParking: Location = {
          type: 'airport_parking',
          name: 'CDG Parking P4',
          city: 'Paris',
          coords: { lat: 49.0, lng: 2.55 },
        };

        const barcelona: Location = {
          type: 'city_location',
          name: 'Barcelona City Center',
          city: 'Barcelona',
          coords: { lat: 41.39, lng: 2.17 },
        };

        const result = isLogicalItinerary(cdgParking, barcelona);

        expect(result.logical).toBe(false);
        expect(result.reason).toContain('without flight');
      });

      it('rejects cross-city itinerary without airport', () => {
        const paris: Location = {
          type: 'city_location',
          name: 'Eiffel Tower',
          city: 'Paris',
          coords: { lat: 48.85, lng: 2.29 },
        };

        const barcelona: Location = {
          type: 'city_location',
          name: 'Sagrada Familia',
          city: 'Barcelona',
          coords: { lat: 41.4, lng: 2.17 },
        };

        const result = isLogicalItinerary(paris, barcelona);

        expect(result.logical).toBe(false);
        expect(result.reason).toContain('different cities');
      });
    });

    describe('Valid itineraries', () => {
      it('accepts home to airport parking', () => {
        const home: Location = {
          type: 'home',
          name: 'Igny Home',
          city: 'Paris',
          coords: { lat: 48.74, lng: 2.23 },
        };

        const parking: Location = {
          type: 'airport_parking',
          name: 'CDG P4',
          city: 'Paris',
          coords: { lat: 49.0, lng: 2.55 },
        };

        const result = isLogicalItinerary(home, parking);

        expect(result.logical).toBe(true);
      });

      it('accepts airport to hotel in same city', () => {
        const airport: Location = {
          type: 'airport_terminal',
          name: 'Barcelona Airport',
          city: 'Barcelona',
          coords: { lat: 41.3, lng: 2.08 },
        };

        const hotel: Location = {
          type: 'city_location',
          name: 'Hotel Ohla Barcelona',
          city: 'Barcelona',
          coords: { lat: 41.39, lng: 2.17 },
        };

        const result = isLogicalItinerary(airport, hotel);

        expect(result.logical).toBe(true);
      });

      it('accepts city location to city location in same city', () => {
        const museum: Location = {
          type: 'city_location',
          name: 'Museu Picasso',
          city: 'Barcelona',
          coords: { lat: 41.385, lng: 2.18 },
        };

        const restaurant: Location = {
          type: 'city_location',
          name: 'Quimet & Quimet',
          city: 'Barcelona',
          coords: { lat: 41.37, lng: 2.16 },
        };

        const result = isLogicalItinerary(museum, restaurant);

        expect(result.logical).toBe(true);
      });
    });
  });

  describe('validateTransportMode', () => {
    it('rejects walking for distance > 2km', () => {
      const result = validateTransportMode(2.5, 'walking');

      expect(result.valid).toBe(false);
      expect(result.suggestion).toContain('metro');
    });

    it('accepts walking for distance <= 2km', () => {
      const result = validateTransportMode(1.5, 'walking');

      expect(result.valid).toBe(true);
    });

    it('accepts metro/bus for any distance', () => {
      expect(validateTransportMode(5, 'metro').valid).toBe(true);
      expect(validateTransportMode(10, 'bus').valid).toBe(true);
    });

    it('accepts car for long distances', () => {
      expect(validateTransportMode(30, 'car').valid).toBe(true);
    });
  });

  describe('shouldCreateItinerary', () => {
    it('returns false for airport_terminal to airport_terminal in same city', () => {
      const from: Location = {
        type: 'airport_terminal',
        name: 'Check-in',
        city: 'Paris',
        coords: { lat: 49.0, lng: 2.5 },
      };

      const to: Location = {
        type: 'airport_terminal',
        name: 'Gate',
        city: 'Paris',
        coords: { lat: 49.0, lng: 2.5 },
      };

      expect(shouldCreateItinerary(from, to)).toBe(false);
    });

    it('returns true for city_location to city_location', () => {
      const from: Location = {
        type: 'city_location',
        name: 'Museum',
        city: 'Barcelona',
        coords: { lat: 41.4, lng: 2.17 },
      };

      const to: Location = {
        type: 'city_location',
        name: 'Restaurant',
        city: 'Barcelona',
        coords: { lat: 41.38, lng: 2.18 },
      };

      expect(shouldCreateItinerary(from, to)).toBe(true);
    });

    it('returns true for home to airport', () => {
      const from: Location = {
        type: 'home',
        name: 'Home',
        city: 'Paris',
        coords: { lat: 48.7, lng: 2.2 },
      };

      const to: Location = {
        type: 'airport_parking',
        name: 'CDG',
        city: 'Paris',
        coords: { lat: 49.0, lng: 2.5 },
      };

      expect(shouldCreateItinerary(from, to)).toBe(true);
    });

    it('returns false for different cities without airport', () => {
      const from: Location = {
        type: 'city_location',
        name: 'Paris place',
        city: 'Paris',
        coords: { lat: 48.8, lng: 2.3 },
      };

      const to: Location = {
        type: 'city_location',
        name: 'Barcelona place',
        city: 'Barcelona',
        coords: { lat: 41.4, lng: 2.1 },
      };

      expect(shouldCreateItinerary(from, to)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('handles case-insensitive city comparison', () => {
      const from: Location = {
        type: 'city_location',
        name: 'Place 1',
        city: 'BARCELONA',
        coords: { lat: 41.4, lng: 2.17 },
      };

      const to: Location = {
        type: 'city_location',
        name: 'Place 2',
        city: 'barcelona',
        coords: { lat: 41.38, lng: 2.18 },
      };

      const result = isLogicalItinerary(from, to);
      expect(result.logical).toBe(true);
    });

    it('handles city variations (Paris vs Paris-CDG)', () => {
      // Same city with different naming conventions
      const from: Location = {
        type: 'home',
        name: 'Home',
        city: 'Paris',
        coords: { lat: 48.7, lng: 2.2 },
      };

      const to: Location = {
        type: 'airport_terminal',
        name: 'CDG',
        city: 'Paris-CDG',
        coords: { lat: 49.0, lng: 2.5 },
      };

      // Should normalize "Paris-CDG" to recognize it's still Paris
      const result = isLogicalItinerary(from, to);
      expect(result.logical).toBe(true);
    });
  });
});

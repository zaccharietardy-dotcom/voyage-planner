/**
 * Tests for location tracking (Bug #1 & #9)
 *
 * Requirements:
 * - Track user's current city throughout the trip
 * - User starts at home (origin city)
 * - During flight = 'transit' state (no activities possible)
 * - After landing = user is in destination city
 * - Activities MUST match current city
 * - After return flight, user is back in origin city
 */

import {
  TravelerLocation,
  createInitialLocation,
  updateLocationOnFlightEvent,
  validateActivityLocation,
  isInTransit,
  getCurrentCity,
} from '../services/locationTracker';

describe('Location Tracker (Bug #1 & #9)', () => {
  describe('TravelerLocation types', () => {
    it('should support home, airport, city, and transit types', () => {
      const homeLocation: TravelerLocation = {
        type: 'home',
        city: 'Paris',
        description: 'Igny, France',
        timestamp: new Date(),
      };

      expect(homeLocation.type).toBe('home');
      expect(homeLocation.city).toBe('Paris');
    });
  });

  describe('createInitialLocation', () => {
    it('creates a home location from origin city', () => {
      const location = createInitialLocation('Paris', 'Igny, France');

      expect(location.type).toBe('home');
      expect(location.city).toBe('paris'); // Normalized to lowercase
      expect(location.description).toBe('Igny, France');
      expect(location.timestamp).toBeInstanceOf(Date);
    });

    it('normalizes city names to lowercase', () => {
      const location = createInitialLocation('PARIS', 'Home');
      expect(location.city).toBe('paris');
    });
  });

  describe('updateLocationOnFlightEvent', () => {
    const parisLocation: TravelerLocation = {
      type: 'airport',
      city: 'Paris',
      description: 'CDG Airport',
      timestamp: new Date(),
    };

    it('changes to transit when boarding', () => {
      const flight = {
        status: 'boarding' as const,
        originCity: 'Paris',
        destinationCity: 'Barcelona',
      };

      const newLocation = updateLocationOnFlightEvent(parisLocation, flight);

      expect(newLocation.type).toBe('transit');
      expect(newLocation.city).toBe(''); // No city during transit
      expect(newLocation.description).toContain('Paris');
      expect(newLocation.description).toContain('Barcelona');
    });

    it('stays in transit when in_flight', () => {
      const transitLocation: TravelerLocation = {
        type: 'transit',
        city: '',
        description: 'Flying Paris → Barcelona',
        timestamp: new Date(),
      };

      const flight = {
        status: 'in_flight' as const,
        originCity: 'Paris',
        destinationCity: 'Barcelona',
      };

      const newLocation = updateLocationOnFlightEvent(transitLocation, flight);

      expect(newLocation.type).toBe('transit');
      expect(newLocation.city).toBe('');
    });

    it('updates city when flight lands', () => {
      const transitLocation: TravelerLocation = {
        type: 'transit',
        city: '',
        description: 'Flying Paris → Barcelona',
        timestamp: new Date(),
      };

      const flight = {
        status: 'landed' as const,
        originCity: 'Paris',
        destinationCity: 'Barcelona',
        arrivalTime: '12:30',
      };

      const newLocation = updateLocationOnFlightEvent(transitLocation, flight);

      expect(newLocation.type).toBe('city');
      expect(newLocation.city).toBe('barcelona');
      expect(newLocation.description).toContain('Barcelona');
      expect(newLocation.description).toContain('12:30');
    });

    it('handles return flight landing in Paris', () => {
      const barcelonaLocation: TravelerLocation = {
        type: 'city',
        city: 'barcelona',
        description: 'Barcelona',
        timestamp: new Date(),
      };

      const returnFlight = {
        status: 'landed' as const,
        originCity: 'Barcelona',
        destinationCity: 'Paris',
        arrivalTime: '20:00',
      };

      const newLocation = updateLocationOnFlightEvent(barcelonaLocation, returnFlight);

      expect(newLocation.type).toBe('city');
      expect(newLocation.city).toBe('paris');
      expect(newLocation.description).toContain('Paris');
    });
  });

  describe('validateActivityLocation', () => {
    it('accepts activity in same city', () => {
      const location: TravelerLocation = {
        type: 'city',
        city: 'barcelona',
        description: 'Barcelona',
        timestamp: new Date(),
      };

      const activity = { city: 'Barcelona', name: 'Sagrada Familia' };
      const result = validateActivityLocation(location, activity);

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('');
    });

    it('rejects activity in Barcelona when user is in Paris', () => {
      const location: TravelerLocation = {
        type: 'airport',
        city: 'paris',
        description: 'CDG',
        timestamp: new Date(),
      };

      const activity = { city: 'Barcelona', name: 'Sagrada Familia' };
      const result = validateActivityLocation(location, activity);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Barcelona');
      expect(result.reason).toContain('paris');
    });

    it('rejects ALL activities when user is in transit (in-flight)', () => {
      const location: TravelerLocation = {
        type: 'transit',
        city: '',
        description: 'Flying',
        timestamp: new Date(),
      };

      const activity = { city: 'Barcelona', name: 'Sagrada Familia' };
      const result = validateActivityLocation(location, activity);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('transit');
    });

    it('rejects Barcelona activity after returning to Paris (Bug #9)', () => {
      // User has returned to Paris
      const location: TravelerLocation = {
        type: 'city',
        city: 'paris',
        description: 'Back in Paris at 20:00',
        timestamp: new Date(),
      };

      const activity = { city: 'Barcelona', name: 'Sagrada Familia' };
      const result = validateActivityLocation(location, activity);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Barcelona');
      expect(result.reason).toContain('paris');
    });

    it('handles case-insensitive city comparison', () => {
      const location: TravelerLocation = {
        type: 'city',
        city: 'barcelona',
        description: 'Barcelona',
        timestamp: new Date(),
      };

      const activity = { city: 'BARCELONA', name: 'Park Güell' };
      const result = validateActivityLocation(location, activity);

      expect(result.valid).toBe(true);
    });
  });

  describe('isInTransit', () => {
    it('returns true for transit type', () => {
      const location: TravelerLocation = {
        type: 'transit',
        city: '',
        description: 'Flying',
        timestamp: new Date(),
      };

      expect(isInTransit(location)).toBe(true);
    });

    it('returns false for other types', () => {
      const locations: TravelerLocation[] = [
        { type: 'home', city: 'Paris', description: 'Home', timestamp: new Date() },
        { type: 'airport', city: 'Paris', description: 'CDG', timestamp: new Date() },
        { type: 'city', city: 'Barcelona', description: 'Barcelona', timestamp: new Date() },
      ];

      locations.forEach(loc => {
        expect(isInTransit(loc)).toBe(false);
      });
    });
  });

  describe('getCurrentCity', () => {
    it('returns city for home/airport/city types', () => {
      expect(getCurrentCity({ type: 'home', city: 'Paris', description: '', timestamp: new Date() })).toBe('paris');
      expect(getCurrentCity({ type: 'airport', city: 'Paris', description: '', timestamp: new Date() })).toBe('paris');
      expect(getCurrentCity({ type: 'city', city: 'Barcelona', description: '', timestamp: new Date() })).toBe('barcelona');
    });

    it('returns null for transit type', () => {
      const location: TravelerLocation = {
        type: 'transit',
        city: '',
        description: 'Flying',
        timestamp: new Date(),
      };

      expect(getCurrentCity(location)).toBeNull();
    });
  });

  describe('Bug #1: Park Güell cannot appear BEFORE flight', () => {
    it('REJECTS Park Güell when user is still at home in Paris (before departure)', () => {
      const userAtHome = createInitialLocation('Paris', 'Igny, France');

      const parkGuell = { city: 'Barcelona', name: 'Park Güell' };
      const result = validateActivityLocation(userAtHome, parkGuell);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Park Güell');
      expect(result.reason).toContain('Barcelona');
    });

    it('REJECTS Park Güell when user is at CDG airport (before boarding)', () => {
      const userAtAirport: TravelerLocation = {
        type: 'airport',
        city: 'paris',
        description: 'CDG Terminal 2E',
        timestamp: new Date(),
      };

      const parkGuell = { city: 'Barcelona', name: 'Park Güell' };
      const result = validateActivityLocation(userAtAirport, parkGuell);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Park Güell');
    });

    it('REJECTS Park Güell when user is IN FLIGHT (transit)', () => {
      const userInFlight: TravelerLocation = {
        type: 'transit',
        city: '',
        description: 'Vol Paris → Barcelona',
        timestamp: new Date(),
      };

      const parkGuell = { city: 'Barcelona', name: 'Park Güell' };
      const result = validateActivityLocation(userInFlight, parkGuell);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('transit');
    });

    it('ACCEPTS Park Güell ONLY after landing in Barcelona', () => {
      // User has landed in Barcelona
      const userInBarcelona: TravelerLocation = {
        type: 'city',
        city: 'barcelona',
        description: 'Arrivé à Barcelona à 12:30',
        timestamp: new Date(),
      };

      const parkGuell = { city: 'Barcelona', name: 'Park Güell' };
      const result = validateActivityLocation(userInBarcelona, parkGuell);

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('');
    });
  });

  describe('Full trip scenario: Paris → Barcelona → Paris', () => {
    it('tracks location correctly through entire trip', () => {
      // 1. Start at home in Paris
      let location = createInitialLocation('Paris', 'Igny home');
      expect(location.city).toBe('paris');
      expect(validateActivityLocation(location, { city: 'Paris', name: 'CDG' }).valid).toBe(true);
      expect(validateActivityLocation(location, { city: 'Barcelona', name: 'Sagrada' }).valid).toBe(false);

      // 2. Go to airport (still in Paris)
      location = { ...location, type: 'airport', description: 'CDG Terminal' };
      expect(validateActivityLocation(location, { city: 'Paris', name: 'Duty Free' }).valid).toBe(true);
      expect(validateActivityLocation(location, { city: 'Barcelona', name: 'Sagrada' }).valid).toBe(false);

      // 3. Board flight (transit - no activities)
      location = updateLocationOnFlightEvent(location, {
        status: 'boarding',
        originCity: 'Paris',
        destinationCity: 'Barcelona',
      });
      expect(isInTransit(location)).toBe(true);
      expect(validateActivityLocation(location, { city: 'Paris', name: 'Any' }).valid).toBe(false);
      expect(validateActivityLocation(location, { city: 'Barcelona', name: 'Any' }).valid).toBe(false);

      // 4. Land in Barcelona
      location = updateLocationOnFlightEvent(location, {
        status: 'landed',
        originCity: 'Paris',
        destinationCity: 'Barcelona',
        arrivalTime: '12:30',
      });
      expect(location.city).toBe('barcelona');
      expect(validateActivityLocation(location, { city: 'Barcelona', name: 'Sagrada' }).valid).toBe(true);
      expect(validateActivityLocation(location, { city: 'Paris', name: 'Eiffel' }).valid).toBe(false);

      // 5. Enjoy Barcelona activities
      const barcelonaActivities = [
        { city: 'Barcelona', name: 'Sagrada Familia' },
        { city: 'Barcelona', name: 'Park Güell' },
        { city: 'Barcelona', name: 'La Rambla' },
      ];
      barcelonaActivities.forEach(activity => {
        expect(validateActivityLocation(location, activity).valid).toBe(true);
      });

      // 6. Return flight lands in Paris
      location = updateLocationOnFlightEvent(location, {
        status: 'landed',
        originCity: 'Barcelona',
        destinationCity: 'Paris',
        arrivalTime: '20:00',
      });
      expect(location.city).toBe('paris');

      // 7. NO MORE Barcelona activities allowed (Bug #9)
      expect(validateActivityLocation(location, { city: 'Barcelona', name: 'Sagrada' }).valid).toBe(false);
      expect(validateActivityLocation(location, { city: 'Paris', name: 'Home' }).valid).toBe(true);
    });
  });
});

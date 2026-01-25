/**
 * Tests de validation géographique pour la génération de voyages
 *
 * Vérifie que:
 * - Aucune activité à Barcelona n'est suggérée avant l'atterrissage
 * - Aucune activité à Barcelona n'est suggérée après le retour à Paris
 * - Les activités sont toujours dans la ville actuelle du voyageur
 */

import {
  createLocationTracker,
  createInitialLocation,
  updateLocationOnFlightEvent,
  validateActivityLocation,
  isInTransit,
  getCurrentCity,
} from '../services/locationTracker';

describe('Geographic Validation', () => {
  describe('Location Tracker Initialization', () => {
    it('creates initial location at origin city', () => {
      const location = createInitialLocation('Paris', 'Igny, France');

      expect(location.type).toBe('home');
      expect(location.city).toBe('paris');
      expect(location.description).toBe('Igny, France');
    });
  });

  describe('Flight Events', () => {
    it('sets location to transit when boarding', () => {
      const initial = createInitialLocation('Paris', 'Igny');

      const updated = updateLocationOnFlightEvent(initial, {
        status: 'boarding',
        originCity: 'Paris',
        destinationCity: 'Barcelona',
      });

      expect(updated.type).toBe('transit');
      expect(updated.city).toBe('');
      expect(isInTransit(updated)).toBe(true);
    });

    it('sets location to destination city when landed', () => {
      const initial = createInitialLocation('Paris', 'Igny');

      const updated = updateLocationOnFlightEvent(initial, {
        status: 'landed',
        originCity: 'Paris',
        destinationCity: 'Barcelona',
        arrivalTime: '12:30',
      });

      expect(updated.type).toBe('city');
      expect(updated.city).toBe('barcelona');
      expect(getCurrentCity(updated)).toBe('barcelona');
    });
  });

  describe('Activity Validation - Core Rule', () => {
    it('prevents Park Güell before arrival in Barcelona', () => {
      const tracker = createLocationTracker('Paris', 'Igny');

      // Avant le vol: utilisateur à Paris
      const result1 = tracker.validateActivity({ city: 'Barcelona', name: 'Park Güell' });
      expect(result1.valid).toBe(false);
      expect(result1.reason).toContain('Park Güell');

      // Pendant le vol: en transit
      tracker.boardFlight('Paris', 'Barcelona');
      const result2 = tracker.validateActivity({ city: 'Barcelona', name: 'Park Güell' });
      expect(result2.valid).toBe(false);
      expect(result2.reason).toContain('transit');

      // Après atterrissage: à Barcelona
      tracker.landFlight('Barcelona', '12:30');
      const result3 = tracker.validateActivity({ city: 'Barcelona', name: 'Park Güell' });
      expect(result3.valid).toBe(true);
    });

    it('prevents activities in Barcelona after return flight lands in Paris', () => {
      const tracker = createLocationTracker('Paris', 'Igny');

      // Arrivée à Barcelona
      tracker.landFlight('Barcelona', '12:00');
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Sagrada Familia' }).valid).toBe(true);

      // Vol retour
      tracker.boardFlight('Barcelona', 'Paris');
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Sagrada Familia' }).valid).toBe(false);

      // Retour à Paris
      tracker.landFlight('Paris', '20:00');
      const result = tracker.validateActivity({ city: 'Barcelona', name: 'Sagrada Familia' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Barcelona');
      expect(result.reason).toContain('paris');
    });

    it('allows Paris activities when user is in Paris', () => {
      const tracker = createLocationTracker('Paris', 'Igny');

      // À Paris initialement
      const result1 = tracker.validateActivity({ city: 'Paris', name: 'Tour Eiffel' });
      expect(result1.valid).toBe(true);

      // Aller à Barcelona et revenir
      tracker.boardFlight('Paris', 'Barcelona');
      tracker.landFlight('Barcelona', '12:00');
      tracker.boardFlight('Barcelona', 'Paris');
      tracker.landFlight('Paris', '20:00');

      // À Paris de retour
      const result2 = tracker.validateActivity({ city: 'Paris', name: 'Musée du Louvre' });
      expect(result2.valid).toBe(true);
    });
  });

  describe('Activity Validation - Edge Cases', () => {
    it('handles case-insensitive city names', () => {
      const tracker = createLocationTracker('Paris', 'Igny');
      tracker.landFlight('Barcelona', '12:00');

      // Toutes ces variantes devraient fonctionner
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Test' }).valid).toBe(true);
      expect(tracker.validateActivity({ city: 'BARCELONA', name: 'Test' }).valid).toBe(true);
      expect(tracker.validateActivity({ city: 'barcelona', name: 'Test' }).valid).toBe(true);
      expect(tracker.validateActivity({ city: ' Barcelona ', name: 'Test' }).valid).toBe(true);
    });

    it('prevents activities in any other city', () => {
      const tracker = createLocationTracker('Paris', 'Igny');
      tracker.landFlight('Barcelona', '12:00');

      // À Barcelona, ne peut pas visiter Madrid
      const result = tracker.validateActivity({ city: 'Madrid', name: 'Prado Museum' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Madrid');
    });
  });

  describe('Full Trip Simulation', () => {
    it('validates a complete Paris → Barcelona → Paris trip', () => {
      const tracker = createLocationTracker('Paris', 'Igny');

      // Jour 1 matin: À Paris
      expect(tracker.getCurrentCity()).toBe('paris');
      expect(tracker.validateActivity({ city: 'Paris', name: 'CDG Parking' }).valid).toBe(true);
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Sagrada Familia' }).valid).toBe(false);

      // Jour 1: Vol vers Barcelona
      tracker.goToAirport('CDG Terminal 2');
      tracker.boardFlight('Paris', 'Barcelona');
      expect(tracker.isInTransit()).toBe(true);
      expect(tracker.getCurrentCity()).toBe(null);

      // Jour 1 après-midi: Arrivée Barcelona
      tracker.landFlight('Barcelona', '14:30');
      expect(tracker.getCurrentCity()).toBe('barcelona');
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'La Rambla' }).valid).toBe(true);
      expect(tracker.validateActivity({ city: 'Paris', name: 'Tour Eiffel' }).valid).toBe(false);

      // Jour 2-3: À Barcelona
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Park Güell' }).valid).toBe(true);
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Casa Batlló' }).valid).toBe(true);

      // Dernier jour: Vol retour
      tracker.boardFlight('Barcelona', 'Paris');
      expect(tracker.isInTransit()).toBe(true);
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Barceloneta Beach' }).valid).toBe(false);

      // Retour à Paris
      tracker.landFlight('Paris', '22:00');
      expect(tracker.getCurrentCity()).toBe('paris');
      expect(tracker.validateActivity({ city: 'Barcelona', name: 'Any activity' }).valid).toBe(false);
    });
  });
});

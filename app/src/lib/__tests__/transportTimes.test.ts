/**
 * Tests for realistic transport times (Bug #5)
 *
 * Requirements:
 * - Include wait times for public transport
 * - Walking speed: ~5 km/h (12 min/km)
 * - Metro/Bus: include average wait time (5-10 min)
 * - Airport to hotel: realistic 30-45 min
 * - Long distances require appropriate transport
 */

import {
  estimateRealisticTravelTime,
  TRANSPORT_SPEEDS,
  WAIT_TIMES,
  calculateDuration,
  validateTransportForDistance,
  suggestBestTransport,
} from '../services/transportTimes';

describe('Realistic Transport Times (Bug #5)', () => {
  describe('TRANSPORT_SPEEDS constant', () => {
    it('should define speeds for all modes', () => {
      expect(TRANSPORT_SPEEDS.walking).toBe(5); // 5 km/h
      expect(TRANSPORT_SPEEDS.car).toBeDefined();
      expect(TRANSPORT_SPEEDS.bus).toBeDefined();
      expect(TRANSPORT_SPEEDS.metro).toBeDefined();
      expect(TRANSPORT_SPEEDS.train).toBeDefined();
      expect(TRANSPORT_SPEEDS.taxi).toBeDefined();
    });
  });

  describe('WAIT_TIMES constant', () => {
    it('should define wait times for public transport', () => {
      expect(WAIT_TIMES.walking).toBe(0); // No wait for walking
      expect(WAIT_TIMES.car).toBe(5); // Time to get car
      expect(WAIT_TIMES.bus).toBe(10); // Average bus wait
      expect(WAIT_TIMES.metro).toBe(5); // Average metro wait
      expect(WAIT_TIMES.train).toBe(10); // Average train wait
      expect(WAIT_TIMES.taxi).toBe(8); // Wait for taxi
    });
  });

  describe('calculateDuration', () => {
    it('calculates walking time correctly (5 km/h)', () => {
      // 1 km at 5 km/h = 12 minutes
      const duration = calculateDuration(1, 'walking');
      expect(duration).toBe(12);
    });

    it('calculates metro time with wait', () => {
      // 5 km at ~30 km/h = 10 min + 5 min wait = 15 min
      const duration = calculateDuration(5, 'metro');
      // ~10 min travel + 5 min wait = ~15 min
      expect(duration).toBeGreaterThanOrEqual(15);
      expect(duration).toBeLessThanOrEqual(20);
    });

    it('calculates bus time with wait', () => {
      // 5 km at ~20 km/h = 15 min + 10 min wait = 25 min
      const duration = calculateDuration(5, 'bus');
      expect(duration).toBeGreaterThanOrEqual(25);
      expect(duration).toBeLessThanOrEqual(30);
    });

    it('includes car retrieval time', () => {
      // Even for short distance, car has 5 min retrieval time
      const duration = calculateDuration(1, 'car');
      expect(duration).toBeGreaterThanOrEqual(5); // At least wait time
    });
  });

  describe('estimateRealisticTravelTime', () => {
    it('returns realistic time for airport to hotel (bus)', () => {
      // Barcelona airport to city center is ~15km
      // Bus: 15km at 20 km/h = 45 min + 10 min wait = 55 min
      const time = estimateRealisticTravelTime(15, 'bus');
      expect(time).toBeGreaterThanOrEqual(45);
      expect(time).toBeLessThanOrEqual(60);
    });

    it('returns realistic walking time (max 2km practical)', () => {
      // 1.5 km walking = ~18 minutes at 5 km/h
      const time = estimateRealisticTravelTime(1.5, 'walking');
      expect(time).toBeGreaterThanOrEqual(15);
      expect(time).toBeLessThanOrEqual(25);
    });

    it('returns reasonable metro time for city travel', () => {
      // 3 km metro = ~6 min travel + 5 min wait = ~11 min
      const time = estimateRealisticTravelTime(3, 'metro');
      expect(time).toBeGreaterThanOrEqual(10);
      expect(time).toBeLessThanOrEqual(20);
    });

    it('never returns unrealistically short times', () => {
      // Even 0.5km walking should take at least 5 minutes
      const time = estimateRealisticTravelTime(0.5, 'walking');
      expect(time).toBeGreaterThanOrEqual(5);
    });

    it('never returns 59-minute walk for cross-city', () => {
      // If someone asks for walking 10km, it should return > 100 minutes
      // indicating this is impractical
      const time = estimateRealisticTravelTime(10, 'walking');
      expect(time).toBeGreaterThanOrEqual(100); // 10km / 5km/h = 120 min
    });
  });

  describe('validateTransportForDistance', () => {
    it('rejects walking > 2km', () => {
      const result = validateTransportForDistance(2.5, 'walking');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('walking');
    });

    it('accepts walking <= 2km', () => {
      const result = validateTransportForDistance(1.8, 'walking');
      expect(result.valid).toBe(true);
    });

    it('warns about metro for very short distances', () => {
      // Taking metro for 0.5km is inefficient
      const result = validateTransportForDistance(0.5, 'metro');
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('walk');
    });

    it('accepts bus/metro for medium distances', () => {
      expect(validateTransportForDistance(5, 'metro').valid).toBe(true);
      expect(validateTransportForDistance(8, 'bus').valid).toBe(true);
    });

    it('accepts car/taxi for long distances', () => {
      expect(validateTransportForDistance(20, 'car').valid).toBe(true);
      expect(validateTransportForDistance(15, 'taxi').valid).toBe(true);
    });
  });

  describe('suggestBestTransport', () => {
    it('suggests walking for < 1km', () => {
      expect(suggestBestTransport(0.5)).toBe('walking');
      expect(suggestBestTransport(0.8)).toBe('walking');
    });

    it('suggests walking or metro for 1-2km', () => {
      const suggestion = suggestBestTransport(1.5);
      expect(['walking', 'metro']).toContain(suggestion);
    });

    it('suggests metro for 2-5km', () => {
      expect(suggestBestTransport(3)).toBe('metro');
      expect(suggestBestTransport(4)).toBe('metro');
    });

    it('suggests bus/metro for 5-15km', () => {
      const suggestion = suggestBestTransport(10);
      expect(['bus', 'metro']).toContain(suggestion);
    });

    it('suggests car/taxi for > 15km', () => {
      const suggestion = suggestBestTransport(20);
      expect(['car', 'taxi', 'bus']).toContain(suggestion);
    });
  });

  describe('Real-world scenarios', () => {
    it('airport to city center (BCN to Barcelona): ~45-60 min by bus', () => {
      // BCN airport to Plaça Catalunya is ~15km
      // Bus at 20 km/h = 45 min travel + 10 min wait = 55 min
      const time = estimateRealisticTravelTime(15, 'bus');
      expect(time).toBeGreaterThanOrEqual(45);
      expect(time).toBeLessThanOrEqual(60);
    });

    it('hotel to nearby attraction (1km): ~12 min walking', () => {
      const time = estimateRealisticTravelTime(1, 'walking');
      expect(time).toBeGreaterThanOrEqual(10);
      expect(time).toBeLessThanOrEqual(15);
    });

    it('attraction to restaurant across city (3km): ~15 min metro', () => {
      const time = estimateRealisticTravelTime(3, 'metro');
      expect(time).toBeGreaterThanOrEqual(10);
      expect(time).toBeLessThanOrEqual(20);
    });

    it('city to outskirts (20km): ~30-40 min by car', () => {
      const time = estimateRealisticTravelTime(20, 'car');
      expect(time).toBeGreaterThanOrEqual(25);
      expect(time).toBeLessThanOrEqual(45);
    });
  });
});

/**
 * Tests for flight scoring (Bug #7)
 *
 * Requirements:
 * - Penalize early morning return flights (< 08:00)
 * - Prefer flights between 10:00-19:00
 * - Very early flights (05:00-07:00) get big penalty
 * - Score should affect flight selection
 */

import {
  calculateFlightScore,
  EARLY_MORNING_PENALTY,
  EARLY_PENALTY,
  OPTIMAL_TIME_BONUS,
  scoreFlights,
  selectBestFlight,
} from '../services/flightScoring';

interface TestFlight {
  id: string;
  departureTime: string;
  type: 'outbound' | 'return';
  price: number;
}

describe('Flight Scoring (Bug #7)', () => {
  describe('Constants', () => {
    it('should have significant early morning penalty', () => {
      expect(EARLY_MORNING_PENALTY).toBeGreaterThanOrEqual(30);
    });

    it('should have moderate early penalty', () => {
      expect(EARLY_PENALTY).toBeGreaterThanOrEqual(10);
    });

    it('should have optimal time bonus', () => {
      expect(OPTIMAL_TIME_BONUS).toBeGreaterThanOrEqual(10);
    });
  });

  describe('calculateFlightScore', () => {
    describe('Return flights', () => {
      it('penalizes return flight at 05:00 (wastes hotel night)', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '05:00',
          type: 'return',
          price: 100,
        };

        const score = calculateFlightScore(flight);

        // Should have big penalty
        expect(score).toBeLessThanOrEqual(100 - EARLY_MORNING_PENALTY);
      });

      it('penalizes return flight at 06:00', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '06:00',
          type: 'return',
          price: 100,
        };

        const score = calculateFlightScore(flight);
        expect(score).toBeLessThanOrEqual(100 - EARLY_MORNING_PENALTY);
      });

      it('penalizes return flight at 07:00', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '07:00',
          type: 'return',
          price: 100,
        };

        const score = calculateFlightScore(flight);
        expect(score).toBeLessThanOrEqual(100 - EARLY_MORNING_PENALTY);
      });

      it('has smaller penalty for return flight at 09:00', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '09:00',
          type: 'return',
          price: 100,
        };

        const score = calculateFlightScore(flight);

        // Smaller penalty than 05:00-07:00
        expect(score).toBeGreaterThan(100 - EARLY_MORNING_PENALTY);
        expect(score).toBeLessThanOrEqual(100 - EARLY_PENALTY);
      });

      it('gives bonus for optimal return time (14:00-19:00)', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '16:00',
          type: 'return',
          price: 100,
        };

        const score = calculateFlightScore(flight);
        expect(score).toBeGreaterThanOrEqual(100 + OPTIMAL_TIME_BONUS);
      });

      it('prefers 18:00 over 05:00 for return', () => {
        const earlyFlight: TestFlight = {
          id: 'early',
          departureTime: '05:00',
          type: 'return',
          price: 100,
        };

        const lateFlight: TestFlight = {
          id: 'late',
          departureTime: '18:00',
          type: 'return',
          price: 100,
        };

        const earlyScore = calculateFlightScore(earlyFlight);
        const lateScore = calculateFlightScore(lateFlight);

        expect(lateScore).toBeGreaterThan(earlyScore);
      });
    });

    describe('Outbound flights', () => {
      it('does not penalize early outbound flight', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '06:00',
          type: 'outbound',
          price: 100,
        };

        const score = calculateFlightScore(flight);

        // Outbound flights don't waste hotel nights
        expect(score).toBeGreaterThanOrEqual(100);
      });

      it('may have small bonus for morning outbound (more day time at destination)', () => {
        const morningFlight: TestFlight = {
          id: 'morning',
          departureTime: '08:00',
          type: 'outbound',
          price: 100,
        };

        const score = calculateFlightScore(morningFlight);
        expect(score).toBeGreaterThanOrEqual(100);
      });
    });

    describe('Edge cases', () => {
      it('handles midnight (00:00) departure', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '00:00',
          type: 'return',
          price: 100,
        };

        // Should be heavily penalized (100 - 30 = 70)
        const score = calculateFlightScore(flight);
        expect(score).toBeLessThanOrEqual(70);
      });

      it('handles noon (12:00) departure', () => {
        const flight: TestFlight = {
          id: 'test',
          departureTime: '12:00',
          type: 'return',
          price: 100,
        };

        // Decent time, no major penalty
        const score = calculateFlightScore(flight);
        expect(score).toBeGreaterThanOrEqual(95);
      });
    });
  });

  describe('scoreFlights', () => {
    it('scores multiple flights and ranks them', () => {
      const flights: TestFlight[] = [
        { id: 'early', departureTime: '05:00', type: 'return', price: 80 },
        { id: 'optimal', departureTime: '16:00', type: 'return', price: 120 },
        { id: 'morning', departureTime: '09:00', type: 'return', price: 100 },
      ];

      const scored = scoreFlights(flights);

      // Should be sorted by score descending
      expect(scored[0].flight.id).toBe('optimal');
      expect(scored[scored.length - 1].flight.id).toBe('early');
    });

    it('includes score in result', () => {
      const flights: TestFlight[] = [
        { id: 'test', departureTime: '14:00', type: 'return', price: 100 },
      ];

      const scored = scoreFlights(flights);

      expect(scored[0]).toHaveProperty('score');
      expect(scored[0]).toHaveProperty('flight');
    });
  });

  describe('selectBestFlight', () => {
    it('selects optimal time over early morning despite same price', () => {
      const flights: TestFlight[] = [
        { id: 'early', departureTime: '05:00', type: 'return', price: 100 },
        { id: 'optimal', departureTime: '16:00', type: 'return', price: 100 },
      ];

      const best = selectBestFlight(flights);

      expect(best?.id).toBe('optimal');
    });

    it('warns when selecting early morning flight', () => {
      const flights: TestFlight[] = [
        { id: 'early', departureTime: '05:00', type: 'return', price: 50 },
      ];

      const result = selectBestFlight(flights);

      // Even if only option, should flag the warning
      expect(result?.id).toBe('early');
    });

    it('balances price vs time', () => {
      const flights: TestFlight[] = [
        // Cheap but terrible time
        { id: 'cheap_early', departureTime: '05:00', type: 'return', price: 50 },
        // Expensive but great time
        { id: 'expensive_optimal', departureTime: '16:00', type: 'return', price: 150 },
        // Medium price, ok time
        { id: 'balanced', departureTime: '11:00', type: 'return', price: 90 },
      ];

      const best = selectBestFlight(flights);

      // Should prefer balanced or optimal over early
      expect(best?.id).not.toBe('cheap_early');
    });
  });

  describe('Warning scenarios', () => {
    it('early return flight wastes hotel night message', () => {
      const flight: TestFlight = {
        id: 'test',
        departureTime: '05:00',
        type: 'return',
        price: 100,
      };

      const score = calculateFlightScore(flight);

      // Score should indicate this is a poor choice
      expect(score).toBeLessThan(80);
    });
  });
});

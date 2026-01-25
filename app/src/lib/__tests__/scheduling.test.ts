/**
 * Tests for scheduling utilities (Bug #6)
 *
 * Requirements:
 * - Only round hours allowed: 08:00, 09:00, 10:00, ..., 22:00
 * - No 19h12 or 20h42 times
 * - Respect restaurant opening hours
 * - Meal times should align with typical meal periods
 */

import {
  AVAILABLE_HOURS,
  roundToNearestHour,
  roundTimeToHour,
  generateAvailableHours,
  selectMealTime,
  isValidScheduleHour,
} from '../services/scheduling';

describe('Scheduling Utilities (Bug #6)', () => {
  describe('AVAILABLE_HOURS constant', () => {
    it('should contain hours from 8 to 22', () => {
      expect(AVAILABLE_HOURS).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    });

    it('should not contain early morning hours (before 8)', () => {
      expect(AVAILABLE_HOURS).not.toContain(7);
      expect(AVAILABLE_HOURS).not.toContain(6);
      expect(AVAILABLE_HOURS).not.toContain(5);
    });

    it('should not contain late night hours (after 22)', () => {
      expect(AVAILABLE_HOURS).not.toContain(23);
      expect(AVAILABLE_HOURS).not.toContain(0);
      expect(AVAILABLE_HOURS).not.toContain(1);
    });
  });

  describe('isValidScheduleHour', () => {
    it('returns true for valid hours (8-22)', () => {
      expect(isValidScheduleHour(8)).toBe(true);
      expect(isValidScheduleHour(12)).toBe(true);
      expect(isValidScheduleHour(19)).toBe(true);
      expect(isValidScheduleHour(22)).toBe(true);
    });

    it('returns false for invalid hours', () => {
      expect(isValidScheduleHour(7)).toBe(false);
      expect(isValidScheduleHour(23)).toBe(false);
      expect(isValidScheduleHour(0)).toBe(false);
      expect(isValidScheduleHour(5)).toBe(false);
    });
  });

  describe('roundToNearestHour', () => {
    it('rounds down when minutes < 30', () => {
      const date = new Date('2025-03-15T14:15:00');
      const rounded = roundToNearestHour(date);

      expect(rounded.getHours()).toBe(14);
      expect(rounded.getMinutes()).toBe(0);
      expect(rounded.getSeconds()).toBe(0);
    });

    it('rounds up when minutes >= 30', () => {
      const date = new Date('2025-03-15T14:35:00');
      const rounded = roundToNearestHour(date);

      expect(rounded.getHours()).toBe(15);
      expect(rounded.getMinutes()).toBe(0);
      expect(rounded.getSeconds()).toBe(0);
    });

    it('rounds up at exactly 30 minutes', () => {
      const date = new Date('2025-03-15T14:30:00');
      const rounded = roundToNearestHour(date);

      expect(rounded.getHours()).toBe(15);
      expect(rounded.getMinutes()).toBe(0);
    });

    it('keeps hour when minutes = 0', () => {
      const date = new Date('2025-03-15T14:00:00');
      const rounded = roundToNearestHour(date);

      expect(rounded.getHours()).toBe(14);
      expect(rounded.getMinutes()).toBe(0);
    });

    it('handles midnight edge case', () => {
      const date = new Date('2025-03-15T23:45:00');
      const rounded = roundToNearestHour(date);

      // Should round up to midnight (next day)
      expect(rounded.getHours()).toBe(0);
      expect(rounded.getDate()).toBe(16);
    });

    it('does not modify the original date', () => {
      const date = new Date('2025-03-15T14:15:00');
      const originalTime = date.getTime();
      roundToNearestHour(date);

      expect(date.getTime()).toBe(originalTime);
    });
  });

  describe('roundTimeToHour', () => {
    it('rounds "19:12" to "19:00"', () => {
      expect(roundTimeToHour('19:12')).toBe('19:00');
    });

    it('rounds "20:42" to "21:00"', () => {
      expect(roundTimeToHour('20:42')).toBe('21:00');
    });

    it('keeps "14:00" as "14:00"', () => {
      expect(roundTimeToHour('14:00')).toBe('14:00');
    });

    it('rounds "08:15" to "08:00"', () => {
      expect(roundTimeToHour('08:15')).toBe('08:00');
    });

    it('rounds "08:45" to "09:00"', () => {
      expect(roundTimeToHour('08:45')).toBe('09:00');
    });

    it('handles "00:30" edge case', () => {
      expect(roundTimeToHour('00:30')).toBe('01:00');
    });
  });

  describe('generateAvailableHours', () => {
    it('returns hours within restaurant opening hours', () => {
      const restaurant = {
        opens: '11:30',
        closes: '23:00',
      };

      const available = generateAvailableHours(restaurant);

      // First available hour should be 12:00 (first hour >= 11:30)
      expect(available[0]).toBe(12);
      // Should include hours up to 22:00 (last full hour before 23:00)
      expect(available).toContain(22);
      // Should not include 11 (too early)
      expect(available).not.toContain(11);
    });

    it('respects early closing time', () => {
      const restaurant = {
        opens: '08:00',
        closes: '17:00',
      };

      const available = generateAvailableHours(restaurant);

      // Should include 8 and 16
      expect(available).toContain(8);
      expect(available).toContain(16);
      // Should not include 17, 18, 19+ (closed)
      expect(available).not.toContain(17);
      expect(available).not.toContain(18);
      expect(available).not.toContain(19);
    });

    it('handles breakfast restaurant (early open)', () => {
      const restaurant = {
        opens: '07:00',
        closes: '11:30',
      };

      const available = generateAvailableHours(restaurant);

      // Should start at 8 (first available hour, even though opens at 7)
      expect(available[0]).toBe(8);
      // Should not include 12 (closes at 11:30)
      expect(available).not.toContain(12);
      // Should include 8, 9, 10, 11
      expect(available).toContain(8);
      expect(available).toContain(11);
    });

    it('handles late night restaurant', () => {
      const restaurant = {
        opens: '18:00',
        closes: '02:00', // Next day
      };

      const available = generateAvailableHours(restaurant);

      // Should include evening hours
      expect(available).toContain(18);
      expect(available).toContain(22);
      // Should not include lunch hours
      expect(available).not.toContain(12);
    });
  });

  describe('selectMealTime', () => {
    const standardRestaurant = {
      opens: '08:00',
      closes: '23:00',
    };

    it('selects 8:00 for breakfast', () => {
      const time = selectMealTime(standardRestaurant, 'breakfast');
      expect(time).toBe(8);
    });

    it('selects 12:00 for lunch', () => {
      const time = selectMealTime(standardRestaurant, 'lunch');
      expect(time).toBe(12);
    });

    it('selects 19:00 for dinner', () => {
      const time = selectMealTime(standardRestaurant, 'dinner');
      expect(time).toBe(19);
    });

    it('picks next available hour if preferred time not available', () => {
      const earlyClosingRestaurant = {
        opens: '08:00',
        closes: '17:00', // Closes at 5pm
      };

      // Dinner at 19:00 not available, should pick closest available
      const time = selectMealTime(earlyClosingRestaurant, 'dinner');
      expect(time).toBeLessThanOrEqual(16); // Should be 16 or earlier
      expect(time).toBeGreaterThanOrEqual(8);
    });

    it('picks nearest available for late-opening restaurant', () => {
      const lateOpeningRestaurant = {
        opens: '11:30',
        closes: '23:00',
      };

      // Breakfast at 8:00 not available
      const breakfastTime = selectMealTime(lateOpeningRestaurant, 'breakfast');
      expect(breakfastTime).toBe(12); // First available hour

      // Lunch at 12:00 should work
      const lunchTime = selectMealTime(lateOpeningRestaurant, 'lunch');
      expect(lunchTime).toBe(12);
    });
  });

  describe('Integration: No non-round hours', () => {
    it('all generated times should be round hours', () => {
      // This is more of an integration test to ensure the system
      // never produces times like 19:12 or 20:42

      const times = [
        roundTimeToHour('19:12'),
        roundTimeToHour('20:42'),
        roundTimeToHour('08:15'),
        roundTimeToHour('14:59'),
      ];

      // All times should end with :00
      times.forEach(time => {
        expect(time).toMatch(/:00$/);
      });
    });
  });
});

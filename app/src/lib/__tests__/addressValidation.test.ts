/**
 * Tests for address validation in itineraries (Bug #4)
 *
 * Requirements:
 * - Activities MUST have exact addresses (not just "Barcelona")
 * - Itineraries should display full addresses
 * - Addresses should include street name and number
 */

import {
  validateActivityAddress,
  formatActivityWithAddress,
  isValidAddress,
  extractAddressComponents,
  MIN_ADDRESS_LENGTH,
} from '../services/addressValidator';

describe('Address Validation (Bug #4)', () => {
  describe('MIN_ADDRESS_LENGTH constant', () => {
    it('should require at least 5 characters for valid address', () => {
      expect(MIN_ADDRESS_LENGTH).toBe(5);
    });
  });

  describe('isValidAddress', () => {
    it('returns true for valid street address', () => {
      expect(isValidAddress('Montcada 15-23, Barcelona')).toBe(true);
      expect(isValidAddress('Blai 25, Barcelona')).toBe(true);
      expect(isValidAddress('La Rambla 1, Barcelona')).toBe(true);
    });

    it('returns false for generic location', () => {
      expect(isValidAddress('Barcelona')).toBe(false);
      expect(isValidAddress('City Center')).toBe(false);
      expect(isValidAddress('')).toBe(false);
    });

    it('returns false for address too short', () => {
      expect(isValidAddress('ABC')).toBe(false);
      expect(isValidAddress('1234')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isValidAddress(null as unknown as string)).toBe(false);
      expect(isValidAddress(undefined as unknown as string)).toBe(false);
    });

    it('returns true for address with special characters', () => {
      expect(isValidAddress("Passeig de Gràcia, 43")).toBe(true);
      expect(isValidAddress("Carrer d'Aragó 255")).toBe(true);
    });
  });

  describe('validateActivityAddress', () => {
    it('passes for activity with valid address', () => {
      const activity = {
        name: 'Museu Picasso',
        address: 'Carrer de Montcada 15-23, Barcelona',
        city: 'Barcelona',
      };

      const result = validateActivityAddress(activity);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('fails for activity with missing address', () => {
      const activity = {
        name: 'Sagrada Familia',
        city: 'Barcelona',
      };

      const result = validateActivityAddress(activity as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('address');
    });

    it('fails for activity with generic address', () => {
      const activity = {
        name: 'Museum',
        address: 'Barcelona',
        city: 'Barcelona',
      };

      const result = validateActivityAddress(activity);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('exact');
    });

    it('fails for activity with "Centre-ville" address', () => {
      const activity = {
        name: 'Restaurant',
        address: 'Centre-ville, Barcelona',
        city: 'Barcelona',
      };

      const result = validateActivityAddress(activity);

      expect(result.valid).toBe(false);
    });

    it('includes activity name in error message', () => {
      const activity = {
        name: 'Park Güell',
        address: '',
        city: 'Barcelona',
      };

      const result = validateActivityAddress(activity);

      expect(result.error).toContain('Park Güell');
    });
  });

  describe('formatActivityWithAddress', () => {
    it('formats activity with address in parentheses', () => {
      const activity = {
        name: 'Museu Picasso',
        address: 'Carrer de Montcada 15-23, Barcelona',
      };

      const formatted = formatActivityWithAddress(activity);

      expect(formatted).toBe('Museu Picasso (Carrer de Montcada 15-23, Barcelona)');
    });

    it('returns just name if address missing', () => {
      const activity = {
        name: 'Sagrada Familia',
      };

      const formatted = formatActivityWithAddress(activity as any);

      expect(formatted).toBe('Sagrada Familia');
    });

    it('handles empty address gracefully', () => {
      const activity = {
        name: 'Restaurant',
        address: '',
      };

      const formatted = formatActivityWithAddress(activity);

      expect(formatted).toBe('Restaurant');
    });
  });

  describe('extractAddressComponents', () => {
    it('extracts street name and number', () => {
      const result = extractAddressComponents('Carrer de Montcada 15-23, Barcelona');

      expect(result.street).toBe('Carrer de Montcada');
      expect(result.number).toBe('15-23');
      expect(result.city).toBe('Barcelona');
    });

    it('handles address without number', () => {
      const result = extractAddressComponents('La Rambla, Barcelona');

      expect(result.street).toBe('La Rambla');
      expect(result.number).toBeUndefined();
      expect(result.city).toBe('Barcelona');
    });

    it('handles address with comma-separated parts', () => {
      const result = extractAddressComponents('Blai 25, Poble Sec, Barcelona');

      expect(result.street).toBe('Blai');
      expect(result.number).toBe('25');
      expect(result.city).toContain('Barcelona');
    });

    it('returns empty for invalid address', () => {
      const result = extractAddressComponents('');

      expect(result.street).toBe('');
      expect(result.number).toBeUndefined();
      expect(result.city).toBeUndefined();
    });
  });

  describe('Itinerary display format', () => {
    it('should display full addresses in itinerary text', () => {
      const from = {
        name: 'Museu Picasso',
        address: 'Montcada 15-23, Barcelona',
      };

      const to = {
        name: 'Quimet & Quimet',
        address: 'Blai 25, Barcelona',
      };

      const fromFormatted = formatActivityWithAddress(from);
      const toFormatted = formatActivityWithAddress(to);

      const itineraryText = `${fromFormatted} → ${toFormatted}`;

      expect(itineraryText).toContain('Museu Picasso (Montcada 15-23, Barcelona)');
      expect(itineraryText).toContain('Quimet & Quimet (Blai 25, Barcelona)');
      expect(itineraryText).toContain('→');
    });

    it('should not show generic addresses', () => {
      const activity = {
        name: 'Museum',
        address: 'Barcelona',
      };

      // Even if we format it, validation should fail
      const validation = validateActivityAddress({ ...activity, city: 'Barcelona' });
      expect(validation.valid).toBe(false);
    });
  });
});

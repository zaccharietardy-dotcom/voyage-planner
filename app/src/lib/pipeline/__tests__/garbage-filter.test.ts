import { isGarbageActivity, NON_POI_NAME_PATTERN, GARBAGE_DESC_PATTERN } from '../utils/garbage-filter';

describe('garbage-filter', () => {
  describe('NON_POI_NAME_PATTERN', () => {
    it.each([
      'mètre', 'metre', 'Kilogram', 'gramme', 'grammes', 'seconde', 'secondes',
      'litre', 'watt', 'volt', 'ampère', 'newton',
      'pascal', 'joule', 'hertz', 'kelvin', 'mole', 'candela',
      'euro', 'dollar', 'franc', 'pound', 'yen', 'bitcoin',
    ])('matches non-POI name "%s"', (name) => {
      expect(NON_POI_NAME_PATTERN.test(name)).toBe(true);
    });

    it.each([
      'Louvre', "Musée d'Orsay", 'Tour Eiffel', 'Brasserie Lipp',
      'Versailles', 'Notre-Dame', 'Sacré-Cœur',
    ])('does NOT match real place "%s"', (name) => {
      expect(NON_POI_NAME_PATTERN.test(name)).toBe(false);
    });
  });

  describe('GARBAGE_DESC_PATTERN', () => {
    it('matches measurement unit descriptions', () => {
      expect(GARBAGE_DESC_PATTERN.test('Unité de mesure du SI')).toBe(true);
      expect(GARBAGE_DESC_PATTERN.test('système international')).toBe(true);
      expect(GARBAGE_DESC_PATTERN.test('A standard measurement unit')).toBe(true);
    });

    it('does NOT match real descriptions', () => {
      expect(GARBAGE_DESC_PATTERN.test('Beautiful cathedral in Paris')).toBe(false);
    });
  });

  describe('isGarbageActivity', () => {
    it('returns true for measurement units', () => {
      expect(isGarbageActivity({ name: 'mètre' })).toBe(true);
      expect(isGarbageActivity({ name: 'euro' })).toBe(true);
      expect(isGarbageActivity({ name: 'bitcoin' })).toBe(true);
    });

    it('returns true for garbage descriptions', () => {
      expect(isGarbageActivity({ name: 'Some Item', description: 'unité de mesure' })).toBe(true);
    });

    it('returns false for real places', () => {
      expect(isGarbageActivity({ name: 'Louvre' })).toBe(false);
      expect(isGarbageActivity({ name: "Musée d'Orsay" })).toBe(false);
    });

    it('returns false for mustSee items even with non-POI name', () => {
      expect(isGarbageActivity({ name: 'mètre', mustSee: true })).toBe(false);
    });

    it('returns true for mustSee with garbage description (desc is always rejected)', () => {
      expect(isGarbageActivity({ name: 'Test', description: 'unité de mesure', mustSee: true })).toBe(true);
    });
  });
});

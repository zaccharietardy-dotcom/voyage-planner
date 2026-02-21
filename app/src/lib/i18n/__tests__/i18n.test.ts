import { translations, type Locale, type TranslationKey } from '../translations';

describe('i18n translations', () => {
  it('should have matching keys between fr and en', () => {
    const frKeys = Object.keys(translations.fr);
    const enKeys = Object.keys(translations.en);

    expect(frKeys.sort()).toEqual(enKeys.sort());
  });

  it('should have no empty translations', () => {
    const locales: Locale[] = ['fr', 'en'];

    locales.forEach((locale) => {
      const keys = Object.keys(translations[locale]) as TranslationKey[];

      keys.forEach((key) => {
        const value = translations[locale][key];
        expect(value).toBeTruthy();
        expect(typeof value).toBe('string');
        expect(value.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('should have valid parameter placeholders', () => {
    const locales: Locale[] = ['fr', 'en'];

    locales.forEach((locale) => {
      const keys = Object.keys(translations[locale]) as TranslationKey[];

      keys.forEach((key) => {
        const value = translations[locale][key];
        const matches = value.match(/\{(\w+)\}/g);

        if (matches) {
          // Check that placeholders have valid names
          matches.forEach((match) => {
            expect(match).toMatch(/^\{\w+\}$/);
          });
        }
      });
    });
  });

  it('should have consistent parameters between locales', () => {
    const frKeys = Object.keys(translations.fr) as TranslationKey[];

    frKeys.forEach((key) => {
      const frValue = translations.fr[key];
      const enValue = translations.en[key];

      const frParams = (frValue.match(/\{(\w+)\}/g) || []).sort();
      const enParams = (enValue.match(/\{(\w+)\}/g) || []).sort();

      expect(frParams).toEqual(enParams);
    });
  });

  it('should handle dayN parameter correctly', () => {
    const frTemplate = translations.fr['trip.dayN'];
    const enTemplate = translations.en['trip.dayN'];

    expect(frTemplate).toBe('Jour {n}');
    expect(enTemplate).toBe('Day {n}');

    // Simulate what the t() function does
    const frResult = frTemplate.replace('{n}', '3');
    const enResult = enTemplate.replace('{n}', '3');

    expect(frResult).toBe('Jour 3');
    expect(enResult).toBe('Day 3');
  });

  it('should have all common translations', () => {
    const commonKeys = [
      'common.loading',
      'common.save',
      'common.cancel',
      'common.delete',
      'common.edit',
      'common.share',
    ];

    commonKeys.forEach((key) => {
      expect(translations.fr[key as TranslationKey]).toBeTruthy();
      expect(translations.en[key as TranslationKey]).toBeTruthy();
    });
  });

  it('should have all navigation translations', () => {
    const navKeys = [
      'nav.home',
      'nav.myTrips',
      'nav.plan',
      'nav.profile',
      'nav.login',
      'nav.logout',
    ];

    navKeys.forEach((key) => {
      expect(translations.fr[key as TranslationKey]).toBeTruthy();
      expect(translations.en[key as TranslationKey]).toBeTruthy();
    });
  });
});

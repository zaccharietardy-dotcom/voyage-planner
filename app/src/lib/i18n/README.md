# i18n System

Lightweight internationalization system for the Voyage Planner app.

## Overview

- **Current languages**: French (fr), English (en)
- **Default language**: French
- **Storage**: localStorage (`voyage-locale` key)
- **Auto-detection**: Browser language on first visit

## Usage

### In Client Components

```tsx
'use client';

import { useTranslation } from '@/lib/i18n';

export function MyComponent() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <div>
      <h1>{t('plan.title')}</h1>
      <p>{t('trip.dayN', { n: 3 })}</p> {/* Day 3 / Jour 3 */}
    </div>
  );
}
```

### Parameter Interpolation

Use `{paramName}` in translation strings:

```typescript
// translations.ts
'trip.dayN': 'Jour {n}',  // French
'trip.dayN': 'Day {n}',   // English

// Component
t('trip.dayN', { n: 5 }) // → "Jour 5" or "Day 5"
```

## Adding New Translations

1. Add keys to both `fr` and `en` sections in `translations.ts`
2. Use TypeScript autocomplete for key names
3. Keep keys organized by feature/section

```typescript
export const translations = {
  fr: {
    'myFeature.title': 'Mon titre',
    'myFeature.button': 'Cliquez ici',
  },
  en: {
    'myFeature.title': 'My Title',
    'myFeature.button': 'Click here',
  },
};
```

## Components

- **`<I18nProvider>`**: Context provider (already in `layout.tsx`)
- **`<LanguageSwitcher>`**: Language selector dropdown (in Header)
- **`useI18n()` / `useTranslation()`**: Hook for translations

## Files

- `lib/i18n/translations.ts` — Translation strings
- `lib/i18n/context.tsx` — React context & hooks
- `lib/i18n/index.ts` — Public exports
- `components/LanguageSwitcher.tsx` — UI component

## Migration Guide

To migrate existing French strings to i18n:

1. Add translation keys to `translations.ts`
2. Replace hardcoded strings with `t('key')`
3. Add `'use client'` if not already present
4. Import `useTranslation` hook

```diff
- <h1>Planifier votre voyage</h1>
+ const { t } = useTranslation();
+ <h1>{t('plan.title')}</h1>
```

## Future Extensions

- More languages (es, de, it, etc.)
- Date/number formatting per locale
- Pluralization rules
- RTL support (ar, he)

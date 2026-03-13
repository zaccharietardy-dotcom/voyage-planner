# i18n Migration Guide

This guide shows how to migrate existing French-only components to use the new i18n system.

## Quick Start

The i18n system is now fully set up and ready to use:

- Context provider is in `app/layout.tsx`
- Language switcher is in the Header (top-right, next to theme toggle)
- Core translations are in `lib/i18n/translations.ts`

## Migration Steps

### 1. Add 'use client' directive

If the component doesn't already have it:

```tsx
'use client';

import { useTranslation } from '@/lib/i18n';
```

### 2. Use the translation hook

```tsx
export function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('plan.title')}</h1>
    </div>
  );
}
```

### 3. Add missing translations

If you need new keys, add them to both `fr` and `en` sections in `lib/i18n/translations.ts`:

```typescript
export const translations = {
  fr: {
    // ... existing keys
    'myFeature.title': 'Mon nouveau titre',
  },
  en: {
    // ... existing keys
    'myFeature.title': 'My New Title',
  },
};
```

## Examples

### Before (French-only)

```tsx
export function TripCard() {
  return (
    <div>
      <h2>Mon voyage</h2>
      <button>Modifier</button>
      <button>Partager</button>
    </div>
  );
}
```

### After (i18n)

```tsx
'use client';

import { useTranslation } from '@/lib/i18n';

export function TripCard() {
  const { t } = useTranslation();

  return (
    <div>
      <h2>{t('myTrips.title')}</h2>
      <button>{t('common.edit')}</button>
      <button>{t('common.share')}</button>
    </div>
  );
}
```

### With Parameters

```tsx
// Before
<p>Jour 3 de votre voyage</p>

// After
const { t } = useTranslation();
<p>{t('trip.dayN', { n: 3 })}</p>
```

## Priority Components to Migrate

Suggested order (most visible first):

1. **Navigation** (`components/layout/Header.tsx`)
   - Already using hardcoded French strings in `navLinks`
   - High visibility

2. **Plan Wizard** (`app/plan/page.tsx`)
   - Main user entry point
   - Form labels and buttons

3. **Trip View** (`app/trip/[id]/page.tsx`)
   - Calendar, map, budget sections
   - Activity cards

4. **My Trips** (`app/mes-voyages/page.tsx`)
   - Trip list
   - Empty state

5. **Landing Page** (`app/page.tsx`, `components/landing/*`)
   - Hero section
   - Features, testimonials

## Available Translation Keys

Check `lib/i18n/translations.ts` for the full list. Current categories:

- `nav.*` — Navigation items
- `common.*` — Buttons, actions, status messages
- `plan.*` — Trip planning wizard
- `trip.*` — Trip view and itinerary
- `myTrips.*` — Trip list page
- `share.*` — Sharing options
- `generating.*` — Generation screen

## Testing

### Visual Test

1. Start dev server: `npm run dev`
2. Open app in browser
3. Use language switcher in header (flag icon)
4. Switch between French and English
5. Verify all migrated strings change language

### TypeScript Check

```bash
npx tsc --noEmit
```

Should pass with no errors.

### Build Test

```bash
npm run build
```

Should complete successfully.

## Example Component

See `components/examples/I18nExample.tsx` for a complete working example with:

- Hook usage
- Parameter interpolation
- Manual locale switching
- Common patterns

## Notes

- **Server Components**: The i18n system uses React Context, so it only works in Client Components ('use client')
- **Type Safety**: TypeScript will autocomplete translation keys and catch typos
- **Fallback**: English translations always fall back to French if a key is missing
- **Persistence**: Selected language is saved to localStorage (`voyage-locale`)
- **Detection**: First visit detects browser language (English or French)

## Adding New Languages

To add Spanish, German, etc.:

1. Add locale to `translations.ts`:
   ```typescript
   export const translations = {
     fr: { /* ... */ },
     en: { /* ... */ },
     es: { /* ... NEW */ },
   };
   ```

2. Update `LOCALES` array in `components/LanguageSwitcher.tsx`:
   ```typescript
   const LOCALES = [
     { value: 'fr', label: 'Français', flag: '🇫🇷' },
     { value: 'en', label: 'English', flag: '🇬🇧' },
     { value: 'es', label: 'Español', flag: '🇪🇸' },
   ];
   ```

3. Update detection logic in `lib/i18n/context.tsx` if needed

## Questions?

Check `lib/i18n/README.md` for detailed documentation.

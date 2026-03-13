# i18n Quick Reference Card

## Import

```tsx
import { useTranslation } from '@/lib/i18n';
```

## Basic Usage

```tsx
const { t } = useTranslation();

<h1>{t('plan.title')}</h1>
```

## With Parameters

```tsx
<p>{t('trip.dayN', { n: 3 })}</p>
```

## Locale Control

```tsx
const { locale, setLocale } = useTranslation();

// Current language
console.log(locale); // 'fr' or 'en'

// Switch language
setLocale('en');
```

## Available Keys

### Navigation
- `nav.home` — Accueil / Home
- `nav.myTrips` — Mes voyages / My Trips
- `nav.plan` — Planifier un voyage / Plan a Trip
- `nav.profile` — Profil / Profile
- `nav.login` — Se connecter / Sign In
- `nav.logout` — Se déconnecter / Sign Out

### Common Actions
- `common.save` — Enregistrer / Save
- `common.cancel` — Annuler / Cancel
- `common.delete` — Supprimer / Delete
- `common.edit` — Modifier / Edit
- `common.share` — Partager / Share
- `common.back` — Retour / Back
- `common.next` — Suivant / Next
- `common.previous` — Précédent / Previous
- `common.close` — Fermer / Close
- `common.confirm` — Confirmer / Confirm
- `common.search` — Rechercher / Search
- `common.download` — Télécharger / Download
- `common.copy` — Copier / Copy
- `common.copied` — Copié ! / Copied!

### Common States
- `common.loading` — Chargement... / Loading...
- `common.error` — Erreur / Error
- `common.success` — Succès / Success

### Units
- `common.day` — jour / day
- `common.days` — jours / days
- `common.persons` — pers. / pers.

### Plan Form
- `plan.title` — Planifier votre voyage / Plan Your Trip
- `plan.subtitle` — Créez votre itinéraire... / Create your personalized...
- `plan.origin` — Ville de départ / Departure City
- `plan.destination` — Destination / Destination
- `plan.startDate` — Date de départ / Start Date
- `plan.duration` — Durée / Duration
- `plan.travelers` — Voyageurs / Travelers
- `plan.budget` — Budget / Budget
- `plan.generate` — Générer mon voyage / Generate My Trip
- `plan.generating` — Génération en cours... / Generating...

### Budget Levels
- `plan.budgetLevels.budget` — Économique / Budget
- `plan.budgetLevels.moderate` — Modéré / Moderate
- `plan.budgetLevels.comfort` — Confort / Comfort
- `plan.budgetLevels.luxury` — Luxe / Luxury

### Trip View
- `trip.itinerary` — Itinéraire / Itinerary
- `trip.map` — Carte / Map
- `trip.budget` — Budget / Budget
- `trip.overview` — Aperçu / Overview
- `trip.photos` — Photos / Photos
- `trip.comments` — Commentaires / Comments
- `trip.tips` — Conseils / Tips
- `trip.expenses` — Dépenses / Expenses
- `trip.exportPdf` — Exporter en PDF / Export as PDF
- `trip.dayN` — Jour {n} / Day {n} *(requires parameter)*

### My Trips
- `myTrips.title` — Mes voyages / My Trips
- `myTrips.subtitle` — Retrouvez tous vos voyages... / Find all your planned...
- `myTrips.empty` — Aucun voyage / No trips yet
- `myTrips.emptyDesc` — Vous n'avez pas encore... / You haven't planned...
- `myTrips.newTrip` — Nouveau voyage / New Trip
- `myTrips.planFirst` — Planifier mon premier voyage / Plan my first trip
- `myTrips.pastTrip` — Voyage passé / Past Trip
- `myTrips.offlineNotice` — Mode hors ligne... / Offline mode...

### Share
- `share.title` — Partager le voyage / Share Trip
- `share.subtitle` — Invitez vos amis... / Invite friends...
- `share.whatsapp` — WhatsApp / WhatsApp
- `share.email` — Email / Email
- `share.twitter` — Twitter/X / Twitter/X
- `share.facebook` — Facebook / Facebook
- `share.copyLink` — Copier le lien / Copy Link
- `share.createLink` — Créer le lien de partage / Create Share Link
- `share.readOnlyLink` — Lien lecture seule / Read-only Link
- `share.qrCode` — QR Code / QR Code

### Generating Screen
- `generating.title` — Votre voyage prend forme... / Your trip is taking shape...
- `generating.funFact` — Le saviez-vous ? / Did you know?

## Adding New Keys

1. Edit `/Users/zak/voyage-planner/app/src/lib/i18n/translations.ts`
2. Add to both `fr` and `en` sections
3. Use TypeScript autocomplete in your component

```typescript
export const translations = {
  fr: {
    'myFeature.title': 'Mon titre',
  },
  en: {
    'myFeature.title': 'My Title',
  },
};
```

## Component Requirements

Must be a **Client Component**:

```tsx
'use client';  // Required!

import { useTranslation } from '@/lib/i18n';
```

## Common Patterns

### Button

```tsx
<Button>{t('common.save')}</Button>
```

### Heading

```tsx
<h1>{t('plan.title')}</h1>
```

### With Dynamic Content

```tsx
<Badge>{t('trip.dayN', { n: dayNumber })}</Badge>
```

### Conditional Text

```tsx
{trips.length === 0 ? t('myTrips.empty') : t('myTrips.title')}
```

## Full Documentation

- Setup Summary: `/Users/zak/voyage-planner/app/I18N_SETUP_SUMMARY.md`
- Migration Guide: `/Users/zak/voyage-planner/app/MIGRATION_I18N.md`
- Developer Docs: `/Users/zak/voyage-planner/app/src/lib/i18n/README.md`
- Example Component: `/Users/zak/voyage-planner/app/src/components/examples/I18nExample.tsx`

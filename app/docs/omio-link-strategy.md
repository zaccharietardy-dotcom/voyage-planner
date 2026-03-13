# Omio Link Strategy (Pipeline V2)

## Objectif
Fiabiliser les liens Omio générés par l'app sans dépendre d'une API Omio de recherche trajets.

## Important
- Nous **n'utilisons pas** d'API Omio pour récupérer les trajets.
- Nous générons des **deep links Omio**.
- Impact.com sert uniquement au **tracking affilié**, pas à la recherche transport.

## Format des liens utilisés
- Train: `https://www.omio.fr/trains/{originSlug}/{destSlug}?departure_date=YYYY-MM-DD`
- Bus: `https://www.omio.fr/bus/{originSlug}/{destSlug}?departure_date=YYYY-MM-DD`
- Vol: `https://www.omio.fr/vols/{originSlug}/{destSlug}?departure_date=YYYY-MM-DD`

## Règles de génération (robustesse)
1. Normalisation ville:
   - `normalizeCitySync(...)` pour utiliser un nom ville stable quand possible.
2. Fallback hub (cas suburbains):
   - Si l'origine/destination n'est pas une ville Omio robuste (ex: `Palaiseau`), on mappe vers un hub proche (ex: `Paris`) si distance <= 35 km.
3. Slugification:
   - `toOmioLocationSlug(...)` pour accents/apostrophes/ponctuation.

## Règles de retour
- Le lien retour doit inverser le sens (`destination -> origin`).
- On applique:
  - swap du path Omio (`/trains/a/b` devient `/trains/b/a`)
  - mise à jour de `departure_date` sur la date retour.

## Exemples validés
- Aller: `https://www.omio.fr/trains/paris/lausanne?departure_date=2026-02-20`
- Retour: `https://www.omio.fr/trains/lausanne/paris?departure_date=2026-02-22`

## UX locale (segments inter_item)
- Les trajets locaux (maison -> gare, hôtel -> gare) ne doivent pas avoir de `bookingUrl`.
- On expose un bouton **Itinéraire** (Google Maps), pas **Réserver**.

## Fichiers de référence
- Génération transport Omio: `src/lib/services/transport.ts`
- Normalisation/swap retour + assemblage: `src/lib/pipeline/step7-assemble.ts`
- UI boutons transport local vs longhaul: `src/components/trip/ActivityCard.tsx`
- Tracking affilié Impact: `src/lib/services/impactTracking.ts`

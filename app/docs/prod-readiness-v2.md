# Prod-Ready V2

Ce document formalise les gates minimales pour déclarer la plateforme prête à la production.

## Palier 1 — Web public

- `npx tsc --noEmit -p app/tsconfig.json`
- `npm --prefix app run lint -- --quiet`
- `npm --prefix app test -- --ci --runInBand --passWithNoTests`
- `npm --prefix app run build`
- `npx --prefix app playwright test e2e/smoke.spec.ts e2e/flows.spec.ts`

### Exigences produit

- Aucun CTA critique bloqué par une overlay globale.
- Les routes internes `/admin`, `/test-apis`, `/test-links`, `/test-trips` sont masquées par défaut et protégées côté serveur.
- Les scripts tiers facultatifs sont coupés par défaut et pilotés par flag.
- Les variables d’environnement publiques et serveur sont validées au runtime.
- L’observabilité minimale est active: Sentry client, `global-error`, `x-request-id`, endpoints `/api/health` et `/api/health/ping`.

## Palier 2 — Native beta

- `npm --prefix narae-mobile run lint`
- `npm --prefix narae-mobile test`
- `npm --prefix narae-mobile run typecheck`
- `npm --prefix narae-mobile run doctor`
- CI `native-beta.yml` verte
- `eas.json` configuré pour `development`, `preview`, `production`
- Secrets Expo/Supabase renseignés en environnement CI et EAS

### Exigences produit

- `narae-mobile` est la seule base native ciblée.
- Les flags publics existent pour couper `social`, `premium`, `experimental`, `external providers`.
- Les builds beta iOS/Android doivent être validés sur appareils réels avant toute ouverture store.

## Palier 3 — Stores publics

- Privacy policy et data disclosure finalisées
- Signatures et identifiants stores validés
- Deep links, achats/restauration et crash reporting testés en sandbox
- Release checklist revue avant soumission

## Contrat d’environnement partagé

### Web

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT`
- `NEXT_PUBLIC_ENABLE_FEEDBACK_WIDGET`
- `NEXT_PUBLIC_ENABLE_SOCIAL_FEATURES`
- `NEXT_PUBLIC_ENABLE_PREMIUM_BILLING`
- `NEXT_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES`
- `ADMIN_EMAILS`
- `NARAE_ENABLE_INTERNAL_TOOLS`
- `NARAE_ENABLE_EXTERNAL_PROVIDERS`

### Mobile

- `EXPO_PUBLIC_SITE_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_ENABLE_SOCIAL_FEATURES`
- `EXPO_PUBLIC_ENABLE_PREMIUM_BILLING`
- `EXPO_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES`
- `EXPO_PUBLIC_ENABLE_EXTERNAL_PROVIDERS`

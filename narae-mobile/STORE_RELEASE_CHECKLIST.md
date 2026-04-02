# Native Store Release Checklist

## Avant beta fermée

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run doctor`
- `eas build --profile preview --platform ios`
- `eas build --profile preview --platform android`
- Vérifier auth, génération, détail voyage, partage, chat, calendrier, offline, pricing

## Avant soumission App Store / Play Store

- `bundleIdentifier` et `package` validés
- Icônes, splash, screenshots, notes de review prêtes
- Permissions utilisateur revues
- Privacy policy et data disclosure alignées avec le produit
- Deep links, achats, restauration et crash reporting testés
- Canal de rollback et support post-release prêts

## Variables d’environnement attendues

- `EXPO_PUBLIC_SITE_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_ENABLE_SOCIAL_FEATURES`
- `EXPO_PUBLIC_ENABLE_PREMIUM_BILLING`
- `EXPO_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES`
- `EXPO_PUBLIC_ENABLE_EXTERNAL_PROVIDERS`

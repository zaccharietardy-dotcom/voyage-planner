# PROMPT : Finition UI premium — Narae Voyage Mobile

Tu es un expert React Native / Expo. L'app mobile (`narae-mobile/`) a déjà subi une refonte partielle. Certains écrans sont propres (login, register, home, plan, tab bar, splash), d'autres ont les bons tokens mais un styling inline qui manque de finition. Ton job : rendre CHAQUE écran visuellement identique au site web Next.js (`app/`).

---

## ÉTAT ACTUEL

### Déjà fait (StyleSheet propre, ne pas refaire) :
- `app/_layout.tsx` — splash screen premium avec pulse animation
- `app/(auth)/login.tsx` — auth Supabase + Apple + Google, SVG logos, StyleSheet
- `app/(auth)/register.tsx` — auth complète, password strength, StyleSheet
- `app/(tabs)/_layout.tsx` — tab bar avec BlurView, 5 tabs, haptics, StyleSheet
- `app/(tabs)/index.tsx` — home connecté/non-connecté, StyleSheet
- `app/(tabs)/plan.tsx` — wizard 7 steps avec VRAIS composants (StepDestination, StepOrigin, etc.), FadeIn animation, GeneratingScreen, StyleSheet
- `components/ui/Button.tsx` — gold gradient, pill shape, scale animation
- `components/ui/Input.tsx` — refait proprement

### À améliorer (ont les tokens mais styling inline, besoin de polish) :
- `app/(tabs)/trips.tsx` — filtres + trip cards
- `app/(tabs)/explore.tsx` — feed discover/following
- `app/(tabs)/profile.tsx` — stats, tabs, actions
- `app/trip/[id].tsx` — trip detail (5 onglets)
- `app/preferences.tsx` — chips et radio cards
- `app/pricing.tsx` — pricing cards
- `components/trip/TripCard.tsx` — card voyages
- `components/explore/FeedCard.tsx` — card feed
- `components/trip/ActivityItem.tsx` — timeline activités
- `components/trip/ChatPanel.tsx` — chat AI
- `components/trip/BookingChecklist.tsx` — checklist réservation
- `components/trip/TripHero.tsx` — hero image trip
- `components/trip/SharePanel.tsx` — partage
- `components/trip/ActivityDetail.tsx` — modal détail activité
- `components/trip/DayHeader.tsx` — header jour
- `components/ui/Card.tsx` — variants card
- `components/ui/Badge.tsx` — badges statut

---

## RÈGLE ABSOLUE #1 : NE PAS CASSER LA LOGIQUE

**CRITIQUE** : Chaque fichier contient de la logique métier (API calls, auth, navigation, state management) qui FONCTIONNE. Tu dois UNIQUEMENT modifier le styling. Concrètement :

1. **NE JAMAIS supprimer** d'imports de `@/lib/api/`, `@/lib/supabase/`, `@/hooks/`
2. **NE JAMAIS remplacer** un handler async par un `setTimeout` ou un stub
3. **NE JAMAIS supprimer** de composants enfants (StepDestination, GeneratingScreen, TripCard, etc.)
4. **NE JAMAIS changer** les props passées aux composants enfants
5. **NE JAMAIS modifier** les types TypeScript ou les interfaces

Si tu lis `handleAppleLogin`, `generateTrip`, `fetchMyTrips`, `supabase.auth.signUp` — **ne touche pas**. Tu ne modifies QUE les objets `style={{}}` et les StyleSheet.

---

## DESIGN SYSTEM (référence exacte)

### Couleurs (déjà dans `lib/theme.ts`)
```
Background: #020617      Card: #0a1128        Gold: #c5a059
Gold Light: #dfc28d       Gold Dark: #a37f3d    Text: #f8fafc
Text Secondary: #94a3b8   Text Muted: #64748b   Border: #1e293b
```

### Gold Gradient : `['#E2B35C', '#C5A059', '#8B6E37']` diagonal

### Polices (déjà chargées dans _layout.tsx)
```
Titres:      fonts.display        (PlayfairDisplay_700Bold)
Body:        fonts.sans           (Inter_400Regular)
Body medium: fonts.sansMedium     (Inter_500Medium)
Body semi:   fonts.sansSemiBold   (Inter_600SemiBold)
Body bold:   fonts.sansBold       (Inter_700Bold)
```

### Rayons (déjà dans `lib/theme.ts`)
```
radius.button = 32    radius.card = 25    radius.xl = 18
radius.full = 999     radius.sm = 10
```

### Pattern label récurrent
```ts
{ fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, color: colors.textSecondary }
```

---

## TRAVAIL À FAIRE — PAR FICHIER

### 1. `app/(tabs)/trips.tsx`
Comparer avec `app/src/app/mes-voyages/page.tsx` (web). Améliorer :
- Migrer vers StyleSheet.create() en bas du fichier
- Header : titre Playfair 34px, sous-titre Inter
- Filtres pills : borderRadius 999, actif = gold bg + gold border
- Trip cards via TripCard component (ne pas toucher au composant)
- Empty state propre avec CTA gold
- `paddingBottom: 120` sur la FlatList (tab bar absolue)

### 2. `app/(tabs)/explore.tsx`
Comparer avec le feed web. Améliorer :
- Tabs Discover/Following : Inter bold, actif=gold avec underline/indicator
- Sort pill : borderRadius 999
- Body text : fontFamily fonts.sans partout
- `paddingBottom: 120` sur la FlatList

### 3. `app/(tabs)/profile.tsx`
Comparer avec `app/src/app/profil/page.tsx`. Améliorer :
- Cover 120px + avatar 88px avec border gold (ring-2 ring-gold/30)
- Nom : Playfair 26px
- Stats : Playfair 22px bold pour les nombres, Inter 11px uppercase pour les labels
- Tabs Voyages/Stats/Club : Inter semibold, actif=gold
- Actions cards : bg white/5, borderRadius 25, padding 20
- Boutons danger : rouge

### 4. `app/trip/[id].tsx`
La page la plus complexe. Améliorer :
- Stats pills : borderRadius 999, Inter SemiBold
- Tab labels : 11px uppercase bold tracking 1
- Toutes les sections : Inter body, Playfair titres

### 5. Composants trip (ActivityItem, ChatPanel, BookingChecklist, TripHero, SharePanel, ActivityDetail, DayHeader)
Pour chacun :
- Migrer les styles inline vers StyleSheet.create()
- Vérifier borderRadius = radius.card (25) pour les cards
- Vérifier les fonts (fontFamily, PAS fontWeight seul)
- Vérifier les couleurs (theme tokens, pas de hardcoded hex)

### 6. `components/ui/Card.tsx`
- Ajouter variant `premium` avec border gold/20 et shadow gold subtile
- borderRadius: radius.card (25) sur toutes les variants

### 7. `components/ui/Badge.tsx`
- borderRadius: radius.full (999) au lieu de hardcoded 999
- Ajouter la prop `label` (texte du badge) si manquante
- Style : uppercase, 9px, bold, tracking 1.5

### 8. `components/trip/TripCard.tsx`
- Image 220px (full) / 130px (compact)
- Gradient overlay noir en bas
- Badge statut : pill uppercase 9px
- Divider 1px entre image et info
- Meta row : Inter medium 13px

### 9. `components/explore/FeedCard.tsx`
- Image 200px, gradient overlay
- Badge durée : pill, uppercase 9px
- Owner row : avatar + nom Inter semibold
- Like heart : garder l'animation scale

### 10. `app/preferences.tsx` + `app/pricing.tsx`
- Migrer vers StyleSheet
- Utiliser tokens theme partout
- Cards : radius.card, bg white/5
- Chips : radius.sm, actif=gold

---

## MÉTHODE DE TRAVAIL

Pour chaque fichier :
1. **Lire le fichier web correspondant** dans `app/src/` pour comprendre le design cible
2. **Lire le fichier mobile actuel** — identifier la logique métier à préserver
3. **Extraire les styles inline** vers un `StyleSheet.create()` en bas du fichier
4. **Aligner les valeurs** (fonts, radius, colors, spacing) avec le web
5. **NE RIEN SUPPRIMER** de la logique — uniquement déplacer/modifier les styles

---

## RÈGLES STRICTES

1. **JAMAIS** `fontWeight` sans `fontFamily` — le poids est dans le fichier font
2. **JAMAIS** `"use client"` — c'est Expo React Native, pas Next.js
3. **TOUJOURS** importer `colors, fonts, radius` depuis `@/lib/theme`
4. **TOUJOURS** `Haptics.impactAsync()` ou `Haptics.selectionAsync()` sur les boutons
5. **TOUJOURS** `paddingBottom: 120+` sur les FlatList/ScrollView dans les tabs
6. **TOUJOURS** préserver TOUS les imports, handlers, composants enfants, props
7. Animation steps : `FadeIn.duration(200)` — PAS de spring/slide
8. SVG Apple/Google : `react-native-svg` (Svg, Path) — PAS Lucide

---

## VÉRIFICATION OBLIGATOIRE

Après CHAQUE fichier modifié, vérifier :
```bash
npx tsc --noEmit
```

À la fin de tout :
```bash
npx expo export --platform ios
```

Si TypeScript échoue → tu as probablement cassé un type ou supprimé une prop. **Annule ta modification et recommence en préservant la logique.**

---

## CE QUI EST INTERDIT (erreurs de l'assistant précédent)

L'assistant précédent a fait ces erreurs. NE PAS les reproduire :

1. ❌ Remplacer `handleEmailLogin` par `setTimeout(() => setIsLoading(false), 2000)`
2. ❌ Supprimer les imports de StepDestination, StepOrigin, GeneratingScreen, etc.
3. ❌ Remplacer le vrai wizard par un placeholder "Contenu de l'étape X..."
4. ❌ Supprimer la prop `label` de Badge.tsx
5. ❌ Supprimer la variant `premium` de Card.tsx
6. ❌ Changer les props de FeedCard/TripCard (onPress, onLike, onClone, onLongPress)
7. ❌ Supprimer `fetchPublicTrips`, `fetchTripDetails` ou tout import API

**Si tu ne comprends pas ce que fait un handler ou un import — LAISSE-LE EN PLACE.**

# Voyage Travel Planner - Project Guidelines

> Dernière mise à jour : Février 2026

## Quick Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Build for production
npm test             # Run all tests
npm run lint         # Check code style
```

## Architecture

```
src/
├── app/                    # Next.js 16 App Router
│   ├── api/               # API routes
│   │   ├── generate/      # Génération voyage (POST)
│   │   ├── attractions/   # Pool d'attractions
│   │   └── trips/         # CRUD voyages
│   ├── plan/              # Formulaire de planification
│   └── trip/[id]/         # Page voyage généré
├── components/
│   ├── forms/             # Étapes du wizard (StepDestination, etc.)
│   ├── trip/              # Affichage voyage (CalendarView, TripMap, etc.)
│   └── ui/                # Composants shadcn/ui
├── lib/
│   ├── services/          # Logique métier (APIs, génération)
│   │   ├── rapidApiBooking.ts   # Hôtels Booking.com
│   │   ├── viator.ts            # Activités Viator
│   │   ├── serpApiPlaces.ts     # Attractions/Restaurants
│   │   ├── claudeItinerary.ts   # Génération itinéraire IA
│   │   └── linkGenerator.ts     # Liens transport/bagages
│   ├── ai.ts              # Orchestration génération
│   ├── types.ts           # Types TypeScript
│   └── tripUtils.ts       # Utilitaires voyage
└── hooks/                 # Custom React hooks
```

## APIs Utilisées

| Service | API | Usage |
|---------|-----|-------|
| Hôtels | `booking-com15.p.rapidapi.com` | Liens directs Booking.com |
| Activités | `api.viator.com/partner` | Expériences + liens affiliés |
| Attractions | `serpapi.com` | Google Maps POI |
| Restaurants | `serpapi.com` | Google Maps restaurants |
| IA | `api.anthropic.com` | Claude pour itinéraires |

> Voir `APIS.md` pour la documentation complète des APIs

## Clés API (.env.local)

```env
ANTHROPIC_API_KEY=sk-ant-...     # Claude AI
RAPIDAPI_KEY=626defeb...          # Booking.com (booking-com15)
SERPAPI_KEY=aeb3b2c7...           # Google Maps
VIATOR_API_KEY=...                # Viator Partner
DATABASE_URL=file:./dev.db        # SQLite
```

## Flow de Génération de Voyage

```
1. Utilisateur remplit le formulaire (plan/)
   ↓
2. POST /api/generate avec préférences
   ↓
3. Recherche parallèle:
   - Hôtels via RapidAPI Booking
   - Activités via Viator + SerpAPI
   - Restaurants via SerpAPI
   ↓
4. Claude génère l'itinéraire jour par jour
   ↓
5. Post-processing:
   - Liens Viator sur les activités
   - Liens Booking sur l'hôtel
   - Liens transport (Omio/Google Flights)
   ↓
6. Sauvegarde + Affichage (trip/[id]/)
```

## Génération de Liens

| Type | Lien Généré | Exemple |
|------|-------------|---------|
| Hôtel | Direct Booking.com | `/hotel/nl/name.html?checkin=...` |
| Activité | Viator productUrl ou recherche | `viator.com/tours/...` |
| Restaurant | Google Maps | `google.com/maps/search/?api=1&query=...` |
| Train | Omio recherche | `omio.fr/search-frontend/results/train/...` |
| Avion | Google Flights | `google.com/travel/flights?q=...` |
| Bagages | Radical Storage (affilié) | `radicalstorage.tpo.lu/nsE8ApQR` |

## Filtres Qualité

### Attractions (serpApiPlaces.ts)
- **Types exclus** : cinémas, gyms, concert halls, restaurants, theaters, stadiums
- **Keywords exclus** : photo spots, i amsterdam, selfie spot, madame tussauds
- **Rating min** : 4.0
- **Reviews min** : 100

### Restaurants
- **Rating min** : 3.7
- **Reviews min** : 50

### Hôtels
- **Rating min** : 7.0 (sur 10)

## Règles IA (claudeItinerary.ts)

Le prompt Claude inclut des règles strictes :
- Pas de doublons (ex: 2 croisières)
- Pas de concert halls/theaters comme visites
- Must-see obligatoires
- Diversité catégorielle (max 1 église/jour)
- Durées réalistes (musée = 2h, quartier = 1h30)

## Code Standards

### TypeScript
- `strict: true`
- NO `any` - utiliser types explicites
- Interfaces pour les données

### Fonctions
- Max 50 lignes
- Guard clauses en premier
- Noms explicites

### Composants
- Max 200 lignes
- `'use client'` si hooks/state
- Props interfaces définies

### Commentaires
- Français pour la logique métier
- Anglais pour le technique
- Expliquer le "pourquoi"

## Git Workflow

```bash
# Commits conventionnels
git commit -m "feat: add feature"
git commit -m "fix: resolve bug"
git commit -m "refactor: improve X"

# Toujours build avant push
npm run build && git push
```

## Fichiers Clés à Connaître

| Fichier | Rôle |
|---------|------|
| `ai.ts` | Orchestration génération voyage |
| `claudeItinerary.ts` | Prompt et appel Claude |
| `rapidApiBooking.ts` | API Booking.com |
| `viator.ts` | API Viator |
| `serpApiPlaces.ts` | Attractions + Restaurants |
| `tripUtils.ts` | Helpers (liens, dates, distances) |
| `linkGenerator.ts` | Génération liens transport |
| `types.ts` | Types centralisés |

## Debugging

### Logs utiles dans la console serveur
```
[RapidAPI Booking] ✅ URL directe trouvée: ...
[RapidAPI Booking] ⚠️ Pas de slug, fallback recherche
[Viator] ✅ Match trouvé: "Activity" → "Viator Product"
[SerpAPI] Exclusion: "Place" (type/keyword)
```

### Vérifier quota API
- RapidAPI : Dashboard RapidAPI
- SerpAPI : Dashboard SerpAPI (100 req/mois gratuit)

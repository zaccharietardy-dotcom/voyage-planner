# Voyage Planner — Documentation Pipeline

> Dernière mise à jour : Mars 2026

## Aperçu

Application de planification de voyages. Génère des itinéraires détaillés et optimisés avec activités, restaurants, hôtel et transport.

**Stack** : Next.js 16, React 19, TypeScript, Tailwind CSS, Supabase, Leaflet
**Pipeline** : V3 déterministe (unique pipeline, legacy supprimé)

## Pipeline Freeze (Mars 2026)

Pipeline V3.0 est **GELÉ**. Aucune modification sauf :
1. Bug P0 production (crash, data loss, sécurité)
2. Violation contract sur >10% des trips

Fichiers gelés : step1-fetch → step12-decorate, step8910-unified-schedule, step11-contracts.

## Architecture Pipeline V3

```
Step 1:  fetchAllData()            — Fetch parallel (Google Places, Viator, SerpAPI, Booking, Weather)
Step 2:  scoreAndRank()            — Score Bayésien + clamp durées + validation coords + perso groupType
Step 3:  selectHotel()             — 3 tiers (budget/mid/premium) par barycentre activités
Step 4:  anchorTransport()         — Fenêtres temporelles par jour (arrivée/départ)
Step 5:  extractDayTrips()         — Day trips + détection implicite must-sees >10km
Step 6:  clusterByDay()            — Clustering hiérarchique + capacité temporelle + fermetures jour
Step 7:  routeWithinDays()         — 2-opt intra-jour + pénalité horaires d'ouverture
Step 7b: computeTravelTimes()      — Google Directions API sélective (>1km only)
Step 8+9+10: unifiedScheduleV3Days() — Scheduler unifié : activités + restaurants in-situ + repair en une passe
Step 11: validateContracts()       — 8 invariants P0 + score qualité 0-100
Step 12: decorateWithLLM()         — Thèmes/narratifs optionnels (OFF par défaut)
```

## Invariants P0 (Contract Layer)

| # | Invariant | Auto-fix |
|---|-----------|----------|
| P0.1 | Aucune activité hors horaires d'ouverture | Swap cross-day |
| P0.2 | Aucun restaurant à >800m de son ancre repas | Re-search |
| P0.3 | Pas de jour plein sans déjeuner ni dîner | Inject closest |
| P0.4 | Pas de fallback géo silencieux | Hard error |
| P0.5 | Pas de coordonnées (0,0) ou hors zone | Drop activité |
| P0.6 | Pas de POI cross-country | Drop activité |
| P0.7 | Durées activités dans bornes min/max | Clamp |
| P0.8 | Must-sees tous présents | Re-inject + éviction |

## APIs Utilisées

| API | Service | Usage |
|-----|---------|-------|
| Google Places (New) | `googlePlacesAttractions.ts` | Attractions + horaires + photos |
| Google Directions | `directions.ts` | Temps de trajet réels (sélectif) |
| SerpAPI (Google Maps) | `serpApiPlaces.ts` | Restaurants |
| Booking.com (RapidAPI) | `bookingHotels.ts` | Hôtels |
| Viator Partner | `viatorActivities.ts` | Activités + durées + liens |
| Open-Meteo | `weather.ts` | Météo 7 jours |
| Overpass/OSM | `overpassAttractions.ts` | POI complémentaires |
| Nominatim | `geocoding.ts` | Géocodage (gratuit) |
| Wikipedia | `wikipedia.ts` | Descriptions enrichies |
| Claude/Gemini | `llm.ts` | Décoration optionnelle |

## Fichiers Pipeline Principaux

```
pipeline/
├── index.ts                    — Orchestrateur V3 + multi-city
├── step1-fetch.ts              — Fetch parallel toutes APIs
├── step2-score.ts              — Score Bayésien + clamp + coords + perso
├── step3-cluster.ts            — Clustering hiérarchique + capacité + closures + 2-opt inter
├── step4-anchor-transport.ts   — Fenêtres temporelles transport
├── step4-restaurants.ts        — Helpers restaurant (meal suitability, cuisine family)
├── step5-hotel.ts              — Sélection hôtel 3 tiers
├── step7b-travel-times.ts      — Directions API sélective
├── step8-place-restaurants.ts  — Helpers restaurant (findBestRestaurant, enrichRestaurantPool)
├── step8910-unified-schedule.ts — Scheduler unifié (activités + restaurants in-situ + repair)
├── step10-repair.ts            — Helpers repair (fixOpeningHours, ensureMustSees, fillGaps)
├── step11-contracts.ts         — Contract Layer (8 invariants P0)
├── step12-decorate.ts          — Décoration LLM optionnelle
├── planning-meta.ts            — Types planning (PlannerRole, PlanningMeta)
├── qualityPolicy.ts            — Politique qualité restaurants
├── types.ts                    — Types pipeline internes
└── utils/
    ├── transport-items.ts      — Ajout items transport (vol, train)
    ├── restaurant-outliers.ts  — Fix restaurants outliers post-scheduling
    ├── opening-hours.ts        — Validation horaires d'ouverture
    ├── coordinate-validator.ts — Validation GPS + auto-correction lat/lng
    ├── constants.ts            — Durées min/max, coûts estimés, keywords
    ├── geo-reorder.ts          — 2-opt intra-jour + pénalité horaires
    ├── day-trip-builder.ts     — Construction jour day-trip déterministe
    ├── activityDedup.ts        — Déduplication activités similaires
    ├── accommodation.ts        — Helpers hébergement
    └── cuisine.ts              — Classification cuisines
```

## Environment Variables

```bash
# Pipeline
PIPELINE_DIRECTIONS_MODE=selective  # selective | all | off (default: selective)
PIPELINE_LLM_DECOR=off           # on | off (default: off)
PIPELINE_V4_CATALOG=off          # on | off (Phase 2 — catalog grounding; default: off)

# APIs
GOOGLE_MAPS_API_KEY=             # Google Places + Directions
GOOGLE_AI_API_KEY=               # Gemini (all calls go through services/geminiClient.ts)
GEMINI_DAILY_CAP_EUR=            # Optional hard cap — blocks calls when today's cost reaches this EUR amount
SERPAPI_API_KEY=                 # SerpAPI (restaurants)
RAPIDAPI_KEY=                    # Booking.com
VIATOR_API_KEY=                  # Viator Partner
ANTHROPIC_API_KEY=               # Claude (décoration optionnelle)
```

## Gemini Cost Instrumentation

All Gemini calls are centralised in `src/lib/services/geminiClient.ts` (`callGemini()`).
Usage is logged with a `caller` tag + token counts + estimated cost.

- Local dev: `.logs/gemini-usage.jsonl` (one JSON per call).
- Vercel: stdout lines prefixed `[GeminiUsage]` (captured by Drains).

CI guard: `npm run check:gemini-wrapper` fails if `generativelanguage.googleapis.com` appears outside `services/geminiClient.ts`. Run before every push that touches Gemini paths.

### Hard cap (`GEMINI_DAILY_CAP_EUR`)

GCP billing "budgets" are notification-only and don't block calls. To truly block Gemini when a daily EUR threshold is reached, set `GEMINI_DAILY_CAP_EUR` in `.env.local`. When today's estimated cost reaches the cap, `callGemini` short-circuits with HTTP 429 / `RESOURCE_EXHAUSTED`.

- Local dev: the cap is hydrated at startup from today's entries in `.logs/gemini-usage.jsonl`, so it survives process restarts.
- Vercel: the cap is per-process (each Lambda instance starts at 0 — `/tmp` isn't shared). For a global prod cap, pair this with a GCP quota reduction under IAM & Admin → Quotas → Generative Language API.
- Reset: day rolls at 00:00 UTC; to reset manually, call `resetTodayCostEur()` or delete today's entries from the jsonl.

Quick triage:
```bash
# Sum estimated cost for the current .jsonl log
jq -s '[.[].estimatedCostEur] | add' .logs/gemini-usage.jsonl
# Top callers by cost
jq -s 'group_by(.caller) | map({caller: .[0].caller, eur: [.[].estimatedCostEur] | add, n: length}) | sort_by(-.eur)' .logs/gemini-usage.jsonl
```

## Scoring Activités

Score = `(bayesianRating/5)² × log₁₀(reviews+1) × 10 + contextBonus + mustSeeBonus`

- **bayesianRating** : `(R × v + C × m) / (v + m)` (R=rating, v=votes, C=3.5, m=10)
- **contextBonus** : ±15 selon groupType (couple/family/friends) + activités préférées
- **mustSeeBonus** : +1000 pour les must-sees utilisateur

Durées clampées : `clamp(viatorDuration || googleDuration || defaultByType, minRule, maxRule)`

## Restaurants

- 3 alternatives par repas, cuisines différentes
- Score : `rating × log₂(reviews + 2) - distance × 10`
- Hard cap 800m du point d'ancrage repas
- Filtrage dietary : vegan, halal, gluten-free, vegetarian, kosher
- Petit-déj < 500m hôtel, déjeuner < 500m activité mid-day, dîner < 500m dernière activité

## Multi-City

Quand `preferences.cityPlan` contient N villes :
1. Run V3 indépendamment pour chaque ville
2. Merge les segments avec offset jours
3. Qualité = moyenne des scores segments

## Performance

| Métrique | V3 |
|----------|-----|
| Total | 6-16s |
| Coût | ~$0.06/trip |

## Commandes

```bash
cd app
npm run dev          # Dev server (port 3000)
npm run build        # Build production
npx tsc --noEmit     # Type check
npm test             # Tests unitaires
```

## Key Types (src/lib/types.ts)

```typescript
TripPreferences {
  origin, destination, startDate: Date, durationDays,
  groupSize, groupType, transport, carRental,
  budgetLevel, activities[], dietary[], mustSee?: string,
  cityPlan?: { city: string; days: number }[]
}

Trip {
  id, days: TripDay[], accommodation?, outboundFlight?, returnFlight?,
  transportOption?, attractionPool?, budgetStrategy?
}

TripDay {
  dayNumber, date, items: TripItem[], theme?, dayNarrative?, isDayTrip?
}

TripItem {
  id, type: TripItemType, title, startTime, endTime,
  latitude, longitude, distanceFromPrevious?,
  restaurant?, restaurantAlternatives?, accommodation?,
  bookingUrl?, googleMapsPlaceUrl?, rating?
}
```

## Components (src/components/trip/)

| Component | Purpose |
|-----------|---------|
| `CalendarView.tsx` | Main trip view — day columns with activity blocks |
| `ActivityCard.tsx` | Activity/restaurant card with booking links |
| `TripMap.tsx` | Interactive Leaflet map with markers per day |
| `ChatPanel.tsx` | AI chatbot sidebar for trip modifications |
| `HotelSelector.tsx` | Hotel selection carousel |
| `TransportOptions.tsx` | Transport mode comparison |
| `BookingChecklist.tsx` | Pre-trip booking checklist |
| `GeneratingScreen.tsx` | Generation progress screen |

## Quality Filters

| Type | Min Rating | Min Reviews | Max Distance |
|------|-----------|-------------|--------------|
| Attractions | 4.0 | 100 | — |
| Restaurants | 3.5 | 50 | 0.8km |
| Hotels | 7.0/10 | — | — |

## Code Conventions

- **TypeScript strict mode** — avoid `any`, use explicit types
- **Comments**: French for business logic, English for technical
- **Commits**: `feat:`, `fix:`, `refactor:` conventional format. Ne pas mettre Claude en co-auteur (`Co-Authored-By`)
- **Imports**: relative paths within pipeline, absolute for services
- Always `npm run build` before push

## Workflow Rules

### Plan First
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### Subagent Strategy
- Use subagents to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### Verification Before Done
- Never mark a task complete without proving it works (tests, type check, demo)
- Ask: "Would a staff engineer approve this?"
- After completing: self-audit for dead code, dead imports, missing edge cases

### Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky, implement the elegant solution. Skip for obvious simple fixes.
- Challenge your own work before presenting it

### Autonomous Bug Fixing
- When given a bug: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them

### Commit & Push After Each Change
- After each modification (fix, feature, refactor), commit and push immediately
- Don't batch multiple unrelated changes into one commit
- Use conventional commit format (`feat:`, `fix:`, `refactor:`)

### Simplicity & Minimal Impact
- Make every change as simple as possible. Impact minimal code.
- Find root causes. No temporary fixes. Senior developer standards.
- Changes should only touch what's necessary.

### Dual Platform (Web + App Native)
- Le projet a deux clients : webapp Next.js (`app/`) et app native Expo (`narae-mobile/`)
- Toute modification UI/UX doit être répliquée sur les DEUX plateformes
- Webapp : Next.js 16, React 19, Tailwind, shadcn/ui
- App native : Expo 55, React Native 0.83, NativeWind, composants custom
- Même design system : Playfair Display (titres), fond #020617, or #c5a059
- Tester sur les deux : `npm run dev` (webapp) + Xcode build (native)
- Les composants trip (wizard steps, cards, timeline) ont des équivalents dans les deux codebases
- Jamais de `return null` avant des hooks React (violation Rules of Hooks au changement de route)

## Known Issues / Areas to Improve

1. **Hotel distance**: Hotel can be far from activity zones (4-15km in some tests). Barycenter doesn't always pick central locations.
2. **Must-see cramming on short trips**: 2-day trips can lose must-sees when too many are scheduled on day 1.
3. **Gap-fill aggressiveness**: Scheduler sometimes creates very dense days without enough rest breaks.
4. **Viator GPS resolution**: Many Viator activities lack precise coordinates, requiring fallback resolution.
5. **Restaurant alternatives**: Sometimes alternatives are from same cuisine family despite diversity rules.

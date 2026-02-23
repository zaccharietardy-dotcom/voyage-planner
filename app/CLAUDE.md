# Voyage Planner — Documentation Pipeline

> Dernière mise à jour : Février 2026

## Aperçu

Application de planification de voyages. Génère des itinéraires détaillés et optimisés avec activités, restaurants, hôtel et transport.

**Stack** : Next.js 15, React 19, TypeScript, Tailwind CSS, Supabase, Leaflet
**Pipeline** : V3 déterministe (V2-LLM en legacy)

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
Step 8:  placeRestaurants()        — Placement exact repas, 3 alternatives, dietary filter, 800m hard cap
Step 9:  scheduleTimeline()        — Scheduler single-pass + gap-fill progressif + opening hours
Step 10: repairPass()              — Swap cross-day, remplacement, extension, must-see injection
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
├── index.ts                    — Orchestrateur V3 + multi-city + V2 legacy
├── step1-fetch.ts              — Fetch parallel toutes APIs
├── step2-score.ts              — Score Bayésien + clamp + coords + perso
├── step3-cluster.ts            — Clustering hiérarchique + capacité + closures + 2-opt inter
├── step4-anchor-transport.ts   — Fenêtres temporelles transport
├── step4-restaurants.ts        — Helpers restaurant (meal suitability, cuisine family)
├── step5-hotel.ts              — Sélection hôtel 3 tiers
├── step7-assemble.ts           — Assemblage V2 (legacy, 6000+ lignes)
├── step7b-travel-times.ts      — Directions API sélective
├── step8-place-restaurants.ts  — Placement restaurant exact + dietary
├── step10-repair.ts            — Repair pass (swap, replace, extend)
├── step11-contracts.ts         — Contract Layer (8 invariants P0)
├── step12-decorate.ts          — Décoration LLM optionnelle
├── scheduler.ts                — Scheduler single-pass + gap-fill progressif
├── qualityPolicy.ts            — Politique qualité restaurants
├── types.ts                    — Types pipeline internes
└── utils/
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
PIPELINE_VERSION=v3              # v3 | v2-llm | v2-algorithmic (default: v2-llm)
PIPELINE_DIRECTIONS_MODE=selective  # selective | all | off (default: selective)
PIPELINE_LLM_DECOR=off           # on | off (default: off)

# APIs
GOOGLE_MAPS_API_KEY=             # Google Places + Directions
SERPAPI_API_KEY=                  # SerpAPI (restaurants)
RAPIDAPI_KEY=                    # Booking.com
VIATOR_API_KEY=                  # Viator Partner
ANTHROPIC_API_KEY=               # Claude (décoration optionnelle)
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

| Étape | V2-LLM | V3 |
|-------|--------|-----|
| Total | 20-75s | 6-16s |
| Coût | $0.10/trip | ~$0.06/trip |

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
| `GeneratingOverlay.tsx` | Generation progress overlay |

## Quality Filters

| Type | Min Rating | Min Reviews | Max Distance |
|------|-----------|-------------|--------------|
| Attractions | 4.0 | 100 | — |
| Restaurants | 3.5 | 50 | 0.8km |
| Hotels | 7.0/10 | — | — |

## Code Conventions

- **TypeScript strict mode** — avoid `any`, use explicit types
- **Comments**: French for business logic, English for technical
- **Commits**: `feat:`, `fix:`, `refactor:` conventional format
- **Imports**: relative paths within pipeline, absolute for services
- Always `npm run build` before push

## Known Issues / Areas to Improve

1. **Hotel distance**: Hotel can be far from activity zones (4-15km in some tests). Barycenter doesn't always pick central locations.
2. **Must-see cramming on short trips**: 2-day trips can lose must-sees when too many are scheduled on day 1.
3. **Gap-fill aggressiveness**: Scheduler sometimes creates very dense days without enough rest breaks.
4. **Viator GPS resolution**: Many Viator activities lack precise coordinates, requiring fallback resolution.
5. **Restaurant alternatives**: Sometimes alternatives are from same cuisine family despite diversity rules.

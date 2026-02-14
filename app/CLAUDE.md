# Voyage Planner - Pipeline V2 Architecture

> Derniere mise a jour : Fevrier 2026

## Quick Commands

```bash
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm test             # Jest tests
npm run lint         # ESLint
npx tsx test-pipeline.ts rome   # Test pipeline on a city (rome/barcelona/tokyo/marrakech/all)
```

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5.9**
- **Supabase** (auth + DB) + **Stripe** (billing)
- **Tailwind CSS 4** + **Radix UI** + **Framer Motion**
- **Leaflet** (2D map) + **Cesium/Resium** (3D globe)
- **Claude API** (`@anthropic-ai/sdk`) for day balancing (step 6) and chatbot modifications

## Pipeline V2 - Trip Generation (20-40s target)

The trip generation uses a **7-step pipeline** in `src/lib/pipeline/`. This is the ONLY active generation path. The old `src/lib/ai.ts` is legacy and NOT used for new trips.

```
Step 1: fetchAllData()          — Parallel API calls (~5-15s)
   Google Places + SerpAPI + Overpass + Viator + Hotels + Transport + Flights
        |
Step 2: scoreAndSelectActivities()  — Score, dedup, select top N (~0ms)
   Quality filters, must-see boosting, brand loyalty
        |
Step 3: clusterActivities()    — Geographic clustering per day (~0ms)
   Density profiling, radius-constrained clusters, 8-phase rebalancing
        |
Step 4: assignRestaurants()    — Proximity-first meal assignment (~0ms)
   Pool from TripAdvisor + SerpAPI, distance-scored, cuisine diversity
   Limits: breakfast <1.2km from hotel, lunch/dinner <2km from cluster ref
        |
Step 5: selectHotelByBarycenter()  — Hotel near activity centroid (~0ms)
        |
Step 6: balanceDaysWithClaude()    — Single Claude call (~10-15s)
   Day themes, activity order, rest breaks, narrative
   Falls back to deterministic order if no ANTHROPIC_API_KEY
        |
Step 7: assembleTripSchedule()     — Timed schedule + re-optimization (~2-5s)
   Geographic route optimization (2-opt), restaurant re-opt near actual
   activities, scheduler with priority queue, directions enrichment
```

### Pipeline Files

| File | Role |
|------|------|
| `pipeline/index.ts` | Main orchestrator, supplemental restaurant fetching, cluster rebalancing |
| `pipeline/step1-fetch.ts` | Parallel data fetching from all APIs |
| `pipeline/step2-score.ts` | Activity scoring, dedup, must-see detection |
| `pipeline/step3-cluster.ts` | K-means-like geographic clustering with density profiling |
| `pipeline/step4-restaurants.ts` | Meal assignment with proximity + cuisine diversity |
| `pipeline/step5-hotel.ts` | Hotel selection by weighted barycenter |
| `pipeline/step6-balance.ts` | Claude-powered day ordering and theming |
| `pipeline/step7-assemble.ts` | Schedule builder, restaurant re-optimization, directions |
| `pipeline/types.ts` | ScoredActivity, ActivityCluster, MealAssignment, BalancedDay |
| `pipeline/utils/dedup.ts` | Activity and restaurant deduplication |
| `pipeline/utils/constants.ts` | Outdoor keywords, quality thresholds |

### Restaurant Assignment (step4 + step7)

**Step 4** assigns from a merged pool (TripAdvisor + SerpAPI):
- Scores by distance + rating + review count
- Cuisine diversity: 1 local + 2 different international per meal slot
- Fine-grained cuisine families (23 types: japanese, italian, brasserie, bistro, etc.)
- If pool is sparse near anchors, fetches supplemental SerpAPI data

**Step 7** re-optimizes after geographic reordering:
- CASE A (null restaurant): searches pool + API call via `searchRestaurantsNearby()`
- CASE B (far restaurant): swaps with closer option from pool or API
- Target: <500m from neighbor activity
- Also refills alternatives within 1.2km

### Cluster Rebalancing (8 phases in index.ts)

The rebalancing in `rebalanceClustersForFlights()` runs 8 phases:
1. Empty days — merge into nearest
2. Duration-aware — move from overcrowded to underfull
3. Ensure no empty days — steal from neighbors
4. Must-see distribution — protect must-sees from eviction
5. Final must-see guarantee — last resort eviction
6. Fatigue balancing — max 2 heavy (>90min) per day
7. Type diversity — max 2 same category per day
7b. Must-see zone consolidation — group nearby must-sees
8. Geographic KNN smoothing — move outliers to closer day
8b. Cohesion enforcement — per-day radius limit
8c. City-zone angle ordering — coherent geographic flow

## Key Services

| Service | File | API |
|---------|------|-----|
| Hotels | `services/rapidApiBooking.ts` | booking-com15.p.rapidapi.com |
| Activities | `services/viator.ts` | api.viator.com/partner |
| Attractions | `services/serpApiPlaces.ts` | serpapi.com (Google Maps) |
| Attractions | `services/googlePlacesAttractions.ts` | Google Places API |
| Attractions | `services/overpassAttractions.ts` | Overpass (OpenStreetMap) |
| Restaurants | `services/serpApiPlaces.ts` | serpapi.com + Google Maps zoom |
| Restaurants | `services/geminiSearch.ts` | Gemini + Google Search |
| Flights | `services/flights.ts` | SerpAPI Google Flights |
| Transport | `services/transport.ts` | Google Directions + DB HAFAS |
| Geocoding | `services/geocoding.ts` | Google Geocoding |
| Directions | `services/directions.ts` | Google Directions API |
| AI (balance) | `services/claudeItinerary.ts` | Claude API |
| AI (chatbot) | `services/chatbotModifier.ts` | Claude API |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/generate` | POST | Generate trip via Pipeline V2 |
| `/api/trips` | GET/POST | List/create trips |
| `/api/trips/[id]` | GET/PUT/DELETE | Trip CRUD |
| `/api/trips/[id]/chat` | POST | Chatbot message |
| `/api/trips/[id]/chat/apply` | POST | Apply chatbot changes |
| `/api/attractions` | GET | Get attraction pool |
| `/api/billing/checkout` | POST | Stripe checkout |

## Key Types (src/lib/types.ts)

```typescript
TripPreferences {
  origin, destination, startDate: Date, durationDays,
  groupSize, groupType, transport, carRental,
  budgetLevel, activities[], dietary[], mustSee?: string
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
| Restaurants | 3.7 | 50 | 2.0km (step4), 0.5km (step7) |
| Hotels | 7.0/10 | — | — |

## Known Issues / Areas to Improve

1. **Hotel distance**: Hotel can be far from activity zones (seen 4-15km in tests). The barycenter algorithm doesn't always pick central locations.
2. **Hotel daily route**: The schedule doesn't explicitly show hotel departure/return each day. Activities start directly without "walk from hotel" context.
3. **Restaurant breakfast on last day**: Falls back to "Petit-dejeuner a l'hotel" even when hotel doesn't include breakfast. The last-day path in step7 bypasses rescue logic.
4. **Viator GPS resolution**: Many Viator activities lack precise coordinates. The coordsResolver sometimes picks wrong locations (e.g., "Palais de Tokyo" in Paris instead of Tokyo museum).
5. **Must-see cramming on short trips**: 2-day trips can lose must-sees when too many are scheduled on day 1 with limited hours.
6. **No ANTHROPIC_API_KEY in test**: Step 6 falls back to deterministic ordering, which doesn't produce optimal day themes or narratives.
7. **TripAdvisor hotel parser**: `parsePrice` crashes on non-string price values (TypeError: priceStr.replace is not a function).

## Code Conventions

- **TypeScript strict mode** — avoid `any`, use explicit types
- **Comments**: French for business logic, English for technical
- **Commits**: `feat:`, `fix:`, `refactor:` conventional format
- **Imports**: relative paths within pipeline, absolute for services
- Always `npm run build` before push

# APIs et Génération de Liens

> Dernière mise à jour : Février 2026

## Vue d'ensemble

| Catégorie | API | Type de Lien | Fichier Principal |
|-----------|-----|--------------|-------------------|
| **Hôtels** | RapidAPI Booking.com | Direct `/hotel/xx/name.html` + normalisation | `rapidApiBooking.ts` + `bookingLinks.ts` |
| **Activités** | Viator Partner API | Direct ou Recherche | `viator.ts` |
| **Attractions** | SerpAPI | Google Maps | `serpApiPlaces.ts` |
| **Restaurants** | SerpAPI | Google Maps | `serpApiPlaces.ts` |
| **Trains** | Omio (liens manuels) | Recherche pré-remplie | `linkGenerator.ts` |
| **Avions** | Google Flights (liens manuels) | Recherche pré-remplie | `linkGenerator.ts` |
| **Musées** | Tiqets (liens connus) | Direct ou Recherche | `tiqets.ts` |
| **Bagages** | Radical Storage | Affilié direct | `linkGenerator.ts` |

---

## 1. Hébergements (Hôtels)

### API : RapidAPI Booking.com
| Paramètre | Valeur |
|-----------|--------|
| Host | `booking-com15.p.rapidapi.com` |
| Clé | `RAPIDAPI_KEY` |
| Plan | Payant (pay-per-use) |

### Endpoints utilisés
```
1. GET /api/v1/hotels/searchDestination?query={ville}
   → Retourne: dest_id, dest_type

2. GET /api/v1/hotels/searchHotels?dest_id=...&arrival_date=...&departure_date=...
   → Retourne: liste d'hôtels avec hotel_id, prix, rating

3. GET /api/v1/hotels/getHotelDetails?hotel_id=...&arrival_date=...
   → Retourne: url (slug direct de l'hôtel)
```

### Génération du lien
```typescript
// Réponse API
"url": "https://www.booking.com/hotel/nl/hotel-name.html"

// Lien final généré
https://www.booking.com/hotel/nl/hotel-name.html?checkin=2026-02-10&checkout=2026-02-12&group_adults=2&no_rooms=1
```

### Fichier
`src/lib/services/rapidApiBooking.ts`

### Normalisation des URLs hôtels (V2)
- Fichier central: `src/lib/services/bookingLinks.ts`
- Règles:
  - conserve les URLs directes `/hotel/`
  - convertit `searchresults` vers `/hotel/{country}/{slug}.html`
  - génère une URL directe si absente
  - conserve Airbnb tel quel

---

## 2. Activités / Expériences

### API : Viator Partner API v2
| Paramètre | Valeur |
|-----------|--------|
| Host | `api.viator.com/partner` |
| Clé | `VIATOR_API_KEY` |
| Commission | 8% |

### Endpoints utilisés
```
1. POST /search/freetext
   → Recherche destination ID

2. POST /products/search
   → Retourne: liste de produits avec productUrl, prix, durée
```

### Génération du lien
```typescript
// Si l'API retourne productUrl (lien direct)
"productUrl": "https://www.viator.com/fr-FR/tours/Amsterdam/..."

// Sinon, fallback vers recherche
https://www.viator.com/searchResults/all?text=Canal+Cruise+Amsterdam
```

### Fichier
`src/lib/services/viator.ts`

---

## 3. Attractions / Points d'Intérêt

### API : SerpAPI (Google Maps Local Results)
| Paramètre | Valeur |
|-----------|--------|
| Host | `serpapi.com` |
| Clé | `SERPAPI_KEY` |
| Quota | 100 req/mois (plan gratuit) |

### Données retournées
- Nom, rating, reviews
- Coordonnées GPS
- Type de lieu
- Adresse

### Génération du lien
```typescript
// Lien Google Maps
https://www.google.com/maps/search/?api=1&query=Rijksmuseum,+Amsterdam
```

### Filtres appliqués
- Types exclus : cinémas, gyms, concert halls, restaurants
- Keywords exclus : photo spots, i amsterdam, selfie spot
- Rating minimum : 4.0
- Reviews minimum : 100

### Fichier
`src/lib/services/serpApiPlaces.ts`

---

## 4. Restaurants

### API : SerpAPI (Google Maps Local Results)
Même API que les attractions.

### Filtres appliqués
- Rating minimum : 3.7
- Reviews minimum : 50
- Types ciblés : restaurant, café, brasserie

### Génération du lien
```typescript
https://www.google.com/maps/search/?api=1&query=Restaurant+Name,+Address
```

### Fichier
`src/lib/services/serpApiPlaces.ts`

---

## 5. Transport (Trains)

### Pas d'API - Liens manuels vers Omio
Pas d'API de train utilisée. Les liens sont générés manuellement vers Omio.

### Génération du lien
```typescript
https://www.omio.fr/search-frontend/results/train/paris/amsterdam/2026-02-10/2
```

### Fichier
`src/lib/services/linkGenerator.ts`

---

## 6. Transport (Avions)

### Pas d'API - Liens manuels vers Google Flights
Pas d'API de vol utilisée. Les liens sont générés vers Google Flights.

### Génération du lien
```typescript
https://www.google.com/travel/flights?q=Flights%20from%20Paris%20to%20Amsterdam%20on%202026-02-10
```

### Fichier
`src/lib/services/linkGenerator.ts`

---

## 7. Musées / Billets (Tiqets)

### Pas d'API - Liens connus + Recherche
On maintient une liste de liens directs pour les attractions populaires.

### Lien affilié
```
https://tiqets.tpo.lu/EUpHIuJt
```

### Génération du lien
```typescript
// Si attraction connue
const KNOWN_TIQETS_LINKS = {
  'rijksmuseum': 'https://tiqets.tpo.lu/EUpHIuJt/rijksmuseum',
  'van gogh museum': 'https://tiqets.tpo.lu/EUpHIuJt/van-gogh-museum',
  // ...
}

// Sinon, recherche
https://www.tiqets.com/en/search?query=Rijksmuseum+Amsterdam
```

### Fichier
`src/lib/services/tiqets.ts`

---

## 8. Consignes à Bagages

### Lien affilié direct : Radical Storage
```
https://radicalstorage.tpo.lu/nsE8ApQR
```

### Fichier
`src/lib/services/linkGenerator.ts`

---

## Clés API (.env.local)

```env
# IA - Génération d'itinéraires
ANTHROPIC_API_KEY=sk-ant-...

# Hôtels - Booking.com via RapidAPI
RAPIDAPI_KEY=626defeb...

# Attractions/Restaurants - Google Maps
SERPAPI_KEY=aeb3b2c7...

# Activités - Viator
VIATOR_API_KEY=...

# Base de données
DATABASE_URL=file:./dev.db
```

---

## Priorité des Sources de Données

### Hôtels
1. **RapidAPI Booking.com** (liens directs, prix réels)
2. SerpAPI Google Hotels (backup)
3. Claude AI (fallback, données synthétiques)

### Activités
1. **Viator API** (liens affiliés, durées)
2. SerpAPI attractions (POI gratuits)
3. Attractions curées manuellement

### Restaurants
1. **SerpAPI** (Google Maps)
2. Claude AI (fallback)

---

## Quotas et Limites

| API | Quota | Reset |
|-----|-------|-------|
| SerpAPI | 100 req/mois (gratuit) | Mensuel |
| RapidAPI Booking | Pay-per-use | - |
| Viator | Illimité | - |
| Claude | Pay-per-use | - |

---

## Fichiers Principaux

```
src/lib/services/
├── rapidApiBooking.ts    # Hôtels Booking.com
├── viator.ts             # Activités Viator
├── tiqets.ts             # Billets musées
├── serpApiPlaces.ts      # Attractions + Restaurants
├── linkGenerator.ts      # Liens transport + bagages
├── hotels.ts             # Orchestration hôtels
└── restaurants.ts        # Orchestration restaurants
```

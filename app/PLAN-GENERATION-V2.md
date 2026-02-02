# PLAN : Refonte Génération de Voyages V2

## Problèmes identifiés
1. **Activités de mauvaise qualité** : trop de temples, lieux nuls, pas assez varié
2. **Trous dans les journées** : matinées ou après-midi vides
3. **Incohérences logistiques** : dépose bagages puis reprise immédiate
4. **Liens manquants** : pas de lien hôtel Booking.com, pas de lien Viator sur les activités, liens train/avion pas systématiques
5. **Pas d'activités Viator originales** : dégustations, kayak, tours guidés absents

---

## Chantier 1 : Liens de réservation systématiques

### 🏨 Hôtels → Lien Booking.com direct
**API** : `booking-com15.p.rapidapi.com`
**Flow** :
1. `GET /api/v1/hotels/searchDestination?query={ville}` → `dest_id`
2. `GET /api/v1/hotels/searchHotels?dest_id={id}&arrival_date=...&departure_date=...&adults=...&currency_code=EUR` → hôtels dispos avec `hotel_id` et prix
3. `GET /api/v1/hotels/getHotelDetails?hotel_id={id}&arrival_date=...` → `url` (slug Booking.com)
4. Construire : `{url}?checkin={date}&checkout={date}&group_adults={n}&no_rooms=1`

**Fichier à modifier** : `src/lib/services/hotels.ts`
- Ajouter source Booking.com RapidAPI comme priorité 1 (avant SerpAPI)
- Stocker le `bookingUrl` complet avec dates sur chaque Accommodation

**Fichier à modifier** : `src/lib/planner/LogisticsHandler.ts`
- S'assurer que le TripItem hôtel (check-in) a bien le `bookingUrl`

### ✈️ Vols → Déjà fait ✅
- Google Flights + Aviasales (implémenté dans cette conversation)

### 🚆 Trains → Lien Trainline systématique
**Déjà implémenté** dans `transport.ts` → `getTrainBookingUrl()`
**Problème** : le lien n'est pas toujours attaché au TripItem transport
**Fix** : dans `LogisticsHandler.ts` et `ai.ts`, s'assurer que chaque TripItem de type `transport` (train) a un `bookingUrl` Trainline

### 🎭 Activités → Lien Viator associé
**API** : Viator Partner v2 (`viatorapi.viator.com/partner`)
**Flow pour chaque activité SerpAPI** :
1. On a le nom + ville de l'activité (ex: "Colosseum, Rome")
2. Chercher sur Viator : `POST /products/search` avec `{ filtering: { destination: destId }, searchTerm: "Colosseum" }`
3. Si match trouvé → ajouter `viatorUrl` au TripItem
4. Si pas de match → pas de lien (activité gratuite type "se balader")

**Fichier à créer/modifier** : `src/lib/services/viator.ts`
- Ajouter fonction `findViatorProduct(activityName: string, destinationName: string): Promise<{url: string, price: number} | null>`

**Fichier à modifier** : `src/lib/ai.ts` (post-processing)
- Après génération des jours, pour chaque TripItem type `activity` → chercher produit Viator correspondant
- Attacher `bookingUrl` = lien Viator si trouvé

---

## Chantier 2 : Qualité des activités

### Problème : SerpAPI retourne trop de temples/musées ennuyeux
**Fichier** : `src/lib/services/serpApiPlaces.ts`

**Corrections** :
1. **Diversifier les queries** : actuellement 4 queries orientées "landmarks/temples/museums/viewpoints"
   - Ajouter : "best food tours wine tasting experiences"
   - Ajouter : "outdoor activities kayak bike tours"
   - Ajouter : "local markets shopping neighborhoods"
   - Ajouter : "parks gardens beaches nature"
2. **Limiter les doublons de catégorie** : max 2 temples, max 2 musées par ville
3. **Scoring de diversité** : pénaliser si trop d'activités du même type consécutives

### Ajouter des activités Viator originales
**Fichier** : `src/lib/services/viator.ts`
**Flow** :
1. Chercher les top produits Viator pour la destination (déjà implémenté : `searchViatorProducts`)
2. Filtrer par catégorie : food tours, outdoor, cultural experiences
3. **Mixer** avec les activités SerpAPI : intercaler 1-2 activités Viator par jour entre les visites classiques
4. Chaque activité Viator a déjà son lien affilié + prix + durée

**Fichier à modifier** : `src/lib/ai.ts`
- Dans la sélection d'activités par jour, réserver 1-2 slots pour des activités Viator
- Les activités Viator ont une durée (ex: 3h food tour) → les placer intelligemment (food tour le midi, kayak le matin, etc.)

---

## Chantier 3 : Combler les trous dans les journées

### Problème : matinées/après-midi vides
**Fichier** : `src/lib/ai.ts` → `generateDayWithScheduler()`

**Corrections** :
1. **Détection des trous** : après génération, scanner les items du jour et identifier les gaps > 1h30
2. **Remplissage intelligent** :
   - Gap le matin (9h-12h) → activité Viator matinale (tour guidé, marché) ou balade quartier
   - Gap l'après-midi (14h-18h) → activité SerpAPI de backup ou Viator (vélo, kayak, dégustation)
   - Gap le soir (19h-22h) → restaurant déjà géré, sinon proposer "quartier animé à explorer"
3. **Pool d'activités de secours** : garder les activités non-utilisées pour remplir les trous
4. **Minimum par jour** : 3 activités + repas (sauf jour d'arrivée/départ)

---

## Chantier 4 : Cohérence logistique

### Problème : dépose bagages puis reprise immédiate
**Fichier** : `src/lib/planner/LogisticsHandler.ts`

**Corrections** :
1. **Consigne bagages** : ne proposer que si check-in hôtel > 2h après arrivée
   - Si arrivée 10h et check-in 15h → consigne OK, activités, puis check-in
   - Si arrivée 14h et check-in 15h → aller direct à l'hôtel, pas de consigne
2. **Supprimer consigne inutile** : si le prochain item après consigne est check-in hôtel → supprimer la consigne
3. **Validation post-génération** : passer en revue les items et supprimer les séquences incohérentes (consigne → reprise < 2h)

---

## Chantier 5 : Intégration Booking.com dans hotels.ts

### Nouveau flow de recherche hôtels
```
1. Booking.com RapidAPI (prix réels, dispo, lien direct) ← NOUVEAU PRIORITAIRE
2. SerpAPI Google Hotels (backup, confirme dispo)
3. Claude AI (dernier recours)
```

### Données Booking.com à stocker dans Accommodation
```typescript
{
  name: string,
  bookingUrl: "https://www.booking.com/hotel/it/slug.html?checkin=...&checkout=...&group_adults=...",
  pricePerNight: number, // grossPrice / nuits
  totalPrice: number,
  rating: number, // reviewScore
  reviewCount: number,
  stars: number, // accuratePropertyClass
  latitude: number,
  longitude: number,
  imageUrl: string, // photoUrls[0]
  checkInTime: string, // checkin.fromTime
  checkOutTime: string, // checkout.untilTime
  amenities: string[],
  breakfastIncluded: boolean,
}
```

---

## Ordre d'exécution recommandé
1. **Booking.com hôtels** (impact immédiat : liens directs réservation)
2. **Viator matching** (liens activités + activités originales)
3. **Qualité activités SerpAPI** (diversification queries)
4. **Trous journées** (remplissage intelligent)
5. **Cohérence logistique** (consigne bagages)

## APIs utilisées (résumé)
| API | Clé | Usage | Quota |
|-----|-----|-------|-------|
| SerpAPI | SERPAPI_KEY | Vols, Hôtels backup, Restos, Activités | 250 req/mois |
| Booking.com RapidAPI | RAPIDAPI_KEY | Hôtels (prioritaire) | Pay-per-use |
| Viator Partner v2 | VIATOR_API_KEY | Activités + liens affiliés (8%) | Illimité |
| Aviasales/Travelpayouts | TRAVELPAYOUTS_API_TOKEN | Liens vols affiliés (~40%) | Illimité |
| DB Transport | Gratuit | Horaires trains | Illimité |
| FlixBus RapidAPI | RAPIDAPI_KEY | Horaires bus | Pay-per-use |

## Fichiers principaux à modifier
- `src/lib/services/hotels.ts` → intégrer Booking.com RapidAPI
- `src/lib/services/viator.ts` → ajouter `findViatorProduct()` matching
- `src/lib/services/serpApiPlaces.ts` → diversifier queries activités
- `src/lib/ai.ts` → post-processing liens + remplissage trous + mix Viator
- `src/lib/planner/LogisticsHandler.ts` → fix consigne bagages + liens systématiques

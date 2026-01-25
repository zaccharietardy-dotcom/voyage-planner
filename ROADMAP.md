# Voyage App - Roadmap & Améliorations

## Statut des fonctionnalités

### En cours / À faire

#### 1. Données de transport réalistes ⚠️ PRIORITÉ HAUTE
- [ ] **Vols réels** : Les numéros de vol sont inventés, intégrer une vraie API (Amadeus, Skyscanner)
- [ ] **Trains réels** : Intégrer SNCF Connect API, Trainline API pour vrais horaires/prix
- [ ] **Liens de réservation fonctionnels** : Les liens doivent pré-remplir le bon itinéraire

#### 2. Sélection transport → Mise à jour planning ✅ FAIT
- [x] Quand on clique "Choisir" sur une option de transport, régénérer le planning avec ce transport
- [x] Mettre à jour les horaires des activités en fonction du nouveau mode de transport

#### 3. Carte interactive améliorée ✅ FAIT
- [x] Remplacer "Transport" par le type réel (ex: "🚄 Train Paris → Barcelone")
- [x] Remplacer "Activité" par le nom (ex: "🏛️ Sagrada Familia")
- [x] Ajouter icônes distinctives par type

#### 4. Itinéraires Google Maps ✅ PARTIELLEMENT FAIT
- [x] Lien Google Maps cliquable pour chaque déplacement
- [ ] Embed Google Maps avec itinéraire pré-rempli dans une fenêtre (futur)
- [x] Afficher les lignes de métro/bus à prendre (si disponibles)

#### 5. Restaurants de qualité ✅ FAIT
- [x] Éviter les chaînes (Domino's, McDonald's, etc.) - filtre automatique
- [x] Privilégier restaurants locaux authentiques via Claude AI
- [x] Filtrer par cuisine locale de la destination
- [x] Service `restaurantsAIServer.ts` avec Claude pour recommandations
- [x] Fallback avec restaurants régionaux typiques (Barcelona, Madrid, Paris, Rome)
- [ ] Intégrer APIs TripAdvisor/TheFork (futur)

#### 6. Intégration hôtels ✅ PARTIELLEMENT FAIT
- [x] Recherche hôtels via Claude AI avec vrais noms et adresses
- [x] Proposer plusieurs options d'hôtels (`accommodationOptions` dans Trip)
- [x] Afficher prix/nuit, note /10, étoiles, localisation
- [x] Liens vers Booking.com (si disponibles)
- [ ] Permettre de changer d'hôtel et actualiser le planning (UI dropdown)
- [ ] Scraper/API Booking.com pour prix temps réel

#### 7. Liens de réservation directs
- [ ] Trains : lien direct vers SNCF/Trainline avec trajet pré-rempli
- [ ] Vols : lien vers comparateur avec dates/destinations pré-remplies
- [ ] Hôtels : lien Booking.com avec dates pré-remplies
- [x] Attractions : liens officiels de réservation (via Claude AI)

---

## Corrections effectuees

### 2026-01-24 (Session 6)
- [x] **Fix bug critique: dayEnd < dayStart** :
  - Si vol retour a 08:15, `dayEnd` etait calcule a 04:45 (avant minuit)
  - Ajout validation dans `DayScheduler` constructor
  - Ajustement automatique: minimum 2h d'activites

- [x] **Fix calcul dayEnd pour vols matinaux** :
  - Nouvelle logique: `dayEnd = max(checkoutTime, dayStart + 1h)`
  - Garantit toujours au moins 1h d'activites possibles
  - Log d'avertissement pour vols avant 10h

- [x] **Protection minStartTime dans scheduler** :
  - `minStartTime` ne peut plus reculer le curseur avant la position actuelle
  - Evite les activites planifiees "dans le passe"

- [x] **Fix condition du diner** :
  - Ancienne: `currentTime >= 19h && endHour >= 20` (jamais vrai si dayEnd < 20h)
  - Nouvelle: `currentTime >= 17h30 && canFit(90min) && !isLastDay`
  - Le diner est maintenant propose correctement sur les jours intermediaires

- [x] **Ajout logs de debug position** :
  - Affiche "ORIGINE (en transit)" ou "DESTINATION" selon le jour
  - Facilite le debugging des problemes de planification

- [x] **Suite de tests automatises (Jest)** :
  - Installation et configuration de Jest avec TypeScript
  - 20 tests couvrant: validation dayEnd >= dayStart, protection contre activites dans le passe
  - Tests de coherence du planning: Jour 1 apres arrivee, pas de chevauchement
  - Tests de non-repetition des activites
  - Tests de validation des horaires d'ouverture
  - Test d'integration complet sur 4 jours
  - Fichier: `app/src/lib/__tests__/tripValidation.test.ts`
  - Commande: `npm test`

- [x] **Fix validation horaires d'ouverture** :
  - Calcul correct de l'heure de fin reelle (prend en compte le temps de trajet + attente ouverture)
  - Skip automatique des attractions qui fermeraient avant la fin de la visite
  - Log explicite quand une attraction est sautee pour cause de fermeture

- [x] **Fix chevauchements activites/logistique** :
  - Le scheduler ignore maintenant `minStartTime` si elle est AVANT le curseur actuel
  - Protection absolue: `startTime` ne peut JAMAIS etre avant le curseur
  - Ajout de logs de debug detailles pour tracer le comportement
  - 22 tests automatises couvrent tous les cas

- [x] **Fix journees qui finissent trop tot** :
  - Augmentation de `maxAttractionsPerDay` de 3 a 4
  - Permet de remplir correctement les journees avec plus d'activites
  - Les journees intermediaires ont maintenant assez de contenu

### 2026-01-24 (Session 5)
- [x] **Liens Google Maps avec itinéraire** :
  - Les liens "Voir sur Maps" montrent maintenant l'itinéraire depuis le point précédent
  - Utilisation de `generateGoogleMapsUrl(lastCoords, destination, mode)`
  - Suivi de la position avec `lastCoords` tout au long de la journée

- [x] **Fix horaire dîner** :
  - Le dîner n'est plus proposé à 16h
  - Vérification que `currentTime >= 19:00` avant d'ajouter le dîner

- [x] **Fix dernier jour** :
  - Le dernier jour ne commence plus à 15h30
  - `dayEnd` fixé à 09:30 pour transport terrestre (avant checkout à 10:00)
  - Permet des activités le matin du dernier jour

- [x] **Rotation des restaurants** :
  - Les restaurants ne se répètent plus pendant le séjour
  - Tracking avec `usedRestaurantIds` (Set global)
  - Scoring amélioré: `rating * 10 + proximité + aléatoire`
  - Paramètre `lastCoords` pour privilégier les restaurants proches du dernier lieu

- [x] **Intégration hôtels avec noms explicites** :
  - Nouveau service `hotels.ts` avec recherche via Claude AI
  - Hôtels réels avec nom, adresse, étoiles, note /10, prix/nuit
  - `accommodationOptions` dans Trip pour proposer plusieurs choix
  - Check-in/Check-out affichent le vrai nom de l'hôtel
  - Cache 30 jours pour éviter les requêtes répétées
  - Fallback avec chaînes connues (Ibis, Novotel, Marriott...)

### 2024-01-24 (Session 4)
- [x] **REFONTE ARCHITECTURE HORAIRES** (fix chevauchements) :
  - Nouveau système `DayScheduler` basé sur l'Interval Scheduling
  - Classe scheduler avec curseur temporel séquentiel
  - Chaque item commence APRÈS le précédent (plus de chevauchements)
  - Méthodes `addItem()` (séquentiel) et `insertFixedItem()` (horaires fixes)
  - Validation automatique des conflits
  - Debug avec affichage complet de l'emploi du temps
  - Fichier: `app/src/lib/services/scheduler.ts`

- [x] **Nouvelle fonction `generateDayWithScheduler()`** :
  - Remplace l'ancienne logique fragmentée
  - Jour 1: Logistique (parking → enregistrement → vol → transfert → hôtel) puis activités
  - Jours intermédiaires: Petit-déj → activités matin → déjeuner → activités après-midi → dîner
  - Dernier jour: Activités → check-out → transfert → vol/train → parking
  - Tous les horaires sont calculés séquentiellement

### 2024-01-24 (Session 3)
- [x] **Fix activités dupliquées** :
  - Les attractions ne sont plus répétées pendant le séjour
  - Nouvelle fonction `preAllocateAttractions()` distribue les attractions une seule fois
  - Garantit qu'une attraction n'apparaît que sur un seul jour

- [x] **Restaurants authentiques locaux** :
  - Nouveau service `restaurantsAIServer.ts` utilisant Claude AI
  - Recommande des restaurants locaux typiques (évite les chaînes)
  - Cache des résultats pendant 30 jours
  - Filtre automatique des chaînes (McDonald's, Domino's, Subway, etc.)
  - Fallback avec restaurants régionaux prédéfinis (Barcelona, Madrid, Paris, Rome)

### 2024-01-24 (Session 2)
- [x] **Carte interactive améliorée** :
  - Marqueurs avec emojis par type (🏛️ activité, 🍽️ restaurant, 🏨 hôtel, etc.)
  - Popups détaillés avec prix, note, temps de trajet
  - Lien Google Maps dans chaque popup
  - Lien de réservation si disponible

- [x] **Liens Google Maps** :
  - Lien "Voir sur Maps" pour chaque activité
  - Lien "Itinéraire" quand il y a un temps de trajet
  - Fallback sur coordonnées si pas d'URL spécifique

- [x] **Régénération voyage** :
  - Banner qui apparaît quand on change de transport
  - Bouton "Régénérer" pour mettre à jour tout le planning
  - Appel API pour recréer le voyage avec le nouveau transport

### 2024-01-24 (Session 1)
- [x] Fix jour 1 : activités n'apparaissent plus avant le trajet
- [x] Support transport terrestre (train/bus/voiture) avec logistique départ/retour
- [x] Sélection transport fonctionne (sauvegarde dans localStorage)
- [x] Fix jours 5+ vides pour voyages longs (distribution équitable des attractions)
- [x] Augmentation limite attractions de 8 à 20
- [x] Intégration Claude AI pour recherche d'attractions réelles
- [x] Cache des attractions (évite requêtes répétées)
- [x] Comparaison transport avec score prix/temps/CO2

---

## APIs à intégrer

| Service | API | Usage | Coût |
|---------|-----|-------|------|
| Vols | Amadeus / Skyscanner | Recherche vols réels | Freemium |
| Trains | SNCF Connect / Trainline | Horaires trains Europe | Freemium |
| Hôtels | Booking.com Affiliate | Recherche hôtels | Affiliation |
| Restaurants | TripAdvisor / TheFork | Recommandations locales | API payante |
| Maps | Google Maps | Itinéraires, embed | Payant |
| Attractions | GetYourGuide / Viator | Réservations activités | Affiliation |

---

## Priorités

1. **Haute** : Carte interactive avec labels détaillés
2. **Haute** : Liens Google Maps pour itinéraires
3. **Haute** : Mise à jour planning quand changement transport
4. **Moyenne** : Meilleurs restaurants (sources qualité)
5. **Moyenne** : Intégration hôtels Booking
6. **Basse** : APIs vols/trains réels (complexe, coûteux)

---

## REGLES IMPORTANTES - A RESPECTER ABSOLUMENT

> **ATTENTION**: Ces 4 regles sont CRITIQUES et ont ete identifiees suite a des problemes recurrents.
> Elles doivent etre verifiees a chaque generation de voyage.
> Voir `/IMPORTANT_RULES.md` pour les details complets.
> Tests automatises: `npm test -- importantRules`

### Regle 1: VOLS - Pas de donnees inventees ⚠️
- [ ] **JAMAIS** de numero de vol generique (AF1234, VY5678)
- [ ] Utiliser de VRAIS vols via Amadeus API ou recherche Claude
- [ ] Fournir un lien de reservation REEL (Skyscanner, compagnie)
- **Fichiers**: `flights.ts`, `flightSearchAmadeus.ts`, `flightSearchClaude.ts`

### Regle 2: HORAIRES HOTEL - Check-in/Check-out realistes ⚠️
- [ ] Check-in: 14h-18h (JAMAIS avant 14h)
- [ ] Check-out: 10h-12h (JAMAIS apres 12h sauf late checkout)
- [ ] Si arrivee avant 14h: proposer une consigne a bagages REELLE
- [ ] Recuperer les VRAIS horaires sur le site de l'hotel
- **Fichiers**: `hotels.ts`, `luggageStorage.ts`, `ai.ts`

### Regle 3: HORAIRES JOURNEE - Jusqu'a minuit si nightlife ⚠️
- [ ] Journees peuvent aller jusqu'a MINUIT si nightlife selectionne
- [ ] Proposer des activites APRES le diner (bars, spectacles)
- [ ] Ne pas terminer artificiellement les journees a 21h
- **Fichiers**: `scheduler.ts`, `ai.ts`, `attractionsAIServer.ts`

### Regle 4: RESTAURANTS - Cuisine locale et variee ⚠️
- [ ] Privilegier la CUISINE LOCALE (tapas en Espagne, pasta en Italie)
- [ ] Eviter les cuisines incoherentes (pas de chinois en Espagne)
- [ ] JAMAIS le meme restaurant 2x dans un voyage
- [ ] Varier les types (pas 3 tapas d'affilee)
- **Fichiers**: `restaurants.ts`, `restaurantsAIServer.ts`, `cuisineValidator.ts`

### Statut d'implementation

| Regle | Statut | Tests |
|-------|--------|-------|
| 1. Vols reels | 🔴 A faire | ✅ Tests ecrits |
| 2. Horaires hotel | 🔴 A faire | ✅ Tests ecrits |
| 3. Horaires journee | 🔴 A faire | ✅ Tests ecrits |
| 4. Restaurants locaux | 🟡 Partiel | ✅ Tests ecrits |

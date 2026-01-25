# Regles Importantes - NE PAS OUBLIER

Ces regles sont CRITIQUES et doivent etre respectees a chaque generation de voyage.
Elles ont ete identifiees suite a des problemes recurrents.

---

## 1. VOLS - Pas de donnees inventees

### Regles
- [ ] Toujours utiliser de VRAIS vols avec VRAIS numeros de vol
- [ ] Fournir un lien de reservation REEL (Skyscanner, Google Flights, compagnie)
- [ ] Ne JAMAIS inventer de numero de vol (pas de "AF1234" generique)
- [ ] Les horaires doivent correspondre a de vrais vols existants

### Implementation
```
1. Essayer Amadeus API (si cles configurees)
2. Sinon, Claude fait une recherche web sur Google Flights
3. Stocker le lien direct de reservation
4. Cache de 1 heure (prix volatils)
```

### Fichiers concernes
- `/src/lib/services/flights.ts`
- `/src/lib/services/flightSearchAmadeus.ts`
- `/src/lib/services/flightSearchClaude.ts`

### Tests
```typescript
it('ne devrait pas avoir de numero de vol generique (AF1234, VY5678)');
it('devrait avoir un lien de reservation reel (skyscanner, kayak, compagnie)');
```

---

## 2. HORAIRES HOTEL - Check-in/Check-out realistes

### Regles
- [ ] Check-in standard: 14h-18h (JAMAIS avant 14h)
- [ ] Check-out standard: 10h-12h (JAMAIS apres 12h sauf late checkout explicite)
- [ ] Si arrivee avant check-in: proposer une consigne a bagages REELLE
- [ ] Recuperer les VRAIS horaires sur le site de l'hotel

### Implementation
```
1. Claude recherche les vrais horaires check-in/out de l'hotel
2. Si vol arrive avant 14h:
   - Chercher une consigne a bagages reelle (gare, LuggageHero, etc.)
   - Inserer "Depot bagages" dans le planning
   - Inserer "Recuperation bagages" avant le check-in
3. Si vol part apres 15h et checkout a 11h:
   - Inserer "Depot bagages" apres checkout
   - Inserer "Recuperation bagages" avant transfert aeroport
```

### Fichiers concernes
- `/src/lib/services/hotels.ts`
- `/src/lib/services/luggageStorage.ts`
- `/src/lib/ai.ts`

### Tests
```typescript
it('check-in ne devrait pas etre avant 14h');
it('check-out ne devrait pas etre apres 12h');
it('devrait proposer consigne bagages si arrivee avant check-in');
```

---

## 3. HORAIRES JOURNEE - Jusqu'a minuit si nightlife

### Regles
- [ ] Les journees peuvent aller jusqu'a MINUIT si l'utilisateur a selectionne "nightlife"
- [ ] Proposer des activites APRES le diner (bars, spectacles, promenades nocturnes)
- [ ] Ne pas terminer artificiellement les journees a 21h
- [ ] Les jours intermediaires (pas jour 1 ni dernier) ont plus de flexibilite

### Implementation
```
1. Si activityTypes.includes('nightlife'):
   - dayEnd = 00:00 (minuit)
   - Ajouter activite nocturne apres le diner
2. Sinon:
   - dayEnd = 23:00 (comportement actuel)
```

### Fichiers concernes
- `/src/lib/services/scheduler.ts`
- `/src/lib/ai.ts`
- `/src/lib/services/attractionsAIServer.ts`

### Tests
```typescript
it('journee nightlife devrait pouvoir aller jusqu a minuit');
it('devrait avoir des activites apres le diner si nightlife selectionne');
```

---

## 4. RESTAURANTS - Cuisine locale et variee

### Regles
- [ ] Privilegier la CUISINE LOCALE (tapas en Espagne, pasta en Italie)
- [ ] Eviter les cuisines incoherentes (pas de restaurant chinois en Espagne)
- [ ] JAMAIS le meme restaurant 2x dans un voyage
- [ ] Varier les types (pas 3 restaurants de tapas d'affilee)

### Cuisines locales par pays
```
Espagne: tapas, paella, catalan, basque, andalou
Italie: pasta, pizza, risotto, trattoria, osteria
France: bistrot, brasserie, gastronomique, provencal
Portugal: bacalhau, fruits de mer, pasteis
```

### Cuisines a eviter par pays
```
En Espagne: chinois, japonais, indien, americain
En Italie: chinois, mexicain, fast-food
En France: chinois (sauf quartier asiatique), fast-food
```

### Implementation
```
1. Claude recherche des restaurants LOCAUX
2. Filtrage automatique des cuisines incoherentes
3. 50+ restaurants par ville dans le cache
4. Rotation automatique pour eviter repetitions
```

### Fichiers concernes
- `/src/lib/services/restaurants.ts`
- `/src/lib/services/restaurantsAIServer.ts`
- `/src/lib/services/cuisineValidator.ts`

### Tests
```typescript
it('pas de restaurant chinois a Barcelona');
it('pas de repetition de restaurant sur un voyage de 5 jours');
it('majorite de cuisine locale (>80%)');
```

---

## Validation Automatique

Ces regles sont verifiees automatiquement par:
- `/src/lib/__tests__/importantRules.test.ts`
- `/src/lib/services/coherenceValidator.ts`

### Erreurs de coherence ajoutees
```typescript
type CoherenceErrorType =
  | 'FAKE_FLIGHT_NUMBER'      // Numero de vol invente
  | 'UNREALISTIC_CHECKIN'     // Check-in avant 14h sans consigne
  | 'UNREALISTIC_CHECKOUT'    // Check-out apres 12h
  | 'MISSING_LUGGAGE_STORAGE' // Consigne manquante
  | 'FOREIGN_CUISINE'         // Restaurant non-local
  | 'DUPLICATE_RESTAURANT'    // Restaurant en double
  | 'EARLY_DAY_END';          // Journee qui finit trop tot
```

---

## 5. DONNEES VERIFIEES - Eviter les hallucinations

### Probleme
Claude AI n'a PAS acces a internet. Il peut generer des donnees plausibles mais FAUSSES:
- Adresses qui n'existent pas
- Liens vers des pages inexistantes
- Numeros de vol inventes
- Coordonnees GPS incorrectes

### Solution: Foursquare Places API (GRATUIT)

#### Configuration
```bash
# Dans .env.local
FOURSQUARE_API_KEY=fsq3xxx
```

#### Obtenir une cle gratuite
1. Aller sur https://foursquare.com/developers
2. Creer un compte gratuit
3. Creer un projet
4. Copier l'API Key

#### Quota gratuit
- 100 000 requetes/mois
- Suffisant pour ~10 000 voyages generes

### Chaine de priorite des donnees

```
1. Foursquare Places API (si configure)
   -> Restaurants, attractions, bars VERIFIES
   -> Adresses reelles, notes reelles

2. Cache local
   -> Donnees precedemment verifiees

3. Claude AI (fallback)
   -> Donnees generees, POTENTIELLEMENT FAUSSES
   -> Marquer avec dataReliability: 'generated'
```

### Indicateur de fiabilite

Chaque item a un champ `dataReliability`:
- `verified`: Donnees de Foursquare ou API reelle
- `estimated`: Donnees calculees (prix, durees)
- `generated`: Donnees Claude (potentiellement fausses)

### Liens Google Maps

Utiliser des liens par NOM au lieu de coordonnees GPS:
```typescript
// BON (recherche par nom = Google trouve le vrai lieu)
https://www.google.com/maps/search/?api=1&query=Sagrada%20Familia,%20Barcelona

// MAUVAIS (coordonnees peuvent etre fausses)
https://www.google.com/maps?q=41.4036,2.1744
```

### Fichiers concernes
- `/src/lib/services/foursquare.ts` (nouveau)
- `/src/lib/services/restaurants.ts`
- `/src/lib/services/attractionsAIServer.ts`
- `/src/lib/services/directions.ts`

---

## Rappel pour le developpeur

Avant chaque generation de voyage, verifier:

1. **Vol**: Est-ce un VRAI vol avec un VRAI lien?
2. **Hotel**: L'heure de check-in est-elle REALISTE (>= 14h)?
3. **Consigne**: Si arrivee tot, y a-t-il une VRAIE consigne?
4. **Restaurant**: Est-ce de la CUISINE LOCALE?
5. **Horaire**: La journee finit-elle assez TARD?
6. **Donnees**: Les adresses sont-elles VERIFIEES (Foursquare)?

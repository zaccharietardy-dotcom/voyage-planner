# Voyage App - Roadmap & Statut

> Dernière mise à jour : Février 2026

## Fonctionnalités Implémentées ✅

### Génération de Voyage
- [x] Formulaire multi-étapes (destination, dates, budget, activités)
- [x] Génération IA d'itinéraires via Claude
- [x] Comparaison transport (train/avion/bus/voiture)
- [x] Sélection d'hébergement avec liens directs

### Liens de Réservation
- [x] **Hôtels** : Liens directs Booking.com via RapidAPI (`/hotel/xx/name.html`)
- [x] **Activités** : Liens Viator (directs ou recherche)
- [x] **Musées** : Liens Tiqets (connus + recherche)
- [x] **Trains** : Liens Omio pré-remplis
- [x] **Avions** : Liens Google Flights pré-remplis
- [x] **Bagages** : Lien affilié Radical Storage

### Interface
- [x] Vue calendrier avec drag & drop
- [x] Carte interactive Leaflet
- [x] Liens Google Maps pour chaque lieu
- [x] Export calendrier (.ics)

### Qualité des Données
- [x] Filtrage attractions (pas de concert halls, gyms, photo spots)
- [x] Filtrage restaurants (pas de chaînes, cuisine locale)
- [x] Règles anti-doublon dans le prompt Claude
- [x] Validation cohérence itinéraire

---

## En Cours / Prochaines Étapes

### Court Terme
- [ ] Améliorer la sélection d'hôtels (distance au centre)
- [ ] Ajouter plus de liens Tiqets connus
- [ ] Optimiser le cache des attractions

### Moyen Terme
- [ ] Collaboration temps réel (Supabase Realtime)
- [ ] Partage de voyages (réseau social)
- [ ] Profils utilisateurs publics

### Long Terme
- [ ] App mobile (React Native ou PWA)
- [ ] Intégration paiement (Stripe)
- [ ] Suggestions personnalisées basées sur l'historique

---

## APIs Utilisées

| Service | API | Statut |
|---------|-----|--------|
| Hôtels | RapidAPI Booking.com (`booking-com15`) | ✅ Actif |
| Activités | Viator Partner API | ✅ Actif |
| Attractions/Restaurants | SerpAPI (Google Maps) | ✅ Actif |
| IA | Claude API (Anthropic) | ✅ Actif |
| Transport | Omio/Google Flights (liens manuels) | ✅ Actif |

> Voir `app/APIS.md` pour la documentation complète

---

## Règles de Qualité

### Attractions
- Types exclus : cinémas, gyms, concert halls, theaters, stadiums
- Keywords exclus : photo spots, i amsterdam, selfie spot, madame tussauds
- Rating minimum : 4.0 / 5
- Reviews minimum : 100

### Restaurants
- Rating minimum : 3.7 / 5
- Pas de chaînes (McDonald's, etc.)
- Cuisine locale privilégiée

### Hôtels
- Rating minimum : 7.0 / 10
- Liens directs Booking.com

### Itinéraire
- Pas de doublons (2 croisières, 2 food tours)
- Diversité catégorielle
- Durées réalistes

---

## Historique des Corrections Majeures

### Février 2026
- Fix liens Booking.com directs (quota API épuisé → upgrade)
- Ajout filtres photo spots et concert halls
- Suppression fallback Airbnb
- Amélioration extraction URL Viator (productUrl)

### Janvier 2026
- Migration vers RapidAPI Booking.com
- Intégration Viator Partner API
- Refonte complète génération itinéraire
- Ajout vue calendrier

---

## Documentation

- `app/README.md` - Présentation projet
- `app/CLAUDE.md` - Guidelines développement
- `app/APIS.md` - Documentation APIs

# Voyage - AI Trip Planner

Planificateur de voyage intelligent avec IA, collaboration temps réel et réseau social.

## Vision

Une application web qui permet de :
1. **Planifier** un voyage en répondant à quelques questions (destination, budget, activités...)
2. **Générer** automatiquement un itinéraire jour par jour grâce à l'IA
3. **Collaborer** avec ses amis/famille pour modifier le planning en temps réel
4. **Partager** ses voyages et s'inspirer de ceux des autres (réseau social)

---

## Stack technique

| Composant | Techno | Raison |
|-----------|--------|--------|
| Framework | Next.js 14 (App Router) | SSR, API routes, déploiement Vercel gratuit |
| UI | Tailwind CSS + shadcn/ui | Moderne, rapide, composants prêts |
| BDD | Supabase | PostgreSQL + Auth + Realtime gratuit |
| Carte | Leaflet + OpenStreetMap | 100% gratuit, pas de clé API |
| IA | Ollama (local) + Claude API (fallback) | Hybride gratuit/payant |
| Déploiement | Vercel | Gratuit pour projets perso |

---

## Roadmap

### Phase 1 - MVP (en cours)

#### Formulaire de préférences (5 étapes)

**Étape 1 - Destination & Dates**
- Ville de départ (autocomplete)
- Ville d'arrivée (autocomplete)
- Date de départ (date picker)
- Durée du voyage (slider: 1-30 jours)

**Étape 2 - Transport**
- Moyen de transport principal (chips: Avion, Train, Voiture, Bus)
- Voiture sur place ? (toggle: Oui/Non)

**Étape 3 - Groupe**
- Nombre de personnes (counter: 1-20)
- Type de groupe (chips: Solo, Couple, Amis, Famille avec enfants, Famille sans enfants)

**Étape 4 - Budget**
- Budget total (slider avec labels)
  - Économique : < 500€
  - Modéré : 500 - 1500€
  - Confort : 1500 - 3000€
  - Luxe : 3000€+
- Ou input libre en €

**Étape 5 - Activités & Préférences**
- Types d'activités (chips multi-select):
  - Plage & Détente
  - Nature & Randonnée
  - Culture & Musées
  - Gastronomie
  - Vie nocturne
  - Shopping
  - Aventure & Sport
  - Bien-être & Spa
- Incontournables à inclure (input texte libre)
- Régime alimentaire (chips: Aucun, Végétarien, Vegan, Halal, Casher, Sans gluten)

#### Génération IA

L'IA génère :
- Planning jour par jour avec horaires
- Suggestions de restaurants (petit-déj, déjeuner, dîner)
- Suggestions d'hôtels/hébergements
- Activités avec durée estimée
- Temps de trajet entre les points

#### Interface résultat

**Layout deux colonnes :**
- **Gauche** : Planning jour par jour
  - Accordéon ou tabs par jour
  - Timeline verticale avec horaires
  - Chaque item : éditable, supprimable, réordonnable (drag & drop)
- **Droite** : Carte interactive Leaflet
  - Markers colorés par type (resto, hôtel, activité, transport)
  - Itinéraire tracé entre les points
  - Popup au clic avec détails

**Actions disponibles :**
- Ajouter une activité manuellement
- Modifier horaire/lieu
- Supprimer un élément
- Réordonner par drag & drop
- Exporter en PDF

---

### Phase 2 - Auth & Sauvegarde

- [ ] Connexion via Supabase Auth (Google, email)
- [ ] Sauvegarder ses voyages
- [ ] Voir son historique de voyages
- [ ] Reprendre un voyage en cours

---

### Phase 3 - Collaboration temps réel

- [ ] Inviter des amis par lien
- [ ] Édition collaborative (Supabase Realtime)
- [ ] Voir qui modifie quoi en temps réel
- [ ] Commentaires sur les activités
- [ ] Sondages pour décider en groupe

---

### Phase 4 - Réseau social

- [ ] Profils publics
- [ ] Partager un voyage publiquement
- [ ] Cloner le voyage d'un autre utilisateur
- [ ] Likes et commentaires
- [ ] Suivre des utilisateurs/influenceurs
- [ ] Feed de découverte

---

## Structure du projet

```
src/
├── app/
│   ├── page.tsx                 # Landing page
│   ├── plan/
│   │   └── page.tsx             # Formulaire multi-étapes
│   ├── trip/
│   │   └── [id]/
│   │       └── page.tsx         # Vue du voyage généré
│   └── api/
│       └── generate/
│           └── route.ts         # Endpoint génération IA
├── components/
│   ├── ui/                      # Composants shadcn
│   ├── forms/
│   │   ├── StepDestination.tsx
│   │   ├── StepTransport.tsx
│   │   ├── StepGroup.tsx
│   │   ├── StepBudget.tsx
│   │   └── StepActivities.tsx
│   ├── trip/
│   │   ├── DayTimeline.tsx
│   │   ├── ActivityCard.tsx
│   │   └── TripMap.tsx
│   └── layout/
│       ├── Header.tsx
│       └── Footer.tsx
├── lib/
│   ├── ai.ts                    # Logique IA (Ollama + Claude)
│   ├── supabase.ts              # Client Supabase
│   └── types.ts                 # Types TypeScript
└── styles/
    └── globals.css
```

---

## Modèle de données

### Table `trips`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | Identifiant unique |
| created_at | TIMESTAMP | Date de création |
| origin | TEXT | Ville de départ |
| destination | TEXT | Ville d'arrivée |
| start_date | DATE | Date de départ |
| duration_days | INT | Nombre de jours |
| transport | TEXT | Moyen de transport |
| car_rental | BOOLEAN | Location voiture sur place |
| group_size | INT | Nombre de personnes |
| group_type | TEXT | Type de groupe |
| budget_min | INT | Budget minimum |
| budget_max | INT | Budget maximum |
| activities | TEXT[] | Types d'activités |
| dietary | TEXT[] | Régimes alimentaires |
| must_see | TEXT | Incontournables |
| itinerary | JSONB | Planning généré |

### Table `trip_items`

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID | Identifiant unique |
| trip_id | UUID | Référence au voyage |
| day_number | INT | Numéro du jour |
| start_time | TIME | Heure de début |
| end_time | TIME | Heure de fin |
| type | TEXT | Type (activity, restaurant, hotel, transport) |
| title | TEXT | Titre |
| description | TEXT | Description |
| location_name | TEXT | Nom du lieu |
| latitude | DECIMAL | Latitude |
| longitude | DECIMAL | Longitude |
| order_index | INT | Ordre dans la journée |

---

## Lancer le projet

```bash
# Installer les dépendances
npm install

# Lancer en développement
npm run dev

# Build production
npm run build
```

Ouvrir [http://localhost:3000](http://localhost:3000)

---

## Concurrents analysés

| App | Points forts | Points faibles |
|-----|--------------|----------------|
| Wanderlog | Collab temps réel | UX complexe, bugs, paywall |
| Wonderplan | IA gratuite | Crashes, lent, customisation limitée |
| Layla/Mindtrip | Bonne IA | Pas vraiment collaboratif |
| Let's Jetty | Groupe/sondages | Pas d'IA |

**Notre différenciation** : Combiner le meilleur de l'IA (génération intelligente) + collaboration fluide + réseau social voyage.

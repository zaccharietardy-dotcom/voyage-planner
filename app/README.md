# Voyage - AI Trip Planner

Planificateur de voyage intelligent avec IA, génération automatique d'itinéraires et liens de réservation directs.

> Dernière mise à jour : Février 2026

## Fonctionnalités

- **Génération Pipeline V2** : Itinéraire jour par jour généré via pipeline multi-étapes + Claude
- **Liens directs** : Booking.com (priorité direct `/hotel/...`), Viator, Omio, Google Flights
- **Carte interactive** : Leaflet avec tous les points d'intérêt
- **Calendrier** : Vue calendrier drag & drop
- **Collaboration** : Partage et édition en temps réel (Supabase)

---

## Stack Technique

| Composant | Techno |
|-----------|--------|
| Framework | Next.js 16 (App Router) |
| UI | Tailwind CSS + shadcn/ui |
| BDD | Supabase (PostgreSQL) + SQLite (cache) |
| Carte | Leaflet + OpenStreetMap |
| IA | Claude API (Anthropic) |
| Déploiement | Vercel |

---

## APIs Externes

| Service | API | Fichier |
|---------|-----|---------|
| **Hôtels** | RapidAPI Booking.com | `rapidApiBooking.ts` |
| **Activités** | Viator Partner API | `viator.ts` |
| **Attractions** | SerpAPI (Google Maps) | `serpApiPlaces.ts` |
| **Restaurants** | SerpAPI (Google Maps) | `serpApiPlaces.ts` |
| **IA** | Claude API | `claudeItinerary.ts` |

> Voir `APIS.md` pour la documentation complète

---

## Installation

```bash
# Cloner le repo
git clone https://github.com/zaccharietardy-dotcom/voyage-planner.git
cd voyage-planner/app

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env.local
# Éditer .env.local avec vos clés API

# Lancer en développement
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000)

---

## Variables d'Environnement

```env
# IA
ANTHROPIC_API_KEY=sk-ant-...

# Hôtels (RapidAPI)
RAPIDAPI_KEY=...

# Attractions/Restaurants
SERPAPI_KEY=...

# Activités
VIATOR_API_KEY=...

# Base de données
DATABASE_URL=file:./dev.db
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## Structure du Projet

```
src/
├── app/
│   ├── page.tsx              # Landing page
│   ├── plan/page.tsx         # Formulaire de planification
│   ├── trip/[id]/page.tsx    # Affichage voyage
│   └── api/
│       ├── generate/         # Génération voyage
│       └── trips/            # CRUD voyages
├── components/
│   ├── forms/                # Wizard de planification
│   ├── trip/                 # Composants voyage
│   └── ui/                   # shadcn/ui
├── lib/
│   ├── services/             # Logique métier
│   ├── pipeline/             # Pipeline V2 (génération active)
│   └── types.ts              # Types TypeScript
└── hooks/                    # Custom hooks
```

---

## Flow de Génération

```
Formulaire → API /generate (V2 only) → Step 1: fetch parallel (hôtels/activités/restaurants/transport)
                                               ↓
                                       Step 2-5: scoring + clustering + repas + hôtel
                                               ↓
                                       Step 6: équilibrage Claude
                                               ↓
                                       Step 7-8: assemblage + validation qualité
                                               ↓
                                       Sauvegarde + Affichage
```

### Politique Liens Hôtels

- Les nouveaux voyages utilisent des liens Booking.com directs (`/hotel/{country}/{slug}.html`).
- Si l'API ne renvoie pas de lien direct exploitable, fallback vers slug direct (pas `searchresults.html` pour le lien principal).
- Les liens de recherche (`Recherche Booking`, `Recherche Airbnb`) restent disponibles en UI comme actions explicites.

---

## Documentation

- `CLAUDE.md` - Guidelines projet et standards de code
- `APIS.md` - Documentation complète des APIs

---

## Scripts

```bash
npm run dev       # Développement
npm run build     # Build production
npm run start     # Serveur production
npm test          # Tests
npm run lint      # Linting
```

---

## Licence

MIT

/**
 * Claude Itinerary Curation Service
 *
 * Reçoit un gros pool d'attractions SerpAPI (50+) et utilise Claude Sonnet
 * pour concevoir un itinéraire intelligent:
 * - Regroupement par quartier/zone géographique
 * - Day trips (Mt. Fuji, Versailles, Pompéi...)
 * - Saisonnalité (cerisiers, illuminations...)
 * - Narratif de guide de voyage
 *
 * Coût estimé: 1 appel Sonnet par voyage (~$0.05-0.15)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Attraction } from './attractions';
import { ActivityType, BudgetStrategy } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Types
// ============================================

export interface AttractionSummary {
  id: string;
  name: string;
  type: string;
  rating: number;
  description: string;
  latitude: number;
  longitude: number;
  estimatedDuration: number;
  estimatedCost: number;
  mustSee?: boolean;
  reviewCount?: number;
}

export interface ClaudeItineraryRequest {
  destination: string;
  durationDays: number;
  startDate: string;
  activities: string[];
  budgetLevel: string;
  mustSee?: string;
  groupType?: string;
  groupSize?: number;
  attractionPool: AttractionSummary[];
  budgetStrategy?: BudgetStrategy;
}

export interface ClaudeItineraryDay {
  dayNumber: number;
  theme: string;
  isDayTrip: boolean;
  dayTripDestination?: string;
  dayTripTransport?: string;
  selectedAttractionIds: string[];
  visitOrder?: string[];
  additionalSuggestions: {
    name: string;
    whyVisit: string;
    estimatedDuration: number;
    estimatedCost: number;
    area: string;
    bestTimeOfDay?: string;
    bookable?: boolean;
    gygSearchQuery?: string;
    bookingUrl?: string;
  }[];
  dayNarrative: string;
  bookingAdvice?: BookingAdvice[];
}

export interface BookingAdvice {
  attractionName: string;
  attractionId?: string;
  urgency: 'essential' | 'recommended' | 'optional';
  reason: string;
  bookingSearchQuery?: string;
  bookingLinks?: {
    getYourGuide?: string;
    tiqets?: string;
    viator?: string;
    googleSearch?: string;
  };
}

export interface ClaudeItineraryResponse {
  days: ClaudeItineraryDay[];
  seasonalTips: string[];
  bookingWarnings?: BookingAdvice[];
  excludedReasons: { id: string; reason: string }[];
}

// ============================================
// Cache
// ============================================

const CACHE_DIR = path.join(process.cwd(), '.cache', 'itineraries');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function getCacheKey(req: ClaudeItineraryRequest): string {
  const key = `${req.destination}-${req.durationDays}-${req.activities.sort().join(',')}-${req.budgetLevel}-${req.mustSee || ''}`;
  return key.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 200);
}

function readCache(key: string): ClaudeItineraryResponse | null {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, data: ClaudeItineraryResponse): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch (error) {
    console.warn('[ClaudeItinerary] Cache write error:', error);
  }
}

// ============================================
// Season detection
// ============================================

function getSeason(dateStr: string): string {
  const month = new Date(dateStr).getMonth() + 1;
  if (month >= 3 && month <= 5) return 'printemps';
  if (month >= 6 && month <= 8) return 'été';
  if (month >= 9 && month <= 11) return 'automne';
  return 'hiver';
}

// ============================================
// Main function
// ============================================

export async function generateClaudeItinerary(
  request: ClaudeItineraryRequest
): Promise<ClaudeItineraryResponse | null> {
  // Check cache
  const cacheKey = getCacheKey(request);
  const cached = readCache(cacheKey);
  if (cached) {
    console.log('[ClaudeItinerary] Cache hit');
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[ClaudeItinerary] ANTHROPIC_API_KEY non configurée, fallback');
    return null;
  }

  const client = new Anthropic({ apiKey });
  const season = getSeason(request.startDate);

  // Pre-filter pool: cap religious buildings to max 5 to avoid bias
  const religiousPattern = /\b(église|church|cathedral|cathédrale|basilique|basilica|chapel|chapelle|mosquée|mosque|synagogue|temple|sanctuaire|shrine)\b/i;
  let religiousInPool = 0;
  const filteredPool = request.attractionPool.filter(a => {
    if (religiousPattern.test(a.name)) {
      religiousInPool++;
      if (religiousInPool > 5) return false;
    }
    return true;
  });

  // Compact attraction pool for the prompt
  const poolCompact = filteredPool.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    rating: a.rating,
    desc: a.description.substring(0, 80),
    lat: +a.latitude.toFixed(4),
    lng: +a.longitude.toFixed(4),
    dur: a.estimatedDuration,
    cost: a.estimatedCost || 0,
  }));

  const budgetContext = {
    economic: 'Privilégie les attractions gratuites ou pas chères. Parcs, temples, quartiers à explorer à pied, marchés.',
    moderate: 'Mix équilibré entre attractions payantes et gratuites. Quelques musées majeurs + exploration libre.',
    comfort: 'Inclue les grandes attractions payantes sans hésiter. Expériences premium possibles.',
    luxury: 'Les meilleures expériences sans limite de budget. Expériences VIP, restaurants étoilés, visites privées.',
  }[request.budgetLevel] || '';

  const groupContext = {
    solo: 'Voyageur solo: rythme flexible, rencontres locales, quartiers authentiques.',
    couple: 'Couple: spots romantiques, belles vues, restaurants intimistes.',
    friends: 'Groupe d\'amis: ambiance festive, activités de groupe, quartiers animés.',
    family_with_kids: 'Famille avec enfants: rythme adapté, pauses régulières, attractions kid-friendly, pas trop de marche.',
    family_without_kids: 'Famille adulte: culture, gastronomie, rythme modéré.',
  }[request.groupType || 'couple'] || '';

  // Construire le contexte stratégie budget si disponible
  const strategy = request.budgetStrategy;
  const strategyContext = strategy ? `
STRATÉGIE BUDGET (décidée en amont):
- Hébergement: ${strategy.accommodationType === 'airbnb_with_kitchen' ? 'Airbnb avec cuisine (les voyageurs pourront cuisiner)' : strategy.accommodationType === 'hostel' ? 'Auberge de jeunesse' : 'Hôtel'}
- Repas: petit-déj=${strategy.mealsStrategy.breakfast}, déjeuner=${strategy.mealsStrategy.lunch}, dîner=${strategy.mealsStrategy.dinner}
  (self_catered = courses au supermarché, restaurant = au resto, mixed = alternance)
- Courses nécessaires: ${strategy.groceryShoppingNeeded ? 'OUI — les repas self_catered sont gérés automatiquement par le système, tu n\'as PAS besoin d\'ajouter de créneaux courses dans l\'itinéraire. Concentre-toi sur les activités et visites.' : 'NON'}
- Niveau activités: ${strategy.activitiesLevel} (budget ~${strategy.dailyActivityBudget}€/pers/jour)
- Transport local: ${strategy.transportTips}

IMPORTANT: Les repas self_catered (courses/cuisine) sont AUTOMATIQUEMENT ajoutés par le système. Ne les inclus PAS dans ton itinéraire. Concentre-toi UNIQUEMENT sur les activités, visites et restaurants (quand la stratégie dit "restaurant").
${request.budgetLevel === 'luxury' || request.budgetLevel === 'comfort' ? `\nBUDGET PREMIUM: Tous les repas sont au restaurant. Mentionne des restaurants gastronomiques ou réputés dans les dayNarrative. Propose des expériences premium (visites privées, coupe-file, croisières VIP).` : ''}
` : '';

  const prompt = `Tu es un guide de voyage local expert avec 20 ans d'expérience à ${request.destination}. Conçois l'itinéraire PARFAIT de ${request.durationDays} jours.

CONTEXTE DU VOYAGE:
- Date: ${request.startDate} (saison: ${season})
- Voyageurs: ${request.groupType || 'couple'} — ${groupContext}
- Budget: ${request.budgetLevel} — ${budgetContext}
- Activités souhaitées: ${request.activities.join(', ')}
- Must-see absolus: ${request.mustSee || 'aucun spécifié'}
${strategyContext}

POOL DE ${poolCompact.length} ATTRACTIONS VÉRIFIÉES (coordonnées GPS, horaires, prix réels):
${JSON.stringify(poolCompact)}

⚠️ BIAIS DONNÉES: Le pool provient d'OpenStreetMap et peut surreprésenter les lieux religieux (églises, temples). IGNORE les églises/temples mineurs et PRIORISE les attractions iconiques mondiales (musées majeurs, monuments emblématiques, quartiers célèbres). Si le Louvre, le Musée d'Orsay ou d'autres grands musées manquent du pool, AJOUTE-LES dans additionalSuggestions.

RÈGLES D'OR:
1. TIMING INTELLIGENT:
   - Temples, sanctuaires, marchés → tôt le matin (moins de monde, plus authentique)
   - Musées → milieu de matinée ou début d'après-midi
   - Viewpoints, observatoires → fin d'après-midi/coucher de soleil
   - Quartiers animés, rues commerçantes → fin d'après-midi/soirée
   - Parcs, jardins → selon la lumière et la saison

2. REGROUPEMENT GÉOGRAPHIQUE STRICT:
   - CHAQUE jour doit couvrir UNE zone/quartier principal (max 2 quartiers adjacents). JAMAIS zigzaguer entre est/ouest/nord dans la même journée
   - Groupe les attractions PROCHES le même jour (regarde les coordonnées lat/lng). Si 2 attractions sont à >3km, elles NE DOIVENT PAS être le même jour sauf si elles sont sur le même trajet linéaire
   - Ordonne-les pour minimiser les déplacements (circuit logique, pas de zig-zag)
   - Indique le quartier/zone dans le theme du jour
   - JAMAIS une attraction satellite SANS l'attraction principale du même lieu:
     * Trocadéro, Champ de Mars → TOUJOURS avec Tour Eiffel
     * Jardin des Tuileries, Palais Royal → TOUJOURS avec Louvre
     * Place du Tertre → TOUJOURS avec Sacré-Cœur/Montmartre
     * Île de la Cité → TOUJOURS avec Notre-Dame
     * Rambla → TOUJOURS avec Barri Gòtic
   - Ce principe s'applique à TOUTE destination: les petites attractions (places, jardins, ponts) doivent être groupées avec le monument majeur le plus proche
   - Attractions distantes de < 500m DOIVENT être le même jour
   - Ne propose JAMAIS Champ de Mars ou Trocadéro sans Tour Eiffel le même jour

3. RYTHME & DURÉES RÉALISTES:
   - Jour d'arrivée: 2-3 attractions légères (jet lag, installation)
   - Jours pleins: MINIMUM 4 attractions + pauses (idéalement 5-6). NE LAISSE JAMAIS un jour avec seulement 1-2 attractions — c'est INSUFFISANT et crée des trous de 4-5h dans l'après-midi
   - Dernier jour: 2-3 attractions + temps pour souvenirs/shopping
   - TOTAL MINIMUM: au moins ${Math.max(request.durationDays * 4, 15)} attractions sur tout le séjour (selectedAttractionIds + additionalSuggestions combinés)
   - Alterne intense (musée 2h) et léger (balade quartier 30min)
   - Prévois des pauses café/repos entre les visites intensives
   - DURÉES estimatedDuration RÉALISTES (en minutes):
     * Grand musée (Louvre, Orsay, British Museum, Prado): 150-180
     * Musée moyen (Marmottan, Rodin, Picasso): 90-120
     * Cathédrale/église (intérieur): 45-60
     * Monument extérieur (Arc de Triomphe, pyramide): 30-45
     * Place publique (Concorde, Trocadéro): 15-25
     * Viewpoint/panorama: 30-45
     * Quartier à explorer (Montmartre, Marais, Shibuya): 90-120
     * Jardin/parc (Tuileries, Luxembourg): 45-60
     * Marché: 45-60
     * NE METS JAMAIS 180min pour un simple monument, une place ou une église !
   - COÛTS estimatedCost RÉALISTES (par personne en €):
     * Gratuit (0€): parcs, jardins, places, extérieurs de monuments, églises, marchés (visite), quartiers
     * 5-15€: petits musées, tours d'église/cryptes, expositions temporaires
     * 15-25€: grands musées (Louvre 22€, Orsay 16€), monuments payants (Arc de Triomphe 16€, Tour Eiffel 29€)
     * 25-40€: expériences réservables (food tour, croisière, vélo guidé)
     * 40-80€: expériences premium (spectacle, montgolfière, VIP)
     * NE METS PAS 30€ pour une attraction GRATUITE (Sacré-Cœur, Tuileries, Notre-Dame extérieur) !

4. DAY TRIPS (OBLIGATOIRE si séjour >= 4 jours):
   - Pour ${request.durationDays} jours, propose AU MOINS 1 day trip hors de la ville
   - Choisis l'excursion la plus EMBLÉMATIQUE depuis ${request.destination}: montagne, site naturel, ville historique proche, volcan, archipel, parc national, etc.
   - Ne hardcode PAS — utilise ta connaissance du monde pour choisir LE day trip classique de la destination
   - Exemples (pour référence, PAS pour copier-coller): Paris→Versailles, Tokyo→Kamakura/Mt.Fuji, Barcelona→Montserrat, Naples→Pompéi/Vésuve, Stockholm→archipel, Rome→Tivoli
   - L'attraction PRINCIPALE du day trip DOIT être incluse EN PREMIER dans additionalSuggestions avec son nom complet exact.
     Exemple: day trip "Versailles" → "Château de Versailles" OBLIGATOIRE (pas juste Grand Trianon ou Hameau de la Reine)
     Exemple: day trip "Giverny" → "Maison et Jardins de Claude Monet" OBLIGATOIRE
   - Les restaurants du MIDI pendant un day trip doivent être SUR PLACE (dans la ville du day trip), PAS dans la ville de base
   - Place le day trip au milieu du séjour (pas jour 1 ni dernier jour)
   - Ajoute le day trip dans additionalSuggestions avec les vraies coordonnées
   - Précise le moyen de transport ET la durée du trajet dans la description
   - isDayTrip DOIT être true pour ce jour, avec dayTripDestination et dayTripTransport renseignés

5. SAISONNALITÉ (${season}):
   - Adapte les suggestions à la saison (cerisiers printemps, illuminations hiver, plages été...)
   - Mentionne les événements/festivals si pertinents pour la date

6. FILTRAGE STRICT:
   - EXCLUE: cinémas, arcades, salles de sport, immeubles, bureaux, centres commerciaux génériques
   - EXCLUE: salles de concert, opéras, théâtres, stades, arènes (sauf s'il y a un spectacle/événement prévu) — on ne "visite" pas une salle de concert vide
   - EXCLUE: rooftop bars, bars d'hôtel, pubs, discothèques comme ACTIVITÉS DE JOUR (OK en suggestion soirée uniquement)
   - EXCLUE: attractions mineures de moins de 30min seules — fusionne-les dans un créneau "exploration quartier"
   - EXCLUE TOUJOURS ces tourist traps: Madame Tussauds, Hard Rock Café, Planet Hollywood, Rainforest Café, Bubba Gump, et autres chaînes touristiques internationales
   - EXCLUE: attractions avec "wax museum", "selfie museum", "trick eye", "ripley's", "believe it or not" dans le nom
   - JAMAIS de doublon: NE SUGGÈRE PAS 2 fois la même activité ou des variantes similaires, MÊME SI ELLES ONT DES NOMS DIFFÉRENTS:
     * CROISIÈRES: Une SEULE croisière sur les canaux/rivière sur TOUT le séjour. "Canal cruise", "boat tour", "croisière guidée", "croisière privée" = MÊME CHOSE → choisis-en UNE SEULE
     * FOOD TOURS: Un SEUL food tour/walking food tour sur tout le séjour
     * WALKING TOURS: Une SEULE visite guidée à pied par thème (historique, architecture, etc.)
     * VÉLO: Une SEULE balade à vélo sur tout le séjour
     Exemples de doublons à éviter: "Amsterdam Canal Cruise" + "Private Canal Tour" = DOUBLON. "Jordaan Food Tour" + "Dutch Food Walking Tour" = DOUBLON.
   - MUST-SEE OBLIGATOIRES: "${request.mustSee || 'aucun'}" → Tu DOIS inclure CHACUN d'entre eux dans les jours 1-3, SANS EXCEPTION
   - Si un must-see n'est PAS dans le pool d'attractions, AJOUTE-LE dans additionalSuggestions avec ses vraies coordonnées
   - Si une attraction ESSENTIELLE de ${request.destination} manque du pool, ajoute-la dans additionalSuggestions
   - INCONTOURNABLES MONDIAUX OBLIGATOIRES: MÊME si l'utilisateur n'a PAS coché "culture", tu DOIS inclure les sites mondialement célèbres de ${request.destination}.
     Exemples: Barcelona → Sagrada Família, Casa Batlló, Parc Güell, La Rambla, Barri Gòtic. Paris → Tour Eiffel, Louvre, Sacré-Cœur, Notre-Dame, Montmartre. Rome → Colisée, Vatican, Fontaine de Trevi, Panthéon. Tokyo → Shibuya, Senso-ji, Meiji, Shinjuku, Akihabara. Londres → Big Ben, Tower, British Museum, Buckingham, Camden.
     New York → Statue de la Liberté, Empire State Building, Central Park, Times Square, Brooklyn Bridge, MoMA ou Met Museum, Top of the Rock ou One World Observatory, 5th Avenue, SoHo/Greenwich Village.
     Amsterdam → Rijksmuseum, Anne Frank, canaux, Vondelpark, Jordaan. Lisbonne → Belém, Alfama, LX Factory, Pastéis de Belém. Berlin → Porte de Brandebourg, Mur, Île aux Musées, Reichstag. Istanbul → Sainte-Sophie, Mosquée Bleue, Grand Bazar, Bosphore. Marrakech → Jemaa el-Fna, Majorelle, Souks, Palais Bahia. Bangkok → Grand Palais, Wat Pho, Wat Arun, Chatuchak, Khao San Road. Prague → Pont Charles, Château, Place Vieille Ville, Horloge astronomique. Budapest → Parlement, Bains Széchenyi, Bastion des Pêcheurs, Ruin Bars.
     Ces incontournables sont PRIORITAIRES sur les attractions secondaires (musées mineurs, rooftop bars, etc.). Si un incontournable manque du pool, AJOUTE-LE dans additionalSuggestions.

6c. DIVERSITÉ CATÉGORIELLE OBLIGATOIRE:
   - Maximum 1 lieu religieux (église, temple, cathédrale, mosquée, synagogue, sanctuaire) par jour
   - Maximum 3 lieux religieux sur TOUT le séjour
   - JAMAIS 2 lieux du même type consécutifs (2 musées d'affilée, 2 églises d'affilée)
   - Chaque jour doit mixer au moins 2 catégories différentes (culture + nature, shopping + gastronomie, monument + quartier...)
   - PRIORITÉ aux attractions ICONIQUES et DIVERSIFIÉES plutôt qu'à l'exhaustivité d'une seule catégorie

6b. TRANSPORT POUR EXCURSIONS HORS VILLE:
   - Si un day trip est à >15km du centre (Montserrat, Versailles, Mt. Fuji...), précise le MOYEN DE TRANSPORT RÉALISTE dans dayTripTransport:
     * Train/crémaillère si disponible (ex: "FGC train + crémaillère pour Montserrat, 1h15")
     * Location de voiture si pas de train pratique ou si excursion nature/multi-stops (ex: "Location voiture recommandée, 2h de route")
     * Bus touristique si c'est le plus simple (ex: "Bus direct depuis gare routière, 1h30")
   - Pour les voyages >= 7 jours, propose une EXCURSION MULTI-JOURS (2-3 jours) hors de la ville:
     * Location de voiture avec lien (ex: "rentalcars.com")
     * Changement d'hébergement (hôtel/airbnb sur place)
     * Activités sur place (randonnée, visite, etc.)
     * Mets ces infos dans additionalSuggestions avec les détails logistiques dans whyVisit

7. COMPLÉTER LE POOL + EXPÉRIENCES UNIQUES:
   - Le pool SerpAPI contient surtout des monuments et musées. Il MANQUE les expériences/activités réservables.
   - Pour CHAQUE jour, ajoute au moins 1-2 EXPÉRIENCES dans additionalSuggestions parmi:
     * Activités outdoor: kayak, vélo, randonnée, snorkeling, paddle, escalade...
     * Expériences culturelles: cours de cuisine locale, cérémonie du thé, atelier artisanat, visite guidée thématique...
     * Food tours, street food tours, dégustations (vin, sake, fromage, chocolat...)
     * Expériences originales: bateau, segway, tuk-tuk, side-car, montgolfière...
     * Spectacles: flamenco, kabuki, opéra, concert local...
   - Pour ces expériences, mets "bookable": true et un "gygSearchQuery" optimisé pour GetYourGuide (ex: "kayak Stockholm archipelago", "cooking class Rome pasta", "flamenco show Seville")
   - Ajoute aussi les lieux/quartiers incontournables manquants du pool
   - N'hésite PAS à ajouter 2-4 suggestions par jour

8. RÉSERVATIONS:
   - Pour CHAQUE attraction qui nécessite une réservation à l'avance, ajoute un bookingAdvice dans le jour correspondant
   - urgency "essential": réservation OBLIGATOIRE sinon refus d'entrée ou files de 2h+ (ex: Tour Eiffel sommet, Uffizi Florence, Alhambra Grenade, TeamLab Tokyo)
   - urgency "recommended": fortement conseillé surtout en haute saison (ex: Louvre, Vatican, Sagrada Familia)
   - urgency "optional": possible de prendre sur place sans trop attendre
   - Fournis un bookingSearchQuery optimisé pour Google (ex: "Tour Eiffel billets sommet réservation officielle")
   - Indique le délai recommandé (ex: "Réservez 2-3 semaines avant")

9. PRIORITÉ AUX ACTIVITÉS CHOISIES:
   - Les activités sélectionnées (${request.activities.join(', ')}) sont PRIORITAIRES et doivent dominer l'itinéraire
   - Si "nightlife" est choisi: CHAQUE soir doit proposer un bar, club, spectacle ou quartier festif
   - Si "gastronomy" est choisi: food tours, marchés locaux, restaurants notables CHAQUE jour
   - Si "nature" est choisi: randonnées, parcs, excursions nature en priorité
   - Si "adventure" est choisi: activités sportives (kayak, escalade, vélo...) CHAQUE jour
   - Si "beach" est choisi: plages, sports nautiques, détente bord de mer
   - Si "culture" est choisi: musées, monuments, sites historiques en priorité
   - Si "shopping" est choisi: quartiers commerçants, marchés, boutiques locales
   - Assure-toi que CHAQUE jour reflète au moins 2 des activités choisies par le voyageur

10. ADAPTATION AU TYPE DE GROUPE:
${request.groupType === 'family_with_kids' ? `   - FAMILLE AVEC ENFANTS: Tu DOIS inclure des activités kid-friendly dans l'itinéraire!
   - Ajoute au moins 1 activité enfants par jour parmi: aquariums, zoos, parcs d'attractions, musées interactifs/sciences, plages, aires de jeux, spectacles pour enfants
   - Cherche dans le pool SerpAPI ou ajoute en additionalSuggestions: aquarium, zoo, parc d'attractions, musée des sciences/interactif
   - Rythme adapté: pas plus de 3 visites culturelles par jour, pauses régulières, pas de marche excessive (>3km entre 2 points)
   - Privilégie les activités outdoor et interactives par rapport aux musées classiques` : request.groupType === 'friends' ? `   - GROUPE D'AMIS: activités de groupe, ambiance festive, quartiers animés` : ''}

11. NARRATIF DE GUIDE:
   - dayNarrative: 2-3 phrases vivantes comme un vrai guide local
   - Inclue un conseil pratique par jour (ex: "Arrivez avant 9h pour éviter 1h de queue")
   - Mentionne une spécialité culinaire locale à essayer dans le quartier du jour

VÉRIFICATION FINALE OBLIGATOIRE avant de répondre:
- As-tu inclus TOUS les incontournables mondiaux de ${request.destination} listés en règle 6? Si non, ajoute-les maintenant.
- Chaque jour plein a-t-il AU MOINS 4 attractions (selectedAttractionIds + additionalSuggestions)? Si non, ajoute des attractions proches du quartier du jour.
- As-tu prévu AU MOINS 1 day trip si le séjour >= 4 jours? Si non, ajoute-le maintenant.
- As-tu au moins 1 jour avec isDayTrip=true et dayTripDestination renseigné (si >= 4 jours)?
- CHAQUE jour couvre-t-il UNE zone géographique cohérente (pas de zigzag)? Vérifie les lat/lng.
${request.groupType === 'family_with_kids' ? '- As-tu inclus des activités kid-friendly (aquarium, zoo, parc, musée interactif)? Si non, ajoute-les.' : ''}

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks, pas de commentaires).
Format EXACT:
{
  "days": [
    {
      "dayNumber": 1,
      "theme": "Quartier/Zone - Titre évocateur",
      "isDayTrip": false,
      "dayTripDestination": null,
      "dayTripTransport": null,
      "selectedAttractionIds": ["id1", "id2"],
      "visitOrder": ["id2", "id1"],
      "additionalSuggestions": [
        {"name": "Nom lieu/monument", "whyVisit": "Pourquoi", "estimatedDuration": 90, "estimatedCost": 0, "area": "Quartier", "bestTimeOfDay": "morning"},
        {"name": "Kayak dans l'archipel", "whyVisit": "Expérience nature unique", "estimatedDuration": 180, "estimatedCost": 55, "area": "Archipel", "bestTimeOfDay": "morning", "bookable": true, "gygSearchQuery": "kayak archipelago Stockholm"}
      ],
      "bookingAdvice": [
        {"attractionName": "Tour Eiffel", "attractionId": "id-si-dans-pool", "urgency": "essential", "reason": "Réservez 2 semaines avant, créneaux complets en haute saison", "bookingSearchQuery": "Tour Eiffel billets sommet réservation officielle"}
      ],
      "dayNarrative": "Description vivante avec conseil pratique"
    }
  ],
  "seasonalTips": ["Conseil saisonnier spécifique à ${season} à ${request.destination}"],
  "bookingWarnings": [
    {"attractionName": "Nom", "urgency": "essential", "reason": "Explication courte", "bookingSearchQuery": "query google pour trouver le site officiel de réservation"}
  ],
  "excludedReasons": [{"id": "id", "reason": "Raison courte"}]
}`;

  try {
    console.log(`[ClaudeItinerary] Appel Claude Sonnet pour ${request.destination} (${request.durationDays}j, ${poolCompact.length} attractions)...`);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ClaudeItinerary] Pas de JSON dans la réponse');
      return null;
    }

    const parsed: ClaudeItineraryResponse = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!parsed.days || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      console.error('[ClaudeItinerary] Structure invalide');
      return null;
    }

    console.log(`[ClaudeItinerary] ✅ Itinéraire généré: ${parsed.days.length} jours`);
    for (const day of parsed.days) {
      console.log(`  Jour ${day.dayNumber}: ${day.theme} (${day.selectedAttractionIds.length} attractions${day.isDayTrip ? ', DAY TRIP: ' + day.dayTripDestination : ''})`);
    }

    // VALIDATION: Day trip obligatoire si >= 4 jours
    if (request.durationDays >= 4) {
      const hasDayTrip = parsed.days.some(d => d.isDayTrip === true);
      if (!hasDayTrip) {
        console.warn(`[ClaudeItinerary] ⚠️ AUCUN day trip détecté pour un séjour de ${request.durationDays} jours — Claude a ignoré la consigne`);
      }
    }

    // VALIDATION: Incontournables mondiaux
    const allSelectedIds = parsed.days.flatMap(d => d.selectedAttractionIds);
    const allSuggestionNames = parsed.days.flatMap(d => (d.additionalSuggestions || []).map(s => s.name.toLowerCase()));
    const allNames = [
      ...poolCompact.filter(a => allSelectedIds.includes(a.id)).map(a => a.name.toLowerCase()),
      ...allSuggestionNames,
    ].join(' ');

    // Vérifier les incontournables pour les destinations connues
    // Incontournables with full names for geocoding and proper durations
    // 'synonyms' permet d'éviter d'injecter "Colosseum" si "Colisée" existe déjà
    const mustHaveDetails: Record<string, { keyword: string; fullName: string; duration: number; cost: number; synonyms?: string[] }[]> = {
      'barcelona': [
        { keyword: 'sagrada', fullName: 'Sagrada Família, Barcelona', duration: 120, cost: 26 },
        { keyword: 'batlló', fullName: 'Casa Batlló, Barcelona', duration: 60, cost: 35 },
        { keyword: 'güell', fullName: 'Parc Güell, Barcelona', duration: 90, cost: 10 },
        { keyword: 'rambla', fullName: 'La Rambla, Barcelona', duration: 60, cost: 0 },
      ],
      'paris': [
        { keyword: 'eiffel', fullName: 'Tour Eiffel, Paris', duration: 90, cost: 29 },
        { keyword: 'louvre', fullName: 'Musée du Louvre, Paris', duration: 180, cost: 22 },
        { keyword: 'sacré-cœur', fullName: 'Basilique du Sacré-Cœur, Paris', duration: 45, cost: 0 },
        { keyword: 'notre-dame', fullName: 'Cathédrale Notre-Dame de Paris', duration: 45, cost: 0 },
        { keyword: 'montmartre', fullName: 'Montmartre, Paris', duration: 90, cost: 0 },
      ],
      'rome': [
        // Colisée: un seul entry avec synonymes pour éviter les doublons (colisée=colosseum=colosseo)
        { keyword: 'colisée', fullName: 'Colisée, Rome', duration: 90, cost: 18, synonyms: ['colosseum', 'colosseo', 'coliseo', 'amphitheatrum'] },
        { keyword: 'vatican', fullName: 'Musées du Vatican, Rome', duration: 180, cost: 17, synonyms: ['vaticano', 'chapelle sixtine', 'sistine', 'st peter', 'san pietro'] },
        { keyword: 'trevi', fullName: 'Fontaine de Trevi, Rome', duration: 20, cost: 0, synonyms: ['fontana di trevi'] },
        { keyword: 'panthéon', fullName: 'Panthéon, Rome', duration: 45, cost: 0, synonyms: ['pantheon'] },
      ],
      'tokyo': [
        { keyword: 'shibuya', fullName: 'Shibuya Crossing, Tokyo', duration: 30, cost: 0 },
        { keyword: 'senso-ji', fullName: 'Senso-ji Temple, Tokyo', duration: 60, cost: 0 },
        { keyword: 'meiji', fullName: 'Meiji Jingu Shrine, Tokyo', duration: 60, cost: 0 },
      ],
      'london': [
        { keyword: 'big ben', fullName: 'Big Ben, London', duration: 20, cost: 0 },
        { keyword: 'tower', fullName: 'Tower of London', duration: 120, cost: 30 },
        { keyword: 'british museum', fullName: 'British Museum, London', duration: 180, cost: 0 },
        { keyword: 'buckingham', fullName: 'Buckingham Palace, London', duration: 30, cost: 0 },
      ],
      'new york': [
        { keyword: 'statue of liberty', fullName: 'Statue of Liberty, New York', duration: 180, cost: 24 },
        { keyword: 'central park', fullName: 'Central Park, New York', duration: 120, cost: 0 },
        { keyword: 'empire state', fullName: 'Empire State Building, New York', duration: 60, cost: 42 },
        { keyword: 'times square', fullName: 'Times Square, New York', duration: 30, cost: 0 },
      ],
    };
    const mustHaveChecks: Record<string, string[]> = {};
    for (const [city, details] of Object.entries(mustHaveDetails)) {
      mustHaveChecks[city] = details.map(d => d.keyword);
    }

    const destLower = request.destination.toLowerCase();
    for (const [city, landmarks] of Object.entries(mustHaveChecks)) {
      if (destLower.includes(city)) {
        const missing = landmarks.filter(l => !allNames.includes(l) && !allNames.split(' ').some(w => w.includes(l)));
        if (missing.length > 0) {
          console.warn(`[ClaudeItinerary] ⚠️ Incontournables manquants pour ${city}: ${missing.join(', ')}`);
        }
      }
    }

    // POST-VALIDATION: Enforce religious diversity cap (max 3 across entire trip)
    const MAX_RELIGIOUS_TOTAL = 3;
    const religiousPatterns = /\b(église|church|cathedral|cathédrale|basilique|basilica|chapel|chapelle|mosquée|mosque|synagogue|temple|sanctuaire|shrine)\b/i;
    let religiousTotal = 0;
    for (const day of parsed.days) {
      day.selectedAttractionIds = day.selectedAttractionIds.filter(id => {
        const attraction = poolCompact.find(a => a.id === id);
        if (!attraction) return true;
        if (religiousPatterns.test(attraction.name)) {
          religiousTotal++;
          if (religiousTotal > MAX_RELIGIOUS_TOTAL) {
            console.log(`[ClaudeItinerary] Removed religious overflow: ${attraction.name}`);
            return false;
          }
        }
        return true;
      });
      if (day.visitOrder) {
        day.visitOrder = day.visitOrder.filter(id => day.selectedAttractionIds.includes(id));
      }
    }

    // POST-VALIDATION: Inject missing incontournables with proper names and durations
    // Helper: check if an attraction or any of its synonyms exist in allNames
    const attractionExists = (detail: { keyword: string; synonyms?: string[] }): boolean => {
      const allKeywords = [detail.keyword, ...(detail.synonyms || [])];
      const allNameWords = allNames.split(/\s+/);
      return allKeywords.some(kw =>
        allNames.includes(kw) || allNameWords.some(w => w.includes(kw))
      );
    };

    for (const [city, details] of Object.entries(mustHaveDetails)) {
      if (destLower.includes(city)) {
        // Filter out attractions that already exist (checking keyword + synonyms)
        const missingDetails = details.filter(d => !attractionExists(d));
        for (const detail of missingDetails) {
          // Find the day with the fewest activities (skip day trips and first/last day)
          const candidates = parsed.days.filter(d => !d.isDayTrip && d.dayNumber > 1 && d.dayNumber < request.durationDays);
          const lightest = (candidates.length > 0 ? candidates : parsed.days).reduce((min, d) =>
            d.selectedAttractionIds.length + d.additionalSuggestions.length <
            min.selectedAttractionIds.length + min.additionalSuggestions.length ? d : min
          );
          console.log(`[ClaudeItinerary] Injecting missing incontournable: "${detail.fullName}" into day ${lightest.dayNumber}`);
          lightest.additionalSuggestions.push({
            name: detail.fullName,
            whyVisit: `Incontournable de ${request.destination}`, // Removed "ajouté automatiquement" - cleaner
            estimatedDuration: detail.duration,
            estimatedCost: detail.cost,
            area: request.destination,
          });
        }
      }
    }

    // POST-VALIDATION: Duration caps, timing, audience filtering
    const nightlifePattern = /\b(moulin rouge|lido|crazy horse|cabaret|nightclub|strip club|burlesque)\b/i;
    const eveningOnlyPattern = /\b(cabaret|spectacle|show|concert|opéra|opera|flamenco|jazz club|moulin rouge)\b/i;
    const majorMuseums = /\b(louvre|british museum|metropolitan|met museum|prado|uffizi|hermitage|vatican museum|rijksmuseum|national gallery|musée d'orsay|orsay)\b/i;
    // Duration caps by attraction type name patterns
    const durationCaps: [RegExp, number][] = [
      [/\b(chapelle|chapel|sainte-chapelle)\b/i, 60],
      [/\b(place|square|plaza|piazza)\b/i, 30],
      [/\b(pont|bridge|fontaine|fountain|obélisque|obelisk|statue|colonne|column)\b/i, 30],
      [/\b(jardin|garden|parc|park)\b/i, 75],
      [/\b(église|church|cathedral|cathédrale|basilique|basilica)\b/i, 60],
      [/\b(marché|market)\b/i, 60],
    ];

    for (const day of parsed.days) {
      // Clean suggestion names: remove city/country suffixes like ", Paris, France"
      for (const s of day.additionalSuggestions) {
        // Strip trailing ", City", ", City, Country", ", Country" suffixes generically
        // Keep names like "Basilique du Sacré-Cœur de Montmartre" intact (no comma = no strip)
        s.name = s.name.replace(/,\s*[A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ]+)*(?:,\s*[A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ]+)*)*\s*$/, '').trim();
      }

      // Blacklist applied to additionalSuggestions (same as Overpass pool filter)
      const SUGGESTION_BLACKLIST = [
        /arc de triomphe du carrousel/i,
        /\bobelisk\b/i, /\bobélisque\b/i,
        /temple de paris/i,
        /\bwar memorial\b/i, /\bmémorial de guerre\b/i,
        /\bcenotaph\b/i,
        /\bcemetery\b/i, /\bcimetière\b/i,
        /\bossuary\b/i, /\bossuaire\b/i,
        /madame tussauds/i, /hard rock caf/i,
        /wax museum/i, /selfie museum/i, /trick eye/i,
        /temple de .* - versailles/i, // LDS temple, not tourist
        /\bkingdom hall\b/i, /\bsalle du royaume\b/i, // Jehovah's Witnesses
        /\bstake center\b/i, /\bward house\b/i, // LDS wards
      ];
      day.additionalSuggestions = day.additionalSuggestions.filter(s => {
        for (const pattern of SUGGESTION_BLACKLIST) {
          if (pattern.test(s.name)) {
            console.log(`[ClaudeItinerary] Blacklisted suggestion: "${s.name}"`);
            return false;
          }
        }
        return true;
      });

      // Apply blacklist to selectedAttractionIds too (not just suggestions)
      day.selectedAttractionIds = day.selectedAttractionIds.filter(id => {
        const attraction = poolCompact.find(a => a.id === id);
        if (!attraction) return true;
        for (const pattern of SUGGESTION_BLACKLIST) {
          if (pattern.test(attraction.name)) {
            console.log(`[ClaudeItinerary] Blacklisted pool attraction: "${attraction.name}"`);
            return false;
          }
        }
        // Filter attractions >20km from pool centroid on non-day-trip days
        if (!day.isDayTrip && attraction.lat && attraction.lng) {
          const validPool = poolCompact.filter(a => a.lat && a.lng);
          if (validPool.length > 0) {
            const centroidLat = validPool.reduce((s, a) => s + a.lat, 0) / validPool.length;
            const centroidLng = validPool.reduce((s, a) => s + a.lng, 0) / validPool.length;
            const dlat = (attraction.lat - centroidLat) * 111;
            const dlng = (attraction.lng - centroidLng) * 111 * Math.cos(centroidLat * Math.PI / 180);
            const distKm = Math.sqrt(dlat * dlat + dlng * dlng);
            if (distKm > 30) {
              console.log(`[ClaudeItinerary] Filtered distant attraction: "${attraction.name}" (${distKm.toFixed(1)}km from center)`);
              return false;
            }
          }
        }
        return true;
      });
      if (day.visitOrder) {
        const selectedSet = new Set(day.selectedAttractionIds);
        day.visitOrder = day.visitOrder.filter(id => selectedSet.has(id));
      }

      // Filter selectedAttractionIds: remove nightlife for family_with_kids
      if (request.groupType === 'family_with_kids') {
        day.selectedAttractionIds = day.selectedAttractionIds.filter(id => {
          const attraction = poolCompact.find(a => a.id === id);
          if (!attraction) return true;
          if (nightlifePattern.test(attraction.name)) {
            console.log(`[ClaudeItinerary] Removed pool attraction "${attraction.name}": not kid-friendly`);
            return false;
          }
          return true;
        });
        if (day.visitOrder) {
          day.visitOrder = day.visitOrder.filter(id => day.selectedAttractionIds.includes(id));
        }
      }

      // Filter additionalSuggestions
      day.additionalSuggestions = day.additionalSuggestions.filter(s => {
        if (request.groupType === 'family_with_kids' && nightlifePattern.test(s.name)) {
          console.log(`[ClaudeItinerary] Removed "${s.name}": not kid-friendly`);
          return false;
        }
        return true;
      });

      for (const s of day.additionalSuggestions) {
        // Duration cap: max 4h unless major museum
        if (s.estimatedDuration > 240 && !majorMuseums.test(s.name)) {
          console.log(`[ClaudeItinerary] Cap duration "${s.name}": ${s.estimatedDuration}min → 120min`);
          s.estimatedDuration = 120;
        }
        // Type-based duration caps
        for (const [pattern, maxMin] of durationCaps) {
          if (pattern.test(s.name) && s.estimatedDuration > maxMin * 1.5) {
            console.log(`[ClaudeItinerary] Cap duration "${s.name}": ${s.estimatedDuration}min → ${maxMin}min`);
            s.estimatedDuration = maxMin;
            break;
          }
        }

        // Evening-only enforcement for shows/cabarets
        if (eveningOnlyPattern.test(s.name) && s.bestTimeOfDay !== 'evening') {
          console.log(`[ClaudeItinerary] Force evening for "${s.name}"`);
          s.bestTimeOfDay = 'evening';
        }
      }
    }

    // POST-VALIDATION: Geographic coherence check (logging only)
    for (const day of parsed.days) {
      if (day.isDayTrip) continue;
      const dayCoords: { lat: number; lng: number; name: string }[] = [];
      for (const id of day.selectedAttractionIds) {
        const a = poolCompact.find(p => p.id === id);
        if (a && a.lat && a.lng) dayCoords.push({ lat: a.lat, lng: a.lng, name: a.name });
      }
      if (dayCoords.length >= 2) {
        let maxDist = 0;
        let pair = ['', ''];
        for (let x = 0; x < dayCoords.length; x++) {
          for (let y = x + 1; y < dayCoords.length; y++) {
            const dlat = (dayCoords[x].lat - dayCoords[y].lat) * 111;
            const dlng = (dayCoords[x].lng - dayCoords[y].lng) * 111 * Math.cos(dayCoords[x].lat * Math.PI / 180);
            const dist = Math.sqrt(dlat * dlat + dlng * dlng);
            if (dist > maxDist) {
              maxDist = dist;
              pair = [dayCoords[x].name, dayCoords[y].name];
            }
          }
        }
        if (maxDist > 5) {
          console.warn(`[ClaudeItinerary] ⚠️ Jour ${day.dayNumber}: diamètre ${maxDist.toFixed(1)}km entre "${pair[0]}" et "${pair[1]}"`);
        }
      }
    }

    // Enrichir avec les liens de réservation
    enrichBookingLinks(parsed, request);

    // Cache the result
    writeCache(cacheKey, parsed);

    return parsed;
  } catch (error) {
    console.error('[ClaudeItinerary] Erreur:', error);
    return null;
  }
}

/**
 * Génère des liens de réservation pour les attractions qui en ont besoin
 */
function enrichBookingLinks(
  response: ClaudeItineraryResponse,
  request: ClaudeItineraryRequest,
): void {
  const groupSize = request.groupSize || 2;

  function generateLinks(advice: BookingAdvice, dayNumber: number): void {
    const attractionName = advice.attractionName;
    const destination = request.destination.split(',')[0].trim(); // "Paris" from "Paris, France"

    // Calculer la date du jour
    const startDate = new Date(request.startDate);
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + dayNumber - 1);
    const dateStr = dayDate.toISOString().split('T')[0]; // YYYY-MM-DD

    const searchTerm = encodeURIComponent(`${attractionName} ${destination}`);
    const searchTermShort = encodeURIComponent(attractionName);

    advice.bookingLinks = {
      getYourGuide: `https://www.getyourguide.com/s/?q=${searchTerm}&date_from=${dateStr}&adults=${groupSize}`,
      tiqets: `https://www.tiqets.com/en/search?query=${searchTermShort}`,
      viator: `https://www.viator.com/searchResults/all?text=${searchTerm}&startDate=${dateStr}&adults=${groupSize}`,
      googleSearch: `https://www.google.com/search?q=${encodeURIComponent(`${attractionName} ${destination} billets réservation officielle`)}`,
    };
  }

  // Enrichir les bookingAdvice par jour
  for (const day of response.days) {
    if (day.bookingAdvice) {
      for (const advice of day.bookingAdvice) {
        generateLinks(advice, day.dayNumber);
      }
    }

    // Générer les liens GetYourGuide pour les suggestions bookable
    if (day.additionalSuggestions) {
      for (const suggestion of day.additionalSuggestions) {
        if (suggestion.bookable && suggestion.gygSearchQuery) {
          const dayDate = new Date(new Date(request.startDate));
          dayDate.setDate(dayDate.getDate() + day.dayNumber - 1);
          const dateStr = dayDate.toISOString().split('T')[0];
          const query = encodeURIComponent(suggestion.gygSearchQuery);
          (suggestion as any).bookingUrl = `https://www.getyourguide.com/s/?q=${query}&date_from=${dateStr}&adults=${groupSize}`;
        }
      }
    }
  }

  // Enrichir les bookingWarnings globaux
  if (response.bookingWarnings) {
    for (const warning of response.bookingWarnings) {
      // Trouver le jour correspondant
      const dayNumber = response.days.find(d =>
        d.bookingAdvice?.some(a => a.attractionName === warning.attractionName)
      )?.dayNumber || 1;
      generateLinks(warning, dayNumber);
    }
  }
}

/**
 * Convertit le pool d'attractions en format résumé pour Claude
 */
export function summarizeAttractions(attractions: Attraction[]): AttractionSummary[] {
  return attractions.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    rating: a.rating || 4.0,
    description: a.description || a.name,
    latitude: a.latitude || 0,
    longitude: a.longitude || 0,
    estimatedDuration: a.duration,
    estimatedCost: a.estimatedCost || 0,
    mustSee: a.mustSee || false,
    reviewCount: a.reviewCount || 0,
  }));
}

/**
 * Mappe l'itinéraire Claude vers les attractions complètes par jour
 */
export function mapItineraryToAttractions(
  itinerary: ClaudeItineraryResponse,
  attractionPool: Attraction[],
  cityCenter?: { lat: number; lng: number },
): Attraction[][] {
  const poolMap = new Map<string, Attraction>();
  for (const a of attractionPool) {
    poolMap.set(a.id, a);
  }

  return itinerary.days.map(day => {
    const dayAttractions: Attraction[] = [];

    // Use visitOrder if available (Claude's smart geographic/temporal ordering), fallback to selectedAttractionIds
    const orderedIds = (day.visitOrder && day.visitOrder.length > 0) ? day.visitOrder : day.selectedAttractionIds;
    const selectedSet = new Set(day.selectedAttractionIds);

    const cleanName = (name: string) => name.replace(/,\s*[A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ]+)*(?:,\s*[A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ]+)*)*\s*$/, '').trim();

    for (const id of orderedIds) {
      const attraction = poolMap.get(id);
      if (attraction) {
        attraction.name = cleanName(attraction.name);
        dayAttractions.push(attraction);
        selectedSet.delete(id);
      }
    }
    // Add any remaining selectedAttractionIds not in visitOrder
    for (const id of selectedSet) {
      const attraction = poolMap.get(id);
      if (attraction) {
        attraction.name = cleanName(attraction.name);
        dayAttractions.push(attraction);
      }
    }

    // Add additionalSuggestions as generated attractions
    for (const suggestion of day.additionalSuggestions) {
      dayAttractions.push({
        id: `claude-${suggestion.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}-${Date.now()}`,
        name: suggestion.name,
        type: 'culture' as ActivityType,
        description: suggestion.whyVisit,
        duration: suggestion.estimatedDuration,
        estimatedCost: suggestion.estimatedCost,
        latitude: cityCenter?.lat || 0, // Default to city center; resolved later via API
        longitude: cityCenter?.lng || 0,
        rating: 4.5,
        mustSee: true,
        bookingRequired: !!suggestion.bookable,
        bookingUrl: suggestion.bookingUrl,
        openingHours: { open: '09:00', close: '18:00' },
        dataReliability: 'generated' as const,
      });
    }

    // Deduplicate: if two attractions have very similar names, keep the one from pool (better coords)
    const deduped = deduplicateAttractions(dayAttractions);

    // Reorder attractions by geographic proximity (nearest-neighbor) to minimize travel
    return reorderByProximity(deduped);
  });
}

/**
 * Normalize name for comparison: lowercase, strip accents, strip suffixes
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/,\s*.*/g, '') // strip everything after first comma
    .replace(/\b(le|la|les|du|de|des|l'|d')\b/g, '') // strip French articles
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two names are similar enough to be duplicates
 */
function areNamesSimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  // One contains the other
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check word overlap: if 2+ significant words match
  const wordsA = na.split(' ').filter(w => w.length > 2);
  const wordsB = nb.split(' ').filter(w => w.length > 2);
  const common = wordsA.filter(w => wordsB.includes(w));
  if (common.length >= 2) return true;
  if (common.length >= 1 && (wordsA.length <= 2 || wordsB.length <= 2)) return true;
  return false;
}

/**
 * Remove duplicate attractions within a day. Prefer pool attractions (better coords) over generated ones.
 */
function deduplicateAttractions(attractions: Attraction[]): Attraction[] {
  const result: Attraction[] = [];
  for (const a of attractions) {
    const isDupe = result.some(existing => areNamesSimilar(existing.name, a.name));
    if (isDupe) {
      console.log(`[ClaudeItinerary] Dedup: removed "${a.name}" (similar to existing)`);
      continue;
    }
    result.push(a);
  }
  return result;
}

/**
 * Réordonne les attractions par proximité géographique (nearest-neighbor greedy)
 * Commence par la première attraction, puis visite toujours la plus proche non visitée
 */
function reorderByProximity(attractions: Attraction[]): Attraction[] {
  if (attractions.length <= 2) return attractions;

  // Only reorder attractions that have valid coords
  const withCoords = attractions.filter(a => a.latitude && a.longitude);
  const withoutCoords = attractions.filter(a => !a.latitude || !a.longitude);

  if (withCoords.length <= 2) return attractions;

  const result: Attraction[] = [];
  const remaining = new Set(withCoords.map((_, i) => i));

  // Start with first attraction (usually Claude's first pick is intentional)
  let current = 0;
  result.push(withCoords[current]);
  remaining.delete(current);

  while (remaining.size > 0) {
    let nearest = -1;
    let nearestDist = Infinity;
    for (const idx of remaining) {
      const dlat = (withCoords[current].latitude - withCoords[idx].latitude) * 111;
      const dlng = (withCoords[current].longitude - withCoords[idx].longitude) * 111 * Math.cos(withCoords[current].latitude * Math.PI / 180);
      const dist = dlat * dlat + dlng * dlng; // squared distance is fine for comparison
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = idx;
      }
    }
    result.push(withCoords[nearest]);
    remaining.delete(nearest);
    current = nearest;
  }

  return [...result, ...withoutCoords];
}

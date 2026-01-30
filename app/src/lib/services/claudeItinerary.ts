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

  // Compact attraction pool for the prompt
  const poolCompact = request.attractionPool.map(a => ({
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

RÈGLES D'OR:
1. TIMING INTELLIGENT:
   - Temples, sanctuaires, marchés → tôt le matin (moins de monde, plus authentique)
   - Musées → milieu de matinée ou début d'après-midi
   - Viewpoints, observatoires → fin d'après-midi/coucher de soleil
   - Quartiers animés, rues commerçantes → fin d'après-midi/soirée
   - Parcs, jardins → selon la lumière et la saison

2. REGROUPEMENT GÉOGRAPHIQUE:
   - Groupe les attractions PROCHES le même jour (regarde les coordonnées lat/lng)
   - Ordonne-les pour minimiser les déplacements (circuit logique, pas de zig-zag)
   - Indique le quartier/zone dans le theme du jour

3. RYTHME & DURÉES RÉALISTES:
   - Jour d'arrivée: 2-3 attractions légères (jet lag, installation)
   - Jours pleins: 4-6 attractions avec pauses
   - Dernier jour: 2-3 attractions + temps pour souvenirs/shopping
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
   - Place le day trip au milieu du séjour (pas jour 1 ni dernier jour)
   - Ajoute le day trip dans additionalSuggestions avec les vraies coordonnées
   - Précise le moyen de transport ET la durée du trajet dans la description
   - isDayTrip DOIT être true pour ce jour, avec dayTripDestination et dayTripTransport renseignés

5. SAISONNALITÉ (${season}):
   - Adapte les suggestions à la saison (cerisiers printemps, illuminations hiver, plages été...)
   - Mentionne les événements/festivals si pertinents pour la date

6. FILTRAGE STRICT:
   - EXCLUE: cinémas, arcades, salles de sport, immeubles, bureaux, centres commerciaux génériques
   - EXCLUE: rooftop bars, bars d'hôtel, pubs, discothèques comme ACTIVITÉS DE JOUR (OK en suggestion soirée uniquement)
   - EXCLUE: attractions mineures de moins de 30min seules — fusionne-les dans un créneau "exploration quartier"
   - EXCLUE TOUJOURS ces tourist traps: Madame Tussauds, Hard Rock Café, Planet Hollywood, Rainforest Café, Bubba Gump, et autres chaînes touristiques internationales
   - EXCLUE: attractions avec "wax museum", "selfie museum", "trick eye", "ripley's", "believe it or not" dans le nom
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
- As-tu prévu AU MOINS 1 day trip si le séjour >= 4 jours? Si non, ajoute-le maintenant.
- As-tu au moins 1 jour avec isDayTrip=true et dayTripDestination renseigné (si >= 4 jours)?
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
    const mustHaveChecks: Record<string, string[]> = {
      'barcelona': ['sagrada', 'batlló', 'güell', 'rambla'],
      'paris': ['eiffel', 'louvre', 'sacré-cœur', 'notre-dame', 'montmartre'],
      'rome': ['colisée', 'colosseum', 'vatican', 'trevi', 'panthéon'],
      'tokyo': ['shibuya', 'senso-ji', 'meiji'],
      'london': ['big ben', 'tower', 'british museum', 'buckingham'],
      'new york': ['statue of liberty', 'central park', 'empire state', 'times square'],
    };

    const destLower = request.destination.toLowerCase();
    for (const [city, landmarks] of Object.entries(mustHaveChecks)) {
      if (destLower.includes(city)) {
        const missing = landmarks.filter(l => !allNames.includes(l) && !allNames.split(' ').some(w => w.includes(l)));
        if (missing.length > 0) {
          console.warn(`[ClaudeItinerary] ⚠️ Incontournables manquants pour ${city}: ${missing.join(', ')}`);
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
  }));
}

/**
 * Mappe l'itinéraire Claude vers les attractions complètes par jour
 */
export function mapItineraryToAttractions(
  itinerary: ClaudeItineraryResponse,
  attractionPool: Attraction[],
): Attraction[][] {
  const poolMap = new Map<string, Attraction>();
  for (const a of attractionPool) {
    poolMap.set(a.id, a);
  }

  return itinerary.days.map(day => {
    const dayAttractions: Attraction[] = [];

    for (const id of day.selectedAttractionIds) {
      const attraction = poolMap.get(id);
      if (attraction) {
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
        latitude: 0, // Will be resolved by SerpAPI search or left as generated
        longitude: 0,
        rating: 4.5,
        mustSee: true,
        bookingRequired: !!suggestion.bookable,
        bookingUrl: suggestion.bookingUrl,
        openingHours: { open: '09:00', close: '18:00' },
        dataReliability: 'generated' as const,
      });
    }

    return dayAttractions;
  });
}

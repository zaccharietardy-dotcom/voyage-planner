/**
 * Service de recherche d'attractions - VERSION SERVEUR
 * Ce fichier utilise fs et ne peut être importé que côté serveur
 *
 * Chaîne de priorité:
 * 1. Overpass + Wikidata (gratuit, illimité) + Viator en parallèle
 * 2. SerpAPI Google Local (fallback payant)
 * 3. Cache local fichier
 * 4. Claude AI (fallback ultime)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Attraction } from './attractions';
import { ActivityType } from '../types';
import { tokenTracker } from './tokenTracker';
import { searchAttractionsWithSerpApi, searchAttractionsMultiQuery, isSerpApiPlacesConfigured } from './serpApiPlaces';
import { searchAttractionsOverpass, isOverpassConfigured } from './overpassAttractions';

import { searchViatorActivities, isViatorConfigured } from './viator';
import * as fs from 'fs';
import * as path from 'path';

// Cache file path
const CACHE_DIR = path.join(process.cwd(), 'data', 'attractions-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'attractions.json');

interface AttractionsCache {
  [destination: string]: {
    attractions: Attraction[];
    fetchedAt: string;
    version: number;
  };
}

function loadCache(): AttractionsCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Erreur lecture cache attractions:', error);
  }
  return {};
}

function saveCache(cache: AttractionsCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('Erreur sauvegarde cache attractions:', error);
  }
}

function normalizeDestination(dest: string): string {
  return dest.toLowerCase().trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-');
}

function validateActivityType(type: string): ActivityType {
  const validTypes: ActivityType[] = [
    'culture', 'nature', 'gastronomy', 'beach',
    'shopping', 'nightlife', 'adventure', 'wellness'
  ];
  const normalized = type?.toLowerCase().trim() as ActivityType;
  return validTypes.includes(normalized) ? normalized : 'culture';
}

async function fetchAttractionsFromClaude(
  destination: string,
  types?: ActivityType[]
): Promise<Attraction[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }

  const client = new Anthropic({ apiKey });

  const hasUserPreferences = types && types.length > 0;
  const typesList = hasUserPreferences
    ? types.join(', ')
    : 'culture, nature, gastronomy, beach, shopping, nightlife, adventure, wellness';

  // Prompt ameliore pour prioriser les preferences utilisateur
  const prompt = `Tu es un expert en voyage. Genere une liste de 15-20 attractions touristiques REELLES et populaires pour ${destination}.

${hasUserPreferences ? `
PRIORITE ABSOLUE - L'utilisateur a EXPLICITEMENT selectionne ces types d'activites: ${typesList}

Tu DOIS inclure:
- 10-12 attractions correspondant aux preferences de l'utilisateur (${typesList})
- 4-6 incontournables absolus de ${destination} (meme si type different)
- 2-3 attractions variees pour completer

La MAJORITE (60%+) des attractions doivent correspondre aux types: ${typesList}
` : `
Inclus une variete equilibree de tous les types: ${typesList}
`}

Pour chaque attraction, fournis les informations au format JSON suivant:
{
  "id": "identifiant-unique-en-kebab-case",
  "name": "Nom officiel de l'attraction",
  "type": "culture|nature|gastronomy|beach|shopping|nightlife|adventure|wellness",
  "description": "Description courte et attrayante (1-2 phrases)",
  "duration": 120,
  "estimatedCost": 15,
  "latitude": 41.4036,
  "longitude": 2.1744,
  "rating": 4.5,
  "mustSee": true,
  "bookingRequired": false,
  "openingHours": { "open": "09:00", "close": "18:00" },
  "tips": "Conseil pratique pour les visiteurs"
}

REGLES CRITIQUES pour ${destination}:
- Inclus OBLIGATOIREMENT les monuments et sites celebres (ex: pour Pekin = Cite Interdite, Grande Muraille, Temple du Ciel)
- Utilise UNIQUEMENT des attractions qui EXISTENT VRAIMENT
- Les coordonnees GPS doivent etre EXACTES et REELLES (verifie-les!)
- Durees realistes: musee = 120-180min, monument = 60-120min, quartier = 120-240min, restaurant = 75min
- Les attractions "mustSee: true" sont les incontournables absolus de la destination

Reponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou apres.`;

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Tracker les tokens consommés
  if (response.usage) {
    tokenTracker.track(response.usage, `Attractions: ${destination}`);
  }

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Réponse Claude invalide');
  }

  let jsonStr = content.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  const attractions: Attraction[] = JSON.parse(jsonStr);

  return attractions.map((a, index) => ({
    id: a.id || `${normalizeDestination(destination)}-${index}`,
    name: a.name,
    type: validateActivityType(a.type),
    description: a.description || '',
    duration: Math.max(30, Math.min(300, a.duration || 90)),
    estimatedCost: Math.max(0, a.estimatedCost || 0),
    latitude: a.latitude || 0,
    longitude: a.longitude || 0,
    rating: Math.max(1, Math.min(5, a.rating || 4)),
    mustSee: Boolean(a.mustSee),
    bookingRequired: Boolean(a.bookingRequired),
    bookingUrl: a.bookingUrl || undefined,
    openingHours: a.openingHours || { open: '09:00', close: '18:00' },
    tips: a.tips || undefined,
  }));
}

/**
 * Estime les durées réalistes pour des attractions qui ont la durée par défaut (90 min).
 * Utilise Claude Haiku pour un batch rapide et économique.
 */
async function estimateAttractionDurations(
  attractions: Attraction[],
  destination: string
): Promise<Attraction[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return attractions;

  // Only estimate for attractions with default duration (90 min)
  const needEstimate = attractions.filter(a => a.duration === 90);
  if (needEstimate.length === 0) return attractions;

  try {
    const client = new Anthropic({ apiKey });
    const names = needEstimate.map(a => `- ${a.name} (${a.type})`).join('\n');

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Pour chaque attraction de ${destination}, estime la durée de visite typique en minutes.
Sois réaliste: un point de vue = 20-30min, un petit musée = 60-90min, un grand musée = 120-180min, un quartier à pied = 60-120min, une plage = 120-180min, un marché = 45-60min, un monument = 30-60min.

${names}

Réponds UNIQUEMENT en JSON: {"durations": {"Nom exact": minutes, ...}}`,
      }],
    });

    if (response.usage) {
      tokenTracker.track(response.usage, `Durations: ${destination}`);
    }

    const content = response.content[0];
    if (content.type !== 'text') return attractions;

    let jsonStr = content.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    const durations: Record<string, number> = parsed.durations || parsed;

    console.log(`[Server] ✅ Durées estimées pour ${Object.keys(durations).length} attractions`);

    return attractions.map(a => {
      if (a.duration !== 90) return a; // Already has real duration
      const estimated = durations[a.name];
      if (estimated && estimated >= 15 && estimated <= 300) {
        return { ...a, duration: estimated };
      }
      return a;
    });
  } catch (error) {
    console.warn('[Server] Erreur estimation durées:', error);
    return attractions;
  }
}

/**
 * Recherche des attractions depuis le cache ou Claude
 * Version serveur qui accède directement au cache fichier
 *
 * Priorité:
 * 1. SerpAPI Google Local (données réelles) + Viator en parallèle
 * 2. Cache local fichier
 * 3. Claude AI (fallback)
 * Viator est lancé en parallèle et mergé avec les résultats à chaque étape.
 */
export async function searchAttractionsFromCache(
  destination: string,
  options?: {
    types?: ActivityType[];
    forceRefresh?: boolean;
    maxResults?: number;
    cityCenter?: { lat: number; lng: number }; // Pour Viator
    dailyActivityBudget?: number; // Pour filtrer Viator par budget
  }
): Promise<Attraction[]> {
  const normalizedDest = normalizeDestination(destination);
  const cache = loadCache();
  const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours

  // 0. Lancer Viator en parallèle (non-bloquant, await au moment du merge)
  const viatorPromise: Promise<Attraction[]> = (isViatorConfigured() && options?.cityCenter)
    ? searchViatorActivities(destination, options.cityCenter, { types: options?.types, limit: 20 })
        .then(results => { console.log(`[Server] ${results.length} expériences Viator trouvées`); return results; })
        .catch(err => { console.warn('[Server] Viator error:', err); return [] as Attraction[]; })
    : Promise.resolve([]);

  // 1. PRIORITÉ: Overpass + Wikidata (gratuit, illimité)
  if (isOverpassConfigured() && options?.cityCenter) {
    try {
      console.log(`[Server] Recherche attractions via Overpass+Wikidata pour ${destination}...`);
      const attractions = await searchAttractionsOverpass(destination, options.cityCenter, {
        limit: (options.maxResults || 15) + 10,
      });

      if (attractions.length >= 5) {
        // Sauvegarder en cache fichier
        cache[normalizedDest] = {
          attractions,
          fetchedAt: new Date().toISOString(),
          version: 4, // Version 4 = Overpass+Wikidata
        };
        saveCache(cache);

        console.log(`[Server] ✅ ${attractions.length} attractions via Overpass+Wikidata`);
        const withDurations = await estimateAttractionDurations(attractions, destination);
        const viatorResults = await viatorPromise;
        const merged = mergeWithViator(withDurations, viatorResults, options?.types, options?.dailyActivityBudget);
        return filterAttractions(merged, options?.types, options?.maxResults, destination);
      } else {
        console.warn(`[Server] Overpass: seulement ${attractions.length} résultats, fallback SerpAPI...`);
      }
    } catch (error) {
      console.warn('[Server] Overpass error, trying SerpAPI:', error);
    }
  }

  // 2. FALLBACK: SerpAPI Google Maps (données RÉELLES avec multi-requêtes)
  if (isSerpApiPlacesConfigured()) {
    try {
      let attractions: Attraction[] = [];

      // Si on a les coordonnées du centre-ville, utiliser la recherche multi-requêtes améliorée
      if (options?.cityCenter) {
        console.log(`[Server] Recherche attractions via SerpAPI Multi-Query pour ${destination}...`);
        attractions = await searchAttractionsMultiQuery(destination, options.cityCenter, {
          types: options.types,
          limit: (options.maxResults || 15) + 5,
        });
      } else {
        // Fallback: recherche simple
        console.log(`[Server] Recherche attractions via SerpAPI Simple pour ${destination}...`);
        const serpAttractions = await searchAttractionsWithSerpApi(destination, {
          limit: (options?.maxResults || 15) + 5,
        });

        attractions = serpAttractions.map((a: any, index: number) => ({
          id: a.id,
          name: a.name,
          type: mapCategoryToActivityType(a.type || 'culture'),
          description: a.description || '',
          duration: 90,
          estimatedCost: estimateCostByType(mapCategoryToActivityType(a.type || 'culture'), destination),
          latitude: a.latitude || 0,
          longitude: a.longitude || 0,
          rating: a.rating || 4,
          mustSee: false,
          bookingRequired: false,
          bookingUrl: a.website,
          openingHours: a.openingHours || { open: '09:00', close: '18:00' },
          tips: undefined,
          dataReliability: 'verified' as const,
        }));
      }

      if (attractions.length > 0) {
        // Sauvegarder en cache fichier
        cache[normalizedDest] = {
          attractions,
          fetchedAt: new Date().toISOString(),
          version: 3, // Version 3 = avec multi-requêtes
        };
        saveCache(cache);

        console.log(`[Server] ✅ ${attractions.length} attractions RÉELLES via SerpAPI`);
        const withDurations = await estimateAttractionDurations(attractions, destination);
        const viatorResults = await viatorPromise;
        const merged = mergeWithViator(withDurations, viatorResults, options?.types, options?.dailyActivityBudget);
        return filterAttractions(merged, options?.types, options?.maxResults, destination);
      }
    } catch (error) {
      console.warn('[Server] SerpAPI error, trying cache/Claude:', error);
    }
  }

  // Await Viator (lancé en parallèle plus haut)
  const viatorResults = await viatorPromise;

  // 3. Vérifier le cache
  const cached = cache[normalizedDest];
  if (
    cached &&
    !options?.forceRefresh &&
    new Date().getTime() - new Date(cached.fetchedAt).getTime() < cacheMaxAge
  ) {
    console.log(`[Server] Cache hit pour ${destination} (${cached.attractions.length} attractions)`);
    const withDurations = await estimateAttractionDurations(cached.attractions, destination);
    const merged = mergeWithViator(withDurations, viatorResults, options?.types, options?.dailyActivityBudget);
    return filterAttractions(merged, options?.types, options?.maxResults, destination);
  }

  // 4. Claude AI (fallback)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log(`[Server] Cache miss pour ${destination}, appel Claude API...`);

    try {
      const attractions = await fetchAttractionsFromClaude(destination, options?.types);

      cache[normalizedDest] = {
        attractions,
        fetchedAt: new Date().toISOString(),
        version: 1,
      };
      saveCache(cache);

      console.log(`[Server] ${attractions.length} attractions mises en cache pour ${destination}`);

      const withDurations = await estimateAttractionDurations(attractions, destination);
      const merged = mergeWithViator(withDurations, viatorResults, options?.types, options?.dailyActivityBudget);
      return filterAttractions(merged, options?.types, options?.maxResults, destination);
    } catch (error) {
      console.error('[Server] Erreur recherche attractions:', error);
    }
  }

  // 5. Fallback: cache expiré ou vide
  if (cached) {
    console.warn('[Server] Utilisation du cache expiré pour', destination);
    const merged = mergeWithViator(cached.attractions, viatorResults, options?.types, options?.dailyActivityBudget);
    return filterAttractions(merged, options?.types, options?.maxResults, destination);
  }

  // 6. Si uniquement Viator a des résultats
  if (viatorResults.length > 0) {
    return filterAttractions(viatorResults, options?.types, options?.maxResults, destination);
  }

  return [];
}

/**
 * Normalise un nom d'attraction pour détecter les doublons fuzzy.
 * "Visite guidée de la Tour Eiffel" → "tour eiffel"
 */
function normalizeAttractionName(name: string): string {
  return name.toLowerCase()
    .replace(/visite guidée de |guided tour of |tour of |visit to |visite de |excursion à |trip to /gi, '')
    .replace(/^(the|le|la|les|l'|un|une|des|a|an) /i, '')
    .replace(/[''`\-:,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Known sub-attractions that are part of a larger attraction */
const KNOWN_SUB_ATTRACTIONS: Record<string, string> = {
  'wihan': 'wat pho',
  'bouddha couché': 'wat pho',
  'reclining buddha': 'wat pho',
  'emerald buddha': 'wat phra kaew',
  'chapel royal': 'grand palace',
  'sistine chapel': 'vatican',
  'chapelle sixtine': 'vatican',
};

function getSignificantWords(name: string): string[] {
  const stopWords = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'the', 'a', 'an', 'of', 'in', 'at', 'to', 'et', 'and', 'à', 'au', 'aux']);
  return name.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
}

function isFuzzyDuplicate(newName: string, existingNames: Set<string>): boolean {
  const normalized = normalizeAttractionName(newName);

  // Check known sub-attractions
  const normalizedLower = normalized.toLowerCase();
  for (const [subPart, parentName] of Object.entries(KNOWN_SUB_ATTRACTIONS)) {
    if (normalizedLower.includes(subPart)) {
      for (const existing of existingNames) {
        if (normalizeAttractionName(existing).toLowerCase().includes(parentName)) return true;
      }
    }
  }

  for (const existing of existingNames) {
    const existingNorm = normalizeAttractionName(existing);
    if (normalized === existingNorm) return true;
    if (normalized.length > 5 && existingNorm.length > 5) {
      if (normalized.includes(existingNorm) || existingNorm.includes(normalized)) return true;
    }

    // Word overlap check: if ≥60% of significant words match, it's a duplicate
    const newWords = getSignificantWords(normalized);
    const existingWords = getSignificantWords(existingNorm);
    if (newWords.length >= 2 && existingWords.length >= 2) {
      const overlap = newWords.filter(w => existingWords.some(ew => ew === w || ew.includes(w) || w.includes(ew))).length;
      const minLen = Math.min(newWords.length, existingWords.length);
      if (overlap / minLen >= 0.6) return true;
    }
  }
  return false;
}

/**
 * Combine les résultats : mustSee d'abord, puis expériences Viator filtrées, puis le reste.
 * - Max ~8 expériences Viator dans le mix
 * - Viator filtré par préférences utilisateur (types) si disponibles
 * - Dédupliqué par nom (fuzzy)
 */
function mergeWithViator(baseAttractions: Attraction[], viatorAttractions: Attraction[], types?: ActivityType[], dailyActivityBudget?: number): Attraction[] {
  if (viatorAttractions.length === 0) return baseAttractions;
  if (baseAttractions.length === 0) return viatorAttractions;

  const MAX_VIATOR = 8;
  const usedNames = new Set<string>();
  const combined: Attraction[] = [];

  const addUnique = (a: Attraction) => {
    if (!isFuzzyDuplicate(a.name, usedNames)) {
      usedNames.add(a.name);
      combined.push(a);
      return true;
    }
    return false;
  };

  // 1. MustSee POIs first (monuments, incontournables)
  for (const a of baseAttractions) {
    if (a.mustSee) addUnique(a);
  }

  // 2. Viator experiences — filtered by budget + user types, sorted by rating*reviews
  let filteredViator = [...viatorAttractions];
  // Budget filter: exclude activities > 1.5x daily budget
  if (dailyActivityBudget && dailyActivityBudget > 0) {
    const maxCost = dailyActivityBudget * 1.5;
    filteredViator = filteredViator.filter(a => a.estimatedCost <= maxCost || a.estimatedCost === 0);
  }
  if (types && types.length > 0) {
    const matching = filteredViator.filter(a => types.includes(a.type));
    const rest = filteredViator.filter(a => !types.includes(a.type));
    filteredViator = [...matching, ...rest];
  }
  filteredViator.sort((a, b) => {
    const scoreA = a.rating * Math.log10((a.reviewCount || 1) + 1);
    const scoreB = b.rating * Math.log10((b.reviewCount || 1) + 1);
    return scoreB - scoreA;
  });
  let viatorAdded = 0;
  for (const a of filteredViator) {
    if (viatorAdded >= MAX_VIATOR) break;
    if (addUnique(a)) {
      viatorAdded++;
    }
  }

  // 3. Remaining base attractions
  for (const a of baseAttractions) {
    addUnique(a);
  }

  return combined;
}

/**
 * Base de données des attractions gratuites connues
 * Organisées par ville et par nom (partiellement matching)
 */
const FREE_ATTRACTIONS: Record<string, string[]> = {
  'london': [
    // Musées nationaux gratuits
    'national gallery', 'british museum', 'natural history museum',
    'victoria and albert', 'v&a', 'tate modern', 'tate britain',
    'science museum', 'national portrait gallery', 'imperial war museum',
    // Monuments extérieurs gratuits
    'big ben', 'elizabeth tower', 'houses of parliament', 'parliament square',
    'tower bridge', 'london bridge', 'westminster abbey', // Extérieur gratuit
    'buckingham palace', // Extérieur gratuit
    // Places et parcs
    'trafalgar square', 'piccadilly circus', 'leicester square',
    'hyde park', 'regent\'s park', 'green park', 'st james\'s park',
    'greenwich park', 'kensington gardens',
    // Marchés
    'borough market', 'camden market', 'portobello', 'brick lane',
    // Quartiers
    'soho', 'covent garden', 'notting hill', 'shoreditch',
  ],
  'londres': [
    'national gallery', 'british museum', 'natural history museum',
    'victoria and albert', 'v&a', 'tate modern', 'tate britain',
    'science museum', 'big ben', 'tower bridge', 'hyde park',
    'trafalgar square', 'piccadilly circus', 'buckingham palace',
  ],
  'paris': [
    'notre-dame', 'sacré-cœur', 'sacre-coeur', 'basilique sacré-cœur',
    'champs-élysées', 'champs elysees', 'avenue des champs',
    'jardin du luxembourg', 'jardin des tuileries', 'parc des buttes-chaumont',
    'place de la concorde', 'place vendôme', 'place des vosges',
    'montmartre', 'quartier latin', 'le marais',
    'pont alexandre', 'pont des arts', 'pont neuf',
    'père lachaise', 'cimetière',
  ],
  'rome': [
    'fontaine de trevi', 'trevi fountain', 'fontana di trevi',
    'piazza navona', 'place navone',
    'panthéon', 'pantheon', // Note: maintenant payant mais prix symbolique
    'place d\'espagne', 'spanish steps', 'piazza di spagna',
    'trastevere', 'quartier trastevere',
    'villa borghese', 'park villa borghese',
    'campo de\' fiori', 'campo dei fiori',
    'forum romain', // Extérieur visible gratuitement
  ],
  'amsterdam': [
    'vondelpark', 'jordaan', 'quartier jordaan',
    'dam square', 'place du dam',
    'begijnhof',
    'waterlooplein', 'marché aux puces',
    'negen straatjes', 'nine streets',
  ],
  'barcelona': [
    'la rambla', 'las ramblas', 'ramblas',
    'barceloneta', 'plage barceloneta',
    'quartier gothique', 'gothic quarter', 'barri gotic',
    'parc de la ciutadella', 'ciutadella',
    'montjuïc', 'montjuic',
  ],
  'barcelone': [
    'la rambla', 'barceloneta', 'quartier gothique', 'montjuïc',
  ],
  'bangkok': [
    // Temples gratuits (extérieur) et sanctuaires
    'ganesha shrine', 'ganesha temple', 'erawan shrine',
    'golden mount', 'wat saket', // Golden Mount: 50 baht = ~1.3€ (quasi gratuit)
    // Marchés et quartiers
    'chatuchak', 'khao san', 'chinatown', 'yaowarat',
    'asiatique', 'jodd fairs',
    // Parcs
    'lumphini park', 'lumpini', 'benjakitti park', 'benchasiri park',
    // Rues piétonnes / promenades
    'silom', 'sukhumvit', 'siam square',
  ],
  'tokyo': [
    'meiji shrine', 'senso-ji', 'asakusa', 'shibuya crossing',
    'harajuku', 'takeshita street', 'ueno park', 'yoyogi park',
    'imperial palace', 'tsukiji outer market', 'akihabara',
    'shinjuku gyoen', // 500¥ = ~3€
  ],
  'lisbon': [
    'alfama', 'bairro alto', 'praça do comércio', 'commerce square',
    'miradouro', 'viewpoint', 'time out market',
    'ponte 25 de abril', 'rossio', 'chiado',
  ],
  'lisbonne': [
    'alfama', 'bairro alto', 'praça do comércio', 'miradouro',
  ],
  'prague': [
    'charles bridge', 'pont charles', 'old town square',
    'place vieille ville', 'astronomical clock',
    'wenceslas square', 'petrin hill', 'john lennon wall',
    'letna park', 'vysehrad',
  ],
};

/**
 * Vérifie si une attraction est connue comme gratuite
 */
function isAttractionFree(name: string, city: string): boolean {
  const normalizedCity = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Vérifier dans la ville spécifique
  const cityFreeList = FREE_ATTRACTIONS[normalizedCity] || [];
  if (cityFreeList.some(free => normalizedName.includes(free) || free.includes(normalizedName.split(' ')[0]))) {
    return true;
  }

  // Vérifier aussi avec les alias de ville
  for (const [cityKey, freeList] of Object.entries(FREE_ATTRACTIONS)) {
    if (normalizedCity.includes(cityKey) || cityKey.includes(normalizedCity)) {
      if (freeList.some(free => normalizedName.includes(free) || free.includes(normalizedName.split(' ')[0]))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Estime le coût d'entrée par personne en fonction du type d'activité et de la destination.
 * Les pays à faible coût (Asie du Sud-Est, Amérique latine, etc.) ont des prix réduits.
 */
function estimateCostByType(type: ActivityType, destination: string): number {
  const lowCostCountries = /thailand|bangkok|vietnam|cambodia|laos|myanmar|indonesia|bali|philippines|india|nepal|sri lanka|mexico|colombia|peru|bolivia|ecuador|guatemala|morocco|egypt|tunisia|turkey/i;
  const isLowCost = lowCostCountries.test(destination);
  const factor = isLowCost ? 0.3 : 1;

  switch (type) {
    case 'nature':
    case 'beach':
      return Math.round(2 * factor); // Parcs, plages, randonnées: souvent gratuit ou très peu
    case 'culture':
      return Math.round(8 * factor); // Temples, monuments: 0-15€ en Europe, 0-5€ en Asie
    case 'adventure':
      return Math.round(25 * factor); // Activités encadrées
    case 'gastronomy':
      return Math.round(15 * factor); // Marchés, food tours
    case 'nightlife':
      return Math.round(10 * factor); // Bars, clubs (coût d'entrée)
    case 'shopping':
      return 0; // Pas de coût d'entrée
    case 'wellness':
      return Math.round(20 * factor);
    default:
      return Math.round(10 * factor);
  }
}

/**
 * Corrige le prix des attractions en fonction de la base de données des attractions gratuites
 */
function correctAttractionCost(attraction: Attraction, city: string): Attraction {
  if (isAttractionFree(attraction.name, city)) {
    return { ...attraction, estimatedCost: 0 };
  }
  return attraction;
}

function mapCategoryToActivityType(category: string): ActivityType {
  const lowerCategory = category.toLowerCase();

  if (lowerCategory.includes('museum') || lowerCategory.includes('art') || lowerCategory.includes('historic')) {
    return 'culture';
  }
  if (lowerCategory.includes('park') || lowerCategory.includes('garden') || lowerCategory.includes('nature')) {
    return 'nature';
  }
  if (lowerCategory.includes('beach')) {
    return 'beach';
  }
  if (lowerCategory.includes('shop') || lowerCategory.includes('mall') || lowerCategory.includes('market')) {
    return 'shopping';
  }
  if (lowerCategory.includes('bar') || lowerCategory.includes('club') || lowerCategory.includes('night')) {
    return 'nightlife';
  }
  if (lowerCategory.includes('spa') || lowerCategory.includes('wellness')) {
    return 'wellness';
  }
  if (lowerCategory.includes('restaurant') || lowerCategory.includes('food')) {
    return 'gastronomy';
  }
  if (lowerCategory.includes('sport') || lowerCategory.includes('adventure')) {
    return 'adventure';
  }

  return 'culture'; // Défaut
}

function filterAttractions(
  attractions: Attraction[],
  types?: ActivityType[],
  maxResults?: number,
  city?: string
): Attraction[] {
  let filtered = attractions;

  // Corriger les prix des attractions gratuites connues
  if (city) {
    filtered = filtered.map(a => correctAttractionCost(a, city));
  }

  // Prioritize matching types but don't exclude others entirely
  // Keep max 40% of non-matching "culture" activities if culture isn't in user preferences
  if (types && types.length > 0) {
    const matching = filtered.filter(a => types.includes(a.type));
    const nonMatching = filtered.filter(a => !types.includes(a.type));
    // Limit non-matching culture items to ~40% of total
    const maxNonMatching = Math.ceil(filtered.length * 0.4);
    filtered = [...matching, ...nonMatching.slice(0, maxNonMatching)];
  }

  if (maxResults && maxResults > 0) {
    filtered = filtered.slice(0, maxResults);
  }

  return filtered;
}

/**
 * Vérifie si une destination est en cache
 */
export function isDestinationInCache(destination: string): boolean {
  const cache = loadCache();
  const normalizedDest = normalizeDestination(destination);
  return normalizedDest in cache;
}

/**
 * Liste toutes les destinations en cache
 */
export function getCachedDestinationsList(): string[] {
  const cache = loadCache();
  return Object.keys(cache);
}


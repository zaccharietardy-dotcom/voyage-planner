import Anthropic from '@anthropic-ai/sdk';
import type { ActivityType, BudgetLevel, GroupType, DurationSuggestion, DestinationSuggestion } from '../types';

const HAIKU_MODEL = 'claude-haiku-4-5';

interface SuggestionContext {
  activities?: ActivityType[];
  budgetLevel?: BudgetLevel;
  groupType?: GroupType;
  origin?: string;
  durationDays?: number;
}

interface SuggestionIntent {
  wantsBeach: boolean;
  wantsWarmSwim: boolean;
  wantsSummer: boolean;
}

type WarmSwimTemplate = Omit<DestinationSuggestion, 'stages' | 'estimatedBudget'> & {
  stages: Array<{ city: string; minDays: number; weight: number }>;
  budgetPerDay: {
    economic: [number, number];
    moderate: [number, number];
    comfort: [number, number];
    luxury: [number, number];
  };
};

const GROUP_QUERY_HINTS: Array<{ type: GroupType; patterns: RegExp[] }> = [
  {
    type: 'family_with_kids',
    patterns: [
      /\b(avec|with)\s+(mes?\s+)?(enfants?|kids?|child(?:ren)?)\b/i,
      /\b(famille|family)\s+(avec|with)\s+(enfants?|kids?)\b/i,
      /\b(bebe|bébé|toddler)\b/i,
    ],
  },
  {
    type: 'family_without_kids',
    patterns: [
      /\b(avec|with)\s+(ma|mon|mes|maman|mère|mere|mom|mother|papa|père|pere|father|parents)\b/i,
      /\b(avec|with)\s+(ma|mon|mes)?\s*(soeur|sœur|brother|frere|frère|sibling)\b/i,
      /\b(en\s+famille|family\s+trip)\b/i,
    ],
  },
  {
    type: 'friends',
    patterns: [
      /\b(avec|with)\s+(des?\s+)?(amis?|friends?|potes?)\b/i,
      /\b(entre\s+amis?|friends\s+trip)\b/i,
    ],
  },
  {
    type: 'solo',
    patterns: [
      /\b(solo|seul(?:e)?|alone)\b/i,
      /\b(en\s+solo)\b/i,
    ],
  },
  {
    type: 'couple',
    patterns: [
      /\b(couple|romantique|romantic|honeymoon|lune\s+de\s+miel)\b/i,
      /\b(avec|with)\s+(ma|mon)\s+(femme|mari|wife|husband|copine|copain|partner)\b/i,
    ],
  },
];

export function inferGroupTypeFromQuery(query: string): GroupType | null {
  const raw = (query || '').trim();
  if (!raw) return null;
  for (const entry of GROUP_QUERY_HINTS) {
    if (entry.patterns.some((pattern) => pattern.test(raw))) {
      return entry.type;
    }
  }
  return null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BEACH_ACTIVITY_SET = new Set<ActivityType>(['beach']);
const SUMMER_KEYWORDS = /\b(ete|été|summer|juillet|aout|août|juin|septembre)\b/i;
const SWIM_KEYWORDS = /\b(baign|swim|nager|mer chaude|eau chaude|plage)\b/i;
const COLD_SWIM_KEYWORDS = /\b(surf|vagues?|cold ?water|eau froide|wild swim|eau vivifiante)\b/i;
const COLD_WATER_DESTINATION_KEYWORDS = /\b(achill|ireland|irlande|connemara|clifden|westport|clare island|ecosse|scotland|islande|iceland|norvege|norway|mer du nord|north sea|faroe|féroé)\b/i;

function inferSuggestionIntent(query: string, context: SuggestionContext): SuggestionIntent {
  const normalizedQuery = normalizeText(query);
  const wantsBeach = BEACH_ACTIVITY_SET.has('beach')
    ? (context.activities || []).includes('beach') || /\b(plage|beach|bord de mer|cotiere?|côtière)\b/i.test(normalizedQuery)
    : false;
  const wantsSummer = SUMMER_KEYWORDS.test(normalizedQuery);
  const swimSignal = SWIM_KEYWORDS.test(normalizedQuery);
  const explicitColdPreference = COLD_SWIM_KEYWORDS.test(normalizedQuery);
  return {
    wantsBeach,
    wantsSummer,
    wantsWarmSwim: wantsBeach && (swimSignal || wantsSummer) && !explicitColdPreference,
  };
}

function distributeDays(
  stages: Array<{ city: string; minDays: number; weight: number }>,
  totalDays: number,
): Array<{ city: string; days: number }> {
  const safeDays = Math.max(stages.reduce((sum, stage) => sum + stage.minDays, 0), totalDays || 4);
  const assigned = stages.map((stage) => ({ city: stage.city, days: stage.minDays, weight: stage.weight }));
  let remaining = safeDays - assigned.reduce((sum, stage) => sum + stage.days, 0);
  while (remaining > 0) {
    assigned.sort((a, b) => b.weight - a.weight);
    assigned[0].days += 1;
    remaining -= 1;
  }
  return assigned.map(({ city, days }) => ({ city, days }));
}

function formatBudgetRange(
  budgetLevel: BudgetLevel | undefined,
  days: number,
  budgetPerDay: WarmSwimTemplate['budgetPerDay'],
): string {
  const level: BudgetLevel = budgetLevel || 'moderate';
  const [minPerDay, maxPerDay] = budgetPerDay[level];
  const safeDays = Math.max(3, days || 4);
  const min = minPerDay * safeDays;
  const max = maxPerDay * safeDays;
  return `${min}-${max}€`;
}

function suggestionPrimaryKey(suggestion: DestinationSuggestion): string {
  const firstStage = suggestion.stages?.[0];
  if (!firstStage?.city) return normalizeText(suggestion.title || '');
  return normalizeText(firstStage.city);
}

function isColdWaterSuggestion(suggestion: DestinationSuggestion): boolean {
  const haystack = `${suggestion.title} ${suggestion.description} ${suggestion.stages.map((stage) => stage.city).join(' ')} ${suggestion.highlights.join(' ')}`;
  return COLD_WATER_DESTINATION_KEYWORDS.test(normalizeText(haystack));
}

const WARM_SWIM_TEMPLATES: WarmSwimTemplate[] = [
  {
    title: 'Costa del Sol : plage + ambiance andalouse',
    type: 'single_city',
    stages: [{ city: 'Málaga', minDays: 4, weight: 3 }],
    highlights: [
      'Baignade quotidienne à La Malagueta et Playa de la Misericordia',
      'Excursion courte à Nerja et ses criques claires',
      'Vieille ville animée le soir sans gros trajets',
    ],
    description: 'Base unique à Málaga pour alterner baignade, tapas et visites culturelles légères sans changer d’hôtel.',
    bestSeason: 'Mai à septembre',
    budgetPerDay: {
      economic: [85, 115],
      moderate: [120, 165],
      comfort: [170, 240],
      luxury: [260, 420],
    },
  },
  {
    title: 'Algarve détente : Lagos + Faro',
    type: 'multi_city',
    stages: [
      { city: 'Lagos', minDays: 2, weight: 3 },
      { city: 'Faro', minDays: 2, weight: 2 },
    ],
    highlights: [
      'Plages baignables de Ponta da Piedade et Praia Dona Ana',
      'Falaises dorées + eau plus chaude que l’Atlantique nord',
      'Rythme chill avec petits transferts',
    ],
    description: 'Un mix mer + villages côtiers avec peu de kilomètres et de vraies journées plage.',
    bestSeason: 'Juin à septembre',
    budgetPerDay: {
      economic: [80, 110],
      moderate: [115, 160],
      comfort: [165, 230],
      luxury: [250, 390],
    },
  },
  {
    title: 'Majorque : calas turquoise sans road trip lourd',
    type: 'single_city',
    stages: [{ city: 'Palma de Majorque', minDays: 4, weight: 3 }],
    highlights: [
      'Criques baignables (Cala Pi, Cala Blava, Es Trenc)',
      'Eau chaude et transparente en plein été',
      'Option bateau journée vers les calas du sud',
    ],
    description: 'Séjour mer orienté baignade avec base pratique et excursions courtes.',
    bestSeason: 'Mai à octobre',
    budgetPerDay: {
      economic: [95, 130],
      moderate: [130, 185],
      comfort: [190, 260],
      luxury: [290, 460],
    },
  },
  {
    title: 'Crète Ouest : Chania + plages iconiques',
    type: 'road_trip',
    stages: [
      { city: 'La Canée', minDays: 3, weight: 3 },
      { city: 'Réthymnon', minDays: 1, weight: 1 },
    ],
    highlights: [
      'Baignades à Elafonissi, Balos et Falassarna',
      'Eau chaude, plages larges, météo très stable en été',
      'Road trip léger avec transferts cohérents',
    ],
    description: 'Parfait pour priorité baignade avec un peu de variété locale sans trajets extrêmes.',
    bestSeason: 'Juin à septembre',
    budgetPerDay: {
      economic: [85, 120],
      moderate: [120, 170],
      comfort: [175, 250],
      luxury: [270, 430],
    },
  },
  {
    title: 'Costa Blanca : Alicante + criques de Jávea',
    type: 'road_trip',
    stages: [
      { city: 'Alicante', minDays: 2, weight: 2 },
      { city: 'Jávea', minDays: 2, weight: 2 },
    ],
    highlights: [
      'Plages urbaines + criques limpides baignables',
      'Temps de route courts entre spots',
      'Très bon rapport qualité/prix',
    ],
    description: 'Un road trip court optimisé baignade avec coûts maîtrisés.',
    bestSeason: 'Mai à septembre',
    budgetPerDay: {
      economic: [80, 110],
      moderate: [115, 160],
      comfort: [165, 235],
      luxury: [250, 390],
    },
  },
  {
    title: 'Sardaigne Sud : Cagliari + Villasimius',
    type: 'road_trip',
    stages: [
      { city: 'Cagliari', minDays: 2, weight: 2 },
      { city: 'Villasimius', minDays: 2, weight: 2 },
    ],
    highlights: [
      'Eaux turquoise et plages très baignables',
      'Ambiance chill avec restos de bord de mer',
      'Transferts simples et cohérents',
    ],
    description: 'Idéal pour se baigner tous les jours tout en gardant un voyage facile à exécuter.',
    bestSeason: 'Juin à septembre',
    budgetPerDay: {
      economic: [95, 130],
      moderate: [135, 185],
      comfort: [195, 275],
      luxury: [300, 480],
    },
  },
];

function buildWarmSwimFallbackSuggestions(context: SuggestionContext): DestinationSuggestion[] {
  const totalDays = Math.max(3, context.durationDays || 4);
  return WARM_SWIM_TEMPLATES.map((template) => ({
    title: template.title,
    type: template.type,
    stages: distributeDays(template.stages, totalDays),
    highlights: template.highlights.slice(0, 3),
    description: template.description,
    estimatedBudget: formatBudgetRange(context.budgetLevel, totalDays, template.budgetPerDay),
    bestSeason: template.bestSeason,
  }));
}

function enforceSuggestionQuality(
  rawSuggestions: DestinationSuggestion[],
  query: string,
  context: SuggestionContext,
): DestinationSuggestion[] {
  const intent = inferSuggestionIntent(query, context);
  const deduped: DestinationSuggestion[] = [];
  const seenPrimary = new Set<string>();
  for (const suggestion of rawSuggestions) {
    const key = suggestionPrimaryKey(suggestion);
    if (!key || seenPrimary.has(key)) continue;
    seenPrimary.add(key);
    deduped.push(suggestion);
  }

  let filtered = deduped;
  if (intent.wantsWarmSwim) {
    filtered = filtered.filter((suggestion) => !isColdWaterSuggestion(suggestion));
  }

  const fallbackPool = intent.wantsWarmSwim
    ? buildWarmSwimFallbackSuggestions(context)
    : [];
  for (const fallback of fallbackPool) {
    if (filtered.length >= 4) break;
    const key = suggestionPrimaryKey(fallback);
    if (!key || seenPrimary.has(key)) continue;
    seenPrimary.add(key);
    filtered.push(fallback);
  }

  return filtered.slice(0, 4);
}

export const __suggestionsTestables = {
  inferSuggestionIntent,
  enforceSuggestionQuality,
  buildWarmSwimFallbackSuggestions,
};

export async function generateDurationSuggestion(
  destination: string,
  context: SuggestionContext,
  apiKey?: string
): Promise<DurationSuggestion> {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  const contextParts: string[] = [];
  if (context.activities?.length) contextParts.push(`Activités souhaitées: ${context.activities.join(', ')}`);
  if (context.budgetLevel) contextParts.push(`Budget: ${context.budgetLevel}`);
  if (context.groupType) contextParts.push(`Type de groupe: ${context.groupType}`);

  const prompt = `Tu es un expert en voyage. L'utilisateur veut visiter "${destination}".
${contextParts.length > 0 ? `Contexte: ${contextParts.join('. ')}.` : ''}

Recommande la durée idéale du séjour en nombre de jours. Prends en compte:
- Le nombre d'attractions et activités majeures disponibles
- Le rythme de visite adapté au type de groupe
- Les excursions/day trips possibles depuis cette destination
- Le temps nécessaire pour profiter de l'ambiance locale

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks):
{
  "optimal": <nombre de jours recommandé>,
  "minimum": <minimum pour voir l'essentiel>,
  "maximum": <au-delà, on commence à tourner en rond>,
  "reasoning": "<explication courte en 1-2 phrases>",
  "highlights": {
    "<N1>": "<ce qu'on peut faire en N1 jours>",
    "<N2>": "<ce qu'on peut faire en N2 jours>",
    "<N3>": "<ce qu'on peut faire en N3 jours>"
  }
}

Les clés de "highlights" doivent être les nombres correspondant à minimum, optimal et maximum.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text.trim());
    return {
      optimal: parsed.optimal,
      minimum: parsed.minimum,
      maximum: parsed.maximum,
      reasoning: parsed.reasoning,
      highlights: parsed.highlights,
    };
  } catch {
    // Essayer d'extraire le JSON d'un bloc markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        optimal: parsed.optimal,
        minimum: parsed.minimum,
        maximum: parsed.maximum,
        reasoning: parsed.reasoning,
        highlights: parsed.highlights,
      };
    }
    throw new Error('Failed to parse duration suggestion response');
  }
}

export async function generateDestinationSuggestions(
  query: string,
  context: SuggestionContext,
  apiKey?: string
): Promise<DestinationSuggestion[]> {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const inferredGroupType = inferGroupTypeFromQuery(query);
  const effectiveGroupType = inferredGroupType || context.groupType;

  const contextParts: string[] = [];
  if (context.origin) contextParts.push(`Ville de départ: ${context.origin}`);
  if (context.activities?.length) contextParts.push(`Activités souhaitées: ${context.activities.join(', ')}`);
  if (context.budgetLevel) contextParts.push(`Budget: ${context.budgetLevel}`);
  if (effectiveGroupType) contextParts.push(`Type de groupe: ${effectiveGroupType}`);
  if (context.durationDays) contextParts.push(`Durée souhaitée: ${context.durationDays} jours`);
  if (inferredGroupType && context.groupType && inferredGroupType !== context.groupType) {
    contextParts.push(`Signal utilisateur prioritaire détecté dans la requête: ${inferredGroupType}`);
  }
  const intent = inferSuggestionIntent(query, context);
  if (intent.wantsWarmSwim) {
    contextParts.push('Contrainte prioritaire: baignade confortable en été (eau chaude), éviter destinations eau froide');
  }

  const prompt = `Tu es un expert en voyage. L'utilisateur a une idée vague de voyage: "${query}".
${contextParts.length > 0 ? `Contexte: ${contextParts.join('. ')}.` : ''}

Contraintes strictes:
- N'écris PAS de framing romantique/couple si le type de groupe n'est pas "couple".
- N'inclus jamais d'agence de voyage, office du tourisme, ni point d'information comme "activité".
- Donne uniquement des étapes plausibles et cohérentes géographiquement.
- Les 4 suggestions doivent être VRAIMENT différentes (pas 4 variantes quasi identiques de la même zone).
- Les suggestions doivent avoir 4 villes de départ de circuit différentes (ou au minimum 3 pays différents).
${intent.wantsWarmSwim ? '- Interdit de proposer eau froide (Irlande/Écosse/Islande/Atlantique nord) sauf demande explicite de surf/eau froide.' : ''}
${intent.wantsWarmSwim ? '- Priorise Méditerranée et zones baignables chaudes en été.' : ''}

Propose exactement 4 itinéraires concrets et variés. Pour chaque suggestion:
- Donne un titre accrocheur
- Indique si c'est une ville unique, un multi-villes, ou un road trip
- Détaille les étapes (ville + nombre de jours recommandé)
- Liste 2-3 points forts
- Estime le budget par personne (hors vol)
- Indique la meilleure saison

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks):
{
  "suggestions": [
    {
      "title": "<titre accrocheur>",
      "type": "single_city" | "multi_city" | "road_trip",
      "stages": [{"city": "<ville>", "days": <nombre>}],
      "highlights": ["<point fort 1>", "<point fort 2>", "<point fort 3>"],
      "description": "<description courte 1-2 phrases>",
      "estimatedBudget": "<range en euros/pers hors vol>",
      "bestSeason": "<meilleure période>"
    }
  ]
}`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text.trim());
    const suggestions = (parsed.suggestions || []).map((s: Record<string, unknown>) => ({
      title: s.title as string,
      type: s.type as DestinationSuggestion['type'],
      stages: (s.stages as Array<{ city: string; days: number }>).map((st) => ({
        city: st.city,
        days: st.days,
      })),
      highlights: s.highlights as string[],
      description: s.description as string,
      estimatedBudget: s.estimatedBudget as string,
      bestSeason: s.bestSeason as string | undefined,
    })).slice(0, 6);
    return enforceSuggestionQuality(suggestions, query, context);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const suggestions = (parsed.suggestions || []).map((s: Record<string, unknown>) => ({
        title: s.title as string,
        type: s.type as DestinationSuggestion['type'],
        stages: (s.stages as Array<{ city: string; days: number }>).map((st) => ({
          city: st.city,
          days: st.days,
        })),
        highlights: s.highlights as string[],
        description: s.description as string,
        estimatedBudget: s.estimatedBudget as string,
        bestSeason: s.bestSeason as string | undefined,
      })).slice(0, 6);
      return enforceSuggestionQuality(suggestions, query, context);
    }
    throw new Error('Failed to parse destination suggestions response');
  }
}

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

  const prompt = `Tu es un expert en voyage. L'utilisateur a une idée vague de voyage: "${query}".
${contextParts.length > 0 ? `Contexte: ${contextParts.join('. ')}.` : ''}

Contraintes strictes:
- N'écris PAS de framing romantique/couple si le type de groupe n'est pas "couple".
- N'inclus jamais d'agence de voyage, office du tourisme, ni point d'information comme "activité".
- Donne uniquement des étapes plausibles et cohérentes géographiquement.

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
    return (parsed.suggestions || []).map((s: Record<string, unknown>) => ({
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
    })).slice(0, 4);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return (parsed.suggestions || []).map((s: Record<string, unknown>) => ({
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
      })).slice(0, 4);
    }
    throw new Error('Failed to parse destination suggestions response');
  }
}

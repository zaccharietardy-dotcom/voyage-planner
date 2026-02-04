/**
 * Intent Classifier Service
 *
 * Utilise Claude Haiku pour classifier rapidement l'intention
 * de modification de l'utilisateur dans le chatbot.
 *
 * Coût estimé: ~$0.001 par classification
 */

import Anthropic from '@anthropic-ai/sdk';
import { ModificationIntent, ModificationIntentType, TripDay } from '../types';

// ============================================
// Types
// ============================================

export interface TripContext {
  destination: string;
  durationDays: number;
  days: TripDaySummary[];
}

export interface TripDaySummary {
  dayNumber: number;
  date: string;
  theme?: string;
  isDayTrip?: boolean;
  items: TripItemSummary[];
}

export interface TripItemSummary {
  id: string;
  type: string;
  title: string;
  startTime: string;
  endTime: string;
}

// ============================================
// Context Builder
// ============================================

/**
 * Crée un résumé compact du voyage pour le prompt
 */
export function buildTripContext(destination: string, days: TripDay[]): TripContext {
  return {
    destination,
    durationDays: days.length,
    days: days.map(day => ({
      dayNumber: day.dayNumber,
      date: day.date instanceof Date ? day.date.toISOString().split('T')[0] : String(day.date).split('T')[0],
      theme: day.theme,
      isDayTrip: day.isDayTrip,
      items: day.items.map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        startTime: item.startTime,
        endTime: item.endTime,
      })),
    })),
  };
}

// ============================================
// Prompt
// ============================================

function buildClassificationPrompt(message: string, context: TripContext): string {
  const daySummaries = context.days.map(d => {
    const items = d.items
      .map(i => `  - ${i.startTime}-${i.endTime}: ${i.title} (${i.type})`)
      .join('\n');
    return `Jour ${d.dayNumber}${d.theme ? ` - ${d.theme}` : ''}${d.isDayTrip ? ' [Day Trip]' : ''}:\n${items || '  (pas d\'activités)'}`;
  }).join('\n\n');

  return `Tu es un assistant de planification de voyage intelligent. Analyse la demande de l'utilisateur et identifie l'intention de modification.

CONTEXTE DU VOYAGE:
- Destination: ${context.destination}
- Durée: ${context.durationDays} jours

ITINÉRAIRE ACTUEL:
${daySummaries}

TYPES D'INTENTIONS POSSIBLES:
1. shift_times: Décaler des horaires ("je veux me lever plus tard", "commencer plus tôt", "décaler tout de 1h")
2. swap_activity: Remplacer une activité ("remplace X par Y", "je préfère Y au lieu de X")
3. add_activity: Ajouter une activité ("ajoute un restaurant japonais", "je voudrais visiter X")
4. remove_activity: Supprimer une activité ("supprime X", "enlève la visite de Y", "retire")
5. extend_free_time: Ajouter du temps libre ("plus de temps libre", "moins d'activités", "journée plus relax")
6. reorder_day: Réorganiser un jour ("change l'ordre", "inverse le matin et l'après-midi")
7. change_restaurant: Changer un restaurant ("autre restaurant", "je veux manger italien plutôt")
8. adjust_duration: Modifier la durée d'une activité ("plus de temps au Louvre", "moins de temps au musée")
9. add_day: Ajouter un jour au voyage ("ajoute un jour", "insère une journée libre entre le jour 2 et 3", "rajoute un jour")
10. clarification: La demande n'est pas claire, besoin de plus d'informations
11. general_question: Question générale qui ne nécessite pas de modification

RÈGLES IMPORTANTES:
- Si l'utilisateur mentionne "matin", "me lever", "grasse matinée", "dormir plus" → c'est shift_times avec scope "morning_only". Ne PAS décaler toute la journée !
- Si l'utilisateur dit explicitement "décale tout", "pousse tout", "recule tout" → c'est shift_times avec scope "full_day"
- Par défaut pour shift_times, utilise scope "morning_only" sauf si l'utilisateur dit clairement de tout décaler
- Si l'utilisateur mentionne un restaurant ou repas spécifique → change_restaurant
- Si l'utilisateur veut "ajouter un jour", "insérer une journée", "rajouter un jour" → add_day. Identifie insertAfterDay
- Si la demande est vague → clarification avec une question
- Identifie les jours concernés (tous si non spécifié pour shift_times)
- Identifie l'activité ciblée si applicable (match par nom)

CONTRAINTES DE COHÉRENCE:
- Les vols sont IMMUTABLES (horaires fixes, réservation)
- Les check-in/check-out sont fixes
- Les restaurants du midi doivent rester entre 11h30 et 14h00
- Les restaurants du soir doivent rester entre 18h30 et 21h30
- Ne jamais proposer de décaler un repas en dehors de ses créneaux normaux
- Le timeShift par défaut est 60 min, mais si l'utilisateur dit "30 min" ou "2h" adapte en conséquence

MESSAGE UTILISATEUR: "${message}"

Réponds UNIQUEMENT en JSON valide (pas de texte avant ou après):
{
  "type": "...",
  "confidence": 0.0-1.0,
  "parameters": {
    "dayNumbers": [1, 2],
    "targetActivity": "nom de l'activité ciblée ou null",
    "targetItemId": "id si identifiable ou null",
    "newValue": "nouvelle valeur ou null",
    "timeShift": 60,
    "direction": "later ou earlier ou null",
    "scope": "morning_only ou full_day ou null",
    "mealType": "breakfast/lunch/dinner ou null",
    "cuisineType": "type de cuisine ou null",
    "duration": null,
    "insertAfterDay": null
  },
  "explanation": "Explication courte de ce que l'utilisateur veut"
}`;
}

// ============================================
// Main function
// ============================================

export async function classifyIntent(
  message: string,
  tripContext: TripContext
): Promise<ModificationIntent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn('[IntentClassifier] ANTHROPIC_API_KEY non configurée');
    return {
      type: 'clarification',
      confidence: 0,
      parameters: {},
      explanation: 'Service de chat temporairement indisponible.',
    };
  }

  const client = new Anthropic({ apiKey });
  const prompt = buildClassificationPrompt(message, tripContext);

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[IntentClassifier] No JSON found in response:', text);
      return {
        type: 'clarification',
        confidence: 0.5,
        parameters: {},
        explanation: "Je n'ai pas bien compris votre demande. Pouvez-vous reformuler ?",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate type
    const validTypes: ModificationIntentType[] = [
      'shift_times', 'swap_activity', 'add_activity', 'remove_activity',
      'extend_free_time', 'reorder_day', 'change_restaurant', 'adjust_duration',
      'add_day', 'clarification', 'general_question'
    ];

    if (!validTypes.includes(parsed.type)) {
      parsed.type = 'clarification';
    }

    return {
      type: parsed.type as ModificationIntentType,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      parameters: {
        dayNumbers: parsed.parameters?.dayNumbers || [],
        targetActivity: parsed.parameters?.targetActivity || undefined,
        targetItemId: parsed.parameters?.targetItemId || undefined,
        newValue: parsed.parameters?.newValue || undefined,
        timeShift: parsed.parameters?.timeShift || undefined,
        direction: parsed.parameters?.direction || undefined,
        scope: parsed.parameters?.scope || undefined,
        mealType: parsed.parameters?.mealType || undefined,
        cuisineType: parsed.parameters?.cuisineType || undefined,
        duration: parsed.parameters?.duration || undefined,
        insertAfterDay: parsed.parameters?.insertAfterDay || undefined,
      },
      explanation: parsed.explanation || '',
    };
  } catch (error) {
    console.error('[IntentClassifier] Error:', error);
    return {
      type: 'clarification',
      confidence: 0,
      parameters: {},
      explanation: 'Une erreur est survenue. Veuillez réessayer.',
    };
  }
}

/**
 * Détermine si on doit utiliser Sonnet (complexe) ou Haiku (simple)
 */
export function shouldUseSonnet(intent: ModificationIntent): boolean {
  // Utilise Sonnet pour:
  // - Modifications multi-jours
  // - Faible confiance (besoin de plus de réflexion)
  // - Réorganisation complète
  // - Ajout d'activités (nécessite créativité)

  const dayCount = intent.parameters.dayNumbers?.length || 0;

  if (dayCount > 1) return true;
  if (intent.confidence < 0.7) return true;
  if (intent.type === 'reorder_day') return true;
  if (intent.type === 'add_activity') return true;

  return false;
}

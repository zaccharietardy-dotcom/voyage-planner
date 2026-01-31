/**
 * Service de résolution et stratégie budget
 *
 * 1. resolveBudget() : normalise le budget custom (total vs par personne)
 * 2. generateBudgetStrategy() : appel Claude pour décider la stratégie
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  TripPreferences,
  BudgetLevel,
  BudgetStrategy,
  ResolvedBudget,
  BUDGET_LABELS,
} from '../types';
import { tokenTracker } from './tokenTracker';

/**
 * Normalise les inputs budget en valeurs exploitables
 */
export function resolveBudget(preferences: TripPreferences): ResolvedBudget {
  const groupSize = preferences.groupSize || 1;
  const durationDays = preferences.durationDays || 1;

  let totalBudget: number;
  let budgetLevel: BudgetLevel;

  if (preferences.budgetCustom) {
    // Budget custom : convertir en total si c'est par personne
    totalBudget = preferences.budgetIsPerPerson
      ? preferences.budgetCustom * groupSize
      : preferences.budgetCustom;

    // Dériver le budgetLevel depuis le montant total
    budgetLevel = deriveBudgetLevel(totalBudget);
  } else {
    // Budget par niveau : utiliser le milieu de la range
    budgetLevel = preferences.budgetLevel || 'moderate';
    const range = BUDGET_LABELS[budgetLevel];
    totalBudget = budgetLevel === 'luxury'
      ? range.min * 2
      : (range.min + range.max) / 2;
  }

  const perPersonBudget = totalBudget / groupSize;
  const perPersonPerDay = perPersonBudget / durationDays;

  return {
    totalBudget,
    perPersonBudget,
    perPersonPerDay,
    budgetLevel,
  };
}

function deriveBudgetLevel(totalBudget: number): BudgetLevel {
  if (totalBudget <= BUDGET_LABELS.economic.max) return 'economic';
  if (totalBudget <= BUDGET_LABELS.moderate.max) return 'moderate';
  if (totalBudget <= BUDGET_LABELS.comfort.max) return 'comfort';
  return 'luxury';
}

/**
 * Appel Claude léger (haiku) pour décider la stratégie budget
 */
export async function generateBudgetStrategy(
  resolved: ResolvedBudget,
  destination: string,
  durationDays: number,
  groupSize: number,
  activities: string[],
  mealPreference?: 'auto' | 'mostly_cooking' | 'mostly_restaurants' | 'balanced',
): Promise<BudgetStrategy> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[BudgetStrategy] Pas de clé API, fallback stratégie par défaut');
    return getDefaultStrategy(resolved.budgetLevel);
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Tu es un expert en planification de voyages et optimisation de budget.

CONTEXTE:
- Destination: ${destination}
- Durée: ${durationDays} jours
- Groupe: ${groupSize} personne(s)
- Budget TOTAL: ${resolved.totalBudget}€ (soit ${resolved.perPersonPerDay.toFixed(0)}€/personne/jour)
- Activités souhaitées: ${activities.join(', ') || 'variées'}

DÉCIDE la meilleure stratégie pour ce budget. Sois réaliste par rapport au coût de la vie à ${destination}.

Réponds UNIQUEMENT avec un JSON valide (pas de markdown):
{
  "accommodationType": "airbnb_with_kitchen" | "hotel" | "hostel",
  "accommodationBudgetPerNight": <nombre en €>,
  "mealsStrategy": {
    "breakfast": "self_catered" | "restaurant" | "mixed",
    "lunch": "self_catered" | "restaurant" | "mixed",
    "dinner": "self_catered" | "restaurant" | "mixed"
  },
  "groceryShoppingNeeded": true | false,
  "activitiesLevel": "mostly_free" | "mixed" | "premium",
  "dailyActivityBudget": <nombre en € par personne>,
  "transportTips": "<conseil transport local court>",
  "reasoning": "<explication courte de la stratégie choisie>"
}

RÈGLES:
- "airbnb_with_kitchen" si le budget est serré ET que cuisiner permet d'économiser significativement
- "hotel" si le budget est suffisant pour hôtels corrects + restaurants
- "hostel" uniquement pour budgets très serrés (solo/amis)
- "self_catered" = courses supermarché (~5-8€/pers/repas)
- "restaurant" = manger dehors (~15-30€/pers/repas selon destination)
- "mixed" = alternance courses/restaurant
- Le petit-déjeuner est souvent self_catered même avec un bon budget (sauf si hôtel avec PDJ inclus)
- accommodationBudgetPerNight = budget TOTAL chambre/logement par nuit (pas par personne)
- Si le budget par personne/jour est >= 80€, privilégie les restaurants pour déjeuner et dîner
- Si le budget par personne/jour est < 30€, privilégie self_catered pour économiser
${mealPreference && mealPreference !== 'auto' ? `- IMPORTANT: L'utilisateur a explicitement choisi la préférence repas "${mealPreference}":
  ${mealPreference === 'mostly_cooking' ? '→ Privilégie self_catered pour la plupart des repas (breakfast + lunch self_catered, dinner mixed)' : ''}
  ${mealPreference === 'mostly_restaurants' ? '→ Privilégie restaurant pour la plupart des repas, groceryShoppingNeeded=false' : ''}
  ${mealPreference === 'balanced' ? '→ Mets "mixed" pour lunch et dinner, self_catered pour breakfast' : ''}` : ''}`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.usage) {
      tokenTracker.track(response.usage, `BudgetStrategy: ${destination}`);
    }

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Réponse invalide');
    }

    let jsonStr = content.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const strategy: BudgetStrategy = JSON.parse(jsonStr);

    // Guard: apply user meal preference override
    if (mealPreference && mealPreference !== 'auto') {
      const meals = strategy.mealsStrategy;
      if (mealPreference === 'mostly_cooking') {
        meals.breakfast = 'self_catered';
        meals.lunch = 'self_catered';
        meals.dinner = 'mixed';
        strategy.groceryShoppingNeeded = true;
        if (strategy.accommodationType === 'hotel') {
          strategy.accommodationType = 'airbnb_with_kitchen';
        }
      } else if (mealPreference === 'mostly_restaurants') {
        meals.breakfast = 'restaurant';
        meals.lunch = 'restaurant';
        meals.dinner = 'restaurant';
        strategy.groceryShoppingNeeded = false;
      } else if (mealPreference === 'balanced') {
        meals.breakfast = 'self_catered';
        meals.lunch = 'mixed';
        meals.dinner = 'mixed';
        strategy.groceryShoppingNeeded = true;
      }
      console.log(`[BudgetStrategy] Override from mealPreference=${mealPreference}`);
    }

    // Guard: if budget per person per day is high enough (>=80€) AND no explicit meal preference, force all meals to restaurant
    if ((!mealPreference || mealPreference === 'auto') && resolved.perPersonPerDay >= 80) {
      const meals = strategy.mealsStrategy;
      const needsOverride = meals.breakfast !== 'restaurant' || meals.lunch !== 'restaurant' || meals.dinner !== 'restaurant';
      if (needsOverride) {
        console.log(`[BudgetStrategy] Override: ${resolved.perPersonPerDay.toFixed(0)}€/pers/jour → forcing ALL meals to restaurant`);
        meals.breakfast = 'restaurant';
        meals.lunch = 'restaurant';
        meals.dinner = 'restaurant';
        strategy.groceryShoppingNeeded = false;
      }
    }

    console.log(`[BudgetStrategy] ${destination}: ${strategy.accommodationType}, activités=${strategy.activitiesLevel}, courses=${strategy.groceryShoppingNeeded}`);
    console.log(`[BudgetStrategy] Reasoning: ${strategy.reasoning}`);

    return strategy;
  } catch (error) {
    console.error('[BudgetStrategy] Erreur, fallback par défaut:', error);
    return getDefaultStrategy(resolved.budgetLevel);
  }
}

function getDefaultStrategy(budgetLevel: BudgetLevel): BudgetStrategy {
  switch (budgetLevel) {
    case 'economic':
      return {
        accommodationType: 'airbnb_with_kitchen',
        accommodationBudgetPerNight: 60,
        mealsStrategy: { breakfast: 'self_catered', lunch: 'mixed', dinner: 'mixed' },
        groceryShoppingNeeded: true,
        activitiesLevel: 'mostly_free',
        dailyActivityBudget: 10,
        transportTips: 'Privilégier transports en commun et marche',
        reasoning: 'Budget serré, Airbnb avec cuisine pour économiser sur les repas',
      };
    case 'moderate':
      return {
        accommodationType: 'hotel',
        accommodationBudgetPerNight: 100,
        mealsStrategy: { breakfast: 'self_catered', lunch: 'restaurant', dinner: 'restaurant' },
        groceryShoppingNeeded: false,
        activitiesLevel: 'mixed',
        dailyActivityBudget: 25,
        transportTips: 'Mix transports en commun et quelques taxis',
        reasoning: 'Budget modéré, hôtel correct avec restaurants',
      };
    case 'comfort':
      return {
        accommodationType: 'hotel',
        accommodationBudgetPerNight: 180,
        mealsStrategy: { breakfast: 'restaurant', lunch: 'restaurant', dinner: 'restaurant' },
        groceryShoppingNeeded: false,
        activitiesLevel: 'mixed',
        dailyActivityBudget: 40,
        transportTips: 'Transports variés selon confort',
        reasoning: 'Budget confortable, hôtel et restaurants sans restriction',
      };
    case 'luxury':
      return {
        accommodationType: 'hotel',
        accommodationBudgetPerNight: 350,
        mealsStrategy: { breakfast: 'restaurant', lunch: 'restaurant', dinner: 'restaurant' },
        groceryShoppingNeeded: false,
        activitiesLevel: 'premium',
        dailyActivityBudget: 80,
        transportTips: 'Taxis et transferts privés',
        reasoning: 'Budget luxe, meilleures expériences sans limite',
      };
  }
}

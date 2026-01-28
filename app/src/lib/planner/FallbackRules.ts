/**
 * FallbackRules - Règles déterministes quand Claude est indisponible
 *
 * Fournit des réponses raisonnables sans appel API:
 * - Arrivée tardive → hôtel direct
 * - Gap filling → attraction par rating décroissant
 * - Ordre des activités → proximité géographique
 * - Repas → heures standards
 */

import { AdvisorRequest, AdvisorResponse, AdvisorQuestion } from './types';

export function applyFallbackRules(request: AdvisorRequest): AdvisorResponse {
  const { question, options } = request;

  switch (question) {
    case 'late_arrival':
      return lateArrivalFallback(request);
    case 'gap_fill':
      return gapFillFallback(request);
    case 'activity_order':
      return activityOrderFallback(request);
    case 'energy_check':
      return energyCheckFallback(request);
    case 'meal_decision':
      return mealDecisionFallback(request);
    default:
      // Par défaut, choisir la première option
      return {
        chosenId: options[0]?.id || '',
        reasoning: 'Règle par défaut: première option choisie',
        confidence: 'low',
      };
  }
}

function lateArrivalFallback(request: AdvisorRequest): AdvisorResponse {
  const { state, options } = request;
  const availableHours = state.availableHours;

  // Arrivée après 22h → hôtel direct
  // Arrivée entre 20h-22h → dîner si option disponible
  // Arrivée avant 20h → activité la plus courte
  if (availableHours < 1) {
    const hotelOption = options.find(o => o.id.includes('hotel') || o.label.includes('hôtel'));
    return {
      chosenId: hotelOption?.id || options[0]?.id || '',
      reasoning: 'Arrivée tardive: direction hôtel',
      confidence: 'high',
    };
  }

  if (availableHours < 3) {
    const dinnerOption = options.find(o => o.id.includes('dinner') || o.label.includes('dîner'));
    if (dinnerOption) {
      return {
        chosenId: dinnerOption.id,
        reasoning: 'Arrivée en soirée: dîner avant hôtel',
        confidence: 'medium',
      };
    }
  }

  // Sinon activité la plus courte
  const shortest = [...options].sort((a, b) => a.duration - b.duration)[0];
  return {
    chosenId: shortest?.id || options[0]?.id || '',
    reasoning: 'Temps limité: activité courte privilégiée',
    confidence: 'medium',
  };
}

function gapFillFallback(request: AdvisorRequest): AdvisorResponse {
  const { options, state } = request;

  if (options.length === 0) {
    return {
      chosenId: '',
      reasoning: 'Aucune option disponible',
      confidence: 'high',
    };
  }

  // Choisir l'activité qui remplit le mieux le gap (durée la plus proche du temps dispo)
  const availableMinutes = state.availableHours * 60;
  const bestFit = [...options].sort((a, b) => {
    const diffA = Math.abs(a.duration - availableMinutes);
    const diffB = Math.abs(b.duration - availableMinutes);
    return diffA - diffB;
  })[0];

  return {
    chosenId: bestFit.id,
    reasoning: `Activité "${bestFit.label}" (${bestFit.duration}min) adaptée au temps disponible`,
    confidence: 'medium',
  };
}

function activityOrderFallback(request: AdvisorRequest): AdvisorResponse {
  // Par défaut, garder l'ordre proposé (déjà trié par rating dans allAttractions)
  return {
    chosenId: request.options[0]?.id || '',
    reasoning: 'Ordre par défaut: par rating décroissant',
    confidence: 'medium',
  };
}

function energyCheckFallback(request: AdvisorRequest): AdvisorResponse {
  const { state, options } = request;

  // Si épuisé, proposer de terminer la journée
  if (state.energy === 'exhausted' || state.energy === 'tired') {
    const endOption = options.find(o => o.id.includes('end') || o.label.includes('fin'));
    if (endOption) {
      return {
        chosenId: endOption.id,
        reasoning: `Énergie ${state.energy}: fin de journée recommandée`,
        confidence: 'high',
      };
    }
  }

  // Sinon continuer
  const continueOption = options.find(o => o.id.includes('continue') || !o.id.includes('end'));
  return {
    chosenId: continueOption?.id || options[0]?.id || '',
    reasoning: 'Énergie suffisante pour continuer',
    confidence: 'medium',
  };
}

function mealDecisionFallback(request: AdvisorRequest): AdvisorResponse {
  const { state, options } = request;
  const time = state.time;
  const hour = parseInt(time.split(':')[0]);

  // Déjeuner entre 12h-14h, dîner entre 19h-21h
  const isMealTime = (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 21);

  if (isMealTime) {
    const mealOption = options.find(o => o.id.includes('meal') || o.label.includes('repas') || o.label.includes('déjeuner') || o.label.includes('dîner'));
    return {
      chosenId: mealOption?.id || options[0]?.id || '',
      reasoning: `Heure de repas (${time}): manger maintenant`,
      confidence: 'high',
    };
  }

  // Pas l'heure de manger
  const waitOption = options.find(o => o.id.includes('wait') || o.id.includes('activity'));
  return {
    chosenId: waitOption?.id || options[0]?.id || '',
    reasoning: `Pas l'heure de manger (${time}): continuer les activités`,
    confidence: 'medium',
  };
}

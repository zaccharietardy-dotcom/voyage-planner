/**
 * Chatbot Modifier Service
 *
 * Moteur principal de modification d'itinéraire.
 * Prend une intention classifiée et génère les modifications à appliquer.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  ModificationIntent,
  ModificationResult,
  TripChange,
  TripDay,
  TripItem,
  ChatResponse,
  ConversationContext,
  ContextualSuggestion,
} from '../types';
import {
  getConstraints,
  validateModifications,
  detectTimeConflicts,
  minutesToTime,
  checkTimeBoundaries,
} from './constraintChecker';
import { classifyIntent, buildTripContext, shouldUseSonnet, generateContextualSuggestions } from './intentClassifier';
import { insertDay } from './itineraryCalculator';
import type { Attraction } from './attractions';

// ============================================
// Main Chat Handler
// ============================================

/**
 * Contexte complet du voyage pour les modifications avancées
 */
export interface TripModificationContext {
  destination: string;
  startDate: Date;
  accommodation?: {
    name?: string;
    latitude?: number;
    longitude?: number;
    pricePerNight?: number;
  } | null;
  durationDays: number;
  attractionPool?: Attraction[];
}

/**
 * Traite un message utilisateur et retourne une réponse avec prévisualisation
 */
export async function handleChatMessage(
  message: string,
  destination: string,
  days: TripDay[],
  tripContext?: TripModificationContext,
  conversationHistory?: ConversationContext
): Promise<ChatResponse> {
  // 1. Classifier l'intention (avec historique conversationnel pour le contexte)
  const context = buildTripContext(destination, days);
  const intent = await classifyIntent(message, context, conversationHistory);

  // 2. Gérer les cas spéciaux
  if (intent.type === 'clarification') {
    return {
      reply: intent.explanation || "Je n'ai pas bien compris. Pouvez-vous préciser ce que vous souhaitez modifier ?",
      intent,
      changes: null,
      previewDays: null,
      requiresConfirmation: false,
      warnings: [],
    };
  }

  if (intent.type === 'general_question') {
    return {
      reply: await generateGeneralResponse(message, destination, days, conversationHistory),
      intent,
      changes: null,
      previewDays: null,
      requiresConfirmation: false,
      warnings: [],
    };
  }

  // 3. Générer les modifications
  const result = await generateModifications(intent, days, tripContext);

  // 4. Générer les suggestions contextuelles seulement en cas de succès
  // (les échecs ont déjà errorInfo.alternativeSuggestion, pas besoin d'un appel Haiku supplémentaire)
  let suggestions: ContextualSuggestion[] | undefined;
  if (result.success) {
    suggestions = await generateContextualSuggestions(
      destination,
      result.newDays
    ).catch(() => undefined);
  }

  if (!result.success) {
    return {
      reply: result.explanation,
      intent,
      changes: null,
      previewDays: null,
      requiresConfirmation: false,
      warnings: result.warnings,
      errorInfo: result.errorInfo,
      suggestions,
    };
  }

  // 5. Retourner la prévisualisation
  return {
    reply: result.explanation,
    intent,
    changes: result.changes,
    previewDays: result.newDays,
    requiresConfirmation: true,
    warnings: result.warnings,
    suggestions,
  };
}

// ============================================
// Modification Generators
// ============================================

/**
 * Génère les modifications selon l'intention
 */
async function generateModifications(
  intent: ModificationIntent,
  days: TripDay[],
  tripContext?: TripModificationContext
): Promise<ModificationResult> {
  const constraints = getConstraints(days);
  const rollbackData = JSON.parse(JSON.stringify(days)); // Deep clone pour undo

  switch (intent.type) {
    case 'shift_times':
      return shiftTimes(intent, days, constraints, rollbackData);

    case 'remove_activity':
      return removeActivity(intent, days, constraints, rollbackData);

    case 'swap_activity':
      return swapActivity(intent, days, constraints, rollbackData);

    case 'extend_free_time':
      return extendFreeTime(intent, days, constraints, rollbackData);

    case 'adjust_duration':
      return adjustDuration(intent, days, constraints, rollbackData);

    case 'reorder_day':
      return reorderDay(intent, days, constraints, rollbackData);

    case 'add_activity':
      return addActivity(intent, days, constraints, rollbackData);

    case 'change_restaurant':
      return changeRestaurant(intent, days, constraints, rollbackData);

    case 'add_day':
      return addDay(intent, days, rollbackData, tripContext);

    default:
      return {
        success: false,
        changes: [],
        explanation: "Je ne suis pas encore capable de gérer ce type de modification.",
        warnings: [],
        newDays: days,
        rollbackData,
      };
  }
}

// ============================================
// Shift Times
// ============================================

function shiftTimes(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const { timeShift = 60, direction = 'later', dayNumbers = [], scope = 'morning_only' } = intent.parameters;
  const shiftMinutes = direction === 'later' ? timeShift : -timeShift;

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Jours à modifier (tous si non spécifié)
  const targetDays = dayNumbers.length > 0
    ? dayNumbers
    : days.map(d => d.dayNumber);

  // IDs des items contraints
  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  // Limite de midi pour le scope morning_only
  const LUNCH_BOUNDARY = 720; // 12:00
  const AFTERNOON_BOUNDARY = 840; // 14:00

  for (const day of newDays) {
    if (!targetDays.includes(day.dayNumber)) continue;

    // Trouve le premier restaurant du midi (ancre temporelle)
    const lunchItem = day.items.find(item =>
      item.type === 'restaurant' &&
      timeToMinutes(item.startTime) >= 690 && // 11:30
      timeToMinutes(item.startTime) <= AFTERNOON_BOUNDARY
    );
    const lunchStart = lunchItem ? timeToMinutes(lunchItem.startTime) : LUNCH_BOUNDARY;

    for (const item of day.items) {
      // Skip items contraints (vols, check-in/out, parking)
      if (constrainedIds.has(item.id)) {
        continue;
      }
      if (['flight', 'checkin', 'checkout', 'parking'].includes(item.type)) {
        continue;
      }

      const itemStart = timeToMinutes(item.startTime);
      const itemEnd = timeToMinutes(item.endTime);
      const itemDuration = itemEnd - itemStart;

      // Décide si cet item doit être décalé selon le scope
      if (scope === 'morning_only') {
        // Ne décaler que les items qui COMMENCENT avant le déjeuner
        if (itemStart >= lunchStart) {
          continue; // L'après-midi et le soir ne bougent pas
        }

        // Le restaurant du midi lui-même ne bouge pas
        if (item.type === 'restaurant' && itemStart >= 690) {
          continue;
        }
      } else if (scope === 'afternoon_only') {
        // Ne décaler que les items de l'après-midi
        if (itemStart < lunchStart) {
          continue;
        }
      }
      // scope === 'full_day' → tout décaler (comportement original)

      const oldStart = item.startTime;
      const oldEnd = item.endTime;

      // Calcule les nouveaux horaires
      const newStartMinutes = itemStart + shiftMinutes;
      let newEndMinutes = itemEnd + shiftMinutes;

      // Vérifie les limites basses
      if (newStartMinutes < 360) { // 6:00
        warnings.push(`${item.title} ne peut pas commencer avant 6h00.`);
        continue;
      }

      // Pour le scope morning_only : si l'item décalé chevauche le déjeuner
      if (scope === 'morning_only' && newEndMinutes > lunchStart) {
        // Option 1 : réduire la durée de l'activité pour qu'elle finisse avant le déjeuner
        const reducedEnd = lunchStart - 15; // 15 min de marge avant le déjeuner
        const reducedDuration = reducedEnd - newStartMinutes;

        if (reducedDuration >= 30) {
          // On raccourcit l'activité (min 30 min)
          newEndMinutes = reducedEnd;
          warnings.push(`${item.title} a été raccourcie pour ne pas chevaucher le déjeuner.`);
        } else {
          // Pas assez de temps → supprimer l'activité
          const removeIndex = day.items.findIndex(i => i.id === item.id);
          if (removeIndex !== -1) {
            day.items.splice(removeIndex, 1);
            changes.push({
              type: 'remove',
              dayNumber: day.dayNumber,
              itemId: item.id,
              before: { title: item.title, startTime: oldStart, endTime: oldEnd },
              description: `${item.title} supprimée (plus de place avant le déjeuner)`,
            });
            warnings.push(`${item.title} a été supprimée car elle ne rentre plus dans le créneau matinal.`);
          }
          continue;
        }
      }

      // Vérifie la limite haute
      if (newEndMinutes > 1380) { // 23:00
        warnings.push(`${item.title} ne peut pas finir après 23h00.`);
        continue;
      }

      item.startTime = minutesToTime(newStartMinutes);
      item.endTime = minutesToTime(newEndMinutes);
      if (item.duration) {
        item.duration = newEndMinutes - newStartMinutes;
      }

      changes.push({
        type: 'update',
        dayNumber: day.dayNumber,
        itemId: item.id,
        before: { startTime: oldStart, endTime: oldEnd },
        after: { startTime: item.startTime, endTime: item.endTime },
        description: `${item.title}: ${oldStart} → ${item.startTime}`,
      });
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: "Aucune activité n'a pu être décalée. Les horaires fixes (vols, hôtel) ne peuvent pas être modifiés.",
      warnings,
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'constraint_violation',
        message: "Aucune activité n'a pu être décalée car les horaires fixes (vols, hôtel) bloquent le changement.",
        alternativeSuggestion: {
          label: 'Libérer du temps libre',
          prompt: "J'aimerais plus de temps libre l'après-midi",
        },
      },
    };
  }

  const daysText = targetDays.length === days.length
    ? 'tous les jours'
    : `jour${targetDays.length > 1 ? 's' : ''} ${targetDays.join(', ')}`;

  const scopeText = scope === 'morning_only'
    ? ' du matin'
    : scope === 'afternoon_only'
      ? ' de l\'après-midi'
      : '';

  return {
    success: true,
    changes,
    explanation: `J'ai décalé ${changes.length} activité${changes.length > 1 ? 's' : ''}${scopeText} de ${Math.abs(shiftMinutes)} minutes ${direction === 'later' ? 'plus tard' : 'plus tôt'} (${daysText}). Le déjeuner et le reste de la journée restent inchangés.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Remove Activity
// ============================================

function removeActivity(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const { targetActivity, targetItemId, dayNumbers = [] } = intent.parameters;

  if (!targetActivity && !targetItemId) {
    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas compris quelle activité vous souhaitez supprimer. Pouvez-vous préciser ?",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: "Je n'ai pas compris quelle activité vous souhaitez supprimer. Pouvez-vous préciser le nom exact ?",
      },
    };
  }

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Trouve l'item à supprimer
  let itemFound = false;

  for (const day of newDays) {
    // Si des jours sont spécifiés, ne chercher que dans ceux-là
    if (dayNumbers.length > 0 && !dayNumbers.includes(day.dayNumber)) continue;

    const itemIndex = day.items.findIndex(item => {
      if (targetItemId && item.id === targetItemId) return true;
      if (targetActivity) {
        const normalizedTarget = normalizeString(targetActivity);
        const normalizedTitle = normalizeString(item.title);
        return normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle);
      }
      return false;
    });

    if (itemIndex !== -1) {
      const item = day.items[itemIndex];

      // Vérifie les contraintes
      const constraint = constraints.find(c => c.itemId === item.id);
      if (constraint && constraint.type === 'immutable') {
        return {
          success: false,
          changes: [],
          explanation: constraint.reason,
          warnings: [],
          newDays: days,
          rollbackData,
          errorInfo: {
            type: 'immutable_item',
            message: `« ${item.title} » ne peut pas être supprimé(e). ${constraint.reason}`,
            alternativeSuggestion: {
              label: 'Décaler les activités autour',
              prompt: `Décale les activités autour de "${item.title}" pour libérer du temps`,
            },
          },
        };
      }

      if (constraint && constraint.type === 'booking_required') {
        warnings.push(constraint.reason);
      }

      // Supprime l'item
      day.items.splice(itemIndex, 1);
      itemFound = true;

      changes.push({
        type: 'remove',
        dayNumber: day.dayNumber,
        itemId: item.id,
        before: {
          title: item.title,
          startTime: item.startTime,
          endTime: item.endTime,
        },
        description: `Suppression de "${item.title}" (jour ${day.dayNumber})`,
      });

      // On ne supprime qu'une seule occurrence
      break;
    }
  }

  if (!itemFound) {
    // Trouver le jour avec le plus d'activités pour suggérer une alternative
    const busiestDay = days.reduce((max, d) => {
      const count = d.items.filter(i => i.type === 'activity').length;
      const maxCount = max.items.filter(i => i.type === 'activity').length;
      return count > maxCount ? d : max;
    }, days[0]);
    const firstActivity = busiestDay?.items.find(i => i.type === 'activity');

    return {
      success: false,
      changes: [],
      explanation: `Je n'ai pas trouvé d'activité correspondant à « ${targetActivity} ». Vérifiez le nom exact dans votre itinéraire.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: `Je n'ai pas trouvé « ${targetActivity} » dans votre itinéraire. Vérifiez le nom exact ou précisez le jour.`,
        alternativeSuggestion: firstActivity ? {
          label: `Supprimer « ${firstActivity.title} »`,
          prompt: `Supprime "${firstActivity.title}" du jour ${busiestDay.dayNumber}`,
        } : undefined,
      },
    };
  }

  return {
    success: true,
    changes,
    explanation: `J'ai supprimé "${changes[0].before?.title}" de votre itinéraire.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Swap Activity
// ============================================

async function swapActivity(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): Promise<ModificationResult> {
  const { targetActivity, newValue, dayNumbers = [] } = intent.parameters;

  if (!targetActivity || !newValue) {
    return {
      success: false,
      changes: [],
      explanation: "Pour remplacer une activité, précisez l'activité à remplacer et la nouvelle activité souhaitée.",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: "Pour remplacer une activité, précisez l'activité à remplacer et la nouvelle activité souhaitée.",
        alternativeSuggestion: {
          label: 'Ajouter une activité',
          prompt: `Ajoute ${newValue || 'une nouvelle activité'}`,
        },
      },
    };
  }

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Trouve l'item à remplacer
  for (const day of newDays) {
    if (dayNumbers.length > 0 && !dayNumbers.includes(day.dayNumber)) continue;

    const item = day.items.find(i => {
      const normalizedTarget = normalizeString(targetActivity);
      const normalizedTitle = normalizeString(i.title);
      return normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle);
    });

    if (item) {
      // Vérifie les contraintes
      const constraint = constraints.find(c => c.itemId === item.id);
      if (constraint && constraint.type === 'immutable') {
        return {
          success: false,
          changes: [],
          explanation: constraint.reason,
          warnings: [],
          newDays: days,
          rollbackData,
          errorInfo: {
            type: 'immutable_item',
            message: `« ${item.title} » ne peut pas être remplacé(e). ${constraint.reason}`,
            alternativeSuggestion: {
              label: `Ajouter « ${newValue} » à côté`,
              prompt: `Ajoute "${newValue}" au même jour que "${item.title}"`,
            },
          },
        };
      }

      if (constraint && constraint.type === 'booking_required') {
        warnings.push(constraint.reason);
      }

      const oldTitle = item.title;
      item.title = newValue;
      item.dataReliability = 'estimated';

      // Enrichir avec coordonnées GPS et métadonnées
      try {
        const { geocodeAddress } = await import('./geocoding');
        const destination = days[0]?.items?.find((i: any) => i.type === 'checkin')?.locationName || '';
        const searchQuery = `${newValue}, ${destination}`;
        const coords = await geocodeAddress(searchQuery);
        if (coords) {
          item.latitude = coords.lat;
          item.longitude = coords.lng;
        }
        item.description = newValue;
        item.googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(newValue)}`;
        // Estimer la durée
        item.duration = estimateSwapDuration(newValue);
      } catch (err) {
        console.warn('[Swap] Enrichment failed:', err);
        item.description = `Remplace ${oldTitle}`;
      }

      changes.push({
        type: 'update',
        dayNumber: day.dayNumber,
        itemId: item.id,
        before: { title: oldTitle },
        after: { title: newValue },
        description: `"${oldTitle}" → "${newValue}"`,
      });

      break;
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: `Je n'ai pas trouvé « ${targetActivity} » dans votre itinéraire.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: `Je n'ai pas trouvé « ${targetActivity} » dans votre itinéraire. Vérifiez le nom exact ou précisez le jour.`,
        alternativeSuggestion: newValue ? {
          label: `Ajouter « ${newValue} »`,
          prompt: `Ajoute "${newValue}"`,
        } : undefined,
      },
    };
  }

  return {
    success: true,
    changes,
    explanation: `J'ai remplacé "${changes[0].before?.title}" par "${newValue}".`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Extend Free Time
// ============================================

function extendFreeTime(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const { dayNumbers = [] } = intent.parameters;

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Jours à modifier
  const targetDays = dayNumbers.length > 0
    ? dayNumbers
    : days.map(d => d.dayNumber);

  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  for (const day of newDays) {
    if (!targetDays.includes(day.dayNumber)) continue;

    // Trouve les activités modifiables
    const modifiableItems = day.items.filter(item =>
      item.type === 'activity' && !constrainedIds.has(item.id)
    );

    if (modifiableItems.length <= 1) continue;

    // Supprime la dernière activité de l'après-midi (après 14h)
    const afternoonItems = modifiableItems.filter(i => timeToMinutes(i.startTime) >= 840);
    if (afternoonItems.length > 0) {
      const toRemove = afternoonItems[afternoonItems.length - 1];
      const itemIndex = day.items.findIndex(i => i.id === toRemove.id);

      if (itemIndex !== -1) {
        day.items.splice(itemIndex, 1);

        changes.push({
          type: 'remove',
          dayNumber: day.dayNumber,
          itemId: toRemove.id,
          before: { title: toRemove.title, startTime: toRemove.startTime },
          description: `Suppression de "${toRemove.title}" pour plus de temps libre`,
        });
      }
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas pu libérer du temps. Votre itinéraire a peut-être déjà peu d'activités.",
      warnings,
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'constraint_violation',
        message: "Votre itinéraire a déjà peu d'activités l'après-midi. Il n'y a rien à supprimer pour libérer du temps.",
        alternativeSuggestion: {
          label: 'Décaler le matin',
          prompt: 'Je veux me lever plus tard le matin',
        },
      },
    };
  }

  return {
    success: true,
    changes,
    explanation: `J'ai libéré du temps en supprimant ${changes.length} activité${changes.length > 1 ? 's' : ''} de l'après-midi.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Adjust Duration
// ============================================

function adjustDuration(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const { targetActivity, duration, direction } = intent.parameters;

  if (!targetActivity) {
    return {
      success: false,
      changes: [],
      explanation: "Précisez quelle activité vous souhaitez modifier.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Par défaut, ajoute ou retire 30 minutes
  const durationChange = duration || 30;
  const addTime = direction !== 'earlier'; // 'later' ou undefined = plus de temps

  for (const day of newDays) {
    const item = day.items.find(i => {
      const normalizedTarget = normalizeString(targetActivity);
      const normalizedTitle = normalizeString(i.title);
      return normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle);
    });

    if (item) {
      const oldEnd = item.endTime;
      const endMinutes = timeToMinutes(item.endTime);
      const newEndMinutes = addTime
        ? endMinutes + durationChange
        : Math.max(timeToMinutes(item.startTime) + 30, endMinutes - durationChange);

      if (newEndMinutes > 1380) {
        return {
          success: false,
          changes: [],
          explanation: `L'activité « ${item.title} » finirait après 23h00 avec cette durée supplémentaire.`,
          warnings: [`L'activité "${item.title}" finirait après 23h00.`],
          newDays: days,
          rollbackData,
          errorInfo: {
            type: 'schedule_conflict',
            message: `L'activité « ${item.title} » finirait après 23h00 avec ${durationChange} minutes en plus.`,
            alternativeSuggestion: {
              label: `Ajouter seulement 15 min`,
              prompt: `Ajoute 15 minutes de plus à "${item.title}"`,
            },
          },
        };
      }

      item.endTime = minutesToTime(newEndMinutes);
      item.duration = newEndMinutes - timeToMinutes(item.startTime);

      changes.push({
        type: 'update',
        dayNumber: day.dayNumber,
        itemId: item.id,
        before: { endTime: oldEnd },
        after: { endTime: item.endTime },
        description: `${item.title}: durée ${addTime ? '+' : '-'}${durationChange} min`,
      });

      break;
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: `Je n'ai pas trouvé « ${targetActivity} » dans votre itinéraire.`,
      warnings,
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: `Je n'ai pas trouvé « ${targetActivity} » dans votre itinéraire. Vérifiez le nom exact.`,
      },
    };
  }

  return {
    success: true,
    changes,
    explanation: `J'ai ${addTime ? 'ajouté' : 'retiré'} ${durationChange} minutes à "${targetActivity}".`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Reorder Day
// ============================================

function reorderDay(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const { dayNumbers = [] } = intent.parameters;

  if (dayNumbers.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: "Précisez quel jour vous souhaitez réorganiser.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  const dayNumber = dayNumbers[0];
  const day = newDays.find(d => d.dayNumber === dayNumber);

  if (!day) {
    return {
      success: false,
      changes: [],
      explanation: `Le jour ${dayNumber} n'existe pas dans votre itinéraire.`,
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  // Sépare items fixes et mobiles
  const fixedItems = day.items.filter(i => constrainedIds.has(i.id) || ['flight', 'checkin', 'checkout'].includes(i.type));
  const mobileItems = day.items.filter(i => !constrainedIds.has(i.id) && !['flight', 'checkin', 'checkout'].includes(i.type));

  if (mobileItems.length < 2) {
    return {
      success: false,
      changes: [],
      explanation: "Il n'y a pas assez d'activités mobiles à réorganiser ce jour-là.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  // Inverse l'ordre des activités mobiles
  const reversedMobile = [...mobileItems].reverse();

  // Recalcule les horaires
  let currentTime = timeToMinutes(mobileItems[0].startTime);

  for (let i = 0; i < reversedMobile.length; i++) {
    const item = reversedMobile[i];
    const duration = item.duration || timeToMinutes(item.endTime) - timeToMinutes(item.startTime);

    const oldStart = item.startTime;
    const oldEnd = item.endTime;

    item.startTime = minutesToTime(currentTime);
    item.endTime = minutesToTime(currentTime + duration);

    currentTime += duration + 30; // 30 min de transition

    changes.push({
      type: 'move',
      dayNumber,
      itemId: item.id,
      before: { startTime: oldStart, endTime: oldEnd },
      after: { startTime: item.startTime, endTime: item.endTime },
      description: `${item.title}: ${oldStart} → ${item.startTime}`,
    });
  }

  // Reconstruit le jour avec items fixes et mobiles réordonnés
  day.items = [...fixedItems, ...reversedMobile].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );

  return {
    success: true,
    changes,
    explanation: `J'ai réorganisé les activités du jour ${dayNumber}. L'ordre a été inversé.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Add Activity (uses Claude)
// ============================================

async function addActivity(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): Promise<ModificationResult> {
  const { newValue, dayNumbers = [] } = intent.parameters;

  if (!newValue) {
    return {
      success: false,
      changes: [],
      explanation: "Précisez quelle activité vous souhaitez ajouter.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Trouve le meilleur jour (le moins chargé ou celui spécifié)
  let targetDay: TripDay | undefined;

  if (dayNumbers.length > 0) {
    targetDay = newDays.find(d => d.dayNumber === dayNumbers[0]);
  } else {
    // Trouve le jour avec le moins d'activités
    targetDay = newDays.reduce((min, day) => {
      const activityCount = day.items.filter(i => i.type === 'activity').length;
      const minCount = min.items.filter(i => i.type === 'activity').length;
      return activityCount < minCount ? day : min;
    }, newDays[0]);
  }

  if (!targetDay) {
    // Trouver le jour le moins chargé pour suggérer
    const leastBusy = days.reduce((min, d) => {
      const c = d.items.filter(i => i.type === 'activity').length;
      const mc = min.items.filter(i => i.type === 'activity').length;
      return c < mc ? d : min;
    }, days[0]);

    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas trouvé de jour approprié pour ajouter cette activité.",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'no_slot_available',
        message: `Il n'y a pas de jour disponible pour ajouter cette activité.`,
        alternativeSuggestion: leastBusy ? {
          label: `Ajouter au jour ${leastBusy.dayNumber}`,
          prompt: `Ajoute "${newValue}" au jour ${leastBusy.dayNumber}`,
        } : undefined,
      },
    };
  }

  // Trouve un créneau libre
  const existingTimes = targetDay.items.map(i => ({
    start: timeToMinutes(i.startTime),
    end: timeToMinutes(i.endTime),
  }));

  let slotStart = 600; // 10:00 par défaut
  const slotDuration = 90; // 1h30 par défaut

  // Cherche un créneau entre 10h et 20h
  for (let time = 600; time < 1200; time += 30) {
    const slotEnd = time + slotDuration;
    // Add 20min transit buffer between activities
    const hasConflict = existingTimes.some(
      (t: any) => (time < t.end + 20) && (slotEnd > t.start - 20)
    );
    // Avoid meal windows (±30min around lunch 12h-13h30 and dinner 19h-20h30)
    const inMealWindow = (time >= 720 && time <= 810) || (time >= 1140 && time <= 1230);
    if (!hasConflict && !inMealWindow) {
      slotStart = time;
      break;
    }
  }

  // Crée le nouvel item
  const newItem: TripItem = {
    id: crypto.randomUUID(),
    dayNumber: targetDay.dayNumber,
    startTime: minutesToTime(slotStart),
    endTime: minutesToTime(slotStart + slotDuration),
    type: 'activity',
    title: newValue,
    description: 'Activité ajoutée via le chatbot',
    locationName: 'À préciser',
    latitude: 0,
    longitude: 0,
    orderIndex: targetDay.items.length,
    dataReliability: 'generated',
  };

  targetDay.items.push(newItem);
  targetDay.items.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const change: TripChange = {
    type: 'add',
    dayNumber: targetDay.dayNumber,
    newItem,
    description: `Ajout de "${newValue}" au jour ${targetDay.dayNumber}`,
  };

  return {
    success: true,
    changes: [change],
    explanation: `J'ai ajouté "${newValue}" au jour ${targetDay.dayNumber} (${newItem.startTime} - ${newItem.endTime}). Vous pourrez ajuster les détails ensuite.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Change Restaurant
// ============================================

function changeRestaurant(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const { targetActivity, newValue, mealType, cuisineType, dayNumbers = [] } = intent.parameters;

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  // Trouve le restaurant à modifier
  for (const day of newDays) {
    if (dayNumbers.length > 0 && !dayNumbers.includes(day.dayNumber)) continue;

    let restaurant: TripItem | undefined;

    if (targetActivity) {
      restaurant = day.items.find(i =>
        i.type === 'restaurant' &&
        normalizeString(i.title).includes(normalizeString(targetActivity))
      );
    } else if (mealType) {
      // Trouve par type de repas
      const mealTimes: Record<string, [number, number]> = {
        breakfast: [420, 600], // 7h-10h
        lunch: [720, 900],     // 12h-15h
        dinner: [1140, 1320],  // 19h-22h
      };
      const [minTime, maxTime] = mealTimes[mealType] || [0, 1440];

      restaurant = day.items.find(i => {
        if (i.type !== 'restaurant') return false;
        const startMin = timeToMinutes(i.startTime);
        return startMin >= minTime && startMin <= maxTime;
      });
    } else {
      // Prend le premier restaurant trouvé
      restaurant = day.items.find(i => i.type === 'restaurant');
    }

    if (restaurant) {
      const oldTitle = restaurant.title;

      if (newValue) {
        restaurant.title = newValue;
      } else if (cuisineType) {
        restaurant.title = `Restaurant ${cuisineType}`;
      } else {
        restaurant.title = 'Nouveau restaurant';
      }

      restaurant.description = `Remplace ${oldTitle}`;
      restaurant.dataReliability = 'generated';

      changes.push({
        type: 'update',
        dayNumber: day.dayNumber,
        itemId: restaurant.id,
        before: { title: oldTitle },
        after: { title: restaurant.title },
        description: `"${oldTitle}" → "${restaurant.title}"`,
      });

      break;
    }
  }

  if (changes.length === 0) {
    // Trouver le premier restaurant existant pour suggérer
    const firstRestaurant = days.flatMap(d => d.items).find(i => i.type === 'restaurant');

    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas trouvé de restaurant à modifier. Précisez le jour ou le repas concerné.",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: "Je n'ai pas trouvé de restaurant correspondant. Précisez le jour ou le type de repas (déjeuner, dîner).",
        alternativeSuggestion: firstRestaurant ? {
          label: `Changer « ${firstRestaurant.title} »`,
          prompt: `Change le restaurant "${firstRestaurant.title}" pour ${cuisineType ? `un restaurant ${cuisineType}` : 'un autre restaurant'}`,
        } : undefined,
      },
    };
  }

  return {
    success: true,
    changes,
    explanation: `J'ai changé le restaurant: ${changes[0].description}`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Add Day
// ============================================

function addDay(
  intent: ModificationIntent,
  days: TripDay[],
  rollbackData: TripDay[],
  tripContext?: TripModificationContext
): ModificationResult {
  const warnings: string[] = [];

  // Validation
  if (days.length < 2) {
    return {
      success: false,
      changes: [],
      explanation: "Le voyage est trop court pour ajouter un jour. Il faut au moins 2 jours.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  // Déterminer insertAfterDay
  let afterDayNumber = intent.parameters.insertAfterDay;

  // Si non spécifié, essayer dayNumbers
  if (!afterDayNumber && intent.parameters.dayNumbers && intent.parameters.dayNumbers.length > 0) {
    afterDayNumber = intent.parameters.dayNumbers[0];
  }

  // Si toujours pas spécifié, insérer au milieu
  if (!afterDayNumber) {
    afterDayNumber = Math.floor(days.length / 2);
  }

  // Validation des bornes: pas avant le jour 1, pas après le dernier jour
  if (afterDayNumber < 1) {
    return {
      success: false,
      changes: [],
      explanation: "Impossible d'ajouter un jour avant le premier jour (il contient le vol aller et le check-in).",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  if (afterDayNumber > days.length) {
    afterDayNumber = days.length; // Ajouter à la fin
  }

  // Calculer la date de début du voyage
  const startDate = tripContext?.startDate
    ? new Date(tripContext.startDate)
    : days[0]?.date
      ? new Date(days[0].date)
      : new Date();

  // Appeler insertDay (avec pool d'activités si disponible)
  const newDays = insertDay(
    days,
    afterDayNumber,
    startDate,
    tripContext?.accommodation ? {
      name: tripContext.accommodation.name,
      latitude: tripContext.accommodation.latitude,
      longitude: tripContext.accommodation.longitude,
      pricePerNight: tripContext.accommodation.pricePerNight,
    } : undefined,
    tripContext?.attractionPool
  );

  // Vérifier que l'insertion a fonctionné
  if (newDays.length === days.length) {
    return {
      success: false,
      changes: [],
      explanation: "L'insertion du jour n'a pas pu être effectuée. Vérifiez les paramètres.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  // Générer les changes
  const changes: TripChange[] = [];

  // Le nouveau jour
  const newDay = newDays[afterDayNumber]; // Le jour inséré (0-indexed: afterDayNumber)
  for (const item of newDay.items) {
    changes.push({
      type: 'add',
      dayNumber: newDay.dayNumber,
      newItem: item,
      description: `Ajout "${item.title}" au nouveau jour ${newDay.dayNumber}`,
    });
  }

  // Avertissements sur les jours décalés
  if (afterDayNumber < days.length) {
    warnings.push(`Les jours ${afterDayNumber + 1} à ${days.length} ont été renumérotés (+1).`);
  }

  // Info sur le coût
  if (tripContext?.accommodation?.pricePerNight) {
    warnings.push(`Coût supplémentaire estimé : +${tripContext.accommodation.pricePerNight}€ (1 nuit d'hébergement) + repas.`);
  }

  return {
    success: true,
    changes,
    explanation: `J'ai ajouté une journée libre après le jour ${afterDayNumber}. Le nouveau jour ${afterDayNumber + 1} contient petit-déjeuner, temps libre, déjeuner et dîner. Votre voyage passe de ${days.length} à ${newDays.length} jours.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// General Response (for questions)
// ============================================

async function generateGeneralResponse(
  message: string,
  destination: string,
  days: TripDay[],
  conversationHistory?: ConversationContext
): Promise<string> {
  // Pour les questions générales, on peut répondre directement
  // ou utiliser Claude pour une réponse plus élaborée

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return "Je peux vous aider à modifier votre itinéraire. Dites-moi ce que vous souhaitez changer !";
  }

  // Construire le contexte conversationnel
  let historySection = '';
  if (conversationHistory && conversationHistory.recentExchanges.length > 0) {
    const exchanges = conversationHistory.recentExchanges
      .slice(-3) // Limiter à 3 échanges pour les questions générales
      .map(e => `Utilisateur: "${e.userMessage}"\nAssistant: "${e.assistantReply}"`)
      .join('\n---\n');
    historySection = `\nHistorique récent:\n${exchanges}\n`;
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Tu es un assistant de voyage amical. L'utilisateur planifie un voyage à ${destination} de ${days.length} jours.
${historySection}
Question de l'utilisateur: "${message}"

Réponds de manière concise et utile en français (max 2-3 phrases). Si c'est une question sur l'itinéraire, propose de l'aider à le modifier. Tiens compte de l'historique de conversation si présent.`,
      }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : "Comment puis-je vous aider avec votre itinéraire ?";
  } catch {
    return "Comment puis-je vous aider avec votre itinéraire ?";
  }
}

// ============================================
// Utilities
// ============================================

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function estimateSwapDuration(name: string): number {
  const nameLower = name.toLowerCase();
  if (/museum|musée|galerie|gallery/i.test(nameLower)) return 120;
  if (/parc|park|jardin|garden/i.test(nameLower)) return 90;
  if (/église|church|cathédrale|cathedral|temple|mosque|mosquée/i.test(nameLower)) return 60;
  if (/marché|market|bazar|bazaar/i.test(nameLower)) return 90;
  if (/plage|beach/i.test(nameLower)) return 180;
  if (/tour|tower|viewpoint|mirador/i.test(nameLower)) return 60;
  if (/quartier|neighborhood|district|barrio/i.test(nameLower)) return 120;
  return 90; // default
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

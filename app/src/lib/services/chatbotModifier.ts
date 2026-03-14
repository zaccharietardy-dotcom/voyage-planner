/**
 * Chatbot Modifier Service
 *
 * Moteur principal de modification d'itinéraire.
 * Prend une intention classifiée et génère les modifications à appliquer.
 */

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
import { fetchGeminiWithRetry } from './geminiSearch';

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

    case 'report_issue':
      return handleIssueReport(intent, days, constraints, rollbackData, tripContext);

    case 'change_pace':
      return changePace(intent, days, constraints, rollbackData, tripContext);

    case 'swap_category':
      return swapCategory(intent, days, constraints, rollbackData, tripContext);

    case 'rebalance':
      return rebalanceDays(intent, days, constraints, rollbackData);

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
// Add Activity
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
// Report Issue (Closed, Weather, etc.)
// ============================================

/**
 * Gère le signalement d'un problème avec une activité.
 * Génère des alternatives intelligentes basées sur le type de problème.
 */
async function handleIssueReport(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[],
  tripContext?: TripModificationContext
): Promise<ModificationResult> {
  const { targetActivity, issueType = 'unavailable', dayNumbers = [] } = intent.parameters;

  if (!targetActivity) {
    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas compris quelle activité pose problème. Pouvez-vous préciser ?",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: "Précisez quelle activité pose problème pour que je puisse vous proposer des alternatives.",
      },
    };
  }

  // Trouve l'activité concernée
  let targetItem: TripItem | null = null;
  let targetDay: TripDay | null = null;

  for (const day of days) {
    if (dayNumbers.length > 0 && !dayNumbers.includes(day.dayNumber)) continue;

    const item = day.items.find(i => {
      const normalizedTarget = normalizeString(targetActivity);
      const normalizedTitle = normalizeString(i.title);
      return normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle);
    });

    if (item) {
      targetItem = item;
      targetDay = day;
      break;
    }
  }

  if (!targetItem || !targetDay) {
    return {
      success: false,
      changes: [],
      explanation: `Je n'ai pas trouvé "${targetActivity}" dans votre itinéraire. Vérifiez le nom exact.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: `Je n'ai pas trouvé "${targetActivity}" dans votre itinéraire. Vérifiez le nom exact ou précisez le jour.`,
      },
    };
  }

  // Vérifie si l'activité est modifiable
  const constraint = constraints.find(c => c.itemId === targetItem!.id);
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
        message: `« ${targetItem.title} » ne peut pas être modifié(e). ${constraint.reason}`,
      },
    };
  }

  // Génère des suggestions intelligentes via Gemini
  const suggestions = await generateIssueSuggestions(
    targetItem,
    targetDay,
    issueType,
    days,
    tripContext
  );

  if (!suggestions || suggestions.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: `Je comprends que "${targetActivity}" pose problème. Malheureusement, je n'ai pas pu générer d'alternatives pour le moment. Essayez de préciser ce que vous souhaitez à la place.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'no_slot_available',
        message: `Impossible de générer des alternatives pour "${targetActivity}". Précisez ce que vous souhaitez à la place.`,
        alternativeSuggestion: {
          label: 'Supprimer cette activité',
          prompt: `Supprime "${targetActivity}"`,
        },
      },
    };
  }

  // Applique automatiquement la première suggestion
  const bestSuggestion = suggestions[0];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const newDay = newDays.find(d => d.dayNumber === targetDay!.dayNumber);

  if (!newDay) {
    return {
      success: false,
      changes: [],
      explanation: "Erreur lors du remplacement. Veuillez réessayer.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  const itemIndex = newDay.items.findIndex(i => i.id === targetItem!.id);
  if (itemIndex === -1) {
    return {
      success: false,
      changes: [],
      explanation: "Erreur lors du remplacement. Veuillez réessayer.",
      warnings: [],
      newDays: days,
      rollbackData,
    };
  }

  const item = newDay.items[itemIndex];
  const oldTitle = item.title;

  // Applique la meilleure suggestion
  item.title = bestSuggestion.title;
  item.description = bestSuggestion.description;
  item.dataReliability = 'estimated';

  // Enrichir avec coordonnées GPS si disponibles
  if (bestSuggestion.latitude && bestSuggestion.longitude) {
    item.latitude = bestSuggestion.latitude;
    item.longitude = bestSuggestion.longitude;
  } else {
    try {
      const { geocodeAddress } = await import('./geocoding');
      const destination = tripContext?.destination || days[0]?.items?.find((i: any) => i.type === 'checkin')?.locationName || '';
      const searchQuery = `${bestSuggestion.title}, ${destination}`;
      const coords = await geocodeAddress(searchQuery);
      if (coords) {
        item.latitude = coords.lat;
        item.longitude = coords.lng;
      }
    } catch (err) {
      console.warn('[IssueReport] Geocoding failed:', err);
    }
  }

  item.googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bestSuggestion.title)}`;

  // Ajuste la durée si nécessaire
  if (bestSuggestion.estimatedDuration) {
    const startMinutes = timeToMinutes(item.startTime);
    item.endTime = minutesToTime(startMinutes + bestSuggestion.estimatedDuration);
    item.duration = bestSuggestion.estimatedDuration;
  }

  const change: TripChange = {
    type: 'update',
    dayNumber: newDay.dayNumber,
    itemId: item.id,
    before: { title: oldTitle },
    after: { title: bestSuggestion.title },
    description: `"${oldTitle}" → "${bestSuggestion.title}"`,
  };

  // Construit le message de réponse avec toutes les suggestions
  const issueTypeText = {
    closed: 'fermé(e)',
    weather: 'incompatible avec la météo',
    unavailable: 'indisponible',
    schedule_change: 'avec des horaires modifiés',
  }[issueType] || 'avec un problème';

  const otherSuggestions = suggestions.slice(1, 3)
    .map((s, i) => `${i + 2}. **${s.title}** — ${s.description}`)
    .join('\n');

  const explanation = `Je comprends que "${oldTitle}" soit ${issueTypeText}. Voici ce que je vous propose :

**1. ${bestSuggestion.title}** ✅ (appliqué automatiquement)
${bestSuggestion.description}

${otherSuggestions ? `Autres alternatives :\n${otherSuggestions}\n\n` : ''}Pour appliquer une autre suggestion, dites-moi simplement "remplace par [nom de l'activité]".`;

  return {
    success: true,
    changes: [change],
    explanation,
    warnings: constraint?.type === 'booking_required' ? [constraint.reason] : [],
    newDays,
    rollbackData,
  };
}

/**
 * Génère des suggestions intelligentes basées sur le type de problème
 */
async function generateIssueSuggestions(
  targetItem: TripItem,
  targetDay: TripDay,
  issueType: string,
  days: TripDay[],
  tripContext?: TripModificationContext
): Promise<Array<{
  title: string;
  description: string;
  estimatedDuration?: number;
  latitude?: number;
  longitude?: number;
}> | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[IssueReport] GOOGLE_AI_API_KEY non configurée');
    return null;
  }

  const destination = tripContext?.destination || days[0]?.items?.find((i: any) => i.type === 'checkin')?.locationName || 'la destination';

  // Récupère les autres activités du jour pour contexte
  const dayActivities = targetDay.items
    .filter(i => i.type === 'activity' && i.id !== targetItem.id)
    .map(i => i.title)
    .join(', ');

  // Construit le contexte pour Gemini
  const issueContext = {
    closed: `L'activité est fermée définitivement ou temporairement. Proposer des alternatives similaires dans la même zone.`,
    weather: `La météo est défavorable (pluie, vent). Proposer des activités INTÉRIEURES (musées, galeries, marchés couverts, shopping, spa, cinéma, cuisine, ateliers).`,
    unavailable: `L'activité n'est plus disponible ou accessible. Proposer des alternatives similaires ou complémentaires.`,
    schedule_change: `Les horaires ont changé. Proposer des alternatives similaires ou suggérer un ajustement de timing.`,
  }[issueType] || `Il y a un problème avec cette activité. Proposer des alternatives pertinentes.`;

  const prompt = `Tu es un assistant de voyage expert. L'utilisateur a un problème avec une activité planifiée.

CONTEXTE:
- Destination: ${destination}
- Jour: ${targetDay.dayNumber} (${targetDay.theme || 'pas de thème'})
- Activité problématique: "${targetItem.title}"
- Type de problème: ${issueType}
- ${issueContext}
- Autres activités du jour: ${dayActivities || 'aucune'}
- Durée originale: ${targetItem.duration || 90} minutes
- Horaire: ${targetItem.startTime} - ${targetItem.endTime}

TÂCHE:
Génère exactement 3 suggestions d'activités alternatives pertinentes qui:
1. Sont adaptées au type de problème (ex: si météo défavorable, UNIQUEMENT des activités intérieures)
2. Sont situées dans la même zone géographique ou facilement accessibles
3. Ont une durée similaire ou adaptable
4. Sont cohérentes avec le reste du voyage
5. Sont des attractions/activités RÉELLES et POPULAIRES à ${destination}

${issueType === 'weather' ? '\n⚠️ IMPORTANT: Pour un problème météo, propose UNIQUEMENT des activités INTÉRIEURES (musées, galeries, marchés couverts, shopping centers, spa, cinéma, ateliers créatifs, etc.).\n' : ''}

Réponds UNIQUEMENT en JSON valide:
[
  {
    "title": "Nom exact de l'activité",
    "description": "Description courte (1-2 phrases) expliquant pourquoi c'est une bonne alternative",
    "estimatedDuration": 90,
    "latitude": 48.8566,
    "longitude": 2.3522
  },
  {
    "title": "...",
    "description": "...",
    "estimatedDuration": 60,
    "latitude": null,
    "longitude": null
  },
  {
    "title": "...",
    "description": "...",
    "estimatedDuration": 120,
    "latitude": null,
    "longitude": null
  }
]`;

  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[IssueReport] Gemini API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      console.error('[IssueReport] No JSON array found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Valide et nettoie
    const valid = parsed
      .filter((s: any) => s.title && s.description)
      .slice(0, 3)
      .map((s: any) => ({
        title: s.title,
        description: s.description,
        estimatedDuration: s.estimatedDuration || targetItem.duration || 90,
        latitude: s.latitude || undefined,
        longitude: s.longitude || undefined,
      }));

    return valid.length >= 2 ? valid : null;
  } catch (error) {
    console.error('[IssueReport] Error generating suggestions:', error);
    return null;
  }
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
  // ou utiliser Gemini pour une réponse plus élaborée

  const apiKey = process.env.GOOGLE_AI_API_KEY;
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

  const prompt = `Tu es un assistant de voyage amical. L'utilisateur planifie un voyage à ${destination} de ${days.length} jours.
${historySection}
Question de l'utilisateur: "${message}"

Réponds de manière concise et utile en français (max 2-3 phrases). Si c'est une question sur l'itinéraire, propose de l'aider à le modifier. Tiens compte de l'historique de conversation si présent.`;

  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 300,
      },
    });

    if (!response.ok) {
      return "Comment puis-je vous aider avec votre itinéraire ?";
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text
      || "Comment puis-je vous aider avec votre itinéraire ?";
  } catch {
    return "Comment puis-je vous aider avec votre itinéraire ?";
  }
}

// ============================================
// Change Pace
// ============================================

function changePace(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[],
  tripContext?: TripModificationContext
): ModificationResult {
  const { dayNumbers = [], paceDirection = 'relax' } = intent.parameters;

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  // Si aucun jour spécifié, on prend tous les jours
  const targetDays = dayNumbers.length > 0
    ? dayNumbers
    : days.map(d => d.dayNumber);

  if (paceDirection === 'relax') {
    // Relax : supprimer l'activité avec le plus faible score/rating sur chaque jour ciblé
    for (const day of newDays) {
      if (!targetDays.includes(day.dayNumber)) continue;

      const modifiableActivities = day.items.filter(item =>
        item.type === 'activity' && !constrainedIds.has(item.id)
      );

      if (modifiableActivities.length <= 1) {
        warnings.push(`Jour ${day.dayNumber} n'a qu'une seule activité, impossible de la supprimer.`);
        continue;
      }

      // Trouver l'activité la moins bien notée
      const lowestScored = modifiableActivities.reduce((worst, item) => {
        const itemRating = item.rating || 0;
        const worstRating = worst.rating || 0;
        return itemRating < worstRating ? item : worst;
      }, modifiableActivities[0]);

      const itemIndex = day.items.findIndex(i => i.id === lowestScored.id);
      if (itemIndex !== -1) {
        day.items.splice(itemIndex, 1);
        changes.push({
          type: 'remove',
          dayNumber: day.dayNumber,
          itemId: lowestScored.id,
          before: { title: lowestScored.title, startTime: lowestScored.startTime, endTime: lowestScored.endTime },
          description: `Suppression de "${lowestScored.title}" pour alléger le jour ${day.dayNumber}`,
        });
      }
    }
  } else {
    // Intense : suggérer d'ajouter une activité depuis le pool
    const pool = tripContext?.attractionPool;
    if (!pool || pool.length === 0) {
      return {
        success: false,
        changes: [],
        explanation: "Je n'ai pas de pool d'activités disponible pour intensifier la journée. Essayez d'ajouter une activité spécifique.",
        warnings: [],
        newDays: days,
        rollbackData,
        errorInfo: {
          type: 'no_slot_available',
          message: "Pas de pool d'activités disponible pour ajouter une activité supplémentaire.",
          alternativeSuggestion: {
            label: 'Ajouter une activité',
            prompt: 'Ajoute une activité culturelle',
          },
        },
      };
    }

    for (const day of newDays) {
      if (!targetDays.includes(day.dayNumber)) continue;

      // Trouver les IDs déjà utilisés dans l'itinéraire
      const usedIds = new Set(newDays.flatMap(d => d.items.map(i => i.id)));

      // Trouver une activité du pool non encore dans l'itinéraire
      const candidate = pool
        .filter(a => !usedIds.has(a.id))
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];

      if (!candidate) {
        warnings.push(`Jour ${day.dayNumber} : aucune activité supplémentaire disponible dans le pool.`);
        continue;
      }

      // Trouver un créneau libre (après la dernière activité avant le dîner)
      const activities = day.items.filter(i => i.type === 'activity');
      const lastActivity = activities.length > 0
        ? activities.reduce((latest, i) => timeToMinutes(i.endTime) > timeToMinutes(latest.endTime) ? i : latest)
        : null;

      const startMinutes = lastActivity ? timeToMinutes(lastActivity.endTime) + 15 : 600;
      const duration = candidate.duration || 90;
      const endMinutes = startMinutes + duration;

      if (endMinutes > 1200) { // 20:00
        warnings.push(`Jour ${day.dayNumber} : pas assez de temps pour ajouter une activité supplémentaire.`);
        continue;
      }

      const newItem: TripItem = {
        id: candidate.id,
        dayNumber: day.dayNumber,
        type: 'activity',
        title: candidate.name,
        startTime: minutesToTime(startMinutes),
        endTime: minutesToTime(endMinutes),
        duration,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        locationName: candidate.name,
        orderIndex: day.items.length,
        rating: candidate.rating,
        description: candidate.description || '',
        dataReliability: 'estimated',
      };

      day.items.push(newItem);
      day.items.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

      changes.push({
        type: 'add',
        dayNumber: day.dayNumber,
        newItem,
        description: `Ajout de "${candidate.name}" au jour ${day.dayNumber}`,
      });
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: paceDirection === 'relax'
        ? "Impossible d'alléger la journée : il n'y a pas assez d'activités modifiables."
        : "Impossible d'intensifier la journée : pas de créneau libre ou pas d'activités disponibles.",
      warnings,
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'constraint_violation',
        message: paceDirection === 'relax'
          ? "Les journées ciblées n'ont pas assez d'activités supprimables."
          : "Pas de créneau libre disponible pour ajouter une activité.",
      },
    };
  }

  const daysText = targetDays.length === days.length
    ? 'tous les jours'
    : `jour${targetDays.length > 1 ? 's' : ''} ${targetDays.join(', ')}`;

  return {
    success: true,
    changes,
    explanation: paceDirection === 'relax'
      ? `J'ai allégé le ${daysText} en supprimant ${changes.length} activité${changes.length > 1 ? 's' : ''} moins prioritaire${changes.length > 1 ? 's' : ''}.`
      : `J'ai intensifié le ${daysText} en ajoutant ${changes.length} activité${changes.length > 1 ? 's' : ''}.`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Swap Category
// ============================================

function swapCategory(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[],
  tripContext?: TripModificationContext
): ModificationResult {
  const { dayNumbers = [], targetActivity, newCategory } = intent.parameters;

  if (!newCategory) {
    return {
      success: false,
      changes: [],
      explanation: "Précisez la catégorie souhaitée (outdoor, culture, nature, adventure, shopping, etc.).",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: "Précisez la catégorie souhaitée pour le remplacement.",
      },
    };
  }

  const pool = tripContext?.attractionPool;
  if (!pool || pool.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas de pool d'activités pour trouver une alternative. Essayez de préciser directement l'activité souhaitée.",
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'no_slot_available',
        message: "Pas de pool d'activités disponible pour chercher des alternatives.",
        alternativeSuggestion: {
          label: 'Remplacer directement',
          prompt: `Remplace ${targetActivity || 'cette activité'} par une activité spécifique`,
        },
      },
    };
  }

  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  // Mapper la catégorie utilisateur vers les ActivityType du pool
  const categoryMapping: Record<string, string[]> = {
    outdoor: ['nature', 'adventure', 'beach'],
    nature: ['nature'],
    culture: ['culture'],
    adventure: ['adventure'],
    beach: ['beach'],
    shopping: ['shopping'],
    wellness: ['wellness'],
    nightlife: ['nightlife'],
    gastronomy: ['gastronomy'],
  };

  const normalizedCategory = normalizeString(newCategory);
  const matchingTypes = categoryMapping[normalizedCategory] || [normalizedCategory];

  // Trouver les activités du pool qui correspondent à la catégorie demandée
  const usedIds = new Set(newDays.flatMap(d => d.items.map(i => i.id)));
  const poolCandidates = pool
    .filter(a => matchingTypes.includes(a.type) && !usedIds.has(a.id))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));

  if (poolCandidates.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: `Je n'ai pas trouvé d'activité de type « ${newCategory} » dans le pool disponible.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: `Aucune activité de type « ${newCategory} » disponible dans le pool.`,
        alternativeSuggestion: {
          label: 'Essayer une autre catégorie',
          prompt: 'Remplace une activité par quelque chose de nature',
        },
      },
    };
  }

  const targetDays = dayNumbers.length > 0
    ? dayNumbers
    : days.map(d => d.dayNumber);

  let candidateIndex = 0;

  for (const day of newDays) {
    if (!targetDays.includes(day.dayNumber)) continue;
    if (candidateIndex >= poolCandidates.length) break;

    // Trouver l'activité à remplacer
    let itemToReplace: TripItem | undefined;

    if (targetActivity) {
      // Si une activité cible est spécifiée, la chercher
      itemToReplace = day.items.find(i => {
        if (constrainedIds.has(i.id)) return false;
        if (i.type !== 'activity') return false;
        const normalizedTarget = normalizeString(targetActivity);
        const normalizedTitle = normalizeString(i.title);
        return normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle);
      });
    } else {
      // Sinon, trouver une activité dont le type ne correspond PAS à la catégorie demandée
      // (on ne remplace pas outdoor par outdoor)
      itemToReplace = day.items.find(i => {
        if (constrainedIds.has(i.id)) return false;
        if (i.type !== 'activity') return false;
        // Chercher dans le pool original pour retrouver le type de l'activité
        const poolEntry = pool.find(p => normalizeString(p.name) === normalizeString(i.title));
        if (poolEntry) {
          return !matchingTypes.includes(poolEntry.type);
        }
        // Fallback : utiliser des heuristiques sur le nom
        return true;
      });
    }

    if (!itemToReplace) continue;

    const candidate = poolCandidates[candidateIndex++];
    const oldTitle = itemToReplace.title;

    // Remplacer les données de l'item
    itemToReplace.title = candidate.name;
    itemToReplace.latitude = candidate.latitude;
    itemToReplace.longitude = candidate.longitude;
    itemToReplace.rating = candidate.rating;
    itemToReplace.description = candidate.description;
    itemToReplace.duration = candidate.duration || itemToReplace.duration;
    itemToReplace.dataReliability = 'estimated';

    // Ajuster endTime si la durée change
    if (candidate.duration) {
      const startMin = timeToMinutes(itemToReplace.startTime);
      itemToReplace.endTime = minutesToTime(startMin + candidate.duration);
    }

    changes.push({
      type: 'update',
      dayNumber: day.dayNumber,
      itemId: itemToReplace.id,
      before: { title: oldTitle },
      after: { title: candidate.name },
      description: `"${oldTitle}" → "${candidate.name}" (${newCategory})`,
    });
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: `Je n'ai pas trouvé d'activité à remplacer par du « ${newCategory} » dans les jours ciblés.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'item_not_found',
        message: targetActivity
          ? `Je n'ai pas trouvé « ${targetActivity} » dans votre itinéraire.`
          : `Aucune activité remplaçable trouvée dans les jours ciblés.`,
      },
    };
  }

  return {
    success: true,
    changes,
    explanation: `J'ai remplacé ${changes.length} activité${changes.length > 1 ? 's' : ''} par ${changes.length > 1 ? 'des activités' : 'une activité'} de type « ${newCategory} ».`,
    warnings,
    newDays,
    rollbackData,
  };
}

// ============================================
// Rebalance Days
// ============================================

function rebalanceDays(
  intent: ModificationIntent,
  days: TripDay[],
  constraints: ReturnType<typeof getConstraints>,
  rollbackData: TripDay[]
): ModificationResult {
  const changes: TripChange[] = [];
  const newDays = JSON.parse(JSON.stringify(days)) as TripDay[];
  const warnings: string[] = [];

  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  // Compter les activités modifiables par jour
  const dayCounts = newDays.map(day => ({
    dayNumber: day.dayNumber,
    activities: day.items.filter(i => i.type === 'activity' && !constrainedIds.has(i.id)),
    totalActivities: day.items.filter(i => i.type === 'activity').length,
  }));

  // Calculer la moyenne et l'écart-type
  const counts = dayCounts.map(d => d.totalActivities);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev <= 1) {
    return {
      success: false,
      changes: [],
      explanation: `Votre itinéraire est déjà bien équilibré (${counts.join(', ')} activités par jour). L'écart est faible.`,
      warnings: [],
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'constraint_violation',
        message: "L'itinéraire est déjà bien équilibré, pas de redistribution nécessaire.",
        alternativeSuggestion: {
          label: 'Alléger un jour',
          prompt: 'Rends le jour le plus chargé plus relax',
        },
      },
    };
  }

  // Identifier les jours lourds (> mean) et légers (< mean)
  const heavyDays = dayCounts.filter(d => d.totalActivities > Math.ceil(mean));
  const lightDays = dayCounts.filter(d => d.totalActivities < Math.floor(mean));

  // Déplacer des activités des jours lourds vers les jours légers
  for (const heavy of heavyDays) {
    const excess = heavy.totalActivities - Math.ceil(mean);
    if (excess <= 0) continue;

    // Trouver les activités déplaçables (les moins bien notées)
    const moveable = heavy.activities
      .sort((a, b) => (a.rating || 0) - (b.rating || 0))
      .slice(0, excess);

    for (const item of moveable) {
      // Trouver le jour le plus léger qui peut accueillir l'activité
      const targetLight = lightDays
        .filter(l => {
          const currentCount = newDays.find(d => d.dayNumber === l.dayNumber)!
            .items.filter(i => i.type === 'activity').length;
          return currentCount < Math.ceil(mean);
        })
        .sort((a, b) => {
          const aCount = newDays.find(d => d.dayNumber === a.dayNumber)!
            .items.filter(i => i.type === 'activity').length;
          const bCount = newDays.find(d => d.dayNumber === b.dayNumber)!
            .items.filter(i => i.type === 'activity').length;
          return aCount - bCount;
        })[0];

      if (!targetLight) continue;

      const sourceDay = newDays.find(d => d.dayNumber === heavy.dayNumber)!;
      const destDay = newDays.find(d => d.dayNumber === targetLight.dayNumber)!;

      // Retirer de la source
      const removeIndex = sourceDay.items.findIndex(i => i.id === item.id);
      if (removeIndex === -1) continue;
      const [movedItem] = sourceDay.items.splice(removeIndex, 1);

      // Trouver un créneau dans le jour de destination
      const destActivities = destDay.items.filter(i => i.type === 'activity');
      const lastDestActivity = destActivities.length > 0
        ? destActivities.reduce((latest, i) => timeToMinutes(i.endTime) > timeToMinutes(latest.endTime) ? i : latest)
        : null;

      const newStart = lastDestActivity ? timeToMinutes(lastDestActivity.endTime) + 15 : 600;
      const itemDuration = movedItem.duration || (timeToMinutes(movedItem.endTime) - timeToMinutes(movedItem.startTime));
      const newEnd = newStart + itemDuration;

      if (newEnd > 1200) { // 20:00
        // Remettre l'item à sa place si pas de créneau
        sourceDay.items.splice(removeIndex, 0, movedItem);
        warnings.push(`"${movedItem.title}" ne peut pas être déplacée au jour ${destDay.dayNumber} (pas assez de place).`);
        continue;
      }

      movedItem.startTime = minutesToTime(newStart);
      movedItem.endTime = minutesToTime(newEnd);

      destDay.items.push(movedItem);
      destDay.items.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

      changes.push({
        type: 'move',
        dayNumber: heavy.dayNumber,
        itemId: movedItem.id,
        before: { title: movedItem.title },
        after: { title: movedItem.title },
        description: `"${movedItem.title}" : jour ${heavy.dayNumber} → jour ${targetLight.dayNumber}`,
      });
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      changes: [],
      explanation: "Je n'ai pas pu rééquilibrer l'itinéraire. Les contraintes empêchent de déplacer les activités.",
      warnings,
      newDays: days,
      rollbackData,
      errorInfo: {
        type: 'constraint_violation',
        message: "Impossible de redistribuer les activités entre les jours avec les contraintes actuelles.",
        alternativeSuggestion: {
          label: 'Alléger le jour le plus chargé',
          prompt: 'Rends le jour le plus chargé plus relax',
        },
      },
    };
  }

  // Recalculer les stats après rééquilibrage
  const newCounts = newDays.map(d => d.items.filter(i => i.type === 'activity').length);

  return {
    success: true,
    changes,
    explanation: `J'ai rééquilibré l'itinéraire en déplaçant ${changes.length} activité${changes.length > 1 ? 's' : ''}. Répartition : ${newCounts.join(', ')} activités par jour.`,
    warnings,
    newDays,
    rollbackData,
  };
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

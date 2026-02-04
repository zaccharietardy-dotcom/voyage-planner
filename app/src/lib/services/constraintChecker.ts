/**
 * Constraint Checker Service
 *
 * Vérifie les contraintes sur l'itinéraire pour empêcher
 * les modifications invalides (vols, réservations payées, etc.)
 */

import { TripConstraint, TripDay, TripItem, TripChange } from '../types';

// ============================================
// Constraint Detection
// ============================================

/**
 * Identifie tous les items avec des contraintes dans le voyage
 */
export function getConstraints(days: TripDay[]): TripConstraint[] {
  const constraints: TripConstraint[] = [];

  for (const day of days) {
    for (const item of day.items) {
      const constraint = getItemConstraint(item);
      if (constraint) {
        constraints.push(constraint);
      }
    }
  }

  return constraints;
}

/**
 * Vérifie si un item a une contrainte
 */
function getItemConstraint(item: TripItem): TripConstraint | null {
  // Vols - toujours immutables
  if (item.type === 'flight') {
    return {
      itemId: item.id,
      type: 'immutable',
      reason: 'Les vols ne peuvent pas être modifiés. Contactez la compagnie aérienne pour tout changement.',
    };
  }

  // Check-in/check-out hôtel - horaires fixes
  if (item.type === 'checkin') {
    return {
      itemId: item.id,
      type: 'time_locked',
      reason: "L'heure de check-in est fixée par l'hôtel.",
    };
  }

  if (item.type === 'checkout') {
    return {
      itemId: item.id,
      type: 'time_locked',
      reason: "L'heure de check-out est fixée par l'hôtel.",
    };
  }

  // Réservations payées (avec URL de réservation et coût > 0)
  if (item.bookingUrl && item.estimatedCost && item.estimatedCost > 0) {
    // Activités avec réservation Viator/Tiqets
    if (item.viatorUrl || item.tiqetsUrl) {
      return {
        itemId: item.id,
        type: 'booking_required',
        reason: `Cette activité semble avoir une réservation payée (${item.estimatedCost}€). Voulez-vous vraiment la modifier ?`,
      };
    }
  }

  // Transport réservé
  if (item.type === 'transport' && item.bookingUrl) {
    return {
      itemId: item.id,
      type: 'booking_required',
      reason: 'Ce transport a une réservation. Vérifiez les conditions d\'annulation.',
    };
  }

  // Parking réservé
  if (item.type === 'parking' && item.bookingUrl) {
    return {
      itemId: item.id,
      type: 'booking_required',
      reason: 'Ce parking a une réservation. Vérifiez les conditions d\'annulation.',
    };
  }

  return null;
}

// ============================================
// Validation
// ============================================

export interface ValidationResult {
  valid: boolean;
  blockedChanges: {
    change: TripChange;
    constraint: TripConstraint;
  }[];
  warningChanges: {
    change: TripChange;
    constraint: TripConstraint;
  }[];
}

/**
 * Valide un ensemble de modifications contre les contraintes
 */
export function validateModifications(
  changes: TripChange[],
  constraints: TripConstraint[]
): ValidationResult {
  const blockedChanges: { change: TripChange; constraint: TripConstraint }[] = [];
  const warningChanges: { change: TripChange; constraint: TripConstraint }[] = [];

  for (const change of changes) {
    // Recherche la contrainte pour cet item
    const constraint = constraints.find(c => c.itemId === change.itemId);

    if (!constraint) continue;

    // Immutable = bloqué
    if (constraint.type === 'immutable') {
      // Seule exception: on peut "voir" l'item mais pas le modifier/supprimer
      if (change.type === 'remove' || change.type === 'update' || change.type === 'move') {
        blockedChanges.push({ change, constraint });
      }
    }

    // Time-locked = bloqué pour les modifications d'horaire
    if (constraint.type === 'time_locked') {
      if (change.type === 'update' && change.after?.startTime) {
        blockedChanges.push({ change, constraint });
      }
      if (change.type === 'remove') {
        blockedChanges.push({ change, constraint });
      }
    }

    // Booking required = avertissement (pas bloquant)
    if (constraint.type === 'booking_required') {
      warningChanges.push({ change, constraint });
    }
  }

  return {
    valid: blockedChanges.length === 0,
    blockedChanges,
    warningChanges,
  };
}

// ============================================
// Time Conflict Detection
// ============================================

export interface TimeConflict {
  item1: TripItem;
  item2: TripItem;
  overlapMinutes: number;
}

/**
 * Détecte les conflits horaires dans une journée
 */
export function detectTimeConflicts(items: TripItem[]): TimeConflict[] {
  const conflicts: TimeConflict[] = [];

  // Trie par heure de début
  const sorted = [...items].sort((a, b) => a.startTime.localeCompare(b.startTime));

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    const currentEnd = timeToMinutes(current.endTime);
    const nextStart = timeToMinutes(next.startTime);

    if (currentEnd > nextStart) {
      conflicts.push({
        item1: current,
        item2: next,
        overlapMinutes: currentEnd - nextStart,
      });
    }
  }

  return conflicts;
}

/**
 * Convertit "HH:mm" en minutes depuis minuit
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convertit des minutes en "HH:mm"
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ============================================
// Boundary Checks
// ============================================

/**
 * Vérifie que les modifications respectent les limites horaires
 * (pas avant 6h, pas après 23h)
 */
export function checkTimeBoundaries(
  items: TripItem[],
  minHour: number = 6,
  maxHour: number = 23
): { item: TripItem; issue: string }[] {
  const issues: { item: TripItem; issue: string }[] = [];

  for (const item of items) {
    const startMinutes = timeToMinutes(item.startTime);
    const endMinutes = timeToMinutes(item.endTime);

    if (startMinutes < minHour * 60) {
      issues.push({
        item,
        issue: `${item.title} commence trop tôt (${item.startTime}). Heure minimale: ${minHour}:00`,
      });
    }

    if (endMinutes > maxHour * 60) {
      issues.push({
        item,
        issue: `${item.title} termine trop tard (${item.endTime}). Heure maximale: ${maxHour}:00`,
      });
    }
  }

  return issues;
}

// ============================================
// Constraint-aware Time Shifting
// ============================================

/**
 * Calcule le décalage maximum possible en respectant les contraintes
 */
export function getMaxTimeShift(
  items: TripItem[],
  constraints: TripConstraint[],
  direction: 'later' | 'earlier'
): number {
  const constrainedIds = new Set(
    constraints
      .filter(c => c.type === 'immutable' || c.type === 'time_locked')
      .map(c => c.itemId)
  );

  // Trouve les items mobiles (sans contrainte)
  const mobileItems = items.filter(i => !constrainedIds.has(i.id));

  if (mobileItems.length === 0) return 0;

  if (direction === 'later') {
    // Trouve l'item qui finit le plus tard
    const latestEnd = Math.max(...mobileItems.map(i => timeToMinutes(i.endTime)));
    // Max = 23:00 (1380 minutes)
    return Math.max(0, 1380 - latestEnd);
  } else {
    // Trouve l'item qui commence le plus tôt
    const earliestStart = Math.min(...mobileItems.map(i => timeToMinutes(i.startTime)));
    // Min = 6:00 (360 minutes)
    return Math.max(0, earliestStart - 360);
  }
}

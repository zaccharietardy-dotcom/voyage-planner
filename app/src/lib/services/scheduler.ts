/**
 * Scheduler - Gestion des créneaux horaires sans chevauchement
 *
 * Architecture basée sur l'Interval Scheduling:
 * - Chaque activité a un créneau (start, end) exclusif
 * - Construction séquentielle: chaque item commence après le précédent
 * - Validation: aucun chevauchement autorisé
 * - Les heures sont arrondies pour éviter 19h12, 20h42 etc. (Bug #6)
 *
 * @see https://en.wikipedia.org/wiki/Interval_scheduling
 */

import { roundToNearestHour } from './scheduling';

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface ScheduleItem {
  id: string;
  title: string;
  type: string;
  slot: TimeSlot;
  duration: number; // minutes
  travelTimeFromPrevious?: number; // minutes
  data?: any; // données additionnelles (attraction, restaurant, etc.)
}

export interface DaySchedule {
  date: Date;
  dayNumber: number;
  items: ScheduleItem[];
  availableFrom: Date;
  availableUntil: Date;
}

/**
 * Scheduler class - Construit un emploi du temps sans chevauchement
 */
export class DayScheduler {
  private items: ScheduleItem[] = [];
  private currentTime: Date;
  private readonly dayStart: Date;
  private readonly dayEnd: Date;
  private readonly date: Date;

  constructor(date: Date, availableFrom: Date, availableUntil: Date) {
    this.date = new Date(date);
    this.dayStart = new Date(availableFrom);
    this.dayEnd = new Date(availableUntil);

    // Validation de coherence: dayEnd doit etre apres dayStart
    if (this.dayEnd <= this.dayStart) {
      console.warn(`[Scheduler] ATTENTION: dayEnd (${formatTime(this.dayEnd)}) <= dayStart (${formatTime(this.dayStart)})`);
      console.warn(`[Scheduler] Ajustement automatique: +2h depuis dayStart`);
      this.dayEnd = new Date(this.dayStart.getTime() + 2 * 60 * 60 * 1000);
    }

    this.currentTime = new Date(availableFrom);
  }

  /**
   * Retourne l'heure actuelle du curseur
   */
  getCurrentTime(): Date {
    return new Date(this.currentTime);
  }

  /**
   * Retourne le temps restant en minutes
   */
  getRemainingMinutes(): number {
    return Math.max(0, (this.dayEnd.getTime() - this.currentTime.getTime()) / (1000 * 60));
  }

  /**
   * Vérifie si on peut ajouter une activité de X minutes
   */
  canFit(durationMinutes: number, travelMinutes: number = 0): boolean {
    const totalNeeded = durationMinutes + travelMinutes;
    return this.getRemainingMinutes() >= totalNeeded;
  }

  /**
   * Ajoute un créneau et avance le curseur
   * Retourne le créneau créé ou null si pas assez de temps
   *
   * AMÉLIORATION: Vérifie les conflits avec les items existants et décale si nécessaire
   */
  addItem(params: {
    id: string;
    title: string;
    type: string;
    duration: number; // minutes
    travelTime?: number; // temps de trajet depuis le lieu précédent
    minStartTime?: Date; // heure minimum de début (ex: ouverture)
    data?: any;
  }): ScheduleItem | null {
    const { id, title, type, duration, travelTime = 0, minStartTime, data } = params;

    // Buffer time entre activités (sauf pour transport/flight/checkin/checkout)
    const BUFFER_MINUTES = 5;
    const needsBuffer = !['flight', 'transport', 'checkin', 'checkout', 'parking'].includes(type);

    // DEBUG: Afficher l'etat du curseur
    console.log(`[Scheduler] addItem("${title}") - curseur: ${formatTime(this.currentTime)}, trajet: ${travelTime}min`);

    // Calculer l'heure de debut (curseur actuel + temps de trajet + buffer)
    const bufferTime = needsBuffer ? BUFFER_MINUTES : 0;
    let startTime = new Date(this.currentTime.getTime() + (travelTime + bufferTime) * 60 * 1000);
    console.log(`[Scheduler]   -> startTime initial: ${formatTime(startTime)} (buffer: ${bufferTime}min)`);

    // Respecter l'heure minimum si specifiee (ex: horaire d'ouverture)
    // L'attraction peut avoir une heure d'ouverture APRES notre arrivee
    if (minStartTime) {
      console.log(`[Scheduler]   -> minStartTime (ouverture): ${formatTime(minStartTime)}`);
      // Si on arrive AVANT l'ouverture, on attend
      if (startTime < minStartTime) {
        // MAIS: seulement si l'ouverture est APRES le curseur actuel
        // Sinon ca veut dire qu'on arrive APRES l'ouverture, donc pas besoin d'attendre
        if (minStartTime > this.currentTime) {
          console.log(`[Scheduler]   -> On attend l'ouverture: ${formatTime(minStartTime)}`);
          startTime = new Date(minStartTime);
        } else {
          console.log(`[Scheduler]   -> Lieu deja ouvert, on garde startTime`);
        }
      }
    }

    // PROTECTION ABSOLUE: startTime ne peut JAMAIS etre avant le curseur
    // Cette protection garantit qu'on ne planifie pas dans le passe
    const cursorTime = this.currentTime.getTime();
    const startTimeMs = startTime.getTime();
    if (startTimeMs < cursorTime) {
      console.error(`[Scheduler] ERREUR CRITIQUE: "${title}" startTime ${formatTime(startTime)} < curseur ${formatTime(this.currentTime)}`);
      console.error(`[Scheduler] Timestamps: startTime=${startTimeMs}, cursor=${cursorTime}, diff=${cursorTime - startTimeMs}ms`);
      // Forcer startTime au curseur + trajet
      startTime = new Date(cursorTime + travelTime * 60 * 1000);
      console.error(`[Scheduler] Correction appliquee: ${formatTime(startTime)}`);
    }

    // Bug #6: Arrondir à l'heure la plus proche pour éviter 19h12, 20h42
    // Sauf pour les vols et transports qui ont des horaires fixes
    if (type !== 'flight' && type !== 'transport' && type !== 'checkin') {
      const beforeRound = formatTime(startTime);
      startTime = roundToNearestHour(startTime);
      // S'assurer qu'on n'a pas reculé avant le curseur après arrondi
      if (startTime.getTime() < cursorTime) {
        startTime = new Date(cursorTime);
        startTime.setMinutes(0, 0, 0);
        startTime.setHours(startTime.getHours() + 1);
      }
      console.log(`[Scheduler]   -> Arrondi: ${beforeRound} → ${formatTime(startTime)}`);
    }

    // Calculer l'heure de fin
    let endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    // ============================================
    // NOUVEAU: Vérifier les conflits avec les items existants
    // et décaler le créneau si nécessaire
    // ============================================
    const proposedSlot = { start: startTime, end: endTime };
    const conflictingItem = this.findConflictingItem(proposedSlot);

    if (conflictingItem) {
      console.log(`[Scheduler] CONFLIT détecté: "${title}" chevauche "${conflictingItem.title}"`);
      console.log(`[Scheduler]   -> Proposé: ${formatTime(startTime)}-${formatTime(endTime)}`);
      console.log(`[Scheduler]   -> Existant: ${formatTime(conflictingItem.slot.start)}-${formatTime(conflictingItem.slot.end)}`);

      // Décaler après l'item en conflit + buffer
      startTime = new Date(conflictingItem.slot.end.getTime() + BUFFER_MINUTES * 60 * 1000);
      endTime = new Date(startTime.getTime() + duration * 60 * 1000);

      console.log(`[Scheduler]   -> Décalé à: ${formatTime(startTime)}-${formatTime(endTime)}`);

      // Re-vérifier après décalage (peut y avoir un autre conflit)
      const secondConflict = this.findConflictingItem({ start: startTime, end: endTime });
      if (secondConflict) {
        // Trouver le prochain créneau libre
        const nextFreeSlot = this.findNextFreeSlot(duration, startTime);
        if (nextFreeSlot) {
          startTime = nextFreeSlot.start;
          endTime = nextFreeSlot.end;
          console.log(`[Scheduler]   -> Prochain créneau libre: ${formatTime(startTime)}-${formatTime(endTime)}`);
        } else {
          console.log(`[Scheduler] Aucun créneau libre trouvé pour "${title}"`);
          return null;
        }
      }
    }

    // Vérifier qu'on ne dépasse pas la fin de journée
    if (endTime > this.dayEnd) {
      console.log(`[Scheduler] Cannot fit "${title}" (${duration}min) - ends at ${formatTime(endTime)}, day ends at ${formatTime(this.dayEnd)}`);
      return null;
    }

    // Créer le créneau
    const item: ScheduleItem = {
      id,
      title,
      type,
      slot: { start: startTime, end: endTime },
      duration,
      travelTimeFromPrevious: travelTime > 0 ? travelTime : undefined,
      data,
    };

    // Ajouter et avancer le curseur
    this.items.push(item);
    this.currentTime = endTime;

    console.log(`[Scheduler] Added "${title}" ${formatTime(startTime)}-${formatTime(endTime)}`);

    return item;
  }

  /**
   * Trouve un item existant qui chevauche le créneau proposé
   */
  private findConflictingItem(slot: TimeSlot): ScheduleItem | null {
    for (const item of this.items) {
      if (this.overlaps(item.slot, slot)) {
        return item;
      }
    }
    return null;
  }

  /**
   * Trouve le prochain créneau libre d'au moins X minutes après une heure donnée
   */
  private findNextFreeSlot(durationMinutes: number, afterTime: Date): TimeSlot | null {
    const BUFFER_MINUTES = 5;

    // Trier les items par heure de début
    const sorted = [...this.items].sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());

    let candidateStart = new Date(afterTime);

    for (const item of sorted) {
      // Si l'item est avant notre candidat, on passe
      if (item.slot.end <= candidateStart) {
        continue;
      }

      // Si notre candidat chevauche cet item, on se décale après
      if (candidateStart < item.slot.end && item.slot.start < new Date(candidateStart.getTime() + durationMinutes * 60 * 1000)) {
        candidateStart = new Date(item.slot.end.getTime() + BUFFER_MINUTES * 60 * 1000);
      }
    }

    const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60 * 1000);

    // Vérifier qu'on ne dépasse pas la fin de journée
    if (candidateEnd > this.dayEnd) {
      return null;
    }

    return { start: candidateStart, end: candidateEnd };
  }

  /**
   * Insère un créneau à une heure précise (pour les événements fixes comme les vols)
   * Utilisé pour les contraintes externes (vols, trains, etc.)
   */
  insertFixedItem(params: {
    id: string;
    title: string;
    type: string;
    startTime: Date;
    endTime: Date;
    data?: any;
  }): ScheduleItem | null {
    const { id, title, type, startTime, endTime, data } = params;

    // Vérifier les chevauchements avec les items existants
    for (const existing of this.items) {
      if (this.overlaps(existing.slot, { start: startTime, end: endTime })) {
        console.warn(`[Scheduler] Conflict: "${title}" overlaps with "${existing.title}"`);
        return null;
      }
    }

    const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60);

    const item: ScheduleItem = {
      id,
      title,
      type,
      slot: { start: startTime, end: endTime },
      duration,
      data,
    };

    this.items.push(item);

    // Mettre à jour le curseur si nécessaire
    if (endTime > this.currentTime) {
      this.currentTime = endTime;
    }

    console.log(`[Scheduler] Fixed "${title}" ${formatTime(startTime)}-${formatTime(endTime)}`);

    return item;
  }

  /**
   * Avance le curseur à une heure spécifique (sans ajouter d'item)
   * Utile pour sauter des périodes
   */
  advanceTo(time: Date): void {
    const before = formatTime(this.currentTime);
    if (time > this.currentTime) {
      this.currentTime = new Date(time);
      console.log(`[Scheduler] advanceTo: ${before} -> ${formatTime(this.currentTime)}`);
    } else {
      console.log(`[Scheduler] advanceTo: ${formatTime(time)} <= ${before}, curseur inchange`);
    }
  }

  /**
   * Vérifie si deux créneaux se chevauchent
   */
  private overlaps(a: TimeSlot, b: TimeSlot): boolean {
    return a.start < b.end && b.start < a.end;
  }

  /**
   * Retourne tous les items triés par heure de début
   * AMÉLIORATION: Vérifie et log les conflits restants
   */
  getItems(): ScheduleItem[] {
    const sorted = [...this.items].sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());

    // Vérifier les conflits et les logger
    const validation = this.validate();
    if (!validation.valid) {
      console.error(`[Scheduler] ATTENTION: ${validation.conflicts.length} conflit(s) détecté(s) dans le planning!`);
      for (const conflict of validation.conflicts) {
        console.error(`[Scheduler]   - ${conflict.item1} vs ${conflict.item2}`);
      }
    }

    return sorted;
  }

  /**
   * Valide qu'il n'y a aucun chevauchement
   * NOTE: Accède directement à this.items pour éviter boucle infinie avec getItems()
   */
  validate(): { valid: boolean; conflicts: Array<{ item1: string; item2: string }> } {
    const sorted = [...this.items].sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());
    const conflicts: Array<{ item1: string; item2: string }> = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (this.overlaps(sorted[i].slot, sorted[j].slot)) {
          conflicts.push({
            item1: `${sorted[i].title} (${formatTime(sorted[i].slot.start)}-${formatTime(sorted[i].slot.end)})`,
            item2: `${sorted[j].title} (${formatTime(sorted[j].slot.start)}-${formatTime(sorted[j].slot.end)})`,
          });
        }
      }
    }

    return {
      valid: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * PRIORITÉ des types d'items (plus haut = plus important, ne pas supprimer)
   */
  private getTypePriority(type: string): number {
    const priorities: Record<string, number> = {
      flight: 100,      // Ne jamais supprimer un vol
      transport: 90,    // Ne jamais supprimer un transport
      checkin: 80,      // Check-in aéroport important
      checkout: 80,     // Check-out hôtel important
      parking: 70,      // Parking important
      hotel: 60,        // Check-in hôtel
      restaurant: 20,   // Peut être supprimé si conflit
      activity: 10,     // Peut être supprimé si conflit
    };
    return priorities[type] ?? 0;
  }

  /**
   * Supprime les items en conflit en gardant les plus prioritaires
   * Retourne le nombre d'items supprimés
   */
  removeConflicts(): number {
    let removed = 0;
    let hasConflicts = true;

    // Boucler tant qu'il y a des conflits (car supprimer un item peut résoudre plusieurs conflits)
    while (hasConflicts) {
      hasConflicts = false;
      const sorted = [...this.items].sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());

      for (let i = 0; i < sorted.length - 1; i++) {
        const itemA = sorted[i];
        const itemB = sorted[i + 1];

        if (this.overlaps(itemA.slot, itemB.slot)) {
          // Déterminer lequel supprimer (celui avec la priorité la plus basse)
          const priorityA = this.getTypePriority(itemA.type);
          const priorityB = this.getTypePriority(itemB.type);

          const toRemove = priorityA <= priorityB ? itemA : itemB;
          const toKeep = priorityA <= priorityB ? itemB : itemA;

          console.log(`[Scheduler] CONFLIT: "${itemA.title}" (${formatTime(itemA.slot.start)}-${formatTime(itemA.slot.end)}) vs "${itemB.title}" (${formatTime(itemB.slot.start)}-${formatTime(itemB.slot.end)})`);
          console.log(`[Scheduler] → Suppression de "${toRemove.title}" (priorité ${this.getTypePriority(toRemove.type)}) au profit de "${toKeep.title}" (priorité ${this.getTypePriority(toKeep.type)})`);

          // Supprimer l'item
          const index = this.items.findIndex(item => item.id === toRemove.id);
          if (index !== -1) {
            this.items.splice(index, 1);
            removed++;
            hasConflicts = true; // Re-vérifier après suppression
            break; // Recommencer la boucle
          }
        }
      }
    }

    return removed;
  }

  /**
   * Supprime les items qui commencent AVANT une heure donnée (sauf types protégés)
   * Utilisé pour s'assurer qu'aucune activité n'est planifiée avant l'arrivée
   */
  removeItemsBefore(time: Date, protectedTypes: string[] = ['flight', 'transport', 'checkin', 'parking']): number {
    let removed = 0;
    const toRemove: string[] = [];

    for (const item of this.items) {
      if (item.slot.start < time && !protectedTypes.includes(item.type)) {
        console.log(`[Scheduler] Suppression de "${item.title}" (${formatTime(item.slot.start)}) - commence avant ${formatTime(time)}`);
        toRemove.push(item.id);
      }
    }

    for (const id of toRemove) {
      const index = this.items.findIndex(item => item.id === id);
      if (index !== -1) {
        this.items.splice(index, 1);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Debug: affiche l'emploi du temps
   */
  debug(): void {
    console.log(`\n=== Day Schedule (${this.date.toLocaleDateString('fr-FR')}) ===`);
    console.log(`Available: ${formatTime(this.dayStart)} - ${formatTime(this.dayEnd)}`);
    console.log(`Current cursor: ${formatTime(this.currentTime)}`);
    console.log(`Remaining: ${this.getRemainingMinutes()} min`);
    console.log('Items:');
    for (const item of this.getItems()) {
      const travel = item.travelTimeFromPrevious ? ` (+${item.travelTimeFromPrevious}min trajet)` : '';
      console.log(`  ${formatTime(item.slot.start)}-${formatTime(item.slot.end)} | ${item.type} | ${item.title}${travel}`);
    }
    console.log('');
  }
}

/**
 * Formate une date en HH:MM
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris' // Forcer timezone française pour cohérence
  });
}

/**
 * Parse une heure HH:MM en Date (pour une date donnée)
 */
export function parseTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Crée un créneau à partir d'une date et d'heures HH:MM
 */
export function createTimeSlot(date: Date, startTime: string, endTime: string): TimeSlot {
  return {
    start: parseTime(date, startTime),
    end: parseTime(date, endTime),
  };
}

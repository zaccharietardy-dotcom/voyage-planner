/**
 * Utilitaires de planification horaire (Bug #6)
 *
 * Ce module garantit que les horaires générés sont toujours des heures rondes:
 * - Pas de 19h12 ou 20h42
 * - Uniquement 08:00, 09:00, 10:00, ..., 22:00
 *
 * Utilise les horaires d'ouverture des restaurants pour proposer des créneaux valides.
 */

/**
 * Heures disponibles pour la planification d'activités
 * De 08:00 à 22:00 (heures pleines uniquement)
 */
export const AVAILABLE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/**
 * Préférences d'heures par type de repas
 */
const MEAL_PREFERENCES = {
  breakfast: 8,  // Préférence: 08:00
  lunch: 12,     // Préférence: 12:00
  dinner: 19,    // Préférence: 19:00
} as const;

/**
 * Vérifie si une heure est valide pour la planification (entre 8 et 22)
 */
export function isValidScheduleHour(hour: number): boolean {
  return AVAILABLE_HOURS.includes(hour);
}

/**
 * Arrondit une date à l'heure la plus proche
 *
 * - Si minutes < 30: arrondit vers le bas
 * - Si minutes >= 30: arrondit vers le haut
 *
 * @param date Date à arrondir
 * @returns Nouvelle date avec minutes et secondes à 0
 */
export function roundToNearestHour(date: Date): Date {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();

  rounded.setSeconds(0);
  rounded.setMilliseconds(0);

  // Arrondir à l'heure la plus proche
  if (minutes < 30) {
    rounded.setMinutes(0);
  } else {
    rounded.setMinutes(0);
    rounded.setHours(rounded.getHours() + 1);
  }

  return rounded;
}

/**
 * Arrondit une heure au format "HH:MM" à l'heure la plus proche
 *
 * @param time Heure au format "HH:MM" (ex: "19:12")
 * @returns Heure arrondie au format "HH:00" (ex: "19:00")
 */
export function roundTimeToHour(time: string): string {
  const [hoursStr, minutesStr] = time.split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  if (minutes >= 30) {
    hours += 1;
    // Gérer le cas de minuit
    if (hours >= 24) {
      hours = hours % 24;
    }
  }

  return `${hours.toString().padStart(2, '0')}:00`;
}

/**
 * Parse une heure au format "HH:MM" et retourne les composants
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hoursStr, minutesStr] = timeStr.split(':');
  return {
    hours: parseInt(hoursStr, 10),
    minutes: parseInt(minutesStr || '0', 10),
  };
}

/**
 * Génère les heures disponibles pour un restaurant selon ses horaires
 *
 * @param restaurant Objet avec `opens` et `closes` au format "HH:MM"
 * @returns Liste des heures disponibles (entiers de 8 à 22)
 */
export function generateAvailableHours(restaurant: {
  opens: string;
  closes: string;
}): number[] {
  const openTime = parseTime(restaurant.opens);
  const closeTime = parseTime(restaurant.closes);

  // Convertir en minutes depuis minuit
  const openMinutes = openTime.hours * 60 + openTime.minutes;
  let closeMinutes = closeTime.hours * 60 + closeTime.minutes;

  // Gérer les restaurants qui ferment après minuit
  // Ex: closes: "02:00" devient 26:00 (2h du matin = 26 * 60 minutes)
  if (closeMinutes < openMinutes) {
    closeMinutes += 24 * 60;
  }

  const available: number[] = [];

  for (const hour of AVAILABLE_HOURS) {
    const hourInMinutes = hour * 60;

    // L'heure doit être >= heure d'ouverture ET < heure de fermeture
    // On vérifie que l'heure complète (avec 59 min) tient dans les horaires
    if (hourInMinutes >= openMinutes && hourInMinutes < closeMinutes) {
      available.push(hour);
    }
  }

  return available;
}

/**
 * Sélectionne l'heure de repas optimale selon le type et les horaires du restaurant
 *
 * @param restaurant Objet avec `opens` et `closes`
 * @param mealType Type de repas: 'breakfast' | 'lunch' | 'dinner'
 * @returns Heure sélectionnée (entier de 8 à 22)
 */
export function selectMealTime(
  restaurant: { opens: string; closes: string },
  mealType: 'breakfast' | 'lunch' | 'dinner'
): number {
  const availableHours = generateAvailableHours(restaurant);

  if (availableHours.length === 0) {
    // Fallback: retourner la préférence même si le restaurant n'est pas ouvert
    // (cas exceptionnel qui ne devrait pas arriver)
    return MEAL_PREFERENCES[mealType];
  }

  const preferred = MEAL_PREFERENCES[mealType];

  // Si l'heure préférée est disponible, la prendre
  if (availableHours.includes(preferred)) {
    return preferred;
  }

  // Sinon, trouver l'heure disponible la plus proche de la préférence
  let closest = availableHours[0];
  let minDiff = Math.abs(availableHours[0] - preferred);

  for (const hour of availableHours) {
    const diff = Math.abs(hour - preferred);
    if (diff < minDiff) {
      minDiff = diff;
      closest = hour;
    }
  }

  return closest;
}

/**
 * Formate une heure (entier) au format "HH:00"
 */
export function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
}

/**
 * Crée une date avec une heure spécifique (arrondie)
 *
 * @param dateStr Date au format "YYYY-MM-DD"
 * @param hour Heure (entier)
 * @returns Date avec l'heure spécifiée
 */
export function createDateWithHour(dateStr: string, hour: number): Date {
  const date = new Date(dateStr);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/**
 * Analyseur de schedule — horaires, chevauchements, repas
 */

import { Trip, TripDay, TripItem } from '../../../src/lib/types';

export interface AnalysisIssue {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  dayNumber?: number;
  itemTitle?: string;
  details?: Record<string, unknown>;
}

function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function analyzeSchedule(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const totalDays = trip.days.length;

  for (const day of trip.days) {
    const isFirstDay = day.dayNumber === 1;
    const isLastDay = day.dayNumber === totalDays;
    const items = [...day.items].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    // Jours vides
    if (items.length === 0) {
      issues.push({
        severity: 'critical',
        category: 'schedule',
        message: `Jour ${day.dayNumber}: aucune activité planifiée`,
        dayNumber: day.dayNumber,
      });
      continue;
    }

    // Chevauchements
    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i];
      const next = items[i + 1];
      const currentEnd = parseTime(current.endTime);
      const nextStart = parseTime(next.startTime);

      if (currentEnd > nextStart) {
        issues.push({
          severity: 'critical',
          category: 'schedule',
          message: `Jour ${day.dayNumber}: "${current.title}" (fin ${current.endTime}) chevauche "${next.title}" (début ${next.startTime})`,
          dayNumber: day.dayNumber,
          itemTitle: current.title,
          details: { currentEnd: current.endTime, nextStart: next.startTime, overlapMinutes: currentEnd - nextStart },
        });
      }
    }

    // Activités à des heures impossibles (00:00-06:59)
    const logisticsTypes = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'hotel', 'luggage'];
    for (const item of items) {
      if (logisticsTypes.includes(item.type)) continue;
      const startHour = Math.floor(parseTime(item.startTime) / 60);
      if (startHour >= 0 && startHour < 7) {
        issues.push({
          severity: 'critical',
          category: 'schedule',
          message: `Jour ${day.dayNumber}: "${item.title}" planifié à ${item.startTime} — heure impossible`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
        });
      }
    }

    // Timing des repas
    const meals = items.filter(i => i.type === 'restaurant');
    for (const meal of meals) {
      const startMin = parseTime(meal.startTime);
      const startHour = startMin / 60;
      const title = meal.title.toLowerCase();

      // Détecter le type de repas (petit-déjeuner doit être testé AVANT déjeuner)
      const isBreakfast = title.includes('petit-déjeuner') || title.includes('petit déjeuner')
        || title.includes('breakfast') || title.includes('brunch');

      // Déjeuner trop tôt ou trop tard (exclure petit-déjeuner)
      if (!isBreakfast && (title.includes('déjeuner') || title.includes('lunch') || title.includes('dejeuner'))) {
        if (startHour < 11.5 || startHour > 15) {
          issues.push({
            severity: 'warning',
            category: 'schedule',
            message: `Jour ${day.dayNumber}: déjeuner "${meal.title}" à ${meal.startTime} — créneau inhabituel (attendu 11h30-15h00)`,
            dayNumber: day.dayNumber,
            itemTitle: meal.title,
          });
        }
      }

      // Dîner trop tôt
      if (title.includes('dîner') || title.includes('dinner') || title.includes('diner')) {
        if (startHour < 18) {
          issues.push({
            severity: 'warning',
            category: 'schedule',
            message: `Jour ${day.dayNumber}: dîner "${meal.title}" à ${meal.startTime} — trop tôt (attendu après 18h00)`,
            dayNumber: day.dayNumber,
            itemTitle: meal.title,
          });
        }
      }

      // Petit-déjeuner trop tard
      if (isBreakfast) {
        if (startHour > 11) {
          issues.push({
            severity: 'warning',
            category: 'schedule',
            message: `Jour ${day.dayNumber}: petit-déjeuner "${meal.title}" à ${meal.startTime} — trop tard (attendu avant 11h00)`,
            dayNumber: day.dayNumber,
            itemTitle: meal.title,
          });
        }
      }
    }

    // Vérifier l'ordre des repas dans la journée
    const breakfasts = meals.filter(m => {
      const t = m.title.toLowerCase();
      return t.includes('petit') || t.includes('breakfast') || t.includes('brunch');
    });
    const lunches = meals.filter(m => {
      const t = m.title.toLowerCase();
      return t.includes('déjeuner') || t.includes('lunch') || t.includes('dejeuner');
    });
    const dinners = meals.filter(m => {
      const t = m.title.toLowerCase();
      return t.includes('dîner') || t.includes('dinner') || t.includes('diner');
    });

    if (breakfasts.length > 0 && lunches.length > 0) {
      const bTime = parseTime(breakfasts[0].startTime);
      const lTime = parseTime(lunches[0].startTime);
      if (bTime > lTime) {
        issues.push({
          severity: 'critical',
          category: 'schedule',
          message: `Jour ${day.dayNumber}: petit-déjeuner (${breakfasts[0].startTime}) après le déjeuner (${lunches[0].startTime})`,
          dayNumber: day.dayNumber,
        });
      }
    }

    if (lunches.length > 0 && dinners.length > 0) {
      const lTime = parseTime(lunches[0].startTime);
      const dTime = parseTime(dinners[0].startTime);
      if (lTime > dTime) {
        issues.push({
          severity: 'critical',
          category: 'schedule',
          message: `Jour ${day.dayNumber}: déjeuner (${lunches[0].startTime}) après le dîner (${dinners[0].startTime})`,
          dayNumber: day.dayNumber,
        });
      }
    }

    // Gap trop grand entre activités (>3h sans rien)
    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i];
      const next = items[i + 1];
      const gap = parseTime(next.startTime) - parseTime(current.endTime);
      if (gap > 180) { // 3h
        issues.push({
          severity: 'info',
          category: 'schedule',
          message: `Jour ${day.dayNumber}: ${(gap / 60).toFixed(0)}h de vide entre "${current.title}" (fin ${current.endTime}) et "${next.title}" (début ${next.startTime})`,
          dayNumber: day.dayNumber,
          details: { gapMinutes: gap },
        });
      }
    }
  }

  return issues;
}

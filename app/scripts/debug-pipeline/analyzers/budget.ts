/**
 * Analyseur de budget — coûts, cohérence budgétaire
 */

import { Trip, BUDGET_LABELS } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

export function analyzeBudget(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const prefs = trip.preferences;

  // Vérifier que le costBreakdown existe
  if (!trip.costBreakdown) {
    issues.push({
      severity: 'warning',
      category: 'budget',
      message: 'Pas de costBreakdown dans le trip',
    });
  }

  // Vérifier la cohérence du total
  if (trip.costBreakdown && trip.totalEstimatedCost != null) {
    const sum = Object.values(trip.costBreakdown).reduce((s, v) => s + (v || 0), 0);
    const diff = Math.abs(sum - trip.totalEstimatedCost);
    if (diff > 10) { // Tolérance de 10€
      issues.push({
        severity: 'warning',
        category: 'budget',
        message: `Total estimé (${trip.totalEstimatedCost}€) ≠ somme du breakdown (${Math.round(sum)}€) — écart de ${Math.round(diff)}€`,
        details: { total: trip.totalEstimatedCost, sum: Math.round(sum), breakdown: trip.costBreakdown },
      });
    }
  }

  // Budget vs niveau demandé
  if (trip.totalEstimatedCost != null && prefs.budgetLevel) {
    const budgetInfo = BUDGET_LABELS[prefs.budgetLevel];
    const perPerson = trip.totalEstimatedCost / prefs.groupSize;

    if (perPerson > budgetInfo.max * 1.5) {
      issues.push({
        severity: 'warning',
        category: 'budget',
        message: `Coût par personne (${Math.round(perPerson)}€) largement au-dessus du budget "${prefs.budgetLevel}" (max ${budgetInfo.max}€)`,
        details: { perPerson: Math.round(perPerson), budgetMax: budgetInfo.max },
      });
    }
  }

  // Budget status
  if (trip.budgetStatus) {
    if (trip.budgetStatus.isOverBudget && trip.budgetStatus.difference > 200) {
      issues.push({
        severity: 'warning',
        category: 'budget',
        message: `Dépassement de budget de ${Math.round(trip.budgetStatus.difference)}€ (estimé: ${Math.round(trip.budgetStatus.estimated)}€ vs cible: ${Math.round(trip.budgetStatus.target)}€)`,
        details: trip.budgetStatus,
      });
    }
  }

  // Coûts par item
  for (const day of trip.days) {
    for (const item of day.items) {
      // Activités avec coût suspicieusement élevé
      if (item.type === 'activity' && item.estimatedCost != null && item.estimatedCost > 200) {
        issues.push({
          severity: 'info',
          category: 'budget',
          message: `Jour ${day.dayNumber}: "${item.title}" coûte ${item.estimatedCost}€ — vérifier si réaliste`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
          details: { cost: item.estimatedCost },
        });
      }

      // Restaurants avec coût aberrant
      if (item.type === 'restaurant' && item.estimatedCost != null) {
        if (item.estimatedCost > 150) {
          issues.push({
            severity: 'info',
            category: 'budget',
            message: `Jour ${day.dayNumber}: restaurant "${item.title}" à ${item.estimatedCost}€ — vérifie si c'est par personne ou total groupe`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
          });
        }
        if (item.estimatedCost === 0) {
          issues.push({
            severity: 'warning',
            category: 'budget',
            message: `Jour ${day.dayNumber}: restaurant "${item.title}" a un coût de 0€`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
          });
        }
      }
    }
  }

  // Vérifier qu'il y a un hébergement et son prix
  if (!trip.accommodation) {
    issues.push({
      severity: 'warning',
      category: 'budget',
      message: 'Pas d\'hébergement défini dans le voyage',
    });
  } else if (trip.accommodation.pricePerNight === 0) {
    issues.push({
      severity: 'warning',
      category: 'budget',
      message: `Hébergement "${trip.accommodation.name}" a un prix de 0€/nuit`,
    });
  }

  return issues;
}

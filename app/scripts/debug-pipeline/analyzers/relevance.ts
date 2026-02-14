/**
 * Analyseur de pertinence — adéquation du voyage aux préférences utilisateur
 */

import { Trip, TripPreferences, BUDGET_LABELS } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

export function analyzeRelevance(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const prefs = trip.preferences;

  // ========================
  // Must-see présence
  // ========================
  if (prefs.mustSee && prefs.mustSee.trim().length > 0) {
    const mustSeeItems = prefs.mustSee.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const allTitles = trip.days.flatMap(d =>
      d.items.filter(i => i.type === 'activity').map(i => i.title.toLowerCase())
    );

    let found = 0;
    const missing: string[] = [];

    for (const mustSee of mustSeeItems) {
      const isPresent = allTitles.some(t =>
        t.includes(mustSee) || mustSee.split(' ').every(word => t.includes(word))
      );
      if (isPresent) {
        found++;
      } else {
        missing.push(mustSee);
      }
    }

    if (missing.length > 0) {
      const missingRatio = mustSeeItems.length > 0 ? missing.length / mustSeeItems.length : 1;
      const severity: AnalysisIssue['severity'] =
        trip.preferences.durationDays <= 2 || missingRatio <= 0.5
          ? 'warning'
          : 'critical';
      issues.push({
        severity,
        category: 'relevance',
        message: `Must-see manquants (${found}/${mustSeeItems.length}): ${missing.join(', ')}`,
        details: { found, total: mustSeeItems.length, missing },
      });
    } else if (mustSeeItems.length > 0) {
      issues.push({
        severity: 'info',
        category: 'relevance',
        message: `Tous les must-see présents (${found}/${mustSeeItems.length})`,
      });
    }
  }

  // ========================
  // Activités match
  // ========================
  const requestedActivities = prefs.activities;
  if (requestedActivities.length > 0) {
    const allActivityTitles = trip.days.flatMap(d =>
      d.items.filter(i => i.type === 'activity').map(i => i.title.toLowerCase())
    );

    const activityKeywords: Record<string, string[]> = {
      beach: ['plage', 'beach', 'bord de mer', 'côte', 'baignade', 'surf', 'snorkel'],
      nature: ['randonnée', 'hike', 'parc', 'park', 'jardin', 'garden', 'forêt', 'montagne', 'cascade', 'nature'],
      culture: ['musée', 'museum', 'galerie', 'gallery', 'temple', 'église', 'church', 'palais', 'palace', 'historique', 'monument'],
      gastronomy: ['gastrono', 'food tour', 'cooking', 'dégustation', 'marché', 'market', 'wine'],
      nightlife: ['bar', 'club', 'nightlife', 'soirée', 'nocturne', 'rooftop', 'cocktail', 'jazz'],
      shopping: ['shopping', 'boutique', 'marché', 'market', 'mall', 'outlet', 'souk'],
      adventure: ['aventure', 'adventure', 'rafting', 'escalade', 'climbing', 'kayak', 'quad', 'zipline', 'sport'],
      wellness: ['spa', 'massage', 'hamam', 'thermal', 'yoga', 'bien-être', 'wellness', 'détente'],
    };

    for (const requested of requestedActivities) {
      const keywords = activityKeywords[requested] || [];
      const hasMatch = allActivityTitles.some(title =>
        keywords.some(kw => title.includes(kw))
      );
      if (!hasMatch && allActivityTitles.length > 3) {
        issues.push({
          severity: 'warning',
          category: 'relevance',
          message: `Activité "${requested}" demandée mais aucune activité correspondante trouvée dans l'itinéraire`,
          details: { requestedActivity: requested },
        });
      }
    }
  }

  // ========================
  // Budget match qualitatif
  // ========================
  if (prefs.budgetLevel) {
    const restaurants = trip.days.flatMap(d =>
      d.items.filter(i => i.type === 'restaurant' && i.estimatedCost != null)
    );

    if (restaurants.length > 0) {
      const avgRestaurantCost = restaurants.reduce((s, r) => s + (r.estimatedCost || 0), 0) / restaurants.length;

      if (prefs.budgetLevel === 'luxury' && avgRestaurantCost < 20) {
        issues.push({
          severity: 'warning',
          category: 'relevance',
          message: `Budget "luxury" mais restaurants en moyenne à ${Math.round(avgRestaurantCost)}€ — trop économique`,
          details: { avgCost: Math.round(avgRestaurantCost), budget: 'luxury' },
        });
      }

      if (prefs.budgetLevel === 'economic' && avgRestaurantCost > 50) {
        issues.push({
          severity: 'warning',
          category: 'relevance',
          message: `Budget "economic" mais restaurants en moyenne à ${Math.round(avgRestaurantCost)}€ — trop cher`,
          details: { avgCost: Math.round(avgRestaurantCost), budget: 'economic' },
        });
      }
    }

    // Hébergement vs budget
    if (trip.accommodation) {
      const ppn = trip.accommodation.pricePerNight;
      if (prefs.budgetLevel === 'luxury' && ppn < 80) {
        issues.push({
          severity: 'warning',
          category: 'relevance',
          message: `Budget "luxury" mais hébergement à ${ppn}€/nuit — trop économique`,
        });
      }
      if (prefs.budgetLevel === 'economic' && ppn > 150) {
        issues.push({
          severity: 'warning',
          category: 'relevance',
          message: `Budget "economic" mais hébergement à ${ppn}€/nuit — trop cher`,
        });
      }
    }
  }

  // ========================
  // Group type match
  // ========================
  if (prefs.groupType === 'family_with_kids') {
    const allTitles = trip.days.flatMap(d => d.items.map(i => i.title.toLowerCase()));
    const adultOnly = allTitles.filter(t =>
      t.includes('bar') || t.includes('club') || t.includes('nightclub') ||
      t.includes('cocktail') || t.includes('pub crawl') || t.includes('wine tasting')
    );
    if (adultOnly.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'relevance',
        message: `Voyage family_with_kids mais ${adultOnly.length} activités adultes: ${adultOnly.slice(0, 3).join(', ')}`,
        details: { adultActivities: adultOnly },
      });
    }
  }

  // ========================
  // Transport cohérence
  // ========================
  if (prefs.transport === 'train') {
    const hasFlights = trip.days.some(d => d.items.some(i => i.type === 'flight'));
    if (hasFlights) {
      issues.push({
        severity: 'warning',
        category: 'relevance',
        message: `Transport "train" demandé mais l'itinéraire contient des vols`,
      });
    }
  }

  if (prefs.transport === 'car') {
    const hasFlights = trip.days.some(d => d.items.some(i => i.type === 'flight'));
    if (hasFlights) {
      issues.push({
        severity: 'info',
        category: 'relevance',
        message: `Transport "car" demandé mais l'itinéraire contient des vols`,
      });
    }
  }

  return issues;
}

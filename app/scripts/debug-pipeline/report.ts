/**
 * Formatage du rapport d'analyse — JSON + texte lisible
 */

import { AnalysisIssue } from './analyzers/schedule';
import { Trip } from '../../src/lib/types';

export interface AnalysisReport {
  tripId: string;
  scenarioId: string;
  generatedAt: string;
  destination: string;
  summary: {
    totalIssues: number;
    critical: number;
    warning: number;
    info: number;
    score: number; // 0-100
  };
  sections: {
    schedule: AnalysisIssue[];
    geography: AnalysisIssue[];
    budget: AnalysisIssue[];
    links: AnalysisIssue[];
    dataQuality: AnalysisIssue[];
    rhythm: AnalysisIssue[];
    relevance: AnalysisIssue[];
    realism: AnalysisIssue[];
  };
  stats: {
    totalDays: number;
    totalItems: number;
    activitiesCount: number;
    restaurantsCount: number;
    avgItemsPerDay: number;
    totalEstimatedCost: number | null;
    hasAccommodation: boolean;
    hasOutboundFlight: boolean;
    hasReturnFlight: boolean;
    hasCarbonFootprint: boolean;
  };
}

function calculateScore(sections: AnalysisReport['sections']): number {
  const allIssues = Object.values(sections).flat();
  let score = 100;

  for (const issue of allIssues) {
    if (issue.severity === 'critical') score -= 8;
    else if (issue.severity === 'warning') score -= 3;
    else if (issue.severity === 'info') score -= 0.5;
  }

  return Math.max(0, Math.round(score));
}

export function buildReport(
  trip: Trip,
  scenarioId: string,
  sections: AnalysisReport['sections']
): AnalysisReport {
  const allIssues = Object.values(sections).flat();

  let totalItems = 0;
  let activitiesCount = 0;
  let restaurantsCount = 0;

  for (const day of trip.days) {
    totalItems += day.items.length;
    activitiesCount += day.items.filter(i => i.type === 'activity').length;
    restaurantsCount += day.items.filter(i => i.type === 'restaurant').length;
  }

  return {
    tripId: trip.id,
    scenarioId,
    generatedAt: new Date().toISOString(),
    destination: trip.preferences.destination,
    summary: {
      totalIssues: allIssues.length,
      critical: allIssues.filter(i => i.severity === 'critical').length,
      warning: allIssues.filter(i => i.severity === 'warning').length,
      info: allIssues.filter(i => i.severity === 'info').length,
      score: calculateScore(sections),
    },
    sections,
    stats: {
      totalDays: trip.days.length,
      totalItems,
      activitiesCount,
      restaurantsCount,
      avgItemsPerDay: totalItems / Math.max(1, trip.days.length),
      totalEstimatedCost: trip.totalEstimatedCost ?? null,
      hasAccommodation: !!trip.accommodation,
      hasOutboundFlight: !!trip.outboundFlight,
      hasReturnFlight: !!trip.returnFlight,
      hasCarbonFootprint: !!trip.carbonFootprint,
    },
  };
}

export function formatReportText(report: AnalysisReport): string {
  const lines: string[] = [];

  lines.push('='.repeat(70));
  lines.push(`RAPPORT D'ANALYSE — ${report.destination}`);
  lines.push(`Scénario: ${report.scenarioId} | ${report.generatedAt}`);
  lines.push('='.repeat(70));
  lines.push('');

  // Score
  const scoreEmoji = report.summary.score >= 80 ? '🟢' :
                     report.summary.score >= 50 ? '🟡' : '🔴';
  lines.push(`${scoreEmoji} SCORE: ${report.summary.score}/100`);
  lines.push(`   ${report.summary.critical} critique(s) | ${report.summary.warning} warning(s) | ${report.summary.info} info(s)`);
  lines.push('');

  // Stats
  lines.push('📊 STATISTIQUES');
  lines.push(`   ${report.stats.totalDays} jours, ${report.stats.totalItems} items (${report.stats.activitiesCount} activités, ${report.stats.restaurantsCount} restaurants)`);
  lines.push(`   Moy. ${report.stats.avgItemsPerDay.toFixed(1)} items/jour`);
  lines.push(`   Coût: ${report.stats.totalEstimatedCost != null ? report.stats.totalEstimatedCost + '€' : 'non calculé'}`);
  lines.push(`   Hébergement: ${report.stats.hasAccommodation ? '✅' : '❌'} | Vol aller: ${report.stats.hasOutboundFlight ? '✅' : '—'} | Vol retour: ${report.stats.hasReturnFlight ? '✅' : '—'} | Carbone: ${report.stats.hasCarbonFootprint ? '✅' : '❌'}`);
  lines.push('');

  // Sections
  const sectionNames: [keyof AnalysisReport['sections'], string][] = [
    ['schedule', '⏰ HORAIRES & PLANNING'],
    ['geography', '🗺️  GÉOGRAPHIE'],
    ['budget', '💰 BUDGET'],
    ['links', '🔗 LIENS'],
    ['dataQuality', '📋 QUALITÉ DES DONNÉES'],
    ['rhythm', '🎵 RYTHME & ÉQUILIBRE'],
    ['relevance', '🎯 PERTINENCE vs PRÉFÉRENCES'],
    ['realism', '🏃 RÉALISME'],
  ];

  for (const [key, title] of sectionNames) {
    const sectionIssues = report.sections[key];
    if (sectionIssues.length === 0) {
      lines.push(`${title}: ✅ aucun problème`);
      continue;
    }

    const criticals = sectionIssues.filter(i => i.severity === 'critical');
    const warnings = sectionIssues.filter(i => i.severity === 'warning');
    const infos = sectionIssues.filter(i => i.severity === 'info');

    lines.push(`${title} (${sectionIssues.length} problèmes)`);

    for (const issue of criticals) {
      lines.push(`   🔴 ${issue.message}`);
    }
    for (const issue of warnings) {
      lines.push(`   🟡 ${issue.message}`);
    }
    for (const issue of infos) {
      lines.push(`   ℹ️  ${issue.message}`);
    }
    lines.push('');
  }

  lines.push('='.repeat(70));

  return lines.join('\n');
}

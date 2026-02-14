/**
 * Formatage du rapport d'analyse — JSON + texte lisible
 */

import { AnalysisIssue } from './analyzers/schedule';
import { Trip } from '../../src/lib/types';

export const SECTION_KEYS = [
  'schedule',
  'geography',
  'budget',
  'links',
  'dataQuality',
  'rhythm',
  'relevance',
  'realism',
] as const;

export type SectionKey = typeof SECTION_KEYS[number];

export interface SectionScore {
  score: number; // 0-100
  critical: number;
  warning: number;
  info: number;
  totalIssues: number;
  weightedPenalty: number;
}

export interface TopRegression {
  key: string;
  code?: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  component?: string;
  count: number;
  impactScore: number;
  avgFrequencyWeight: number;
  autofixCandidate: boolean;
  sampleMessages: string[];
}

type AnalysisSections = Record<SectionKey, AnalysisIssue[]>;

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
    weightedScore: number; // 0-100
  };
  sectionScores: Record<SectionKey, SectionScore>;
  topRegressions: TopRegression[];
  sections: AnalysisSections;
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

const SECTION_WEIGHTS: Record<SectionKey, number> = {
  schedule: 1.1,
  geography: 1.35,
  budget: 0.9,
  links: 1.25,
  dataQuality: 1.35,
  rhythm: 1,
  relevance: 1,
  realism: 1.05,
};

const SEVERITY_BASE_PENALTY: Record<AnalysisIssue['severity'], number> = {
  critical: 10,
  warning: 3.5,
  info: 0.7,
};

const SEVERITY_IMPACT: Record<AnalysisIssue['severity'], number> = {
  critical: 10,
  warning: 4,
  info: 1,
};

function issuePenalty(issue: AnalysisIssue): number {
  const base = SEVERITY_BASE_PENALTY[issue.severity] ?? 1;
  const weight = issue.frequencyWeight ?? 1;
  return base * Math.max(0.1, weight);
}

function calculateSectionScore(issues: AnalysisIssue[]): SectionScore {
  let critical = 0;
  let warning = 0;
  let info = 0;
  let penalty = 0;

  for (const issue of issues) {
    if (issue.severity === 'critical') critical += 1;
    else if (issue.severity === 'warning') warning += 1;
    else info += 1;

    penalty += issuePenalty(issue);
  }

  return {
    score: Math.max(0, Math.round(100 - penalty)),
    critical,
    warning,
    info,
    totalIssues: issues.length,
    weightedPenalty: Number(penalty.toFixed(2)),
  };
}

function calculateWeightedScore(sectionScores: Record<SectionKey, SectionScore>): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const key of SECTION_KEYS) {
    const sectionWeight = SECTION_WEIGHTS[key] ?? 1;
    weightedSum += sectionScores[key].score * sectionWeight;
    totalWeight += sectionWeight;
  }

  if (totalWeight <= 0) return 0;
  return Math.max(0, Math.round(weightedSum / totalWeight));
}

function buildTopRegressions(sections: AnalysisSections): TopRegression[] {
  type Agg = {
    key: string;
    code?: string;
    category: string;
    severity: AnalysisIssue['severity'];
    component?: string;
    count: number;
    weightedImpact: number;
    sumFrequencyWeight: number;
    autofixCandidate: boolean;
    sampleMessages: string[];
  };

  const severityRank: Record<AnalysisIssue['severity'], number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };

  const groups = new Map<string, Agg>();
  const allIssues = Object.values(sections).flat();

  for (const issue of allIssues) {
    const key = issue.code || `${issue.category}:${issue.message.slice(0, 70)}`;
    const existing = groups.get(key);
    const currentWeight = issue.frequencyWeight ?? 1;
    const currentImpact = (SEVERITY_IMPACT[issue.severity] ?? 1) * currentWeight;

    if (!existing) {
      groups.set(key, {
        key,
        code: issue.code,
        category: issue.category,
        severity: issue.severity,
        component: issue.component,
        count: 1,
        weightedImpact: currentImpact,
        sumFrequencyWeight: currentWeight,
        autofixCandidate: !!issue.autofixCandidate,
        sampleMessages: [issue.message],
      });
      continue;
    }

    existing.count += 1;
    existing.weightedImpact += currentImpact;
    existing.sumFrequencyWeight += currentWeight;
    existing.autofixCandidate = existing.autofixCandidate || !!issue.autofixCandidate;
    if (!existing.component && issue.component) existing.component = issue.component;
    if (severityRank[issue.severity] > severityRank[existing.severity]) existing.severity = issue.severity;
    if (!existing.sampleMessages.includes(issue.message) && existing.sampleMessages.length < 3) {
      existing.sampleMessages.push(issue.message);
    }
  }

  return [...groups.values()]
    .map((agg) => ({
      key: agg.key,
      code: agg.code,
      category: agg.category,
      severity: agg.severity,
      component: agg.component,
      count: agg.count,
      impactScore: Number(agg.weightedImpact.toFixed(2)),
      avgFrequencyWeight: Number((agg.sumFrequencyWeight / Math.max(1, agg.count)).toFixed(2)),
      autofixCandidate: agg.autofixCandidate,
      sampleMessages: agg.sampleMessages,
    }))
    .sort((a, b) => {
      if (b.impactScore !== a.impactScore) return b.impactScore - a.impactScore;
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    })
    .slice(0, 12);
}

export function buildReport(
  trip: Trip,
  scenarioId: string,
  sections: AnalysisSections
): AnalysisReport {
  const allIssues = Object.values(sections).flat();

  let totalItems = 0;
  let activitiesCount = 0;
  let restaurantsCount = 0;

  for (const day of trip.days) {
    totalItems += day.items.length;
    activitiesCount += day.items.filter((i) => i.type === 'activity').length;
    restaurantsCount += day.items.filter((i) => i.type === 'restaurant').length;
  }

  const sectionScores = SECTION_KEYS.reduce((acc, key) => {
    acc[key] = calculateSectionScore(sections[key]);
    return acc;
  }, {} as Record<SectionKey, SectionScore>);

  const weightedScore = calculateWeightedScore(sectionScores);

  return {
    tripId: trip.id,
    scenarioId,
    generatedAt: new Date().toISOString(),
    destination: trip.preferences.destination,
    summary: {
      totalIssues: allIssues.length,
      critical: allIssues.filter((i) => i.severity === 'critical').length,
      warning: allIssues.filter((i) => i.severity === 'warning').length,
      info: allIssues.filter((i) => i.severity === 'info').length,
      score: weightedScore,
      weightedScore,
    },
    sectionScores,
    topRegressions: buildTopRegressions(sections),
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

  const scoreEmoji = report.summary.score >= 85
    ? '🟢'
    : report.summary.score >= 65
      ? '🟡'
      : '🔴';
  lines.push(`${scoreEmoji} SCORE: ${report.summary.score}/100`);
  lines.push(`   ${report.summary.critical} critique(s) | ${report.summary.warning} warning(s) | ${report.summary.info} info(s)`);
  lines.push('');

  lines.push('📊 STATISTIQUES');
  lines.push(`   ${report.stats.totalDays} jours, ${report.stats.totalItems} items (${report.stats.activitiesCount} activités, ${report.stats.restaurantsCount} restaurants)`);
  lines.push(`   Moy. ${report.stats.avgItemsPerDay.toFixed(1)} items/jour`);
  lines.push(`   Coût: ${report.stats.totalEstimatedCost != null ? report.stats.totalEstimatedCost + '€' : 'non calculé'}`);
  lines.push(`   Hébergement: ${report.stats.hasAccommodation ? '✅' : '❌'} | Vol aller: ${report.stats.hasOutboundFlight ? '✅' : '—'} | Vol retour: ${report.stats.hasReturnFlight ? '✅' : '—'} | Carbone: ${report.stats.hasCarbonFootprint ? '✅' : '❌'}`);
  lines.push('');

  lines.push('🎛️ SCORES PAR SECTION');
  const sectionNames: Record<SectionKey, string> = {
    schedule: 'Horaires & planning',
    geography: 'Géographie',
    budget: 'Budget',
    links: 'Liens',
    dataQuality: 'Qualité des données',
    rhythm: 'Rythme',
    relevance: 'Pertinence',
    realism: 'Réalisme',
  };
  for (const key of SECTION_KEYS) {
    const s = report.sectionScores[key];
    lines.push(`   - ${sectionNames[key]}: ${s.score}/100 (${s.critical}C ${s.warning}W ${s.info}I)`);
  }
  lines.push('');

  if (report.topRegressions.length > 0) {
    lines.push('🔥 TOP RÉGRESSIONS');
    for (const item of report.topRegressions.slice(0, 6)) {
      const code = item.code || item.key;
      const comp = item.component ? ` | ${item.component}` : '';
      lines.push(`   - [${item.severity.toUpperCase()}] ${code} x${item.count}${comp}`);
    }
    lines.push('');
  }

  const sectionTitles: Record<SectionKey, string> = {
    schedule: '⏰ HORAIRES & PLANNING',
    geography: '🗺️  GÉOGRAPHIE',
    budget: '💰 BUDGET',
    links: '🔗 LIENS',
    dataQuality: '📋 QUALITÉ DES DONNÉES',
    rhythm: '🎵 RYTHME & ÉQUILIBRE',
    relevance: '🎯 PERTINENCE vs PRÉFÉRENCES',
    realism: '🏃 RÉALISME',
  };

  for (const key of SECTION_KEYS) {
    const sectionIssues = report.sections[key];
    if (sectionIssues.length === 0) {
      lines.push(`${sectionTitles[key]}: ✅ aucun problème`);
      continue;
    }

    const criticals = sectionIssues.filter((i) => i.severity === 'critical');
    const warnings = sectionIssues.filter((i) => i.severity === 'warning');
    const infos = sectionIssues.filter((i) => i.severity === 'info');

    lines.push(`${sectionTitles[key]} (${sectionIssues.length} problèmes)`);
    for (const issue of criticals) lines.push(`   🔴 ${issue.message}`);
    for (const issue of warnings) lines.push(`   🟡 ${issue.message}`);
    for (const issue of infos) lines.push(`   ℹ️  ${issue.message}`);
    lines.push('');
  }

  lines.push('='.repeat(70));

  return lines.join('\n');
}

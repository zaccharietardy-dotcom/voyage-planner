#!/usr/bin/env npx tsx
/**
 * Orchestrateur campagne debug pipeline
 *
 * Usage:
 *   npx tsx scripts/debug-pipeline/run-campaign.ts --campaign-id feb14-baseline
 *   npx tsx scripts/debug-pipeline/run-campaign.ts --total 30 --random-count 18 --seed 4242
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BudgetLevel, GroupType, TransportType, TripPreferences } from '../../src/lib/types';
import { analyzeFromFile } from './analyze-trip';
import {
  assertRequiredEnv,
  completeRandomPreferences,
  generateTripRun,
  getEnvHealth,
  saveResult,
  type GenerationResult,
} from './generate-trip';
import { SECTION_KEYS, type AnalysisReport, type SectionKey } from './report';
import { SCENARIOS, getAllScenarioIds } from './scenarios';
import type { AnalysisIssue } from './analyzers/schedule';

type RunKind = 'scenario' | 'random';

interface CampaignOptions {
  campaignId: string;
  total: number;
  randomCount: number;
  seed: number;
  outDir: string;
  analyze: boolean;
  failFast: boolean;
}

interface CampaignRun {
  runId: string;
  runKind: RunKind;
  scenarioId: string;
  filepath: string;
  reportPath?: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  score?: number;
  critical?: number;
  warning?: number;
  info?: number;
}

interface RandomRunSpec {
  key: string;
  overrides: Partial<TripPreferences>;
  forceMultiCity?: boolean;
}

interface AggregatedIssue {
  key: string;
  code: string;
  severity: AnalysisIssue['severity'];
  component: string;
  count: number;
  affectedRuns: number;
  sampleRunIds: string[];
  sampleMessages: string[];
  autofixCandidate: boolean;
}

interface CampaignSummary {
  campaignMeta: {
    campaignId: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    seed: number;
    totalRequested: number;
    randomCountRequested: number;
    scenarioCountRequested: number;
    analyze: boolean;
    failFast: boolean;
    outDir: string;
  };
  runStats: {
    total: number;
    success: number;
    failed: number;
    scenarioRuns: number;
    randomRuns: number;
    analyzedRuns: number;
    successRate: number;
  };
  scoreStats: {
    average: number;
    min: number;
    max: number;
    p50: number;
    p90: number;
    sectionAverages: Record<SectionKey, number>;
  };
  issuesByCode: AggregatedIssue[];
  issuesByComponent: Array<{
    component: string;
    total: number;
    critical: number;
    warning: number;
    info: number;
  }>;
  topRegressions: AggregatedIssue[];
  stratification: {
    groupTypes: Record<GroupType, number>;
    budgetLevels: Record<BudgetLevel, number>;
    transports: Record<TransportType, number>;
    multiCityRuns: number;
  };
  exitCriteria: {
    successRate: { value: number; target: number; pass: boolean };
    noApiKeyLeaks: { count: number; pass: boolean };
    noHotelBoundaryIncoherent: { count: number; pass: boolean };
    urbanLegPolicy: { count: number; pass: boolean };
    averageScore: { value: number; target: number; pass: boolean };
    noCriticalRemaining: { count: number; pass: boolean };
    overallPass: boolean;
  };
  runs: CampaignRun[];
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], randomFn: () => number): T {
  return arr[Math.floor(randomFn() * arr.length)];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function sanitize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
}

function parseIntArg(args: string[], name: string, fallback: number): number {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const raw = args[idx + 1];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStringArg(args: string[], name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

function buildCampaignOptions(): CampaignOptions {
  const args = process.argv.slice(2);
  const nowIso = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultCampaignId = `campaign-${nowIso.slice(0, 19)}`;

  const campaignId = sanitize(parseStringArg(args, '--campaign-id', defaultCampaignId));
  const total = Math.max(1, parseIntArg(args, '--total', 30));
  const randomCount = Math.max(0, parseIntArg(args, '--random-count', 18));
  const seed = parseIntArg(args, '--seed', 424242);
  const analyze = args.includes('--no-analyze') ? false : true;
  const failFast = args.includes('--fail-fast');

  const defaultOutDir = path.join(__dirname, 'results', campaignId);
  const outDirArg = parseStringArg(args, '--out-dir', defaultOutDir);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(process.cwd(), outDirArg);

  return {
    campaignId,
    total,
    randomCount,
    seed,
    outDir,
    analyze,
    failFast,
  };
}

function generateFallbackCityPlan(durationDays: number, randomFn: () => number): NonNullable<TripPreferences['cityPlan']> {
  const templates = [
    ['Rome', 'Florence', 'Venise'],
    ['Barcelone', 'Valence', 'Madrid'],
    ['Lisbonne', 'Porto', 'Coimbra'],
    ['Tokyo', 'Kyoto', 'Osaka'],
    ['Berlin', 'Prague', 'Vienne'],
    ['Amsterdam', 'Bruxelles', 'Lille'],
  ];

  const template = pick(templates, randomFn);
  const cityCount = durationDays >= 7 ? 3 : 2;
  const cities = template.slice(0, cityCount);

  const days = Array.from({ length: cityCount }, () => 1);
  let remaining = Math.max(0, durationDays - cityCount);
  while (remaining > 0) {
    const idx = Math.floor(randomFn() * cityCount);
    days[idx] += 1;
    remaining -= 1;
  }

  return cities.map((city, idx) => ({ city, days: days[idx] }));
}

function ensureMultiCity(pref: TripPreferences, randomFn: () => number): TripPreferences {
  const cloned: TripPreferences = { ...pref };
  cloned.tripMode = 'precise';
  cloned.cityPlan = generateFallbackCityPlan(cloned.durationDays, randomFn);
  cloned.destination = cloned.cityPlan[0].city;
  return cloned;
}

function buildRandomRunSpecs(randomCount: number): RandomRunSpec[] {
  const groupSpecs: RandomRunSpec[] = (['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'] as GroupType[]).map((groupType) => ({
    key: `group-${groupType}`,
    overrides: { groupType },
  }));

  const budgetSpecs: RandomRunSpec[] = (['economic', 'moderate', 'comfort', 'luxury'] as BudgetLevel[]).map((budgetLevel) => ({
    key: `budget-${budgetLevel}`,
    overrides: { budgetLevel },
  }));

  const transportSpecs: RandomRunSpec[] = (['train', 'plane', 'car'] as TransportType[]).map((transport) => ({
    key: `transport-${transport}`,
    overrides: {
      transport,
      carRental: transport === 'car',
    },
  }));

  const multiCitySpec: RandomRunSpec = {
    key: 'multi-city',
    overrides: {},
    forceMultiCity: true,
  };

  const forced = [...groupSpecs, ...budgetSpecs, ...transportSpecs, multiCitySpec];
  if (randomCount <= forced.length) return forced.slice(0, randomCount);

  const generic: RandomRunSpec[] = [];
  for (let i = forced.length; i < randomCount; i += 1) {
    generic.push({ key: `random-${i + 1}`, overrides: {} });
  }

  return [...forced, ...generic];
}

function applyPreferenceOverrides(
  base: TripPreferences,
  overrides: Partial<TripPreferences>,
  randomFn: () => number,
  forceMultiCity: boolean
): TripPreferences {
  const merged: TripPreferences = {
    ...base,
    ...overrides,
  };

  if (merged.transport === 'car') {
    merged.carRental = true;
  }

  if (forceMultiCity) {
    return ensureMultiCity(merged, randomFn);
  }

  return merged;
}

function sortIssuesBySeverityAndFrequency(issues: AggregatedIssue[]): AggregatedIssue[] {
  const rank: Record<AnalysisIssue['severity'], number> = { critical: 3, warning: 2, info: 1 };
  return [...issues].sort((a, b) => {
    if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity];
    if (b.count !== a.count) return b.count - a.count;
    return a.component.localeCompare(b.component);
  });
}

function aggregateIssues(reportsByRun: Array<{ runId: string; report: AnalysisReport }>): {
  issuesByCode: AggregatedIssue[];
  issuesByComponent: CampaignSummary['issuesByComponent'];
} {
  type InternalAgg = {
    key: string;
    code: string;
    severity: AnalysisIssue['severity'];
    component: string;
    count: number;
    runIds: Set<string>;
    messages: Set<string>;
    autofixCandidate: boolean;
  };

  const severityRank: Record<AnalysisIssue['severity'], number> = { critical: 3, warning: 2, info: 1 };
  const byCode = new Map<string, InternalAgg>();
  const byComponent = new Map<string, { component: string; total: number; critical: number; warning: number; info: number }>();

  for (const { runId, report } of reportsByRun) {
    for (const section of SECTION_KEYS) {
      for (const issue of report.sections[section]) {
        const issueKey = issue.code || `${issue.category}:${issue.message.slice(0, 70)}`;
        const code = issue.code || issueKey;
        const component = issue.component || 'unknown';
        const current = byCode.get(issueKey);

        if (!current) {
          byCode.set(issueKey, {
            key: issueKey,
            code,
            severity: issue.severity,
            component,
            count: 1,
            runIds: new Set([runId]),
            messages: new Set([issue.message]),
            autofixCandidate: !!issue.autofixCandidate,
          });
        } else {
          current.count += 1;
          current.runIds.add(runId);
          if (current.messages.size < 4) current.messages.add(issue.message);
          if (!current.component || current.component === 'unknown') current.component = component;
          if (severityRank[issue.severity] > severityRank[current.severity]) current.severity = issue.severity;
          current.autofixCandidate = current.autofixCandidate || !!issue.autofixCandidate;
        }

        const compAgg = byComponent.get(component) || {
          component,
          total: 0,
          critical: 0,
          warning: 0,
          info: 0,
        };
        compAgg.total += 1;
        if (issue.severity === 'critical') compAgg.critical += 1;
        else if (issue.severity === 'warning') compAgg.warning += 1;
        else compAgg.info += 1;
        byComponent.set(component, compAgg);
      }
    }
  }

  const issuesByCode: AggregatedIssue[] = [...byCode.values()].map((entry) => ({
    key: entry.key,
    code: entry.code,
    severity: entry.severity,
    component: entry.component,
    count: entry.count,
    affectedRuns: entry.runIds.size,
    sampleRunIds: [...entry.runIds].slice(0, 6),
    sampleMessages: [...entry.messages].slice(0, 3),
    autofixCandidate: entry.autofixCandidate,
  }));

  const issuesByComponent = [...byComponent.values()].sort((a, b) => b.total - a.total);
  return {
    issuesByCode: sortIssuesBySeverityAndFrequency(issuesByCode),
    issuesByComponent,
  };
}

function buildSummaryMarkdown(summary: CampaignSummary): string {
  const lines: string[] = [];
  lines.push(`# Campaign Summary — ${summary.campaignMeta.campaignId}`);
  lines.push('');
  lines.push(`- Started: ${summary.campaignMeta.startedAt}`);
  lines.push(`- Finished: ${summary.campaignMeta.finishedAt}`);
  lines.push(`- Duration: ${(summary.campaignMeta.durationMs / 1000).toFixed(1)}s`);
  lines.push(`- Seed: ${summary.campaignMeta.seed}`);
  lines.push(`- Runs: ${summary.runStats.total} (${summary.runStats.success} success / ${summary.runStats.failed} failed)`);
  lines.push('');

  lines.push('## Acceptance Criteria');
  lines.push(`- Success rate >= 90%: ${summary.exitCriteria.successRate.pass ? 'PASS' : 'FAIL'} (${(summary.exitCriteria.successRate.value * 100).toFixed(1)}%)`);
  lines.push(`- No API key leak: ${summary.exitCriteria.noApiKeyLeaks.pass ? 'PASS' : 'FAIL'} (${summary.exitCriteria.noApiKeyLeaks.count})`);
  lines.push(`- No hotel boundary incoherent: ${summary.exitCriteria.noHotelBoundaryIncoherent.pass ? 'PASS' : 'FAIL'} (${summary.exitCriteria.noHotelBoundaryIncoherent.count})`);
  lines.push(`- Urban leg policy clean: ${summary.exitCriteria.urbanLegPolicy.pass ? 'PASS' : 'FAIL'} (${summary.exitCriteria.urbanLegPolicy.count})`);
  lines.push(`- Average score >= 85: ${summary.exitCriteria.averageScore.pass ? 'PASS' : 'FAIL'} (${summary.exitCriteria.averageScore.value.toFixed(1)})`);
  lines.push(`- No critical remaining: ${summary.exitCriteria.noCriticalRemaining.pass ? 'PASS' : 'FAIL'} (${summary.exitCriteria.noCriticalRemaining.count})`);
  lines.push(`- Overall: ${summary.exitCriteria.overallPass ? 'PASS' : 'FAIL'}`);
  lines.push('');

  lines.push('## Score Stats');
  lines.push(`- Average: ${summary.scoreStats.average.toFixed(1)}`);
  lines.push(`- Min/Max: ${summary.scoreStats.min.toFixed(1)} / ${summary.scoreStats.max.toFixed(1)}`);
  lines.push(`- P50/P90: ${summary.scoreStats.p50.toFixed(1)} / ${summary.scoreStats.p90.toFixed(1)}`);
  lines.push('');
  lines.push('| Section | Avg Score |');
  lines.push('|---|---:|');
  for (const key of SECTION_KEYS) {
    lines.push(`| ${key} | ${summary.scoreStats.sectionAverages[key].toFixed(1)} |`);
  }
  lines.push('');

  lines.push('## Top Regressions');
  lines.push('| Severity | Code | Count | Component | Affected Runs |');
  lines.push('|---|---|---:|---|---:|');
  for (const item of summary.topRegressions.slice(0, 20)) {
    lines.push(`| ${item.severity} | ${item.code} | ${item.count} | ${item.component} | ${item.affectedRuns} |`);
  }
  lines.push('');

  lines.push('## Stratification');
  lines.push(`- groupType: ${JSON.stringify(summary.stratification.groupTypes)}`);
  lines.push(`- budgetLevel: ${JSON.stringify(summary.stratification.budgetLevels)}`);
  lines.push(`- transport: ${JSON.stringify(summary.stratification.transports)}`);
  lines.push(`- multiCityRuns: ${summary.stratification.multiCityRuns}`);
  lines.push('');

  lines.push('## Failed Runs');
  const failed = summary.runs.filter((r) => !r.success);
  if (failed.length === 0) {
    lines.push('- none');
  } else {
    for (const run of failed) {
      lines.push(`- ${run.runId}: ${run.errorMessage || 'unknown error'}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function toFixed2(value: number): number {
  return Number(value.toFixed(2));
}

async function main(): Promise<void> {
  const options = buildCampaignOptions();
  const scenarioIds = getAllScenarioIds();
  const scenarioCount = Math.min(scenarioIds.length, options.total);
  const randomCount = Math.max(0, Math.min(options.randomCount, options.total - scenarioCount));
  const randomFn = createSeededRandom(options.seed);

  try {
    assertRequiredEnv(['ANTHROPIC_API_KEY']);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  console.log('🔑 ENV check:', getEnvHealth());
  console.log(`📁 Output: ${options.outDir}`);
  console.log(`🧪 Campaign: ${options.campaignId} | total=${options.total} | scenarios=${scenarioCount} | random=${randomCount} | seed=${options.seed}`);

  const startedAt = new Date().toISOString();
  const runs: CampaignRun[] = [];
  const reportsByRun: Array<{ runId: string; report: AnalysisReport }> = [];

  // Run predefined scenarios
  for (let i = 0; i < scenarioCount; i += 1) {
    const scenarioId = scenarioIds[i];
    const scenario = SCENARIOS[scenarioId];
    const runId = `S${String(i + 1).padStart(2, '0')}-${sanitize(scenarioId)}`;
    const started = new Date().toISOString();
    console.log(`\n▶️  [${runId}] Scenario ${scenarioId}`);

    const result = await generateTripRun(scenarioId, scenario.preferences);
    const decorated: GenerationResult = {
      ...result,
      _campaign: {
        campaignId: options.campaignId,
        runId,
        runKind: 'scenario',
        seed: options.seed,
        startedAt: started,
        durationMs: result.durationMs,
      },
    };

    const filepath = saveResult(decorated, { outDir: options.outDir, filename: `${runId}.json` });
    const run: CampaignRun = {
      runId,
      runKind: 'scenario',
      scenarioId,
      filepath,
      startedAt: started,
      durationMs: result.durationMs,
      success: result.success,
      errorMessage: result.errorMessage,
    };

    if (options.analyze && result.success) {
      const reportPath = path.join(options.outDir, `${runId}-report.json`);
      const report = await analyzeFromFile(filepath, { silent: true, reportPath });
      reportsByRun.push({ runId, report });
      run.reportPath = reportPath;
      run.score = report.summary.score;
      run.critical = report.summary.critical;
      run.warning = report.summary.warning;
      run.info = report.summary.info;
    }

    runs.push(run);
    if (options.failFast && !result.success) break;
  }

  // Run stratified random samples
  if (!options.failFast || runs.every((r) => r.success)) {
    const specs = buildRandomRunSpecs(randomCount);

    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      const runId = `R${String(i + 1).padStart(2, '0')}-${sanitize(spec.key)}`;
      const scenarioId = `random-${spec.key}`;
      const started = new Date().toISOString();
      console.log(`\n▶️  [${runId}] Random (${spec.key})`);

      const base = completeRandomPreferences({ randomFn });
      const prefs = applyPreferenceOverrides(base, spec.overrides, randomFn, !!spec.forceMultiCity);
      const result = await generateTripRun(scenarioId, prefs);

      const decorated: GenerationResult = {
        ...result,
        _campaign: {
          campaignId: options.campaignId,
          runId,
          runKind: 'random',
          seed: options.seed,
          startedAt: started,
          durationMs: result.durationMs,
        },
      };

      const filepath = saveResult(decorated, { outDir: options.outDir, filename: `${runId}.json` });
      const run: CampaignRun = {
        runId,
        runKind: 'random',
        scenarioId,
        filepath,
        startedAt: started,
        durationMs: result.durationMs,
        success: result.success,
        errorMessage: result.errorMessage,
      };

      if (options.analyze && result.success) {
        const reportPath = path.join(options.outDir, `${runId}-report.json`);
        const report = await analyzeFromFile(filepath, { silent: true, reportPath });
        reportsByRun.push({ runId, report });
        run.reportPath = reportPath;
        run.score = report.summary.score;
        run.critical = report.summary.critical;
        run.warning = report.summary.warning;
        run.info = report.summary.info;
      }

      runs.push(run);
      if (options.failFast && !result.success) break;
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  const successCount = runs.filter((run) => run.success).length;
  const failureCount = runs.length - successCount;
  const analyzedRuns = runs.filter((run) => typeof run.score === 'number').length;
  const scenarioRuns = runs.filter((run) => run.runKind === 'scenario').length;
  const randomRuns = runs.filter((run) => run.runKind === 'random').length;
  const successRate = runs.length > 0 ? successCount / runs.length : 0;

  const scores = runs.map((run) => run.score).filter((s): s is number => typeof s === 'number');
  const avgScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const p50 = scores.length > 0 ? percentile(scores, 0.5) : 0;
  const p90 = scores.length > 0 ? percentile(scores, 0.9) : 0;

  const sectionAverages = SECTION_KEYS.reduce((acc, key) => {
    const vals = reportsByRun.map(({ report }) => report.sectionScores[key]?.score).filter((v): v is number => typeof v === 'number');
    acc[key] = vals.length > 0 ? vals.reduce((sum, score) => sum + score, 0) / vals.length : 0;
    return acc;
  }, {} as Record<SectionKey, number>);

  const { issuesByCode, issuesByComponent } = aggregateIssues(reportsByRun);
  const topRegressions = issuesByCode.slice(0, 25);

  const getIssueCount = (codes: string[]): number =>
    issuesByCode.filter((issue) => codes.includes(issue.code)).reduce((sum, issue) => sum + issue.count, 0);

  const apiKeyLeakCount = getIssueCount(['LINK_API_KEY_LEAK']);
  const hotelBoundaryCount = getIssueCount(['DATA_HOTEL_BOUNDARY_INCOHERENT']);
  const urbanLegPolicyCount = getIssueCount(['GEO_URBAN_HARD_LONG_LEG', 'GEO_URBAN_TOO_MANY_LONG_LEGS']);
  const remainingCriticalCount = reportsByRun.reduce((sum, item) => sum + item.report.summary.critical, 0);

  const exitCriteria = {
    successRate: { value: successRate, target: 0.9, pass: successRate >= 0.9 },
    noApiKeyLeaks: { count: apiKeyLeakCount, pass: apiKeyLeakCount === 0 },
    noHotelBoundaryIncoherent: { count: hotelBoundaryCount, pass: hotelBoundaryCount === 0 },
    urbanLegPolicy: { count: urbanLegPolicyCount, pass: urbanLegPolicyCount === 0 },
    averageScore: { value: avgScore, target: 85, pass: avgScore >= 85 },
    noCriticalRemaining: { count: remainingCriticalCount, pass: remainingCriticalCount === 0 },
    overallPass: false,
  };
  exitCriteria.overallPass = Object.values(exitCriteria).every((value) => {
    if (typeof value !== 'object' || value === null) return true;
    if ('pass' in value) return value.pass;
    return true;
  });

  const stratification = {
    groupTypes: {
      solo: 0,
      couple: 0,
      friends: 0,
      family_with_kids: 0,
      family_without_kids: 0,
    } as Record<GroupType, number>,
    budgetLevels: {
      economic: 0,
      moderate: 0,
      comfort: 0,
      luxury: 0,
    } as Record<BudgetLevel, number>,
    transports: {
      optimal: 0,
      plane: 0,
      train: 0,
      car: 0,
      bus: 0,
    } as Record<TransportType, number>,
    multiCityRuns: 0,
  };

  for (const run of runs) {
    if (!run.success) continue;
    try {
      const raw = fs.readFileSync(run.filepath, 'utf-8');
      const parsed = JSON.parse(raw) as GenerationResult;
      const prefs = parsed.preferences;
      if (prefs?.groupType) stratification.groupTypes[prefs.groupType] += 1;
      if (prefs?.budgetLevel) stratification.budgetLevels[prefs.budgetLevel] += 1;
      if (prefs?.transport) stratification.transports[prefs.transport] += 1;
      if (Array.isArray(prefs?.cityPlan) && prefs.cityPlan.length > 1) stratification.multiCityRuns += 1;
    } catch {
      // ignore broken run payload in stratification
    }
  }

  const summary: CampaignSummary = {
    campaignMeta: {
      campaignId: options.campaignId,
      startedAt,
      finishedAt,
      durationMs,
      seed: options.seed,
      totalRequested: options.total,
      randomCountRequested: options.randomCount,
      scenarioCountRequested: scenarioCount,
      analyze: options.analyze,
      failFast: options.failFast,
      outDir: options.outDir,
    },
    runStats: {
      total: runs.length,
      success: successCount,
      failed: failureCount,
      scenarioRuns,
      randomRuns,
      analyzedRuns,
      successRate: toFixed2(successRate),
    },
    scoreStats: {
      average: toFixed2(avgScore),
      min: toFixed2(minScore),
      max: toFixed2(maxScore),
      p50: toFixed2(p50),
      p90: toFixed2(p90),
      sectionAverages: SECTION_KEYS.reduce((acc, key) => {
        acc[key] = toFixed2(sectionAverages[key]);
        return acc;
      }, {} as Record<SectionKey, number>),
    },
    issuesByCode,
    issuesByComponent,
    topRegressions,
    stratification,
    exitCriteria,
    runs,
  };

  const summaryJsonPath = path.join(options.outDir, 'campaign-summary.json');
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf-8');

  const summaryMdPath = path.join(options.outDir, 'campaign-summary.md');
  fs.writeFileSync(summaryMdPath, buildSummaryMarkdown(summary), 'utf-8');

  console.log('\n' + '='.repeat(70));
  console.log('✅ Campaign complete');
  console.log(`   Runs: ${summary.runStats.total} (${summary.runStats.success} success / ${summary.runStats.failed} failed)`);
  console.log(`   Average score: ${summary.scoreStats.average}`);
  console.log(`   Acceptance: ${summary.exitCriteria.overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`   Summary JSON: ${summaryJsonPath}`);
  console.log(`   Summary MD: ${summaryMdPath}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('💥 Erreur fatale campagne:', err);
  process.exit(1);
});

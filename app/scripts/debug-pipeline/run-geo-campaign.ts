#!/usr/bin/env npx tsx
/**
 * Campagne géo dédiée (8 directs + 2 suggestion->generation).
 *
 * Usage:
 *   npx tsx scripts/debug-pipeline/run-geo-campaign.ts --max-runs 10 --seed 20260217
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateDestinationSuggestions } from '../../src/lib/services/suggestions';
import type { Trip, TripPreferences, GroupType, BudgetLevel, TransportType, ActivityType } from '../../src/lib/types';
import { analyzeFromFile } from './analyze-trip';
import {
  assertRequiredEnv,
  completeRandomPreferences,
  generateTripRun,
  getEnvHealth,
  saveResult,
  type GenerationResult,
} from './generate-trip';
import type { AnalysisReport } from './report';

type GeoRunType = 'direct' | 'suggestion';

interface GeoRunSummary {
  runId: string;
  runType: GeoRunType;
  scenarioId: string;
  success: boolean;
  durationMs: number;
  filepath?: string;
  reportPath?: string;
  score?: number;
  geoCodes: Record<string, number>;
  inefficiencyFailDays: number;
  inefficiencyExemptDays: number;
  highZigzagDays: number;
  mustSeeMissing: string[];
  errorMessage?: string;
  suggestionQuery?: string;
  suggestionTitle?: string;
}

interface GeoCampaignSummary {
  campaignId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  seed: number;
  maxRuns: number;
  expectedDirectRuns: number;
  expectedSuggestionRuns: number;
  envHealth: Record<'ANTHROPIC' | 'SERPAPI' | 'RAPIDAPI' | 'VIATOR', '✅' | '❌'>;
  runStats: {
    total: number;
    success: number;
    failed: number;
    direct: number;
    suggestion: number;
  };
  geoCodeTotals: Record<string, number>;
  inefficiency: {
    failDays: number;
    exemptDays: number;
  };
  mustSeeCoverageFailures: number;
  acceptance: {
    noImpossibleTransition: { pass: boolean; count: number };
    noUrbanHardLongLeg: { pass: boolean; count: number };
    noIntraDayZigzag: { pass: boolean; count: number; highZigzagDays: number };
    routeInefficiencyWithinTarget: { pass: boolean; count: number; exempt: number };
    mustSeeCoverage: { pass: boolean; count: number };
    campaignExecutedTargetMix: { pass: boolean; expected: number; actual: number };
    overallPass: boolean;
  };
  runs: GeoRunSummary[];
}

interface DirectRunProfile {
  id: string;
  groupType: GroupType;
  budgetLevel: BudgetLevel;
  transport: TransportType;
  activities: ActivityType[];
  durationDays: number;
  origin: string;
  destination?: string;
}

interface SuggestionSpec {
  query: string;
  context: {
    origin: string;
    budgetLevel: BudgetLevel;
    groupType: GroupType;
    activities: ActivityType[];
  };
}

function parseIntArg(args: string[], name: string, fallback: number): number {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const raw = args[idx + 1];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalIntArg(args: string[], name: string): number | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const raw = args[idx + 1];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}: "${raw}"`);
  }
  return parsed;
}

export function resolveRunComposition(
  maxRuns: number,
  directRunsArg?: number,
  suggestionRunsArg?: number
): { expectedDirectRuns: number; expectedSuggestionRuns: number } {
  const safeMaxRuns = Math.max(1, Math.min(10, maxRuns));
  const defaultDirectRuns = Math.min(8, Math.max(0, safeMaxRuns - 2));
  const defaultSuggestionRuns = Math.min(2, Math.max(0, safeMaxRuns - defaultDirectRuns));

  const expectedDirectRuns = directRunsArg ?? defaultDirectRuns;
  const expectedSuggestionRuns = suggestionRunsArg ?? defaultSuggestionRuns;

  if (expectedDirectRuns < 0 || expectedSuggestionRuns < 0) {
    throw new Error('direct-runs and suggestion-runs must be >= 0');
  }
  if (expectedDirectRuns + expectedSuggestionRuns > safeMaxRuns) {
    throw new Error(
      `Invalid run composition: direct (${expectedDirectRuns}) + suggestion (${expectedSuggestionRuns}) exceeds max-runs (${safeMaxRuns})`
    );
  }

  return { expectedDirectRuns, expectedSuggestionRuns };
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

function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collectGeoCodeCounts(report: AnalysisReport, codes: string[]): Record<string, number> {
  const totals = Object.fromEntries(codes.map((code) => [code, 0]));
  for (const issue of report.sections.geography) {
    if (issue.code && Object.prototype.hasOwnProperty.call(totals, issue.code)) {
      totals[issue.code] += 1;
    }
  }
  return totals;
}

function collectRouteInefficiencyFailures(trip: Trip): { failDays: number; exemptDays: number } {
  let failDays = 0;
  let exemptDays = 0;

  for (const day of trip.days) {
    if (day.isDayTrip) continue;
    const ratio = day.geoDiagnostics?.routeInefficiencyRatio;
    const totalLegKm = day.geoDiagnostics?.totalLegKm;
    const mstLowerBoundKm = day.geoDiagnostics?.mstLowerBoundKm;
    if (typeof ratio !== 'number' || typeof totalLegKm !== 'number' || typeof mstLowerBoundKm !== 'number') continue;
    const routeIsNonTrivial = totalLegKm > 1.5 && mstLowerBoundKm > 0.5;
    if (!routeIsNonTrivial || ratio <= 1.75) continue;

    const activityItems = day.items.filter((item) => item.type === 'activity');
    const lowReliabilityCount = activityItems.filter((item) => item.dataReliability && item.dataReliability !== 'verified').length;
    const isLowReliabilityDay = activityItems.length > 0 && lowReliabilityCount / activityItems.length >= 0.5;

    if (isLowReliabilityDay) exemptDays += 1;
    else failDays += 1;
  }

  return { failDays, exemptDays };
}

function countHighZigzagDays(trip: Trip): number {
  return trip.days.filter((day) => !day.isDayTrip && (day.geoDiagnostics?.zigzagTurns || 0) >= 3).length;
}

function parseMissingMustSeeFromLogs(logs: string[]): string[] {
  const missing = new Set<string>();
  const regex = /MUST-SEES MISSING FROM SCHEDULE:\s*(.+)$/i;

  for (const line of logs) {
    const match = line.match(regex);
    if (!match || !match[1]) continue;
    const rawNames = match[1]
      .split(',')
      .map((part) => part.replace(/["']/g, '').trim())
      .filter(Boolean);
    for (const name of rawNames) missing.add(name);
  }

  return [...missing];
}

export function collectMissingMustSee(trip: Trip, logs: string[] = []): string[] {
  const scheduledActivityIds = new Set(
    trip.days.flatMap((day) => day.items.filter((item) => item.type === 'activity').map((item) => item.id))
  );

  const missingByPool = new Set<string>();
  const poolMustSees = (trip.attractionPool || []).filter((activity) => activity.mustSee);
  for (const mustSee of poolMustSees) {
    if (!scheduledActivityIds.has(mustSee.id)) {
      missingByPool.add(mustSee.name || mustSee.id);
    }
  }

  const missingFromLogs = parseMissingMustSeeFromLogs(logs);
  for (const name of missingFromLogs) missingByPool.add(name);

  return [...missingByPool];
}

function buildDirectPreferences(
  randomFn: () => number,
  profile: DirectRunProfile,
  offsetDays: number
): TripPreferences {
  const base = completeRandomPreferences({ randomFn });
  const destination = profile.destination || base.destination || 'Rome';
  const groupSizeMap: Record<GroupType, number> = {
    solo: 1,
    couple: 2,
    friends: 4,
    family_with_kids: 4,
    family_without_kids: 4,
  };

  return {
    ...base,
    origin: profile.origin,
    destination,
    startDate: new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000),
    durationDays: profile.durationDays,
    transport: profile.transport,
    carRental: profile.transport === 'car',
    groupType: profile.groupType,
    groupSize: groupSizeMap[profile.groupType],
    budgetLevel: profile.budgetLevel,
    activities: profile.activities,
    dietary: ['none'],
    mustSee: '',
    tripMode: 'precise',
    cityPlan: [{ city: destination, days: profile.durationDays }],
  };
}

function isMiniGeoStrictComposition(maxRuns: number, directRuns: number, suggestionRuns: number): boolean {
  return maxRuns === 3 && directRuns === 2 && suggestionRuns === 1;
}

export function selectDirectProfiles(
  directProfiles: DirectRunProfile[],
  maxRuns: number,
  directRuns: number,
  suggestionRuns: number
): DirectRunProfile[] {
  if (!isMiniGeoStrictComposition(maxRuns, directRuns, suggestionRuns)) {
    return directProfiles.slice(0, directRuns);
  }

  const preferredIds = ['geo-direct-02', 'geo-direct-08'];
  const selected = preferredIds
    .map((id) => directProfiles.find((profile) => profile.id === id))
    .filter((profile): profile is DirectRunProfile => Boolean(profile));
  if (selected.length !== preferredIds.length) {
    throw new Error('Mini geo composition requires direct profiles geo-direct-02 and geo-direct-08');
  }
  return selected;
}

export function selectSuggestionSpecs(
  suggestionSpecs: SuggestionSpec[],
  maxRuns: number,
  directRuns: number,
  suggestionRuns: number
): SuggestionSpec[] {
  if (!isMiniGeoStrictComposition(maxRuns, directRuns, suggestionRuns)) {
    return suggestionSpecs.slice(0, suggestionRuns);
  }

  const preferredQuery = 'Je veux un city-break gastronomie pas cher depuis Lyon';
  const preferred = suggestionSpecs.find((spec) => spec.query === preferredQuery);
  if (!preferred) {
    throw new Error('Mini geo composition requires gastronomy suggestion query');
  }
  return [preferred];
}

function buildSuggestionPreferences(
  suggestionTitle: string,
  stages: Array<{ city: string; days: number }>,
  context: { origin: string; budgetLevel: BudgetLevel; groupType: GroupType; activities: ActivityType[] },
  offsetDays: number
): TripPreferences {
  const safeStages = stages.length > 0 ? stages : [{ city: suggestionTitle, days: 3 }];
  const durationDays = Math.max(2, safeStages.reduce((sum, stage) => sum + Math.max(1, stage.days || 0), 0));
  const destination = safeStages[0].city || suggestionTitle;

  return {
    origin: context.origin,
    destination,
    startDate: new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000),
    durationDays,
    transport: 'optimal',
    carRental: false,
    groupSize: 1,
    groupType: context.groupType,
    budgetLevel: context.budgetLevel,
    activities: context.activities,
    dietary: ['none'],
    mustSee: '',
    tripMode: 'precise',
    cityPlan: safeStages.map((stage) => ({ city: stage.city, days: Math.max(1, stage.days || 1) })),
  };
}

function buildSummaryMarkdown(summary: GeoCampaignSummary): string {
  const lines: string[] = [];
  lines.push(`# Geo Campaign Summary — ${summary.campaignId}`);
  lines.push('');
  lines.push(`- Started: ${summary.startedAt}`);
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push(`- Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  lines.push(`- Seed: ${summary.seed}`);
  lines.push(`- Runs: ${summary.runStats.total} (${summary.runStats.success} success / ${summary.runStats.failed} failed)`);
  lines.push('');
  lines.push('## Acceptance');
  lines.push(`- GEO_IMPOSSIBLE_TRANSITION == 0: ${summary.acceptance.noImpossibleTransition.pass ? 'PASS' : 'FAIL'} (${summary.acceptance.noImpossibleTransition.count})`);
  lines.push(`- GEO_URBAN_HARD_LONG_LEG == 0: ${summary.acceptance.noUrbanHardLongLeg.pass ? 'PASS' : 'FAIL'} (${summary.acceptance.noUrbanHardLongLeg.count})`);
  lines.push(`- GEO_INTRA_DAY_ZIGZAG <= 2 and no day >= 3: ${summary.acceptance.noIntraDayZigzag.pass ? 'PASS' : 'FAIL'} (${summary.acceptance.noIntraDayZigzag.count}, highDays=${summary.acceptance.noIntraDayZigzag.highZigzagDays})`);
  lines.push(`- routeInefficiencyRatio <= 1.75: ${summary.acceptance.routeInefficiencyWithinTarget.pass ? 'PASS' : 'FAIL'} (${summary.acceptance.routeInefficiencyWithinTarget.count}, exempt=${summary.acceptance.routeInefficiencyWithinTarget.exempt})`);
  lines.push(`- must-see coverage: ${summary.acceptance.mustSeeCoverage.pass ? 'PASS' : 'FAIL'} (${summary.acceptance.mustSeeCoverage.count})`);
  lines.push(`- campaign executed target mix: ${summary.acceptance.campaignExecutedTargetMix.pass ? 'PASS' : 'FAIL'} (${summary.acceptance.campaignExecutedTargetMix.actual}/${summary.acceptance.campaignExecutedTargetMix.expected})`);
  lines.push(`- overall: ${summary.acceptance.overallPass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Geo Codes');
  lines.push('| Code | Count |');
  lines.push('|---|---:|');
  for (const [code, count] of Object.entries(summary.geoCodeTotals)) {
    lines.push(`| ${code} | ${count} |`);
  }
  lines.push('');
  lines.push('## Runs');
  lines.push('| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|');
  for (const run of summary.runs) {
    lines.push(
      `| ${run.runId} | ${run.runType} | ${run.success ? 'yes' : 'no'} | ${run.score ?? 0} | ${run.geoCodes.GEO_IMPOSSIBLE_TRANSITION || 0} | ${run.geoCodes.GEO_URBAN_HARD_LONG_LEG || 0} | ${run.geoCodes.GEO_INTRA_DAY_ZIGZAG || 0} | ${run.geoCodes.GEO_DAY_ROUTE_EFFICIENCY_LOW || 0} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function runSingle(
  runId: string,
  runType: GeoRunType,
  scenarioId: string,
  preferences: TripPreferences,
  outDir: string,
  extra: { suggestionQuery?: string; suggestionTitle?: string } = {}
): Promise<GeoRunSummary> {
  const geoCodes = ['GEO_IMPOSSIBLE_TRANSITION', 'GEO_URBAN_HARD_LONG_LEG', 'GEO_INTRA_DAY_ZIGZAG', 'GEO_DAY_ROUTE_EFFICIENCY_LOW'];
  const result = await generateTripRun(scenarioId, preferences);

  if (!result.success || !result.trip) {
    return {
      runId,
      runType,
      scenarioId,
      success: false,
      durationMs: result.durationMs,
      geoCodes: Object.fromEntries(geoCodes.map((code) => [code, 0])),
      inefficiencyFailDays: 0,
      inefficiencyExemptDays: 0,
      highZigzagDays: 0,
      mustSeeMissing: [],
      errorMessage: result.errorMessage || 'generation_failed',
      ...extra,
    };
  }

  const enriched = {
    ...result,
    runType,
    suggestionQuery: extra.suggestionQuery,
    suggestionTitle: extra.suggestionTitle,
  };
  const filepath = saveResult(enriched as GenerationResult, {
    outDir,
    filename: `${runId}.json`,
  });

  const report = await analyzeFromFile(filepath, { silent: true });
  const reportPath = filepath.replace(/\.json$/i, '-report.json');
  const trip = result.trip as Trip;
  const mustSeeMissing = collectMissingMustSee(trip, [
    ...result.logs,
    ...result.warnings,
    ...result.errors,
  ]);
  const inefficiency = collectRouteInefficiencyFailures(trip);
  const highZigzagDays = countHighZigzagDays(trip);
  const codeCounts = collectGeoCodeCounts(report, geoCodes);

  return {
    runId,
    runType,
    scenarioId,
    success: true,
    durationMs: result.durationMs,
    filepath,
    reportPath,
    score: report.summary.score,
    geoCodes: codeCounts,
    inefficiencyFailDays: inefficiency.failDays,
    inefficiencyExemptDays: inefficiency.exemptDays,
    highZigzagDays,
    mustSeeMissing,
    ...extra,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const args = process.argv.slice(2);
  const maxRuns = Math.max(1, Math.min(10, parseIntArg(args, '--max-runs', 10)));
  const seed = parseIntArg(args, '--seed', 20260217);
  const directRunsArg = parseOptionalIntArg(args, '--direct-runs');
  const suggestionRunsArg = parseOptionalIntArg(args, '--suggestion-runs');
  const randomFn = createSeededRandom(seed);
  const campaignId = `geo-campaign-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const outDir = path.join(__dirname, 'results', campaignId);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  assertRequiredEnv(['ANTHROPIC_API_KEY']);
  const envHealth = getEnvHealth();

  const directProfiles: DirectRunProfile[] = [
    { id: 'geo-direct-01', groupType: 'solo', budgetLevel: 'economic', transport: 'train', activities: ['culture', 'gastronomy'], durationDays: 3, origin: 'Lyon', destination: 'Berlin' },
    { id: 'geo-direct-02', groupType: 'couple', budgetLevel: 'comfort', transport: 'plane', activities: ['culture', 'shopping'], durationDays: 5, origin: 'Paris', destination: 'Marrakech' },
    { id: 'geo-direct-03', groupType: 'friends', budgetLevel: 'moderate', transport: 'bus', activities: ['nightlife', 'gastronomy'], durationDays: 4, origin: 'Marseille', destination: 'Lisbonne' },
    { id: 'geo-direct-04', groupType: 'family_without_kids', budgetLevel: 'moderate', transport: 'car', activities: ['nature', 'culture'], durationDays: 6, origin: 'Bordeaux', destination: 'Barcelone' },
    { id: 'geo-direct-05', groupType: 'family_with_kids', budgetLevel: 'comfort', transport: 'optimal', activities: ['nature', 'adventure'], durationDays: 5, origin: 'Nantes', destination: 'Valence' },
    { id: 'geo-direct-06', groupType: 'solo', budgetLevel: 'luxury', transport: 'plane', activities: ['wellness', 'culture'], durationDays: 4, origin: 'Nice', destination: 'Rome' },
    { id: 'geo-direct-07', groupType: 'couple', budgetLevel: 'economic', transport: 'train', activities: ['gastronomy', 'nature'], durationDays: 3, origin: 'Lille', destination: 'Bologne' },
    { id: 'geo-direct-08', groupType: 'friends', budgetLevel: 'moderate', transport: 'optimal', activities: ['shopping', 'nightlife'], durationDays: 4, origin: 'Toulouse', destination: 'Amsterdam' },
  ];

  const suggestionSpecs: SuggestionSpec[] = [
    {
      query: 'Je veux un city-break gastronomie pas cher depuis Lyon',
      context: { origin: 'Lyon', budgetLevel: 'economic' as BudgetLevel, groupType: 'solo' as GroupType, activities: ['gastronomy', 'culture'] as ActivityType[] },
    },
    {
      query: 'Je veux faire un break de 3 jours en Europe',
      context: { origin: 'Lyon', budgetLevel: 'moderate' as BudgetLevel, groupType: 'solo' as GroupType, activities: ['culture', 'gastronomy'] as ActivityType[] },
    },
  ];

  const { expectedDirectRuns, expectedSuggestionRuns } = resolveRunComposition(
    maxRuns,
    directRunsArg,
    suggestionRunsArg
  );
  if (expectedDirectRuns > directProfiles.length) {
    throw new Error(`direct-runs (${expectedDirectRuns}) exceeds available direct profiles (${directProfiles.length})`);
  }
  if (expectedSuggestionRuns > suggestionSpecs.length) {
    throw new Error(`suggestion-runs (${expectedSuggestionRuns}) exceeds available suggestion specs (${suggestionSpecs.length})`);
  }

  console.log('[Geo campaign] ENV:', envHealth);
  console.log(`[Geo campaign] outDir=${outDir}`);
  console.log(`[Geo campaign] maxRuns=${maxRuns} seed=${seed} direct=${expectedDirectRuns} suggestion=${expectedSuggestionRuns}`);
  const runs: GeoRunSummary[] = [];

  const selectedDirectProfiles = selectDirectProfiles(
    directProfiles,
    maxRuns,
    expectedDirectRuns,
    expectedSuggestionRuns
  );

  for (let i = 0; i < selectedDirectProfiles.length; i++) {
    const profile = selectedDirectProfiles[i];
    const runId = profile.id;
    const prefs = buildDirectPreferences(randomFn, profile, 30 + i * 2);
    const summary = await runSingle(runId, 'direct', runId, prefs, outDir);
    runs.push(summary);
  }

  const selectedSuggestionSpecs = selectSuggestionSpecs(
    suggestionSpecs,
    maxRuns,
    expectedDirectRuns,
    expectedSuggestionRuns
  );

  for (let i = 0; i < selectedSuggestionSpecs.length; i++) {
    const runId = `geo-suggest-${String(i + 1).padStart(2, '0')}`;
    const spec = selectedSuggestionSpecs[i];
    let scenarioId = runId;
    let prefs: TripPreferences;
    let suggestionTitle = '';

    try {
      const suggestions = await generateDestinationSuggestions(spec.query, {
        origin: spec.context.origin,
        budgetLevel: spec.context.budgetLevel,
        groupType: spec.context.groupType,
        activities: spec.context.activities,
        durationDays: 3,
      });
      const selected = suggestions[0];
      if (!selected) {
        runs.push({
          runId,
          runType: 'suggestion',
          scenarioId,
          success: false,
          durationMs: 0,
          geoCodes: {
            GEO_IMPOSSIBLE_TRANSITION: 0,
            GEO_URBAN_HARD_LONG_LEG: 0,
            GEO_INTRA_DAY_ZIGZAG: 0,
            GEO_DAY_ROUTE_EFFICIENCY_LOW: 0,
          },
          inefficiencyFailDays: 0,
          inefficiencyExemptDays: 0,
          highZigzagDays: 0,
          mustSeeMissing: [],
          errorMessage: 'no_suggestions',
          suggestionQuery: spec.query,
        });
        continue;
      }

      suggestionTitle = selected.title;
      scenarioId = `${runId}-${normalizeText(selected.title).slice(0, 40).replace(/\s+/g, '-')}`;
      prefs = buildSuggestionPreferences(
        selected.title,
        selected.stages || [],
        spec.context,
        45 + i * 3
      );
    } catch (error) {
      runs.push({
        runId,
        runType: 'suggestion',
        scenarioId,
        success: false,
        durationMs: 0,
        geoCodes: {
          GEO_IMPOSSIBLE_TRANSITION: 0,
          GEO_URBAN_HARD_LONG_LEG: 0,
          GEO_INTRA_DAY_ZIGZAG: 0,
          GEO_DAY_ROUTE_EFFICIENCY_LOW: 0,
        },
        inefficiencyFailDays: 0,
        inefficiencyExemptDays: 0,
        highZigzagDays: 0,
        mustSeeMissing: [],
        errorMessage: error instanceof Error ? error.message : String(error),
        suggestionQuery: spec.query,
      });
      continue;
    }

    const summary = await runSingle(
      runId,
      'suggestion',
      scenarioId,
      prefs,
      outDir,
      { suggestionQuery: spec.query, suggestionTitle }
    );
    runs.push(summary);
  }

  const geoCodesTracked = ['GEO_IMPOSSIBLE_TRANSITION', 'GEO_URBAN_HARD_LONG_LEG', 'GEO_INTRA_DAY_ZIGZAG', 'GEO_DAY_ROUTE_EFFICIENCY_LOW'];
  const geoCodeTotals = Object.fromEntries(geoCodesTracked.map((code) => [code, 0]));
  let inefficiencyFailDays = 0;
  let inefficiencyExemptDays = 0;
  let highZigzagDays = 0;
  let mustSeeCoverageFailures = 0;
  for (const run of runs) {
    for (const code of geoCodesTracked) {
      geoCodeTotals[code] += run.geoCodes[code] || 0;
    }
    inefficiencyFailDays += run.inefficiencyFailDays;
    inefficiencyExemptDays += run.inefficiencyExemptDays;
    highZigzagDays += run.highZigzagDays;
    if (run.mustSeeMissing.length > 0) mustSeeCoverageFailures += 1;
  }

  const runStats = {
    total: runs.length,
    success: runs.filter((run) => run.success).length,
    failed: runs.filter((run) => !run.success).length,
    direct: runs.filter((run) => run.runType === 'direct').length,
    suggestion: runs.filter((run) => run.runType === 'suggestion').length,
  };

  const acceptance = {
    noImpossibleTransition: { pass: geoCodeTotals.GEO_IMPOSSIBLE_TRANSITION === 0, count: geoCodeTotals.GEO_IMPOSSIBLE_TRANSITION },
    noUrbanHardLongLeg: { pass: geoCodeTotals.GEO_URBAN_HARD_LONG_LEG === 0, count: geoCodeTotals.GEO_URBAN_HARD_LONG_LEG },
    noIntraDayZigzag: {
      pass: geoCodeTotals.GEO_INTRA_DAY_ZIGZAG <= 2 && highZigzagDays === 0,
      count: geoCodeTotals.GEO_INTRA_DAY_ZIGZAG,
      highZigzagDays,
    },
    routeInefficiencyWithinTarget: { pass: inefficiencyFailDays === 0, count: inefficiencyFailDays, exempt: inefficiencyExemptDays },
    mustSeeCoverage: { pass: mustSeeCoverageFailures === 0, count: mustSeeCoverageFailures },
    campaignExecutedTargetMix: {
      pass: runStats.total === (expectedDirectRuns + expectedSuggestionRuns)
        && runStats.direct === expectedDirectRuns
        && runStats.suggestion === expectedSuggestionRuns,
      expected: expectedDirectRuns + expectedSuggestionRuns,
      actual: runStats.total,
    },
    overallPass: false,
  };
  acceptance.overallPass =
    acceptance.noImpossibleTransition.pass
    && acceptance.noUrbanHardLongLeg.pass
    && acceptance.noIntraDayZigzag.pass
    && acceptance.routeInefficiencyWithinTarget.pass
    && acceptance.mustSeeCoverage.pass
    && acceptance.campaignExecutedTargetMix.pass
    && runStats.failed === 0;

  const finishedAt = new Date().toISOString();
  const summary: GeoCampaignSummary = {
    campaignId,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    seed,
    maxRuns,
    expectedDirectRuns,
    expectedSuggestionRuns,
    envHealth,
    runStats,
    geoCodeTotals,
    inefficiency: {
      failDays: inefficiencyFailDays,
      exemptDays: inefficiencyExemptDays,
    },
    mustSeeCoverageFailures,
    acceptance,
    runs,
  };

  const summaryJsonPath = path.join(outDir, 'geo-summary.json');
  const summaryMdPath = path.join(outDir, 'geo-summary.md');
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf-8');
  fs.writeFileSync(summaryMdPath, buildSummaryMarkdown(summary), 'utf-8');

  console.log('[Geo campaign] done');
  console.log(`[Geo campaign] summary json: ${summaryJsonPath}`);
  console.log(`[Geo campaign] summary md: ${summaryMdPath}`);
  console.log(`[Geo campaign] overall: ${summary.acceptance.overallPass ? 'PASS' : 'FAIL'}`);
}

const isDirectRun = process.argv[1]?.includes('run-geo-campaign');
if (isDirectRun) {
  main().catch((error) => {
    console.error('[Geo campaign] fatal:', error);
    process.exit(1);
  });
}

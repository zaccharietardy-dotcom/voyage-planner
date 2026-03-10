#!/usr/bin/env npx tsx
/**
 * Générateur CLI de voyages pour le debug pipeline
 *
 * Appelle generateTripV2() directement, sans passer par l'UI ni Supabase.
 *
 * Usage:
 *   npx tsx scripts/debug-pipeline/generate-trip.ts --scenario paris-rome-4d
 *   npx tsx scripts/debug-pipeline/generate-trip.ts --random
 *   npx tsx scripts/debug-pipeline/generate-trip.ts --all
 *   npx tsx scripts/debug-pipeline/generate-trip.ts --all-and-analyze
 */

// Charger les variables d'environnement AVANT tout import
import * as path from 'path';
import * as fs from 'fs';

export function loadEnvLocal(explicitPath?: string): void {
  const envPath = explicitPath || path.join(__dirname, '..', '..', '.env.local');
  if (!fs.existsSync(envPath)) return;

  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] = val;
  }
}

// Chargement eager par défaut pour la CLI
loadEnvLocal();
if (!process.env.PIPELINE_VERSION) {
  process.env.PIPELINE_VERSION = 'v3';
}

// Imports après dotenv
import { generateTripV2 } from '../../src/lib/pipeline';
import { generateRandomPreferences } from '../../src/lib/randomExample';
import { TripPreferences } from '../../src/lib/types';
import { SCENARIOS, getScenario, getAllScenarioIds } from './scenarios';

// ============================================
// Console capture
// ============================================

interface CapturedLogs {
  logs: string[];
  warnings: string[];
  errors: string[];
}

function captureConsole(): CapturedLogs & { restore: () => void } {
  const captured: CapturedLogs = { logs: [], warnings: [], errors: [] };
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    captured.logs.push(args.map(String).join(' '));
    originalLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    captured.warnings.push(args.map(String).join(' '));
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    captured.errors.push(args.map(String).join(' '));
    originalError(...args);
  };

  return {
    ...captured,
    restore: () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

// ============================================
// Trip generation
// ============================================

export interface CampaignRunMetadata {
  campaignId: string;
  runId: string;
  runKind: 'scenario' | 'random';
  seed: number;
  startedAt: string;
  durationMs: number;
}

export interface GenerationResult {
  scenarioId: string;
  preferences: TripPreferences;
  trip: unknown;
  logs: string[];
  warnings: string[];
  errors: string[];
  durationMs: number;
  generatedAt: string;
  success: boolean;
  errorMessage?: string;
  _campaign?: CampaignRunMetadata;
}

export async function generateTripRun(scenarioId: string, preferences: TripPreferences): Promise<GenerationResult> {
  const captured = captureConsole();
  const startTime = Date.now();
  const generatedAt = new Date().toISOString();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🚀 Génération: ${scenarioId}`);
  console.log(`   ${preferences.origin} → ${preferences.destination} (${preferences.durationDays}j)`);
  console.log(`   ${preferences.groupType} (${preferences.groupSize}p) | ${preferences.budgetLevel} | ${preferences.activities.join(', ')}`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    const trip = await generateTripV2(preferences);
    const durationMs = Date.now() - startTime;
    captured.restore();

    const totalItems = trip.days.reduce((sum, d) => sum + d.items.length, 0);
    console.log(`\n✅ Succès en ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   ${trip.days.length} jours, ${totalItems} items`);
    console.log(`   Coût estimé: ${trip.totalEstimatedCost ?? '?'}€`);
    console.log(`   Hébergement: ${trip.accommodation?.name ?? 'aucun'}`);
    if (trip.outboundFlight) {
      console.log(`   Vol aller: ${trip.outboundFlight.flightNumber} (${trip.outboundFlight.departureAirportCode}→${trip.outboundFlight.arrivalAirportCode})`);
    }
    if (trip.carbonFootprint) {
      console.log(`   Carbone: ${trip.carbonFootprint.total}kg CO2 (${trip.carbonFootprint.rating})`);
    }

    return {
      scenarioId,
      preferences,
      trip,
      logs: captured.logs,
      warnings: captured.warnings,
      errors: captured.errors,
      durationMs,
      generatedAt,
      success: true,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    captured.restore();
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Échec après ${(durationMs / 1000).toFixed(1)}s: ${errorMessage}`);

    return {
      scenarioId,
      preferences,
      trip: null,
      logs: captured.logs,
      warnings: captured.warnings,
      errors: [...captured.errors, errorMessage],
      durationMs,
      generatedAt,
      success: false,
      errorMessage,
    };
  }
}

// ============================================
// File saving
// ============================================

export interface SaveResultOptions {
  outDir?: string;
  filename?: string;
}

export function saveResult(result: GenerationResult, options: SaveResultOptions = {}): string {
  const resultsDir = options.outDir || path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = options.filename || `${result.scenarioId}-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf-8');
  const relativePath = path.relative(process.cwd(), filepath);
  console.log(`💾 Sauvegardé: ${relativePath || filepath}`);
  return filepath;
}

// ============================================
// CLI
// ============================================

function printUsage() {
  console.log(`
Usage: npx tsx scripts/debug-pipeline/generate-trip.ts [options]

Options:
  --scenario <id>      Lancer un scénario spécifique
  --random             Générer un voyage avec des préférences aléatoires
  --all                Lancer tous les scénarios séquentiellement
  --all-and-analyze    Lancer tous les scénarios + analyser les résultats
  --pipeline <version> Version pipeline: v3 | v2-llm | v2-algorithmic (défaut: v3)
  --list               Lister tous les scénarios disponibles

Scénarios disponibles:`);

  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    console.log(`  ${id.padEnd(20)} ${scenario.name} — ${scenario.description}`);
  }
}

export interface CompleteRandomPreferencesOptions {
  randomFn?: () => number;
}

export function completeRandomPreferences(options: CompleteRandomPreferencesOptions = {}): TripPreferences {
  const partial = generateRandomPreferences({ randomFn: options.randomFn });
  return {
    origin: partial.origin ?? 'Paris',
    destination: partial.destination ?? 'Rome',
    startDate: partial.startDate ?? new Date(Date.now() + 30 * 86400000),
    durationDays: partial.durationDays ?? 5,
    transport: partial.transport ?? 'optimal',
    carRental: partial.carRental ?? false,
    groupSize: partial.groupSize ?? 2,
    groupType: partial.groupType ?? 'couple',
    budgetLevel: partial.budgetLevel ?? 'moderate',
    activities: partial.activities ?? ['culture', 'gastronomy'],
    dietary: partial.dietary ?? ['none'],
    mustSee: '',
    tripMode: partial.tripMode ?? 'precise',
    cityPlan: partial.cityPlan ?? [{ city: partial.destination ?? 'Rome', days: partial.durationDays ?? 5 }],
  };
}

export function getEnvHealth(): Record<'ANTHROPIC' | 'SERPAPI' | 'RAPIDAPI' | 'VIATOR', '✅' | '❌'> {
  return {
    ANTHROPIC: process.env.ANTHROPIC_API_KEY ? '✅' : '❌',
    SERPAPI: process.env.SERPAPI_KEY ? '✅' : '❌',
    RAPIDAPI: process.env.RAPIDAPI_KEY ? '✅' : '❌',
    VIATOR: process.env.VIATOR_API_KEY ? '✅' : '❌',
  };
}

export function assertRequiredEnv(requiredEnvs: string[] = ['ANTHROPIC_API_KEY']): void {
  const missingEnvs = requiredEnvs.filter((k) => !process.env[k]);
  if (missingEnvs.length > 0) {
    throw new Error(`Variables d'environnement manquantes: ${missingEnvs.join(', ')}`);
  }
}

type PipelineVersion = 'v3' | 'v2-llm' | 'v2-algorithmic';
const VALID_PIPELINES: PipelineVersion[] = ['v3', 'v2-llm', 'v2-algorithmic'];

function parsePipelineArg(args: string[]): PipelineVersion | null {
  const idx = args.indexOf('--pipeline');
  if (idx === -1) return null;
  const raw = args[idx + 1] as PipelineVersion | undefined;
  if (!raw || !VALID_PIPELINES.includes(raw)) return null;
  return raw;
}

async function main() {
  const args = process.argv.slice(2);
  const pipelineFromArgs = parsePipelineArg(args);
  if (args.includes('--pipeline') && !pipelineFromArgs) {
    console.error(`❌ Valeur invalide pour --pipeline. Valeurs supportées: ${VALID_PIPELINES.join(', ')}`);
    printUsage();
    process.exit(1);
  }
  if (pipelineFromArgs) {
    process.env.PIPELINE_VERSION = pipelineFromArgs;
  }

  // Check env
  try {
    assertRequiredEnv(['ANTHROPIC_API_KEY']);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    console.error('   Vérifiez votre fichier .env.local');
    process.exit(1);
  }

  console.log('🔑 ENV check:', getEnvHealth());
  console.log(`🧪 PIPELINE_VERSION=${process.env.PIPELINE_VERSION}`);

  if (args.includes('--list') || args.length === 0) {
    printUsage();
    return;
  }

  if (args.includes('--random')) {
    const prefs = completeRandomPreferences();
    const result = await generateTripRun('random', prefs);
    saveResult(result);
    return;
  }

  const scenarioIdx = args.indexOf('--scenario');
  if (scenarioIdx !== -1) {
    const scenarioId = args[scenarioIdx + 1];
    if (!scenarioId) {
      console.error('❌ Spécifiez un ID de scénario après --scenario');
      printUsage();
      process.exit(1);
    }
    const scenario = getScenario(scenarioId);
    if (!scenario) {
      console.error(`❌ Scénario inconnu: "${scenarioId}"`);
      printUsage();
      process.exit(1);
    }
    const result = await generateTripRun(scenario.id, scenario.preferences);
    saveResult(result);
    return;
  }

  if (args.includes('--all') || args.includes('--all-and-analyze')) {
    const analyze = args.includes('--all-and-analyze');
    const ids = getAllScenarioIds();
    const results: GenerationResult[] = [];

    console.log(`🔄 Lancement de ${ids.length} scénarios...\n`);

    for (const id of ids) {
      const scenario = SCENARIOS[id];
      const result = await generateTripRun(scenario.id, scenario.preferences);
      const filepath = saveResult(result);
      results.push(result);

      if (analyze && result.success) {
        console.log(`\n📊 Analyse de ${id}...`);
        // Dynamic import to avoid circular deps at startup
        const { analyzeFromFile } = await import('./analyze-trip');
        await analyzeFromFile(filepath);
      }

      console.log('');
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📋 RÉSUMÉ');
    console.log('='.repeat(70));
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);
    console.log(`✅ Succès: ${successes.length}/${results.length}`);
    if (failures.length > 0) {
      console.log(`❌ Échecs:`);
      for (const f of failures) {
        console.log(`   - ${f.scenarioId}: ${f.errorMessage}`);
      }
    }
    const totalTime = results.reduce((s, r) => s + r.durationMs, 0);
    console.log(`⏱️  Temps total: ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
    return;
  }

  console.error('❌ Option inconnue');
  printUsage();
  process.exit(1);
}

const isDirectRun = process.argv[1]?.includes('generate-trip');
if (isDirectRun) {
  main().catch((err) => {
    console.error('💥 Erreur fatale:', err);
    process.exit(1);
  });
}

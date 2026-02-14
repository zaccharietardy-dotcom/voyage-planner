#!/usr/bin/env npx tsx
/**
 * Analyseur de trips — lance les 8 analyseurs et produit un rapport
 *
 * Usage:
 *   npx tsx scripts/debug-pipeline/analyze-trip.ts results/paris-rome-4d-2026-02-09.json
 *   npx tsx scripts/debug-pipeline/analyze-trip.ts results/*.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { Trip } from '../../src/lib/types';

// Analyzers
import { analyzeSchedule } from './analyzers/schedule';
import { analyzeGeography } from './analyzers/geography';
import { analyzeBudget } from './analyzers/budget';
import { analyzeLinks } from './analyzers/links';
import { analyzeDataQuality } from './analyzers/data-quality';
import { analyzeRhythm } from './analyzers/rhythm';
import { analyzeRelevance } from './analyzers/relevance';
import { analyzeRealism } from './analyzers/realism';

// Report
import { buildReport, formatReportText, AnalysisReport } from './report';

interface GenerationResult {
  scenarioId: string;
  trip: Trip;
  preferences?: unknown;
  logs?: string[];
  warnings?: string[];
  errors?: string[];
  durationMs?: number;
  generatedAt?: string;
  success?: boolean;
  _campaign?: {
    campaignId: string;
    runId: string;
    runKind: 'scenario' | 'random';
    seed: number;
    startedAt: string;
    durationMs: number;
  };
}

function loadTripFromFile(filepath: string): { trip: Trip; scenarioId: string } {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const data: GenerationResult = JSON.parse(raw);

  if (!data.trip) {
    throw new Error(`Pas de trip dans le fichier (génération échouée ?)`);
  }

  return { trip: data.trip as Trip, scenarioId: data.scenarioId || path.basename(filepath, '.json') };
}

function analyzeTrip(trip: Trip, scenarioId: string): AnalysisReport {
  const sections = {
    schedule: analyzeSchedule(trip),
    geography: analyzeGeography(trip),
    budget: analyzeBudget(trip),
    links: analyzeLinks(trip),
    dataQuality: analyzeDataQuality(trip),
    rhythm: analyzeRhythm(trip),
    relevance: analyzeRelevance(trip),
    realism: analyzeRealism(trip),
  };

  return buildReport(trip, scenarioId, sections);
}

interface AnalyzeFromFileOptions {
  silent?: boolean;
  reportPath?: string;
}

/**
 * Analyse un fichier trip JSON et affiche le rapport.
 * Exporté pour être utilisé par generate-trip.ts en mode --all-and-analyze.
 */
export async function analyzeFromFile(filepath: string, options: AnalyzeFromFileOptions = {}): Promise<AnalysisReport> {
  const { trip, scenarioId } = loadTripFromFile(filepath);
  const report = analyzeTrip(trip, scenarioId);

  // Afficher le rapport texte
  if (!options.silent) {
    console.log(formatReportText(report));
  }

  // Sauvegarder le rapport JSON
  const reportPath = options.reportPath || filepath.replace('.json', '-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  if (!options.silent) {
    console.log(`💾 Rapport sauvegardé: ${path.basename(reportPath)}`);
  }

  return report;
}

// ============================================
// CLI
// ============================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/debug-pipeline/analyze-trip.ts <fichier(s)>

Exemples:
  npx tsx scripts/debug-pipeline/analyze-trip.ts results/paris-rome-4d-2026-02-09.json
  npx tsx scripts/debug-pipeline/analyze-trip.ts results/*.json
`);
    // Lister les fichiers disponibles dans results/
    const resultsDir = path.join(__dirname, 'results');
    if (fs.existsSync(resultsDir)) {
      const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.endsWith('-report.json'));
      if (files.length > 0) {
        console.log('Fichiers disponibles:');
        for (const f of files) {
          console.log(`  results/${f}`);
        }
      }
    }
    return;
  }

  const reports: AnalysisReport[] = [];

  for (const arg of args) {
    const filepath = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);

    if (!fs.existsSync(filepath)) {
      console.error(`❌ Fichier non trouvé: ${filepath}`);
      continue;
    }

    if (filepath.endsWith('-report.json')) {
      console.log(`⏭️  Skip rapport: ${path.basename(filepath)}`);
      continue;
    }

    try {
      const report = await analyzeFromFile(filepath);
      reports.push(report);
    } catch (err) {
      console.error(`❌ Erreur pour ${path.basename(filepath)}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Résumé si plusieurs fichiers
  if (reports.length > 1) {
    console.log('\n' + '='.repeat(70));
    console.log('📋 RÉSUMÉ MULTI-FICHIERS');
    console.log('='.repeat(70));

    for (const r of reports) {
      const emoji = r.summary.score >= 80 ? '🟢' : r.summary.score >= 50 ? '🟡' : '🔴';
      console.log(`  ${emoji} ${r.scenarioId.padEnd(25)} Score: ${r.summary.score}/100 (${r.summary.critical}C ${r.summary.warning}W ${r.summary.info}I)`);
    }

    const avgScore = reports.reduce((s, r) => s + r.summary.score, 0) / reports.length;
    console.log(`\n  Score moyen: ${Math.round(avgScore)}/100`);
  }
}

// Exécuter uniquement si appelé directement (pas importé)
const isDirectRun = process.argv[1]?.includes('analyze-trip');
if (isDirectRun) {
  main().catch((err) => {
    console.error('💥 Erreur fatale:', err);
    process.exit(1);
  });
}

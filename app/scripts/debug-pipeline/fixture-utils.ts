/**
 * fixture-utils.ts — Capture and replay FetchedData fixtures for golden tests
 *
 * Capture: save FetchedData after step 1 to fixtures/<scenarioId>.json
 * Replay:  load FetchedData from fixture, skip step 1 entirely
 *
 * Usage:
 *   PIPELINE_FIXTURE_MODE=capture npx tsx generate-trip.ts --all
 *   PIPELINE_FIXTURE_MODE=golden  npx tsx run-campaign.ts --mode golden
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FetchedData } from '../../src/lib/pipeline/types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function ensureFixturesDir(): void {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
}

/**
 * Save FetchedData as a fixture for a given scenario.
 * Dates are serialized as ISO strings.
 */
export function captureFixture(scenarioId: string, data: FetchedData): string {
  ensureFixturesDir();
  const filepath = path.join(FIXTURES_DIR, `${scenarioId}.json`);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[Fixture] Captured: ${scenarioId} → ${path.relative(process.cwd(), filepath)}`);
  return filepath;
}

/**
 * Load a FetchedData fixture for a given scenario.
 * Returns null if fixture does not exist.
 */
export function loadFixture(scenarioId: string): FetchedData | null {
  const filepath = path.join(FIXTURES_DIR, `${scenarioId}.json`);
  if (!fs.existsSync(filepath)) {
    return null;
  }
  const raw = fs.readFileSync(filepath, 'utf-8');
  const data = JSON.parse(raw) as FetchedData;
  console.log(`[Fixture] Loaded: ${scenarioId} ← ${path.relative(process.cwd(), filepath)}`);
  return data;
}

/**
 * Check if a fixture exists for a given scenario.
 */
export function hasFixture(scenarioId: string): boolean {
  const filepath = path.join(FIXTURES_DIR, `${scenarioId}.json`);
  return fs.existsSync(filepath);
}

/**
 * List all available fixture scenario IDs.
 */
export function listFixtures(): string[] {
  ensureFixturesDir();
  return fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * Get the current fixture mode from environment.
 */
export function getFixtureMode(): 'off' | 'capture' | 'golden' {
  const mode = (process.env.PIPELINE_FIXTURE_MODE || 'off').toLowerCase();
  if (mode === 'capture' || mode === 'golden') return mode;
  return 'off';
}

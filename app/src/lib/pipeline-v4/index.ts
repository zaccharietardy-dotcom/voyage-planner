/**
 * Pipeline V4 — LLM-First Orchestrator
 *
 * 1. LLM designs the complete trip (Gemini 3 Flash)
 * 2. Pipeline validates each item against real APIs
 * 3. Hotels found per hub via Booking/Airbnb
 * 4. TripDay[]/TripItem[] built in V3-compatible format
 * 5. Quality gate (contracts P0 + score)
 *
 * Fallback: if V4 fails → V3 legacy pipeline
 */

import type { Trip, TripPreferences } from '../types';
import type { OnPipelineEvent } from '../pipeline/types';
import type { GenerateTripV2Options } from '../pipeline';
import type { V4PipelineResult } from './types';
import { designTrip } from './llm-trip-designer';
import { validateItems } from './validate-items';
import { findHotelsForHubs } from './find-hotels';
import { buildTrip } from './build-trip';
import { resetApiCostTracker, getApiCostSummary } from '../services/apiCostGuard';
import { storeProfilingData } from '../services/profilingStore';

// Re-export the entry point
export type { OnPipelineEvent } from '../pipeline/types';
export type { GenerateTripV2Options } from '../pipeline';
export type { PipelineEvent } from '../pipeline/types';

function emit(onEvent: OnPipelineEvent | undefined, step: number, stepName: string, type: 'step_start' | 'step_done', durationMs?: number) {
  onEvent?.({ type, step, stepName, timestamp: Date.now(), durationMs });
}

function emitInfo(onEvent: OnPipelineEvent | undefined, label: string, detail: string) {
  onEvent?.({ type: 'info', label, detail, timestamp: Date.now() });
}

/**
 * V4 Pipeline: LLM-first trip generation
 */
export async function generateTripV4(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  options?: GenerateTripV2Options,
): Promise<Trip> {
  const startTime = Date.now();
  resetApiCostTracker();

  console.log(`[Pipeline V4] Starting LLM-first generation for "${preferences.destination}" (${preferences.durationDays} days)`);

  // Step 1: LLM designs the trip
  emit(onEvent, 1, 'LLM Trip Designer', 'step_start');
  emitInfo(onEvent, 'v4_step', 'Gemini conçoit votre voyage...');

  const { design, latencyMs: llmLatencyMs, parseAttempts } = await designTrip(
    preferences,
    (label) => emitInfo(onEvent, 'v4_progress', label),
  );

  emit(onEvent, 1, 'LLM Trip Designer', 'step_done', llmLatencyMs);
  console.log(`[Pipeline V4] Step 1: LLM designed ${design.days.length} days, ${design.hubs.length} hubs in ${llmLatencyMs}ms (${parseAttempts} attempts)`);

  // Step 2: Validate all items against real APIs
  emit(onEvent, 2, 'Validation', 'step_start');
  emitInfo(onEvent, 'v4_step', 'Vérification des lieux et restaurants...');

  const { items: validatedItems, drives: validatedDrives, latencyMs: validationLatencyMs } = await validateItems(
    design,
    (label) => emitInfo(onEvent, 'v4_progress', label),
  );

  emit(onEvent, 2, 'Validation', 'step_done', validationLatencyMs);

  // Grounding stats
  const totalItems = validatedItems.length;
  const validatedCount = validatedItems.filter(i => i.validated).length;
  const replacedCount = validatedItems.filter(i => i.source === 'fallback_replacement').length;
  const unverifiedCount = validatedItems.filter(i => !i.validated).length;
  const groundingRate = totalItems > 0 ? validatedCount / totalItems : 0;

  console.log(`[Pipeline V4] Step 2: ${validatedCount}/${totalItems} items validated (${(groundingRate * 100).toFixed(0)}%), ${replacedCount} replaced, ${unverifiedCount} unverified in ${validationLatencyMs}ms`);

  if (groundingRate < 0.5) {
    throw new Error(`V4 grounding rate too low: ${(groundingRate * 100).toFixed(0)}% (min 50%)`);
  }

  // Step 3: Find hotels per hub
  emit(onEvent, 3, 'Hotels', 'step_start');
  emitInfo(onEvent, 'v4_step', 'Recherche des hébergements...');

  // Build hub coords from validated items
  const hubCoords = new Map<string, { lat: number; lng: number }>();
  for (const item of validatedItems) {
    const day = design.days.find(d => d.day === item.dayNumber);
    if (day && !hubCoords.has(day.hub)) {
      hubCoords.set(day.hub, item.coords);
    }
  }

  const { hotels, latencyMs: hotelsLatencyMs } = await findHotelsForHubs(
    design.hubs,
    preferences,
    hubCoords,
    (label) => emitInfo(onEvent, 'v4_progress', label),
  );

  emit(onEvent, 3, 'Hotels', 'step_done', hotelsLatencyMs);
  console.log(`[Pipeline V4] Step 3: ${hotels.filter(h => h.hotel).length}/${hotels.length} hotels found in ${hotelsLatencyMs}ms`);

  // Step 4: Build Trip
  emit(onEvent, 4, 'Construction', 'step_start');
  emitInfo(onEvent, 'v4_step', 'Assemblage de votre itinéraire...');
  const buildStartMs = Date.now();

  const trip = buildTrip(design, validatedItems, validatedDrives, hotels, preferences);
  const buildLatencyMs = Date.now() - buildStartMs;

  emit(onEvent, 4, 'Construction', 'step_done', buildLatencyMs);

  // Enrich trip with V4 metadata
  trip.generationDiagnostics = {
    ...trip.generationDiagnostics,
    plannerMode: 'llm_closed_world',
    llmSchedulerUsed: true,
    validationLatencyMs: validationLatencyMs,
  } as any;

  trip.reliabilitySummary = {
    validatedCount,
    replacedCount,
    rejectedCount: unverifiedCount,
    groundingRate,
    ratioIconicLocal: { iconic: 0.6, localGem: 0.4 },
    publishable: groundingRate >= 0.5,
    gateFailures: groundingRate < 0.5 ? ['grounding_rate_low'] : [],
  } as any;

  // Total timing
  const totalTime = Date.now() - startTime;
  const costSummary = getApiCostSummary();

  console.log(`[Pipeline V4] Trip generated in ${totalTime}ms`);
  console.log(`  LLM design: ${llmLatencyMs}ms`);
  console.log(`  Validation: ${validationLatencyMs}ms`);
  console.log(`  Hotels: ${hotelsLatencyMs}ms`);
  console.log(`  Build: ${buildLatencyMs}ms`);
  console.log(`  Grounding: ${(groundingRate * 100).toFixed(0)}%`);
  console.log(`  API cost: €${costSummary.totalEur.toFixed(3)}`);

  // Store profiling
  storeProfilingData({
    timestamp: new Date().toISOString(),
    destination: preferences.destination || 'unknown',
    durationDays: preferences.durationDays || 0,
    status: 'done',
    totalElapsedMs: totalTime,
    apiTimings: [
      { label: 'LLM Trip Designer', durationMs: llmLatencyMs, status: 'ok' },
      { label: 'Item Validation', durationMs: validationLatencyMs, status: 'ok' },
      { label: 'Hotel Search', durationMs: hotelsLatencyMs, status: 'ok' },
      { label: 'Trip Build', durationMs: buildLatencyMs, status: 'ok' },
    ],
    stepTimings: [
      { step: 1, name: 'LLM Trip Designer', durationMs: llmLatencyMs },
      { step: 2, name: 'Validation', durationMs: validationLatencyMs },
      { step: 3, name: 'Hotels', durationMs: hotelsLatencyMs },
      { step: 4, name: 'Construction', durationMs: buildLatencyMs },
    ],
  });

  emitInfo(onEvent, 'complete', 'Trip generation complete!');
  return trip;
}

/**
 * V2 entry point — routes to V4 (LLM-first) with V3 fallback
 */
export async function generateTripV2(
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent,
  v2Options?: GenerateTripV2Options,
): Promise<Trip> {
  try {
    const trip = await generateTripV4(preferences, onEvent, v2Options);
    return trip;
  } catch (e) {
    console.warn('[Pipeline V4] Failed, falling back to V3:', (e as Error).message);
    emitInfo(onEvent, 'v4_fallback', `V4 failed: ${(e as Error).message}. Using classic pipeline...`);

    // Fallback to V3 legacy pipeline
    const { generateTripV2: generateTripV3Legacy } = await import('../pipeline');
    return generateTripV3Legacy(preferences, onEvent, v2Options);
  }
}

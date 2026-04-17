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
import type { PipelineQuestion, QuestionOption } from '../types/pipelineQuestions';
import type { LLMTripDesign } from './types';
import { designTrip } from './llm-trip-designer';
import { validateItems } from './validate-items';
import { findHotelsForHubs } from './find-hotels';
import { buildTrip } from './build-trip';
import { resetApiCostTracker, getApiCostSummary } from '../services/apiCostGuard';
import { resetGeminiCallCounter, getGeminiCallCount } from '../services/geminiSearch';
import { storeProfilingData } from '../services/profilingStore';
import { applyEffects } from '../pipeline/questionDetectors';
import { isProviderQuotaLikeError } from '../utils/quotaErrors';

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

function normalizeText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toCityPlanLabel(cityPlan: Array<{ city: string; days: number }>): string {
  return cityPlan.map((stage) => `${stage.city} (${stage.days}j)`).join(' → ');
}

function uniqueHubCities(design: LLMTripDesign): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const day of design.days) {
    const city = (day.hub || '').trim();
    if (!city) continue;
    const key = normalizeText(city);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(city);
  }
  return unique;
}

function computeDayCountsByCity(design: LLMTripDesign): Array<{ city: string; days: number }> {
  const counts = new Map<string, { city: string; days: number }>();
  for (const day of design.days) {
    const city = (day.hub || '').trim();
    if (!city) continue;
    const key = normalizeText(city);
    const current = counts.get(key);
    if (current) current.days += 1;
    else counts.set(key, { city, days: 1 });
  }
  return [...counts.values()].sort((a, b) => b.days - a.days);
}

function distributeDaysAcrossCities(cities: string[], totalDays: number): Array<{ city: string; days: number }> {
  const safeDays = Math.max(1, totalDays);
  const limitedCities = cities.slice(0, Math.min(cities.length, safeDays));
  if (limitedCities.length === 0) return [];
  const base = Math.floor(safeDays / limitedCities.length);
  let remainder = safeDays - base * limitedCities.length;
  return limitedCities.map((city, index) => {
    const bonus = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { city, days: Math.max(1, base + bonus + (index === 0 && base === 0 ? 1 : 0)) };
  });
}

function getRegionalScenarioOptions(
  preferences: TripPreferences,
  design: LLMTripDesign,
): QuestionOption[] {
  const dayCounts = computeDayCountsByCity(design);
  const uniqueCities = dayCounts.map((entry) => entry.city);
  const totalDays = Math.max(1, preferences.durationDays || design.days.length || 3);
  if (uniqueCities.length < 2) return [];

  const primaryCity = dayCounts[0]?.city || uniqueCities[0];
  const options: QuestionOption[] = [];

  const singleBasePlan = [{ city: primaryCity, days: totalDays }];
  options.push({
    id: 'single_base',
    label: `Base unique — ${primaryCity}`,
    subtitle: `1 hôtel · ${totalDays} nuits`,
    emoji: '🏨',
    isDefault: preferences.travelStyle === 'single_base' || totalDays <= 4,
    effect: {
      type: 'set_city_plan',
      value: singleBasePlan,
      travelStyle: 'single_base',
      scenario: 'single_base',
    },
  });

  if (totalDays >= 4) {
    const lightCities = uniqueCities.slice(0, Math.min(2, uniqueCities.length));
    const firstDays = Math.max(2, totalDays - 2);
    const secondDays = Math.max(1, totalDays - firstDays);
    const lightPlan: Array<{ city: string; days: number }> = [
      { city: lightCities[0], days: firstDays },
      { city: lightCities[1] || lightCities[0], days: secondDays },
    ];
    options.push({
      id: 'road_trip_light',
      label: 'Road trip léger',
      subtitle: toCityPlanLabel(lightPlan),
      emoji: '🚗',
      isDefault: preferences.travelStyle === 'road_trip' && totalDays <= 5,
      effect: {
        type: 'set_city_plan',
        value: lightPlan,
        travelStyle: 'road_trip',
        scenario: 'road_trip_light',
      },
    });
  }

  if (totalDays >= 5 && uniqueCities.length >= 2) {
    const balancedCities = uniqueCities.slice(0, Math.min(3, uniqueCities.length));
    const balancedPlan = distributeDaysAcrossCities(balancedCities, totalDays);
    options.push({
      id: 'road_trip_balanced',
      label: 'Road trip équilibré',
      subtitle: toCityPlanLabel(balancedPlan),
      emoji: '🧭',
      isDefault: false,
      effect: {
        type: 'set_city_plan',
        value: balancedPlan,
        travelStyle: 'road_trip',
        scenario: 'road_trip_balanced',
      },
    });
  }

  const hasDefault = options.some((option) => option.isDefault);
  if (!hasDefault && options.length > 0) {
    options[0].isDefault = true;
  }
  return options.slice(0, 3);
}

function buildRegionalHubSplitQuestion(
  preferences: TripPreferences,
  design: LLMTripDesign,
): Omit<PipelineQuestion, 'sessionId'> | null {
  const options = getRegionalScenarioOptions(preferences, design);
  if (options.length < 2) return null;
  return {
    questionId: 'regional-hub-split',
    type: 'regional_hub_split',
    title: 'Répartition villes et nuits',
    prompt: 'Avant la génération lourde, quel style de répartition tu préfères ?',
    options,
    timeoutMs: 30_000,
    metadata: {
      stage: 'pre_fetch_region',
      source: 'v4_regional_planner',
      currentHubs: computeDayCountsByCity(design),
    },
  };
}

function buildHotelStayPolicyQuestion(
  preferences: TripPreferences,
  design: LLMTripDesign,
): Omit<PipelineQuestion, 'sessionId'> | null {
  const uniqueCities = uniqueHubCities(design);
  if (uniqueCities.length < 2 && preferences.travelStyle !== 'road_trip') return null;

  const defaultPolicy = preferences.hotelStayPolicy
    || (preferences.durationDays <= 5 ? 'minimize_changes' : 'balanced');

  return {
    questionId: 'hotel-stay-policy',
    type: 'hotel_stay_policy',
    title: 'Politique hôtel',
    prompt: 'Tu veux plutôt limiter les changements d’hôtel, ou garder de la flexibilité ?',
    options: [
      {
        id: 'minimize_changes',
        label: 'Limiter les changements',
        subtitle: 'Minimum 2 nuits / hôtel quand possible',
        emoji: '🧳',
        isDefault: defaultPolicy === 'minimize_changes',
        effect: { type: 'set_hotel_policy', value: 'minimize_changes' },
      },
      {
        id: 'balanced',
        label: 'Équilibré',
        subtitle: 'Peu de changements, mais road trip possible',
        emoji: '⚖️',
        isDefault: defaultPolicy === 'balanced',
        effect: { type: 'set_hotel_policy', value: 'balanced' },
      },
      {
        id: 'flexible',
        label: 'Flexible road trip',
        subtitle: 'Plus de liberté, plus de check-in/out',
        emoji: '🚘',
        isDefault: defaultPolicy === 'flexible',
        effect: { type: 'set_hotel_policy', value: 'flexible' },
      },
    ],
    timeoutMs: 30_000,
    metadata: { stage: 'pre_fetch_region', source: 'v4_hotel_policy' },
  };
}

function buildPostDraftAdjustQuestion(): Omit<PipelineQuestion, 'sessionId'> {
  return {
    questionId: 'post-draft-adjust-v4',
    type: 'post_draft_adjust',
    title: 'Ajustement final',
    prompt: 'On garde ce plan ou tu veux un ajustement rapide sans tout regénérer ?',
    options: [
      { id: 'keep', label: 'Garder tel quel', emoji: '✅', isDefault: true, effect: { type: 'noop' } },
      { id: 'less_hotel_changes', label: "Moins de changements d'hôtel", emoji: '🏨', isDefault: false, effect: { type: 'set_hotel_policy', value: 'minimize_changes' } },
      { id: 'more_chill', label: 'Plus chill', emoji: '🌿', isDefault: false, effect: { type: 'set_preference', key: 'pace', value: 'relaxed' } },
      { id: 'more_local', label: 'Plus local', emoji: '🧭', isDefault: false, effect: { type: 'set_preference', key: 'local_bias', value: 'high' } },
    ],
    timeoutMs: 30_000,
    metadata: { stage: 'post_draft_adjust', source: 'v4_post_draft' },
  };
}

function parseHotelName(item: { type: string; title?: string; locationName?: string }): string | null {
  if (item.type !== 'checkin' && item.type !== 'checkout') return null;
  const fromTitle = (item.title || '').split('—')[1]?.trim();
  const name = fromTitle || item.locationName || '';
  return name.trim() || null;
}

function applyHotelStayPolicyToTrip(
  trip: Trip,
  policy: TripPreferences['hotelStayPolicy'],
): void {
  if (policy !== 'minimize_changes') return;
  const sortedDays = [...trip.days].sort((a, b) => a.dayNumber - b.dayNumber);
  const hotelByDay = new Map<number, string | null>();
  let carryHotel: string | null = null;

  for (const day of sortedDays) {
    const checkin = day.items.find((item) => item.type === 'checkin');
    const checkout = day.items.find((item) => item.type === 'checkout');
    const inferred: string | null =
      parseHotelName((checkin || checkout || { type: '' }) as { type: string; title?: string; locationName?: string })
      || carryHotel;
    hotelByDay.set(day.dayNumber, inferred || null);
    carryHotel = inferred || carryHotel;
  }

  for (const day of sortedDays) {
    const prev = hotelByDay.get(day.dayNumber - 1) || null;
    const current = hotelByDay.get(day.dayNumber) || null;
    const next = hotelByDay.get(day.dayNumber + 1) || null;
    day.items = day.items.filter((item) => {
      if (item.type === 'checkin') return Boolean(current && current !== prev);
      if (item.type === 'checkout') return Boolean(current && current !== next);
      return true;
    });
    day.items.forEach((item, index) => { item.orderIndex = index; });
  }
}

function applyChillAdjustment(trip: Trip): void {
  for (const day of trip.days) {
    const activityIndexes = day.items
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.type === 'activity');
    if (activityIndexes.length <= 3) continue;

    const removable = activityIndexes
      .filter((entry) => !entry.item.mustSee)
      .map((entry) => entry.index);
    while (day.items.filter((item) => item.type === 'activity').length > 3 && removable.length > 0) {
      const removeIndex = removable.pop();
      if (removeIndex === undefined) break;
      day.items.splice(removeIndex, 1);
      for (let i = 0; i < removable.length; i += 1) {
        if (removable[i] > removeIndex) removable[i] -= 1;
      }
    }
    day.items.forEach((item, index) => { item.orderIndex = index; });
  }
}

function applyLocalAdjustment(trip: Trip): void {
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'free_time') {
        item.title = 'Pause locale — Micro-découverte';
        item.description = 'Balade locale vérifiée: marché, café, point de vue ou parc à proximité.';
      }
      if (item.type === 'activity' && !item.llmContextTip) {
        item.llmContextTip = 'Privilégiez les rues secondaires autour du lieu pour une ambiance plus locale.';
      }
    }
  }
}

function applyPostDraftAdjustment(
  trip: Trip,
  selectedOptionId: string,
  preferences: TripPreferences,
): void {
  if (selectedOptionId === 'less_hotel_changes') {
    preferences.hotelStayPolicy = 'minimize_changes';
    applyHotelStayPolicyToTrip(trip, preferences.hotelStayPolicy);
    return;
  }
  if (selectedOptionId === 'more_chill') {
    preferences.pace = 'relaxed';
    applyChillAdjustment(trip);
    return;
  }
  if (selectedOptionId === 'more_local') {
    applyLocalAdjustment(trip);
  }
}

function computeNightsDistribution(
  preferences: TripPreferences,
  design: LLMTripDesign,
): Record<string, number> {
  if (Array.isArray(preferences.cityPlan) && preferences.cityPlan.length > 0) {
    return Object.fromEntries(preferences.cityPlan.map((stage) => [stage.city, stage.days]));
  }
  const byCity = computeDayCountsByCity(design);
  if (byCity.length > 0) {
    return Object.fromEntries(byCity.map((entry) => [entry.city, entry.days]));
  }
  return { [preferences.destination || 'destination']: Math.max(1, preferences.durationDays || design.days.length || 1) };
}

function countHotelMoves(trip: Trip): number {
  return trip.days.reduce((sum, day) => sum + day.items.filter((item) => item.type === 'checkin').length, 0);
}

function isTimeoutLikeErrorMessage(message: string): boolean {
  const normalized = normalizeText(message);
  return normalized.includes('timeout')
    || normalized.includes('deadline')
    || normalized.includes('trop longue')
    || normalized.includes('too long');
}

function shouldFallbackToV3(error: unknown, elapsedMs: number): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const fallbackMaxElapsedMs = Number.parseInt(process.env.PIPELINE_V4_FALLBACK_MAX_ELAPSED_MS || '150000', 10);
  const elapsedBudgetMs = Number.isFinite(fallbackMaxElapsedMs) && fallbackMaxElapsedMs > 0
    ? fallbackMaxElapsedMs
    : 150_000;

  if (isProviderQuotaLikeError(error)) return false;
  if (isTimeoutLikeErrorMessage(message)) return false;
  if (elapsedMs >= elapsedBudgetMs) return false;
  return true;
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
  resetGeminiCallCounter();
  const regionalQuestionFlow = {
    preFetchRegion: { askedCount: 0, autoDefaultCount: 0 },
    postDraftAdjust: { askedCount: 0, autoDefaultCount: 0 },
  };
  let regionalScenarioChosen: 'single_base' | 'road_trip_light' | 'road_trip_balanced' | undefined;
  let postDraftAdjustUsed = false;

  console.log(`[Pipeline V4] Starting LLM-first generation for "${preferences.destination}" (${preferences.durationDays} days)`);

  // Step 1: LLM designs the trip
  emit(onEvent, 1, 'LLM Trip Designer', 'step_start');
  emitInfo(onEvent, 'v4_step', 'Gemini conçoit votre voyage...');

  const firstDesign = await designTrip(
    preferences,
    (label) => emitInfo(onEvent, 'v4_progress', label),
  );
  let design = firstDesign.design;
  let llmLatencyMs = firstDesign.latencyMs;
  let parseAttempts = firstDesign.parseAttempts;

  if (options?.askUser) {
    const regionalHubQuestion = buildRegionalHubSplitQuestion(preferences, design);
    if (regionalHubQuestion) {
      regionalQuestionFlow.preFetchRegion.askedCount += 1;
      emitInfo(onEvent, 'question', regionalHubQuestion.title);
      const selectedOptionId = await options.askUser(regionalHubQuestion);
      const selectedOption = regionalHubQuestion.options.find((option) => option.id === selectedOptionId);
      if (selectedOption?.effect) {
        applyEffects([{ questionId: regionalHubQuestion.questionId, selectedOptionId, effect: selectedOption.effect }], preferences);
        if (selectedOption.effect.type === 'set_city_plan') {
          regionalScenarioChosen = selectedOption.effect.scenario;
          emitInfo(
            onEvent,
            'v4_progress',
            `Scénario appliqué: ${toCityPlanLabel(selectedOption.effect.value)}`
          );
          const redesign = await designTrip(
            preferences,
            (label) => emitInfo(onEvent, 'v4_progress', label),
          );
          design = redesign.design;
          llmLatencyMs += redesign.latencyMs;
          parseAttempts += redesign.parseAttempts;
        }
      }
    }

    const hotelPolicyQuestion = buildHotelStayPolicyQuestion(preferences, design);
    if (hotelPolicyQuestion) {
      regionalQuestionFlow.preFetchRegion.askedCount += 1;
      emitInfo(onEvent, 'question', hotelPolicyQuestion.title);
      const selectedOptionId = await options.askUser(hotelPolicyQuestion);
      const selectedOption = hotelPolicyQuestion.options.find((option) => option.id === selectedOptionId);
      if (selectedOption?.effect) {
        applyEffects([{ questionId: hotelPolicyQuestion.questionId, selectedOptionId, effect: selectedOption.effect }], preferences);
      }
    }
  }

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

  if (!preferences.hotelStayPolicy) {
    preferences.hotelStayPolicy = preferences.travelStyle === 'road_trip' ? 'balanced' : 'minimize_changes';
  }
  applyHotelStayPolicyToTrip(trip, preferences.hotelStayPolicy);

  const shouldAskPostDraftAdjust = Boolean(options?.askUser)
    && (uniqueHubCities(design).length > 1 || preferences.travelStyle === 'road_trip');
  if (shouldAskPostDraftAdjust && options?.askUser) {
    const postDraftQuestion = buildPostDraftAdjustQuestion();
    regionalQuestionFlow.postDraftAdjust.askedCount += 1;
    emitInfo(onEvent, 'question', postDraftQuestion.title);
    const selectedOptionId = await options.askUser(postDraftQuestion);
    if (selectedOptionId !== 'keep') {
      postDraftAdjustUsed = true;
      applyPostDraftAdjustment(trip, selectedOptionId, preferences);
    }
  }

  const nightsDistribution = computeNightsDistribution(preferences, design);
  const hotelMoveCount = countHotelMoves(trip);

  // Enrich trip with V4 metadata
  trip.generationDiagnostics = {
    ...trip.generationDiagnostics,
    plannerMode: 'llm_closed_world',
    llmSchedulerUsed: true,
    validationLatencyMs: validationLatencyMs,
    parseAttempts,
    regionalQuestionFlow,
    regionalScenarioChosen,
    questionAutoDefault: regionalQuestionFlow.preFetchRegion.autoDefaultCount + regionalQuestionFlow.postDraftAdjust.autoDefaultCount,
    hotelMoveCount,
    nightsDistribution,
    questionFlow: {
      askedCount: regionalQuestionFlow.preFetchRegion.askedCount + regionalQuestionFlow.postDraftAdjust.askedCount,
      autoDefaultCount: regionalQuestionFlow.preFetchRegion.autoDefaultCount + regionalQuestionFlow.postDraftAdjust.autoDefaultCount,
      postDraftAdjustUsed,
    },
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
  const startMs = Date.now();
  try {
    const trip = await generateTripV4(preferences, onEvent, v2Options);
    return trip;
  } catch (e) {
    const elapsedMs = Date.now() - startMs;
    if (!shouldFallbackToV3(e, elapsedMs)) {
      console.warn('[Pipeline V4] Fallback to V3 skipped:', (e as Error)?.message || e, `(elapsed: ${elapsedMs}ms)`);
      emitInfo(onEvent, 'v4_fallback_skipped', `V4 failed after ${Math.round(elapsedMs / 1000)}s. Stopping without V3 fallback.`);
      throw e;
    }

    console.warn('[Pipeline V4] Failed, falling back to V3:', (e as Error).message);
    emitInfo(onEvent, 'v4_fallback', `V4 failed: ${(e as Error).message}. Using classic pipeline...`);

    // Fallback to V3 legacy pipeline
    const { generateTripV2: generateTripV3Legacy } = await import('../pipeline');
    return generateTripV3Legacy(preferences, onEvent, v2Options);
  }
}

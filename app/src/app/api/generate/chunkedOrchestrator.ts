import { randomUUID } from 'crypto';

import type { Trip, TripPreferences } from '@/lib/types';
import type { PipelineQuestion, QuestionOption } from '@/lib/types/pipelineQuestions';
import type { LLMTripDesign, HubHotelResult } from '@/lib/pipeline-v4/types';
import type { Catalog } from '@/lib/pipeline-v4/catalog-types';
import { designTrip } from '@/lib/pipeline-v4/llm-trip-designer';
import {
  initializeValidationChunkState,
  runValidationChunk,
  type ValidationChunkState,
} from '@/lib/pipeline-v4/validate-items';
import { findHotelsForHubs } from '@/lib/pipeline-v4/find-hotels';
import { buildTrip } from '@/lib/pipeline-v4/build-trip';
import { buildCatalog, CatalogTooSparseError } from '@/lib/pipeline-v4/catalog';
import { applyEffects } from '@/lib/pipeline/questionDetectors';

function isCatalogEnabled(): boolean {
  return process.env.PIPELINE_V4_CATALOG === 'on';
}

type ChunkStage =
  | 'build_catalog'
  | 'llm_design'
  | 'pre_fetch_questions'
  | 'validate_items_chunked'
  | 'find_hotels'
  | 'build_trip'
  | 'done';

type SerializedTripPreferences = Omit<TripPreferences, 'startDate'> & { startDate: string };

interface ChunkLease {
  token: string;
  expiresAt: string;
}

interface PendingQuestionState {
  question: Omit<PipelineQuestion, 'sessionId'>;
  defaultOptionId: string;
  askedAt: string;
  expiresAt: string;
  selectedOptionId?: string;
  answeredAt?: string;
  autoDefault?: boolean;
}

interface ChunkQuestionFlow {
  regionalQuestionFlow: {
    preFetchRegion: { askedCount: number; autoDefaultCount: number };
    postDraftAdjust: { askedCount: number; autoDefaultCount: number };
  };
  askedRegionalHubSplit: boolean;
  askedHotelPolicy: boolean;
  regionalScenarioChosen?: string;
  hotelStayPolicyChosen?: string;
}

interface ChunkArtifacts {
  preferences: SerializedTripPreferences;
  design?: LLMTripDesign;
  llmLatencyMs: number;
  parseAttempts: number;
  validationState?: ValidationChunkState;
  hotels?: HubHotelResult[];
  builtTrip?: Trip;
  stageDurations: Record<string, number>;
  questionFlow: ChunkQuestionFlow;
  requestFingerprint?: string;
  catalog?: Catalog;
  catalogStats?: {
    totalEntries: number;
    entriesByCity: Record<string, number>;
    cacheHits: string[];
    cacheMisses: string[];
  };
}

export interface ChunkStageState {
  stage: ChunkStage;
  attempts: Record<string, number>;
  resumeCount: number;
  runId: string;
  updatedAt: string;
  lease?: ChunkLease | null;
  pendingQuestion?: PendingQuestionState | null;
  artifacts: ChunkArtifacts;
}

export interface ChunkRunResult {
  status: 'running' | 'question' | 'done';
  stageState: ChunkStageState;
  question?: Omit<PipelineQuestion, 'sessionId'>;
  trip?: Trip;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSerializedPreferences(preferences: TripPreferences): SerializedTripPreferences {
  return {
    ...preferences,
    startDate: preferences.startDate.toISOString(),
  };
}

function toTripPreferences(serialized: SerializedTripPreferences): TripPreferences {
  return {
    ...serialized,
    startDate: new Date(serialized.startDate),
  };
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
    const lightPlan = [
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

  if (!options.some((option) => option.isDefault) && options.length > 0) {
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
      source: 'chunked_regional_planner',
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
    metadata: { stage: 'pre_fetch_region', source: 'chunked_hotel_policy' },
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

function evaluatePublishGate(trip: Trip): {
  publishable: boolean;
  gateFailures: string[];
  result: 'publishable' | 'draft';
} {
  const score = Number(trip.qualityMetrics?.score || 0);
  const qualityViolations = Array.isArray(trip.qualityMetrics?.violations)
    ? trip.qualityMetrics.violations || []
    : [];
  const contractViolations = Array.isArray(trip.contractViolations)
    ? trip.contractViolations
    : [];
  const p0ByViolation = [...qualityViolations, ...contractViolations].some((violation) => /(^|\b)P0(\.|:)/i.test(String(violation)));
  const p0Blocking = trip.qualityMetrics?.invariantsPassed === false || p0ByViolation;

  const gateFailures: string[] = [];
  if (score < 85) gateFailures.push('score_below_85');
  if (p0Blocking) gateFailures.push('p0_blocking');

  const publishable = gateFailures.length === 0;
  return {
    publishable,
    gateFailures,
    result: publishable ? 'publishable' : 'draft',
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    }),
  ]);
}

function ensureQuestionFlow(state: ChunkStageState): ChunkQuestionFlow {
  const existing = state.artifacts.questionFlow;
  if (existing) return existing;
  const created: ChunkQuestionFlow = {
    regionalQuestionFlow: {
      preFetchRegion: { askedCount: 0, autoDefaultCount: 0 },
      postDraftAdjust: { askedCount: 0, autoDefaultCount: 0 },
    },
    askedRegionalHubSplit: false,
    askedHotelPolicy: false,
  };
  state.artifacts.questionFlow = created;
  return created;
}

function setPendingQuestion(
  state: ChunkStageState,
  question: Omit<PipelineQuestion, 'sessionId'>,
  nowMs: number,
): ChunkStageState {
  const defaultOption = question.options.find((option) => option.isDefault) || question.options[0];
  state.pendingQuestion = {
    question,
    defaultOptionId: defaultOption.id,
    askedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + question.timeoutMs).toISOString(),
  };
  return state;
}

function consumePendingQuestion(state: ChunkStageState, nowMs: number): {
  selectedOptionId: string;
  autoDefault: boolean;
} | null {
  const pending = state.pendingQuestion;
  if (!pending) return null;
  if (pending.selectedOptionId) {
    return { selectedOptionId: pending.selectedOptionId, autoDefault: Boolean(pending.autoDefault) };
  }
  const expiresAt = new Date(pending.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && nowMs >= expiresAt) {
    return { selectedOptionId: pending.defaultOptionId, autoDefault: true };
  }
  return null;
}

export function createInitialChunkStageState(
  preferences: TripPreferences,
  params: {
    runId?: string;
    requestFingerprint?: string;
  } = {},
): ChunkStageState {
  return {
    stage: isCatalogEnabled() ? 'build_catalog' : 'llm_design',
    attempts: {},
    resumeCount: 0,
    runId: params.runId || randomUUID(),
    updatedAt: nowIso(),
    lease: null,
    pendingQuestion: null,
    artifacts: {
      preferences: toSerializedPreferences(preferences),
      llmLatencyMs: 0,
      parseAttempts: 0,
      stageDurations: {},
      requestFingerprint: params.requestFingerprint,
      questionFlow: {
        regionalQuestionFlow: {
          preFetchRegion: { askedCount: 0, autoDefaultCount: 0 },
          postDraftAdjust: { askedCount: 0, autoDefaultCount: 0 },
        },
        askedRegionalHubSplit: false,
        askedHotelPolicy: false,
      },
    },
  };
}

export function getStageLabel(stage: ChunkStage): string {
  switch (stage) {
    case 'build_catalog': return 'Catalogue lieux';
    case 'llm_design': return 'Conception IA';
    case 'pre_fetch_questions': return 'Questions de cadrage';
    case 'validate_items_chunked': return 'Validation factuelle';
    case 'find_hotels': return 'Recherche hébergements';
    case 'build_trip': return 'Assemblage final';
    case 'done': return 'Terminé';
    default: return stage;
  }
}

export function toProgressPayload(
  state: ChunkStageState,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    runId: state.runId,
    label: getStageLabel(state.stage),
    stage: state.stage,
    stageState: state,
    resumeCount: state.resumeCount,
    ...extras,
  };
}

export function extractChunkStageState(progress: unknown): ChunkStageState | null {
  const stageState = (progress as any)?.stageState;
  if (!stageState || typeof stageState !== 'object') return null;
  if (!stageState.stage || !stageState.artifacts?.preferences) return null;
  return stageState as ChunkStageState;
}

export function applyAnswerToStageState(
  state: ChunkStageState,
  questionId: string,
  selectedOptionId: string,
): boolean {
  const pending = state.pendingQuestion;
  if (!pending || pending.question.questionId !== questionId) return false;
  pending.selectedOptionId = selectedOptionId;
  pending.answeredAt = nowIso();
  pending.autoDefault = false;
  return true;
}

export async function runChunkStage(
  stateInput: ChunkStageState,
  options?: {
    stageBudgetMs?: number;
  },
): Promise<ChunkRunResult> {
  const nowMs = Date.now();
  const state: ChunkStageState = JSON.parse(JSON.stringify(stateInput));
  state.updatedAt = nowIso();
  state.resumeCount = (state.resumeCount || 0) + 1;

  const stageBudgetMs = Math.max(10_000, options?.stageBudgetMs ?? 40_000);
  const stageStartedAt = Date.now();
  const preferences = toTripPreferences(state.artifacts.preferences);

  if (state.stage === 'build_catalog') {
    try {
      const result = await withTimeout(
        buildCatalog(preferences),
        stageBudgetMs,
        'build_catalog',
      );
      state.artifacts.catalog = result.catalog;
      state.artifacts.catalogStats = result.stats;
      console.log(
        `[Pipeline V4] Catalog built: ${result.stats.totalEntries} entries across ${Object.keys(result.catalog).length} cities (${result.stats.cacheHits.length} cache hits, ${result.stats.cacheMisses.length} misses)`,
      );
    } catch (err) {
      if (err instanceof CatalogTooSparseError) {
        console.warn(`[Pipeline V4] Catalog too sparse for ${err.city}, falling back to classic mode`);
        state.artifacts.catalog = undefined;
      } else {
        console.warn('[Pipeline V4] Catalog build failed, falling back to classic mode:', err);
        state.artifacts.catalog = undefined;
      }
    }
    state.stage = 'llm_design';
    state.artifacts.stageDurations.build_catalog = (state.artifacts.stageDurations.build_catalog || 0) + (Date.now() - stageStartedAt);
    return { status: 'running', stageState: state };
  }

  if (state.stage === 'llm_design') {
    const designed = await withTimeout(
      designTrip(preferences, undefined, state.artifacts.catalog),
      stageBudgetMs,
      'llm_design',
    );
    state.artifacts.design = designed.design;
    state.artifacts.llmLatencyMs += designed.latencyMs;
    state.artifacts.parseAttempts += designed.parseAttempts;
    state.stage = 'pre_fetch_questions';
    state.artifacts.stageDurations.llm_design = (state.artifacts.stageDurations.llm_design || 0) + (Date.now() - stageStartedAt);
    return { status: 'running', stageState: state };
  }

  if (state.stage === 'pre_fetch_questions') {
    if (!state.artifacts.design) {
      throw new Error('missing_design_for_questions');
    }
    const questionFlow = ensureQuestionFlow(state);
    const pendingDecision = consumePendingQuestion(state, nowMs);

    if (state.pendingQuestion && !pendingDecision) {
      state.artifacts.stageDurations.pre_fetch_questions = (state.artifacts.stageDurations.pre_fetch_questions || 0) + (Date.now() - stageStartedAt);
      return {
        status: 'question',
        stageState: state,
        question: state.pendingQuestion.question,
      };
    }

    if (pendingDecision) {
      const pending = state.pendingQuestion!;
      const selectedOption = pending.question.options.find((option) => option.id === pendingDecision.selectedOptionId);
      if (pendingDecision.autoDefault) {
        questionFlow.regionalQuestionFlow.preFetchRegion.autoDefaultCount += 1;
      }
      if (selectedOption?.effect) {
        applyEffects(
          [{
            questionId: pending.question.questionId,
            selectedOptionId: selectedOption.id,
            effect: selectedOption.effect,
          }],
          preferences,
        );

        if (pending.question.type === 'regional_hub_split') {
          questionFlow.regionalScenarioChosen = (selectedOption.effect as any)?.scenario || selectedOption.id;
        }
        if (pending.question.type === 'hotel_stay_policy') {
          questionFlow.hotelStayPolicyChosen = (selectedOption.effect as any)?.value || selectedOption.id;
        }

        if (pending.question.type === 'regional_hub_split' && selectedOption.effect.type === 'set_city_plan') {
          // City plan changed → catalog (if any) may no longer cover all hubs. Rebuild opportunistically.
          if (state.artifacts.catalog) {
            try {
              const rebuilt = await withTimeout(
                buildCatalog(preferences),
                stageBudgetMs,
                'build_catalog_redesign',
              );
              state.artifacts.catalog = rebuilt.catalog;
              state.artifacts.catalogStats = rebuilt.stats;
            } catch (err) {
              console.warn('[Pipeline V4] Catalog rebuild after city plan change failed:', err);
              state.artifacts.catalog = undefined;
            }
          }
          const redesigned = await withTimeout(
            designTrip(preferences, undefined, state.artifacts.catalog),
            stageBudgetMs,
            'llm_redesign',
          );
          state.artifacts.design = redesigned.design;
          state.artifacts.llmLatencyMs += redesigned.latencyMs;
          state.artifacts.parseAttempts += redesigned.parseAttempts;
        }
      }

      state.pendingQuestion = null;
      state.artifacts.preferences = toSerializedPreferences(preferences);
    }

    if (!questionFlow.askedRegionalHubSplit) {
      const question = buildRegionalHubSplitQuestion(preferences, state.artifacts.design);
      questionFlow.askedRegionalHubSplit = true;
      if (question) {
        questionFlow.regionalQuestionFlow.preFetchRegion.askedCount += 1;
        setPendingQuestion(state, question, nowMs);
        state.artifacts.stageDurations.pre_fetch_questions = (state.artifacts.stageDurations.pre_fetch_questions || 0) + (Date.now() - stageStartedAt);
        return { status: 'question', stageState: state, question };
      }
    }

    if (!questionFlow.askedHotelPolicy) {
      const question = buildHotelStayPolicyQuestion(preferences, state.artifacts.design);
      questionFlow.askedHotelPolicy = true;
      if (question) {
        questionFlow.regionalQuestionFlow.preFetchRegion.askedCount += 1;
        setPendingQuestion(state, question, nowMs);
        state.artifacts.stageDurations.pre_fetch_questions = (state.artifacts.stageDurations.pre_fetch_questions || 0) + (Date.now() - stageStartedAt);
        return { status: 'question', stageState: state, question };
      }
    }

    state.stage = 'validate_items_chunked';
    state.artifacts.preferences = toSerializedPreferences(preferences);
    state.artifacts.stageDurations.pre_fetch_questions = (state.artifacts.stageDurations.pre_fetch_questions || 0) + (Date.now() - stageStartedAt);
    return { status: 'running', stageState: state };
  }

  if (state.stage === 'validate_items_chunked') {
    if (!state.artifacts.design) {
      throw new Error('missing_design_for_validation');
    }

    if (!state.artifacts.validationState) {
      state.artifacts.validationState = await withTimeout(
        initializeValidationChunkState(state.artifacts.design, undefined, state.artifacts.catalog),
        stageBudgetMs,
        'validation_init',
      );
    }

    if (state.artifacts.validationState.phase !== 'done') {
      const chunk = await withTimeout(
        runValidationChunk(state.artifacts.design, state.artifacts.validationState, {
          itemBatchSize: 10,
          driveBatchSize: 6,
          catalog: state.artifacts.catalog,
        }),
        stageBudgetMs,
        'validation_chunk',
      );
      state.artifacts.validationState = chunk.state;
    }

    if (state.artifacts.validationState.phase === 'done') {
      state.stage = 'find_hotels';
    }
    state.artifacts.stageDurations.validate_items_chunked = (state.artifacts.stageDurations.validate_items_chunked || 0) + (Date.now() - stageStartedAt);
    return { status: 'running', stageState: state };
  }

  if (state.stage === 'find_hotels') {
    if (!state.artifacts.design || !state.artifacts.validationState) {
      throw new Error('missing_inputs_for_hotels');
    }
    const hubCoords = new Map(Object.entries(state.artifacts.validationState.hubCoords || {}));
    const hotelsResult = await withTimeout(
      findHotelsForHubs(
        state.artifacts.design.hubs,
        preferences,
        hubCoords,
      ),
      stageBudgetMs,
      'hotels',
    );
    state.artifacts.hotels = hotelsResult.hotels;
    state.stage = 'build_trip';
    state.artifacts.stageDurations.find_hotels = (state.artifacts.stageDurations.find_hotels || 0) + (Date.now() - stageStartedAt);
    return { status: 'running', stageState: state };
  }

  if (state.stage === 'build_trip') {
    if (!state.artifacts.design || !state.artifacts.validationState || !state.artifacts.hotels) {
      throw new Error('missing_inputs_for_build');
    }

    const validationState = state.artifacts.validationState;
    const totalItems = validationState.items.length;
    const validatedCount = validationState.items.filter((i) => i.validated).length;
    const replacedCount = validationState.items.filter((i) => i.source === 'fallback_replacement').length;
    const rejectedCount = validationState.items.filter((i) => !i.validated).length;
    const groundingRate = totalItems > 0 ? validatedCount / totalItems : 0;

    if (groundingRate < 0.5) {
      throw new Error(`grounding_rate_too_low:${groundingRate.toFixed(3)}`);
    }

    const trip = buildTrip(
      state.artifacts.design,
      validationState.items,
      validationState.drives,
      state.artifacts.hotels,
      preferences,
    );

    if (!preferences.hotelStayPolicy) {
      preferences.hotelStayPolicy = preferences.travelStyle === 'road_trip' ? 'balanced' : 'minimize_changes';
    }
    applyHotelStayPolicyToTrip(trip, preferences.hotelStayPolicy);

    const publishGate = evaluatePublishGate(trip);
    const questionFlow = ensureQuestionFlow(state);
    trip.generationDiagnostics = {
      ...(trip.generationDiagnostics || {}),
      plannerMode: 'llm_closed_world',
      llmSchedulerUsed: true,
      orchestrationMode: 'chunked',
      stageDurations: state.artifacts.stageDurations,
      attemptsByStage: state.attempts,
      resumeCount: state.resumeCount,
      timeoutAvoided: true,
      parseAttempts: state.artifacts.parseAttempts,
      questionFlow: {
        askedCount: questionFlow.regionalQuestionFlow.preFetchRegion.askedCount
          + questionFlow.regionalQuestionFlow.postDraftAdjust.askedCount,
        autoDefaultCount: questionFlow.regionalQuestionFlow.preFetchRegion.autoDefaultCount
          + questionFlow.regionalQuestionFlow.postDraftAdjust.autoDefaultCount,
        postDraftAdjustUsed: false,
      },
      regionalQuestionFlow: questionFlow.regionalQuestionFlow,
      regionalScenarioChosen: questionFlow.regionalScenarioChosen,
      questionAutoDefault: questionFlow.regionalQuestionFlow.preFetchRegion.autoDefaultCount
        + questionFlow.regionalQuestionFlow.postDraftAdjust.autoDefaultCount,
      hotelMoveCount: countHotelMoves(trip),
      nightsDistribution: computeNightsDistribution(preferences, state.artifacts.design),
      publishGateResult: publishGate.result,
      qualityGateResult: publishGate.publishable ? 'passed' : 'failed',
      qualityGateFailures: publishGate.gateFailures,
      requestFingerprint: state.artifacts.requestFingerprint,
    } as any;

    trip.reliabilitySummary = {
      ...(trip.reliabilitySummary || {}),
      validatedCount,
      replacedCount,
      rejectedCount,
      groundingRate,
      publishable: publishGate.publishable,
      gateFailures: publishGate.gateFailures,
    } as any;

    state.artifacts.preferences = toSerializedPreferences(preferences);
    state.artifacts.builtTrip = trip;
    state.stage = 'done';
    state.artifacts.stageDurations.build_trip = (state.artifacts.stageDurations.build_trip || 0) + (Date.now() - stageStartedAt);
    return { status: 'done', stageState: state, trip };
  }

  return {
    status: 'done',
    stageState: state,
    trip: state.artifacts.builtTrip,
  };
}

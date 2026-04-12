import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { generateTripV2, type PipelineEvent } from '@/lib/pipeline-v4';
import type { PipelineMapSnapshot } from '@/lib/pipeline/types';
import { TripPreferences } from '@/lib/types';
import type { PipelineQuestion } from '@/lib/types/pipelineQuestions';
import { normalizeCity } from '@/lib/services/cityNormalization';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';
import { checkAndIncrementRateLimit, type RateLimitSupabaseLike } from '@/lib/server/dbRateLimit';
import { resolveRequestAuth } from '@/lib/server/requestAuth';
import { classifyGenerationError } from '@/lib/utils/quotaErrors';
import { registerQuestion, cleanupSession } from './sessionStore';
import { upsertGenerationSession } from './sessionDb';
import { generateTripSchema } from '@/lib/validations/generate';
import {
  buildRequestFingerprint,
  evaluateAdmissionWithProviderReadiness,
  evaluateGenerationAdmission,
  getProviderReadinessSnapshot,
  registerGenerationRunCompleted,
  registerGenerationRunFailed,
  registerGenerationRunStarted,
} from './admission';
import { isProviderQuotaStopError } from '@/lib/services/providerQuotaGuard';
import { isApiBudgetExceededError } from '@/lib/services/apiCostGuard';
import { storeProfilingData } from '@/lib/services/profilingStore';

export const maxDuration = 300; // 5 minutes — Vercel Hobby plan limit

const FREE_LIFETIME_LIMIT = 1;

// Concurrency guard: one generation per user at a time (in-memory, per-instance)
const activeGenerations = new Set<string>();

interface SessionPersistPayload {
  status: 'running' | 'question' | 'done' | 'error' | 'interrupted';
  progress?: unknown;
  question?: unknown;
  trip?: unknown;
  error?: string | null;
  heartbeat?: boolean;
}

function buildProgressPayloadFromEvent(event: PipelineEvent, now: number, runId?: string): Record<string, unknown> {
  return {
    runId: runId || null,
    step: event.step ?? null,
    type: event.type ?? null,
    label: event.stepName || event.label || null,
    detail: event.detail || null,
    timestamp: event.timestamp || now,
  };
}

function evaluatePublishGate(trip: unknown): {
  publishable: boolean;
  gateFailures: string[];
  result: 'publishable' | 'draft';
} {
  const typedTrip = (trip || {}) as {
    qualityMetrics?: { score?: number; invariantsPassed?: boolean; violations?: string[] };
    contractViolations?: string[];
  };
  const score = Number(typedTrip.qualityMetrics?.score || 0);
  const qualityViolations = Array.isArray(typedTrip.qualityMetrics?.violations)
    ? typedTrip.qualityMetrics?.violations || []
    : [];
  const contractViolations = Array.isArray(typedTrip.contractViolations)
    ? typedTrip.contractViolations
    : [];
  const p0ByViolation = [...qualityViolations, ...contractViolations].some((violation) => /(^|\b)P0(\.|:)/i.test(String(violation)));
  const p0Blocking = typedTrip.qualityMetrics?.invariantsPassed === false || p0ByViolation;

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

function mapAdmissionReason(reasonCode: string): {
  message: string;
  httpStatus: number;
  action: string;
} {
  switch (reasonCode) {
    case 'cooldown_active':
      return {
        message: 'Une génération identique est déjà en cours ou vient d’être faite. Réessaie dans quelques instants.',
        httpStatus: 429,
        action: 'wait',
      };
    case 'quality_live_daily_cap':
      return {
        message: 'Cadence live atteinte pour aujourd’hui. Réessaie plus tard.',
        httpStatus: 429,
        action: 'retry_later',
      };
    case 'provider_not_ready':
      return {
        message: 'Provider indisponible ou en quota. Réessaie plus tard.',
        httpStatus: 503,
        action: 'retry_later',
      };
    case 'dedupe_hit':
      return {
        message: 'Un résultat récent existe déjà pour cette demande.',
        httpStatus: 200,
        action: 'replay',
      };
    default:
      return {
        message: 'Admission bloquée temporairement.',
        httpStatus: 429,
        action: 'wait',
      };
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function computeHotelMoveCount(trip: Record<string, unknown>): number {
  const days = Array.isArray(trip.days) ? trip.days as Array<Record<string, unknown>> : [];
  let count = 0;
  for (const day of days) {
    const items = Array.isArray(day.items) ? day.items as Array<Record<string, unknown>> : [];
    count += items.filter((item) => item?.type === 'checkin').length;
  }
  return count;
}

function computeNightsDistribution(
  preferences: TripPreferences,
  trip: Record<string, unknown>,
): Record<string, number> {
  const tripPrefs = (trip.preferences || {}) as Partial<TripPreferences>;
  const cityPlan = (tripPrefs.cityPlan || preferences.cityPlan || [])
    .filter((stage): stage is { city: string; days: number } => Boolean(stage?.city && Number.isFinite(stage?.days)));
  if (cityPlan.length > 0) {
    return Object.fromEntries(cityPlan.map((stage) => [stage.city, stage.days]));
  }
  return {
    [tripPrefs.destination || preferences.destination || 'destination']: Math.max(1, tripPrefs.durationDays || preferences.durationDays || 1),
  };
}

export async function POST(request: NextRequest) {
  let activeUserId: string | null = null;
  let requestFingerprintForError: string | null = null;
  try {
    const body = await request.json();

    // Zod validation
    const parsed = generateTripSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const validatedBody = parsed.data;

    // Check subscription quota
    const authHeader = request.headers.get('authorization');
    console.log('[generate] Auth header present:', !!authHeader, authHeader ? `prefix: ${authHeader.substring(0, 30)}...` : 'none');

    const { supabase, user, authMethod } = await resolveRequestAuth(request);
    console.log('[generate] Auth result:', { authMethod, userId: user?.id ?? 'null', hasUser: !!user });

    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié', debug: { authMethod, headerPresent: !!authHeader } },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, subscription_ends_at, extra_trips')
      .eq('id', user.id)
      .single();

    const entitlements = await fetchEntitlementsForUser(supabase, user.id);
    const billingState = deriveBillingState(profile, entitlements);

    // Persistent per-user+IP rate limit (DB-backed)
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const hourlyLimit = billingState.status === 'pro' ? 10 : 2;
    const rateLimitKey = `generate:${user.id}:${ip}`;

    const rateLimit = await checkAndIncrementRateLimit(
      supabase as unknown as RateLimitSupabaseLike,
      rateLimitKey,
      hourlyLimit,
      3600
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de générations récentes. Réessayez plus tard.', code: 'RATE_LIMIT_EXCEEDED' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds),
          },
        }
      );
    }

    if (billingState.status !== 'pro') {
      // --- Quota par compte : 1 trip gratuit à vie + extra_trips (achats unitaires) ---
      const { count: userCount } = await supabase
        .from('trips')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', user.id);

      const totalAllowed = FREE_LIFETIME_LIMIT + (profile?.extra_trips || 0);

      if (userCount !== null && userCount >= totalAllowed) {
        return NextResponse.json(
          { error: 'Votre voyage gratuit a été utilisé. Achetez un voyage ou passez à Pro.', code: 'QUOTA_EXCEEDED' },
          { status: 403 }
        );
      }
    }

    const requestFingerprint = buildRequestFingerprint(validatedBody);
    requestFingerprintForError = requestFingerprint;
    const providerReadiness = await getProviderReadinessSnapshot({
      probe: true,
    });
    const admissionCheck = evaluateAdmissionWithProviderReadiness({
      admission: evaluateGenerationAdmission({ userId: user.id, requestFingerprint }),
      providerReadiness,
    });

    if (!admissionCheck.allowed) {
      const mapped = mapAdmissionReason(admissionCheck.reasonCode);
      if (admissionCheck.reasonCode === 'dedupe_hit' && admissionCheck.replayTrip) {
        const replayTrip = cloneJson(admissionCheck.replayTrip as Record<string, unknown>);
        const replayTripAny = replayTrip as any;
        const diagnostics = (replayTrip.generationDiagnostics || {}) as Record<string, unknown>;
        replayTrip.generationDiagnostics = {
          ...diagnostics,
          admissionDecision: admissionCheck.reasonCode,
          requestFingerprint,
          fallbackReason: diagnostics.fallbackReason || 'dedupe_replay',
        };

        const encoder = new TextEncoder();
        const sessionId = admissionCheck.replaySessionId || crypto.randomUUID();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ status: 'session', sessionId })}\n\n`)
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                status: 'done',
                trip: replayTrip,
                replay: true,
                draft: replayTripAny?.reliabilitySummary?.publishable === false,
                publishGateResult: replayTripAny?.generationDiagnostics?.publishGateResult || 'unknown',
              })}\n\n`)
            );
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      return NextResponse.json(
        {
          error: mapped.message,
          code: 'ADMISSION_BLOCKED',
          reasonCode: admissionCheck.reasonCode,
          action: mapped.action,
          requestFingerprint,
          admission: {
            allowed: false,
            reasonCode: admissionCheck.reasonCode,
            cooldownSeconds: admissionCheck.cooldownRemainingMs
              ? Math.ceil(admissionCheck.cooldownRemainingMs / 1000)
              : 0,
          },
          providerReadiness,
        },
        { status: mapped.httpStatus }
      );
    }

    // Concurrency guard: one generation at a time per user
    if (activeGenerations.has(user.id)) {
      return NextResponse.json(
        { error: 'Une génération est déjà en cours. Veuillez patienter.' },
        { status: 429 }
      );
    }
    activeGenerations.add(user.id);
    activeUserId = user.id;

    // Normaliser les noms de villes
    const normalizedOrigin = await normalizeCity(validatedBody.origin);
    const normalizedDestination = await normalizeCity(validatedBody.destination);

    const preferences: TripPreferences = {
      ...validatedBody,
      origin: normalizedOrigin.displayName,
      destination: normalizedDestination.displayName,
      startDate: new Date(validatedBody.startDate),
    };

    // Streaming response: envoie des keepalive pings pendant la génération
    // pour éviter le timeout 504 de Vercel/CDN
    const sessionId = crypto.randomUUID();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const persistSession = async (payload: SessionPersistPayload) => {
          try {
            await upsertGenerationSession(supabase, user.id, sessionId, payload);
          } catch (err) {
            console.warn('[Generate] Failed to persist generation session:', err);
          }
        };
        const runId = sessionId;

        // Emit sessionId as the very first event
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ status: 'session', sessionId })}\n\n`)
          );
        } catch { /* stream closed */ }
        registerGenerationRunStarted({
          userId: user.id,
          requestFingerprint,
          sessionId,
        });
        await persistSession({
          status: 'running',
          progress: {
            step: 0,
            label: 'initializing',
            runId,
            requestFingerprint,
            admissionDecision: 'admission_allowed',
          },
        });

        // Envoyer un ping toutes les 10s pour garder la connexion vivante
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"status":"generating"}\n\n`));
            void persistSession({
              status: 'running',
              progress: { label: 'stream-alive', runId },
              heartbeat: true,
            });
          } catch {
            // stream already closed
            clearInterval(keepAlive);
          }
        }, 10_000);

        // Warning SSE before hard timeout (keep user informed on long runs)
        const warningTimeout = setTimeout(() => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'api_call', step: 99, label: 'Génération longue — veuillez patienter...', timestamp: Date.now() })}\n\n`)
            );
            void persistSession({
              status: 'running',
              progress: { step: 99, label: 'long-running', runId },
              heartbeat: true,
            });
          } catch { /* stream may be closed */ }
        }, 210_000);

        // Collect API call timings for profiling (logged on timeout or completion)
        const generationStartMs = Date.now();
        const apiTimings: Array<{ label: string; durationMs: number; status: 'ok' | 'error' }> = [];
        const stepTimings: Array<{ step: number; name: string; durationMs: number }> = [];
        const questionFlowStats = {
          askedCount: 0,
          autoDefaultCount: 0,
          postDraftAdjustUsed: false,
          regionalQuestionFlow: {
            preFetchRegion: { askedCount: 0, autoDefaultCount: 0 },
            postDraftAdjust: { askedCount: 0, autoDefaultCount: 0 },
          },
          regionalScenarioChosen: null as string | null,
          hotelStayPolicyChosen: null as string | null,
        };

        try {
          // Timeout explicite très proche de la limite Vercel (5 min),
          // pour maximiser les chances de terminer sans être kill brutalement.
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: génération trop longue (> 4min57)')), 297_000);
          });

          const configuredPipeline = process.env.PIPELINE_VERSION || 'v3';
          console.debug(`[Generate] Using pipeline ${configuredPipeline}`);
          let lastProgressPersistAt = 0;

          // Stream pipeline events to the client for real-time monitoring
          const onEvent = (event: PipelineEvent) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ status: 'progress', event })}\n\n`)
              );
            } catch { /* stream closed */ }

            // Collect profiling data from events
            if (event.type === 'api_done' && event.label) {
              apiTimings.push({
                label: event.label,
                durationMs: event.durationMs ?? 0,
                status: event.detail?.startsWith('ERROR') ? 'error' : 'ok',
              });
            }
            if (event.type === 'step_done' && event.stepName) {
              stepTimings.push({
                step: event.step ?? 0,
                name: event.stepName,
                durationMs: event.durationMs ?? 0,
              });
            }

            const now = Date.now();
            if (now - lastProgressPersistAt >= 1500) {
              lastProgressPersistAt = now;
              void persistSession({
                status: 'running',
                progress: buildProgressPayloadFromEvent(event, now, runId),
                heartbeat: true,
              });
            }
          };

          const onSnapshot = (snapshot: PipelineMapSnapshot) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ status: 'snapshot', snapshot })}\n\n`)
              );
            } catch { /* stream closed */ }
          };

          // askUser: pause pipeline, emit question via SSE, wait for answer
          const askUser = (question: Omit<PipelineQuestion, 'sessionId'>): Promise<string> => {
            const fullQuestion: PipelineQuestion = { ...question, sessionId };
            const defaultOption = question.options.find(o => o.isDefault) || question.options[0];
            questionFlowStats.askedCount += 1;
            if (question.type === 'post_draft_adjust') {
              questionFlowStats.postDraftAdjustUsed = true;
              questionFlowStats.regionalQuestionFlow.postDraftAdjust.askedCount += 1;
            }
            if (question.type === 'regional_hub_split' || question.type === 'hotel_stay_policy') {
              questionFlowStats.regionalQuestionFlow.preFetchRegion.askedCount += 1;
            }

            return new Promise<string>((resolve) => {
              void persistSession({
                status: 'question',
                progress: {
                  label: 'awaiting-answer',
                  questionId: question.questionId,
                  questionType: question.type,
                  questionStage: (question.metadata as Record<string, unknown> | undefined)?.stage || null,
                  runId,
                },
                question: fullQuestion,
                heartbeat: true,
              });
              registerQuestion(
                sessionId,
                question.questionId,
                (selectedOptionId, meta) => {
                  if (meta.autoDefault) {
                    questionFlowStats.autoDefaultCount += 1;
                    if (question.type === 'post_draft_adjust') {
                      questionFlowStats.regionalQuestionFlow.postDraftAdjust.autoDefaultCount += 1;
                    }
                    if (question.type === 'regional_hub_split' || question.type === 'hotel_stay_policy') {
                      questionFlowStats.regionalQuestionFlow.preFetchRegion.autoDefaultCount += 1;
                    }
                  }
                  const selectedOption = question.options.find((option) => option.id === selectedOptionId);
                  if (question.type === 'regional_hub_split') {
                    const effect = selectedOption?.effect;
                    questionFlowStats.regionalScenarioChosen = (effect && effect.type === 'set_city_plan' && effect.scenario)
                      ? effect.scenario
                      : selectedOptionId;
                  }
                  if (question.type === 'hotel_stay_policy') {
                    const effect = selectedOption?.effect;
                    questionFlowStats.hotelStayPolicyChosen = (effect && effect.type === 'set_hotel_policy')
                      ? effect.value
                      : selectedOptionId;
                  }
                  void persistSession({
                    status: 'running',
                    progress: {
                      label: 'question-answered',
                      questionId: question.questionId,
                      questionType: question.type,
                      questionStage: (question.metadata as Record<string, unknown> | undefined)?.stage || null,
                      runId,
                    },
                    question: null,
                    heartbeat: true,
                  });
                  resolve(selectedOptionId);
                },
                question.timeoutMs,
                defaultOption.id,
              );

              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ status: 'question', question: fullQuestion })}\n\n`)
                );
              } catch {
                // Stream closed — resolve with default immediately
                resolve(defaultOption.id);
              }
            });
          };

          const trip = await Promise.race([
            generateTripV2(preferences, onEvent, { askUser, onSnapshot, runId, enableRunTrace: true }),
            timeoutPromise
          ]) as unknown as Record<string, unknown>;

          const publishGate = evaluatePublishGate(trip);
          const hotelMoveCount = computeHotelMoveCount(trip);
          const nightsDistribution = computeNightsDistribution(preferences, trip);
          const diagnostics = ((trip.generationDiagnostics as Record<string, unknown> | undefined) || {});
          trip.generationDiagnostics = {
            ...diagnostics,
            admissionDecision: 'admission_allowed',
            requestFingerprint,
            publishGateResult: publishGate.result,
            qualityGateResult: publishGate.publishable ? 'passed' : 'failed',
            qualityGateFailures: publishGate.gateFailures,
            questionFlow: questionFlowStats,
            regionalQuestionFlow: questionFlowStats.regionalQuestionFlow,
            regionalScenarioChosen: questionFlowStats.regionalScenarioChosen || diagnostics.regionalScenarioChosen,
            questionAutoDefault: questionFlowStats.autoDefaultCount,
            hotelMoveCount,
            nightsDistribution,
            quotaStopProvider: undefined,
            budgetStopReason: undefined,
          };
          const reliability = ((trip.reliabilitySummary as Record<string, unknown> | undefined) || {});
          trip.reliabilitySummary = {
            ...reliability,
            publishable: publishGate.publishable,
            gateFailures: publishGate.gateFailures,
          };

          if (!publishGate.publishable) {
            console.warn(
              `[Generate] Quality gate failed. Returning draft-only trip. Failures: ${publishGate.gateFailures.join(' | ')}`
            );
          }

          clearInterval(keepAlive);
          clearTimeout(warningTimeout);
          activeGenerations.delete(user.id);

          // Sérialiser le trip — peut être gros (100KB+), log la taille
          let tripJson: string;
          try {
            tripJson = JSON.stringify(trip);
            console.debug(`[Generate] Trip generated, JSON size: ${(tripJson.length / 1024).toFixed(1)}KB`);
            storeProfilingData({
              timestamp: new Date().toISOString(),
              destination: preferences.destination || 'unknown',
              durationDays: preferences.durationDays || 0,
              status: 'done',
              totalElapsedMs: Date.now() - generationStartMs,
              apiTimings: [...apiTimings].sort((a, b) => b.durationMs - a.durationMs),
              stepTimings: [...stepTimings],
            });
          } catch (serializeErr) {
            console.error('[Generate] ❌ JSON.stringify(trip) failed:', serializeErr);
            controller.enqueue(encoder.encode(`data: {"status":"error","error":"Erreur de sérialisation du voyage"}\n\n`));
            controller.close();
            return;
          }

          // Envoyer le résultat final
          const finalMessage = `data: ${JSON.stringify({
            status: 'done',
            trip,
            draft: !publishGate.publishable,
            publishGateResult: publishGate.result,
          })}\n\n`;
          controller.enqueue(encoder.encode(finalMessage));
          await persistSession({
            status: 'done',
            progress: {
              label: 'completed',
              runId,
              requestFingerprint,
              publishGateResult: publishGate.result,
            },
            question: null,
            trip,
            heartbeat: true,
          });
          registerGenerationRunCompleted({
            userId: user.id,
            requestFingerprint,
            sessionId,
            trip,
          });
          // Petit délai pour s'assurer que le message est bien flush avant de fermer
          await new Promise(resolve => setTimeout(resolve, 100));
          cleanupSession(sessionId);
          controller.close();
        } catch (error) {
          clearInterval(keepAlive);
          clearTimeout(warningTimeout);
          activeGenerations.delete(user.id);
          registerGenerationRunFailed({
            userId: user.id,
            requestFingerprint,
            sessionId,
          });
          cleanupSession(sessionId);
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : '';
          const classified = classifyGenerationError(message);
          const quotaStopProvider = isProviderQuotaStopError(error) ? error.provider : undefined;
          const budgetStopReason = isApiBudgetExceededError(error) ? error.reasonCode : undefined;
          console.error('[Generate] ❌ Erreur de génération:', message);
          console.error('[Generate] Stack trace:', stack);

          // Persist profiling for GET /api/generate/profiling
          storeProfilingData({
            timestamp: new Date().toISOString(),
            destination: preferences.destination || 'unknown',
            durationDays: preferences.durationDays || 0,
            status: message.includes('Timeout') ? 'timeout' : 'error',
            totalElapsedMs: Date.now() - generationStartMs,
            apiTimings: [...apiTimings].sort((a, b) => b.durationMs - a.durationMs),
            stepTimings: [...stepTimings],
            error: message,
          });

          // Always dump profiling on error (especially timeout) so we can diagnose
          if (apiTimings.length > 0) {
            const sorted = [...apiTimings].sort((a, b) => b.durationMs - a.durationMs);
            console.log(`[Generate] ── PROFILING DUMP (${sorted.length} API calls before failure) ──`);
            for (const call of sorted) {
              console.log(`  ${call.status === 'ok' ? '✓' : '✗'} ${call.label}: ${(call.durationMs / 1000).toFixed(1)}s`);
            }
          }
          if (stepTimings.length > 0) {
            console.log(`[Generate] ── STEP TIMINGS ──`);
            for (const s of stepTimings) {
              console.log(`  Step ${s.step} (${s.name}): ${(s.durationMs / 1000).toFixed(1)}s`);
            }
          }
          Sentry.captureException(error, {
            extra: { destination: preferences.destination, origin: preferences.origin, userId: user.id },
          });

          // S'assurer que le message d'erreur est bien envoyé
          try {
            // Keep user-facing messages stable and safe for SSE.
            const safeMessage = classified.message
              .replace(/\n/g, ' ')
              .trim()
              .substring(0, 500);
            const errorPayload = {
              status: 'error',
              error: safeMessage,
              code: classified.code,
              quotaStopProvider,
              budgetStopReason,
              requestFingerprint,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorPayload)}\n\n`));
            await persistSession({
              status: 'error',
              progress: {
                label: 'failed',
                runId,
                requestFingerprint,
                quotaStopProvider,
                budgetStopReason,
              },
              error: safeMessage,
              question: null,
              heartbeat: true,
            });
          } catch (e) {
            console.error('[Generate] ❌ Erreur envoi message erreur:', e);
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    if (activeUserId) activeGenerations.delete(activeUserId);
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifyGenerationError(message);
    const quotaStopProvider = isProviderQuotaStopError(error) ? error.provider : undefined;
    const budgetStopReason = isApiBudgetExceededError(error) ? error.reasonCode : undefined;
    console.error('Erreur de génération:', message);
    Sentry.captureException(error);
    return NextResponse.json(
      {
        error: `Erreur lors de la generation du voyage: ${classified.message}`,
        code: classified.code,
        requestFingerprint: requestFingerprintForError,
        quotaStopProvider,
        budgetStopReason,
      },
      { status: classified.httpStatus }
    );
  }
}

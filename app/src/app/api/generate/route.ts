import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { generateTripV2, type PipelineEvent, type PipelineMapSnapshot } from '@/lib/pipeline';
import { TripPreferences } from '@/lib/types';
import type { PipelineQuestion } from '@/lib/types/pipelineQuestions';
import { normalizeCity } from '@/lib/services/cityNormalization';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';
import { checkAndIncrementRateLimit } from '@/lib/server/dbRateLimit';
import { resolveRequestAuth } from '@/lib/server/requestAuth';
import { registerQuestion, cleanupSession } from './sessionStore';
import { generateTripSchema } from '@/lib/validations/generate';

export const maxDuration = 300; // 5 minutes max

const FREE_LIFETIME_LIMIT = 1;

// Concurrency guard: one generation per user at a time (in-memory, per-instance)
const activeGenerations = new Set<string>();

export async function POST(request: NextRequest) {
  let activeUserId: string | null = null;
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
      supabase as any,
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
        // Emit sessionId as the very first event
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ status: 'session', sessionId })}\n\n`)
          );
        } catch { /* stream closed */ }

        // Envoyer un ping toutes les 10s pour garder la connexion vivante
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"status":"generating"}\n\n`));
          } catch {
            // stream already closed
            clearInterval(keepAlive);
          }
        }, 10_000);

        // Warning SSE at 3 minutes (before the hard 4m45 timeout)
        const warningTimeout = setTimeout(() => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'api_call', step: 99, label: 'Génération longue — veuillez patienter...', timestamp: Date.now() })}\n\n`)
            );
          } catch { /* stream may be closed */ }
        }, 180_000);

        try {
          // Timeout explicite de 4min45 (avant le timeout Vercel de 5 min)
          // pour avoir le temps de renvoyer une erreur propre
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: génération trop longue (> 4min45)')), 285_000);
          });

          const configuredPipeline = process.env.PIPELINE_VERSION || 'v3';
          console.debug(`[Generate] Using pipeline ${configuredPipeline}`);

          // Stream pipeline events to the client for real-time monitoring
          const onEvent = (event: PipelineEvent) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ status: 'progress', event })}\n\n`)
              );
            } catch { /* stream closed */ }
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

            return new Promise<string>((resolve) => {
              registerQuestion(
                sessionId,
                question.questionId,
                resolve,
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
            generateTripV2(preferences, onEvent, { askUser, onSnapshot }),
            timeoutPromise
          ]);

          clearInterval(keepAlive);
          clearTimeout(warningTimeout);
          activeGenerations.delete(user.id);

          // Sérialiser le trip — peut être gros (100KB+), log la taille
          let tripJson: string;
          try {
            tripJson = JSON.stringify(trip);
            console.debug(`[Generate] Trip generated, JSON size: ${(tripJson.length / 1024).toFixed(1)}KB`);
          } catch (serializeErr) {
            console.error('[Generate] ❌ JSON.stringify(trip) failed:', serializeErr);
            controller.enqueue(encoder.encode(`data: {"status":"error","error":"Erreur de sérialisation du voyage"}\n\n`));
            controller.close();
            return;
          }

          // Envoyer le résultat final
          const finalMessage = `data: {"status":"done","trip":${tripJson}}\n\n`;
          controller.enqueue(encoder.encode(finalMessage));
          // Petit délai pour s'assurer que le message est bien flush avant de fermer
          await new Promise(resolve => setTimeout(resolve, 100));
          cleanupSession(sessionId);
          controller.close();
        } catch (error) {
          clearInterval(keepAlive);
          clearTimeout(warningTimeout);
          activeGenerations.delete(user.id);
          cleanupSession(sessionId);
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : '';
          console.error('[Generate] ❌ Erreur de génération:', message);
          console.error('[Generate] Stack trace:', stack);
          Sentry.captureException(error, {
            extra: { destination: preferences.destination, origin: preferences.origin, userId: user.id },
          });

          // S'assurer que le message d'erreur est bien envoyé
          try {
            // Nettoyer le message pour le JSON — tronquer si trop long
            const safeMessage = message
              .replace(/"/g, '\\"')
              .replace(/\n/g, ' ')
              .substring(0, 500);
            controller.enqueue(encoder.encode(`data: {"status":"error","error":"${safeMessage}"}\n\n`));
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
    console.error('Erreur de génération:', message);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: `Erreur lors de la génération du voyage: ${message}` },
      { status: 500 }
    );
  }
}

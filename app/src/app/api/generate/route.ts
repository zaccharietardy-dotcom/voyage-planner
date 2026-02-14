import { NextRequest, NextResponse } from 'next/server';
import { generateTripWithAI } from '@/lib/ai';
import { generateTripV2, type PipelineEvent } from '@/lib/pipeline';
import { TripPreferences } from '@/lib/types';
import { normalizeCity } from '@/lib/services/cityNormalization';
import { createRouteHandlerClient } from '@/lib/supabase/server';

const USE_PIPELINE_V2 = process.env.PIPELINE_V2 !== 'false'; // V2 par défaut

export const maxDuration = 300; // 5 minutes max

const FREE_MONTHLY_LIMIT = 2;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validation basique
    if (!body.origin || !body.destination || !body.startDate) {
      return NextResponse.json(
        { error: 'Paramètres manquants: origin, destination, startDate requis' },
        { status: 400 }
      );
    }

    // Check subscription quota
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_status, extra_trips')
        .eq('id', user.id)
        .single();

      if (!profile?.subscription_status || profile.subscription_status !== 'pro') {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count } = await supabase
          .from('trips')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', user.id)
          .gte('created_at', startOfMonth.toISOString());

        const totalAllowed = FREE_MONTHLY_LIMIT + (profile?.extra_trips || 0);

        if (count !== null && count >= totalAllowed) {
          return NextResponse.json(
            { error: 'Limite de voyages gratuits atteinte. Passez à Pro pour des voyages illimités.', code: 'QUOTA_EXCEEDED' },
            { status: 403 }
          );
        }
      }
    }

    // Normaliser les noms de villes
    const normalizedOrigin = await normalizeCity(body.origin);
    const normalizedDestination = await normalizeCity(body.destination);

    const preferences: TripPreferences = {
      ...body,
      origin: normalizedOrigin.displayName,
      destination: normalizedDestination.displayName,
      startDate: new Date(body.startDate),
    };

    // Streaming response: envoie des keepalive pings pendant la génération
    // pour éviter le timeout 504 de Vercel/CDN
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Envoyer un ping toutes les 10s pour garder la connexion vivante
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"status":"generating"}\n\n`));
          } catch {
            // stream already closed
            clearInterval(keepAlive);
          }
        }, 10_000);

        try {
          // Timeout explicite de 4min45 (avant le timeout Vercel de 5 min)
          // pour avoir le temps de renvoyer une erreur propre
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: génération trop longue (> 4min45)')), 285_000);
          });

          console.log(`[Generate] Using pipeline ${USE_PIPELINE_V2 ? 'V2' : 'V1'}`);

          // Stream pipeline events to the client for real-time monitoring
          const onEvent = (event: PipelineEvent) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ status: 'progress', event })}\n\n`)
              );
            } catch { /* stream closed */ }
          };

          const trip = await Promise.race([
            USE_PIPELINE_V2
              ? generateTripV2(preferences, onEvent)
              : generateTripWithAI(preferences),
            timeoutPromise
          ]);

          clearInterval(keepAlive);

          // Sérialiser le trip — peut être gros (100KB+), log la taille
          let tripJson: string;
          try {
            tripJson = JSON.stringify(trip);
            console.log(`[Generate] ✅ Trip generated, JSON size: ${(tripJson.length / 1024).toFixed(1)}KB`);
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
          controller.close();
        } catch (error) {
          clearInterval(keepAlive);
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : '';
          console.error('[Generate] ❌ Erreur de génération:', message);
          console.error('[Generate] Stack trace:', stack);

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
    const message = error instanceof Error ? error.message : String(error);
    console.error('Erreur de génération:', message);
    return NextResponse.json(
      { error: `Erreur lors de la génération du voyage: ${message}` },
      { status: 500 }
    );
  }
}

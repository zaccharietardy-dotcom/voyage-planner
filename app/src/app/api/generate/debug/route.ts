import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/server/requestAuth';
import { readGenerationSession } from '../sessionDb';

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await resolveRequestAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const runId = request.nextUrl.searchParams.get('runId')?.trim() || '';
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim() || runId;
    if (!sessionId) {
      return NextResponse.json({ error: 'runId ou sessionId manquant' }, { status: 400 });
    }

    const session = await readGenerationSession(supabase, user.id, sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session introuvable' }, { status: 404 });
    }

    const trip = (session.trip && typeof session.trip === 'object') ? session.trip as any : null;
    const diagnostics = trip?.generationDiagnostics || null;
    const trace = diagnostics?.runTrace || trip?.runTrace || null;
    const persistedRunId = diagnostics?.runId || trace?.runId || sessionId;

    if (runId && runId !== sessionId && persistedRunId !== runId) {
      return NextResponse.json({ error: 'runId introuvable pour cette session' }, { status: 404 });
    }

    return NextResponse.json({
      runId: persistedRunId,
      sessionId: session.session_id,
      status: session.status,
      updatedAt: session.updated_at || null,
      progress: session.progress || null,
      fallbackReason: diagnostics?.fallbackReason || null,
      diagnostics,
      reliabilitySummary: trip?.reliabilitySummary || null,
      plannerDiagnostics: trip?.plannerDiagnostics || null,
      trace,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/server/requestAuth';
import { readGenerationSession, upsertGenerationSession } from '../sessionDb';

const STALE_HEARTBEAT_MS = 90_000;

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await resolveRequestAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId manquant' }, { status: 400 });
    }

    const session = await readGenerationSession(supabase, user.id, sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session introuvable' }, { status: 404 });
    }

    let status = session.status;
    let error = session.error;
    const heartbeatAt = session.heartbeat_at ? new Date(session.heartbeat_at).getTime() : 0;
    const isStale = heartbeatAt > 0 && Date.now() - heartbeatAt > STALE_HEARTBEAT_MS;
    if ((status === 'running' || status === 'question') && isStale) {
      status = 'interrupted';
      error = error || 'Session interrompue (worker indisponible ou redéployé)';
      await upsertGenerationSession(supabase, user.id, sessionId, {
        status: 'interrupted',
        progress: session.progress || {},
        question: session.question || null,
        trip: session.trip || null,
        error,
        heartbeat: false,
      });
    }

    return NextResponse.json({
      status,
      progress: session.progress || null,
      question: session.question || null,
      trip: session.trip || null,
      error: error || null,
      sessionId: session.session_id,
      heartbeatAt: session.heartbeat_at || null,
      updatedAt: session.updated_at || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


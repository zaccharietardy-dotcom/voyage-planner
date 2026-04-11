import { Trip, TripPreferences } from './types';
import type { PipelineQuestion } from './types/pipelineQuestions';

/**
 * Appelle /api/generate en streaming SSE.
 * Le serveur envoie des keepalive pings puis le résultat final.
 * Ceci évite les timeouts 504 sur Vercel (le stream maintient la connexion).
 *
 * Le message final ("done") peut être très gros (100KB+ de JSON pour un trip
 * complet) et arriver en plusieurs chunks réseau. On accumule donc le buffer
 * complet et on ne tente le parse qu'après un `\n\n` terminateur ou quand le
 * stream se ferme.
 */
export interface PipelineProgressEvent {
  type: 'step_start' | 'step_done' | 'api_call' | 'api_done' | 'info' | 'warning' | 'error';
  step?: number;
  stepName?: string;
  label?: string;
  durationMs?: number;
  detail?: string;
}

type StreamErrorPayload = {
  message: string;
  code?: string;
  gateFailures?: string[];
};

async function postQuestionAnswer(
  sessionId: string,
  questionId: string,
  selectedOptionId: string
): Promise<void> {
  const payload = { sessionId, questionId, selectedOptionId };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch('/api/generate/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return;

      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function throwStreamError(payload: StreamErrorPayload): never {
  const error = new Error(payload.message) as Error & { code?: string; gateFailures?: string[] };
  if (payload.code) error.code = payload.code;
  if (payload.gateFailures?.length) error.gateFailures = payload.gateFailures;
  throw error;
}

export async function generateTripStream(
  preferences: Partial<TripPreferences> & Record<string, unknown>,
  onProgress?: (status: string, event?: PipelineProgressEvent) => void,
  onQuestion?: (question: PipelineQuestion) => Promise<string>,
): Promise<Trip> {
  let sessionId: string | null = null;
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });

  if (!res.ok) {
    // Non-streaming error (validation, quota, etc.)
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';

  // Si c'est du JSON classique (fallback), le lire directement
  if (contentType.includes('application/json')) {
    return res.json();
  }

  // Lire le stream SSE
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Pas de stream dans la réponse');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Essayer de traiter les événements SSE complets (terminés par \n\n)
    const result = processSSEBuffer(buffer, onProgress, async (sid) => {
      sessionId = sid;
    }, async (question) => {
      if (!onQuestion || !sessionId) return;
      const selectedOptionId = await onQuestion(question);
      // POST the answer to the server
      try {
        await postQuestionAnswer(sessionId, question.questionId, selectedOptionId);
      } catch (e) {
        console.warn('[SSE] Failed to POST answer:', e);
      }
    });
    if (result.trip) return result.trip;
    if (result.error) {
      throwStreamError({
        message: result.error,
        code: result.errorCode,
        gateFailures: result.gateFailures,
      });
    }
    buffer = result.remaining;
  }

  // Stream terminé — traiter tout ce qui reste dans le buffer
  // (le serveur peut fermer le stream juste après le message final sans \n\n)
  if (buffer.trim()) {
    const result = processSSEBuffer(buffer + '\n\n', onProgress);
    if (result.trip) return result.trip;
    if (result.error) {
      throwStreamError({
        message: result.error,
        code: result.errorCode,
        gateFailures: result.gateFailures,
      });
    }

    // Dernière tentative : chercher le JSON brut du trip dans le buffer
    const tripJson = extractTripJson(buffer);
    if (tripJson) return tripJson;

    console.error('[SSE] Buffer restant non parseable:', buffer.substring(0, 500));
  }

  throw new Error('Stream terminé sans résultat');
}

/**
 * Traite les événements SSE complets dans le buffer.
 * Retourne le trip si trouvé, l'erreur si trouvée, ou le buffer restant.
 */
function processSSEBuffer(
  buffer: string,
  onProgress?: (status: string, event?: PipelineProgressEvent) => void,
  onSession?: (sessionId: string) => void,
  onQuestionEvent?: (question: PipelineQuestion) => void,
): { trip?: Trip; error?: string; errorCode?: string; gateFailures?: string[]; remaining: string } {
  // Séparer les événements SSE par \n\n (double newline = fin d'événement)
  const parts = buffer.split('\n\n');
  const remaining = parts.pop() || ''; // dernier élément = fragment non terminé

  for (const part of parts) {
    if (!part.trim()) continue;

    // Extraire le contenu après "data: " — peut être multi-ligne
    // (SSE spec: lignes multiples "data: xxx\ndata: yyy" → concaténées)
    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      const m = line.match(/^data:\s?(.*)/);
      if (m) dataLines.push(m[1]);
    }
    if (dataLines.length === 0) continue;

    const jsonStr = dataLines.join('');

    try {
      const msg = JSON.parse(jsonStr);

      if (msg.status === 'generating') {
        onProgress?.('generating');
        continue;
      }

      if (msg.status === 'session' && msg.sessionId) {
        onSession?.(msg.sessionId);
        continue;
      }

      if (msg.status === 'question' && msg.question) {
        onQuestionEvent?.(msg.question as PipelineQuestion);
        continue;
      }

      if (msg.status === 'progress' && msg.event) {
        onProgress?.('progress', msg.event as PipelineProgressEvent);
        continue;
      }

      if (msg.status === 'done' && msg.trip) {
        return { trip: msg.trip as Trip, remaining: '' };
      }

      if (msg.status === 'error') {
        return {
          error: msg.error || 'Erreur de génération',
          errorCode: typeof msg.code === 'string' ? msg.code : undefined,
          gateFailures: Array.isArray(msg.gateFailures)
            ? msg.gateFailures.filter((entry: unknown): entry is string => typeof entry === 'string')
            : undefined,
          remaining: '',
        };
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // JSON partiel ou corrompu — log et continue
        console.warn('[SSE] JSON parse failed for event, length:', jsonStr.length, 'preview:', jsonStr.substring(0, 200));
        continue;
      }
      throw e;
    }
  }

  return { remaining };
}

/**
 * Dernier recours : extraire le JSON du trip directement du buffer brut.
 * Utile si le wrapping SSE est cassé mais le JSON est présent.
 */
function extractTripJson(buffer: string): Trip | null {
  // Chercher le pattern {"status":"done","trip":{...}}
  const idx = buffer.indexOf('"trip"');
  if (idx === -1) return null;

  // Trouver le début du wrapper JSON
  const wrapStart = buffer.lastIndexOf('{', idx);
  if (wrapStart === -1) return null;

  try {
    const msg = JSON.parse(buffer.substring(wrapStart));
    if (msg.status === 'done' && msg.trip) {
      return msg.trip as Trip;
    }
  } catch {
    // Essayer de trouver juste le trip object
    const tripStart = buffer.indexOf('{', idx);
    if (tripStart === -1) return null;

    try {
      return JSON.parse(buffer.substring(tripStart)) as Trip;
    } catch {
      return null;
    }
  }

  return null;
}

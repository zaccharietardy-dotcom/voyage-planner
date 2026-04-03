import { supabase } from '@/lib/supabase/client';
import { SITE_URL } from '@/lib/constants';
import type {
  PipelineMapSnapshot,
  PipelineProgressEvent,
  PipelineQuestion,
} from '@/lib/types/pipeline';
import { api, getAuthHeaders } from './client';
import type { Trip, TripPreferences } from '@/lib/types/trip';

// ---------- Types for list items (DB row shape) ----------

export interface TripListItem {
  id: string;
  name: string | null;
  title: string | null;
  destination: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  preferences: TripPreferences | null;
  visibility: 'public' | 'friends' | 'private';
  created_at: string;
  updated_at: string;
  owner_id: string;
  // Derived on the client
  userRole?: 'owner' | 'editor' | 'viewer';
}

export interface TripRow extends TripListItem {
  data: Trip | null;
  share_code: string | null;
}

// ---------- Queries ----------

export async function fetchMyTrips(): Promise<TripListItem[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('trips')
    .select('id, name, title, destination, start_date, end_date, duration_days, preferences, visibility, created_at, updated_at, owner_id')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ ...t, userRole: 'owner' as const }));
}

export async function fetchTrip(id: string): Promise<TripRow> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data as TripRow;
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- Generation (API route — needs server-side pipeline) ----------

export interface GenerateProgress {
  step: number;
  label: string;
  total: number;
  detail?: string;
}

export interface GenerateAccessCheck {
  allowed: boolean;
  reason?: string;
  action?: 'login' | 'upgrade';
  remaining?: number;
  used?: number;
  limit?: number;
}

interface GenerateCallbacks {
  onProgress?: (progress: GenerateProgress) => void;
  onSnapshot?: (snapshot: PipelineMapSnapshot) => void;
  onQuestion?: (question: PipelineQuestion) => Promise<string>;
}

interface SSEBufferResult {
  error?: string;
  remaining: string;
  sessionId: string | null;
  trip?: Trip;
}

const PIPELINE_TOTAL_STEPS = 8;

export function buildProgressFromEvent(event: PipelineProgressEvent): GenerateProgress | null {
  if (event.type === 'step_start' && event.stepName) {
    return {
      step: event.step ?? 0,
      total: PIPELINE_TOTAL_STEPS,
      label: event.step ? `${event.step}/${PIPELINE_TOTAL_STEPS} — ${event.stepName}` : event.stepName,
      detail: event.detail,
    };
  }

  if (event.type === 'api_call' && event.label) {
    return {
      step: event.step ?? 0,
      total: PIPELINE_TOTAL_STEPS,
      label: event.label,
      detail: event.detail,
    };
  }

  if (event.label) {
    return {
      step: event.step ?? 0,
      total: PIPELINE_TOTAL_STEPS,
      label: event.label,
      detail: event.detail,
    };
  }

  return null;
}

export async function checkGenerateAccess(): Promise<GenerateAccessCheck> {
  const response = await fetch(`${SITE_URL}/api/generate/preflight`, {
    headers: await getAuthHeaders(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok && typeof payload?.allowed !== 'boolean') {
    throw new Error(payload.error || `Preflight failed (${response.status})`);
  }

  return payload as GenerateAccessCheck;
}

export async function answerGenerateQuestion(
  sessionId: string,
  questionId: string,
  selectedOptionId: string,
): Promise<void> {
  const response = await fetch(`${SITE_URL}/api/generate/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({
      sessionId,
      questionId,
      selectedOptionId,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Impossible d’envoyer votre réponse');
  }
}

async function requestGenerate(
  payload: Record<string, unknown>,
  accessToken: string,
): Promise<Response> {
  return fetch(`${SITE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function generateTrip(
  preferences: TripPreferences,
  callbacks: GenerateCallbacks = {},
): Promise<Trip> {
  // Serialize dates for JSON transport
  const payload = {
    ...preferences,
    startDate: preferences.startDate instanceof Date
      ? preferences.startDate.toISOString()
      : preferences.startDate,
  };

  // Refresh session to ensure valid token before long-running API call
  await supabase.auth.refreshSession();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('Session expirée. Veuillez vous reconnecter.');
  }

  const res = await requestGenerate(payload, token);

  if (!res.ok) {
    // 401 = token expired/invalid → try refresh once
    if (res.status === 401) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        const { data: { session: newSession } } = await supabase.auth.getSession();
        if (newSession?.access_token) {
          // Retry with fresh token
          const retry = await requestGenerate(payload, newSession.access_token);
          if (retry.ok) {
            const ct = retry.headers.get('content-type') ?? '';
            if (ct.includes('text/event-stream')) return parseSSEStream(retry, callbacks);
            return retry.json() as Promise<Trip>;
          }
        }
      }
      throw new Error('Session expirée. Déconnectez-vous et reconnectez-vous.');
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Generation failed (${res.status})`);
  }

  // The generate endpoint may stream SSE or return JSON directly.
  // Handle both cases.
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    return parseSSEStream(res, callbacks);
  }

  // Plain JSON response
  return res.json() as Promise<Trip>;
}

export async function processSSEBuffer(
  buffer: string,
  callbacks: GenerateCallbacks,
  currentSessionId: string | null,
): Promise<SSEBufferResult> {
  const parts = buffer.split('\n\n');
  const remaining = parts.pop() ?? '';
  let sessionId = currentSessionId;

  for (const part of parts) {
    if (!part.trim()) continue;

    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      const match = line.match(/^data:\s?(.*)/);
      if (match) dataLines.push(match[1]);
    }

    if (dataLines.length === 0) continue;

    const jsonStr = dataLines.join('');

    try {
      const msg = JSON.parse(jsonStr);

      if (msg.status === 'session' && msg.sessionId) {
        sessionId = msg.sessionId;
        continue;
      }

      if (msg.status === 'generating') {
        continue;
      }

      if (msg.status === 'progress' && msg.event) {
        const progress = buildProgressFromEvent(msg.event as PipelineProgressEvent);
        if (progress) {
          callbacks.onProgress?.(progress);
        }
        continue;
      }

      if (msg.status === 'snapshot' && msg.snapshot) {
        callbacks.onSnapshot?.(msg.snapshot as PipelineMapSnapshot);
        continue;
      }

      if (msg.status === 'question' && msg.question) {
        const question = msg.question as PipelineQuestion;
        const defaultOption = question.options.find((option) => option.isDefault) ?? question.options[0];
        const selectedOptionId = callbacks.onQuestion
          ? await callbacks.onQuestion(question)
          : defaultOption?.id;

        if (selectedOptionId) {
          await answerGenerateQuestion(
            sessionId ?? question.sessionId,
            question.questionId,
            selectedOptionId,
          );
        }
        continue;
      }

      if (msg.status === 'done' && msg.trip) {
        return {
          remaining: '',
          sessionId,
          trip: msg.trip as Trip,
        };
      }

      if (msg.status === 'error') {
        return {
          error: msg.error || 'Erreur de génération',
          remaining: '',
          sessionId,
        };
      }
    } catch {
      // Ignore malformed or partial events and keep consuming the stream.
    }
  }

  return {
    remaining,
    sessionId,
  };
}

async function parseSSEStream(
  res: Response,
  callbacks: GenerateCallbacks,
): Promise<Trip> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let sessionId: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const processed = await processSSEBuffer(buffer, callbacks, sessionId);
    if (processed.trip) return processed.trip;
    if (processed.error) throw new Error(processed.error);
    buffer = processed.remaining;
    sessionId = processed.sessionId;
  }

  if (buffer.trim()) {
    const processed = await processSSEBuffer(`${buffer}\n\n`, callbacks, sessionId);
    if (processed.trip) return processed.trip;
    if (processed.error) throw new Error(processed.error);
    buffer = processed.remaining;
    sessionId = processed.sessionId;
  }

  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer);
      if (msg.status === 'done' && msg.trip) {
        return msg.trip as Trip;
      }
    } catch {
      // Ignore final malformed fragment.
    }
  }

  throw new Error('Generation produced no result');
}

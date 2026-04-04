import { supabase } from '@/lib/supabase/client';
import { SITE_URL } from '@/lib/constants';
import type {
  PipelineMapSnapshot,
  PipelineProgressEvent,
  PipelineQuestion,
} from '@/lib/types/pipeline';
import { api, fetchWithAuth } from './client';
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
  try {
    const response = await fetchWithAuth(`${SITE_URL}/api/generate/preflight`);
    const payload = await response.json().catch(() => ({}));

    // Server returned a proper access check (allowed/upgrade/login) — use it
    if (typeof payload?.allowed === 'boolean') {
      return payload as GenerateAccessCheck;
    }

    // 401 without proper payload — check if user has a session
    if (response.status === 401) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        // User is authenticated but preflight rejected token — skip preflight, let generate handle it
        return { allowed: true };
      }
      // No session — user needs to log in
      return { allowed: false, action: 'login', reason: 'Connectez-vous pour générer un voyage.' };
    }

    // Other errors — don't block
    return { allowed: true };
  } catch {
    // Network error — don't block generation
    return { allowed: true };
  }
}

export async function answerGenerateQuestion(
  sessionId: string,
  questionId: string,
  selectedOptionId: string,
): Promise<void> {
  const response = await fetchWithAuth(`${SITE_URL}/api/generate/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
): Promise<Response> {
  return fetchWithAuth(`${SITE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function extractTripFromRawSSE(raw: string): Trip | null {
  const tripKeyIndex = raw.indexOf('"trip"');
  if (tripKeyIndex === -1) return null;

  const wrapperStart = raw.lastIndexOf('{', tripKeyIndex);
  if (wrapperStart === -1) return null;

  try {
    const message = JSON.parse(raw.slice(wrapperStart));
    if (message.status === 'done' && message.trip) {
      return message.trip as Trip;
    }
  } catch {
    return null;
  }

  return null;
}

async function parseSSETextFallback(
  res: Response,
  callbacks: GenerateCallbacks,
): Promise<Trip> {
  const raw = await res.text();
  const normalized = raw.endsWith('\n\n') ? raw : `${raw}\n\n`;
  const processed = await processSSEBuffer(normalized, {
    onProgress: callbacks.onProgress,
    onSnapshot: callbacks.onSnapshot,
    // A buffered fallback cannot ask questions interactively.
    onQuestion: undefined,
  }, null);

  if (processed.trip) {
    return processed.trip;
  }

  if (processed.error) {
    throw new Error(processed.error);
  }

  const extractedTrip = extractTripFromRawSSE(raw);
  if (extractedTrip) {
    return extractedTrip;
  }

  throw new Error('Generation produced no readable result');
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

  // Verify we have a valid session before calling generate
  const { data: { session: preCheckSession } } = await supabase.auth.getSession();
  if (!preCheckSession?.access_token) {
    // No local session at all — need to login
    throw new Error('Veuillez vous reconnecter — aucune session active.');
  }

  // Validate token with Supabase directly before sending to our API
  const { data: userData, error: userError } = await supabase.auth.getUser(preCheckSession.access_token);
  if (userError || !userData.user) {
    // Token exists but Supabase rejects it — try refresh
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (!refreshed.session?.access_token) {
      throw new Error('Session corrompue. Déconnectez-vous puis reconnectez-vous.');
    }
  }

  // Now call generate with fetchWithAuth (which also handles 401 retry)
  const res = await requestGenerate(payload);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const status = res.status;
    if (status === 401) {
      throw new Error('Le serveur a rejeté votre session. Déconnectez-vous de l\'app puis reconnectez-vous.');
    }
    throw new Error(err.error || `Erreur génération (${status})`);
  }

  // The generate endpoint may stream SSE or return JSON directly.
  // Handle both cases.
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    const body = res.body as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null;
    if (!body?.getReader) {
      return parseSSETextFallback(res, callbacks);
    }
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

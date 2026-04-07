type GenerationStatus = 'running' | 'question' | 'done' | 'error' | 'interrupted';

interface SessionUpdatePayload {
  status: GenerationStatus;
  progress?: unknown;
  question?: unknown;
  trip?: unknown;
  error?: string | null;
  heartbeat?: boolean;
}

interface GenerationSessionRow {
  session_id: string;
  status: GenerationStatus;
  progress: unknown;
  question: unknown;
  trip: unknown;
  error: string | null;
  heartbeat_at: string | null;
  updated_at: string | null;
}

type Awaitable<T> = PromiseLike<T> | Promise<T>;

interface GenerationSessionsTable {
  upsert: (
    row: Record<string, unknown>,
    options?: { onConflict?: string }
  ) => Awaitable<{ error: { message?: string } | null }>;
  update: (patch: Record<string, unknown>) => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => Awaitable<{ error: { message?: string } | null }>;
    };
  };
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Awaitable<{ data: GenerationSessionRow | null; error: { message?: string } | null }>;
      };
    };
  };
}

function getGenerationSessionsTable(supabase: unknown): GenerationSessionsTable {
  return (supabase as { from: (table: string) => GenerationSessionsTable }).from('generation_sessions');
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function upsertGenerationSession(
  supabase: unknown,
  userId: string,
  sessionId: string,
  payload: SessionUpdatePayload
): Promise<void> {
  const generationSessions = getGenerationSessionsTable(supabase);
  const heartbeatAt = payload.heartbeat === false ? undefined : nowIso();
  const row: Record<string, unknown> = {
    session_id: sessionId,
    user_id: userId,
    status: payload.status,
    progress: payload.progress ?? {},
    question: payload.question ?? null,
    trip: payload.trip ?? null,
    error: payload.error ?? null,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  if (heartbeatAt) row.heartbeat_at = heartbeatAt;

  const { error } = await generationSessions.upsert(row, { onConflict: 'session_id' });
  if (error) throw error;
}

export async function patchGenerationSession(
  supabase: unknown,
  userId: string,
  sessionId: string,
  payload: SessionUpdatePayload
): Promise<void> {
  const generationSessions = getGenerationSessionsTable(supabase);
  const patch: Record<string, unknown> = {
    status: payload.status,
    progress: payload.progress ?? {},
    question: payload.question ?? null,
    trip: payload.trip ?? null,
    error: payload.error ?? null,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  if (payload.heartbeat !== false) {
    patch.heartbeat_at = nowIso();
  }

  const { error } = await generationSessions
    .update(patch)
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function readGenerationSession(
  supabase: unknown,
  userId: string,
  sessionId: string
): Promise<{
  session_id: string;
  status: GenerationStatus;
  progress: unknown;
  question: unknown;
  trip: unknown;
  error: string | null;
  heartbeat_at: string | null;
  updated_at: string | null;
} | null> {
  const generationSessions = getGenerationSessionsTable(supabase);
  const { data, error } = await generationSessions
    .select('session_id,status,progress,question,trip,error,heartbeat_at,updated_at')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

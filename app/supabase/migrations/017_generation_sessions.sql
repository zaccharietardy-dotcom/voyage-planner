-- ============================================================
-- Migration 017: Durable generation sessions (SSE resume/poll)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'question', 'done', 'error', 'interrupted')),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  question JSONB,
  trip JSONB,
  error TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_id
  ON public.generation_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_status
  ON public.generation_sessions(status);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_heartbeat
  ON public.generation_sessions(heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_expires_at
  ON public.generation_sessions(expires_at);

CREATE OR REPLACE FUNCTION public.touch_generation_sessions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generation_sessions_updated_at ON public.generation_sessions;
CREATE TRIGGER trg_generation_sessions_updated_at
BEFORE UPDATE ON public.generation_sessions
FOR EACH ROW
EXECUTE FUNCTION public.touch_generation_sessions_updated_at();

ALTER TABLE public.generation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generation_sessions_select_own" ON public.generation_sessions;
CREATE POLICY "generation_sessions_select_own"
  ON public.generation_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "generation_sessions_insert_own" ON public.generation_sessions;
CREATE POLICY "generation_sessions_insert_own"
  ON public.generation_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "generation_sessions_update_own" ON public.generation_sessions;
CREATE POLICY "generation_sessions_update_own"
  ON public.generation_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


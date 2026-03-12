-- ============================================================
-- Migration 016: Persistent API rate limiting for /api/generate
-- ============================================================

CREATE TABLE IF NOT EXISTS public.generate_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generate_rate_limits_updated_at
  ON public.generate_rate_limits(updated_at);

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data public.generate_rate_limits%ROWTYPE;
  now_ts TIMESTAMPTZ := NOW();
  window_interval INTERVAL;
BEGIN
  IF p_limit <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_LIMIT';
  END IF;

  IF p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_WINDOW';
  END IF;

  window_interval := make_interval(secs => p_window_seconds);

  INSERT INTO public.generate_rate_limits (rate_key, window_start, request_count, updated_at)
  VALUES (p_key, now_ts, 0, now_ts)
  ON CONFLICT (rate_key) DO NOTHING;

  SELECT *
  INTO row_data
  FROM public.generate_rate_limits
  WHERE rate_key = p_key
  FOR UPDATE;

  IF now_ts >= (row_data.window_start + window_interval) THEN
    UPDATE public.generate_rate_limits
    SET window_start = now_ts,
        request_count = 0,
        updated_at = now_ts
    WHERE rate_key = p_key
    RETURNING * INTO row_data;
  END IF;

  reset_at := row_data.window_start + window_interval;

  IF row_data.request_count >= p_limit THEN
    allowed := false;
    remaining := 0;
    retry_after_seconds := GREATEST(
      0,
      CEIL(EXTRACT(EPOCH FROM (reset_at - now_ts)))::INTEGER
    );
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.generate_rate_limits
  SET request_count = row_data.request_count + 1,
      updated_at = now_ts
  WHERE rate_key = p_key
  RETURNING * INTO row_data;

  reset_at := row_data.window_start + window_interval;
  allowed := true;
  remaining := GREATEST(0, p_limit - row_data.request_count);
  retry_after_seconds := GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM (reset_at - now_ts)))::INTEGER
  );
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- Migration 019: Cache des plans de transport LLM
-- Utilisé par src/lib/pipeline/step4b-transport-plan.ts pour éviter de rappeler
-- Gemini 3 Flash sur chaque génération de trip pour la même paire {origin, destination, month, groupSize}.

CREATE TABLE IF NOT EXISTS transport_plan_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  origin_key TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  month TEXT NOT NULL,
  group_size INTEGER NOT NULL,
  plan JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('llm', 'fallback_table', 'fallback_places', 'fallback_heuristic')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_plan_cache_key
  ON transport_plan_cache(origin_key, destination_key, month, group_size);

CREATE INDEX IF NOT EXISTS idx_transport_plan_cache_created
  ON transport_plan_cache(created_at);

-- RLS: cache est lisible par tous les users authentifiés, écrit par le service role uniquement.
ALTER TABLE transport_plan_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY transport_plan_cache_read
  ON transport_plan_cache
  FOR SELECT
  USING (true);

CREATE POLICY transport_plan_cache_write
  ON transport_plan_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY transport_plan_cache_update
  ON transport_plan_cache
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- TTL cleanup helper (30 days). À appeler manuellement ou via pg_cron si activé.
CREATE OR REPLACE FUNCTION cleanup_expired_transport_plan_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM transport_plan_cache
  WHERE created_at < NOW() - INTERVAL '30 days'
  RETURNING 1 INTO deleted_count;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON TABLE transport_plan_cache IS 'Cache des TransportPlan générés par step4b (LLM + fallbacks). TTL 30j.';

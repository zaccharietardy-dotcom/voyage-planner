-- Migration 009: Cache des lieux vérifiés (restaurants, hôtels, attractions)
-- Remplace le cache SQLite local (Prisma) par Supabase PostgreSQL
-- pour fonctionner sur Vercel serverless

-- ============================================
-- Table places : cache des lieux vérifiés
-- ============================================
CREATE TABLE IF NOT EXISTS places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('restaurant', 'hotel', 'attraction')),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  rating DOUBLE PRECISION,
  review_count INTEGER,
  price_level INTEGER,
  stars INTEGER,
  cuisine_types JSONB,
  amenities JSONB,
  categories JSONB,
  opening_hours JSONB,
  phone TEXT,
  website TEXT,
  google_maps_url TEXT NOT NULL,
  booking_url TEXT,
  description TEXT,
  tips TEXT,
  source TEXT NOT NULL CHECK (source IN ('serpapi', 'foursquare', 'osm', 'claude', 'tripadvisor', 'gemini')),
  data_reliability TEXT NOT NULL CHECK (data_reliability IN ('verified', 'estimated', 'generated')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour recherche rapide par ville + type
CREATE INDEX idx_places_city_type ON places(city, type);
CREATE INDEX idx_places_type_verified ON places(type, verified_at);

-- Contrainte d'unicité pour upsert (external_id + source)
CREATE UNIQUE INDEX idx_places_external_source ON places(external_id, source) WHERE external_id IS NOT NULL;

-- ============================================
-- Table search_cache : cache des recherches API
-- ============================================
CREATE TABLE IF NOT EXISTS search_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_hash TEXT UNIQUE NOT NULL,
  query_type TEXT NOT NULL,
  city TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  result_count INTEGER NOT NULL DEFAULT 0,
  results JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_search_cache_city_type ON search_cache(city, query_type);
CREATE INDEX idx_search_cache_expires ON search_cache(expires_at);

-- ============================================
-- RLS : cache partagé, pas de données sensibles
-- Accessible via service_role key côté serveur
-- ============================================
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_cache ENABLE ROW LEVEL SECURITY;

-- Politique permissive pour le service role (server-side uniquement)
CREATE POLICY "Service role full access on places"
  ON places FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on search_cache"
  ON search_cache FOR ALL
  USING (true)
  WITH CHECK (true);

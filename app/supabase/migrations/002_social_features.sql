-- Migration: Add social features (visibility, likes, comments)
-- Run this in Supabase SQL Editor

-- =====================================================
-- PART 0: Add missing columns to trips table if needed
-- =====================================================

-- Add title column if it doesn't exist (default to destination)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS title TEXT;

-- Add duration_days column if it doesn't exist
ALTER TABLE trips ADD COLUMN IF NOT EXISTS duration_days INTEGER;

-- Add preferences column if it doesn't exist
ALTER TABLE trips ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';

-- =====================================================
-- PART 1: Add visibility column to trips table
-- =====================================================

-- Add visibility column if it doesn't exist
ALTER TABLE trips ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';

-- Add check constraint for visibility values (ignore error if exists)
DO $$
BEGIN
  ALTER TABLE trips ADD CONSTRAINT trips_visibility_check
    CHECK (visibility IN ('public', 'friends', 'private'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- PART 2: Create trip_likes table
-- =====================================================

CREATE TABLE IF NOT EXISTS trip_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(trip_id, user_id)
);

-- =====================================================
-- PART 3: Create trip_comments table
-- =====================================================

CREATE TABLE IF NOT EXISTS trip_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_id UUID REFERENCES trip_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- PART 4: Create indexes
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_trip_likes_trip_id ON trip_likes(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_likes_user_id ON trip_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_trip_id ON trip_comments(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_user_id ON trip_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_visibility ON trips(visibility);

-- =====================================================
-- PART 5: Trigger for updated_at on comments
-- =====================================================

CREATE OR REPLACE FUNCTION update_trip_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_trip_comments_updated_at ON trip_comments;
CREATE TRIGGER trigger_trip_comments_updated_at
  BEFORE UPDATE ON trip_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_trip_comments_updated_at();

-- =====================================================
-- PART 6: RLS Policies for trip_likes
-- =====================================================

ALTER TABLE trip_likes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid errors on re-run)
DROP POLICY IF EXISTS "Anyone can view likes on public trips" ON trip_likes;
DROP POLICY IF EXISTS "Users can view own likes" ON trip_likes;
DROP POLICY IF EXISTS "Authenticated users can like public trips" ON trip_likes;
DROP POLICY IF EXISTS "Users can unlike" ON trip_likes;

-- Create policies
CREATE POLICY "Anyone can view likes on public trips"
  ON trip_likes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trips WHERE trips.id = trip_likes.trip_id AND trips.visibility = 'public'
    )
  );

CREATE POLICY "Users can view own likes"
  ON trip_likes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can like public trips"
  ON trip_likes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM trips WHERE trips.id = trip_likes.trip_id AND trips.visibility = 'public'
    )
  );

CREATE POLICY "Users can unlike"
  ON trip_likes FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- PART 7: RLS Policies for trip_comments
-- =====================================================

ALTER TABLE trip_comments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view comments on public trips" ON trip_comments;
DROP POLICY IF EXISTS "Users can view own comments" ON trip_comments;
DROP POLICY IF EXISTS "Authenticated users can comment on public trips" ON trip_comments;
DROP POLICY IF EXISTS "Users can update own comments" ON trip_comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON trip_comments;

-- Create policies
CREATE POLICY "Anyone can view comments on public trips"
  ON trip_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trips WHERE trips.id = trip_comments.trip_id AND trips.visibility = 'public'
    )
  );

CREATE POLICY "Users can view own comments"
  ON trip_comments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can comment on public trips"
  ON trip_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM trips WHERE trips.id = trip_comments.trip_id AND trips.visibility = 'public'
    )
  );

CREATE POLICY "Users can update own comments"
  ON trip_comments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments"
  ON trip_comments FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- PART 8: View for public trips
-- NOTE: Uses COALESCE to handle NULL title/duration_days
-- =====================================================

DROP VIEW IF EXISTS public_trips;
CREATE VIEW public_trips AS
SELECT
  t.id,
  t.owner_id,
  COALESCE(t.title, t.destination) as title,
  t.destination,
  t.start_date,
  COALESCE(t.duration_days, (t.data->>'durationDays')::integer, 1) as duration_days,
  t.data,
  t.visibility,
  t.created_at,
  t.updated_at,
  p.display_name as owner_name,
  p.avatar_url as owner_avatar,
  (SELECT COUNT(*) FROM trip_likes WHERE trip_id = t.id) as likes_count,
  (SELECT COUNT(*) FROM trip_comments WHERE trip_id = t.id) as comments_count
FROM trips t
JOIN profiles p ON t.owner_id = p.id
WHERE t.visibility = 'public';

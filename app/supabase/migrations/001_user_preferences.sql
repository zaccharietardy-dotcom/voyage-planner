-- Migration: Create user_preferences table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,

  -- Préférences de voyage
  favorite_activities TEXT[] DEFAULT '{}',
  travel_style TEXT DEFAULT 'balanced', -- 'adventurous', 'relaxed', 'cultural', 'party', 'balanced'
  budget_preference TEXT DEFAULT 'moderate', -- 'budget', 'moderate', 'comfort', 'luxury'
  accommodation_preference TEXT DEFAULT 'hotel', -- 'hostel', 'hotel', 'airbnb', 'luxury'
  pace_preference TEXT DEFAULT 'moderate', -- 'relaxed', 'moderate', 'intense'

  -- Préférences alimentaires
  dietary_restrictions TEXT[] DEFAULT '{}', -- 'vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free'
  cuisine_preferences TEXT[] DEFAULT '{}', -- 'local', 'international', 'street_food', 'fine_dining'
  allergies TEXT[] DEFAULT '{}',

  -- Accessibilité
  accessibility_needs TEXT[] DEFAULT '{}', -- 'wheelchair', 'limited_mobility', 'visual', 'hearing'

  -- Préférences générales
  preferred_language TEXT DEFAULT 'fr',
  preferred_currency TEXT DEFAULT 'EUR',
  wake_up_time TEXT DEFAULT 'normal', -- 'early', 'normal', 'late'

  -- Métadonnées
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour les requêtes rapides
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists before creating
DROP TRIGGER IF EXISTS trigger_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trigger_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_updated_at();

-- RLS Policies
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid errors on re-run)
DROP POLICY IF EXISTS "Users can read own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can delete own preferences" ON user_preferences;

-- Users can read their own preferences
CREATE POLICY "Users can read own preferences"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own preferences
CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own preferences
CREATE POLICY "Users can delete own preferences"
  ON user_preferences FOR DELETE
  USING (auth.uid() = user_id);

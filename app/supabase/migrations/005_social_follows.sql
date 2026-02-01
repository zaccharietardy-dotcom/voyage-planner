-- =====================================================
-- Migration 005: Social follows + close friends system
-- =====================================================

-- Follows table (public, unidirectional - like Instagram)
CREATE TABLE IF NOT EXISTS follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- Close friends table (mutual, requires acceptance)
CREATE TABLE IF NOT EXISTS close_friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE(requester_id, target_id),
  CHECK (requester_id != target_id)
);

CREATE INDEX IF NOT EXISTS idx_close_friends_target ON close_friends(target_id, status);

-- Add social columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS followers_count INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS following_count INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trips_count INTEGER DEFAULT 0;

-- Trip photos table
CREATE TABLE IF NOT EXISTS trip_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  caption TEXT,
  latitude FLOAT,
  longitude FLOAT,
  location_name TEXT,
  day_number INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  taken_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_photos_trip ON trip_photos(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_photos_geo ON trip_photos(latitude, longitude);

-- Trip cloning support
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cloned_from UUID REFERENCES trips(id) ON DELETE SET NULL;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS clone_count INTEGER DEFAULT 0;

-- RLS Policies for follows
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all follows" ON follows
  FOR SELECT USING (true);

CREATE POLICY "Users can follow others" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

-- RLS Policies for close_friends
ALTER TABLE close_friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their close friend requests" ON close_friends
  FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = target_id);

CREATE POLICY "Users can send close friend requests" ON close_friends
  FOR INSERT WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Users can respond to requests targeting them" ON close_friends
  FOR UPDATE USING (auth.uid() = target_id);

CREATE POLICY "Users can remove close friend relationships" ON close_friends
  FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = target_id);

-- RLS Policies for trip_photos
ALTER TABLE trip_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public photos visible to all" ON trip_photos
  FOR SELECT USING (
    visibility = 'public'
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM trip_members
      WHERE trip_members.trip_id = trip_photos.trip_id
      AND trip_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Trip members can upload photos" ON trip_photos
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM trip_members
      WHERE trip_members.trip_id = trip_photos.trip_id
      AND trip_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Photo owners can update their photos" ON trip_photos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Photo owners can delete their photos" ON trip_photos
  FOR DELETE USING (auth.uid() = user_id);

-- Function to update follower counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.following_id;
    UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trigger_update_follow_counts
AFTER INSERT OR DELETE ON follows
FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Function to update trip count
CREATE OR REPLACE FUNCTION update_trip_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET trips_count = trips_count + 1 WHERE id = NEW.owner_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET trips_count = GREATEST(0, trips_count - 1) WHERE id = OLD.owner_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trigger_update_trip_count
AFTER INSERT OR DELETE ON trips
FOR EACH ROW EXECUTE FUNCTION update_trip_count();

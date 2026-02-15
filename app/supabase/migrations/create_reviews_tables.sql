-- Create place_reviews table
CREATE TABLE IF NOT EXISTS place_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  activity_title TEXT NOT NULL,
  city TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tips TEXT,
  photos TEXT[],
  visit_date TIMESTAMPTZ,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create review_helpful table (tracks which users marked reviews as helpful)
CREATE TABLE IF NOT EXISTS review_helpful (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES place_reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(review_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_place_reviews_place_id ON place_reviews(place_id);
CREATE INDEX IF NOT EXISTS idx_place_reviews_city ON place_reviews(city);
CREATE INDEX IF NOT EXISTS idx_place_reviews_user_id ON place_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_place_reviews_rating ON place_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_place_reviews_helpful_count ON place_reviews(helpful_count);
CREATE INDEX IF NOT EXISTS idx_place_reviews_created_at ON place_reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_review_helpful_review_id ON review_helpful(review_id);
CREATE INDEX IF NOT EXISTS idx_review_helpful_user_id ON review_helpful(user_id);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at on place_reviews
DROP TRIGGER IF EXISTS update_place_reviews_updated_at ON place_reviews;
CREATE TRIGGER update_place_reviews_updated_at
  BEFORE UPDATE ON place_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE place_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_helpful ENABLE ROW LEVEL SECURITY;

-- RLS Policies for place_reviews
-- Anyone can read reviews
CREATE POLICY "Anyone can read reviews"
  ON place_reviews FOR SELECT
  USING (true);

-- Authenticated users can create reviews
CREATE POLICY "Authenticated users can create reviews"
  ON place_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own reviews
CREATE POLICY "Users can update their own reviews"
  ON place_reviews FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own reviews
CREATE POLICY "Users can delete their own reviews"
  ON place_reviews FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for review_helpful
-- Anyone can read helpful votes
CREATE POLICY "Anyone can read helpful votes"
  ON review_helpful FOR SELECT
  USING (true);

-- Authenticated users can add helpful votes
CREATE POLICY "Authenticated users can add helpful votes"
  ON review_helpful FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own helpful votes
CREATE POLICY "Users can delete their own helpful votes"
  ON review_helpful FOR DELETE
  USING (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE place_reviews IS 'User reviews for places and activities';
COMMENT ON TABLE review_helpful IS 'Tracks which users found reviews helpful';
COMMENT ON COLUMN place_reviews.place_id IS 'Normalized identifier for the place (e.g., louvre-paris)';
COMMENT ON COLUMN place_reviews.trip_id IS 'Optional link to trip (for verified visits)';
COMMENT ON COLUMN place_reviews.rating IS 'Rating from 1 to 5 stars';
COMMENT ON COLUMN place_reviews.helpful_count IS 'Number of users who found this review helpful';

-- Migration: trip_chat_messages
-- Description: Table pour stocker l'historique des conversations du chatbot de modification d'itinéraire

-- Create the trip_chat_messages table
CREATE TABLE IF NOT EXISTS trip_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  intent JSONB,
  changes_applied JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_trip ON trip_chat_messages(trip_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON trip_chat_messages(user_id);

-- Enable RLS
ALTER TABLE trip_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can view messages for trips they own or are members of
CREATE POLICY "Users can view trip chat messages"
  ON trip_chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_chat_messages.trip_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM trip_members tm
          WHERE tm.trip_id = t.id
          AND tm.user_id = auth.uid()
        )
      )
    )
  );

-- Users can insert messages for trips they own or are editors of
CREATE POLICY "Users can insert trip chat messages"
  ON trip_chat_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_chat_messages.trip_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM trip_members tm
          WHERE tm.trip_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role IN ('owner', 'editor')
        )
      )
    )
  );

-- Users can update their own messages (for changes_applied field)
CREATE POLICY "Users can update their own chat messages"
  ON trip_chat_messages
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_chat_messages.trip_id
      AND t.owner_id = auth.uid()
    )
  );

-- Grant permissions
GRANT ALL ON trip_chat_messages TO authenticated;

-- Comment
COMMENT ON TABLE trip_chat_messages IS 'Stores chat messages for the AI-powered itinerary modification chatbot';
COMMENT ON COLUMN trip_chat_messages.intent IS 'The classified intent of the user message (JSON with type, confidence, parameters)';
COMMENT ON COLUMN trip_chat_messages.changes_applied IS 'Changes that were applied after user confirmation (JSON array of TripChange objects)';

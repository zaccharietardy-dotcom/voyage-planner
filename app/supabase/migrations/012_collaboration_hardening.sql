-- ============================================================
-- Migration 012: Core collaboration hardening (Proposals First)
-- ============================================================

-- 1) Remove permissive share-code trip policy.
-- Join by code must be handled through backend API checks.
DROP POLICY IF EXISTS "Anyone can view trips by share code" ON public.trips;

-- 2) Enable RLS on collaboration tables.
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- 2a) Backward-compat: ensure proposals.author_id exists on legacy schemas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals'
      AND column_name = 'author_id'
  ) THEN
    ALTER TABLE public.proposals ADD COLUMN author_id UUID;
  END IF;
END $$;

-- Backfill author_id from known legacy columns when available.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'UPDATE public.proposals SET author_id = user_id WHERE author_id IS NULL';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals'
      AND column_name = 'created_by'
  ) THEN
    EXECUTE 'UPDATE public.proposals SET author_id = created_by WHERE author_id IS NULL';
  END IF;
END $$;

-- Final fallback for historical rows: use trip owner.
UPDATE public.proposals p
SET author_id = t.owner_id
FROM public.trips t
WHERE p.trip_id = t.id
  AND p.author_id IS NULL;

-- Add FK if absent (keeps migration idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proposals_author_id_fkey'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_author_id_fkey
      FOREIGN KEY (author_id) REFERENCES public.profiles(id);
  END IF;
END $$;

-- 2b) Tighten trip member policies for invite/role flow.
DROP POLICY IF EXISTS "Trip members can view members" ON public.trip_members;
DROP POLICY IF EXISTS "Authenticated users can join trips" ON public.trip_members;
DROP POLICY IF EXISTS "Trip owner can insert members" ON public.trip_members;
DROP POLICY IF EXISTS "Trip owner can update member roles" ON public.trip_members;

CREATE POLICY "Trip members can view members"
  ON public.trip_members FOR SELECT
  USING (public.is_trip_member_or_owner(trip_id, auth.uid()));

CREATE POLICY "Trip owner can insert members"
  ON public.trip_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_members.trip_id
        AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY "Trip owner can update member roles"
  ON public.trip_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_members.trip_id
        AND t.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_members.trip_id
        AND t.owner_id = auth.uid()
    )
  );

-- 3) Proposals policies
DROP POLICY IF EXISTS "Trip members can view proposals" ON public.proposals;
DROP POLICY IF EXISTS "Trip members can insert proposals" ON public.proposals;
DROP POLICY IF EXISTS "Trip members can update proposals" ON public.proposals;

CREATE POLICY "Trip members can view proposals"
  ON public.proposals FOR SELECT
  USING (public.is_trip_member_or_owner(trip_id, auth.uid()));

CREATE POLICY "Editors or owner can create proposals"
  ON public.proposals FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    AND (
      EXISTS (
        SELECT 1
        FROM public.trips t
        WHERE t.id = proposals.trip_id
          AND t.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.trip_members tm
        WHERE tm.trip_id = proposals.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role = 'editor'
      )
    )
  );

CREATE POLICY "Editors or owner can update proposals"
  ON public.proposals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = proposals.trip_id
        AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.trip_members tm
      WHERE tm.trip_id = proposals.trip_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'editor'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = proposals.trip_id
        AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.trip_members tm
      WHERE tm.trip_id = proposals.trip_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'editor'
    )
  );

-- 4) Votes policies
DROP POLICY IF EXISTS "Trip members can view votes" ON public.votes;
DROP POLICY IF EXISTS "Editors can insert votes" ON public.votes;
DROP POLICY IF EXISTS "Editors can update votes" ON public.votes;

CREATE POLICY "Trip members can view votes"
  ON public.votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.proposals p
      WHERE p.id = votes.proposal_id
        AND public.is_trip_member_or_owner(p.trip_id, auth.uid())
    )
  );

CREATE POLICY "Editors can insert votes"
  ON public.votes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.proposals p
      JOIN public.trip_members tm ON tm.trip_id = p.trip_id
      WHERE p.id = votes.proposal_id
        AND p.status = 'pending'
        AND p.author_id <> auth.uid()
        AND tm.user_id = auth.uid()
        AND tm.role = 'editor'
    )
  );

CREATE POLICY "Editors can update votes"
  ON public.votes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.proposals p
      JOIN public.trip_members tm ON tm.trip_id = p.trip_id
      WHERE p.id = votes.proposal_id
        AND p.status = 'pending'
        AND p.author_id <> auth.uid()
        AND tm.user_id = auth.uid()
        AND tm.role = 'editor'
    )
  );

-- 5) Activity log policies
DROP POLICY IF EXISTS "Trip members can view activity log" ON public.activity_log;
DROP POLICY IF EXISTS "Trip members can insert activity log" ON public.activity_log;

CREATE POLICY "Trip members can view activity log"
  ON public.activity_log FOR SELECT
  USING (public.is_trip_member_or_owner(trip_id, auth.uid()));

CREATE POLICY "Trip members can insert activity log"
  ON public.activity_log FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member_or_owner(trip_id, auth.uid())
  );

-- 6) Harden conversation participant inserts.
-- Prevent non-participants from self-adding to existing conversations.
DROP POLICY IF EXISTS "Users can add participants to their conversations" ON public.conversation_participants;
DROP POLICY IF EXISTS "Authenticated users can add participants" ON public.conversation_participants;

CREATE POLICY "Participants can add users to their conversations"
  ON public.conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      auth.uid() = user_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.conversation_participants existing
        WHERE existing.conversation_id = conversation_participants.conversation_id
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_participants.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

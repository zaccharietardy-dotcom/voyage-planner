-- Migration: Shared Expenses System (Tricount-like)
-- Adds expenses tracking, splits, and settlements for trip members

-- =====================================================
-- PART 0: Create trip_members if it doesn't exist
-- =====================================================
CREATE TABLE IF NOT EXISTS trip_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_members_trip ON trip_members(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);

ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;

-- RLS for trip_members (idempotent)
DROP POLICY IF EXISTS "Trip members can view members" ON trip_members;
CREATE POLICY "Trip members can view members" ON trip_members
  FOR SELECT USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM trips WHERE trips.id = trip_members.trip_id AND trips.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Authenticated users can join trips" ON trip_members;
CREATE POLICY "Authenticated users can join trips" ON trip_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- PART 0b: Create proposals/votes/activity_log if needed
-- =====================================================
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  changes JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  votes_for INTEGER NOT NULL DEFAULT 0,
  votes_against INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  vote BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(proposal_id, user_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- PART 1: Fix constraints
-- =====================================================

-- Fix: Add unique constraint on trip_members to prevent race condition on join
DO $$ BEGIN
  ALTER TABLE trip_members ADD CONSTRAINT trip_members_trip_user_unique UNIQUE(trip_id, user_id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fix: Add unique constraint on share_code
DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT trips_share_code_unique UNIQUE(share_code);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =====================================================
-- PART 2: Expenses tables
-- =====================================================

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('accommodation','food','transport','activities','shopping','other')),
  date DATE NOT NULL,
  notes TEXT,
  payer_id UUID NOT NULL REFERENCES profiles(id),
  split_method TEXT NOT NULL DEFAULT 'equal'
    CHECK (split_method IN ('equal','amounts','shares','percentage')),
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_payer ON expenses(payer_id);

-- Expense splits: how each expense is divided among participants
CREATE TABLE IF NOT EXISTS expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL,
  share_value NUMERIC(10,2),
  UNIQUE(expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_splits_expense ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_splits_user ON expense_splits(user_id);

-- Settlements: recorded payments between members
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id),
  to_user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_settlements_trip ON settlements(trip_id);

-- =====================================================
-- PART 3: RLS Policies
-- =====================================================

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER function to check trip access WITHOUT triggering RLS on trip_members
-- This prevents infinite recursion: expenses → trip_members RLS → ... → loop
CREATE OR REPLACE FUNCTION public.is_trip_member_or_owner(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_members WHERE trip_id = p_trip_id AND user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM trips WHERE id = p_trip_id AND owner_id = p_user_id
  );
$$;

-- Drop existing policies to make migration re-runnable
DROP POLICY IF EXISTS "Trip members can view expenses" ON expenses;
DROP POLICY IF EXISTS "Trip members can insert expenses" ON expenses;
DROP POLICY IF EXISTS "Expense creator can update" ON expenses;
DROP POLICY IF EXISTS "Expense creator can delete" ON expenses;
DROP POLICY IF EXISTS "Trip members can view splits" ON expense_splits;
DROP POLICY IF EXISTS "Trip members can insert splits" ON expense_splits;
DROP POLICY IF EXISTS "Trip members can update splits" ON expense_splits;
DROP POLICY IF EXISTS "Trip members can delete splits" ON expense_splits;
DROP POLICY IF EXISTS "Trip members can view settlements" ON settlements;
DROP POLICY IF EXISTS "Trip members can insert settlements" ON settlements;

-- Expenses: use SECURITY DEFINER function to avoid RLS recursion
CREATE POLICY "Trip members can view expenses" ON expenses
  FOR SELECT USING (public.is_trip_member_or_owner(trip_id, auth.uid()));

CREATE POLICY "Trip members can insert expenses" ON expenses
  FOR INSERT WITH CHECK (public.is_trip_member_or_owner(trip_id, auth.uid()));

CREATE POLICY "Expense creator can update" ON expenses
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "Expense creator can delete" ON expenses
  FOR DELETE USING (created_by = auth.uid());

-- Expense splits: use SECURITY DEFINER via expenses join
CREATE POLICY "Trip members can view splits" ON expense_splits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_splits.expense_id
      AND public.is_trip_member_or_owner(e.trip_id, auth.uid())
    )
  );

CREATE POLICY "Trip members can insert splits" ON expense_splits
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_splits.expense_id
      AND public.is_trip_member_or_owner(e.trip_id, auth.uid())
    )
  );

CREATE POLICY "Trip members can update splits" ON expense_splits
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_splits.expense_id
      AND public.is_trip_member_or_owner(e.trip_id, auth.uid())
    )
  );

CREATE POLICY "Trip members can delete splits" ON expense_splits
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_splits.expense_id
      AND public.is_trip_member_or_owner(e.trip_id, auth.uid())
    )
  );

-- Settlements: use SECURITY DEFINER function
CREATE POLICY "Trip members can view settlements" ON settlements
  FOR SELECT USING (public.is_trip_member_or_owner(trip_id, auth.uid()));

CREATE POLICY "Trip members can insert settlements" ON settlements
  FOR INSERT WITH CHECK (public.is_trip_member_or_owner(trip_id, auth.uid()));

-- Enable realtime (ignore if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

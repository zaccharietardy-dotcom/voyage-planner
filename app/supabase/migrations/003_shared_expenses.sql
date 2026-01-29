-- Migration: Shared Expenses System (Tricount-like)
-- Adds expenses tracking, splits, and settlements for trip members

-- Fix: Add unique constraint on trip_members to prevent race condition on join
ALTER TABLE trip_members ADD CONSTRAINT trip_members_trip_user_unique UNIQUE(trip_id, user_id);

-- Fix: Add unique constraint on share_code
ALTER TABLE trips ADD CONSTRAINT trips_share_code_unique UNIQUE(share_code);

-- Expenses table
CREATE TABLE expenses (
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

CREATE INDEX idx_expenses_trip ON expenses(trip_id);
CREATE INDEX idx_expenses_payer ON expenses(payer_id);

-- Expense splits: how each expense is divided among participants
CREATE TABLE expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL,
  share_value NUMERIC(10,2),
  UNIQUE(expense_id, user_id)
);

CREATE INDEX idx_splits_expense ON expense_splits(expense_id);
CREATE INDEX idx_splits_user ON expense_splits(user_id);

-- Settlements: recorded payments between members
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id),
  to_user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);

CREATE INDEX idx_settlements_trip ON settlements(trip_id);

-- RLS Policies

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Expenses: only trip members can read/write
CREATE POLICY "Trip members can view expenses" ON expenses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM trip_members WHERE trip_members.trip_id = expenses.trip_id AND trip_members.user_id = auth.uid())
  );

CREATE POLICY "Trip members can insert expenses" ON expenses
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM trip_members WHERE trip_members.trip_id = expenses.trip_id AND trip_members.user_id = auth.uid())
  );

CREATE POLICY "Expense creator can update" ON expenses
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "Expense creator can delete" ON expenses
  FOR DELETE USING (created_by = auth.uid());

-- Expense splits: readable by trip members
CREATE POLICY "Trip members can view splits" ON expense_splits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN trip_members tm ON tm.trip_id = e.trip_id
      WHERE e.id = expense_splits.expense_id AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Trip members can insert splits" ON expense_splits
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN trip_members tm ON tm.trip_id = e.trip_id
      WHERE e.id = expense_splits.expense_id AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Trip members can update splits" ON expense_splits
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN trip_members tm ON tm.trip_id = e.trip_id
      WHERE e.id = expense_splits.expense_id AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Trip members can delete splits" ON expense_splits
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN trip_members tm ON tm.trip_id = e.trip_id
      WHERE e.id = expense_splits.expense_id AND tm.user_id = auth.uid()
    )
  );

-- Settlements: trip members can read/write
CREATE POLICY "Trip members can view settlements" ON settlements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM trip_members WHERE trip_members.trip_id = settlements.trip_id AND trip_members.user_id = auth.uid())
  );

CREATE POLICY "Trip members can insert settlements" ON settlements
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM trip_members WHERE trip_members.trip_id = settlements.trip_id AND trip_members.user_id = auth.uid())
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE settlements;

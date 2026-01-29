-- =============================================================
-- Supabase Linter Fixes
-- Execute this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================

-- =============================================
-- 1. ADD MISSING FOREIGN KEY INDEXES (INFO)
-- =============================================

CREATE INDEX IF NOT EXISTS idx_activity_log_trip_id ON public.activity_log (trip_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON public.activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS idx_proposals_user_id ON public.proposals (user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_created_by ON public.settlements (created_by);
CREATE INDEX IF NOT EXISTS idx_settlements_from_user_id ON public.settlements (from_user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_to_user_id ON public.settlements (to_user_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_parent_id ON public.trip_comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON public.votes (user_id);

-- =============================================
-- 2. FIX DUPLICATE INDEX ON trips.share_code
-- =============================================
-- Keep trips_share_code_unique (the UNIQUE constraint), drop the extra one
DROP INDEX IF EXISTS idx_trips_share_code;

-- =============================================
-- 3. FIX RLS POLICIES: use (select auth.uid()) instead of auth.uid()
-- This prevents re-evaluation per row (auth_rls_initplan warnings)
-- =============================================

-- trips
DROP POLICY IF EXISTS "Owners can manage their trips" ON public.trips;
CREATE POLICY "Owners can manage their trips" ON public.trips
  FOR ALL USING (owner_id = (select auth.uid()));

-- proposals
DROP POLICY IF EXISTS "Authenticated users can create proposals" ON public.proposals;
CREATE POLICY "Authenticated users can create proposals" ON public.proposals
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

-- votes
DROP POLICY IF EXISTS "Authenticated users can vote" ON public.votes;
CREATE POLICY "Authenticated users can vote" ON public.votes
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

-- profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (id = (select auth.uid()));

-- expenses
DROP POLICY IF EXISTS "Trip members can view expenses" ON public.expenses;
CREATE POLICY "Trip members can view expenses" ON public.expenses
  FOR SELECT USING (
    trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
    OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Trip members can insert expenses" ON public.expenses;
CREATE POLICY "Trip members can insert expenses" ON public.expenses
  FOR INSERT WITH CHECK (
    trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
    OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Expense creator can update" ON public.expenses;
CREATE POLICY "Expense creator can update" ON public.expenses
  FOR UPDATE USING (created_by = (select auth.uid()));

DROP POLICY IF EXISTS "Expense creator can delete" ON public.expenses;
CREATE POLICY "Expense creator can delete" ON public.expenses
  FOR DELETE USING (created_by = (select auth.uid()));

-- expense_splits
DROP POLICY IF EXISTS "Trip members can view splits" ON public.expense_splits;
CREATE POLICY "Trip members can view splits" ON public.expense_splits
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM public.expenses WHERE
        trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
        OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Trip members can insert splits" ON public.expense_splits;
CREATE POLICY "Trip members can insert splits" ON public.expense_splits
  FOR INSERT WITH CHECK (
    expense_id IN (
      SELECT id FROM public.expenses WHERE
        trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
        OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Trip members can update splits" ON public.expense_splits;
CREATE POLICY "Trip members can update splits" ON public.expense_splits
  FOR UPDATE USING (
    expense_id IN (
      SELECT id FROM public.expenses WHERE
        trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
        OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Trip members can delete splits" ON public.expense_splits;
CREATE POLICY "Trip members can delete splits" ON public.expense_splits
  FOR DELETE USING (
    expense_id IN (
      SELECT id FROM public.expenses WHERE
        trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
        OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
    )
  );

-- trip_comments
DROP POLICY IF EXISTS "Users can update own comments" ON public.trip_comments;
CREATE POLICY "Users can update own comments" ON public.trip_comments
  FOR UPDATE USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete own comments" ON public.trip_comments;
CREATE POLICY "Users can delete own comments" ON public.trip_comments
  FOR DELETE USING (user_id = (select auth.uid()));

-- trip_members
DROP POLICY IF EXISTS "Trip members can view members" ON public.trip_members;
CREATE POLICY "Trip members can view members" ON public.trip_members
  FOR SELECT USING (
    trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
    OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Authenticated users can join trips" ON public.trip_members;
CREATE POLICY "Authenticated users can join trips" ON public.trip_members
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

-- user_preferences
DROP POLICY IF EXISTS "Users can read own preferences" ON public.user_preferences;
CREATE POLICY "Users can read own preferences" ON public.user_preferences
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
CREATE POLICY "Users can insert own preferences" ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences" ON public.user_preferences
  FOR UPDATE USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_preferences;
CREATE POLICY "Users can delete own preferences" ON public.user_preferences
  FOR DELETE USING (user_id = (select auth.uid()));

-- trip_likes
DROP POLICY IF EXISTS "Users can view own likes" ON public.trip_likes;
CREATE POLICY "Users can view own likes" ON public.trip_likes
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can like public trips" ON public.trip_likes;
CREATE POLICY "Authenticated users can like public trips" ON public.trip_likes
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can unlike" ON public.trip_likes;
CREATE POLICY "Users can unlike" ON public.trip_likes
  FOR DELETE USING (user_id = (select auth.uid()));

-- trip_comments (additional)
DROP POLICY IF EXISTS "Users can view own comments" ON public.trip_comments;
CREATE POLICY "Users can view own comments" ON public.trip_comments
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can comment on public trips" ON public.trip_comments;
CREATE POLICY "Authenticated users can comment on public trips" ON public.trip_comments
  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

-- settlements
DROP POLICY IF EXISTS "Trip members can view settlements" ON public.settlements;
CREATE POLICY "Trip members can view settlements" ON public.settlements
  FOR SELECT USING (
    trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
    OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Trip members can insert settlements" ON public.settlements;
CREATE POLICY "Trip members can insert settlements" ON public.settlements
  FOR INSERT WITH CHECK (
    trip_id IN (SELECT trip_id FROM public.trip_members WHERE user_id = (select auth.uid()))
    OR trip_id IN (SELECT id FROM public.trips WHERE owner_id = (select auth.uid()))
  );

-- =============================================
-- 4. MERGE DUPLICATE PERMISSIVE SELECT POLICIES
-- For trip_comments: merge "Anyone can view comments on public trips" + "Users can view own comments"
-- For trip_likes: merge "Anyone can view likes on public trips" + "Users can view own likes"
-- For trips: merge "Owners can manage their trips" + "Public trips are viewable"
-- =============================================

-- trip_comments: replace two SELECT policies with one
DROP POLICY IF EXISTS "Anyone can view comments on public trips" ON public.trip_comments;
DROP POLICY IF EXISTS "Users can view own comments" ON public.trip_comments;
CREATE POLICY "Users can view comments" ON public.trip_comments
  FOR SELECT USING (
    user_id = (select auth.uid())
    OR trip_id IN (SELECT id FROM public.trips WHERE visibility = 'public')
  );

-- trip_likes: replace two SELECT policies with one
DROP POLICY IF EXISTS "Anyone can view likes on public trips" ON public.trip_likes;
DROP POLICY IF EXISTS "Users can view own likes" ON public.trip_likes;
CREATE POLICY "Users can view likes" ON public.trip_likes
  FOR SELECT USING (
    user_id = (select auth.uid())
    OR trip_id IN (SELECT id FROM public.trips WHERE visibility = 'public')
  );

-- trips: "Public trips are viewable" is separate from owner management, keep but note
-- The "Owners can manage their trips" is FOR ALL, and "Public trips are viewable" is FOR SELECT
-- These serve different purposes so keeping both is acceptable, but we can merge into one SELECT
DROP POLICY IF EXISTS "Public trips are viewable" ON public.trips;
DROP POLICY IF EXISTS "Owners can manage their trips" ON public.trips;
CREATE POLICY "Owners can manage their trips" ON public.trips
  FOR ALL USING (owner_id = (select auth.uid()));
CREATE POLICY "Public trips are viewable" ON public.trips
  FOR SELECT USING (visibility = 'public');
-- Note: Postgres evaluates permissive policies with OR, so having two SELECT policies
-- (one from ALL, one from SELECT) is expected here. The ALL policy covers owner CRUD.

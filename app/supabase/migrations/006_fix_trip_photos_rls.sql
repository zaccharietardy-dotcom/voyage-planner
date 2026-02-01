-- Fix: trip_photos RLS policies cause infinite recursion on trip_members
-- Replace direct trip_members queries with SECURITY DEFINER function

DROP POLICY IF EXISTS "Public photos visible to all" ON trip_photos;
CREATE POLICY "Public photos visible to all" ON trip_photos
  FOR SELECT USING (
    visibility = 'public'
    OR user_id = auth.uid()
    OR public.is_trip_member_or_owner(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "Trip members can upload photos" ON trip_photos;
CREATE POLICY "Trip members can upload photos" ON trip_photos
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member_or_owner(trip_id, auth.uid())
  );

-- Migration: Allow authenticated users to read trips by share_code
-- This is needed for the /join/[code] page to work

-- Allow any authenticated user to SELECT a trip if they know the share_code
DROP POLICY IF EXISTS "Anyone can view trips by share code" ON trips;
CREATE POLICY "Anyone can view trips by share code" ON trips
  FOR SELECT USING (
    share_code IS NOT NULL AND auth.uid() IS NOT NULL
  );

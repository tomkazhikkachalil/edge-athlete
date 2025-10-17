-- FIX SEARCH FUNCTIONALITY: Enable Profile Discovery
-- This allows authenticated users to search and view other athlete profiles

-- =====================================================
-- PROFILE VISIBILITY FIX
-- =====================================================

-- Drop the restrictive policy that only allows users to see their own profile
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;

-- Create a more permissive policy: Authenticated users can view all profiles
-- This enables search functionality while still requiring authentication
CREATE POLICY "Authenticated users can view all profiles" ON profiles
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Alternative: If you want public profiles without authentication
-- CREATE POLICY "Public can view all profiles" ON profiles
--   FOR SELECT
--   USING (true);

-- Users can still only edit their own profile
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================

-- Test that profiles are now searchable
SELECT
  id,
  full_name,
  first_name,
  last_name,
  email,
  sport,
  school
FROM profiles
LIMIT 5;

-- =====================================================
-- NOTES
-- =====================================================

-- This change enables:
-- 1. Search functionality - users can find other athletes
-- 2. Profile viewing - users can view other athlete profiles
-- 3. Social features - followers, feed, etc.

-- Security is maintained:
-- - Authentication still required to view profiles
-- - Users can only edit their own profile
-- - Other tables (posts, etc.) have their own RLS policies

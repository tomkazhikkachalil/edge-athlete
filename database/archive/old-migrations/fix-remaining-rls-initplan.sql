-- ============================================================================
-- FIX SCRIPT: Optimize RLS policies to use (select auth.uid())
-- ============================================================================
--
-- Purpose: Replace direct auth.uid() calls with (select auth.uid()) in all
--          RLS policies to prevent re-evaluation for every row.
--
-- Impact: 10-100x query performance improvement on affected tables.
--
-- IMPORTANT: Review the discovery script output before running this!
--
-- This script fixes all known tables with RLS issues based on warnings.
-- Run in a transaction so it can be rolled back if needed.
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE: saved_posts
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own saved posts" ON public.saved_posts;
DROP POLICY IF EXISTS "Users can save posts" ON public.saved_posts;
DROP POLICY IF EXISTS "Users can unsave their own posts" ON public.saved_posts;

-- Recreate with optimized syntax
CREATE POLICY "Users can view their own saved posts"
ON public.saved_posts
FOR SELECT
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can save posts"
ON public.saved_posts
FOR INSERT
WITH CHECK (profile_id = (select auth.uid()));

CREATE POLICY "Users can unsave their own posts"
ON public.saved_posts
FOR DELETE
USING (profile_id = (select auth.uid()));

-- ============================================================================
-- TABLE: athlete_clubs
-- ============================================================================
-- NOTE: This table uses 'athlete_id' not 'profile_id'

DROP POLICY IF EXISTS "Users can view their own club associations" ON public.athlete_clubs;
DROP POLICY IF EXISTS "Users can manage their own club associations" ON public.athlete_clubs;

CREATE POLICY "Users can view their own club associations"
ON public.athlete_clubs
FOR SELECT
USING (athlete_id = (select auth.uid()));

CREATE POLICY "Users can manage their own club associations"
ON public.athlete_clubs
FOR ALL
USING (athlete_id = (select auth.uid()));

-- ============================================================================
-- TABLE: post_comments
-- ============================================================================

DROP POLICY IF EXISTS "Users can view comments on posts they can see" ON public.post_comments;

CREATE POLICY "Users can view comments on posts they can see"
ON public.post_comments
FOR SELECT
USING (
  -- Allow viewing own comments
  profile_id = (select auth.uid())
  OR
  -- Allow viewing comments on posts the user can see
  EXISTS (
    SELECT 1
    FROM public.posts p
    LEFT JOIN public.profiles pr ON p.profile_id = pr.id
    WHERE p.id = post_comments.post_id
    AND (
      p.profile_id = (select auth.uid())  -- Own posts
      OR (p.visibility = 'public' AND pr.visibility = 'public')  -- Public posts
      OR EXISTS (  -- Posts from people user follows
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = (select auth.uid())
        AND f.following_id = p.profile_id
        AND f.status = 'accepted'
      )
    )
  )
);

-- ============================================================================
-- TABLE: sports
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own sports" ON public.sports;
DROP POLICY IF EXISTS "Users can manage their own sports" ON public.sports;

CREATE POLICY "Users can view their own sports"
ON public.sports
FOR SELECT
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can manage their own sports"
ON public.sports
FOR ALL
USING (profile_id = (select auth.uid()));

-- ============================================================================
-- TABLE: season_highlights
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own highlights" ON public.season_highlights;
DROP POLICY IF EXISTS "Users can manage their own highlights" ON public.season_highlights;

CREATE POLICY "Users can view their own highlights"
ON public.season_highlights
FOR SELECT
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can manage their own highlights"
ON public.season_highlights
FOR ALL
USING (profile_id = (select auth.uid()));

-- ============================================================================
-- TABLE: performances
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own performances" ON public.performances;
DROP POLICY IF EXISTS "Users can manage their own performances" ON public.performances;

CREATE POLICY "Users can view their own performances"
ON public.performances
FOR SELECT
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can manage their own performances"
ON public.performances
FOR ALL
USING (profile_id = (select auth.uid()));

-- ============================================================================
-- TABLE: sport_settings
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own sport settings" ON public.sport_settings;
DROP POLICY IF EXISTS "Users can insert their own sport settings" ON public.sport_settings;
DROP POLICY IF EXISTS "Users can update their own sport settings" ON public.sport_settings;
DROP POLICY IF EXISTS "Users can delete their own sport settings" ON public.sport_settings;

CREATE POLICY "Users can view their own sport settings"
ON public.sport_settings
FOR SELECT
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can insert their own sport settings"
ON public.sport_settings
FOR INSERT
WITH CHECK (profile_id = (select auth.uid()));

CREATE POLICY "Users can update their own sport settings"
ON public.sport_settings
FOR UPDATE
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can delete their own sport settings"
ON public.sport_settings
FOR DELETE
USING (profile_id = (select auth.uid()));

-- ============================================================================
-- TABLE: connection_suggestions
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own suggestions" ON public.connection_suggestions;
DROP POLICY IF EXISTS "Users can dismiss their own suggestions" ON public.connection_suggestions;

CREATE POLICY "Users can view their own suggestions"
ON public.connection_suggestions
FOR SELECT
USING (profile_id = (select auth.uid()));

CREATE POLICY "Users can dismiss their own suggestions"
ON public.connection_suggestions
FOR UPDATE
USING (profile_id = (select auth.uid()));

-- ============================================================================
-- Verify the changes
-- ============================================================================

-- This should return 0 if all fixes were applied correctly
SELECT COUNT(*) as remaining_issues
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
    OR
    (with_check IS NOT NULL AND with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
  );

-- If the count is 0, commit the transaction
-- If there are still issues, review them and decide whether to commit or rollback

-- COMMIT;  -- Uncomment this line after reviewing the results

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Review the discovery script output first
-- 2. Run this script in Supabase SQL Editor
-- 3. Check the "remaining_issues" count at the end
-- 4. If count is 0, uncomment the COMMIT line and run again
-- 5. If count is > 0, run the discovery script again to see what was missed
-- 6. Run verification script to confirm all warnings are cleared
-- ============================================================================

-- To rollback instead of commit:
-- ROLLBACK;

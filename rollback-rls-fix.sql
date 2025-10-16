-- ============================================================================
-- ROLLBACK SCRIPT: Restore original RLS policies (EMERGENCY USE ONLY)
-- ============================================================================
--
-- Purpose: Restore the original RLS policies with direct auth.uid() calls
--          if the optimization causes any issues.
--
-- WARNING: Only use this if the optimization caused functional problems.
--          Performance will be degraded after rollback.
--
-- NOTE: This restores the ORIGINAL definitions, not the optimized ones.
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE: saved_posts
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own saved posts" ON public.saved_posts;
DROP POLICY IF EXISTS "Users can save posts" ON public.saved_posts;
DROP POLICY IF EXISTS "Users can unsave their own posts" ON public.saved_posts;

-- Original versions (with direct auth.uid())
CREATE POLICY "Users can view their own saved posts"
ON public.saved_posts
FOR SELECT
USING (profile_id = auth.uid());

CREATE POLICY "Users can save posts"
ON public.saved_posts
FOR INSERT
WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can unsave their own posts"
ON public.saved_posts
FOR DELETE
USING (profile_id = auth.uid());

-- ============================================================================
-- TABLE: athlete_clubs
-- ============================================================================
-- NOTE: This table uses 'athlete_id' not 'profile_id'

DROP POLICY IF EXISTS "Users can view their own club associations" ON public.athlete_clubs;
DROP POLICY IF EXISTS "Users can manage their own club associations" ON public.athlete_clubs;

CREATE POLICY "Users can view their own club associations"
ON public.athlete_clubs
FOR SELECT
USING (athlete_id = auth.uid());

CREATE POLICY "Users can manage their own club associations"
ON public.athlete_clubs
FOR ALL
USING (athlete_id = auth.uid());

-- ============================================================================
-- TABLE: post_comments
-- ============================================================================

DROP POLICY IF EXISTS "Users can view comments on posts they can see" ON public.post_comments;

CREATE POLICY "Users can view comments on posts they can see"
ON public.post_comments
FOR SELECT
USING (
  profile_id = auth.uid()
  OR
  EXISTS (
    SELECT 1
    FROM public.posts p
    LEFT JOIN public.profiles pr ON p.profile_id = pr.id
    WHERE p.id = post_comments.post_id
    AND (
      p.profile_id = auth.uid()
      OR (p.visibility = 'public' AND pr.visibility = 'public')
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
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
USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own sports"
ON public.sports
FOR ALL
USING (profile_id = auth.uid());

-- ============================================================================
-- TABLE: season_highlights
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own highlights" ON public.season_highlights;
DROP POLICY IF EXISTS "Users can manage their own highlights" ON public.season_highlights;

CREATE POLICY "Users can view their own highlights"
ON public.season_highlights
FOR SELECT
USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own highlights"
ON public.season_highlights
FOR ALL
USING (profile_id = auth.uid());

-- ============================================================================
-- TABLE: performances
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own performances" ON public.performances;
DROP POLICY IF EXISTS "Users can manage their own performances" ON public.performances;

CREATE POLICY "Users can view their own performances"
ON public.performances
FOR SELECT
USING (profile_id = auth.uid());

CREATE POLICY "Users can manage their own performances"
ON public.performances
FOR ALL
USING (profile_id = auth.uid());

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
USING (profile_id = auth.uid());

CREATE POLICY "Users can insert their own sport settings"
ON public.sport_settings
FOR INSERT
WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can update their own sport settings"
ON public.sport_settings
FOR UPDATE
USING (profile_id = auth.uid());

CREATE POLICY "Users can delete their own sport settings"
ON public.sport_settings
FOR DELETE
USING (profile_id = auth.uid());

-- ============================================================================
-- TABLE: connection_suggestions
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own suggestions" ON public.connection_suggestions;
DROP POLICY IF EXISTS "Users can dismiss their own suggestions" ON public.connection_suggestions;

CREATE POLICY "Users can view their own suggestions"
ON public.connection_suggestions
FOR SELECT
USING (profile_id = auth.uid());

CREATE POLICY "Users can dismiss their own suggestions"
ON public.connection_suggestions
FOR UPDATE
USING (profile_id = auth.uid());

-- ============================================================================
-- Commit the rollback
-- ============================================================================

COMMIT;

-- ============================================================================
-- AFTER ROLLBACK:
-- ============================================================================
-- 1. The Performance Advisor warnings will return
-- 2. Query performance will be degraded
-- 3. Investigate why the optimized version caused issues
-- 4. Report the issue for troubleshooting
--
-- This rollback should ONLY be used if:
-- - Users cannot access their data
-- - Authentication is broken
-- - Critical functionality is not working
--
-- Do NOT rollback just because of warnings - the warnings are expected
-- to be present in the original version.
-- ============================================================================

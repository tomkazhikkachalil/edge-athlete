-- ============================================================================
-- FIX SUGGESTIONS FEATURE - COMPLETE
-- ============================================================================
-- Purpose: Fix the connection suggestions feature end-to-end
-- Issues Fixed:
--   1. SQL ambiguous column error in generate_connection_suggestions
--   2. Missing connection_suggestions table for dismiss functionality
--   3. Return type mismatch between function versions
--   4. Missing RLS policies and indexes
--
-- Date: January 2025
-- ============================================================================

-- ============================================================================
-- STEP 1: Create connection_suggestions table (if not exists)
-- ============================================================================
-- This table stores dismissed suggestions so they don't reappear

CREATE TABLE IF NOT EXISTS public.connection_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  suggested_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, suggested_profile_id)
);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_connection_suggestions_profile
ON public.connection_suggestions(profile_id);

CREATE INDEX IF NOT EXISTS idx_connection_suggestions_dismissed
ON public.connection_suggestions(profile_id, dismissed)
WHERE dismissed = true;

-- Enable RLS
ALTER TABLE public.connection_suggestions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS connection_suggestions_select_policy ON public.connection_suggestions;
DROP POLICY IF EXISTS connection_suggestions_insert_policy ON public.connection_suggestions;
DROP POLICY IF EXISTS connection_suggestions_update_policy ON public.connection_suggestions;
DROP POLICY IF EXISTS connection_suggestions_delete_policy ON public.connection_suggestions;

-- Create RLS policies
CREATE POLICY connection_suggestions_select_policy ON public.connection_suggestions
FOR SELECT USING (profile_id = (SELECT auth.uid()));

CREATE POLICY connection_suggestions_insert_policy ON public.connection_suggestions
FOR INSERT WITH CHECK (profile_id = (SELECT auth.uid()));

CREATE POLICY connection_suggestions_update_policy ON public.connection_suggestions
FOR UPDATE USING (profile_id = (SELECT auth.uid()));

CREATE POLICY connection_suggestions_delete_policy ON public.connection_suggestions
FOR DELETE USING (profile_id = (SELECT auth.uid()));

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION public.update_connection_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trigger_connection_suggestions_updated_at
ON public.connection_suggestions;

CREATE TRIGGER trigger_connection_suggestions_updated_at
BEFORE UPDATE ON public.connection_suggestions
FOR EACH ROW EXECUTE FUNCTION public.update_connection_suggestions_updated_at();

-- ============================================================================
-- STEP 2: Drop ALL existing versions of generate_connection_suggestions
-- ============================================================================
-- Multiple versions with different signatures may exist

DROP FUNCTION IF EXISTS public.generate_connection_suggestions(UUID, INTEGER);
DROP FUNCTION IF EXISTS generate_connection_suggestions(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.generate_connection_suggestions(UUID);
DROP FUNCTION IF EXISTS generate_connection_suggestions(UUID);

-- ============================================================================
-- STEP 3: Create the corrected function
-- ============================================================================
-- Returns columns matching what the API expects:
--   suggested_id, suggested_name, suggested_avatar, similarity_score, reason

CREATE OR REPLACE FUNCTION public.generate_connection_suggestions(
  p_user_profile_id UUID,
  p_suggestion_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  suggested_id UUID,
  suggested_name TEXT,
  suggested_avatar TEXT,
  suggested_sport TEXT,
  suggested_school TEXT,
  suggested_location TEXT,
  similarity_score INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_user_sport TEXT;
  v_user_school TEXT;
  v_user_location TEXT;
BEGIN
  -- First, get the requesting user's profile data
  SELECT
    sport,
    school,
    location
  INTO
    v_user_sport,
    v_user_school,
    v_user_location
  FROM public.profiles
  WHERE id = p_user_profile_id;

  -- Return suggested profiles
  RETURN QUERY
  SELECT
    p.id AS suggested_id,
    COALESCE(
      p.full_name,
      NULLIF(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), '')
    ) AS suggested_name,
    p.avatar_url AS suggested_avatar,
    p.sport AS suggested_sport,
    p.school AS suggested_school,
    p.location AS suggested_location,
    -- Calculate similarity score
    (
      CASE WHEN p.sport IS NOT NULL AND p.sport = v_user_sport THEN 30 ELSE 0 END +
      CASE WHEN p.school IS NOT NULL AND p.school = v_user_school THEN 20 ELSE 0 END +
      CASE WHEN p.location IS NOT NULL AND p.location = v_user_location THEN 10 ELSE 0 END +
      -- Bonus points for common connections (capped at 25 points)
      LEAST(
        COALESCE((
          SELECT COUNT(*)::INTEGER * 5
          FROM public.follows f1
          INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
          WHERE f1.follower_id = p_user_profile_id
            AND f2.follower_id = p.id
            AND f1.status = 'accepted'
            AND f2.status = 'accepted'
        ), 0),
        25
      )
    )::INTEGER AS similarity_score,
    -- Generate human-readable reason
    CASE
      WHEN p.sport IS NOT NULL AND p.sport = v_user_sport THEN
        CONCAT('Also plays ', p.sport)
      WHEN p.school IS NOT NULL AND p.school = v_user_school THEN
        CONCAT('Also attends ', p.school)
      WHEN p.location IS NOT NULL AND p.location = v_user_location THEN
        CONCAT('Also from ', p.location)
      WHEN EXISTS (
        SELECT 1 FROM public.follows f1
        INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
        WHERE f1.follower_id = p_user_profile_id
          AND f2.follower_id = p.id
          AND f1.status = 'accepted'
          AND f2.status = 'accepted'
        LIMIT 1
      ) THEN
        'Has mutual connections'
      ELSE
        'Suggested for you'
    END AS reason
  FROM public.profiles p
  WHERE p.id != p_user_profile_id
    -- Only public profiles
    AND p.visibility = 'public'
    -- Exclude profiles already being followed or with pending requests
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = p_user_profile_id
        AND f.following_id = p.id
    )
    -- Exclude previously dismissed suggestions
    AND NOT EXISTS (
      SELECT 1 FROM public.connection_suggestions cs
      WHERE cs.profile_id = p_user_profile_id
        AND cs.suggested_profile_id = p.id
        AND cs.dismissed = true
    )
  ORDER BY similarity_score DESC, p.created_at DESC
  LIMIT p_suggestion_limit;
END;
$$ LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public;

-- Add helpful comment
COMMENT ON FUNCTION public.generate_connection_suggestions IS
'Generates personalized connection suggestions based on sport, school, location, and common connections.
Excludes: profiles already followed, pending requests, and dismissed suggestions.
Returns: suggested_id, suggested_name, suggested_avatar, suggested_sport, suggested_school, suggested_location, similarity_score, reason';

-- ============================================================================
-- STEP 4: Grant permissions
-- ============================================================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.connection_suggestions TO authenticated;
GRANT INSERT ON public.connection_suggestions TO authenticated;
GRANT UPDATE ON public.connection_suggestions TO authenticated;
GRANT DELETE ON public.connection_suggestions TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_connection_suggestions(UUID, INTEGER) TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '  SUGGESTIONS FEATURE FIX COMPLETE';
  RAISE NOTICE '============================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Created/Updated:';
  RAISE NOTICE '  - connection_suggestions table';
  RAISE NOTICE '  - RLS policies for connection_suggestions';
  RAISE NOTICE '  - generate_connection_suggestions function';
  RAISE NOTICE '  - Indexes for performance';
  RAISE NOTICE '';
  RAISE NOTICE 'The function now returns:';
  RAISE NOTICE '  - suggested_id (UUID)';
  RAISE NOTICE '  - suggested_name (TEXT)';
  RAISE NOTICE '  - suggested_avatar (TEXT)';
  RAISE NOTICE '  - suggested_sport (TEXT)';
  RAISE NOTICE '  - suggested_school (TEXT)';
  RAISE NOTICE '  - suggested_location (TEXT)';
  RAISE NOTICE '  - similarity_score (INTEGER)';
  RAISE NOTICE '  - reason (TEXT)';
  RAISE NOTICE '';
  RAISE NOTICE 'Test the function with:';
  RAISE NOTICE 'SELECT * FROM generate_connection_suggestions(''your-profile-uuid'', 5);';
  RAISE NOTICE '';
END $$;

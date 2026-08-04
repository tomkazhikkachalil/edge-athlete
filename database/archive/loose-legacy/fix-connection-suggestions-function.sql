-- ============================================================================
-- FIX CONNECTION SUGGESTIONS FUNCTION
-- Resolves ambiguous column error and aligns return format with API expectations
-- ============================================================================

-- Drop the existing function first (required when changing return type)
DROP FUNCTION IF EXISTS public.generate_connection_suggestions(UUID, INTEGER);

-- Create the corrected function with updated return columns
CREATE OR REPLACE FUNCTION public.generate_connection_suggestions(
  user_profile_id UUID,
  suggestion_limit INTEGER DEFAULT 10
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
BEGIN
  RETURN QUERY
  WITH user_profile AS (
    -- Get the current user's profile data once
    SELECT
      sport,
      school,
      location
    FROM public.profiles
    WHERE id = user_profile_id
    LIMIT 1
  )
  SELECT
    p.id AS suggested_id,
    COALESCE(p.full_name, TRIM(CONCAT(p.first_name, ' ', p.last_name))) AS suggested_name,
    p.avatar_url AS suggested_avatar,
    p.sport AS suggested_sport,
    p.school AS suggested_school,
    p.location AS suggested_location,
    (
      -- Calculate match score based on sport, school, location
      (CASE WHEN p.sport IS NOT NULL AND p.sport = (SELECT sport FROM user_profile) THEN 30 ELSE 0 END) +
      (CASE WHEN p.school IS NOT NULL AND p.school = (SELECT school FROM user_profile) THEN 20 ELSE 0 END) +
      (CASE WHEN p.location IS NOT NULL AND p.location = (SELECT location FROM user_profile) THEN 10 ELSE 0 END) +
      (
        -- Add points for common connections
        COALESCE((
          SELECT COUNT(*)::INTEGER * 5
          FROM public.follows f1
          INNER JOIN public.follows f2 ON f1.following_id = f2.following_id
          WHERE f1.follower_id = user_profile_id
          AND f2.follower_id = p.id
          AND f1.status = 'accepted'
          AND f2.status = 'accepted'
        ), 0)
      )
    ) AS similarity_score,
    (
      -- Generate reason text
      CASE
        WHEN p.sport IS NOT NULL AND p.sport = (SELECT sport FROM user_profile) THEN
          CONCAT('Also plays ', p.sport)
        WHEN p.school IS NOT NULL AND p.school = (SELECT school FROM user_profile) THEN
          CONCAT('Also attends ', p.school)
        WHEN p.location IS NOT NULL AND p.location = (SELECT location FROM user_profile) THEN
          CONCAT('Also from ', p.location)
        ELSE
          'Suggested for you'
      END
    ) AS reason
  FROM public.profiles p
  WHERE p.id != user_profile_id
  AND p.visibility = 'public'
  AND NOT EXISTS (
    -- Exclude users already following
    SELECT 1 FROM public.follows
    WHERE follower_id = user_profile_id
    AND following_id = p.id
  )
  ORDER BY similarity_score DESC, p.created_at DESC
  LIMIT suggestion_limit;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public;

-- Add helpful comment
COMMENT ON FUNCTION public.generate_connection_suggestions IS 'Generates personalized connection suggestions based on sport, school, location, and common connections. Returns profiles that the user is not already following.';

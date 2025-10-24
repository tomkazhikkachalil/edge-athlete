-- =====================================================
-- UPDATE STATS MEDIA FUNCTIONS TO INCLUDE SPORT-SPECIFIC DATA
-- =====================================================
-- This updates the "Media with Stats" tab functions to include posts
-- that have sport-specific data (golf rounds, basketball games, etc.)
-- not just posts with generic stats_data field.
--
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- PART 1: UPDATE GET_PROFILE_STATS_MEDIA FUNCTION
-- =====================================================
-- Now includes posts with:
-- - stats_data (generic stats)
-- - round_id (golf rounds)
-- - game_id (basketball, hockey - future)
-- - match_id (soccer - future)

CREATE OR REPLACE FUNCTION get_profile_stats_media(
  target_profile_id UUID,
  viewer_id UUID DEFAULT NULL,
  media_limit INT DEFAULT 20,
  media_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  caption TEXT,
  sport_key TEXT,
  stats_data JSONB,
  visibility TEXT,
  created_at TIMESTAMPTZ,
  profile_id UUID,
  profile_first_name TEXT,
  profile_last_name TEXT,
  profile_full_name TEXT,
  profile_avatar_url TEXT,
  media_count BIGINT,
  likes_count INT,
  comments_count INT,
  saves_count INT,
  tags TEXT[],
  hashtags TEXT[],
  is_own_post BOOLEAN,
  is_tagged BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (p.id)
    p.id,
    p.caption,
    p.sport_key,
    p.stats_data,
    p.visibility,
    p.created_at,
    p.profile_id,
    prof.first_name AS profile_first_name,
    prof.last_name AS profile_last_name,
    prof.full_name AS profile_full_name,
    prof.avatar_url AS profile_avatar_url,
    (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
    p.likes_count,
    p.comments_count,
    p.saves_count,
    p.tags,
    p.hashtags,
    (p.profile_id = target_profile_id) AS is_own_post,
    (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    -- User's own posts with stats OR tagged posts with stats
    (p.profile_id = target_profile_id OR target_profile_id::TEXT = ANY(p.tags))
    AND
    -- Must have EITHER stats_data OR sport-specific data
    (
      -- Generic stats_data
      (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
      OR
      -- Golf rounds
      p.round_id IS NOT NULL
      -- Team sports (basketball, hockey, football, baseball)
      OR p.game_id IS NOT NULL
      -- Match sports (soccer, tennis, volleyball)
      OR p.match_id IS NOT NULL
      -- Racing sports (track & field, swimming)
      OR p.race_id IS NOT NULL
    )
  )
  AND (
    -- Privacy check (same as before)
    p.visibility = 'public'
    OR
    (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
    OR
    (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
    OR
    (
      viewer_id IS NOT NULL
      AND p.visibility = 'private'
      AND EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = viewer_id
        AND f.following_id = p.profile_id
        AND f.status = 'accepted'
      )
    )
  )
  ORDER BY p.id, p.created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- PART 2: UPDATE GET_PROFILE_MEDIA_COUNTS FUNCTION
-- =====================================================
-- Update stats_media_count to include sport-specific data

CREATE OR REPLACE FUNCTION get_profile_media_counts(
  target_profile_id UUID,
  viewer_id UUID DEFAULT NULL
)
RETURNS TABLE (
  all_media_count BIGINT,
  stats_media_count BIGINT,
  tagged_media_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- All media count (unchanged)
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE (
        p.profile_id = target_profile_id
        OR target_profile_id::TEXT = ANY(p.tags)
      )
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
    ) AS all_media_count,

    -- Stats media count (NOW INCLUDES SPORT-SPECIFIC DATA)
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE (
        p.profile_id = target_profile_id
        OR target_profile_id::TEXT = ANY(p.tags)
      )
      AND (
        -- Must have EITHER stats_data OR sport-specific data
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR
        p.round_id IS NOT NULL
        OR p.game_id IS NOT NULL
        OR p.match_id IS NOT NULL
        OR p.race_id IS NOT NULL
      )
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
    ) AS stats_media_count,

    -- Tagged media count (unchanged)
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE target_profile_id::TEXT = ANY(p.tags)
      AND p.profile_id != target_profile_id
      AND (
        p.visibility = 'public'
        OR (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
        OR (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
        OR (
          viewer_id IS NOT NULL
          AND p.visibility = 'private'
          AND EXISTS (
            SELECT 1 FROM follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
    ) AS tagged_media_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- PART 3: UPDATE STATS INDEX FOR PERFORMANCE
-- =====================================================
-- Drop old index and create new one that includes round_id

DROP INDEX IF EXISTS idx_posts_stats_data_exists;

-- New index for stats queries (includes all sport-specific foreign keys)
CREATE INDEX IF NOT EXISTS idx_posts_stats_media
ON posts(profile_id, created_at DESC)
WHERE (
  (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
  OR round_id IS NOT NULL
  OR game_id IS NOT NULL
  OR match_id IS NOT NULL
  OR race_id IS NOT NULL
);

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    STATS MEDIA FUNCTIONS UPDATED';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Updated functions:';
  RAISE NOTICE '  ✓ get_profile_stats_media() - now includes round_id';
  RAISE NOTICE '  ✓ get_profile_media_counts() - stats count includes round_id';
  RAISE NOTICE '';
  RAISE NOTICE 'What this means:';
  RAISE NOTICE '  • Posts with any sport-specific data appear in "Media with Stats"';
  RAISE NOTICE '  • Golf: round_id (implemented)';
  RAISE NOTICE '  • Team Sports: game_id (ready for basketball, hockey, football, baseball)';
  RAISE NOTICE '  • Match Sports: match_id (ready for soccer, tennis, volleyball)';
  RAISE NOTICE '  • Racing Sports: race_id (ready for track & field, swimming)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps for new sports:';
  RAISE NOTICE '  1. Create sport-specific tables (e.g., basketball_games)';
  RAISE NOTICE '  2. Add foreign key constraints to posts table';
  RAISE NOTICE '  3. Implement sport adapter in /lib/sports/adapters/';
  RAISE NOTICE '  4. Enable in SportRegistry.ts and features.ts';
  RAISE NOTICE '';
  RAISE NOTICE 'Test with:';
  RAISE NOTICE '  SELECT * FROM get_profile_media_counts(''user-uuid'', ''viewer-uuid'');';
  RAISE NOTICE '  -- stats_media_count should now include golf posts';
  RAISE NOTICE '';
END $$;

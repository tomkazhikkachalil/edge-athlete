-- =====================================================
-- FIX PROFILE MEDIA TABS - USE POST_TAGS TABLE
-- =====================================================
-- This fixes the media categorization to use the post_tags table
-- Run this in Supabase SQL Editor to replace the existing functions

-- =====================================================
-- PART 1: GET ALL MEDIA FOR A PROFILE (FIXED)
-- =====================================================

CREATE OR REPLACE FUNCTION get_profile_all_media(
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
    (EXISTS (
      SELECT 1 FROM post_tags pt
      WHERE pt.post_id = p.id
      AND pt.tagged_profile_id = target_profile_id
      AND pt.status = 'active'
    )) AS is_tagged
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    -- User's own posts
    p.profile_id = target_profile_id
    OR
    -- Posts where user is tagged (using post_tags table)
    EXISTS (
      SELECT 1 FROM post_tags pt
      WHERE pt.post_id = p.id
      AND pt.tagged_profile_id = target_profile_id
      AND pt.status = 'active'
    )
  )
  AND (
    -- Privacy check
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
-- PART 2: GET MEDIA WITH STATS FOR A PROFILE (FIXED)
-- =====================================================

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
    (EXISTS (
      SELECT 1 FROM post_tags pt
      WHERE pt.post_id = p.id
      AND pt.tagged_profile_id = target_profile_id
      AND pt.status = 'active'
    )) AS is_tagged
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    -- User's own posts with stats OR tagged posts with stats
    (
      p.profile_id = target_profile_id
      OR
      EXISTS (
        SELECT 1 FROM post_tags pt
        WHERE pt.post_id = p.id
        AND pt.tagged_profile_id = target_profile_id
        AND pt.status = 'active'
      )
    )
    AND
    -- Must have stats_data
    p.stats_data IS NOT NULL
    AND
    p.stats_data != '{}'::jsonb
    AND
    jsonb_typeof(p.stats_data) = 'object'
  )
  AND (
    -- Privacy check
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
-- PART 3: GET TAGGED MEDIA FOR A PROFILE (FIXED)
-- =====================================================

CREATE OR REPLACE FUNCTION get_profile_tagged_media(
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
    FALSE AS is_own_post,
    TRUE AS is_tagged
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE
    -- User is tagged using post_tags table
    EXISTS (
      SELECT 1 FROM post_tags pt
      WHERE pt.post_id = p.id
      AND pt.tagged_profile_id = target_profile_id
      AND pt.status = 'active'
    )
    AND
    -- NOT the user's own post
    p.profile_id != target_profile_id
  AND (
    -- Privacy check
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
-- PART 4: GET MEDIA COUNTS FOR TAB BADGES (FIXED)
-- =====================================================

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
    -- All media count
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE (
        p.profile_id = target_profile_id
        OR
        EXISTS (
          SELECT 1 FROM post_tags pt
          WHERE pt.post_id = p.id
          AND pt.tagged_profile_id = target_profile_id
          AND pt.status = 'active'
        )
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

    -- Stats media count
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE (
        p.profile_id = target_profile_id
        OR
        EXISTS (
          SELECT 1 FROM post_tags pt
          WHERE pt.post_id = p.id
          AND pt.tagged_profile_id = target_profile_id
          AND pt.status = 'active'
        )
      )
      AND p.stats_data IS NOT NULL
      AND p.stats_data != '{}'::jsonb
      AND jsonb_typeof(p.stats_data) = 'object'
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

    -- Tagged media count
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE EXISTS (
        SELECT 1 FROM post_tags pt
        WHERE pt.post_id = p.id
        AND pt.tagged_profile_id = target_profile_id
        AND pt.status = 'active'
      )
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
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    PROFILE MEDIA TABS FIXED';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions updated:';
  RAISE NOTICE '  ✓ get_profile_all_media() - Now uses post_tags table';
  RAISE NOTICE '  ✓ get_profile_stats_media() - Now uses post_tags table';
  RAISE NOTICE '  ✓ get_profile_tagged_media() - Now uses post_tags table';
  RAISE NOTICE '  ✓ get_profile_media_counts() - Now uses post_tags table';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  • Tags now checked via post_tags table with status=active';
  RAISE NOTICE '  • Stats validation improved (checks jsonb_typeof)';
  RAISE NOTICE '  • Better handling of tagged vs own posts';
  RAISE NOTICE '';
  RAISE NOTICE 'Test the functions with:';
  RAISE NOTICE '  SELECT * FROM get_profile_media_counts(''your-uuid'', ''your-uuid'');';
  RAISE NOTICE '';
END $$;

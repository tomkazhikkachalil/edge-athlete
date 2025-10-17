-- =====================================================
-- PROFILE MEDIA TABS SETUP
-- =====================================================
-- This creates functions for segmented media viewing on profiles:
-- 1. All Media (user's posts + tagged media)
-- 2. Media with Stats (posts with stats_data)
-- 3. Tagged in Media (posts where user is tagged)
-- Run this in Supabase SQL Editor

-- =====================================================
-- PART 1: GET ALL MEDIA FOR A PROFILE
-- =====================================================
-- Returns user's own posts + posts where they're tagged
-- Respects privacy: filters out posts from private accounts viewer can't see

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
    (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    -- User's own posts
    p.profile_id = target_profile_id
    OR
    -- Posts where user is tagged
    target_profile_id::TEXT = ANY(p.tags)
  )
  AND (
    -- Privacy check: Only show if:
    -- 1. Post is public
    p.visibility = 'public'
    OR
    -- 2. Viewer is the post owner
    (viewer_id IS NOT NULL AND p.profile_id = viewer_id)
    OR
    -- 3. Viewer is the target profile owner
    (viewer_id IS NOT NULL AND viewer_id = target_profile_id)
    OR
    -- 4. Post is private but viewer follows the author
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
-- PART 2: GET MEDIA WITH STATS FOR A PROFILE
-- =====================================================
-- Returns only posts with stats_data populated

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
    -- Must have stats_data
    p.stats_data IS NOT NULL
    AND
    p.stats_data != '{}'::jsonb
  )
  AND (
    -- Privacy check (same as above)
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
-- PART 3: GET TAGGED MEDIA FOR A PROFILE
-- =====================================================
-- Returns only posts where user is tagged by someone else

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
    -- User is tagged
    target_profile_id::TEXT = ANY(p.tags)
    AND
    -- NOT the user's own post
    p.profile_id != target_profile_id
  AND (
    -- Privacy check (same as above)
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
-- PART 4: GET MEDIA COUNTS FOR TAB BADGES
-- =====================================================
-- Returns counts for all three tabs

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

    -- Stats media count
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
      WHERE (
        p.profile_id = target_profile_id
        OR target_profile_id::TEXT = ANY(p.tags)
      )
      AND p.stats_data IS NOT NULL
      AND p.stats_data != '{}'::jsonb
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
-- PART 5: CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Index for tag searches (already exists from tagging system, but verify)
CREATE INDEX IF NOT EXISTS idx_posts_tags_gin ON posts USING GIN(tags);

-- Composite index for user posts + visibility
CREATE INDEX IF NOT EXISTS idx_posts_profile_visibility_created
ON posts(profile_id, visibility, created_at DESC);

-- Index for stats queries
CREATE INDEX IF NOT EXISTS idx_posts_stats_data_exists
ON posts(profile_id, created_at DESC)
WHERE stats_data IS NOT NULL AND stats_data != '{}'::jsonb;

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    PROFILE MEDIA TABS SETUP COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions created:';
  RAISE NOTICE '  ✓ get_profile_all_media()';
  RAISE NOTICE '  ✓ get_profile_stats_media()';
  RAISE NOTICE '  ✓ get_profile_tagged_media()';
  RAISE NOTICE '  ✓ get_profile_media_counts()';
  RAISE NOTICE '';
  RAISE NOTICE 'Features:';
  RAISE NOTICE '  • Privacy-aware filtering';
  RAISE NOTICE '  • Pagination support';
  RAISE NOTICE '  • Performance indexes';
  RAISE NOTICE '  • Duplicate prevention';
  RAISE NOTICE '';
  RAISE NOTICE 'Test with:';
  RAISE NOTICE '  SELECT * FROM get_profile_media_counts(''user-uuid'', ''viewer-uuid'');';
  RAISE NOTICE '';
END $$;

-- Add round_id to Profile Media Functions
-- This adds round_id to the return columns so we can fetch golf_round data for stats summaries

-- Drop existing functions first (required when changing return types)
DROP FUNCTION IF EXISTS get_profile_all_media(UUID, UUID, INT, INT);
DROP FUNCTION IF EXISTS get_profile_stats_media(UUID, UUID, INT, INT);
DROP FUNCTION IF EXISTS get_profile_tagged_media(UUID, UUID, INT, INT);

-- Update get_profile_all_media to include round_id
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
  round_id UUID,
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
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id,
      p.caption,
      p.sport_key,
      p.stats_data,
      p.round_id,
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
      COALESCE(p.saves_count, 0) AS saves_count,
      p.tags,
      p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      -- All posts by user or tagged posts
      p.profile_id = target_profile_id
      OR target_profile_id::TEXT = ANY(p.tags)
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
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Update get_profile_stats_media to include round_id
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
  round_id UUID,
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
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id,
      p.caption,
      p.sport_key,
      p.stats_data,
      p.round_id,
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
      COALESCE(p.saves_count, 0) AS saves_count,
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
      -- Must have stats_data OR have a round_id (golf round)
      (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR
        p.round_id IS NOT NULL
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
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Update get_profile_tagged_media to include round_id
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
  round_id UUID,
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
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id,
      p.caption,
      p.sport_key,
      p.stats_data,
      p.round_id,
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
      COALESCE(p.saves_count, 0) AS saves_count,
      p.tags,
      p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      -- Only posts where user is tagged
      target_profile_id::TEXT = ANY(p.tags)
      AND p.profile_id != target_profile_id
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
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✓ Updated get_profile_all_media() - now includes round_id';
  RAISE NOTICE '✓ Updated get_profile_stats_media() - now includes round_id';
  RAISE NOTICE '✓ Updated get_profile_tagged_media() - now includes round_id';
  RAISE NOTICE '';
  RAISE NOTICE 'Profile media functions now return round_id for fetching golf round details';
END $$;

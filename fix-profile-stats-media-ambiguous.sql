-- Fix ambiguous column reference in get_profile_stats_media function
-- Issue: stats_data, round_id, game_id, match_id, race_id need table qualification
-- Date: January 2025

-- Step 1: Drop the existing function first (required when changing return type)
DROP FUNCTION IF EXISTS get_profile_stats_media(uuid, uuid, integer, integer);

-- Step 2: Recreate with corrected column references
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
  SELECT * FROM (
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
      (
        p.profile_id = target_profile_id
        AND (
          -- FIX: Qualify all column references with p. prefix
          (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
          OR p.round_id IS NOT NULL
          OR p.game_id IS NOT NULL
          OR p.match_id IS NOT NULL
          OR p.race_id IS NOT NULL
        )
      )
      OR
      (
        target_profile_id::TEXT = ANY(p.tags)
        AND (
          -- FIX: Qualify all column references with p. prefix
          (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
          OR p.round_id IS NOT NULL
          OR p.game_id IS NOT NULL
          OR p.match_id IS NOT NULL
          OR p.race_id IS NOT NULL
        )
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
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

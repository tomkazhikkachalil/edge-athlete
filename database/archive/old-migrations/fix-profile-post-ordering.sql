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
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql;

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
          (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
          OR round_id IS NOT NULL
          OR game_id IS NOT NULL
          OR match_id IS NOT NULL
          OR race_id IS NOT NULL
        )
      )
      OR
      (
        target_profile_id::TEXT = ANY(p.tags)
        AND (
          (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
          OR round_id IS NOT NULL
          OR game_id IS NOT NULL
          OR match_id IS NOT NULL
          OR race_id IS NOT NULL
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
$$ LANGUAGE plpgsql;

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
      target_profile_id::TEXT = ANY(p.tags)
      AND p.profile_id != target_profile_id
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
$$ LANGUAGE plpgsql;

-- Migration 018: Profile Media — Sport + Year Filters
--
-- Adds two optional array parameters to the three profile media RPC functions
-- so the frontend can filter posts by one-or-more sport_keys and/or one-or-more
-- calendar years. Existing 4-arg call sites continue to work because the new
-- params default to NULL (meaning "no filter").
--
-- Why a new migration rather than modifying in place:
--   - PostgreSQL requires DROP + CREATE when changing function signature.
--   - Following the project convention of numbered migrations + INDEX.md entry.
--
-- Reference baseline (function bodies preserved from):
--   database/features/golf/add-round-id-to-profile-media-functions.sql

-- Drop existing 4-arg signatures
DROP FUNCTION IF EXISTS get_profile_all_media(UUID, UUID, INT, INT);
DROP FUNCTION IF EXISTS get_profile_stats_media(UUID, UUID, INT, INT);
DROP FUNCTION IF EXISTS get_profile_tagged_media(UUID, UUID, INT, INT);

-- =====================================================
-- get_profile_all_media — with sport + year filters
-- =====================================================
CREATE OR REPLACE FUNCTION get_profile_all_media(
  target_profile_id UUID,
  viewer_id UUID DEFAULT NULL,
  media_limit INT DEFAULT 20,
  media_offset INT DEFAULT 0,
  filter_sport_keys TEXT[] DEFAULT NULL,
  filter_years INT[] DEFAULT NULL
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
    -- Sport filter (NULL = no filter; non-NULL = match any in the array)
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    -- Year filter (NULL = no filter; matches calendar year of created_at)
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- get_profile_stats_media — with sport + year filters
-- =====================================================
CREATE OR REPLACE FUNCTION get_profile_stats_media(
  target_profile_id UUID,
  viewer_id UUID DEFAULT NULL,
  media_limit INT DEFAULT 20,
  media_offset INT DEFAULT 0,
  filter_sport_keys TEXT[] DEFAULT NULL,
  filter_years INT[] DEFAULT NULL
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
    -- Sport filter (NULL = no filter)
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    -- Year filter (NULL = no filter)
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- get_profile_tagged_media — with sport + year filters
-- =====================================================
CREATE OR REPLACE FUNCTION get_profile_tagged_media(
  target_profile_id UUID,
  viewer_id UUID DEFAULT NULL,
  media_limit INT DEFAULT 20,
  media_offset INT DEFAULT 0,
  filter_sport_keys TEXT[] DEFAULT NULL,
  filter_years INT[] DEFAULT NULL
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
    -- Sport filter (NULL = no filter)
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    -- Year filter (NULL = no filter)
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- Verification
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE '✓ get_profile_all_media() — now accepts filter_sport_keys + filter_years';
  RAISE NOTICE '✓ get_profile_stats_media() — now accepts filter_sport_keys + filter_years';
  RAISE NOTICE '✓ get_profile_tagged_media() — now accepts filter_sport_keys + filter_years';
  RAISE NOTICE '';
  RAISE NOTICE 'Note: get_profile_media_counts() intentionally unchanged — tab counts should';
  RAISE NOTICE 'reflect the full profile, not the filtered slice.';
END $$;

-- Smoke test (uncomment and supply a real profile UUID to verify in SQL editor):
-- SELECT id, sport_key, EXTRACT(YEAR FROM created_at)::INT AS year
-- FROM get_profile_all_media(
--   '<some-profile-id>'::uuid, NULL, 5, 0,
--   ARRAY['golf']::TEXT[], ARRAY[2026]::INT[]
-- );

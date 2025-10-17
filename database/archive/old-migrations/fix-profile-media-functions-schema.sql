-- Fix Profile Media Functions - Add Schema Prefixes for search_path Security
-- This fixes the issue where posts don't show on user profiles after applying
-- the search_path security fixes from fix-function-search-paths.sql
--
-- Issue: Functions reference tables without schema prefix (e.g., "posts" instead of "public.posts")
-- When search_path = '' is set, functions can't find tables
--
-- Solution: Add "public." prefix to ALL table references
--
-- Date: January 15, 2025
-- Status: CRITICAL FIX REQUIRED

-- ============================================================================
-- FUNCTION 1: get_profile_all_media
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profile_all_media(
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
      (SELECT COUNT(*) FROM public.post_media WHERE public.post_media.post_id = p.id) AS media_count,
      p.likes_count,
      p.comments_count,
      p.saves_count,
      p.tags,
      p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
    FROM public.posts p
    INNER JOIN public.profiles prof ON p.profile_id = prof.id
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
          SELECT 1 FROM public.follows f
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

-- ============================================================================
-- FUNCTION 2: get_profile_stats_media
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profile_stats_media(
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
      (SELECT COUNT(*) FROM public.post_media WHERE public.post_media.post_id = p.id) AS media_count,
      p.likes_count,
      p.comments_count,
      p.saves_count,
      p.tags,
      p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
    FROM public.posts p
    INNER JOIN public.profiles prof ON p.profile_id = prof.id
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
          SELECT 1 FROM public.follows f
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

-- ============================================================================
-- FUNCTION 3: get_profile_tagged_media
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profile_tagged_media(
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
      (SELECT COUNT(*) FROM public.post_media WHERE public.post_media.post_id = p.id) AS media_count,
      p.likes_count,
      p.comments_count,
      p.saves_count,
      p.tags,
      p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
    FROM public.posts p
    INNER JOIN public.profiles prof ON p.profile_id = prof.id
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
          SELECT 1 FROM public.follows f
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

-- ============================================================================
-- FUNCTION 4: get_profile_media_counts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profile_media_counts(
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
    -- All media count (posts owned by or tagged with target profile)
    (SELECT COUNT(DISTINCT p.id)
     FROM public.posts p
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
           SELECT 1 FROM public.follows f
           WHERE f.follower_id = viewer_id
           AND f.following_id = p.profile_id
           AND f.status = 'accepted'
         )
       )
     )) AS all_media_count,

    -- Stats media count (posts with stats_data or sport-specific IDs)
    (SELECT COUNT(DISTINCT p.id)
     FROM public.posts p
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
           SELECT 1 FROM public.follows f
           WHERE f.follower_id = viewer_id
           AND f.following_id = p.profile_id
           AND f.status = 'accepted'
         )
       )
     )) AS stats_media_count,

    -- Tagged media count (posts where target is tagged but not owner)
    (SELECT COUNT(DISTINCT p.id)
     FROM public.posts p
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
           SELECT 1 FROM public.follows f
           WHERE f.follower_id = viewer_id
           AND f.following_id = p.profile_id
           AND f.status = 'accepted'
         )
       )
     )) AS tagged_media_count;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
-- Run this to confirm functions are fixed:
--
-- SELECT proname, prosecdef, prosrc
-- FROM pg_proc
-- WHERE proname IN ('get_profile_all_media', 'get_profile_stats_media', 'get_profile_tagged_media', 'get_profile_media_counts')
-- AND pronamespace = 'public'::regnamespace;
--
-- Expected: All functions should have 'SET search_path = ''' in their prosrc
-- Expected: All table references should use 'public.' prefix

-- ============================================================================
-- ROLLBACK (If Needed)
-- ============================================================================
-- To remove search_path restriction (NOT RECOMMENDED for security):
-- DROP FUNCTION IF EXISTS public.get_profile_all_media(UUID, UUID, INT, INT);
-- DROP FUNCTION IF EXISTS public.get_profile_stats_media(UUID, UUID, INT, INT);
-- DROP FUNCTION IF EXISTS public.get_profile_tagged_media(UUID, UUID, INT, INT);
-- DROP FUNCTION IF EXISTS public.get_profile_media_counts(UUID, UUID);
-- Then re-run the original setup-profile-media-tabs.sql

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ SUCCESS: Profile media functions updated with schema prefixes';
  RAISE NOTICE '✓ All functions now use public.* for table references';
  RAISE NOTICE '✓ search_path = '''' added for security';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Refresh your profile page';
  RAISE NOTICE '2. Posts should now appear in all tabs';
  RAISE NOTICE '3. If issues persist, check browser console for errors';
END $$;

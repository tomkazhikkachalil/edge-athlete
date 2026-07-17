-- ============================================================================
-- Migration 022 — Fix get_profile_media_counts after migration 020
-- ============================================================================
-- Migration 020 dropped posts.game_id / match_id / race_id. The live
-- get_profile_media_counts() body still referenced p.game_id (in the
-- "stats media count" branch), so the tab-counts endpoint failed with:
--   "column p.game_id does not exist"  (Postgres 42703)
--
-- This version is reconstructed from the ACTUAL live function body (which was
-- schema-qualified with public.* by an earlier search-path hardening) and
-- changes exactly ONE thing: the stats-media predicate drops the three
-- removed sport-FK columns. A post now counts as "stats media" if it has
-- stats_data OR round_id — which still covers the stat-line sports
-- (ice hockey, volleyball, basketball, soccer, baseball) because their data
-- lives in posts.stats_data.
--
-- Everything else (public.* qualification, privacy predicates, SECURITY
-- DEFINER) is preserved exactly. Idempotent (CREATE OR REPLACE).
--
-- ⚠️ Run in the Supabase SQL Editor for project ref: htwhmdoiszhhmwuflgci
--    Watch for a green "Success" — a red error means it did NOT apply.
--    Then verify:
--      SELECT * FROM get_profile_media_counts(
--        '2132330f-e125-43e9-99c1-20bd09e6113f'::uuid, NULL);
--    → should return one row of three numbers, NOT an error.
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
    -- All media count
    (
      SELECT COUNT(DISTINCT p.id)
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
      )
    ) AS all_media_count,

    -- Stats media count — stats_data OR round_id ONLY.
    -- (game_id / match_id / race_id were dropped in migration 020; stat-line
    --  sports flow through stats_data, so coverage is unchanged.)
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR target_profile_id::TEXT = ANY(p.tags)
      )
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
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
    ) AS stats_media_count,

    -- Tagged media count
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
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
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = viewer_id
            AND f.following_id = p.profile_id
            AND f.status = 'accepted'
          )
        )
      )
    ) AS tagged_media_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Verification (run after):
-- SELECT * FROM get_profile_media_counts('2132330f-e125-43e9-99c1-20bd09e6113f'::uuid, NULL);
--   → one row (all/stats/tagged), no error.

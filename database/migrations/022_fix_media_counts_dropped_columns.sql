-- ============================================================================
-- Migration 022 — Fix get_profile_media_counts after migration 020
-- ============================================================================
-- Migration 020 dropped posts.game_id / match_id / race_id. The live
-- get_profile_media_counts() body still referenced p.game_id → the tab-counts
-- endpoint failed with "column p.game_id does not exist" (42703).
--
-- Prior CREATE OR REPLACE attempts did not take effect (a stale/overloaded
-- definition kept winning), so this version is BULLETPROOF: it force-drops
-- EVERY overload of the function by name, then creates the single correct one.
--
-- The only behavioral change vs the live body: the "stats media" predicate is
-- stats_data OR round_id (the dropped sport-FK columns removed). Stat-line
-- sports (hockey, volleyball, basketball, soccer, baseball) still count —
-- their data lives in posts.stats_data.
--
-- ⚠️ Supabase SQL Editor, project ref: htwhmdoiszhhmwuflgci. Run the WHOLE
--    file. Expect green "Success"; then the final SELECT returns one row.
-- ============================================================================

-- 1. Drop every overload of get_profile_media_counts in public (no stale copy).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'get_profile_media_counts'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

-- 2. Create the single correct definition.
CREATE FUNCTION public.get_profile_media_counts(
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

    -- Stats media count — stats_data OR round_id ONLY (dropped columns removed)
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

-- 3. Verify in the same run — should return one row, no error.
SELECT * FROM public.get_profile_media_counts(
  '2132330f-e125-43e9-99c1-20bd09e6113f'::uuid, NULL
);

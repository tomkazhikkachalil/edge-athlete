-- ============================================================================
-- Migration 022 — Fix get_profile_media_counts after migration 020
-- ============================================================================
-- Migration 020 dropped posts.game_id / match_id / race_id (verified 0 rows,
-- 0 APP-SOURCE references). But the get_profile_media_counts() RPC body — which
-- lives in the database, not the repo — still referenced p.game_id, so the
-- media-counts endpoint (tab badges) started failing with:
--   "column p.game_id does not exist"  (Postgres 42703)
--
-- The other three media RPCs (get_profile_all_media / _stats_media /
-- _tagged_media) were already recreated cleanly by migration 018 and are fine
-- — this migration only fixes the counts function.
--
-- The "stats media" definition now matches the idx_posts_stats_media index as
-- recreated in migration 020: a post counts as stats media if it has
-- stats_data OR round_id. This correctly includes the stat-line sports
-- (ice hockey, volleyball, basketball, soccer, baseball) — their data lives in
-- posts.stats_data — so no coverage is lost by removing the dead FK columns.
--
-- Idempotent: CREATE OR REPLACE. Safe to run more than once.
-- ============================================================================

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

    -- Stats media count — stats_data OR round_id (game_id/match_id/race_id
    -- removed in migration 020; stat-line sports flow through stats_data).
    (
      SELECT COUNT(DISTINCT p.id)
      FROM posts p
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

-- Verification:
-- SELECT * FROM get_profile_media_counts('<a profile id>'::uuid, NULL);
--   → returns one row (all/stats/tagged), no error.

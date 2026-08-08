-- ============================================================================
-- Migration 070 — the Stats tab was hiding every SHARED golf round
-- ============================================================================
-- WHAT: one extra disjunct — `OR p.group_post_id IS NOT NULL` — in TWO places:
--   (a) get_profile_stats_media  → the Stats tab GRID
--   (b) get_profile_media_counts → the Stats tab BADGE (stats subquery only)
--
-- WHY: the Stats predicate has always been
--        (stats_data IS NOT NULL AND stats_data != '{}') OR round_id IS NOT NULL
--      and a shared round has NEITHER. A multi-player round posts with
--      `group_post_id` set, `round_id` NULL and `stats_data` NULL (see
--      api/group-posts/route.ts, which writes neither) — its scores live in
--      golf_scorecard_data + golf_participant_scores instead. So the richest
--      stat posts in the product were the only ones the Stats tab excluded,
--      while SOLO rounds (round_id set) showed up fine. That inconsistency is
--      what made it look like a display bug rather than a filter.
--
-- ⚠️ BOTH functions or NEITHER. 068 exists precisely because the grid and the
--    badge drifted apart; changing the grid alone would show a tab reading
--    "Stats 4" that lists 8 items. The tagged subquery is deliberately
--    untouched.
--
-- ⚠️ CREATE OR REPLACE, never DROP. 051 force-dropped get_profile_media_counts
--    (a DO-loop over pg_proc), which silently reset its ACL to the Postgres
--    default — EXECUTE granted to PUBLIC — and wiped 040's pinned search_path;
--    068 had to repair it. CREATE OR REPLACE preserves both, and the signatures
--    here are unchanged, so it is the safe form. The ALTER/REVOKE block at the
--    bottom is belt-and-braces and idempotent.
--
-- ⚠️ ORDER OF OPERATIONS: safe to run ANY TIME — before or after a deploy.
--    No application code depends on this change; the API route and the tiles
--    already handle shared rounds (they render on the Media tab today). This
--    migration only widens which posts the Stats tab is allowed to return.
--
-- PRE-FLIGHT (expect: a count LOWER than the Media tab's for any profile with
-- shared rounds — that gap is the bug):
--   SELECT
--     COUNT(*) FILTER (WHERE stats_data IS NOT NULL AND stats_data != '{}'::jsonb
--                         OR round_id IS NOT NULL)                AS stats_tab_today,
--     COUNT(*) FILTER (WHERE stats_data IS NOT NULL AND stats_data != '{}'::jsonb
--                         OR round_id IS NOT NULL
--                         OR group_post_id IS NOT NULL)           AS stats_tab_after
--   FROM posts WHERE profile_id = '<your-profile-id>';
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- ── (a) get_profile_stats_media — 068 body, one widened predicate ───────────
CREATE OR REPLACE FUNCTION public.get_profile_stats_media(
  target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid,
  media_limit integer DEFAULT 20, media_offset integer DEFAULT 0,
  filter_sport_keys text[] DEFAULT NULL::text[], filter_years integer[] DEFAULT NULL::integer[]
)
RETURNS TABLE(id uuid, caption text, sport_key text, stats_data jsonb, round_id uuid,
  visibility text, created_at timestamp with time zone, profile_id uuid,
  profile_first_name text, profile_last_name text, profile_full_name text,
  profile_avatar_url text, media_count bigint, likes_count integer,
  comments_count integer, saves_count integer, tags text[], hashtags text[],
  is_own_post boolean, is_tagged boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (p.id)
      p.id, p.caption, p.sport_key, p.stats_data, p.round_id, p.visibility,
      p.created_at, p.profile_id,
      prof.first_name AS profile_first_name, prof.last_name AS profile_last_name,
      prof.full_name AS profile_full_name, prof.avatar_url AS profile_avatar_url,
      (SELECT COUNT(*) FROM post_media WHERE post_media.post_id = p.id) AS media_count,
      p.likes_count, p.comments_count, COALESCE(p.saves_count, 0) AS saves_count,
      p.tags, p.hashtags,
      (p.profile_id = target_profile_id) AS is_own_post,
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      (p.profile_id = target_profile_id OR p.tags @> ARRAY[target_profile_id::TEXT])
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        -- 070: shared (multi-player) rounds carry neither stats_data nor
        -- round_id; their scores live in golf_scorecard_data.
        OR p.group_post_id IS NOT NULL
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
    -- Post-OWNER visibility (mirrors 066's get_profile_tagged_media)
    AND (
      prof.visibility = 'public'
      OR (viewer_id IS NOT NULL AND (
        viewer_id = p.profile_id
        OR viewer_id = target_profile_id
        OR EXISTS (
          SELECT 1 FROM follows f2
          WHERE f2.follower_id = viewer_id
          AND f2.following_id = p.profile_id
          AND f2.status = 'accepted'
        )
      ))
    )
    AND (p.status = 'published'
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

-- ── (b) get_profile_media_counts — 068 body, SAME widened predicate ─────────
-- Only the stats subquery changes. all_media has no stats predicate to widen,
-- and tagged is a different question entirely.
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
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
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
      -- Post-owner visibility (mirrors the tagged subquery below)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS all_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        -- 070: must match get_profile_stats_media above, or the badge and the
        -- grid disagree — the exact drift 068 was written to fix.
        OR p.group_post_id IS NOT NULL
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
      -- Post-owner visibility (mirrors the tagged subquery below)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS stats_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE p.tags @> ARRAY[target_profile_id::TEXT]
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
      -- Post-owner visibility (mirrors get_profile_tagged_media)
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.profile_id AND pr.visibility = 'public'
        )
        OR (viewer_id IS NOT NULL AND (
          viewer_id = p.profile_id
          OR viewer_id = target_profile_id
          OR EXISTS (
            SELECT 1 FROM public.follows f2
            WHERE f2.follower_id = viewer_id
            AND f2.following_id = p.profile_id
            AND f2.status = 'accepted'
          )
        ))
      )
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS tagged_media_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public';

-- ── search_path + ACL (040 house rule). CREATE OR REPLACE preserves both, so
--    this is a no-op re-assert — cheap insurance against a future force-drop.
ALTER FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_media_counts(uuid, uuid) SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_media_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Both functions still carry the pinned search_path (expect 2 rows,
--    each with proconfig = {search_path=public}):
--      SELECT proname, proconfig FROM pg_proc
--      WHERE pronamespace = 'public'::regnamespace
--        AND proname IN ('get_profile_stats_media', 'get_profile_media_counts');
--
-- 2. EXECUTE is NOT granted to anon/authenticated (expect no rows):
--      SELECT routine_name, grantee FROM information_schema.routine_privileges
--      WHERE routine_schema = 'public'
--        AND routine_name IN ('get_profile_stats_media', 'get_profile_media_counts')
--        AND grantee IN ('anon', 'authenticated');
--
-- 3. Shared rounds now appear, and the badge matches the grid. For a profile
--    with shared rounds, these two must be EQUAL:
--      SELECT (SELECT stats_media_count FROM get_profile_media_counts('<pid>', '<pid>')) AS badge,
--             (SELECT COUNT(*) FROM get_profile_stats_media('<pid>', '<pid>', 100, 0)) AS grid;
-- ============================================================================

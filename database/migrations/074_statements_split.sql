-- ============================================================================
-- Migration 074 — the statements split: text-only posts leave the Media grid
-- ============================================================================
-- WHAT (four things, one product decision):
--   (a) NEW get_profile_statements_media — the Statements rail's grid
--       function: same membership + privacy as get_profile_all_media, but
--       returning ONLY "statements" (see predicate below).
--   (b) get_profile_all_media gains the exact INVERSE predicate, so the
--       Media tab becomes genuinely media/stats-only. (a) + (b) partition
--       the old all-tab result set: all_new + statements = all_old.
--   (c) get_profile_media_counts grows a fourth column, statements_count.
--       Its RETURNS shape changes, so CREATE OR REPLACE is impossible —
--       this migration DROPs and recreates it. ⚠️ THE DROP RESETS THE ACL
--       TO "EXECUTE granted to PUBLIC" AND WIPES THE PINNED search_path
--       (the 051 regression that 068 had to repair). The ALTER/REVOKE tail
--       is therefore REQUIRED, not belt-and-braces. Run this file as ONE
--       SQL-editor execution so drop + recreate + revoke land in a single
--       transaction.
--   (d) CREATE INDEX on post_media(post_id) — the new NOT EXISTS probe
--       walks it per candidate row. The index existed only in archived
--       legacy scripts (database/archive/old-migrations/
--       supabase-posts-schema.sql), never in a numbered migration — the
--       same gap 072 closed for post_comments.parent_comment_id.
--
-- THE PREDICATES (canonical — every body below uses these verbatim):
--   STATEMENT (a text-only post; no portfolio content):
--         (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
--     AND p.round_id IS NULL
--     AND p.group_post_id IS NULL
--     AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
--   MEDIA (the exact inverse — a post that belongs in the portfolio):
--         (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
--     OR p.round_id IS NOT NULL
--     OR p.group_post_id IS NOT NULL
--     OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
--   A future repost (posts.shared_post_id, not built yet) with no media or
--   stats of its own satisfies STATEMENT by construction — do NOT add a
--   shared_post_id disjunct when that feature lands.
--
-- WHY: product decision (Aug 10 2026): a post that is just a statement is
-- feed content, not portfolio content. The profile's Media grid should hold
-- only media/stats/round posts; statements move to a horizontal rail above
-- the tabs. The profile "Posts" stat (fed by all_media_count) becomes
-- media-only — a DELIBERATE, visible drop in every athlete's post count the
-- moment this runs. Tagged is untouched: statements you're tagged in still
-- appear there (it means "posts you're tagged in", both kinds).
--
-- ⚠️ BOTH functions or NEITHER (the 068/070 invariant): the all-grid
--    function and the all-counts subquery change together here, and the new
--    statements grid + statements count are born together.
--
-- ORDER OF OPERATIONS: run AFTER the app deploy that carries the Statements
-- rail (PR feat/statements-split). The RPC bodies are what move statements
-- out of the grid — the instant this runs, statements vanish from the Media
-- tab on WHATEVER app version is live. Before the deploy that renders the
-- rail, they'd be reachable only via the feed and Tagged. The app tolerates
-- the missing pieces in the other direction (statements tab 500s → rail
-- renders nothing; missing counts column → 0), so app-first is the safe
-- order.
--
-- PRE-FLIGHT (record the outputs — the VERIFY identity needs them):
--   1. Busy profile's counts (record all_media_count):
--        SELECT * FROM public.get_profile_media_counts('<pid>'::uuid, '<pid>'::uuid);
--   2. Index absent from live (expect 0 rows; archived legacy script may
--      have created it on old instances — IF NOT EXISTS handles either):
--        SELECT indexname FROM pg_indexes
--        WHERE tablename = 'post_media' AND indexname = 'idx_post_media_post_id';
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

-- ── (d) index first, so the NOT EXISTS probes below are indexed ─────────────
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media (post_id);

-- ── (a) get_profile_statements_media — NEW ──────────────────────────────────
-- Byte-for-byte the 068 get_profile_all_media body (same signature, same
-- RETURNS shape — the API route reuses its entire row pipeline), plus the
-- STATEMENT predicate. Born with the Postgres default ACL (EXECUTE to
-- PUBLIC) — the REVOKE tail below is what locks it to service-role.
CREATE OR REPLACE FUNCTION public.get_profile_statements_media(
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
      p.profile_id = target_profile_id
      OR p.tags @> ARRAY[target_profile_id::TEXT]
    )
    -- 074: STATEMENT predicate — text-only posts only
    AND (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
    AND p.round_id IS NULL
    AND p.group_post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
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

-- ── (b) get_profile_all_media — 068 body + MEDIA inverse predicate ──────────
-- Signature and RETURNS unchanged → CREATE OR REPLACE is the safe form
-- (preserves ACL + pinned search_path, per 070's warning).
CREATE OR REPLACE FUNCTION public.get_profile_all_media(
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
      p.profile_id = target_profile_id
      OR p.tags @> ARRAY[target_profile_id::TEXT]
    )
    -- 074: MEDIA inverse predicate — statements moved to
    -- get_profile_statements_media; together they partition the old set.
    AND (
      (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
      OR p.round_id IS NOT NULL
      OR p.group_post_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
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

-- ── (c) get_profile_media_counts — DROP + recreate with statements_count ────
-- The RETURNS shape changes, so this is the one function where DROP is
-- unavoidable. See the header warning: the tail block re-pins and re-REVOKEs.
DROP FUNCTION IF EXISTS public.get_profile_media_counts(uuid, uuid);

CREATE FUNCTION public.get_profile_media_counts(
  target_profile_id UUID,
  viewer_id UUID DEFAULT NULL
)
RETURNS TABLE (
  all_media_count BIGINT,
  stats_media_count BIGINT,
  tagged_media_count BIGINT,
  statements_count BIGINT
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
      -- 074: MEDIA inverse predicate — must match get_profile_all_media
      -- above, or the badge and the grid disagree (the 068 drift).
      AND (
        (p.stats_data IS NOT NULL AND p.stats_data != '{}'::jsonb)
        OR p.round_id IS NOT NULL
        OR p.group_post_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
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
        -- 070: must match get_profile_stats_media, or the badge and the
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
    ) AS tagged_media_count,
    (
      SELECT COUNT(DISTINCT p.id)
      FROM public.posts p
      WHERE (
        p.profile_id = target_profile_id
        OR p.tags @> ARRAY[target_profile_id::TEXT]
      )
      -- 074: STATEMENT predicate — must match get_profile_statements_media
      -- above (born together, drift never).
      AND (p.stats_data IS NULL OR p.stats_data = '{}'::jsonb)
      AND p.round_id IS NULL
      AND p.group_post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
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
      -- Post-owner visibility (mirrors the tagged subquery above)
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
    ) AS statements_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public';

-- ── search_path + ACL (040 house rule). REQUIRED for the two functions the
--    DROP/CREATE above reset (counts) or created fresh (statements); the
--    other two are idempotent re-asserts.
ALTER FUNCTION public.get_profile_statements_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_media_counts(uuid, uuid) SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION public.get_profile_statements_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_media_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Pins + ACLs (expect: 4 rows, each with proconfig containing
--    search_path=public and anon_can_exec false — especially the counts
--    function, which the DROP reset, and the statements function, which was
--    born with PUBLIC EXECUTE):
--      SELECT oid::regprocedure AS fn, proconfig,
--             has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_exec
--      FROM pg_proc
--      WHERE pronamespace = 'public'::regnamespace
--        AND proname IN ('get_profile_all_media', 'get_profile_stats_media',
--                        'get_profile_statements_media', 'get_profile_media_counts');
--
-- 2. The partition identity — for the busy profile from pre-flight, the new
--    all + statements must equal the RECORDED pre-migration all_media_count:
--      SELECT all_media_count, statements_count,
--             all_media_count + statements_count AS should_equal_old_all
--      FROM public.get_profile_media_counts('<pid>'::uuid, '<pid>'::uuid);
--
-- 3. Badge == grid for both changed surfaces (both pairs must be EQUAL):
--      SELECT (SELECT all_media_count  FROM public.get_profile_media_counts('<pid>', '<pid>')) AS all_badge,
--             (SELECT COUNT(*) FROM public.get_profile_all_media('<pid>', '<pid>', 500, 0)) AS all_grid,
--             (SELECT statements_count FROM public.get_profile_media_counts('<pid>', '<pid>')) AS stmt_badge,
--             (SELECT COUNT(*) FROM public.get_profile_statements_media('<pid>', '<pid>', 500, 0)) AS stmt_grid;
--
-- 4. Zero overlap — no post may be in both grids (expect 0):
--      SELECT COUNT(*) FROM public.get_profile_all_media('<pid>', '<pid>', 500, 0) a
--      JOIN public.get_profile_statements_media('<pid>', '<pid>', 500, 0) s ON s.id = a.id;
--
-- 5. Privacy spot-check (the 068 QA pair): private author P's published
--    public statement tagging public T — ABSENT from
--    get_profile_statements_media(T, NULL, …); PRESENT for viewer P, T, or
--    an accepted follower of P. A draft statement visible only to its owner.
--
-- 6. The NOT EXISTS probe is indexed (plan should show an index scan on
--    idx_post_media_post_id):
--      EXPLAIN SELECT COUNT(*) FROM public.posts p
--      WHERE p.profile_id = '<pid>'::uuid
--        AND NOT EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id);
-- ============================================================================

-- ============================================================================
-- Migration 068 — All/Stats media: post-OWNER visibility (the 066 backlog)
-- ============================================================================
-- WHAT (three things):
--   (a) get_profile_all_media + get_profile_stats_media gain the same
--       post-OWNER visibility clause 066 gave the tagged surfaces: a PRIVATE
--       author's posts tagging the target no longer render (with the author's
--       name and avatar) in the target's All/Stats grids unless the viewer is
--       the author, the target (the tagged athlete), or an accepted follower
--       of the author. This was a CONTENT leak, not just a count skew — the
--       tiles rendered for anonymous viewers. The clause is applied uniformly,
--       with no self-authored carve-out: for self-authored posts the owner IS
--       the target, and every viewer the app-layer profile gate admits
--       satisfies the clause (public target ⇒ prof.visibility = 'public';
--       private target ⇒ viewer is owner/target/accepted follower), so
--       legitimate viewers see exactly what they saw before.
--   (b) get_profile_media_counts: identical clause (EXISTS form — no profiles
--       join in scope) on the all/stats subqueries, so tab badges always
--       equal grid contents for every viewer. Tagged subquery unchanged.
--   (c) ACL + search_path repair for get_profile_media_counts: 051
--       force-DROPPED it (DO-loop over pg_proc), which silently reset its ACL
--       to the Postgres default — EXECUTE granted to PUBLIC — and wiped 040's
--       pinned search_path. 066's CREATE OR REPLACE preserved that broken
--       state (its header's "040's REVOKEs survive" was true for the tagged
--       function, wrong for this one). Until this migration runs, the counts
--       RPC is directly callable via PostgREST by anon/authenticated with an
--       arbitrary viewer_id, bypassing the app-layer privacy gate. Re-pin and
--       re-REVOKE; the two grid functions get the same statements as
--       belt-and-braces (their 040 ACLs were never dropped and their
--       definitions carry SET search_path inline).
-- Also: the all/stats membership predicates and the is_tagged projection
-- switch from target::TEXT = ANY(p.tags) to the containment form
-- p.tags @> ARRAY[target::TEXT] that idx_posts_tags_gin (066) accelerates.
-- Semantically identical for single-element membership; retires the
-- asymmetry 066 recorded.
--
-- ORDER OF OPERATIONS: fully order-independent with app deploys — same
-- signatures, same RETURNS shapes, no app code change (the only callers, in
-- src/app/api/profile/[profileId]/media/route.ts, use the service-role
-- client and already pass viewer_id). Run any time. The e2e tagged spec's
-- 068 pins fail until this has run against the target DB.
--
-- PRE-FLIGHT (expect: exactly three rows — the two 6-arg grid functions with
-- proconfig {search_path=public} and anon_can_exec false, and the 2-arg
-- counts function showing the 051 regression: proconfig NULL and
-- anon_can_exec true):
--   SELECT oid::regprocedure AS fn, proconfig,
--          has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_exec
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('get_profile_all_media', 'get_profile_stats_media',
--                     'get_profile_media_counts');
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- ── (a1) get_profile_all_media — 051 body + owner clause + containment ──────
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

-- ── (a2) get_profile_stats_media — same three edits ─────────────────────────
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

-- ── (b) get_profile_media_counts — 066 body + owner clause on all/stats ─────
-- Now carries SET search_path inline (051/066 omitted it; body names stay
-- fully qualified regardless).
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

-- ── (c) search_path + ACL repair (040 house rule; 051 wiped the counts') ────
ALTER FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_media_counts(uuid, uuid) SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_media_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Pins + ACLs (expect: proconfig contains search_path=public on ALL three
--    rows; anon_can_exec false on all three):
--      SELECT oid::regprocedure AS fn, proconfig,
--             has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_exec
--      FROM pg_proc
--      WHERE pronamespace = 'public'::regnamespace
--        AND proname IN ('get_profile_all_media', 'get_profile_stats_media',
--                        'get_profile_media_counts');
--
-- 2. Functions still return (any profile id):
--      SELECT count(*) FROM public.get_profile_all_media(
--        (SELECT p.id FROM public.profiles p LIMIT 1), NULL, 50, 0, NULL, NULL);
--      SELECT * FROM public.get_profile_media_counts(
--        (SELECT p.id FROM public.profiles p LIMIT 1), NULL);
--
-- 3. Behavioral: pick a PRIVATE profile P that authored a published public
--    post tagging a PUBLIC profile T (the QA pair from e2e/tagged.spec.ts
--    works). Expect the post ABSENT from get_profile_all_media(T, NULL, …)
--    and get_profile_stats_media(T, NULL, …); PRESENT with viewer_id = P, T,
--    or an accepted follower of P; and for each viewer,
--    get_profile_media_counts(T, viewer).all_media_count equal to the row
--    count of the matching all-grid call (badge == grid).
--
-- 4. Optional — the membership predicate can now use the GIN index:
--      EXPLAIN SELECT count(*) FROM public.posts p
--      WHERE p.profile_id = '<T>'::uuid OR p.tags @> ARRAY['<T>'::TEXT];
-- ============================================================================

-- ============================================================================
-- 051 — posts.status: approval-queue lifecycle (guardian-profiles feature)
-- ============================================================================
-- ⚠️ Run AFTER 050. Run BEFORE flipping FEATURE_GUARDIAN_PROFILES on.
-- Safe pre-deploy: DEFAULT 'published' grandfathers every existing row, and
-- app-side status filters are feature-flag-gated, so nothing changes until
-- the flag flips AND supervised users exist.
--
-- Supervised minors' posts land as 'pending_approval'; a guardian approves
-- ('published') or rejects. Read surfaces must not leak pending posts:
-- the four DB-side readers are rewritten here with a status predicate
-- (owner exception: authors see their own pending posts in their grids).
-- Bodies are the LIVE definitions from the Phase-0 dump
-- (database/docs/PHASE0_GUARDIAN_RECONCILIATION.md) + the status predicate —
-- no other behavioral change.
-- ============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('published','pending_approval','rejected'));

-- Approval-queue scans (per-profile pending lookups)
CREATE INDEX IF NOT EXISTS idx_posts_status_pending
  ON posts (profile_id) WHERE status <> 'published';

-- ── Shared status predicate used below ─────────────────────────────────────
--   AND (p.status = 'published'
--        OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))

-- ── get_profile_all_media ──────────────────────────────────────────────────
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

-- ── get_profile_stats_media ────────────────────────────────────────────────
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
      (target_profile_id::TEXT = ANY(p.tags)) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      (p.profile_id = target_profile_id OR target_profile_id::TEXT = ANY(p.tags))
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

-- ── get_profile_tagged_media ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profile_tagged_media(
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

-- ── get_profile_media_counts (022's force-drop pattern — overload history) ──
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'get_profile_media_counts'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

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
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS all_media_count,
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
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS stats_media_count,
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
      AND (p.status = 'published'
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id))
    ) AS tagged_media_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── search_posts: published only ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_posts(search_query text, max_results integer DEFAULT 15)
RETURNS TABLE(id uuid, caption text, sport_key text, created_at timestamp with time zone, profile_id uuid, rank real)
LANGUAGE plpgsql STABLE
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY SELECT
    po.id, po.caption, po.sport_key, po.created_at, po.profile_id,
    ts_rank(po.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.posts po
  WHERE po.visibility = 'public'
  AND po.status = 'published'
  AND po.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, po.created_at DESC
  LIMIT max_results;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification
-- ============================================================================
-- 1. Column + default:
--    SELECT count(*) FROM posts WHERE status = 'published';
--    -- expect: equal to total posts count (all grandfathered)
-- 2. Media RPC still returns rows for an existing profile:
--    SELECT count(*) FROM public.get_profile_all_media(
--      (SELECT id FROM profiles LIMIT 1), NULL, 50, 0, NULL, NULL);
-- 3. Counts RPC single row:
--    SELECT * FROM public.get_profile_media_counts(
--      (SELECT id FROM profiles LIMIT 1), NULL);
-- 4. A pending post is invisible to strangers (synthetic check):
--    -- UPDATE one of your own test posts to pending_approval, confirm it
--    -- vanishes from get_profile_all_media with viewer_id=NULL, reappears
--    -- with viewer_id=<author>, then set it back to 'published'.
-- ============================================================================

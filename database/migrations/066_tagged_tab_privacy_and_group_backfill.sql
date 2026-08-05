-- ============================================================================
-- Migration 066 — Tagged tab: privacy hardening + group-round backfill
-- ============================================================================
-- WHAT (five things, in order):
--   (a) GIN index on posts.tags + containment-form predicates so the tagged
--       queries stop sequentially scanning posts.
--   (b) get_profile_tagged_media gains the post-OWNER visibility clause that
--       021_rpc_visibility_hardening.sql described and never implemented: a
--       PRIVATE profile's public posts no longer appear (with the author's
--       name and avatar) on other people's Tagged tabs for anonymous or
--       unrelated viewers. The tagged athlete themself still sees the post —
--       being tagged is the author's explicit action and already notified.
--   (c) get_profile_media_counts: same owner clause on the tagged subquery
--       (the all/stats subqueries share the hole; recorded backlog, not here).
--   (d) NEW get_profile_tagged_summary — one aggregate over the same hardened
--       predicate returning (times_tagged, tagger_count, sport_keys, years).
--       Powers the Tagged tab's all-time hero tiles and its real-data filter
--       options in a single round trip.
--   (e) Backfill: group-round mirror posts get tags = participants (author
--       excluded, declined excluded). posts.tags ONLY — the tag-notification
--       trigger lives on post_tags inserts, so this is structurally
--       notification-free. Guarded on empty tags → idempotent/rerunnable
--       (mirror posts are always created with '{}' and EditPostModal never
--       writes taggedProfiles, so non-empty means already processed).
--
-- ⚠️ ORDER OF OPERATIONS: run BEFORE deploying the PR that ships the
-- /api/profile/[profileId]/tagged-summary route (it 500s without (d)).
-- Running early breaks nothing: (b)/(c) are same-signature CREATE OR REPLACE
-- (existing 040 REVOKEs survive), (e) only fills arrays no reader displays
-- differently today.
--
-- If the auto-tag write-path PR deploys AFTER this migration ran, re-run
-- statement (e) once — rounds created in the gap get caught; the guard makes
-- it a no-op for everything else.
--
-- PRE-FLIGHT (expect: 0 rows — no mirror post has tags yet):
--   SELECT COUNT(*) FROM posts WHERE group_post_id IS NOT NULL
--     AND tags IS NOT NULL AND tags <> '{}';
-- DRY-RUN of (e) (inspect before running the UPDATE):
--   SELECT p.id, p.group_post_id, sub.tag_ids
--   FROM posts p
--   JOIN (SELECT gpp.group_post_id,
--                array_agg(DISTINCT gpp.profile_id::TEXT) AS tag_ids
--         FROM group_post_participants gpp
--         WHERE gpp.status <> 'declined'
--         GROUP BY gpp.group_post_id) sub
--     ON p.group_post_id = sub.group_post_id
--   WHERE (p.tags IS NULL OR p.tags = '{}');
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- ── (a) Index the containment predicate ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_posts_tags_gin ON public.posts USING GIN (tags);

-- ── (b) get_profile_tagged_media: owner-visibility clause + GIN predicate ───
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
      (p.tags @> ARRAY[target_profile_id::TEXT]) AS is_tagged
    FROM posts p
    INNER JOIN profiles prof ON p.profile_id = prof.id
    WHERE (
      p.tags @> ARRAY[target_profile_id::TEXT]
      AND p.profile_id != target_profile_id
    )
    -- Post-level visibility (unchanged from 051)
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
    -- Post-OWNER visibility (the 021 hardening, finally): a private author's
    -- posts are shown only to the author, the tagged athlete, or the
    -- author's accepted followers.
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

-- ── (c) get_profile_media_counts: owner clause on the tagged subquery ───────
-- Same signature as 051 → plain CREATE OR REPLACE; 040's REVOKEs survive.
-- all/stats subqueries deliberately untouched (their shared owner-visibility
-- hole is recorded backlog — changing them changes All/Stats tab behavior).
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── (d) NEW get_profile_tagged_summary — hero stats + filter options ────────
-- Same hardened predicate as (b), no filters/limit. sport_keys/years feed the
-- Tagged tab's real-data filter dropdowns; the counts feed the hero tiles.
CREATE OR REPLACE FUNCTION public.get_profile_tagged_summary(
  target_profile_id uuid, viewer_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE (
  times_tagged bigint,
  tagger_count bigint,
  sport_keys text[],
  years integer[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT p.id) AS times_tagged,
    COUNT(DISTINCT p.profile_id) AS tagger_count,
    COALESCE(array_agg(DISTINCT p.sport_key) FILTER (WHERE p.sport_key IS NOT NULL), '{}') AS sport_keys,
    COALESCE(array_agg(DISTINCT EXTRACT(YEAR FROM p.created_at)::INT) FILTER (WHERE p.id IS NOT NULL), '{}') AS years
  FROM posts p
  INNER JOIN profiles prof ON p.profile_id = prof.id
  WHERE (
    p.tags @> ARRAY[target_profile_id::TEXT]
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
       OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id));
END;
$function$;

-- Admin-client-only, like every get_profile_* RPC (040 house rule).
REVOKE EXECUTE ON FUNCTION public.get_profile_tagged_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── (e) Backfill group-round mirror posts ───────────────────────────────────
-- posts.tags only; the notify trigger lives on post_tags → notification-free.
-- Empty-tags guard makes it rerunnable and unable to clobber manual edits.
UPDATE public.posts p
SET tags = array_remove(sub.tag_ids, p.profile_id::TEXT)
FROM (
  SELECT gpp.group_post_id,
         array_agg(DISTINCT gpp.profile_id::TEXT) AS tag_ids
  FROM public.group_post_participants gpp
  WHERE gpp.status <> 'declined'
  GROUP BY gpp.group_post_id
) sub
WHERE p.group_post_id = sub.group_post_id
  AND (p.tags IS NULL OR p.tags = '{}')
  AND array_length(array_remove(sub.tag_ids, p.profile_id::TEXT), 1) > 0;

-- ── (f) PostgREST: pick up the new function ─────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- VERIFY (expect: index present; 4 columns from the summary; mirror posts of
-- multi-participant rounds now carry participant tags):
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'posts' AND indexname = 'idx_posts_tags_gin';
--   SELECT * FROM get_profile_tagged_summary('00000000-0000-0000-0000-000000000000'::uuid);
--   SELECT COUNT(*) FROM posts WHERE group_post_id IS NOT NULL AND tags <> '{}';

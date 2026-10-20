-- ============================================================================
-- 269: the feed is a switch; training is Training's (Oct 19 2026; the flow
--      changes program, item 3 — sports vs training. Runs on BOTH staging
--      and prod BEFORE C2 deploys. Old code never reads the new columns; the
--      re-declared readers move training tiles out of Media and Stats the
--      moment this runs — the product rule, by decision.)
-- ============================================================================
-- Tom (Oct 19): "Sports appear on the user's profile, under Media and Stats.
-- Activities and training appear on the Training tab. Both can also be posted
-- to the feed — the user chooses this each time they post. The feed toggle
-- only controls whether it's also posted to the feed; it doesn't hide it
-- from the profile." And: "Only me" is DROPPED — everything finished lands
-- on the profile per account privacy; hiding later is the item's menu.
--
-- The model (Convention 47, docs/specs/feed-and-posts.md):
--   posts.on_feed                 true (default) = on the feed too. NOT an
--                                 audience (Convention 39 stands): a feed-side
--                                 reader filters it; a profile-side reader
--                                 never does. No index — not selective.
--   workout_sessions.profile_hidden_at  the owner hid this workout from their
--                                 profile (241's shape for rounds). Replaces
--                                 "Keep private", which never hid anything.
--   the five profile RPCs         VERBATIM from 253 with one block at FOUR
--                                 sites (get_profile_all_media,
--                                 get_profile_stats_media, and the counts'
--                                 all_media_count / stats_media_count):
--                                   post_category IS DISTINCT FROM 'training'
--                                   AND stats_data->>'type' IS DISTINCT FROM 'activity'
--                                 — IS DISTINCT FROM because post_category is
--                                 nullable (077); the second clause covers
--                                 Sep 29 – Oct 1 activity shares that predate
--                                 the category. tagged / statements untouched.
--   feed_following                VERBATIM from 230 plus `p.on_feed` — the
--                                 route computes hasMore from the page it
--                                 hydrates, so an off-feed row must never
--                                 reach it.
-- Backfills, idempotent, IN THIS ORDER: (1) a sport-bridged activity post
-- ("Post as a Cycling result") was stamped post_category 'training' by the
-- writer — a SPORT result, it loses the category so it stays in Stats;
-- (2) a workout the owner kept private is honoured as hidden; (3) every
-- completed workout without a share decision gets one (the "Ready to post"
-- notion retires — Finish is the decision).
--
-- REVERSAL (data-safe): re-declare the five RPCs from 253 and feed_following
-- from 230; DROP COLUMN posts.on_feed, workout_sessions.profile_hidden_at.
-- Re-runnable until the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 269) THEN
    RAISE EXCEPTION '269 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 268 THEN RAISE EXCEPTION '269 pre-flight: ledger head is %, expected 268', n; END IF;
END $$;

-- ── 1. posts.on_feed: the switch ────────────────────────────────────────────
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS on_feed boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.posts.on_feed IS 'The feed switch (269): true = also on the feed. Never an audience — the account decides who sees the post; this only says whether the feed lists it. Profile readers ignore it.';

-- ── 2. workout_sessions.profile_hidden_at: the owner''s later Hide ──────────
ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS profile_hidden_at timestamptz;
COMMENT ON COLUMN public.workout_sessions.profile_hidden_at IS 'The owner hid this workout from their profile (269; 241''s shape). Viewers'' Training lists skip it; the owner keeps it.';

-- ── 3. Backfills (idempotent, in this order) ────────────────────────────────
-- (1) a sport-bridged activity post is a SPORT result, not training
UPDATE public.posts
   SET post_category = NULL
 WHERE post_category = 'training'
   AND sport_key IS NOT NULL AND sport_key <> 'general'
   AND stats_data->>'type' = 'stat_line';
-- (2) an explicit Keep private is honoured as hidden
UPDATE public.workout_sessions
   SET profile_hidden_at = share_decided_at
 WHERE status = 'completed' AND post_id IS NULL AND share_decided_at IS NOT NULL AND profile_hidden_at IS NULL;
-- (3) Finish is the decision: every completed workout has one
UPDATE public.workout_sessions
   SET share_decided_at = COALESCE(ended_at, timezone('utc'::text, now()))
 WHERE status = 'completed' AND share_decided_at IS NULL;

-- ── 4. The five profile RPCs — verbatim from 253 with the training predicate
--       at four sites (every 253 owner arm kept: `p.status <> 'draft'`) ──────
--    `AND p.status <> 'draft'` in every owner arm (a draft is never a tile,
--    not even the owner's; the Drafts area is the place).

-- ── get_profile_tagged_media (066; 1 owner arm changed) ──

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
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

-- ── get_profile_stats_media (070; 1 owner arm changed) ──

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
      -- 269: training is Training's, not Stats' (Convention 47)
      AND p.post_category IS DISTINCT FROM 'training'
      AND (p.stats_data->>'type') IS DISTINCT FROM 'activity'
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
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

-- ── get_profile_statements_media (074; 1 owner arm changed) ──

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
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

-- ── get_profile_all_media (074; 1 owner arm changed) ──

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
    -- 269: training is Training's, not Media's (Convention 47)
    AND p.post_category IS DISTINCT FROM 'training'
    AND (p.stats_data->>'type') IS DISTINCT FROM 'activity'
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
         OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
    AND (filter_sport_keys IS NULL OR p.sport_key = ANY(filter_sport_keys))
    AND (filter_years IS NULL OR EXTRACT(YEAR FROM p.created_at)::INT = ANY(filter_years))
    ORDER BY p.id, p.created_at DESC
  ) AS unique_posts
  ORDER BY created_at DESC
  LIMIT media_limit
  OFFSET media_offset;
END;
$function$;

-- ── get_profile_media_counts (074; 4 owner arms changed) ──

CREATE OR REPLACE FUNCTION public.get_profile_media_counts(
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
      -- 269: must match get_profile_all_media above (Convention 47)
      AND p.post_category IS DISTINCT FROM 'training'
      AND (p.stats_data->>'type') IS DISTINCT FROM 'activity'
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
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
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
      -- 269: must match get_profile_stats_media above (Convention 47)
      AND p.post_category IS DISTINCT FROM 'training'
      AND (p.stats_data->>'type') IS DISTINCT FROM 'activity'
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
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
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
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
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
           OR (viewer_id IS NOT NULL AND viewer_id = p.profile_id AND p.status <> 'draft'))
    ) AS statements_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public';

-- ── search_path + ACL (040 house rule): CREATE OR REPLACE keeps both, but
--    re-asserted so this file stands alone.
ALTER FUNCTION public.get_profile_tagged_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_statements_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_media_counts(uuid, uuid) SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION public.get_profile_tagged_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_statements_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_media_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;


-- the service role keeps EXECUTE (253's ACL rule)
GRANT EXECUTE ON FUNCTION public.get_profile_tagged_media(uuid, uuid, integer, integer, text[], integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_statements_media(uuid, uuid, integer, integer, text[], integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_media_counts(uuid, uuid) TO service_role;

-- ── 5. feed_following — verbatim from 230 plus p.on_feed ────────────────────
CREATE OR REPLACE FUNCTION public.feed_following(
  p_viewer     uuid,
  p_limit      integer,
  p_cursor_ts  timestamptz DEFAULT NULL,
  p_cursor_id  uuid        DEFAULT NULL,
  p_offset     integer     DEFAULT 0
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id
    FROM public.posts p
   WHERE p.on_feed
     -- 269: the feed is a SWITCH (Convention 47) — an off-feed post stays on the profile and off every lens.
     AND (p.profile_id = p_viewer
          OR EXISTS (SELECT 1 FROM public.follows f
                      WHERE f.follower_id = p_viewer
                        AND f.following_id = p.profile_id
                        AND f.status = 'accepted'))
     AND (p_cursor_ts IS NULL
          OR p.created_at < p_cursor_ts
          OR (p.created_at = p_cursor_ts AND p.id < p_cursor_id))
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT GREATEST(1, LEAST(p_limit, 101))
  OFFSET GREATEST(0, p_offset);
$$;

REVOKE EXECUTE ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) IS
  '230 + 269: one page of post ids for the following lens (self + accepted followees), newest first with the id tiebreak, on-feed posts only (269); the route applies the privacy filter. Service-role only.';


NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (269, '269_feed_switch_training_buckets.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 269 APPLIED | true | true | 3 | true | 0 | 0 | 269
SELECT '269 APPLIED' AS result,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'on_feed') AS on_feed_column,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workout_sessions' AND column_name = 'profile_hidden_at') AS hidden_column,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
          AND p.proname IN ('get_profile_all_media', 'get_profile_stats_media', 'get_profile_media_counts')
          AND p.prosrc LIKE '%IS DISTINCT FROM ''training''%') AS rpcs_with_predicate_expect_3,
       (SELECT p.prosrc LIKE '%p.on_feed%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'feed_following') AS feed_following_filters_on_feed,
       (SELECT count(*) FROM public.posts WHERE post_category = 'training' AND sport_key IS NOT NULL AND sport_key <> 'general' AND stats_data->>'type' = 'stat_line') AS bridged_rows_still_training_expect_0,
       (SELECT count(*) FROM public.workout_sessions WHERE status = 'completed' AND share_decided_at IS NULL) AS undecided_completed_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_269;

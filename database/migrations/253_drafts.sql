-- ============================================================================
-- 253: drafts — Finish and Post are two actions (Drafts round PR 1, Oct 6 2026;
--      runs on BOTH staging and prod; the ONE migration of the program)
-- ============================================================================
-- Tom: a golf round started and abandoned partway showed up on the feed and
-- the profile. The round's feed post was inserted 'published' the moment the
-- round STARTED; the only thing hiding it was a JavaScript filter in the feed
-- listing, skipped on purpose for profile lists, and never applied by the
-- profile RPCs, explore, search or the public profile.
--
-- The rule now: a recorded thing is IN PROGRESS, then a DRAFT (finished,
-- reviewed, not yet posted), then POSTED — by an explicit Post. Nothing is
-- ever auto-posted. 'draft' is a POST STATUS (the 223 / 241 pattern): every
-- published-only reader skips it for free, and the OWNER arms — the feed's
-- "or mine" and the five profile RPCs' viewer_id = p.profile_id arm — must
-- EXCLUDE it (the lesson of 241 / #1039: a status alone does not hide a row
-- from its owner). The owner finds drafts in ONE place, the Drafts area.
--
--   1. posts_status_check += 'draft'. 051's partial index on status <>
--      'published' already serves the owner's draft list.
--   2. workout_sessions.share_decided_at — "Keep private" on a finished
--      workout used to write nothing, so the server could not tell "chose to
--      keep it private" from "never reached the share decision" (a draft).
--      Share and Keep private both stamp it.
--   3. The five profile RPCs re-declared VERBATIM from their last declaration
--      (066: tagged; 070: stats; 074: statements, all, counts) with ONE
--      change in each owner arm: AND p.status <> 'draft'. The provenance
--      check compares the live body to the chain's last text — this file is
--      that text now.
--   4. Backfill: the posts of casual rounds (sport_event_round_id IS NULL)
--      still pending, active or cancelled are 'draft' from here — today's
--      leak closed on prod's existing rows. A completed round's published
--      post stays published (it was posted). Event rounds never draft.
--
-- Pre-flight: ledger head 252. Deploy order: THIS FILE BEFORE the code —
-- the code inserts status 'draft', which 241's CHECK refuses.
-- Reversal (data-safe): UPDATE posts SET status='published' WHERE
-- status='draft'; re-declare the five functions as 066/070/074 recorded
-- them; DROP the column; restore 241's CHECK.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 253) THEN
    RAISE EXCEPTION '253 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 252 THEN RAISE EXCEPTION '253 pre-flight: ledger head is %, expected 252', n; END IF;
END $$;

-- ── 1. posts: a draft is a status ───────────────────────────────────────────
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('published', 'pending_approval', 'rejected', 'changes_requested', 'hidden', 'profile_hidden', 'draft'));
COMMENT ON COLUMN public.posts.status IS 'published (the feed) · pending_approval / rejected / changes_requested (a supervised author''s approval queue, 051/129) · hidden (moderation, 223) · profile_hidden (the owner''s hide, 241) · draft (253: recorded, not yet posted — the owner''s Drafts area only; the ONE writer of draft → published is src/lib/posts/publish-server.ts).';

-- ── 2. workout_sessions: the share decision is a fact ───────────────────────
ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS share_decided_at timestamptz;
COMMENT ON COLUMN public.workout_sessions.share_decided_at IS 'Drafts (253): when the owner chose Share or Keep private for a finished workout. NULL on a completed session = a draft (never reached the decision).';

-- ── 3. The five profile RPCs — verbatim from their last declaration, with
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

-- ── 4. Backfill: today's in-flight and abandoned casual rounds are drafts ───
UPDATE public.posts p SET status = 'draft'
FROM public.group_posts g
WHERE p.group_post_id = g.id
  AND p.status = 'published'
  AND g.type = 'golf_round'
  AND g.sport_event_round_id IS NULL
  AND g.status IN ('pending', 'active', 'cancelled');

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (253, '253_drafts.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on both environments: 253 APPLIED | true | 1 | 5 | 0 | 253
SELECT '253 APPLIED' AS result,
       (SELECT pg_get_constraintdef(oid) LIKE '%''draft''%' FROM pg_constraint
         WHERE conname = 'posts_status_check' AND conrelid = 'public.posts'::regclass) AS check_names_draft_expect_true,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workout_sessions'
         AND column_name = 'share_decided_at') AS new_column_expect_1,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('get_profile_tagged_media', 'get_profile_stats_media', 'get_profile_statements_media', 'get_profile_all_media', 'get_profile_media_counts')
         AND prosrc LIKE '%p.status <> ''draft''%') AS rpcs_excluding_draft_expect_5,
       (SELECT count(*) FROM public.posts p JOIN public.group_posts g ON g.id = p.group_post_id
         WHERE p.status = 'published' AND g.type = 'golf_round' AND g.sport_event_round_id IS NULL
         AND g.status IN ('pending', 'active', 'cancelled')) AS leaked_round_posts_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_253;

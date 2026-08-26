-- ============================================================================
-- Migration 126 — efficiency RPCs, posts keyset index, RLS initplan wrapping
-- ============================================================================
-- Three independent pieces of the Aug 2026 Tier-2 hardening round:
--
-- 1. Two aggregate RPCs replacing full-history client scans:
--    * get_profile_post_sport_keys — the active-sports route fetched EVERY
--      post's sport_key to derive a handful of distinct keys.
--    * get_golf_round_years — golf/stats fetched every round (14 columns) to
--      derive the distinct years list (and silently corrupted past
--      PostgREST's 1000-row cap).
--    Both SECURITY DEFINER with EXECUTE locked to service_role ONLY — they
--    take a profile id and enforce nothing, so a direct PostgREST call must
--    be impossible (the 124 lesson: Postgres grants EXECUTE to PUBLIC by
--    default on every new function; a bare GRANT is not a lockdown).
--
-- 2. posts (created_at DESC, id DESC) — the keyset-pagination index for the
--    feed's cursor mode. Plain CREATE INDEX here because posts is MVP-small;
--    ⚠️ if applying this to a LARGE posts table later, run the statement
--    ALONE as CREATE INDEX CONCURRENTLY (cannot run inside a transaction).
--
-- 3. RLS (select auth.uid()) wrapping on the SURVIVING bare-auth.uid()
--    policies from 004 (+ 062's media_update_policy). Bare auth.uid() in a
--    policy qual re-evaluates per ROW; (select auth.uid()) runs once as an
--    initplan. Semantics are byte-equivalent — ONLY the wrapping changes.
--    Policies superseded by 035/063 are deliberately NOT touched (they were
--    already recreated there, most with the wrapping).
--
-- ⚠️ Supabase SQL Editor: run the WHOLE file; expect green "Success", then
-- eyeball the check grid at the bottom. Re-runnable throughout.
-- ============================================================================

-- ── 1a. Distinct post sport keys ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profile_post_sport_keys(p_profile_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT p.sport_key), '{}')
  FROM public.posts p
  WHERE p.profile_id = p_profile_id
    AND p.sport_key IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_profile_post_sport_keys(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_post_sport_keys(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_post_sport_keys(uuid) TO service_role;

-- ── 1b. Distinct golf-round years, newest first ─────────────────────────────
-- substring of the DATE column's text form matches the route's timezone-safe
-- JS derivation exactly (never through a timestamptz conversion).
CREATE OR REPLACE FUNCTION public.get_golf_round_years(p_profile_id uuid)
RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(y ORDER BY y DESC), '{}')
  FROM (
    SELECT DISTINCT (substring(r.date::text, 1, 4))::int AS y
    FROM public.golf_rounds r
    WHERE r.profile_id = p_profile_id
      AND r.date IS NOT NULL
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_golf_round_years(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_golf_round_years(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_golf_round_years(uuid) TO service_role;

-- ── 2. Feed keyset index ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_posts_created_at_id_desc
  ON public.posts (created_at DESC, id DESC);

-- ── 3. RLS initplan wrapping ────────────────────────────────────────────────
-- group_posts: insert / update / delete (select stayed in 035)
DROP POLICY IF EXISTS group_posts_insert_policy ON group_posts;
CREATE POLICY group_posts_insert_policy ON group_posts
FOR INSERT WITH CHECK ((select auth.uid()) = creator_id);

DROP POLICY IF EXISTS group_posts_update_policy ON group_posts;
CREATE POLICY group_posts_update_policy ON group_posts
FOR UPDATE USING ((select auth.uid()) = creator_id);

DROP POLICY IF EXISTS group_posts_delete_policy ON group_posts;
CREATE POLICY group_posts_delete_policy ON group_posts
FOR DELETE USING ((select auth.uid()) = creator_id);

-- group_post_media: select / insert / delete (004) + update (062)
DROP POLICY IF EXISTS media_select_policy ON group_post_media;
CREATE POLICY media_select_policy ON group_post_media
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_media.group_post_id
    AND profile_id = (select auth.uid())
  ) OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_media.group_post_id
    AND (creator_id = (select auth.uid()) OR visibility = 'public')
  )
);

DROP POLICY IF EXISTS media_insert_policy ON group_post_media;
CREATE POLICY media_insert_policy ON group_post_media
FOR INSERT WITH CHECK (
  (select auth.uid()) = uploaded_by AND
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE group_post_id = group_post_media.group_post_id
    AND profile_id = (select auth.uid())
    AND status = 'confirmed'
  )
);

DROP POLICY IF EXISTS media_delete_policy ON group_post_media;
CREATE POLICY media_delete_policy ON group_post_media
FOR DELETE USING (
  (select auth.uid()) = uploaded_by OR
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = group_post_media.group_post_id
    AND creator_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS media_update_policy ON group_post_media;
CREATE POLICY media_update_policy ON group_post_media
FOR UPDATE
USING (
  (select auth.uid()) = uploaded_by
  OR EXISTS (
    SELECT 1 FROM group_posts
     WHERE group_posts.id = group_post_media.group_post_id
       AND group_posts.creator_id = (select auth.uid())
  )
)
WITH CHECK (
  (select auth.uid()) = uploaded_by
  OR EXISTS (
    SELECT 1 FROM group_posts
     WHERE group_posts.id = group_post_media.group_post_id
       AND group_posts.creator_id = (select auth.uid())
  )
);

-- golf_scorecard_data: select / insert / update
DROP POLICY IF EXISTS golf_data_select_policy ON golf_scorecard_data;
CREATE POLICY golf_data_select_policy ON golf_scorecard_data
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND (
      creator_id = (select auth.uid()) OR
      visibility = 'public' OR
      EXISTS (
        SELECT 1 FROM group_post_participants
        WHERE group_post_id = golf_scorecard_data.group_post_id
        AND profile_id = (select auth.uid())
      )
    )
  )
);

DROP POLICY IF EXISTS golf_data_insert_policy ON golf_scorecard_data;
CREATE POLICY golf_data_insert_policy ON golf_scorecard_data
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND creator_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS golf_data_update_policy ON golf_scorecard_data;
CREATE POLICY golf_data_update_policy ON golf_scorecard_data
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_posts
    WHERE id = golf_scorecard_data.group_post_id
    AND creator_id = (select auth.uid())
  )
);

-- golf_participant_scores: insert / update (select stayed in 063)
DROP POLICY IF EXISTS golf_scores_insert_policy ON golf_participant_scores;
CREATE POLICY golf_scores_insert_policy ON golf_participant_scores
FOR INSERT WITH CHECK (
  (select auth.uid()) = entered_by AND
  EXISTS (
    SELECT 1 FROM group_post_participants gpp
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gpp.id = golf_participant_scores.participant_id
    AND (gpp.profile_id = (select auth.uid()) OR gp.creator_id = (select auth.uid()))
  )
);

DROP POLICY IF EXISTS golf_scores_update_policy ON golf_participant_scores;
CREATE POLICY golf_scores_update_policy ON golf_participant_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_post_participants
    WHERE id = golf_participant_scores.participant_id
    AND profile_id = (select auth.uid())
  )
);

-- golf_hole_scores: insert / update / delete (select stayed in 063)
DROP POLICY IF EXISTS hole_scores_insert_policy ON golf_hole_scores;
CREATE POLICY hole_scores_insert_policy ON golf_hole_scores
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND (gpp.profile_id = (select auth.uid()) OR gp.creator_id = (select auth.uid()))
  )
);

DROP POLICY IF EXISTS hole_scores_update_policy ON golf_hole_scores;
CREATE POLICY hole_scores_update_policy ON golf_hole_scores
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND gpp.profile_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS hole_scores_delete_policy ON golf_hole_scores;
CREATE POLICY hole_scores_delete_policy ON golf_hole_scores
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM golf_participant_scores gps
    JOIN group_post_participants gpp ON gps.participant_id = gpp.id
    JOIN group_posts gp ON gpp.group_post_id = gp.id
    WHERE gps.id = golf_hole_scores.golf_participant_id
    AND (gpp.profile_id = (select auth.uid()) OR gp.creator_id = (select auth.uid()))
  )
);

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid ──────────────────────────────────────────────────
-- Expect: both fns true, idx true, wrapped 15, bare_remaining 0.
-- (pg normalizes a wrapped qual to "( SELECT auth.uid() AS uid)", so wrapped
-- policies contain 'SELECT auth.uid()' and a fully-bare policy does not.)
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_profile_post_sport_keys') AS fn_sport_keys,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_golf_round_years') AS fn_golf_years,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_posts_created_at_id_desc') AS idx_keyset,
  (SELECT count(*) FROM pg_policies
   WHERE policyname IN (
     'group_posts_insert_policy','group_posts_update_policy','group_posts_delete_policy',
     'media_select_policy','media_insert_policy','media_delete_policy','media_update_policy',
     'golf_data_select_policy','golf_data_insert_policy','golf_data_update_policy',
     'golf_scores_insert_policy','golf_scores_update_policy',
     'hole_scores_insert_policy','hole_scores_update_policy','hole_scores_delete_policy')
   AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%SELECT auth.uid()%') AS wrapped,
  (SELECT count(*) FROM pg_policies
   WHERE policyname IN (
     'group_posts_insert_policy','group_posts_update_policy','group_posts_delete_policy',
     'media_select_policy','media_insert_policy','media_delete_policy','media_update_policy',
     'golf_data_select_policy','golf_data_insert_policy','golf_data_update_policy',
     'golf_scores_insert_policy','golf_scores_update_policy',
     'hole_scores_insert_policy','hole_scores_update_policy','hole_scores_delete_policy')
   AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%auth.uid()%'
   AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%SELECT auth.uid()%') AS bare_remaining;

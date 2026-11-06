-- ============================================================================
-- 303: the viewer's follows never cross the wire (SCALE_AUDIT hole 6's
--      leftovers; Nov 6 2026, the improvements round PR 4). Runs on BOTH
--      staging and prod BEFORE the code deploys (the routes answer 503 /
--      fall back until it exists).
-- ============================================================================
-- Three routes read a viewer's follows with no LIMIT and shipped the id
-- list back out as a filter: the Live Now strip (`group_post_participants
-- … IN (viewer + followees)` — a GET URL of 37 KB at 1,000 follows), the
-- @mention and invite people searches (`search_people(visible_ids)`), and
-- the suggestions fallback. PostgREST's max-rows is 1,000: past it the list
-- was silently cut — a followee's live round not shown, a private friend
-- not found. The fix of record (281's hidden_authors_for): the follows are
-- joined INSIDE SQL, bounded, and only the answer comes back.
--
--   live_now_participants(p_viewer, p_limit) — the participant rows of the
--     viewer and their accepted followees, newest first, p_limit rows: the
--     Live Now route's one read for "whose rounds".
--   search_people_for(p_viewer, p_direction, …search_people's args…) — wraps
--     search_people (238) with visible_ids computed in SQL: 'following' =
--     accepted follows I made (the @mention rule: canViewProfile's "you
--     know them"); 'either' = an accepted follow in either direction (the
--     invite rule). Capped at 2000 ids, the 281 bound.
--
-- Both STABLE, SECURITY INVOKER (the routes run as service_role — the
-- filter in SQL IS the privacy boundary, the people-server rule), EXECUTE
-- for service_role only. Reversal: DROP both functions.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 303) THEN
    RAISE EXCEPTION '303 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 302 THEN RAISE EXCEPTION '303 pre-flight: ledger head is %, expected 302', n; END IF;
  IF to_regprocedure('public.search_people(text,uuid[],boolean,int,boolean,uuid,text,text,float8,float8,float8)') IS NULL THEN
    RAISE EXCEPTION '303 pre-flight: search_people (238''s signature) is missing';
  END IF;
END $$;

-- ── 1. live_now_participants ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.live_now_participants(p_viewer uuid, p_limit int DEFAULT 100)
RETURNS TABLE (group_post_id uuid, profile_id uuid, status text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT gpp.group_post_id, gpp.profile_id, gpp.status
  FROM public.group_post_participants gpp
  WHERE gpp.profile_id = p_viewer
     OR gpp.profile_id IN (
          SELECT f.following_id
          FROM public.follows f
          WHERE f.follower_id = p_viewer AND f.status = 'accepted'
          LIMIT 2000
        )
  ORDER BY gpp.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;
REVOKE EXECUTE ON FUNCTION public.live_now_participants(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_now_participants(uuid, int) TO service_role;
COMMENT ON FUNCTION public.live_now_participants(uuid, int) IS
  'The Live Now strip''s "whose rounds" read (303): participant rows of the viewer and their accepted followees, newest first — the follows joined in SQL, never sent back as an IN list. GET /api/golf/live-now. service_role only.';

-- ── 2. search_people_for ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_people_for(
  p_viewer       uuid,
  p_direction    text,
  search_term    text,
  include_public boolean DEFAULT TRUE,
  max_results    int DEFAULT 20,
  require_handle boolean DEFAULT FALSE,
  exclude_id     uuid DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_region_code  text DEFAULT NULL,
  p_near_lat     float8 DEFAULT NULL,
  p_near_lng     float8 DEFAULT NULL,
  p_radius_km    float8 DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  handle      text,
  first_name  text,
  middle_name text,
  last_name   text,
  full_name   text,
  avatar_url  text,
  location    text,
  sport       text,
  school      text,
  visibility  text,
  city        text,
  region      text,
  region_code text,
  country     text,
  country_code text,
  distance_km float8,
  match_rank  int
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT *
  FROM public.search_people(
    search_term,
    CASE
      WHEN p_direction = 'following' THEN ARRAY(
        SELECT f.following_id
        FROM public.follows f
        WHERE f.follower_id = p_viewer AND f.status = 'accepted' AND f.following_id <> p_viewer
        LIMIT 2000
      )
      ELSE ARRAY(
        SELECT CASE WHEN f.follower_id = p_viewer THEN f.following_id ELSE f.follower_id END
        FROM public.follows f
        WHERE f.status = 'accepted' AND (f.follower_id = p_viewer OR f.following_id = p_viewer)
        LIMIT 2000
      )
    END,
    include_public,
    max_results,
    require_handle,
    exclude_id,
    p_country_code,
    p_region_code,
    p_near_lat,
    p_near_lng,
    p_radius_km
  );
$$;
REVOKE EXECUTE ON FUNCTION public.search_people_for(uuid, text, text, boolean, int, boolean, uuid, text, text, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_people_for(uuid, text, text, boolean, int, boolean, uuid, text, text, float8, float8, float8) TO service_role;
COMMENT ON FUNCTION public.search_people_for(uuid, text, text, boolean, int, boolean, uuid, text, text, float8, float8, float8) IS
  'search_people (238) with the viewer''s visible ids computed in SQL (303): ''following'' = accepted follows I made (the @mention rule), ''either'' = either direction (the invite rule), capped at 2000. GET /api/mentions/search, /api/calendar/invite-search. service_role only.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (303, '303_follows_bounded.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 303 APPLIED | 2 | 303
SELECT '303 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('live_now_participants', 'search_people_for')) AS functions_expect_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_303;

-- ============================================================================
-- Migration 084 — Repair get_group_post_details() and get_golf_scorecard()
-- ============================================================================
-- Found by sweeping every READ-ONLY RPC exposed via PostgREST (Aug 13 2026).
-- Both raise on columns that no longer exist:
--
--   get_golf_scorecard      -> 42703  column "ghs.scorecard_id" does not exist
--   get_group_post_details  -> 42703  column "gp.owner_id"      does not exist
--
-- Nothing calls either one — not the app (grep across src/ is clean), not an
-- RLS policy, not another function. Their only non-archive definition is
-- migration 004_group_posts.sql. Tom chose repair over dropping them.
--
-- The live bodies are an OLDER GENERATION than 004, not merely mis-pinned.
-- Live signatures are get_group_post_details(target_group_post_id) and
-- get_golf_scorecard(target_scorecard_id); 004 defines both as taking a GROUP
-- POST id. `target_scorecard_id` is the tell — that body comes from a schema
-- where scorecards had their own id and hole scores carried scorecard_id.
-- This migration restores 004's contract, which is why it must DROP first:
-- CREATE OR REPLACE cannot rename an input parameter.
--
-- Every column 004 references was verified to still exist in the live schema
-- (7 tables, 58 references, checked against PostgREST's OpenAPI definitions)
-- before this was written, so this is a faithful restore, not a rewrite.
--
-- ── ONE DELIBERATE DEVIATION FROM 004 ───────────────────────────────────────
-- 004's get_golf_scorecard is LATENTLY BROKEN at line 761:
--
--     SELECT json_object_agg(hole_number, json_build_object(...))
--     FROM golf_hole_scores
--     WHERE golf_participant_id = gps.id
--     ORDER BY hole_number            <-- query-level ORDER BY
--
-- That is an aggregate query with no GROUP BY, so a query-level ORDER BY on a
-- bare column raises 42803 ("column must appear in the GROUP BY clause or be
-- used in an aggregate function"). plpgsql does not validate SQL inside a body
-- at CREATE time, so it would have been created happily and failed on the
-- first call. Restoring it verbatim would ship a broken function. The ORDER BY
-- is therefore hoisted INTO the aggregate — json_object_agg(k, v ORDER BY k) —
-- which is what it was always meant to be. The sibling ORDER BYs in 004 (on
-- json_agg for participants and media) are already inside their aggregates and
-- are reproduced unchanged.
--
-- ── WHY THE REVOKE MATTERS ──────────────────────────────────────────────────
-- Both functions are SECURITY DEFINER and return group_posts rows,
-- participants and joined profiles data, BYPASSING RLS. Migration 040
-- tightened grants on the other server-side RPCs but never mentions these two
-- — being broken has been masking that. Repairing them without touching grants
-- would turn two dead functions into a way to read private group posts, so the
-- REVOKE below is part of the fix, not housekeeping.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file. Expect green "Success" plus
--    NOTICE 084 OK twice. A WARNING means the repair committed but a check
--    failed — paste it back rather than re-running (see 083 / MIGRATIONS.md:
--    a post-change check must never abort the migration).
-- ============================================================================

-- ── 1. Drop every overload, by name ─────────────────────────────────────────
-- Keyed on name because these have been redefined by several archived scripts,
-- so the live argument list is the only authority — and the parameter is being
-- renamed back to 004's, which CREATE OR REPLACE cannot do.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_group_post_details', 'get_golf_scorecard')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.args);
    RAISE NOTICE '084 dropped stale: %(%)', r.proname, r.args;
  END LOOP;
END $$;

-- ── 2. get_group_post_details — 004's body, schema-qualified ────────────────
CREATE FUNCTION public.get_group_post_details(p_group_post_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'group_post', (
      SELECT row_to_json(gp)
      FROM (
        SELECT
          id,
          creator_id,
          type,
          title,
          description,
          date,
          location,
          visibility,
          status,
          post_id,
          created_at,
          updated_at
        FROM public.group_posts
        WHERE id = p_group_post_id
      ) gp
    ),
    'participants', (
      SELECT json_agg(
        json_build_object(
          'id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url, sport, school
              FROM public.profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'role', gpp.role,
          'attested_at', gpp.attested_at,
          'data_contributed', gpp.data_contributed,
          'last_contribution', gpp.last_contribution
        )
        ORDER BY gpp.created_at
      )
      FROM public.group_post_participants gpp
      WHERE gpp.group_post_id = p_group_post_id
    ),
    'media', (
      SELECT json_agg(
        json_build_object(
          'id', gpm.id,
          'media_url', gpm.media_url,
          'media_type', gpm.media_type,
          'caption', gpm.caption,
          'uploaded_by', gpm.uploaded_by,
          'created_at', gpm.created_at
        )
        ORDER BY gpm.position, gpm.created_at
      )
      FROM public.group_post_media gpm
      WHERE gpm.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_group_post_details(UUID) IS
  'Returns complete group post data including participants and media';

-- ── 3. get_golf_scorecard — 004's body, schema-qualified, ORDER BY hoisted ──
CREATE FUNCTION public.get_golf_scorecard(p_group_post_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'golf_data', (
      SELECT row_to_json(gd)
      FROM (
        SELECT
          course_name,
          round_type,
          holes_played,
          tee_color,
          slope_rating,
          course_rating,
          weather_conditions,
          temperature,
          wind_speed
        FROM public.golf_scorecard_data
        WHERE group_post_id = p_group_post_id
      ) gd
    ),
    'participant_scores', (
      SELECT json_agg(
        json_build_object(
          'participant_id', gpp.id,
          'profile_id', gpp.profile_id,
          'profile', (
            SELECT row_to_json(p)
            FROM (
              SELECT id, full_name, first_name, last_name, avatar_url
              FROM public.profiles
              WHERE id = gpp.profile_id
            ) p
          ),
          'status', gpp.status,
          'total_score', gps.total_score,
          'to_par', gps.to_par,
          'holes_completed', gps.holes_completed,
          'scores_confirmed', gps.scores_confirmed,
          'hole_scores', (
            -- ORDER BY lives INSIDE the aggregate; see the header note. At
            -- query level (as 004 had it) this raises 42803.
            SELECT json_object_agg(
              ghs.hole_number,
              json_build_object(
                'strokes', ghs.strokes,
                'putts', ghs.putts,
                'fairway_hit', ghs.fairway_hit,
                'green_in_regulation', ghs.green_in_regulation
              )
              ORDER BY ghs.hole_number
            )
            FROM public.golf_hole_scores ghs
            WHERE ghs.golf_participant_id = gps.id
          )
        )
        ORDER BY gpp.created_at
      )
      FROM public.group_post_participants gpp
      LEFT JOIN public.golf_participant_scores gps ON gps.participant_id = gpp.id
      WHERE gpp.group_post_id = p_group_post_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_golf_scorecard(UUID) IS
  'Returns complete golf scorecard with all participants and hole-by-hole scores';

-- ── 4. Lock them down — server-side only (see header) ───────────────────────
-- Required, not optional: CREATE grants EXECUTE to PUBLIC by default, and
-- these are SECURITY DEFINER functions that read across RLS.
REVOKE EXECUTE ON FUNCTION public.get_group_post_details(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_golf_scorecard(UUID)     FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- VERIFICATION — CANNOT roll back the work above (083's convention).
-- ============================================================================
DO $$
DECLARE
  v_gp   UUID;
  v_json JSON;
BEGIN
  SELECT id INTO v_gp FROM public.group_posts ORDER BY created_at LIMIT 1;
  IF v_gp IS NULL THEN
    RAISE NOTICE '084 SKIPPED verification: no group_posts rows to call with';
    RETURN;
  END IF;

  BEGIN
    v_json := public.get_group_post_details(v_gp);
    IF v_json IS NULL OR v_json->'group_post' IS NULL THEN
      RAISE WARNING '084 CHECK SOFT-FAIL (get_group_post_details): returned % — repair is still committed', v_json;
    ELSE
      RAISE NOTICE '084 OK — get_group_post_details returned keys %',
        (SELECT string_agg(k, ',') FROM json_object_keys(v_json) k);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '084 CHECK FAILED (get_group_post_details): % [%] — repair is still committed', SQLERRM, SQLSTATE;
  END;

  BEGIN
    v_json := public.get_golf_scorecard(v_gp);
    RAISE NOTICE '084 OK — get_golf_scorecard returned keys %',
      COALESCE((SELECT string_agg(k, ',') FROM json_object_keys(v_json) k), '(null — fine if that group post is not a golf round)');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '084 CHECK FAILED (get_golf_scorecard): % [%] — repair is still committed', SQLERRM, SQLSTATE;
  END;
END $$;

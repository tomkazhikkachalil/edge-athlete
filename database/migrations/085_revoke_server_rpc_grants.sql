-- ============================================================================
-- Migration 085 — Close the EXECUTE grants migration 040 missed
-- ============================================================================
-- Found Aug 13 2026 while reading section 3 of
-- database/tests/diagnostics/diagnose-archived-hotfix-functions.sql (the live
-- prosrc of all 38 archived-sweep functions).
--
-- The bodies were CLEAN — no stale schema references left, every table exists,
-- and the notification/media/golf bodies all carry their current-generation
-- predicates. The problem is GRANTS, not bodies.
--
-- Migration 040 revoked EXECUTE on 12 server-side RPCs. Several of exactly the
-- same kind were missed, and are callable today with the PUBLIC ANON KEY —
-- the one that ships in the browser bundle. Verified live by calling each with
-- the anon key:
--
--   search_by_handle                 CAN RUN  <- returns profile rows with NO
--                                                visibility filter
--   generate_connection_suggestions  CAN RUN  <- walks the follow graph for an
--                                                arbitrary profile id
--   get_pending_requests_count       CAN RUN  <- pending follow-request count
--                                                for an arbitrary profile id
--   check_handle_availability        CAN RUN  <- reveals whether a handle exists
--   can_view_profile                 blocked  <- 040 got this one; the pattern
--
-- search_by_handle is the sharp one. src/app/api/handles/search/route.ts says
-- so in its own comment — "private profiles must not surface in handle search
-- … The search_by_handle RPC runs via the admin client and does NOT filter
-- visibility" — and compensates by dropping private profiles AFTER the call.
-- Calling the RPC directly with the anon key bypasses that route entirely.
--
-- Not a live leak today: zero private profiles currently have a handle. It is
-- LATENT — the first private user who sets one becomes enumerable by anyone.
-- The standing lesson: an app-layer filter is NOT a substitute for an EXECUTE
-- grant, because the RPC is reachable without going through the app at all.
--
-- calculate_round_stats is included because it MUTATES: it rewrites
-- golf_rounds.gross_score / par / total_putts / fir_percentage /
-- gir_percentage. A browser key has no business being able to fire that.
--
-- SAFE TO REVOKE — every call site of all five uses the ADMIN (service_role)
-- client, which ignores these grants:
--   handles/search, handles/check, auth/complete-profile:154,
--   guardian/athletes:84, suggestions/route.ts:32,
--   golf/rounds/[roundId]:16,76,190, and posts/route.ts:88 (passes its admin
--   client into createGolfRoundEntities).
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file. Expect green "Success" plus
--    NOTICE lines. A WARNING means the revokes committed but a check did not
--    pass — paste it back rather than re-running.
-- ============================================================================

-- ── 1. Revoke, keyed on the live signature ──────────────────────────────────
-- Keyed on name via pg_proc because these have been redefined by several
-- archived scripts over the years, so the live argument list is the only
-- authority. Every overload of each name is covered.
DO $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'search_by_handle',
        'generate_connection_suggestions',
        'get_pending_requests_count',
        'check_handle_availability',
        'calculate_round_stats'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname, r.args
    );
    v_count := v_count + 1;
    RAISE NOTICE '085 revoked: %(%)', r.proname, r.args;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION '085 FAILED: none of the target functions exist — check names';
  END IF;
END $$;

-- ── 2. Drop the redundant get_unread_notification_count overload ────────────
-- pg_proc holds TWO: the no-arg one (uses auth.uid(), revoked by 040) and the
-- (uuid) one migration 083 created and verified. Nothing calls either, and two
-- overloads of one name is exactly the ambiguity this audit keeps tripping
-- over. Keep 083's — it is documented, and its parameter is correctly
-- qualified against the identically-named column.
DROP FUNCTION IF EXISTS public.get_unread_notification_count();

-- ============================================================================
-- VERIFICATION — CANNOT roll back the work above (083's convention, see
-- database/MIGRATIONS.md). A failed check downgrades to a WARNING.
-- ============================================================================
DO $$
DECLARE
  r          RECORD;
  v_leftover TEXT := '';
  v_dupes    INTEGER;
BEGIN
  -- Anything still executable by anon/authenticated among the five?
  BEGIN
    FOR r IN
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('search_by_handle','generate_connection_suggestions',
                          'get_pending_requests_count','check_handle_availability',
                          'calculate_round_stats')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    LOOP
      v_leftover := v_leftover || r.proname || '(' || r.args || ') ';
    END LOOP;

    IF v_leftover <> '' THEN
      RAISE WARNING '085 CHECK FAILED: still executable by anon/authenticated: % — revokes above are still committed', v_leftover;
    ELSE
      RAISE NOTICE '085 OK — all five are service-role only';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '085 CHECK FAILED (grants): % [%]', SQLERRM, SQLSTATE;
  END;

  -- Exactly one get_unread_notification_count should remain.
  BEGIN
    SELECT COUNT(*) INTO v_dupes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_unread_notification_count';

    IF v_dupes = 1 THEN
      RAISE NOTICE '085 OK — one get_unread_notification_count overload remains';
    ELSE
      RAISE WARNING '085 CHECK: % overloads of get_unread_notification_count remain (expected 1)', v_dupes;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '085 CHECK FAILED (overloads): % [%]', SQLERRM, SQLSTATE;
  END;
END $$;

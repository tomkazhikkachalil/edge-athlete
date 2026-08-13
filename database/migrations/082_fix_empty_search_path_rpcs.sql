-- ============================================================================
-- Migration 082 — Repin search_path on two RPCs that are broken in production
-- ============================================================================
-- Found by the Aug 12-13 2026 audit, CONFIRMED LIVE (service role, prod):
--
--   SELECT get_unread_notification_count(<uuid>)
--     -> 42P01  relation "notifications" does not exist
--   SELECT get_tagged_posts(<uuid>, <uuid>, 1, 0)
--     -> 42P01  relation "post_tags" does not exist
--
-- Root cause
-- ----------
-- A SECOND archived family, separate from the fix-*schema*.sql sweep that
-- caused migrations 025/036/037/081:
--   database/archive/old-migrations/fix-function-search-paths.sql
--   database/archive/old-migrations/fix-function-search-paths-compatible.sql
-- Its own header says it "secures all exposed functions by setting
-- search_path = '' (empty)" to clear 47 Supabase linter warnings. It pinned
-- the EMPTY path onto function bodies it did not rewrite — and those bodies
-- (from 008 and the notifications work) reference `post_tags`, `notifications`
-- etc. UNQUALIFIED. With an empty search_path nothing but pg_catalog resolves,
-- so both functions raise 42P01 on every call.
--
-- Migration 040 hit the same linter warnings later and got it RIGHT, pinning
-- 'public' instead with the note: "Pinned to 'public' (not '') because these
-- bodies use unqualified table names; pinning removes the hijack risk without
-- rewriting bodies." This migration applies 040's remedy to the two stragglers.
--
-- Impact while broken: NONE user-facing. Neither function is called by the app
-- (grep across src/ is clean) — the unread badge and the Tagged tab use other
-- paths, the tagged tab running on get_profile_tagged_media, which 040 already
-- pinned to 'public'. They are dead, exposed via PostgREST, and non-functional.
-- Fixing them stops the next person who wires one up from losing a day.
--
-- Why 'public' and not a body rewrite: 'public' is the established precedent
-- (040), it is a one-line change per function with no behaviour risk, and it
-- keeps the linter satisfied — search_path is still pinned, just to a schema
-- that resolves. Rewriting the bodies to qualify every reference is the
-- larger, better fix and is NOT attempted here.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success" and the
--    NOTICEs below.
-- ============================================================================

-- Keyed on name rather than a hardcoded signature: these functions have been
-- redefined by several archived scripts over time, so the live argument list
-- is the authority. Every overload gets repinned.
DO $$
DECLARE
  r        RECORD;
  v_count  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_unread_notification_count', 'get_tagged_posts')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = ''public''',
      r.proname, r.args
    );
    v_count := v_count + 1;
    RAISE NOTICE '082 repinned: %(%)', r.proname, r.args;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION '082 FAILED: neither function exists — check the names';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION — both must now execute instead of raising 42P01.
-- Read-only; uses whatever profile happens to be first.
-- ============================================================================
DO $$
DECLARE
  v_profile UUID;
  v_count   INTEGER;
  v_rows    INTEGER;
BEGIN
  SELECT id INTO v_profile FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE NOTICE '082 SKIPPED verification: no profiles to call with';
    RETURN;
  END IF;

  SELECT public.get_unread_notification_count(v_profile) INTO v_count;
  RAISE NOTICE '082 OK — get_unread_notification_count returned %', v_count;

  SELECT count(*) INTO v_rows
  FROM public.get_tagged_posts(v_profile, v_profile, 1, 0);
  RAISE NOTICE '082 OK — get_tagged_posts returned % row(s)', v_rows;
END $$;

-- ============================================================================
-- REMAINING WORK — deliberately NOT done here
-- ============================================================================
-- Section 4 of database/tests/diagnostics/diagnose-archived-hotfix-functions.sql
-- only lists functions whose body matches a FROM/JOIN heuristic. A function
-- with search_path='' whose unqualified reference sits in an INSERT INTO x,
-- UPDATE x SET or DELETE FROM x position is NOT listed, and would be just as
-- broken. That query has been widened in the same commit as this migration:
-- run it and probe anything new it reports.

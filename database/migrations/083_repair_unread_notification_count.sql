-- ============================================================================
-- Migration 083 — Repair get_unread_notification_count, repin get_tagged_posts
-- ============================================================================
-- Supersedes 082, which ROLLED BACK ENTIRELY when Tom ran it. Two lessons, both
-- recorded here so the next migration does not repeat them.
--
-- LESSON 1 — a verification block that RAISES rolls back the whole migration.
-- The Supabase SQL editor runs a script as ONE transaction. 082 did its work
-- and then called the repaired function to prove it; the call raised, the
-- exception propagated, and Postgres rolled back the ALTERs along with it.
-- The repin never persisted — a live probe afterwards showed both functions
-- still failing with the ORIGINAL 42P01. "I ran it and got an error" therefore
-- means NOTHING WAS APPLIED, not "applied but the check failed".
-- => Verification in this file cannot abort. It runs inside
--    BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING, so a failed check
--    reports and the repairs above it still commit.
--
-- LESSON 2 — get_unread_notification_count was doubly stale. Repinning
-- search_path let it resolve `notifications`, and it immediately failed again:
--
--   42703  column "recipient_id" does not exist
--   QUERY:  SELECT COUNT(*) FROM notifications
--           WHERE recipient_id = user_id AND read = FALSE
--
-- The live table has `user_id` and `is_read`; this body predates that schema.
-- So the function needed REPLACING, not repinning — 082's premise was wrong
-- for it. (get_tagged_posts still only needs the repin: post_tags' live columns
-- do match what migration 008 wrote.)
--
-- Neither function is called by the app (grep across src/ is clean), so there
-- is still no user-facing impact. This is about not leaving a loaded gun for
-- whoever wires one of them up.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file. Expect green "Success" plus
--    NOTICE lines. A WARNING from the verification section means the repairs
--    committed but a check did not pass — paste it back rather than re-running.
-- ============================================================================

-- ── 1. get_unread_notification_count — replace the stale body ───────────────
-- DROP + CREATE rather than CREATE OR REPLACE: the live return type is
-- unknown (COUNT(*) is bigint, the old declaration may say integer) and
-- CREATE OR REPLACE cannot change a return type. The parameter keeps the name
-- `user_id` because callers may use named arguments.
DROP FUNCTION IF EXISTS public.get_unread_notification_count(uuid);

CREATE FUNCTION public.get_unread_notification_count(user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  -- The parameter is named `user_id` and so is the column, so the parameter
  -- MUST be qualified with the function name — otherwise `user_id = user_id`
  -- compares the column to itself and every row matches.
  SELECT COUNT(*)::integer
    INTO v_count
    FROM public.notifications n
   WHERE n.user_id = get_unread_notification_count.user_id
     AND n.is_read = FALSE;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- Restore migration 040's posture: this is a server-side RPC, not something
-- anon or authenticated may call. Recreating the function reset its grants to
-- the default, so this REVOKE is required, not optional.
REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count(uuid)
  FROM PUBLIC, anon, authenticated;

-- ── 2. get_tagged_posts — repin only (082's intent, reapplied) ──────────────
-- Keyed on name via dynamic SQL: this function has been redefined by several
-- archived scripts, so the live argument list is the only authority.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_tagged_posts'
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = ''public''',
                   r.proname, r.args);
    RAISE NOTICE '083 repinned: %(%)', r.proname, r.args;
  END LOOP;
END $$;

-- ============================================================================
-- VERIFICATION — CANNOT roll back the work above (see LESSON 1).
-- Each check is wrapped so a failure downgrades to a WARNING.
-- ============================================================================
DO $$
DECLARE
  v_profile UUID;
  v_count   INTEGER;
  v_rows    INTEGER;
BEGIN
  SELECT id INTO v_profile FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE NOTICE '083 SKIPPED verification: no profiles to call with';
    RETURN;
  END IF;

  BEGIN
    SELECT public.get_unread_notification_count(v_profile) INTO v_count;
    RAISE NOTICE '083 OK — get_unread_notification_count returned %', v_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '083 CHECK FAILED (get_unread_notification_count): % [%] — the repair above is still committed',
      SQLERRM, SQLSTATE;
  END;

  BEGIN
    SELECT count(*) INTO v_rows
      FROM public.get_tagged_posts(v_profile, v_profile, 1, 0);
    RAISE NOTICE '083 OK — get_tagged_posts returned % row(s)', v_rows;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '083 CHECK FAILED (get_tagged_posts): % [%] — the repin above is still committed. If this is 42703, its body is column-stale too and needs the same treatment as section 1.',
      SQLERRM, SQLSTATE;
  END;
END $$;

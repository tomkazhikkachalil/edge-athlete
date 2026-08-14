-- ============================================================================
-- Migration 086 — Revoke two RPCs anon/authenticated can still execute
-- ============================================================================
-- SECURITY. Found Aug 13 2026 by section 5 of
-- database/tests/diagnostics/diagnose-archived-hotfix-functions.sql (the
-- EXECUTE-grant inventory added in 085). Two functions are executable by anon
-- AND authenticated that must not be:
--
--   update_user_handle(uuid, text)       anon+authed  <- HANDLE HIJACK
--   mark_all_notifications_read(uuid)     anon+authed  <- write another user's
--                                                         read-state
--
-- ── 1. update_user_handle — the serious one ─────────────────────────────────
-- Its permission check (jwt_role='service_role' OR p_profile_id=auth.uid() OR
-- has_profile_access(...)) lives ONLY inside the `IF current_handle IS NULL`
-- first-time-set branch (migration 054, lines 40-48). The CHANGE path — the
-- rename after the 7-day rate-limit check, and the casing-only update — has NO
-- permission check at all; it trusts that the caller is the service-role app
-- route (/api/handles/update does requireAuth, then calls with the admin
-- client and p_profile_id := user.id).
--
-- But this overload is granted to anon/authenticated, so it is reachable
-- directly with the PUBLIC ANON KEY. For any profile that ALREADY has a handle
-- (current_handle IS NOT NULL), the first-set gate is skipped and the rename
-- proceeds subject only to availability + the 7-day limit. That is an
-- account-handle takeover of an arbitrary profile. 054's header even claims
-- "anon stays blocked (role claim check, not a NULL check)" — true only for
-- the first-set branch it was editing; the change path was never guarded,
-- because the grant was supposed to be the guard.
--
-- ── 2. mark_all_notifications_read(uuid) ────────────────────────────────────
-- 040 revoked the NO-ARG overload `mark_all_notifications_read()` by name, but
-- a second, parameterized overload `(uuid)` exists and was never revoked. It
-- takes an arbitrary user_id, so a browser key can mark any user's
-- notifications read. Lower severity (integrity, not disclosure) but still
-- unauthorized cross-account writes.
--
-- ── WHY REVOKE IS SAFE (no feature depends on the grant) ────────────────────
-- update_user_handle: the ONLY caller is /api/handles/update, via the ADMIN
--   (service_role) client (getSupabaseAdmin), which ignores these grants.
--   complete-profile only references it in a comment; no authenticated-client
--   call exists anywhere.
-- mark_all_notifications_read: NO app caller of the RPC at all —
--   /api/notifications/mark-all-read does a direct table UPDATE on the admin
--   client (.eq('user_id', user.id)), not the RPC. Both overloads are dead.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file. Expect NOTICE lines and
--    086 OK. A WARNING means the revokes committed but a check did not pass —
--    paste it back rather than re-running (083's convention; MIGRATIONS.md).
-- ============================================================================

-- ── Revoke every overload of both names, keyed on the live signature ────────
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
      AND p.proname IN ('update_user_handle', 'mark_all_notifications_read')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname, r.args
    );
    v_count := v_count + 1;
    RAISE NOTICE '086 revoked: %(%)', r.proname, r.args;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION '086 FAILED: neither function exists — check names';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION — CANNOT roll back the work above (083's convention).
-- ============================================================================
DO $$
DECLARE
  r          RECORD;
  v_leftover TEXT := '';
BEGIN
  BEGIN
    FOR r IN
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('update_user_handle','mark_all_notifications_read')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    LOOP
      v_leftover := v_leftover || r.proname || '(' || r.args || ') ';
    END LOOP;

    IF v_leftover <> '' THEN
      RAISE WARNING '086 CHECK FAILED: still executable by anon/authenticated: % — revokes above are still committed', v_leftover;
    ELSE
      RAISE NOTICE '086 OK — both are service-role only across every overload';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '086 CHECK FAILED: % [%]', SQLERRM, SQLSTATE;
  END;
END $$;

-- ============================================================================
-- 310: the six pulse trigger functions are not callable through the API
--      (Nov 15 2026; the Security Advisor's lints 0028 + 0029). Runs on BOTH
--      staging and prod; no code depends on it, so the order with the deploy
--      does not matter.
-- ============================================================================
-- 301 revoked EXECUTE on public.pulse_send but not on the six trigger
-- functions that call it, so they kept the default grant: SECURITY DEFINER
-- functions that anon and authenticated may execute — twelve Advisor warnings.
-- The exposure is nil (a RETURNS trigger function refuses a direct call), the
-- grant is still wrong.
--
-- A trigger needs no EXECUTE to fire: Postgres checks the privilege when the
-- trigger is CREATED, never when it runs — the seven pulse_* triggers are
-- untouched and keep signalling.
--
-- No table is created or altered: no table-grants block.
--
-- REVERSAL: GRANT EXECUTE ON FUNCTION public.pulse_signal_<name>() TO PUBLIC;
-- (six times). A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; f text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 310) THEN
    RAISE EXCEPTION '310 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 309 THEN RAISE EXCEPTION '310 pre-flight: ledger head is %, expected 309', n; END IF;
  FOREACH f IN ARRAY ARRAY['golf', 'event', 'broadcast', 'message', 'read', 'roster'] LOOP
    IF to_regprocedure('public.pulse_signal_' || f || '()') IS NULL THEN
      RAISE EXCEPTION '310 pre-flight: public.pulse_signal_%() is missing — 301 has not run here', f;
    END IF;
  END LOOP;
END $$;

-- ── 1. The revokes ──────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.pulse_signal_golf() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pulse_signal_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pulse_signal_broadcast() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pulse_signal_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pulse_signal_read() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pulse_signal_roster() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (310, '310_pulse_signal_revoke.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 310 APPLIED | 0 | 7 | 310
SELECT '310 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND p.proname <> 'rls_auto_enable'
           AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) AS api_definers_expect_0,
       (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE NOT t.tgisinternal AND p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'pulse\_signal\_%') AS pulse_triggers_expect_7,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_310;

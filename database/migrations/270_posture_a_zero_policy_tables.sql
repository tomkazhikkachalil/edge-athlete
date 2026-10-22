-- ============================================================================
-- 270: posture A for the 14 zero-policy tables (Oct 21 2026 — the Oct 30
--      table-grants rule, docs/HARDENING.md B7). Runs on BOTH staging and
--      prod; no code change rides with it, nothing deploys first or after.
-- ============================================================================
-- The Oct 21 live check (scripts/check-table-grants.mjs) found 14 tables with
-- RLS on and ZERO policies that still held Supabase's default full privileges
-- for anon and authenticated. Harmless — zero policies deny every row to those
-- roles — but not posture A, and the only reason the privileges existed was
-- the automatic grant Supabase retires on Oct 30. This migration REVOKES the
-- two API roles from each and re-asserts service_role's ALL (idempotent), so
-- the live check lists nothing and every one of them reads like the rule says:
-- RLS on, zero policies, REVOKE from PUBLIC / anon / authenticated, GRANT
-- service_role. The app reaches all 14 through supabaseAdmin only (grep: no
-- user-scoped client touches them), so nothing changes for anyone.
--
-- Pre-flight (any of these > 0 = the migration has work to do; all 0 after):
--   SELECT c.relname,
--          has_table_privilege('anon', c.oid, 'SELECT')          AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
--          (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND c.relname IN ('app_settings','approved_contacts','calendar_feed_tokens','consent_records','contacts','event_guests','event_series','events','guardian_invites','pending_profiles','profile_transfers','risk_signals','safety_settings_audit','waitlist');
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_settings', 'approved_contacts', 'calendar_feed_tokens', 'consent_records',
    'contacts', 'event_guests', 'event_series', 'events', 'guardian_invites',
    'pending_profiles', 'profile_transfers', 'risk_signals', 'safety_settings_audit', 'waitlist'
  ] LOOP
    -- A table this database never got (a partial environment) is skipped, never an error.
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE '270: public.% not present here — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (270, '270_posture_a_zero_policy_tables.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 270 APPLIED | 14 | 0 | 14 | 270
WITH t AS (
  SELECT c.oid, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname IN ('app_settings','approved_contacts','calendar_feed_tokens','consent_records','contacts','event_guests','event_series','events','guardian_invites','pending_profiles','profile_transfers','risk_signals','safety_settings_audit','waitlist')
)
SELECT '270 APPLIED' AS result,
       (SELECT count(*) FROM t) AS tables_expect_14,
       (SELECT count(*) FROM t WHERE has_table_privilege('anon', t.oid, 'SELECT') OR has_table_privilege('authenticated', t.oid, 'SELECT')
                                 OR has_table_privilege('anon', t.oid, 'INSERT') OR has_table_privilege('authenticated', t.oid, 'INSERT')) AS api_roles_still_privileged_expect_0,
       (SELECT count(*) FROM t WHERE has_table_privilege('service_role', t.oid, 'SELECT') AND has_table_privilege('service_role', t.oid, 'INSERT')) AS service_role_reaches_expect_14,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_270;

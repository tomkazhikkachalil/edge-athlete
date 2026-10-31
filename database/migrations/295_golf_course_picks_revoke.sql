-- ============================================================================
-- 295: golf_course_picks closes to anon / authenticated (Oct 31 2026). 294
--      granted service_role but omitted posture A's table REVOKE, reopening
--      the closed hygiene list (HARDENING B7). No exposure: RLS on, no policies.
-- ============================================================================
-- REVERSAL: none needed; the table is service role only by design.
-- A second run stops in the pre-flight.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 295) THEN
    RAISE EXCEPTION '295 has already run here — nothing to do';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 294) THEN
    RAISE EXCEPTION '295 pre-flight: 294 has not run here';
  END IF;
END $$;

REVOKE ALL ON TABLE public.golf_course_picks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.golf_course_picks TO service_role;

INSERT INTO public.schema_migrations (number, name) VALUES (295, '295_golf_course_picks_revoke.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 295 APPLIED | 295 | false | false
SELECT '295 APPLIED' AS result,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_295,
       has_table_privilege('anon', 'public.golf_course_picks', 'SELECT') AS anon_expect_false,
       has_table_privilege('authenticated', 'public.golf_course_picks', 'SELECT') AS authenticated_expect_false;

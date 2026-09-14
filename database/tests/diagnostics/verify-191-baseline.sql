-- ============================================================================
-- Verify migration 191 (athlete legacy) — the live shape is still the recorded one
-- ============================================================================
-- READ ONLY. Safe to run any time, as often as you like. Nothing here modifies
-- the database.
--
-- The expected numbers are the 2026-09-14-live-dump.csv counts
-- (database/provenance/dumps/2026-09-14-live-dump.csv) — 191 is a NO-OP on production, so this grid reads
-- the same before and after it runs. A later migration that touches one of
-- these tables changes a number here on purpose; anything else, paste the
-- grid back.
--
-- Every row should read OK.
-- ============================================================================

SELECT 'sports: columns' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sports'

UNION ALL

SELECT 'sports: constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sports'::regclass

UNION ALL

SELECT 'sports: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sports'

UNION ALL

SELECT 'sports: policies', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sports'

UNION ALL

SELECT 'sports: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.sports'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'sports: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.sports'::regclass

UNION ALL

SELECT 'performances: columns' AS check_name, '10' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'performances'

UNION ALL

SELECT 'performances: constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.performances'::regclass

UNION ALL

SELECT 'performances: indexes', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'performances'

UNION ALL

SELECT 'performances: policies', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performances'

UNION ALL

SELECT 'performances: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.performances'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'performances: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.performances'::regclass

UNION ALL

SELECT 'season_highlights: columns' AS check_name, '10' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 10 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'season_highlights'

UNION ALL

SELECT 'season_highlights: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.season_highlights'::regclass

UNION ALL

SELECT 'season_highlights: indexes', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'season_highlights'

UNION ALL

SELECT 'season_highlights: policies', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_highlights'

UNION ALL

SELECT 'season_highlights: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.season_highlights'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'season_highlights: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.season_highlights'::regclass

UNION ALL

SELECT 'athlete_badges: columns' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athlete_badges'

UNION ALL

SELECT 'athlete_badges: constraints', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.athlete_badges'::regclass

UNION ALL

SELECT 'athlete_badges: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'athlete_badges'

UNION ALL

SELECT 'athlete_badges: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_badges'

UNION ALL

SELECT 'athlete_badges: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.athlete_badges'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'athlete_badges: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.athlete_badges'::regclass

UNION ALL

SELECT 'athlete_equipment: columns' AS check_name, '18' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 18 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athlete_equipment'

UNION ALL

SELECT 'athlete_equipment: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.athlete_equipment'::regclass

UNION ALL

SELECT 'athlete_equipment: indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'athlete_equipment'

UNION ALL

SELECT 'athlete_equipment: policies', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_equipment'

UNION ALL

SELECT 'athlete_equipment: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.athlete_equipment'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'athlete_equipment: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.athlete_equipment'::regclass

UNION ALL

SELECT 'privacy_settings: columns' AS check_name, '9' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'privacy_settings'

UNION ALL

SELECT 'privacy_settings: constraints', '8', count(*)::text,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.privacy_settings'::regclass

UNION ALL

SELECT 'privacy_settings: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'privacy_settings'

UNION ALL

SELECT 'privacy_settings: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_settings'

UNION ALL

SELECT 'privacy_settings: triggers', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.privacy_settings'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'privacy_settings: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.privacy_settings'::regclass

UNION ALL

SELECT 'connection_suggestions: columns' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connection_suggestions'

UNION ALL

SELECT 'connection_suggestions: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.connection_suggestions'::regclass

UNION ALL

SELECT 'connection_suggestions: indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'connection_suggestions'

UNION ALL

SELECT 'connection_suggestions: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connection_suggestions'

UNION ALL

SELECT 'connection_suggestions: triggers', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.connection_suggestions'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'connection_suggestions: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.connection_suggestions'::regclass

ORDER BY 1;

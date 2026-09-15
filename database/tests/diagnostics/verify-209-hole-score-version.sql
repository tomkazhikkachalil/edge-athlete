-- ============================================================================
-- Verify migration 209 (golf_hole_scores.version + its bump trigger)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 209 the column / function /
-- trigger rows read CHECK FAILED (never an error: the data row reads the
-- column through to_jsonb); AFTER 209 every row reads OK. The migration
-- itself ends in ONE result row ("209 APPLIED | 1 | 1 | 1 | 1"); this
-- grid's first row names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-209-hole-score-version.sql' AS expected, 'verify-209-hole-score-version.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'golf_hole_scores.version column (integer, not null)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_hole_scores' AND column_name = 'version' AND data_type = 'integer' AND is_nullable = 'NO'

UNION ALL

SELECT 'version >= 1 CHECK named', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'golf_hole_scores_version_check' AND contype = 'c'

UNION ALL

SELECT 'bump_hole_score_version(): invoker, empty search_path', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'bump_hole_score_version' AND NOT p.prosecdef
   AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c = 'search_path=')

UNION ALL

SELECT 'bump_hole_score_version(): no EXECUTE for anon / authenticated', 'true',
       (NOT has_function_privilege('anon', 'public.bump_hole_score_version()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.bump_hole_score_version()', 'EXECUTE'))::text,
       CASE WHEN NOT has_function_privilege('anon', 'public.bump_hole_score_version()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.bump_hole_score_version()', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END
 WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'bump_hole_score_version')

UNION ALL

SELECT 'trigger_bump_hole_score_version BEFORE UPDATE', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'trigger_bump_hole_score_version' AND tgrelid = 'public.golf_hole_scores'::regclass AND NOT tgisinternal

UNION ALL

-- Read through to_jsonb(row) so this grid RUNS before 209 (a missing column
-- is a CHECK FAILED row, not a 42703 error).
SELECT 'every hole row has version >= 1', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM golf_hole_scores h WHERE COALESCE((to_jsonb(h) ->> 'version')::int, 0) < 1

UNION ALL

SELECT 'rls still on golf_hole_scores', 'true', c.relrowsecurity::text,
       CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c WHERE c.oid = 'public.golf_hole_scores'::regclass

ORDER BY 1;

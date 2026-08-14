-- ============================================================================
-- Verify migration 087 (instant people search) landed correctly
-- ============================================================================
-- READ ONLY. Safe to run any time, as often as you like. Nothing here modifies
-- the database.
--
-- 087's own verification block reports these as NOTICE lines while it runs,
-- which is easy to miss or scroll past. This is the same set of checks as a
-- RESULT GRID you can re-run later — e.g. after any future migration that
-- touches search, or to confirm the grants are still holding.
--
-- Every row should read OK. Anything else, paste the grid back.
-- ============================================================================

SELECT
  'indexes present' AS check_name,
  '11'              AS expected,
  count(*)::text    AS actual,
  CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_profiles_handle_prefix',     'idx_profiles_first_name_prefix',
    'idx_profiles_last_name_prefix',  'idx_profiles_full_name_prefix',
    'idx_profiles_handle_trgm',       'idx_profiles_first_name_trgm',
    'idx_profiles_last_name_trgm',    'idx_profiles_full_name_trgm',
    'idx_golf_rounds_course_trgm',    'idx_golf_rounds_course_prefix',
    'idx_clubs_name_trgm'
  )

UNION ALL

-- profiles.email was indexed at weight B, which made accounts discoverable by
-- email address through search_profiles — a function anon could call. 087
-- removed it from the trigger body and recomputed the column.
SELECT
  'email out of search vector',
  'false',
  COALESCE(bool_or(p.prosrc LIKE '%NEW.email%'), false)::text,
  CASE WHEN COALESCE(bool_or(p.prosrc LIKE '%NEW.email%'), false)
       THEN 'CHECK FAILED' ELSE 'OK' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'profiles_search_vector_update'

UNION ALL

-- The security half: none of the four may be reachable with the public anon
-- key. search_profiles has NO visibility filter, so before 087 it was a
-- private-profile enumeration hole.
SELECT
  'search fns anon-blocked',
  '0',
  count(*)::text,
  CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('search_profiles', 'search_posts', 'search_clubs', 'search_people')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))

UNION ALL

-- ...but service_role must still be able to run search_people, or every
-- people-search endpoint falls back to the degraded path.
SELECT
  'search_people runs as service_role',
  'true',
  COALESCE(bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE')), false)::text,
  CASE WHEN COALESCE(bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE')), false)
       THEN 'OK' ELSE 'CHECK FAILED' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'search_people'

UNION ALL

-- A one-character query must return without error. include_public => the
-- public set only, so this reads nothing a signed-out visitor cannot already
-- see on /explore.
SELECT
  'search_people answers 1 char',
  'no error',
  count(*)::text || ' row(s)',
  'OK'
FROM public.search_people('a', '{}'::uuid[], TRUE, 5);

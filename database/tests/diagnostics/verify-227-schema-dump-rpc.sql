-- ============================================================================
-- Verify migration 227 (the schema dump RPC — Round 2)
-- ============================================================================
-- READ ONLY. BEFORE 227 the RPC is absent and the rows read CHECK FAILED
-- (the dump rows go through to_regprocedure, never a bare call, so a
-- missing function is a row, not a 42883). AFTER 227: every row OK. The
-- migration ends in ONE result row ("227 APPLIED | true | false | n | 227").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-227-schema-dump-rpc.sql' AS expected, 'verify-227-schema-dump-rpc.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'schema_dump() exists', 'present',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent' ELSE 'present' END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'anon cannot execute', 'false',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE has_function_privilege('anon', 'public.schema_dump()', 'EXECUTE')::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND NOT has_function_privilege('anon', 'public.schema_dump()', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'authenticated cannot execute', 'false',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE has_function_privilege('authenticated', 'public.schema_dump()', 'EXECUTE')::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND NOT has_function_privilege('authenticated', 'public.schema_dump()', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'service_role can execute', 'true',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE has_function_privilege('service_role', 'public.schema_dump()', 'EXECUTE')::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND has_function_privilege('service_role', 'public.schema_dump()', 'EXECUTE') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'security invoker', 'false',
       coalesce((SELECT p.prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'schema_dump'), 'absent'),
       CASE WHEN (SELECT NOT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'schema_dump') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the dump names every public table', (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public'),
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT jsonb_array_length(public.schema_dump() -> ''tables'')::text AS v', false, true, '')))[1]::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT jsonb_array_length(public.schema_dump() -> ''tables'')::text AS v', false, true, '')))[1]::text
                 = (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the cron commands carry no bearer token', '0',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM jsonb_array_elements(coalesce(public.schema_dump() -> ''cron_jobs'', ''[]''::jsonb)) j WHERE j ->> ''command'' ~ ''Bearer (?!__CRON_SECRET__)''', false, true, '')))[1]::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM jsonb_array_elements(coalesce(public.schema_dump() -> ''cron_jobs'', ''[]''::jsonb)) j WHERE j ->> ''command'' ~ ''Bearer (?!__CRON_SECRET__)''', false, true, '')))[1]::text = '0'
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the ledger records 227', '227',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text = '227' THEN 'OK' ELSE 'CHECK FAILED' END;

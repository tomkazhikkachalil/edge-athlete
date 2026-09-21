-- ============================================================================
-- Verify migration 226 (the migration ledger — Round 2)
-- ============================================================================
-- READ ONLY. BEFORE 226 the table is absent and every row below reads
-- CHECK FAILED — the ledger reads go through query_to_xml (a STRING, so a
-- missing table is never a parse-time 42P01) behind a lazy CASE on
-- to_regclass, the twin's rule that it must RUN before the migration. AFTER 226: every row OK. The migration ends in ONE
-- result row ("226 APPLIED | 225 | 226").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-226-schema-migrations-ledger.sql' AS expected, 'verify-226-schema-migrations-ledger.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'schema_migrations exists', 'present',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent' ELSE 'present' END,
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'RLS is on and no policy exists (service role only)', 'rls on, 0 policies',
       coalesce((SELECT CASE WHEN c.relrowsecurity THEN 'rls on' ELSE 'rls OFF' END
                   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'schema_migrations'), 'absent')
       || ', ' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'schema_migrations')::text || ' policies',
       CASE WHEN (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = 'schema_migrations')
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'schema_migrations') = 0
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the API roles hold no privilege on it', '0',
       (SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND grantee IN ('anon', 'authenticated'))::text,
       CASE WHEN (SELECT count(*) FROM information_schema.role_table_grants
                   WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND grantee IN ('anon', 'authenticated')) = 0
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the seed: 225 rows (001–225 less the missing 217, plus 226)', '225',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT (SELECT count(*) FROM public.schema_migrations)::text AS v', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT (SELECT count(*) FROM public.schema_migrations)::text AS v', false, true, '')))[1]::text = '225' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the head is 226', '226',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT (SELECT max(number) FROM public.schema_migrations)::text AS v', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT (SELECT max(number) FROM public.schema_migrations)::text AS v', false, true, '')))[1]::text = '226' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT '217 is absent (the chain''s one gap, recorded in 226''s header)', '0',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT (SELECT count(*) FROM public.schema_migrations WHERE number = 217)::text AS v', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT (SELECT count(*) FROM public.schema_migrations WHERE number = 217)::text AS v', false, true, '')))[1]::text = '0' THEN 'OK' ELSE 'CHECK FAILED' END;

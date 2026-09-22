-- ============================================================================
-- Verify migration 228 (schema_dump() v2 — table grants through
-- has_table_privilege — Round 2)
-- ============================================================================
-- READ ONLY. BEFORE 228 the version row reads 1 (CHECK FAILED); AFTER 228
-- every row reads OK ON PRODUCTION. On a rebuilt staging that has not yet
-- been regenerated from a v2 dump, the "authenticated may read profiles"
-- row reads CHECK FAILED — that is the finding 228 exists for, not a
-- failure of 228. The migration ends in ONE result row
-- ("228 APPLIED | 2 | true | 228").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-228-schema-dump-table-grants.sql' AS expected, 'verify-228-schema-dump-table-grants.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'schema_dump() reports version 2', '2',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT (public.schema_dump() -> ''meta'' ->> ''version'') AS v', false, true, '')))[1]::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT (public.schema_dump() -> ''meta'' ->> ''version'') AS v', false, true, '')))[1]::text = '2' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'authenticated may read profiles (the live truth)', 'true',
       has_table_privilege('authenticated', 'public.profiles', 'SELECT')::text,
       CASE WHEN has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the dump records that grant (the record matches the truth)', 'true',
       CASE WHEN to_regprocedure('public.schema_dump()') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.schema_dump() -> ''tables'') t WHERE t ->> ''name'' = ''profiles'' AND (t -> ''grants'') ? ''authenticated'')::text AS v', false, true, '')))[1]::text END,
       CASE WHEN to_regprocedure('public.schema_dump()') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.schema_dump() -> ''tables'') t WHERE t ->> ''name'' = ''profiles'' AND (t -> ''grants'') ? ''authenticated'')::text AS v', false, true, '')))[1]::text
                 = has_table_privilege('authenticated', 'public.profiles', 'SELECT')::text THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the ledger records 228', '228',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text = '228' THEN 'OK' ELSE 'CHECK FAILED' END;

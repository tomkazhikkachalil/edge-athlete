-- ============================================================================
-- Verify migration 231 (the `organizations` table + the mirror — Round 5 A)
-- ============================================================================
-- READ ONLY. BEFORE 231 the table is absent and every row below reads CHECK
-- FAILED (the reads go through query_to_xml behind a lazy CASE on
-- to_regclass — never a 42P01). AFTER 231: every row OK, and the two
-- "missing" rows stay OK forever — they compare the mirror to its sources.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-231-organizations.sql' AS expected, 'verify-231-organizations.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'organizations exists', 'present',
       CASE WHEN to_regclass('public.organizations') IS NULL THEN 'absent' ELSE 'present' END,
       CASE WHEN to_regclass('public.organizations') IS NULL THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'every league is mirrored (kind = league, same id)', '0 missing',
       CASE WHEN to_regclass('public.organizations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text || '' missing'' AS v FROM public.leagues l WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = l.id AND o.kind = ''league'')', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.organizations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM public.leagues l WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = l.id AND o.kind = ''league'')', false, true, '')))[1]::text = '0' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every club is mirrored (kind = club, same id)', '0 missing',
       CASE WHEN to_regclass('public.organizations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text || '' missing'' AS v FROM public.clubs c WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c.id AND o.kind = ''club'')', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.organizations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM public.clubs c WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c.id AND o.kind = ''club'')', false, true, '')))[1]::text = '0' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no orphan (an organizations row with no source)', '0 orphans',
       CASE WHEN to_regclass('public.organizations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text || '' orphans'' AS v FROM public.organizations o WHERE NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = o.id) AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = o.id)', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.organizations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM public.organizations o WHERE NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = o.id) AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = o.id)', false, true, '')))[1]::text = '0' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the mirror triggers are on leagues and clubs', '2',
       (SELECT count(*)::text FROM pg_trigger t WHERE t.tgname IN ('organizations_mirror_league', 'organizations_mirror_club') AND NOT t.tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger t WHERE t.tgname IN ('organizations_mirror_league', 'organizations_mirror_club') AND NOT t.tgisinternal) = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'service role only (RLS on, 0 policies, no API-role grants)', 'true',
       CASE WHEN to_regclass('public.organizations') IS NULL THEN 'absent'
            ELSE ((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'organizations')
                  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organizations') = 0
                  AND NOT has_table_privilege('authenticated', 'public.organizations', 'SELECT'))::text END,
       CASE WHEN to_regclass('public.organizations') IS NOT NULL
             AND (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'organizations')
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organizations') = 0
             AND NOT has_table_privilege('authenticated', 'public.organizations', 'SELECT') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the ledger records 231', '231',
       CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text END,
       CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT max(number)::text AS v FROM public.schema_migrations', false, true, '')))[1]::text = '231' THEN 'OK' ELSE 'CHECK FAILED' END;

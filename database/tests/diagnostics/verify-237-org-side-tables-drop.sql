-- ============================================================================
-- Verify migration 237 (D-ii drop: the six side-named tables and the three
-- sanction side columns gone; the org columns NOT NULL — Round 5)
-- ============================================================================
-- READ ONLY. Safe before 237 (the rows CHECK FAILED) and after (every row OK).
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-237-org-side-tables-drop.sql' AS expected, 'verify-237-org-side-tables-drop.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'the six side-named tables are gone', '0',
       (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('league_clubs','league_affiliations','league_requests','club_requests','league_join_requests','club_join_requests')),
       CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('league_clubs','league_affiliations','league_requests','club_requests','league_join_requests','club_join_requests')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no view or function names them either', '0',
       ((SELECT count(*) FROM information_schema.views WHERE table_schema = 'public' AND table_name IN ('league_clubs','league_affiliations','league_requests','club_requests','league_join_requests','club_join_requests'))
        + (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname NOT IN ('schema_dump','provenance_inventory') AND (p.prosrc ~ '\mleague_clubs\M' OR p.prosrc ~ '\mleague_affiliations\M' OR p.prosrc ~ '\m(league|club)_requests\M' OR p.prosrc ~ '\m(league|club)_join_requests\M')))::text,
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname NOT IN ('schema_dump','provenance_inventory') AND (p.prosrc ~ '\mleague_clubs\M' OR p.prosrc ~ '\mleague_affiliations\M' OR p.prosrc ~ '\m(league|club)_requests\M' OR p.prosrc ~ '\m(league|club)_join_requests\M')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'sanction_grants: the three side columns are gone, the two org columns NOT NULL', '0 old, 2 org NOT NULL',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_league_id','grantee_kind','grantee_id')) || ' old, ' ||
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_org_id','grantee_org_id') AND is_nullable = 'NO') || ' org NOT NULL',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_league_id','grantee_kind','grantee_id')) = 0
             AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_org_id','grantee_org_id') AND is_nullable = 'NO') = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every sanction grant names two organizations', '0 dangling',
       (SELECT count(*)::text || ' dangling' FROM public.sanction_grants g WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = g.grantor_org_id) OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = g.grantee_org_id)),
       CASE WHEN (SELECT count(*) FROM public.sanction_grants g WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = g.grantor_org_id) OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = g.grantee_org_id)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the three org tables carry the data (never empty while any org has an edge / request)', 'present',
       (SELECT count(*)::text || ' affiliations, ' FROM public.affiliations) || (SELECT count(*)::text || ' requests, ' FROM public.org_requests) || (SELECT count(*)::text || ' join requests' FROM public.org_join_requests),
       CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('affiliations','org_requests','org_join_requests')) = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every affiliation parent is a league', '0 odd',
       (SELECT count(*)::text || ' odd' FROM public.affiliations a JOIN public.organizations p ON p.id = a.parent_org_id WHERE p.kind <> 'league'),
       CASE WHEN (SELECT count(*) FROM public.affiliations a JOIN public.organizations p ON p.id = a.parent_org_id WHERE p.kind <> 'league') = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'ledger head', '237',
       (SELECT max(number)::text FROM public.schema_migrations),
       CASE WHEN (SELECT max(number) FROM public.schema_migrations) >= 237 THEN 'OK' ELSE 'CHECK FAILED' END;

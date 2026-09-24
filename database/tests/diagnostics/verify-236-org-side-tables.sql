-- ============================================================================
-- Verify migration 236 (D-ii additive: affiliations, org_requests,
-- org_join_requests, sanction_grants org columns — Round 5)
-- ============================================================================
-- READ ONLY. Safe before 236 (the rows CHECK FAILED) and after (every row OK).
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-236-org-side-tables.sql' AS expected, 'verify-236-org-side-tables.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'the three new tables exist with RLS on', '3',
       (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('affiliations','org_requests','org_join_requests') AND rowsecurity),
       CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('affiliations','org_requests','org_join_requests') AND rowsecurity) = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no API role reads the new tables (service_role only)', '0',
       (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('affiliations','org_requests','org_join_requests') AND grantee IN ('anon','authenticated','PUBLIC')),
       CASE WHEN (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('affiliations','org_requests','org_join_requests') AND grantee IN ('anon','authenticated','PUBLIC')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'affiliations = league_clubs ∪ league_affiliations (child → parent)',
       ((SELECT count(*) FROM public.league_clubs) + (SELECT count(*) FROM public.league_affiliations))::text,
       (SELECT count(*)::text FROM public.affiliations),
       CASE WHEN (SELECT count(*) FROM public.affiliations) = (SELECT count(*) FROM public.league_clubs) + (SELECT count(*) FROM public.league_affiliations)
             AND NOT EXISTS (SELECT 1 FROM public.league_clubs lc WHERE NOT EXISTS (SELECT 1 FROM public.affiliations a WHERE a.org_id = lc.club_id AND a.parent_org_id = lc.league_id AND a.status = lc.status AND a.affiliation_type = lc.affiliation_type AND a.initiated_by = CASE lc.initiated_by WHEN 'club' THEN 'child' ELSE 'parent' END))
             AND NOT EXISTS (SELECT 1 FROM public.league_affiliations la WHERE NOT EXISTS (SELECT 1 FROM public.affiliations a WHERE a.org_id = la.league_id AND a.parent_org_id = la.parent_league_id AND a.status = la.status AND a.initiated_by = la.initiated_by))
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every affiliation child and parent is an org of the expected kind (club→league or league→league)', '0 odd',
       (SELECT count(*)::text || ' odd' FROM public.affiliations a JOIN public.organizations c ON c.id = a.org_id JOIN public.organizations p ON p.id = a.parent_org_id WHERE p.kind <> 'league'),
       CASE WHEN (SELECT count(*) FROM public.affiliations a JOIN public.organizations p ON p.id = a.parent_org_id WHERE p.kind <> 'league') = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'org_requests = league_requests ∪ club_requests, ids carried, kind set',
       ((SELECT count(*) FROM public.league_requests) + (SELECT count(*) FROM public.club_requests))::text,
       (SELECT count(*)::text FROM public.org_requests),
       CASE WHEN (SELECT count(*) FROM public.org_requests) = (SELECT count(*) FROM public.league_requests) + (SELECT count(*) FROM public.club_requests)
             AND NOT EXISTS (SELECT 1 FROM public.league_requests r WHERE NOT EXISTS (SELECT 1 FROM public.org_requests o WHERE o.id = r.id AND o.kind = 'league' AND o.sport_key = r.sport_key AND o.status = r.status AND o.created_org_id IS NOT DISTINCT FROM r.created_league_id))
             AND NOT EXISTS (SELECT 1 FROM public.club_requests r WHERE NOT EXISTS (SELECT 1 FROM public.org_requests o WHERE o.id = r.id AND o.kind = 'club' AND o.status = r.status AND o.created_org_id IS NOT DISTINCT FROM r.created_club_id))
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'one pending request per profile across both kinds (the partial unique)', 'org_requests_one_pending',
       COALESCE((SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'org_requests_one_pending' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%pending%'), 'missing'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'org_requests_one_pending' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%pending%') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'org_join_requests = both join-request tables, ids carried',
       ((SELECT count(*) FROM public.league_join_requests) + (SELECT count(*) FROM public.club_join_requests))::text,
       (SELECT count(*)::text FROM public.org_join_requests),
       CASE WHEN (SELECT count(*) FROM public.org_join_requests) = (SELECT count(*) FROM public.league_join_requests) + (SELECT count(*) FROM public.club_join_requests)
             AND NOT EXISTS (SELECT 1 FROM public.league_join_requests j WHERE NOT EXISTS (SELECT 1 FROM public.org_join_requests o WHERE o.id = j.id AND o.org_id = j.league_id AND o.profile_id = j.profile_id))
             AND NOT EXISTS (SELECT 1 FROM public.club_join_requests j WHERE NOT EXISTS (SELECT 1 FROM public.org_join_requests o WHERE o.id = j.id AND o.org_id = j.club_id AND o.profile_id = j.profile_id))
            THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'sanction_grants: grantor_org_id / grantee_org_id NOT NULL and equal to the old columns', '2 columns, 0 mismatched',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_org_id','grantee_org_id') AND is_nullable = 'NO') || ' columns, ' ||
       (SELECT count(*)::text FROM public.sanction_grants WHERE grantor_org_id IS DISTINCT FROM grantor_league_id OR grantee_org_id IS DISTINCT FROM grantee_id) || ' mismatched',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_org_id','grantee_org_id') AND is_nullable = 'NO') = 2
             AND (SELECT count(*) FROM public.sanction_grants WHERE grantor_org_id IS DISTINCT FROM grantor_league_id OR grantee_org_id IS DISTINCT FROM grantee_id) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'one live grant per (grantor, grantee)', 'sanction_grants_live_pair',
       COALESCE((SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sanction_grants_live_pair' AND indexdef LIKE '%UNIQUE%'), 'missing'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sanction_grants_live_pair' AND indexdef LIKE '%UNIQUE%') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the two updated_at triggers', '2',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('affiliations_updated_at','org_requests_updated_at') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('affiliations_updated_at','org_requests_updated_at') AND NOT tgisinternal) = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the old tables and columns are STILL here (237 drops them)', '6 tables, 3 columns',
       (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('league_clubs','league_affiliations','league_requests','club_requests','league_join_requests','club_join_requests')) || ' tables, ' ||
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_league_id','grantee_kind','grantee_id')) || ' columns',
       CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('league_clubs','league_affiliations','league_requests','club_requests','league_join_requests','club_join_requests')) = 6
             AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_league_id','grantee_kind','grantee_id')) = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'ledger head', '236',
       (SELECT max(number)::text FROM public.schema_migrations),
       CASE WHEN (SELECT max(number) FROM public.schema_migrations) >= 236 THEN 'OK' ELSE 'CHECK FAILED' END;

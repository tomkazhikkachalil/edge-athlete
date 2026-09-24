-- ============================================================================
-- Verify migration 235 (the drop: the pair gone, leagues / clubs as
-- security_invoker views over organizations — Round 5 D)
-- ============================================================================
-- READ ONLY. Safe before 235 (catalog reads; the rows CHECK FAILED) and after
-- (every row OK). The view rows read THROUGH each view and compare with the
-- org count of its kind — the one behavioural check the catalog cannot give.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-235-org-drop.sql' AS expected, 'verify-235-org-drop.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'no league_id / club_id column on the fifteen pair tables', '0',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('league_id','club_id') AND table_name IN ('athlete_claim_invites','competitions','divisions','events','memberships','org_claim_invites','org_sites','org_staff_audit','org_staff_invites','registration_windows','registrations','seasons','sport_events','teams','venues')),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('league_id','club_id') AND table_name IN ('athlete_claim_invites','competitions','divisions','events','memberships','org_claim_invites','org_sites','org_staff_audit','org_staff_invites','registration_windows','registrations','seasons','sport_events','teams','venues')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'org_id still NOT NULL on the ten `= 1` tables', '10',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' AND is_nullable = 'NO'),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' AND is_nullable = 'NO') = 10 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'events keep one scope at most (over org_id)', 'num_nonnulls(org_id, division_id, team_id) <= 1',
       COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'events_one_scope_check'), 'missing'),
       CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'events_one_scope_check') LIKE '%num_nonnulls(org_id, division_id, team_id) <= 1%' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the sync and mirror triggers are gone', '0',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources') AND NOT tgisinternal) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the eight dead functions are gone', '0',
       (SELECT count(*)::text FROM pg_proc WHERE proname IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources','leagues_search_vector_update','clubs_search_vector_update','search_doc_sync_league','search_doc_sync_club')),
       CASE WHEN (SELECT count(*) FROM pg_proc WHERE proname IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources','leagues_search_vector_update','clubs_search_vector_update','search_doc_sync_league','search_doc_sync_club')) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'leagues and clubs are security_invoker views', '2 views',
       (SELECT count(*)::text || ' views' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('leagues','clubs') AND c.relkind = 'v' AND 'security_invoker=true' = ANY(c.reloptions)),
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('leagues','clubs') AND c.relkind = 'v' AND 'security_invoker=true' = ANY(c.reloptions)) = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the leagues view answers the league count', (SELECT count(*)::text FROM public.organizations WHERE kind = 'league'),
       (SELECT count(*)::text FROM public.leagues),
       CASE WHEN (SELECT count(*) FROM public.leagues) = (SELECT count(*) FROM public.organizations WHERE kind = 'league') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the clubs view answers the club count (primary_sport = sport_key)', (SELECT count(*)::text FROM public.organizations WHERE kind = 'club'),
       (SELECT count(*)::text FROM public.clubs),
       CASE WHEN (SELECT count(*) FROM public.clubs) = (SELECT count(*) FROM public.organizations WHERE kind = 'club')
             AND NOT EXISTS (SELECT 1 FROM public.clubs c JOIN public.organizations o ON o.id = c.id WHERE c.primary_sport IS DISTINCT FROM o.sport_key) THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'service_role reads / updates / deletes the views, never inserts', 'S U D only',
       (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'leagues' AND grantee = 'service_role'),
       CASE WHEN (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'leagues' AND grantee = 'service_role') = 'DELETE,SELECT,UPDATE'
             AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('leagues','clubs') AND grantee IN ('anon','authenticated')) THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no FK targets the views', '0',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass)),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every org has its search document (by kind)', '0 missing',
       (SELECT count(*)::text || ' missing' FROM (SELECT o.kind, o.id FROM public.organizations o EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd) x),
       CASE WHEN (SELECT count(*) FROM (SELECT o.kind, o.id FROM public.organizations o EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd) x) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'ledger head', '235',
       (SELECT max(number)::text FROM public.schema_migrations),
       CASE WHEN (SELECT max(number) FROM public.schema_migrations) >= 235 THEN 'OK' ELSE 'CHECK FAILED' END;

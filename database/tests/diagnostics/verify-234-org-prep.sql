-- ============================================================================
-- Verify migration 234 (step D prep: org_id FK actions, one site per org, the
-- guards, search from organizations, the nine FKs re-pointed, org_id
-- authoritative on UPDATE, schema_dump v3 — Round 5 D)
-- ============================================================================
-- READ ONLY. Safe before 234 (catalog reads; the rows CHECK FAILED) and after
-- (every row OK). The behavioural rows are pure catalog / count reads — the
-- attach / detach / re-attach exercise of org_pair_sync is run by hand on a
-- throwaway row (the plan's recipe), never here.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-234-org-prep.sql' AS expected, 'verify-234-org-prep.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'the ten `= 1` org_id FKs cascade', '10',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'c'),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'c') = 10 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the four nullable org_id FKs set null', '4',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'n'),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'n') = 4 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no org_id FK is still NO ACTION', '0',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'a'),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'a') = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'only the 28 pair FKs still target leagues / clubs (the nine re-pointed)', '28',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass)),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass)) = 28 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the nine non-pair FKs target organizations', '9',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname NOT LIKE '%\_org\_id\_fkey'),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname NOT LIKE '%\_org\_id\_fkey') = 9 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'one site per org on org_id', 'org_sites_org_uniq UNIQUE (org_id)',
       COALESCE((SELECT 'org_sites_org_uniq ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'org_sites_org_uniq'), 'missing'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_org_uniq' AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (org_id)') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'a league needs a sport_key (CHECK on organizations)', 'present',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_league_sport_key_check' AND contype = 'c') THEN 'present' ELSE 'missing' END,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_league_sport_key_check' AND contype = 'c') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'kind is immutable (BEFORE UPDATE OF kind trigger)', 'present',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_kind_immutable' AND NOT tgisinternal) THEN 'present' ELSE 'missing' END,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_kind_immutable' AND NOT tgisinternal) THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'search syncs from organizations (two triggers)', '2',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('organizations_search_doc', 'organizations_search_doc_delete') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('organizations_search_doc', 'organizations_search_doc_delete') AND NOT tgisinternal) = 2 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the four leagues / clubs search triggers are gone', '0',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('clubs_search_doc', 'clubs_search_doc_delete', 'leagues_search_doc', 'leagues_search_doc_delete') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('clubs_search_doc', 'clubs_search_doc_delete', 'leagues_search_doc', 'leagues_search_doc_delete') AND NOT tgisinternal) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every org has its search document (by kind)', '0 missing',
       (SELECT count(*)::text || ' missing' FROM (SELECT o.kind, o.id FROM public.organizations o EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd) x),
       CASE WHEN (SELECT count(*) FROM (SELECT o.kind, o.id FROM public.organizations o EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd) x) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'no league / club search document without its org', '0 orphans',
       (SELECT count(*)::text || ' orphans' FROM public.search_documents sd WHERE sd.entity_type IN ('league', 'club') AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = sd.entity_id AND o.kind = sd.entity_type)),
       CASE WHEN (SELECT count(*) FROM public.search_documents sd WHERE sd.entity_type IN ('league', 'club') AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = sd.entity_id AND o.kind = sd.entity_type)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'search_clubs reads organizations', 'FROM public.organizations c',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'search_clubs') LIKE '%FROM public.organizations c%' THEN 'FROM public.organizations c' ELSE 'still FROM clubs' END,
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'search_clubs') LIKE '%FROM public.organizations c%' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'org_pair_sync: org_id authoritative when it changed', 'IS DISTINCT FROM OLD.org_id',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'org_pair_sync') LIKE '%NEW.org_id IS DISTINCT FROM OLD.org_id THEN%' THEN 'IS DISTINCT FROM OLD.org_id' ELSE '233 body' END,
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname = 'org_pair_sync') LIKE '%NEW.org_id IS DISTINCT FROM OLD.org_id THEN%' THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the fifteen org_pair_sync triggers still stand', '15',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'org_pair_sync' AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'org_pair_sync' AND NOT tgisinternal) = 15 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the three mirrors still stand (until 235)', '3',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('organizations_mirror_league', 'organizations_mirror_club', 'organizations_mirror_sources') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('organizations_mirror_league', 'organizations_mirror_club', 'organizations_mirror_sources') AND NOT tgisinternal) = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'schema_dump v3 carries view options', '3',
       (public.schema_dump() -> 'meta' ->> 'version'),
       CASE WHEN (public.schema_dump() -> 'meta' ->> 'version')::int = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'ledger head', '234',
       (SELECT max(number)::text FROM public.schema_migrations),
       CASE WHEN (SELECT max(number) FROM public.schema_migrations) >= 234 THEN 'OK' ELSE 'CHECK FAILED' END;

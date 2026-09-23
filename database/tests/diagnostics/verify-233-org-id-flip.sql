-- ============================================================================
-- Verify migration 233 (the flip: org_id real, the pair mirrored from it,
-- organizations the source — Round 5 C)
-- ============================================================================
-- READ ONLY. Safe before 233 (catalog reads; every row CHECK FAILED) and
-- after (every row OK). The agreement rows compare org_id to the pair on
-- the four busiest tables — they must read 0 forever, in both directions.
-- ============================================================================

WITH cols AS (
  SELECT table_name, is_generated, is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'org_id'
)

SELECT '0 file' AS check_name, 'verify-233-org-id-flip.sql' AS expected, 'verify-233-org-id-flip.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'org_id is a real column everywhere (none generated)', '0 generated',
       (SELECT count(*)::text || ' generated' FROM cols WHERE is_generated = 'ALWAYS'),
       CASE WHEN (SELECT count(*) FROM cols) = 15 AND NOT EXISTS (SELECT 1 FROM cols WHERE is_generated = 'ALWAYS') THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'NOT NULL on the ten `= 1` tables', '10',
       (SELECT count(*)::text FROM cols WHERE is_nullable = 'NO'),
       CASE WHEN (SELECT count(*) FROM cols WHERE is_nullable = 'NO') = 10 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'org_pair_sync on all fifteen', '15',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'org_pair_sync' AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'org_pair_sync' AND NOT tgisinternal) = 15 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the six uniques lead with org_id', '6',
       (SELECT count(*)::text FROM pg_constraint WHERE contype = 'u'
         AND conname IN ('competitions_org_season_name_uniq','memberships_uniq','reg_windows_uniq','registrations_uniq','seasons_org_label_uniq','teams_org_name_uniq')
         AND pg_get_constraintdef(oid) LIKE '%(org_id,%'),
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE contype = 'u'
         AND conname IN ('competitions_org_season_name_uniq','memberships_uniq','reg_windows_uniq','registrations_uniq','seasons_org_label_uniq','teams_org_name_uniq')
         AND pg_get_constraintdef(oid) LIKE '%(org_id,%') = 6 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'three mirrors (two sources → organizations, organizations → sources)', '3',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources') AND NOT tgisinternal),
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources') AND NOT tgisinternal) = 3 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'org_id agrees with the pair (memberships · teams · seasons · org_sites)', '0 disagreeing',
       ((SELECT count(*) FROM public.memberships WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
        + (SELECT count(*) FROM public.teams WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
        + (SELECT count(*) FROM public.seasons WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
        + (SELECT count(*) FROM public.org_sites WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id)))::text || ' disagreeing',
       CASE WHEN (SELECT count(*) FROM public.memberships WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
               + (SELECT count(*) FROM public.teams WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
               + (SELECT count(*) FROM public.seasons WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
               + (SELECT count(*) FROM public.org_sites WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'the pair names the kind organizations records', '0 crossed',
       ((SELECT count(*) FROM public.memberships m JOIN public.organizations o ON o.id = m.org_id WHERE (o.kind = 'league' AND m.league_id IS NULL) OR (o.kind = 'club' AND m.club_id IS NULL))
        + (SELECT count(*) FROM public.teams t JOIN public.organizations o ON o.id = t.org_id WHERE (o.kind = 'league' AND t.league_id IS NULL) OR (o.kind = 'club' AND t.club_id IS NULL)))::text || ' crossed',
       CASE WHEN (SELECT count(*) FROM public.memberships m JOIN public.organizations o ON o.id = m.org_id WHERE (o.kind = 'league' AND m.league_id IS NULL) OR (o.kind = 'club' AND m.club_id IS NULL))
               + (SELECT count(*) FROM public.teams t JOIN public.organizations o ON o.id = t.org_id WHERE (o.kind = 'league' AND t.league_id IS NULL) OR (o.kind = 'club' AND t.club_id IS NULL)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'every organizations row has its source row', '0 missing',
       ((SELECT count(*) FROM public.organizations o WHERE o.kind = 'league' AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = o.id))
        + (SELECT count(*) FROM public.organizations o WHERE o.kind = 'club' AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = o.id)))::text || ' missing',
       CASE WHEN (SELECT count(*) FROM public.organizations o WHERE o.kind = 'league' AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = o.id))
               + (SELECT count(*) FROM public.organizations o WHERE o.kind = 'club' AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = o.id)) = 0 THEN 'OK' ELSE 'CHECK FAILED' END

UNION ALL

SELECT 'ledger records 233', 'present',
       CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 233) THEN 'present' ELSE 'absent' END,
       CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 233) THEN 'OK' ELSE 'CHECK FAILED' END;

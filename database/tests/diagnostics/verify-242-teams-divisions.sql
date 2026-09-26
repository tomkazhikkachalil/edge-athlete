-- ============================================================================
-- Verify migration 242 (teams & divisions: team identity, sport_event_teams,
-- the team roster season, the switches, the team_roster notification)
-- ============================================================================
-- READ ONLY, runnable before 242 (the structural rows read CHECK FAILED) and
-- after (every row OK; INFO rows are counts to read, never failures). The
-- migration ends in ONE result row ("242 APPLIED | 4 | 4 | 1 | 1 | 1 | 1 | 242").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-242-teams-divisions.sql' AS expected, 'verify-242-teams-divisions.sql' AS actual, 'OK' AS status

UNION ALL
SELECT 'teams identity columns', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'teams'
   AND column_name IN ('sport_key', 'primary_color', 'secondary_color', 'logo_path')

UNION ALL
SELECT 'teams identity CHECKs', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('teams_sport_key_check', 'teams_primary_color_check', 'teams_secondary_color_check', 'teams_logo_path_check')

UNION ALL
SELECT 'sport_event_teams exists with RLS on', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'sport_event_teams' AND c.relrowsecurity

UNION ALL
SELECT 'sport_event_teams: anon / authenticated hold no privilege', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'sport_event_teams' AND grantee IN ('anon', 'authenticated')

UNION ALL
SELECT 'sport_event_teams team index (the FK rule, 239)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_sport_event_teams_team'

UNION ALL
SELECT 'team roster index', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_memberships_team_roster'

UNION ALL
SELECT 'team roster season CHECK (NOT VALID until the INFO row reads 0)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'memberships_team_roster_season_check'

UNION ALL
SELECT 'notifications admit team_roster', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%''team_roster''%'

UNION ALL
SELECT 'no org with teams has operates_teams off', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.organizations o
 WHERE NOT o.operates_teams AND EXISTS (SELECT 1 FROM public.teams t WHERE t.org_id = o.id)

UNION ALL
SELECT 'no org with competitions has operates_competitions off', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.organizations o
 WHERE NOT o.operates_competitions AND EXISTS (SELECT 1 FROM public.competitions c WHERE c.org_id = o.id)

UNION ALL
SELECT 'INFO team roster rows still without a season (orgs with no season)', 'info', count(*)::text, 'INFO'
  FROM public.memberships WHERE kind = 'roster' AND scope_type = 'team' AND season_id IS NULL

UNION ALL
SELECT 'INFO sport_event_teams rows', 'info',
       CASE WHEN to_regclass('public.sport_event_teams') IS NULL THEN 'absent (pre-242)'
            ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.sport_event_teams', false, true, '')))[1]::text END,
       'INFO'

UNION ALL
SELECT 'INFO teams with a sport', 'info',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'sport_key') THEN 'absent (pre-242)'
            ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) FILTER (WHERE sport_key IS NOT NULL) || '' of '' || count(*) AS c FROM public.teams', false, true, '')))[1]::text END,
       'INFO'

UNION ALL
SELECT 'ledger records 242', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM public.schema_migrations WHERE number = 242;

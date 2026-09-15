-- ============================================================================
-- Verify migration 212 (the match-play format vocabulary · group_members.side
-- · sport_event_matches — Events program, phase 3's one schema migration)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 212 the constraint / column /
-- table rows read CHECK FAILED (never an error: the new table is looked up
-- through the catalogs by name, the new column through to_jsonb); AFTER 212
-- every row reads OK. The migration ends in ONE result row
-- ("212 APPLIED | 1 | 1 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-212-sport-event-match-play.sql' AS expected, 'verify-212-sport-event-match-play.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'sport_events_format_check carries match_gross + match_net and still stroke_net', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_events_format_check' AND conrelid = 'public.sport_events'::regclass
   AND pg_get_constraintdef(oid) LIKE '%match_gross%' AND pg_get_constraintdef(oid) LIKE '%match_net%' AND pg_get_constraintdef(oid) LIKE '%stroke_net%'

UNION ALL

SELECT 'sport_events: constraints (207 left 12 — DROP + ADD keeps it)', '12', count(*)::text,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_group_members.side column (smallint, nullable)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_group_members' AND column_name = 'side' AND data_type = 'smallint' AND is_nullable = 'YES'

UNION ALL

SELECT 'sport_event_group_members_side_check', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_group_members_side_check' AND contype = 'c'

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 212.
SELECT 'every side is 1, 2 or absent', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_group_members m WHERE (to_jsonb(m) ->> 'side') IS NOT NULL AND (to_jsonb(m) ->> 'side') NOT IN ('1', '2')

UNION ALL

SELECT 'sport_event_matches: table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sport_event_matches'

UNION ALL

SELECT 'sport_event_matches: rls on', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'sport_event_matches' AND c.relrowsecurity

UNION ALL

SELECT 'sport_event_matches: zero policies', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_event_matches'

UNION ALL

SELECT 'sport_event_matches: no grant to anon / authenticated', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'sport_event_matches' AND grantee IN ('anon', 'authenticated')

UNION ALL

SELECT 'sport_event_matches: constraints (pk, group UNIQUE, 7 CHECKs)', '9', count(*)::text,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_matches' AND c.contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_matches: the two FKs CASCADE', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_matches' AND c.contype = 'f' AND c.confdeltype = 'c'

UNION ALL

SELECT 'sport_event_matches_group_uniq + sport_event_matches_decided_check named', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('sport_event_matches_group_uniq', 'sport_event_matches_decided_check')

UNION ALL

SELECT 'sport_event_matches_updated_at trigger', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_matches' AND t.tgname = 'sport_event_matches_updated_at' AND NOT t.tgisinternal

UNION ALL

SELECT 'idx_sport_event_matches_round', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_sport_event_matches_round'

UNION ALL

SELECT 'sport_event_matches in the PostgREST inventory (NOTIFY pgrst ran; check:schema sees it)', '1',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'sport_event_matches' AND c.relkind = 'r')::text,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'sport_event_matches' AND c.relkind = 'r') = 1 THEN 'OK' ELSE 'CHECK FAILED' END

ORDER BY 1;

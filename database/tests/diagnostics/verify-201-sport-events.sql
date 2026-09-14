-- ============================================================================
-- Verify migration 201 (sport_events + sport_event_rounds)
-- ============================================================================
-- READ ONLY. Safe to run any time. The same grid 201 ends with: the tables
-- exist, RLS is on with zero policies, anon cannot read, the constraint /
-- index / trigger counts match. Every row should read OK.
-- ============================================================================

SELECT 'sport_events: table' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sport_events'

UNION ALL

SELECT 'sport_event_rounds: table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sport_event_rounds'

UNION ALL

SELECT 'sport_events: rls on, zero policies', 'true', (relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_events'))::text,
       CASE WHEN relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_events') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.sport_events'::regclass

UNION ALL

SELECT 'sport_event_rounds: rls on, zero policies', 'true', (relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_event_rounds'))::text,
       CASE WHEN relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_event_rounds') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.sport_event_rounds'::regclass

UNION ALL

SELECT 'anon cannot read either', 'false',
       (has_table_privilege('anon', 'public.sport_events', 'SELECT') OR has_table_privilege('anon', 'public.sport_event_rounds', 'SELECT'))::text,
       CASE WHEN has_table_privilege('anon', 'public.sport_events', 'SELECT') OR has_table_privilege('anon', 'public.sport_event_rounds', 'SELECT') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'sport_events: constraints', '11', count(*)::text,
       CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_rounds: constraints', '8', count(*)::text,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_rounds'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'indexes', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_sport_event%'

UNION ALL

SELECT 'updated_at triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname IN ('sport_events_updated_at', 'sport_event_rounds_updated_at') AND NOT tgisinternal

ORDER BY 1;

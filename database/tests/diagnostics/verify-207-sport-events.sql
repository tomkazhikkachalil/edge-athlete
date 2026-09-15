-- ============================================================================
-- Verify migration 207 (sport_events.format_config · sport_event_rounds.name ·
-- the flight CHECK — Events program, phase 2's one migration)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 207 it reads CHECK FAILED on the
-- column / constraint rows (never an error); AFTER 207 every row reads OK.
-- The same grid closes the migration file; this copy is the standalone
-- check, the 201–206 shape.
-- ============================================================================

SELECT 'sport_events.format_config column' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'format_config' AND data_type = 'jsonb' AND is_nullable = 'NO'

UNION ALL

SELECT 'sport_event_rounds.name column', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_rounds' AND column_name = 'name' AND data_type = 'text' AND is_nullable = 'YES'

UNION ALL

SELECT 'three constraints named', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('sport_events_format_config_check', 'sport_event_rounds_name_check', 'sport_event_participants_flight_check') AND contype = 'c'

UNION ALL

SELECT 'sport_events: constraints (201 had 11)', '12', count(*)::text,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_rounds: constraints (201 had 8)', '9', count(*)::text,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_rounds'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_participants: constraints (202 had 10)', '11', count(*)::text,
       CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_participants'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 207 (a missing
-- column is then a CHECK FAILED row, not a 42703 error — the twin is the
-- "did it run?" question, so it must answer "no" rather than crash).
SELECT 'every event has an object format_config', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_events e WHERE jsonb_typeof(to_jsonb(e) -> 'format_config') IS DISTINCT FROM 'object'

UNION ALL

SELECT 'no flight outside 1..20', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_participants WHERE flight IS NOT NULL AND length(btrim(flight)) NOT BETWEEN 1 AND 20

UNION ALL

SELECT 'rls still on, zero policies, all three', 'true',
       (bool_and(c.relrowsecurity) AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename IN ('sport_events', 'sport_event_rounds', 'sport_event_participants')))::text,
       CASE WHEN bool_and(c.relrowsecurity) AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename IN ('sport_events', 'sport_event_rounds', 'sport_event_participants')) THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c WHERE c.oid IN ('public.sport_events'::regclass, 'public.sport_event_rounds'::regclass, 'public.sport_event_participants'::regclass)

ORDER BY 1;

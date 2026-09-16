-- ============================================================================
-- Verify migration 214 (join_mode 'open' · visibility default public ·
-- sport_events.self_entry · sport_event_participants.recorder — Events
-- program, phase 4)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 214 the constraint / default /
-- column rows read CHECK FAILED (the new columns are read through to_jsonb,
-- never by name — never an error); AFTER 214 every row reads OK. The
-- migration ends in ONE result row ("214 APPLIED | 3 | 1 | 1"); the first
-- row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-214-sport-events-open-joining-recorders.sql' AS expected, 'verify-214-sport-events-open-joining-recorders.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'sport_events_join_mode_check carries open and still invite + request', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_events_join_mode_check' AND conrelid = 'public.sport_events'::regclass
   AND pg_get_constraintdef(oid) LIKE '%''open''%' AND pg_get_constraintdef(oid) LIKE '%''invite''%' AND pg_get_constraintdef(oid) LIKE '%''request''%'

UNION ALL

SELECT 'sport_events.visibility defaults to public', 'true',
       (column_default LIKE '%public%')::text,
       CASE WHEN column_default LIKE '%public%' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'visibility'

UNION ALL

SELECT 'sport_events.self_entry column (boolean, not null, default true)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'self_entry' AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'true'

UNION ALL

SELECT 'sport_event_participants.recorder column (boolean, not null, default false)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_participants' AND column_name = 'recorder' AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false'

UNION ALL

SELECT 'sport_events: constraints (207 left 12 — DROP + ADD keeps it)', '12', count(*)::text,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_participants: constraints (207 left 11 — a boolean adds none)', '11', count(*)::text,
       CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_participants'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 214.
SELECT 'every event reads self_entry true or false (existing rows: true)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_events e WHERE (to_jsonb(e) ->> 'self_entry') NOT IN ('true', 'false')

UNION ALL

SELECT 'no follower row plays (202 follower_check holds with recorders)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_participants WHERE role = 'follower' AND playing = true

UNION ALL

SELECT 'existing events untouched: none written by this migration (no UPDATE — a visibility count only)', 'informational',
       (SELECT count(*) FROM sport_events WHERE visibility = 'public')::text || ' public of ' || (SELECT count(*) FROM sport_events)::text, 'OK'

ORDER BY 1;

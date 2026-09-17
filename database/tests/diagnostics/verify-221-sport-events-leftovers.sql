-- ============================================================================
-- Verify migration 221 (the Stableford formats, sport_events.competition_id,
-- sport_event_rounds.timezone — Events + formats leftovers)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 221 the new rows read CHECK
-- FAILED (the new columns are read through to_jsonb, never by name — never
-- an error); AFTER 221 every row reads OK. The migration ends in ONE result
-- row ("221 APPLIED | 1 | 1 | 1 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-221-sport-events-leftovers.sql' AS expected, 'verify-221-sport-events-leftovers.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'sport_events_format_check admits the six formats (stableford_gross + stableford_net)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_events_format_check' AND conrelid = 'public.sport_events'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%stableford_gross%' AND pg_get_constraintdef(oid) LIKE '%stableford_net%' AND pg_get_constraintdef(oid) LIKE '%match_net%'

UNION ALL

SELECT 'sport_events.competition_id (uuid, nullable)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'competition_id' AND data_type = 'uuid' AND is_nullable = 'YES'

UNION ALL

SELECT 'FK sport_events.competition_id → competitions (ON DELETE SET NULL)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.conrelid = 'public.sport_events'::regclass AND c.contype = 'f' AND c.confrelid = 'public.competitions'::regclass
   AND a.attname = 'competition_id' AND c.confdeltype = 'n'

UNION ALL

SELECT 'idx_sport_events_competition (partial, competition_id IS NOT NULL)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sport_events' AND indexname = 'idx_sport_events_competition' AND indexdef LIKE '%WHERE%'

UNION ALL

SELECT 'sport_event_rounds.timezone (text, nullable)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_rounds' AND column_name = 'timezone' AND data_type = 'text' AND is_nullable = 'YES'

UNION ALL

SELECT 'sport_event_rounds_timezone_check (1..64 or NULL)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_event_rounds_timezone_check' AND conrelid = 'public.sport_event_rounds'::regclass AND contype = 'c'

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 221.
SELECT 'no event carries a bracket link yet (existing rows: null)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_events e WHERE (to_jsonb(e) ->> 'competition_id') IS NOT NULL

UNION ALL

SELECT 'no round carries a zone yet (existing rows: null)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_rounds r WHERE (to_jsonb(r) ->> 'timezone') IS NOT NULL

UNION ALL

SELECT 'sport_events_shape_check + sport_events_sport_shape_check still in place (215)', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname IN ('sport_events_shape_check', 'sport_events_sport_shape_check') AND conrelid = 'public.sport_events'::regclass AND contype = 'c'

UNION ALL

SELECT 'every existing event still passes the format CHECK (the four values it had)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_events WHERE format NOT IN ('stroke_gross', 'stroke_net', 'match_gross', 'match_net', 'stableford_gross', 'stableford_net')

ORDER BY 1;

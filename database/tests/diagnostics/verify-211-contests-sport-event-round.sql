-- ============================================================================
-- Verify migration 211 (contests.sport_event_round_id + its partial UNIQUE)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 211 the column / index rows read
-- CHECK FAILED (the data row reads through to_jsonb, never an error);
-- AFTER 211 every row reads OK. The migration ends in ONE result row
-- ("211 APPLIED | 1 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-211-contests-sport-event-round.sql' AS expected, 'verify-211-contests-sport-event-round.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'contests.sport_event_round_id column (uuid, nullable)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contests' AND column_name = 'sport_event_round_id' AND data_type = 'uuid' AND is_nullable = 'YES'

UNION ALL

SELECT 'the FK to sport_event_rounds (SET NULL)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.contests'::regclass AND contype = 'f' AND confrelid = 'public.sport_event_rounds'::regclass AND confdeltype = 'n'

UNION ALL

SELECT 'contests_sport_event_round_uniq (partial)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'contests_sport_event_round_uniq' AND indexdef LIKE '%WHERE%'

UNION ALL

SELECT 'no round linked twice', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM (SELECT to_jsonb(c) ->> 'sport_event_round_id' AS rid FROM contests c) x
 WHERE rid IS NOT NULL GROUP BY rid HAVING count(*) > 1

ORDER BY 1;

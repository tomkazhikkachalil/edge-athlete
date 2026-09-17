-- ============================================================================
-- Verify migration 220 (contests.sport_event_match_id, the match UNIQUE, the
-- one-source CHECK — Competition formats program, track 2)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 220 the column / index /
-- constraint rows read CHECK FAILED (the new column is read through
-- to_jsonb, never by name — never an error); AFTER 220 every row reads OK.
-- The migration ends in ONE result row ("220 APPLIED | 1 | 1 | 1"); the
-- first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-220-contests-sport-event-match.sql' AS expected, 'verify-220-contests-sport-event-match.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'contests.sport_event_match_id (uuid, nullable)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contests' AND column_name = 'sport_event_match_id' AND data_type = 'uuid' AND is_nullable = 'YES'

UNION ALL

SELECT 'FK contests.sport_event_match_id → sport_event_matches (ON DELETE SET NULL)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
 WHERE c.conrelid = 'public.contests'::regclass AND c.contype = 'f' AND c.confrelid = 'public.sport_event_matches'::regclass
   AND a.attname = 'sport_event_match_id' AND c.confdeltype = 'n'

UNION ALL

SELECT 'contests_sport_event_match_uniq (partial UNIQUE, one contest per match)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contests' AND indexname = 'contests_sport_event_match_uniq' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE%'

UNION ALL

SELECT 'contests_event_source_check (a round OR a match, never both)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'contests_event_source_check' AND conrelid = 'public.contests'::regclass AND contype = 'c'

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 220.
SELECT 'no contest carries a match link yet (existing rows: null)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM contests c WHERE (to_jsonb(c) ->> 'sport_event_match_id') IS NOT NULL

UNION ALL

SELECT 'contests_sport_event_round_uniq still in place (211 — one contest per event round)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contests' AND indexname = 'contests_sport_event_round_uniq'

ORDER BY 1;

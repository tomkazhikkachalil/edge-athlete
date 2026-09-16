-- ============================================================================
-- Verify migration 218 (contests.stage / slot, the slot UNIQUE, the seed
-- index — Competition formats program, track 2)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 218 the column / constraint /
-- index rows read CHECK FAILED (the new columns are read through to_jsonb,
-- never by name — never an error); AFTER 218 every row reads OK. The
-- migration ends in ONE result row ("218 APPLIED | 2 | 1 | 1"); the first
-- row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-218-competition-stages.sql' AS expected, 'verify-218-competition-stages.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'contests.stage + contests.slot (smallint, nullable)', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contests' AND column_name IN ('stage', 'slot') AND data_type = 'smallint' AND is_nullable = 'YES'

UNION ALL

SELECT 'contests_stage_slot_check (both null or both >= 1)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'contests_stage_slot_check' AND conrelid = 'public.contests'::regclass AND contype = 'c'

UNION ALL

SELECT 'contests_stage_slot_uniq (partial UNIQUE on competition × stage × slot)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contests' AND indexname = 'contests_stage_slot_uniq' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%(competition_id, stage, slot)%' AND indexdef LIKE '%WHERE%'

UNION ALL

SELECT 'idx_competition_entries_seed (partial, seeded entries)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'competition_entries' AND indexname = 'idx_competition_entries_seed' AND indexdef LIKE '%WHERE%'

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 218.
SELECT 'no contest carries a stage yet (existing rows: null / null)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM contests c WHERE (to_jsonb(c) ->> 'stage') IS NOT NULL OR (to_jsonb(c) ->> 'slot') IS NOT NULL

UNION ALL

SELECT 'contests: CHECK constraints (informational — the named check above is the assertion)', 'informational',
       (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.contests'::regclass AND contype = 'c')::text, 'OK'

ORDER BY 1;

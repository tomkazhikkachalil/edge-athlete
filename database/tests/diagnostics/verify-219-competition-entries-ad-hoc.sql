-- ============================================================================
-- Verify migration 219 (ad-hoc entries: name / source_ref /
-- affiliation_team_id, the widened entrant CHECK, the four partial UNIQUE
-- indexes, competition_entry_members — Competition formats, track 2)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 219 the new rows read CHECK
-- FAILED (columns through to_jsonb, the table through the catalogs — never
-- an error); AFTER 219 every row reads OK. The migration ends in ONE result
-- row ("219 APPLIED | 3 | 1 | 4 | 1"); the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-219-competition-entries-ad-hoc.sql' AS expected, 'verify-219-competition-entries-ad-hoc.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'competition_entries: the three new columns', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'competition_entries' AND column_name IN ('name', 'source_ref', 'affiliation_team_id')

UNION ALL

SELECT 'competition_entries_entrant_check admits an ad-hoc (both null + name)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'competition_entries_entrant_check' AND conrelid = 'public.competition_entries'::regclass AND pg_get_constraintdef(oid) LIKE '%name IS NOT NULL%'

UNION ALL

SELECT 'competition_entries_name_check (1..80)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'competition_entries_name_check' AND conrelid = 'public.competition_entries'::regclass

UNION ALL

SELECT 'competition_entries_uniq (NULLS NOT DISTINCT) is gone', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'competition_entries_uniq' AND conrelid = 'public.competition_entries'::regclass

UNION ALL

SELECT 'competition_entries: the four partial UNIQUE indexes', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'competition_entries' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE%'
   AND indexname IN ('competition_entries_team_uniq', 'competition_entries_profile_uniq', 'competition_entries_name_uniq', 'competition_entries_source_ref_uniq')

UNION ALL

SELECT 'competition_entries: constraints (pk + status, entrant, name CHECKs — the UNIQUE became indexes)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.competition_entries'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'competition_entries.affiliation_team_id → teams (SET NULL)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.competition_entries'::regclass AND contype = 'f' AND confrelid = 'public.teams'::regclass AND confdeltype = 'n'

UNION ALL

SELECT 'competition_entry_members: table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_tables WHERE schemaname = 'public' AND tablename = 'competition_entry_members'

UNION ALL

SELECT 'competition_entry_members: rls on', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'competition_entry_members' AND c.relrowsecurity

UNION ALL

SELECT 'competition_entry_members: zero policies', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'competition_entry_members'

UNION ALL

SELECT 'competition_entry_members: no grant to anon / authenticated', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'competition_entry_members' AND grantee IN ('anon', 'authenticated')

UNION ALL

SELECT 'competition_entry_members: constraints (pk, entry+profile UNIQUE, position CHECK)', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'competition_entry_members' AND c.contype IN ('c', 'u', 'p')

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 219.
SELECT 'every existing entry is a team or an athlete (none ad-hoc yet)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM competition_entries e WHERE (to_jsonb(e) ->> 'name') IS NOT NULL OR (to_jsonb(e) ->> 'source_ref') IS NOT NULL

UNION ALL

SELECT 'no entry collides on (competition, team) or (competition, profile) — the partial uniques hold', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM (
    SELECT competition_id, team_id FROM competition_entries WHERE team_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1
    UNION ALL
    SELECT competition_id, profile_id FROM competition_entries WHERE profile_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1
  ) d

ORDER BY 1;

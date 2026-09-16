-- ============================================================================
-- Verify migration 215 (sport_events.shape · the round's starts_at + the
-- game score + score_version · sport_event_stat_lines — Events program,
-- phase 4)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 215 the column / constraint /
-- table rows read CHECK FAILED (the new columns are read through to_jsonb,
-- never by name — never an error); AFTER 215 every row reads OK. The
-- migration ends in ONE result row ("215 APPLIED | 1 | 5 | 1"); the first
-- row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-215-sport-event-team-rounds.sql' AS expected, 'verify-215-sport-event-team-rounds.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'sport_events.shape column (text, not null, default round)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'shape' AND data_type = 'text' AND is_nullable = 'NO' AND column_default LIKE '%round%'

UNION ALL

SELECT 'sport_events_shape_check carries round | game | session', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_events_shape_check' AND conrelid = 'public.sport_events'::regclass
   AND pg_get_constraintdef(oid) LIKE '%''round''%' AND pg_get_constraintdef(oid) LIKE '%''game''%' AND pg_get_constraintdef(oid) LIKE '%''session''%'

UNION ALL

SELECT 'sport_events_sport_shape_check (golf ⇔ round)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'sport_events_sport_shape_check' AND conrelid = 'public.sport_events'::regclass

UNION ALL

SELECT 'sport_events: constraints (214 left 12; + shape + sport/shape)', '14', count(*)::text,
       CASE WHEN count(*) = 14 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_rounds: the five new columns', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_rounds' AND column_name IN ('starts_at', 'side1_score', 'side2_score', 'period', 'score_version')

UNION ALL

SELECT 'sport_event_rounds.score_version (integer, not null, default 0)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_rounds' AND column_name = 'score_version' AND data_type = 'integer' AND is_nullable = 'NO' AND column_default = '0'

UNION ALL

SELECT 'sport_event_rounds: constraints (207 left 9; + four score CHECKs)', '13', count(*)::text,
       CASE WHEN count(*) = 13 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_rounds'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_stat_lines: table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sport_event_stat_lines'

UNION ALL

SELECT 'sport_event_stat_lines: rls on', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'sport_event_stat_lines' AND c.relrowsecurity

UNION ALL

SELECT 'sport_event_stat_lines: zero policies', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_event_stat_lines'

UNION ALL

SELECT 'sport_event_stat_lines: no grant to anon / authenticated', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'sport_event_stat_lines' AND grantee IN ('anon', 'authenticated')

UNION ALL

SELECT 'sport_event_stat_lines: constraints (pk, round+participant UNIQUE, stats + version CHECKs)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_stat_lines' AND c.contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_stat_lines: the three FKs (round + participant + profile CASCADE, entered_by SET NULL)', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
 WHERE n.nspname = 'public' AND r.relname = 'sport_event_stat_lines' AND c.contype = 'f'

UNION ALL

SELECT 'sport_event_stat_lines: the two indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sport_event_stat_lines' AND indexname IN ('idx_sport_event_stat_lines_round', 'idx_sport_event_stat_lines_profile')

UNION ALL

SELECT 'sport_event_stat_lines: updated_at trigger', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'sport_event_stat_lines' AND t.tgname = 'sport_event_stat_lines_updated_at' AND NOT t.tgisinternal

UNION ALL

-- Read through to_jsonb(row) so this grid still RUNS before 215.
SELECT 'every existing event is golf + round (the CHECK holds both ways)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_events e WHERE (e.sport_key = 'golf') <> (coalesce(to_jsonb(e) ->> 'shape', 'round') = 'round')

UNION ALL

SELECT 'no round carries a score yet (existing rounds: null, score_version 0)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM sport_event_rounds r WHERE (to_jsonb(r) ->> 'side1_score') IS NOT NULL OR (to_jsonb(r) ->> 'side2_score') IS NOT NULL OR coalesce(to_jsonb(r) ->> 'score_version', '0') <> '0'

ORDER BY 1;

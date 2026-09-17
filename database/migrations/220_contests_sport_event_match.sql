-- ============================================================================
-- 220: contests.sport_event_match_id (Competition formats program, track 2 —
--      the last of the track's three schema migrations; 218 = stages,
--      219 = ad-hoc entries)
-- ============================================================================
-- A golf BRACKET contest runs as a MATCH-PLAY match inside an event (Events
-- phase 3, 212): stage n of the bracket ↔ round n of the event, slot k ↔
-- match k. 211's `contests.sport_event_round_id` is ONE contest per event
-- ROUND (its partial UNIQUE) — a bracket round holds k matches, so the
-- match link needs its own column, never a widening of 211's.
--
--   * contests.sport_event_match_id uuid → sport_event_matches(id) ON DELETE
--     SET NULL (the contest outlives the event's row; the results stay).
--   * contests_sport_event_match_uniq — a partial UNIQUE: one contest per
--     match.
--   * contests_event_source_check — num_nonnulls(sport_event_round_id,
--     sport_event_match_id) <= 1: a contest mirrors a ROUND (stroke play, a
--     game) or a MATCH, never both.
--
-- READERS: nothing selects `sport_event_match_id` until track 2 PR 11, gated
-- on `check:schema` OK after this ran (a select naming a missing column
-- 404s the whole read — the 207 lesson).
-- ============================================================================

ALTER TABLE contests
  ADD COLUMN IF NOT EXISTS sport_event_match_id uuid REFERENCES sport_event_matches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contests_sport_event_match_uniq
  ON contests (sport_event_match_id) WHERE sport_event_match_id IS NOT NULL;

ALTER TABLE contests DROP CONSTRAINT IF EXISTS contests_event_source_check;
ALTER TABLE contests ADD CONSTRAINT contests_event_source_check
  CHECK (num_nonnulls(sport_event_round_id, sport_event_match_id) <= 1);

COMMENT ON COLUMN contests.sport_event_match_id IS 'The event match this bracket contest is played as (220): stage n ↔ round n, slot k ↔ match k; one contest per match. The outcome is written by closeMatchesOnCompletion, never by hand while linked.';
COMMENT ON CONSTRAINT contests_event_source_check ON contests IS 'A contest mirrors an event ROUND (211) or an event MATCH (220), never both.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 220 APPLIED | 1 | 1 | 1
SELECT '220 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contests' AND column_name = 'sport_event_match_id' AND data_type = 'uuid') AS column_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'contests_sport_event_match_uniq' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE%') AS match_unique_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'contests_event_source_check' AND conrelid = 'public.contests'::regclass AND contype = 'c') AS source_check_expect_1;

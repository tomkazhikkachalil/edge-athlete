-- ============================================================================
-- 211: contests.sport_event_round_id — an org's contest can mirror an event
--      round (Events program, phase 2b, B1 — org contest stamping)
-- ============================================================================
-- An org-hosted event (sport_events.club_id | league_id) may COUNT TOWARD
-- one of the org's golf leaderboard competitions: one contest per round,
-- minted when the organizer picks the competition (`PUT /api/sport-events/
-- [id]/contest`, ONE writer: src/lib/sport-events/contest-link-server.ts),
-- its results written from the event's own leaderboard when the round
-- completes (PR 9 — never by the golf-sync engine, which is GUARDED on
-- this column). The house shape: the contests row points at what it
-- mirrors (`contests.event_id` is the calendar precedent); the org OWNS the
-- contest and its results, the host owns the event — deleting the round
-- leaves the org's results (SET NULL, the 181 direction). One contest per
-- round: a partial UNIQUE.
--
-- READERS: nothing selects the column until PR 9; every read is
-- 42703-tolerant (`readCountsToward`), and `npm run check:schema` reads
-- `CHAIN-ONLY contests.sport_event_round_id` until this file has run.
-- ============================================================================

ALTER TABLE contests
  ADD COLUMN IF NOT EXISTS sport_event_round_id uuid REFERENCES sport_event_rounds(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contests_sport_event_round_uniq
  ON contests (sport_event_round_id) WHERE sport_event_round_id IS NOT NULL;

COMMENT ON COLUMN contests.sport_event_round_id IS 'The event round this contest mirrors (211): one contest per round, minted when the organizer picks the competition; results come from the event''s leaderboard on completion, never from the golf-sync engine.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 211 APPLIED | 1 | 1
SELECT '211 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contests' AND column_name = 'sport_event_round_id' AND data_type = 'uuid') AS column_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'contests_sport_event_round_uniq') AS index_expect_1;

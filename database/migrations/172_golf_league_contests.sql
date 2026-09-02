-- ============================================================================
-- 172: golf league contests — play windows, hole counts, competition config
-- ============================================================================
-- Phase 6c G1. A golf league "round" is a contest with a PLAY WINDOW (members
-- play any day that week), a declared HOLE COUNT (nine is normal — Tom's
-- principle 3; the count is later matched against the CARD ROWS of a posted
-- round, never the course's holes_count), and a course reached through the
-- existing contests.venue_id → venues.golf_course_id | golf_club_id (169).
-- Dates, not timestamps: golf_rounds.date is a DATE, so the window match is
-- a plain date comparison with no timezone arithmetic.
--
-- competitions.config is shape-blind jsonb (the 113 convention); the first
-- key is { "golf": { "pick": "first" | "best" } } — which of a member's
-- qualifying rounds counts for a week. Unknown keys never break a recompute.
--
-- ORDER-STRICT: run AFTER 171, BEFORE merging the G1 PR. App code merged
-- ahead DEGRADES: contest writes that carry the new fields answer a
-- friendly 409; reads never select the new columns by name (42703-safe).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP the three contest
-- columns and their CHECKs; DROP competitions.config.

ALTER TABLE contests
  ADD COLUMN IF NOT EXISTS holes     smallint,
  ADD COLUMN IF NOT EXISTS play_from date,
  ADD COLUMN IF NOT EXISTS play_to   date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_holes_check') THEN
    ALTER TABLE contests ADD CONSTRAINT contests_holes_check
      CHECK (holes IS NULL OR holes IN (9, 18));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_play_window_check') THEN
    ALTER TABLE contests ADD CONSTRAINT contests_play_window_check
      CHECK (play_from IS NULL OR play_to IS NULL OR play_to >= play_from);
  END IF;
END $$;

-- The sync engine (G2) reads open windows per day.
CREATE INDEX IF NOT EXISTS idx_contests_play_window
  ON contests (play_from, play_to) WHERE play_from IS NOT NULL;

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) = 3 FROM information_schema.columns
     WHERE table_name = 'contests' AND column_name IN ('holes','play_from','play_to')) AS three_contest_columns,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_holes_check')          AS holes_check,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contests_play_window_check')    AS window_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_contests_play_window')       AS window_index,
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_name = 'competitions' AND column_name = 'config')                     AS competitions_config,
  (SELECT count(*) FROM contests WHERE holes IS NOT NULL)                              AS golf_rounds_declared;

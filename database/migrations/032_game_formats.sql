-- ============================================================================
-- Migration 032 — Game formats for shared rounds (stroke / stableford / match)
-- ============================================================================
-- Adds golf_scorecard_data.game_format so a shared round can be played as:
--   • stroke      — classic stroke play (default; existing rounds backfill here)
--   • stableford  — points per hole (albatross 5, eagle 4, birdie 3, par 2,
--                   bogey 1, double+ 0), highest points wins
--   • match       — head-to-head holes won (2-player rounds)
-- Formats are DISPLAY/scoring strategies computed client-side from the same
-- hole scores (src/lib/golf/formats.ts) — no score storage changes.
--
-- ⚠️ RUN THIS BEFORE deploying the code that ships with it: the feed's
-- scorecard query (GROUP_SCORECARD_SELECT) now selects game_format and
-- PostgREST errors on unknown columns (42703), which would blank shared-round
-- scorecards until this runs.
--
-- Safe/idempotent: ADD COLUMN IF NOT EXISTS; default backfills existing rows.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

ALTER TABLE golf_scorecard_data
  ADD COLUMN IF NOT EXISTS game_format TEXT NOT NULL DEFAULT 'stroke';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'golf_scorecard_data_game_format_check'
  ) THEN
    ALTER TABLE golf_scorecard_data
      ADD CONSTRAINT golf_scorecard_data_game_format_check
      CHECK (game_format IN ('stroke', 'stableford', 'match'));
  END IF;
END $$;

COMMENT ON COLUMN golf_scorecard_data.game_format IS
  'Scoring format: stroke (default), stableford (points), match (head-to-head)';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'golf_scorecard_data' AND column_name = 'game_format';
--   → one row, default 'stroke'

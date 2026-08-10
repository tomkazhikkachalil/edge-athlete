-- ============================================================================
-- Migration 078 — per-hole penalties on golf_holes + golf_hole_scores
-- ============================================================================
-- ⚠️ ORDER OF OPERATIONS: RUN THIS FIRST, THEN DEPLOY THE APP (the
-- 074/075/077 direction). The old app neither writes nor selects the new
-- columns; the new app does BOTH — the live scorer upserts `penalties` and
-- GROUP_SCORECARD_SELECT reads it, so deploying the app first would 42703
-- every live hole save and every shared-round scorecard read.
--
-- WHAT: one nullable TEXT[] on each per-hole table. Each array element is
-- ONE penalty occurrence, so ['out_of_bounds','drop','drop'] means
-- OB ×1 + Drop ×2; total penalties = array length; per-type breakdown is
-- aggregation in app code (src/lib/golf/penalties.ts — the single
-- vocabulary: out_of_bounds, water, drop, lost_ball, unplayable, re_tee).
--
-- NO CHECK constraint — the 020 (activity_mode) / 061 (segment_number) /
-- 077 (post_category) house reasoning: a DB enum needs a migration per new
-- penalty type and rejects nothing the service-role path couldn't already
-- write; the API validates against the app vocabulary.
--
-- NO index — penalties are only ever read as part of a hole row already
-- fetched by round/participant; nothing filters on them.
--
-- Stats note: calculate_round_stats and calculate_golf_participant_totals
-- are UNTOUCHED — strokes already include penalty strokes (the golfer
-- enters total strokes); penalties here are descriptive detail. The FEED's
-- golf rendering is also untouched by design (its selects are explicit and
-- do not gain this column).
--
-- PRE-FLIGHT (expect: 0 rows):
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE column_name = 'penalties'
--     AND table_name IN ('golf_holes', 'golf_hole_scores');
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

ALTER TABLE golf_holes ADD COLUMN IF NOT EXISTS penalties TEXT[];
ALTER TABLE golf_hole_scores ADD COLUMN IF NOT EXISTS penalties TEXT[];

COMMENT ON COLUMN golf_holes.penalties IS
  'Per-hole penalty occurrences, one array element each (e.g. {out_of_bounds,drop,drop} = OB x1 + Drop x2). Vocabulary app-validated in src/lib/golf/penalties.ts; no CHECK by design (078 header).';
COMMENT ON COLUMN golf_hole_scores.penalties IS
  'Per-hole penalty occurrences for live shared scoring — same model and vocabulary as golf_holes.penalties (078).';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Columns present (expect 2 rows):
--      SELECT table_name, column_name, data_type FROM information_schema.columns
--      WHERE column_name = 'penalties'
--        AND table_name IN ('golf_holes', 'golf_hole_scores');
--
-- 2. Behavioral (after the app deploy): enter a hole in the live scorer with
--    OB ×1 + Drop ×2 → the golf_hole_scores row carries
--    {out_of_bounds,drop,drop}; the watch view shows the penalty badge after
--    the realtime refetch; posting a solo round with penalties writes the
--    same shape to golf_holes. Feed post rendering unchanged.
-- ============================================================================

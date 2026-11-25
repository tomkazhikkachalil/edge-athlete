-- ============================================================================
-- 320: golf — each penalty on a hole keeps its own stroke value (Nov 25 2026).
--      Runs on BOTH staging and prod BEFORE the code deploys: the new app
--      writes and selects the column (the 078 direction).
-- ============================================================================
-- Tom's live-round spec draws every penalty as its own row with its strokes
-- ("Out of bounds +1", "Lost ball +2") and a badge of the hole's total penalty
-- strokes. Until now a hole's penalties were only a TEXT[] of types, one
-- element per occurrence (078) — there was nowhere to keep a stroke value.
--
-- WHAT: one nullable smallint[] on golf_hole_scores, ALIGNED BY INDEX with
-- `penalties`: penalty_strokes[i] is the stroke value of penalties[i].
--   NULL (every row written before today, and every writer that names only
--   the types) = one stroke each.
-- The app writes the two together through ONE writer (hole-writes.ts
-- holeRow): a write that names `penalties` always sets `penalty_strokes` too
-- (the given values, else NULL), so the pair cannot drift. A reader that
-- meets a length mismatch anyway reads one stroke each (penalties.ts
-- penaltyEntries).
--
-- UNCHANGED, on purpose: penalty strokes are NOT added to the score. The
-- golfer enters TOTAL strokes; penalties are descriptive detail (078's
-- note). calculate_golf_participant_totals and every total are untouched.
-- golf_holes (the finished solo round's mirror) keeps types only.
--
-- The CHECK: each value 1..9 (the range the entry field offers). No length
-- CHECK against `penalties`: a writer that replaces the types alone must
-- never be refused a save on the course over a pairing rule (results are
-- never lost); the one writer keeps them paired.
--
-- No index (read only as part of a hole row already fetched). No grant
-- change: a column on an existing table inherits the table's grants and RLS.
--
-- PRE-FLIGHT (expect: 0 rows):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'golf_hole_scores'
--     AND column_name = 'penalty_strokes';
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

ALTER TABLE public.golf_hole_scores
  ADD COLUMN IF NOT EXISTS penalty_strokes smallint[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'golf_hole_scores_penalty_strokes_check'
       AND conrelid = 'public.golf_hole_scores'::regclass
  ) THEN
    ALTER TABLE public.golf_hole_scores
      ADD CONSTRAINT golf_hole_scores_penalty_strokes_check
      CHECK (penalty_strokes IS NULL OR penalty_strokes <@ ARRAY[1,2,3,4,5,6,7,8,9]::smallint[]);
  END IF;
END $$;

COMMENT ON COLUMN public.golf_hole_scores.penalty_strokes IS
  'The stroke value of each penalty, aligned by index with penalties (320). NULL = one stroke each. Descriptive: never added to strokes.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (320, '320_hole_penalty_strokes.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 320 APPLIED | 1 | 1 | 320
SELECT '320 APPLIED' AS result,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'golf_hole_scores'
      AND column_name = 'penalty_strokes') AS column_expect_1,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'golf_hole_scores_penalty_strokes_check') AS check_expect_1,
  (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_320;

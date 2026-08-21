-- ============================================================================
-- 099: Fix the golf_rounds mirror — the partial unique index broke ON CONFLICT
-- ============================================================================
-- FOUND by the golf-unification prod probe (Aug 21): NO completed group round
-- has EVER mirrored into golf_rounds. Every completed round back to Aug 1 has
-- zero mirror rows, so shared/live rounds are invisible to stats, trends and
-- handicap — silently, because mirrorCompletedRound is best-effort by design.
--
-- ROOT CAUSE: 039 created a PARTIAL unique index
--   (group_post_id, profile_id) WHERE group_post_id IS NOT NULL
-- but PostgREST/supabase-js `onConflict: 'group_post_id,profile_id'` cannot
-- target a partial index (there is no way to express the predicate), so the
-- upsert fails 42P10 on every call and the error lands in a server-side
-- console.error nobody sees.
--
-- FIX: a FULL unique index on the pair. Safe for legacy solo rounds: Postgres
-- treats NULLs as distinct, so any number of (NULL, profile) rows coexist —
-- the full index enforces exactly what the partial one did, while being a
-- valid ON CONFLICT target. No code change needed; the existing upsert starts
-- working the moment this lands. (Backfill of the historically unmirrored
-- rounds runs as a service-role script after this migration — it replicates
-- mirrorCompletedRound row-for-row and is not SQL-reimplemented here.)
--
-- Deploy order: FREE. The code already sends this upsert; it simply starts
-- succeeding.
-- ============================================================================

DROP INDEX IF EXISTS idx_golf_rounds_group_mirror;

CREATE UNIQUE INDEX IF NOT EXISTS idx_golf_rounds_group_mirror
  ON golf_rounds(group_post_id, profile_id);

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect: full_index true, partial_predicate_gone true.
SELECT
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_golf_rounds_group_mirror'
      AND indexdef LIKE '%UNIQUE%'
  ) AS full_index,
  NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_golf_rounds_group_mirror'
      AND indexdef LIKE '%WHERE%'
  ) AS partial_predicate_gone;

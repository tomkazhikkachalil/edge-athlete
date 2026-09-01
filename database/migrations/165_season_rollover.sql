-- ============================================================================
-- 165: seasons.archived_at — the rollover close-out marker (phase 5.5)
-- ============================================================================
-- The masterplan §9 retention feature's one column: rolling a season
-- forward stamps the OLD season archived. Archived seasons take no new
-- registrations (offerings exclude them, window creation refuses them);
-- nothing existing is deleted or hidden — competitions, rosters and
-- registration history stay exactly as they were (§8 invariant 2;
-- playoffs may straddle a close-out).
--
-- NULL = live. The clone half of rollover works even before this
-- migration runs (the archive stamp skips on 42703, reported honestly
-- as archivedOld:false); every reader treats a missing column as
-- "nothing archived".
--
-- ORDER-STRICT: run AFTER 162 (any order relative to 163/164).
-- Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): ALTER TABLE seasons
-- DROP COLUMN archived_at.

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) = 1 FROM information_schema.columns
     WHERE table_name = 'seasons' AND column_name = 'archived_at')  AS column_present,
  (SELECT is_nullable = 'YES' FROM information_schema.columns
     WHERE table_name = 'seasons' AND column_name = 'archived_at')  AS nullable_live_default,
  (SELECT count(*) FROM seasons WHERE archived_at IS NOT NULL)      AS archived_so_far,
  (SELECT count(*) FROM seasons)                                    AS seasons_total;

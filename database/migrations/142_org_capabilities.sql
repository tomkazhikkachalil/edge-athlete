-- ============================================================================
-- 142: org capability flags — forerunners of org_capability (phase 0, 0.6a)
-- ============================================================================
-- The masterplan (§2, §3.1) replaces org "type" with a CAPABILITY SET: an
-- association operates teams AND competitions at once. With org-table
-- unification deferred past phase 0, the flags land as columns on BOTH
-- tables, backfilled from what each table has meant so far (Tom, Aug 30):
-- a league runs competitions; a club runs teams. NOT NULL DEFAULT gives the
-- backfill for free (PG11+ fast default) — existing and future rows both.
--
-- NOT user-editable v1: the Update zod schemas strip unknown keys, so a
-- client-sent flag is silently dropped by design; exposure is read-only
-- (org GET APIs + admin console chips). 0.6b (after 0.5) derives an org's
-- SPORTS from its operations; these flags gate which operations exist.
--
-- Order-free vs 141/143. Run BEFORE merging the capabilities PR (its GET
-- selects name the new columns and would 42703 pre-142).
-- Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS operates_competitions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS operates_teams boolean NOT NULL DEFAULT false;

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS operates_teams boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS operates_competitions boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'leagues' AND column_name = 'operates_competitions') AS leagues_competitions_col,
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'leagues' AND column_name = 'operates_teams') AS leagues_teams_col,
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'clubs' AND column_name = 'operates_teams') AS clubs_teams_col,
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'clubs' AND column_name = 'operates_competitions') AS clubs_competitions_col,
  (SELECT count(*) FROM leagues) = (SELECT count(*) FROM leagues WHERE operates_competitions) AS leagues_backfilled,
  (SELECT count(*) FROM clubs) = (SELECT count(*) FROM clubs WHERE operates_teams) AS clubs_backfilled,
  (SELECT count(*) FROM leagues) AS leagues_info,
  (SELECT count(*) FROM clubs) AS clubs_info;
-- Expect: true × 6, then two info counts.

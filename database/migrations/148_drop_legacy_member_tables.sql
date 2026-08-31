-- ============================================================================
-- 148: drop league_members / club_members — the 0.2 cleanup lands
-- ============================================================================
-- The mirrored member tables (113/117) froze at the 0.2 read-switch
-- (Aug 30): memberships has been the ONLY store — single-write since #389,
-- zero readers since #388, and the dual-write log tag no longer exists in
-- code. 140's header set the drop criteria: single-write soaked + a final
-- divergence pass at zero. The Aug 31 pass read zero on every column —
-- including ZERO ROWS in both legacy tables and in memberships' org rows
-- (prod org data is QA-windowed; the soak was waived on the same grounds
-- as 0.2's, Tom's call) — so the tables are dropped with nothing in them.
--
-- SAFETY: the pre-flight ABORTS (RAISE inside the SQL editor's single
-- transaction rolls everything back — the one time that trap works FOR us)
-- unless both tables still mirror memberships exactly. A re-run after the
-- drop is a clean no-op (guards + IF EXISTS).
--
-- NOT order-strict: no code references these tables (the last mention was
-- a comment, removed in the cleanup PR). Run AFTER 140. Re-runnable.
-- ============================================================================

-- ── Pre-flight: refuse to drop tables that still hold unmigrated truth ──────
-- Dynamic SQL throughout: on a re-run the tables are gone, and a plain
-- reference to a dropped relation fails at PARSE time regardless of guards.
DO $$
DECLARE
  league_missing int;
  club_missing int;
  league_final int;
  club_final int;
BEGIN
  IF to_regclass('public.league_members') IS NULL
     AND to_regclass('public.club_members') IS NULL THEN
    RAISE NOTICE '148: legacy tables already dropped — nothing to do';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM league_members lm WHERE NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.league_id = lm.league_id
      AND m.profile_id = lm.profile_id AND m.role = lm.role)' INTO league_missing;
  EXECUTE 'SELECT count(*) FROM club_members cm WHERE NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.club_id = cm.club_id
      AND m.profile_id = cm.profile_id AND m.role = cm.role)' INTO club_missing;
  IF league_missing > 0 OR club_missing > 0 THEN
    RAISE EXCEPTION '148 ABORTED: divergence found (league %, club %) — re-run 140''s backfill first',
      league_missing, club_missing;
  END IF;
  EXECUTE 'SELECT count(*) FROM league_members' INTO league_final;
  EXECUTE 'SELECT count(*) FROM club_members' INTO club_final;
  RAISE NOTICE '148: final snapshot — league_members %, club_members %', league_final, club_final;
END $$;

DROP TABLE IF EXISTS league_members;
DROP TABLE IF EXISTS club_members;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true) ───────────────────
SELECT
  to_regclass('public.league_members') IS NULL AS league_members_gone,
  to_regclass('public.club_members') IS NULL AS club_members_gone,
  to_regclass('public.memberships') IS NOT NULL AS memberships_stands,
  (SELECT count(*) FROM memberships) AS memberships_rows_info;
-- Expect: true × 3, then one info count.

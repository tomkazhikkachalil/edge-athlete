-- ============================================================================
-- 146: event scope polymorphism — events linkable to a division or team (0.9)
-- ============================================================================
-- Extends the 119 two-FK pattern instead of replacing it (generic
-- scope_type/scope_id would forfeit FK integrity for zero gain): events gain
-- division_id and team_id, and the one-org CHECK widens to one-SCOPE —
-- at most ONE of (league_id, club_id, division_id, team_id) is set.
--
-- RENAME, stated: events_one_org_check becomes events_one_scope_check (the
-- name now lies about what it checks). Nothing in app code references the
-- constraint name (23514 handling is generic); 119's check grid asserted the
-- old name but grids don't re-run.
--
-- Tom's decisions (Aug 31):
--   * STRICT audience — org-only members never merge child-scope events
--     onto their calendars; a team-scope membership row sees team + entered
--     divisions + owning-org events. Parent-implies-child applies to
--     GRANTS, not audience. (v1 ships dormant: nothing mints sub-org
--     membership rows yet — 0.10/phase 1 do.)
--   * The org PUBLIC PAGE schedule includes child-scope events (page
--     visibility ≠ calendar placement).
--   * Scheduling gate v1: owner/manager of the OWNING org (resolved
--     through the division/team row's org pair) may attach; the picker
--     surfaces naturally only for orgs with structure.
--
-- SET NULL on both FKs, the 119 posture: deleting a division or team must
-- not destroy events — they degrade to plain events. (Note the asymmetry
-- with 145's interior CASCADEs: structure tables cascade into each other,
-- but events outlive structure.)
--
-- ORDER-STRICT: run BEFORE merging the 0.9 PR (the event write paths carry
-- the new columns). Run AFTER 145. Re-runnable.
-- ============================================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS division_id uuid REFERENCES divisions(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

-- At most one SCOPE per event (re-add by name for re-runnability; drop the
-- 119 name it replaces).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_one_org_check;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_one_scope_check;
ALTER TABLE events ADD CONSTRAINT events_one_scope_check
  CHECK (num_nonnulls(league_id, club_id, division_id, team_id) <= 1);

-- The merge + org-page scoped reads (119 index shape).
CREATE INDEX IF NOT EXISTS idx_events_division_starts
  ON events (division_id, starts_at) WHERE division_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_team_starts
  ON events (team_id, starts_at) WHERE team_id IS NOT NULL;

-- No RLS changes: events RLS is on-with-zero-policies (057); every read of
-- the new columns goes through server routes on the admin client.

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'division_id') AS division_col,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'team_id') AS team_col,
  (SELECT confdeltype FROM pg_constraint
   WHERE conrelid = 'events'::regclass AND confrelid = 'divisions'::regclass
   LIMIT 1) = 'n' AS division_fk_set_null,
  (SELECT confdeltype FROM pg_constraint
   WHERE conrelid = 'events'::regclass AND confrelid = 'teams'::regclass
   LIMIT 1) = 'n' AS team_fk_set_null,
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_one_org_check') AS old_check_gone,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'events_one_scope_check') LIKE '%division_id, team_id%' AS one_scope_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'events'
          AND indexname = 'idx_events_division_starts') AS division_index,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'events'
          AND indexname = 'idx_events_team_starts') AS team_index,
  (SELECT count(*) FROM events WHERE division_id IS NOT NULL OR team_id IS NOT NULL) AS scoped_events_info;
-- Expect: true × 8, then one info count (0 on first run).

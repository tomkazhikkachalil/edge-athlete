-- ============================================================================
-- 119: org events — calendar events linkable to a league or club
-- ============================================================================
-- Connections PR C: an event's organizer (who is owner/manager of the org —
-- verified app-layer via getOrgRole) can attach it to their league or club,
-- and the org pages grow an "Upcoming events" schedule. A league with a
-- schedule is a real league.
--
-- SCOPE DECISION, stated: NO fan-out to member calendars in v1. The
-- calendar's guest-row-driven list query is untouched — org events surface
-- on the ORG PAGE (public read via the org routes) and on the organizer's
-- own calendar through their existing organizer guest row; members are
-- invited as guests normally. Auto-fan-out is a later round with its own
-- reminder/notification implications.
--
-- SET NULL on both FKs: deleting an org must not destroy events — they
-- degrade to plain events. The CHECK allows at most ONE org per event
-- (both-null is the normal case), the 057 num_nonnulls precedent.
--
-- ORDER-STRICT like 098/113/116/117: run BEFORE merging PR C (the event
-- create/update paths write these columns). Run AFTER 118. Re-runnable.
-- ============================================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS league_id uuid REFERENCES leagues(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES clubs(id) ON DELETE SET NULL;

-- At most one org per event (re-add by name for re-runnability).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_one_org_check;
ALTER TABLE events ADD CONSTRAINT events_one_org_check
  CHECK (num_nonnulls(league_id, club_id) <= 1);

-- The org-page schedule reads.
CREATE INDEX IF NOT EXISTS idx_events_league_starts
  ON events (league_id, starts_at) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_club_starts
  ON events (club_id, starts_at) WHERE club_id IS NOT NULL;

-- No RLS changes: events RLS is on-with-zero-policies (057) and the new
-- org-page reads go through server routes on the admin client, like every
-- org surface since 113.

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'league_id') AS league_col,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'club_id') AS club_col,
  (SELECT confdeltype FROM pg_constraint
   WHERE conrelid = 'events'::regclass AND confrelid = 'leagues'::regclass
   LIMIT 1) = 'n' AS league_fk_set_null,
  (SELECT confdeltype FROM pg_constraint
   WHERE conrelid = 'events'::regclass AND confrelid = 'clubs'::regclass
   LIMIT 1) = 'n' AS club_fk_set_null,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'events_one_org_check') LIKE '%num_nonnulls%' AS one_org_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'events'
          AND indexname = 'idx_events_league_starts') AS league_index,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'events'
          AND indexname = 'idx_events_club_starts') AS club_index,
  (SELECT count(*) FROM events WHERE league_id IS NOT NULL OR club_id IS NOT NULL) AS org_events_info;

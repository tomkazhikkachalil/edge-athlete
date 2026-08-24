-- ============================================================================
-- 118: league_clubs — club↔league affiliation, the symmetric handshake
-- ============================================================================
-- Tom's decisions (Aug 24): EITHER side initiates — a league owner/manager
-- invites a club, or a club owner/manager requests a league — and the
-- OPPOSITE side's owner/manager accepts. Accept-side authorization derives
-- from initiated_by ON THE ROW, never from which route was called: that is
-- the security model, and the matrix comment sits at the top of both route
-- files.
--
-- Decline, withdraw and dissolve all DELETE the row, on purpose: the PK
-- (league_id, club_id) would make a kept 'declined' row permanently block
-- re-inviting. The audit trail is the notifications; the 'affiliation' rate
-- bucket is the re-invite-spam backstop. The PK doubles as the duplicate
-- authority — a second invite/request in either direction is a 23505 the
-- routes map to a friendly 409.
--
-- Notification types (affiliation_invite, affiliation_update) were
-- front-loaded in 117 — this migration touches NO CHECK; its grid verifies
-- the front-load reached this database.
--
-- ORDER-STRICT: run BEFORE merging PR2 (the routes insert here).
-- Run AFTER 117. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_clubs (
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending'
    CONSTRAINT league_clubs_status_check CHECK (status IN ('pending', 'active')),
  initiated_by text NOT NULL
    CONSTRAINT league_clubs_initiated_by_check CHECK (initiated_by IN ('league', 'club')),
  -- SET NULL: the affiliation is an org-to-org fact that outlives the clicker.
  requested_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_by_profile_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (league_id, club_id)
);

DROP TRIGGER IF EXISTS league_clubs_updated_at ON league_clubs;
CREATE TRIGGER league_clubs_updated_at
  BEFORE UPDATE ON league_clubs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE league_clubs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON league_clubs FROM PUBLIC, anon, authenticated;

-- The PK covers league-side reads; this covers the club side.
CREATE INDEX IF NOT EXISTS idx_league_clubs_club ON league_clubs (club_id);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'league_clubs') AS table_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'league_clubs') AS rls_on,
  NOT has_table_privilege('anon', 'league_clubs', 'SELECT') AS anon_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'league_clubs_status_check') LIKE '%active%' AS status_check_ok,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'league_clubs_initiated_by_check') LIKE '%club%' AS initiator_check_ok,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'league_clubs_updated_at') AS updated_at_trigger,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'league_clubs'
          AND indexname = 'idx_league_clubs_club') AS club_index,
  -- 117's front-load reached this database:
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%affiliation_invite%' AS notif_has_invite,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%affiliation_update%' AS notif_has_update,
  (SELECT count(*) FROM league_clubs) AS affiliations_info;

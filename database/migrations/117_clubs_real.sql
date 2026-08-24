-- ============================================================================
-- 117: clubs become real entities — the league treatment
-- ============================================================================
-- Tom's decisions (Aug 24): clubs get everything leagues got in 113/116 —
-- an owner, open join/leave with owner/manager/member roles, a public page
-- (/club/[id], which finally un-inerts the ⌘K club rows), and self-service
-- creation through the same request+approve queue. Deliberate divergence
-- from leagues: **clubs have NO sport_key** — they are multi-sport
-- facilities ("Elite Athletics Club"), and forcing one sport would be a lie.
-- The 4 demo seed rows from 001 stay as OWNERLESS clubs, reassignable later
-- (the orphaned-league precedent behind owner_profile_id's SET NULL).
--
-- Also front-loads PR2's affiliation notification types so migration 118
-- never touches the notifications CHECK (the house rule: an
-- allowed-but-unsent type is harmless, the reverse is a 23514 in prod).
--
-- RISKIEST LINE HERE: the clubs privilege flip. 001 granted SELECT to
-- authenticated; verified Aug 24 that the ONLY readers of `clubs` are the
-- search route's admin-client selects, so the REVOKE breaks nothing — but
-- any future direct browser-client read of `clubs` will silently get zero
-- rows. Reads go through routes, like every org table since 113.
--
-- athlete_clubs is DROPPED: zero rows on prod, its sole app reference
-- (account-deletion's unchecked delete) is removed in this PR, and
-- club_members replaces it with the league_members shape. The ORDER-STRICT
-- window (117 run, PR1 not yet merged) leaves deployed code deleting from a
-- missing table — harmless because that result was never checked.
--
-- ORDER-STRICT like 098/113/116: run BEFORE merging PR1. Run AFTER 116.
-- Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

-- ── clubs: an owner, and the org-table privilege model ───────────────────────
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS owner_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clubs_owner ON clubs (owner_profile_id);

DROP POLICY IF EXISTS "Clubs are viewable by authenticated users" ON clubs;
REVOKE ALL ON clubs FROM PUBLIC, anon, authenticated;
-- RLS stays ON with zero policies (service-role only, app-layer authz).
-- clubs already carries: handle_updated_at trigger (001), the location
-- block + clubs_search_vector (108), and its search_documents sync pair +
-- backfill (112, owner_id NULL — always public). Nothing recreated here.

-- ── athlete_clubs: retired ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view their own club associations" ON athlete_clubs;
DROP POLICY IF EXISTS "Users can manage their own club associations" ON athlete_clubs;
DROP TABLE IF EXISTS athlete_clubs;

-- ── club_members (verbatim league_members mirror) ────────────────────────────
CREATE TABLE IF NOT EXISTS club_members (
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member'
    CONSTRAINT club_members_role_check CHECK (role IN ('owner', 'manager', 'member')),
  joined_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (club_id, profile_id)
);
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club_members FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_club_members_profile ON club_members (profile_id);

-- ── club_requests (league_requests mirror, minus sport_key) ──────────────────
CREATE TABLE IF NOT EXISTS club_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: a deleted requester's request is worthless.
  requester_profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  place_id              uuid REFERENCES places(id) ON DELETE SET NULL,
  city text, region text, region_code text, country text, country_code text,
  lat double precision, lng double precision,
  location_source       text,
  status                text NOT NULL DEFAULT 'pending'
    CONSTRAINT club_requests_status_check
    CHECK (status IN ('pending', 'approved', 'declined')),
  decline_reason        text,
  reviewed_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at            timestamptz,
  created_club_id       uuid REFERENCES clubs(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at            timestamptz NOT NULL DEFAULT timezone('utc', now())
);
DROP TRIGGER IF EXISTS club_requests_updated_at ON club_requests;
CREATE TRIGGER club_requests_updated_at
  BEFORE UPDATE ON club_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE club_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club_requests FROM PUBLIC, anon, authenticated;

-- ONE pending request per requester — the 23505→409 authority, race-proof.
CREATE UNIQUE INDEX IF NOT EXISTS club_requests_one_pending
  ON club_requests (requester_profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_club_requests_status
  ON club_requests (status, created_at DESC);

-- NO search wiring: requests are not searchable entities (116 precedent).

-- ── Notification types: full-list re-ADD (base = 116's exact list, which
-- already contains club_update — it finally gains a sender in this PR).
-- Four additions: club_join, club_request_result, and PR2's front-loaded
-- affiliation_invite + affiliation_update.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result',
    'follow_request_guardian','follow_update','tag_alert','profile_change',
    'calendar_alert','safety_alert',
    'league_join','league_update','league_request_result',
    'club_join','club_request_result','affiliation_invite','affiliation_update'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'clubs' AND column_name = 'owner_profile_id') AS clubs_owner_col,
  NOT EXISTS (SELECT 1 FROM pg_tables
              WHERE schemaname = 'public' AND tablename = 'athlete_clubs') AS athlete_clubs_gone,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'club_members') AS members_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'club_requests') AS requests_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'club_members') AS members_rls_on,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'club_requests') AS requests_rls_on,
  NOT has_table_privilege('anon', 'clubs', 'SELECT') AS clubs_anon_revoked,
  NOT has_table_privilege('anon', 'club_members', 'SELECT') AS members_anon_revoked,
  NOT has_table_privilege('anon', 'club_requests', 'SELECT') AS requests_anon_revoked,
  NOT has_table_privilege('authenticated', 'clubs', 'SELECT') AS clubs_authed_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'club_members_role_check') LIKE '%manager%' AS role_check_ok,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'club_requests'
          AND indexname = 'club_requests_one_pending') AS one_pending_index,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%club_join%' AS notif_has_club_join,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%club_request_result%' AS notif_has_club_result,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%affiliation_invite%' AS notif_has_aff_invite,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%affiliation_update%' AS notif_has_aff_update,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'club')
    = (SELECT count(*) FROM clubs) AS club_docs_match,
  (SELECT count(*) FROM clubs) AS clubs_info,
  (SELECT count(*) FROM club_members) AS members_info,
  (SELECT count(*) FROM club_requests) AS requests_info;

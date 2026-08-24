-- ============================================================================
-- 116: league_requests — self-service org signup, the request + approve flow
-- ============================================================================
-- Tom's decisions (Aug 24): the "separate flow" the profile route promised
-- for org provisioning is REQUEST + APPROVE — any signed-in user submits
-- "Start a league" (/league/start); it lands in the /dashboard/leagues
-- queue; approval creates the league with the requester as OWNER (via the
-- same createLeagueWithOwner path the admin console uses); decline carries
-- a required reason. Decisions notify in-app only. No new account type:
-- user_type stays untouched — a league is owned by a normal profile.
--
-- Real columns, not a payload jsonb: approval copies them VERBATIM onto
-- `leagues`, so the request mirrors 113's column block exactly.
--
-- The one-pending-per-user rule is enforced by a PARTIAL UNIQUE INDEX, not
-- an app-side pre-check — the route maps its 23505 to a friendly 409, and
-- a race between two submits cannot create two pending rows.
--
-- ORDER-STRICT like 098/113: run BEFORE merging the PR — the request POST
-- inserts into this table. (Reverse order still degrades: POST 503, GETs
-- empty lists.)
--
-- Run AFTER 113. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE, unlike leagues' SET NULL: a deleted requester's request is
  -- worthless, while a league is a community asset.
  requester_profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  sport_key             text NOT NULL,   -- app-validated (registry is app-side)
  -- The location model, verbatim from 113's leagues block.
  place_id              uuid REFERENCES places(id) ON DELETE SET NULL,
  city text, region text, region_code text, country text, country_code text,
  lat double precision, lng double precision,
  location_source       text,
  status                text NOT NULL DEFAULT 'pending'
    CONSTRAINT league_requests_status_check
    CHECK (status IN ('pending', 'approved', 'declined')),
  decline_reason        text,
  reviewed_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at            timestamptz,
  created_league_id     uuid REFERENCES leagues(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at            timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS league_requests_updated_at ON league_requests;
CREATE TRIGGER league_requests_updated_at
  BEFORE UPDATE ON league_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Service-role only (RLS on, zero policies): authorization is app-layer.
ALTER TABLE league_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON league_requests FROM PUBLIC, anon, authenticated;

-- ONE pending request per requester — the authority, race-proof.
CREATE UNIQUE INDEX IF NOT EXISTS league_requests_one_pending
  ON league_requests (requester_profile_id) WHERE status = 'pending';
-- The admin queue's read path.
CREATE INDEX IF NOT EXISTS idx_league_requests_status
  ON league_requests (status, created_at DESC);

-- NO search wiring on purpose: requests are not searchable entities.

-- ── Notification types: full-list re-ADD (house pattern; base = 113's list)
-- + league_request_result. Front-loaded AND sent in this same PR — legal
-- because this migration is ORDER-STRICT before the merge.
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
    'league_join','league_update','league_request_result'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'league_requests') AS table_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'league_requests') AS rls_on,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'league_requests'
          AND indexname = 'league_requests_one_pending') AS one_pending_index,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'league_requests_updated_at') AS updated_at_trigger,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'league_requests_status_check') LIKE '%declined%' AS status_check_ok,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%league_request_result%' AS notif_check_has_result,
  NOT has_table_privilege('anon', 'league_requests', 'SELECT') AS anon_revoked,
  (SELECT count(*) FROM league_requests) AS requests_info,
  (SELECT count(*) FROM league_requests WHERE status = 'pending') AS pending_info;

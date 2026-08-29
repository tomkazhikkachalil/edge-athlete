-- ============================================================================
-- 139 — event carpool (Family Console follow-on, Wave 9)
-- ============================================================================
-- Carpool coordination on calendar events: a guest offers seats, other
-- guests claim them. A SEPARATE table pair BY DESIGN — events.description
-- and events.location are emitted VERBATIM into ICS feeds and invite emails
-- (feed-server.ts / events route), so ride details must be structurally
-- unable to leak there. The `note` column is safe because those emitters
-- never read these tables.
--
-- Capacity is enforced in the API route (v1): all writes are service-role
-- single-path, so a trigger adds nothing yet.
--
-- RLS: SELECT for the event's guests — referencing event_guests, NEVER the
-- carpool tables themselves (the 035/42P17 recursion lesson). Writes are
-- service-role only (app-layer auth, the events doctrine per 057).
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_carpool_offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  driver_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seats_total       SMALLINT NOT NULL CHECK (seats_total BETWEEN 1 AND 8),
  note              TEXT CHECK (char_length(note) <= 200),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_profile_id)
);

CREATE TABLE IF NOT EXISTS event_carpool_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id          UUID NOT NULL REFERENCES event_carpool_offers(id) ON DELETE CASCADE,
  rider_profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seats             SMALLINT NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 4),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, rider_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_carpool_offers_event ON event_carpool_offers (event_id);
CREATE INDEX IF NOT EXISTS idx_carpool_claims_offer ON event_carpool_claims (offer_id);

DROP TRIGGER IF EXISTS handle_updated_at_carpool_offers ON event_carpool_offers;
CREATE TRIGGER handle_updated_at_carpool_offers
  BEFORE UPDATE ON event_carpool_offers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE event_carpool_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_carpool_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carpool_offers_select ON event_carpool_offers;
CREATE POLICY carpool_offers_select ON event_carpool_offers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM event_guests g
      WHERE g.event_id = event_carpool_offers.event_id
        AND g.profile_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS carpool_claims_select ON event_carpool_claims;
CREATE POLICY carpool_claims_select ON event_carpool_claims
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM event_carpool_offers o
      JOIN event_guests g ON g.event_id = o.event_id
      WHERE o.id = event_carpool_claims.offer_id
        AND g.profile_id = (SELECT auth.uid())
    )
  );

-- ── Notification types: full-list re-ADD (base = 117's exact live list —
-- 118 only asserts it). Two additions: carpool_offer, carpool_update. ─────
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
    'club_join','club_request_result','affiliation_invite','affiliation_update',
    'carpool_offer','carpool_update'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  (SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'event_carpool_offers')) AS offers_table,
  (SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'event_carpool_claims')) AS claims_table,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'event_carpool_offers') AS offers_rls,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'event_carpool_claims') AS claims_rls,
  (SELECT COUNT(*) = 2 FROM pg_policies
    WHERE tablename IN ('event_carpool_offers','event_carpool_claims')) AS select_policies_only,
  (SELECT pg_get_constraintdef(oid) LIKE '%carpool_offer%'
     AND pg_get_constraintdef(oid) LIKE '%affiliation_update%'
   FROM pg_constraint WHERE conname = 'notifications_type_check') AS type_check_carries_both;
-- Expect: true / true / true / true / true / true.

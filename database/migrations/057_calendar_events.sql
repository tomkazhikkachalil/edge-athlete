-- ============================================================================
-- 057 — calendar: events + event_guests + notification types (Calendar v1)
-- ============================================================================
-- ⚠️ Run AFTER 056. Safe anytime: nothing reads these tables until the
-- calendar code deploys AND NEXT_PUBLIC_FEATURE_CALENDAR=1 is set.
--
-- Personal calendar with the full invite loop. One event row per event
-- (the organizer's copy is the single source of truth); one event_guests
-- row per participant INCLUDING the organizer (role='organizer',
-- status='accepted') so one query path — guests-for-me joined to events —
-- serves the whole calendar (created + invited). Email invitees (not app
-- users) get a row with invited_email instead of profile_id
-- (guardian_invites exactly-one-of precedent); they stay 'invited' in v1.
-- Cancel is a status flip, never a delete: the guest list must survive
-- for the cancellation fan-out and deep links must not 404.
-- Times are TIMESTAMPTZ; `timezone` snapshots the creation IANA zone
-- (display is viewer-local; all-day events store local-midnight bounds
-- in that zone, end exclusive). Recurrence is deliberately absent —
-- a later series table/column addition is non-breaking.
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description   TEXT CHECK (char_length(description) <= 2000),
  location      TEXT CHECK (char_length(location) <= 200),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  all_day       BOOLEAN NOT NULL DEFAULT false,
  timezone      TEXT NOT NULL CHECK (char_length(timezone) <= 64),
  category      TEXT NOT NULL DEFAULT 'general' CHECK (category IN
                  ('general','practice','game','tournament','training','social','other')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS event_guests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  profile_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  invited_email TEXT CHECK (invited_email = lower(invited_email)),
  role          TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('organizer','guest')),
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN
                  ('invited','accepted','declined','maybe')),
  responded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one identity per row: an app user OR an email invitee.
  CHECK (num_nonnulls(profile_id, invited_email) = 1)
);

-- One row per registered guest per event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_guests_profile_unique
  ON event_guests (event_id, profile_id) WHERE profile_id IS NOT NULL;
-- One row per email invitee per event (emails stored pre-lowercased).
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_guests_email_unique
  ON event_guests (event_id, invited_email) WHERE invited_email IS NOT NULL;
-- "My calendar" entry point: my guest rows (any status) → join events.
CREATE INDEX IF NOT EXISTS idx_event_guests_profile
  ON event_guests (profile_id, status) WHERE profile_id IS NOT NULL;
-- Range scans over the visible grid only ever want active events.
CREATE INDEX IF NOT EXISTS idx_events_time
  ON events (starts_at) WHERE status = 'active';
-- Organizer lookups (edit/cancel authorization, "my events").
CREATE INDEX IF NOT EXISTS idx_events_organizer
  ON events (organizer_id, starts_at);

-- Shared canonical trigger fn (see 036_restore_updated_at_trigger.sql).
DROP TRIGGER IF EXISTS handle_updated_at_events ON events;
CREATE TRIGGER handle_updated_at_events
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Service-role only: RLS on, zero policies (calendar access is authorized
-- app-layer per guest row; RLS is defense-in-depth, 027_waitlist precedent).
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_guests ENABLE ROW LEVEL SECURITY;

-- ── Notification types ──────────────────────────────────────────────────────
-- Full-list DROP + re-ADD (028 pattern). New: event_invite, event_update,
-- event_cancelled, event_response. These are DIRECT-inserted by the app
-- (create_notification's preference gate would silently drop them —
-- new_message/group_invite precedent).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response'
  ));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification (run after; expected results in comments)
-- ============================================================================
-- 1. Both tables exist and are RLS-on with zero policies — must return 0:
--    SELECT count(*) FROM pg_policies WHERE tablename IN ('events','event_guests');
-- 2. Constraint round-trip — must ERROR (ends before starts):
--    INSERT INTO events (organizer_id, title, starts_at, ends_at, timezone)
--    VALUES ((SELECT id FROM profiles LIMIT 1), 'x', now(), now() - interval '1h', 'UTC');
-- 3. Guest identity XOR — must ERROR (both identities):
--    INSERT INTO event_guests (event_id, profile_id, invited_email)
--    VALUES (gen_random_uuid(), (SELECT id FROM profiles LIMIT 1), 'a@b.co');
-- 4. New notification types accepted — must succeed then be cleaned up:
--    (exercised end-to-end by the calendar E2E suite)
-- ============================================================================

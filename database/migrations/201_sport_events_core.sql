-- ============================================================================
-- 201: sport_events + sport_event_rounds — an Event is organizer intent
--      layered over a live round (Events program, phase 1 — Sep 16 2026)
-- ============================================================================
-- Tom's design doc makes Events a first-class object: an organizer creates
-- an event, invites or approves players, runs it live with groups and
-- scorecards; everyone follows the leaderboard; a tournament is an event
-- with more than one round. The audit found that a shared golf round
-- (group_posts) already IS a single-day event — participants, live per-hole
-- scoring, realtime, a score-derived status machine, the completion mirror
-- into golf_rounds and athlete_performances — but it is ONE round with a
-- bare date and a status that means "how far the scoring got", not "what
-- the organizer decided". So the Event is a NEW thin header table plus a
-- rounds table, and each round will BE one group_posts row, minted when the
-- round goes live and linked by group_posts.sport_event_round_id (203, the
-- 181 contest_id shape: one writer, SET NULL). The round's own machine stays
-- untouched; the event's draft → open → live → completed is the organizer's
-- intent above it. Nothing golf is rebuilt.
--
-- Naming (Tom, Sep 16): the descriptive family `sport_events` in the
-- database, API and code — the calendar already owns the word `events`
-- (057) and the `event_*` notification types — "Events" on every screen,
-- the page /events/[id].
--
-- sport_events — the header:
--   * host_profile_id: the organizer (a supervised profile MAY host — Tom's
--     call; its posts publish immediately, the shared-round carve-out);
--     created_by_user_id: the human author when a guardian acts as the
--     child (the 090 shape).
--   * club_id | league_id: an OPTIONAL org link, never both, never required.
--   * join_mode: invite is ALWAYS available to organizers; 'request'
--     additionally opens the request door (so "both may combine" needs no
--     third value).
--   * visibility: public (everyone, anon included) | link (anyone holding
--     link_token, or a participant) | private (participants of any role,
--     followers included — Tom's call — and organizers).
--   * format: stroke_gross | stroke_net (match play and brackets are
--     phase 3 — they need a different results model).
--   * status: draft | open | live | completed | cancelled — EXPLICIT
--     organizer transitions with validation (src/lib/sport-events/
--     lifecycle.ts), never a free-text field; cancelled only from draft or
--     open (nothing minted yet); live is completed, never cancelled.
--   * capacity: optional; when full, accepts land on the waitlist (202).
--   * starts_on: denormalised = the earliest round date, ONE writer
--     (rounds-server.ts), so the upcoming / live / past lists index it.
--   * opened_at / went_live_at / completed_at / cancelled_at: the audit trail
--     of the transitions.
--
-- sport_event_rounds — phase 1 shows exactly ONE round; the table allows N
-- (a tournament, phase 2) without a rebuild:
--   * sequence: 1..n, UNIQUE per event; scheduled_on: the date.
--   * course_id → golf_courses (SET NULL) + course_name text: off-catalog
--     courses stay legal as free text, the shared-round rule.
--   * tee, holes (9 | 18), starting_hole (1 | 10 — a back nine is encoded by
--     hole numbering at mint, src/lib/golf/holes.ts).
--   * course_rating / slope_rating: the catalog tee's pair snapshotted at
--     save; hole_data: the catalog's [{hole, par, yardage, handicap}] WITH
--     the stroke index (net scoring allocates strokes per hole — the
--     shared-round writer used to strip it; 203's PR stops that).
--   * status: scheduled | live | completed | cancelled — the round's own
--     mirror of the event's lifecycle.
--
-- Posture A (the 187 shape): RLS on, zero policies, REVOKE from anon and
-- authenticated — every read and write goes through the service client
-- behind resolveSportEventAccess, the ONE gate (refusal = 404, the contest
-- rule). Both tables are created EMPTY, so indexes are inline (the
-- .indexes.sql rule is for large tables). updated_at by handle_updated_at
-- (001). Provenance: every object here is a chain CREATE — check:schema
-- stays OK with the allowlist empty.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sport_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  club_id            uuid REFERENCES clubs(id) ON DELETE SET NULL,
  league_id          uuid REFERENCES leagues(id) ON DELETE SET NULL,
  sport_key          text NOT NULL DEFAULT 'golf',
  name               text NOT NULL CONSTRAINT sport_events_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description        text CONSTRAINT sport_events_description_check CHECK (description IS NULL OR length(description) <= 2000),
  cover_path         text,
  join_mode          text NOT NULL DEFAULT 'invite' CONSTRAINT sport_events_join_mode_check CHECK (join_mode IN ('invite', 'request')),
  visibility         text NOT NULL DEFAULT 'private' CONSTRAINT sport_events_visibility_check CHECK (visibility IN ('public', 'link', 'private')),
  link_token         text CONSTRAINT sport_events_link_token_uniq UNIQUE,
  format             text NOT NULL DEFAULT 'stroke_gross' CONSTRAINT sport_events_format_check CHECK (format IN ('stroke_gross', 'stroke_net')),
  status             text NOT NULL DEFAULT 'draft' CONSTRAINT sport_events_status_check CHECK (status IN ('draft', 'open', 'live', 'completed', 'cancelled')),
  capacity           integer CONSTRAINT sport_events_capacity_check CHECK (capacity IS NULL OR capacity >= 1),
  starts_on          date,
  opened_at          timestamptz,
  went_live_at       timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_events_one_org_check    CHECK (club_id IS NULL OR league_id IS NULL),
  CONSTRAINT sport_events_link_token_check CHECK (visibility <> 'link' OR link_token IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sport_event_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_event_id uuid NOT NULL REFERENCES sport_events(id) ON DELETE CASCADE,
  sequence       smallint NOT NULL CONSTRAINT sport_event_rounds_sequence_check CHECK (sequence >= 1),
  scheduled_on   date NOT NULL,
  course_id      uuid REFERENCES golf_courses(id) ON DELETE SET NULL,
  course_name    text NOT NULL CONSTRAINT sport_event_rounds_course_name_check CHECK (length(btrim(course_name)) BETWEEN 1 AND 200),
  tee            text,
  holes          smallint NOT NULL DEFAULT 18 CONSTRAINT sport_event_rounds_holes_check CHECK (holes IN (9, 18)),
  starting_hole  smallint NOT NULL DEFAULT 1 CONSTRAINT sport_event_rounds_starting_hole_check CHECK (starting_hole IN (1, 10)),
  course_rating  numeric(4,1),
  slope_rating   integer CONSTRAINT sport_event_rounds_slope_check CHECK (slope_rating IS NULL OR slope_rating BETWEEN 55 AND 155),
  hole_data      jsonb,
  status         text NOT NULL DEFAULT 'scheduled' CONSTRAINT sport_event_rounds_status_check CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_rounds_sequence_uniq UNIQUE (sport_event_id, sequence)
);

-- Posture A.
ALTER TABLE sport_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_event_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_event_rounds FROM PUBLIC, anon, authenticated;

-- updated_at, the 001 function.
DROP TRIGGER IF EXISTS sport_events_updated_at ON sport_events;
CREATE TRIGGER sport_events_updated_at
  BEFORE UPDATE ON sport_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS sport_event_rounds_updated_at ON sport_event_rounds;
CREATE TRIGGER sport_event_rounds_updated_at
  BEFORE UPDATE ON sport_event_rounds
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- The lists: hosting (mine), upcoming / live / past (public by status and date), an org's events.
CREATE INDEX IF NOT EXISTS idx_sport_events_host_created
  ON sport_events (host_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sport_events_status_starts
  ON sport_events (status, starts_on);
CREATE INDEX IF NOT EXISTS idx_sport_events_club
  ON sport_events (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sport_events_league
  ON sport_events (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sport_event_rounds_event_sequence
  ON sport_event_rounds (sport_event_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sport_event_rounds_course
  ON sport_event_rounds (course_id) WHERE course_id IS NOT NULL;

COMMENT ON TABLE sport_events IS 'An organizer-run event (phase 1: one golf round). Organizer intent — draft/open/live/completed — layered over the live round the round mints at go-live (group_posts, via 203). Posture A: service client behind resolveSportEventAccess only.';
COMMENT ON TABLE sport_event_rounds IS 'The rounds of a sport event (phase 1 shows one). course_id nullable — off-catalog courses are free text. hole_data keeps the stroke index (handicap) so net scoring can allocate per hole.';
COMMENT ON COLUMN sport_events.starts_on IS 'Denormalised min(sport_event_rounds.scheduled_on). ONE writer: src/lib/sport-events/rounds-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'sport_events: table' AS check_name, '1' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sport_events'

UNION ALL

SELECT 'sport_event_rounds: table', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sport_event_rounds'

UNION ALL

SELECT 'sport_events: rls on, zero policies', 'true', (relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_events'))::text,
       CASE WHEN relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_events') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.sport_events'::regclass

UNION ALL

SELECT 'sport_event_rounds: rls on, zero policies', 'true', (relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_event_rounds'))::text,
       CASE WHEN relrowsecurity AND (SELECT count(*) = 0 FROM pg_policies WHERE tablename = 'sport_event_rounds') THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.sport_event_rounds'::regclass

UNION ALL

SELECT 'anon cannot read either', 'false',
       (has_table_privilege('anon', 'public.sport_events', 'SELECT') OR has_table_privilege('anon', 'public.sport_event_rounds', 'SELECT'))::text,
       CASE WHEN has_table_privilege('anon', 'public.sport_events', 'SELECT') OR has_table_privilege('anon', 'public.sport_event_rounds', 'SELECT') THEN 'CHECK FAILED' ELSE 'OK' END

UNION ALL

SELECT 'sport_events: constraints', '11', count(*)::text,
       CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'sport_event_rounds: constraints', '8', count(*)::text,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.sport_event_rounds'::regclass AND contype IN ('c', 'u', 'p')

UNION ALL

SELECT 'indexes', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_sport_event%'

UNION ALL

SELECT 'updated_at triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname IN ('sport_events_updated_at', 'sport_event_rounds_updated_at') AND NOT tgisinternal

ORDER BY 1;

-- ============================================================================
-- 152: contests + participants + results — games get scheduled and scored
-- (phase 2, round 2)
-- ============================================================================
-- The middle of §3.3: a CONTEST inside a competition (venue/facility,
-- time, round label, status), its PARTICIPANTS (referencing
-- competition_entries — the polymorphism stays in 151's one table), and
-- per-participant RESULTS (adapter-typed payload + a numeric sort key +
-- the FULL provenance ladder stored from day one).
--
-- Tom's phase-2 decisions applied here (Aug 31):
--   * Contests LINK calendar events: event_id SET NULL — a
--     publish-to-calendar action mints a division-scoped 'game' event
--     and one-way-syncs (best-effort, the round-mirror precedent).
--     ZERO events columns are added; the seven-field-list silent-drop
--     class is never touched.
--   * No outcome column — W/L/T is DERIVED by the adapter at standings
--     recompute from the sides' scores + payload (forfeit lives in
--     payload). "Team scores are derived, never authored separately."
--   * Provenance: all five masterplan rungs in the CHECK now
--     (sanctioned | league_verified | club_recorded | self_reported |
--     imported); v1 server stamps 'league_verified' (the entering
--     manager IS the competition owner in a house league); display
--     ladder is phase 4. dispute_status is column-room (workflow phase
--     4); entered_by/confirmed_by are the audit columns.
--
-- THE 141 PROMISE LANDS HERE: events_facility_requires_venue never
-- guaranteed the facility belongs to that venue; 141's header deferred
-- the airtight composite FK "to the migration that ships the writer" —
-- contests are that writer, and events gets the same FK in the same
-- breath. Pre-flight ABORTS (rolls back everything — the sanctioned
-- pre-flight use of RAISE EXCEPTION) if any existing events row pairs a
-- facility with the wrong venue; repair those rows first, then re-run.
--
-- App-layer consistency (competition-server.ts, ONCE):
--   * participant.entry.competition == contest.competition.
--   * fixture ⇒ exactly two participants, one home one away — enforced
--     at result entry / in_progress transitions, not insert order.
--   * side is NULL for leaderboard contests (the partial unique index
--     only bites when side is set).
--
-- ORDER-STRICT: run AFTER 151, BEFORE merging the R2 PRs (their GETs
-- degrade to empty pre-152; writes would 42P01).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP contest_results,
-- contest_participants, contests (child-first); DROP CONSTRAINT
-- events_facility_venue_fk ON events; DROP CONSTRAINT
-- facilities_id_venue_uniq ON facilities.
-- ============================================================================

-- ── Pre-flight: no events row may pair a facility with a foreign venue ──────
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad
  FROM events e
  JOIN facilities f ON f.id = e.facility_id
  WHERE e.facility_id IS NOT NULL AND f.venue_id IS DISTINCT FROM e.venue_id;
  IF bad > 0 THEN
    RAISE EXCEPTION '152 pre-flight: % events row(s) pair a facility with the wrong venue — repair before running', bad;
  END IF;
END $$;

-- ── The airtight facility↔venue pairing (141's deferred promise) ────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_id_venue_uniq') THEN
    ALTER TABLE facilities ADD CONSTRAINT facilities_id_venue_uniq UNIQUE (id, venue_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_facility_venue_fk') THEN
    ALTER TABLE events ADD CONSTRAINT events_facility_venue_fk
      FOREIGN KEY (facility_id, venue_id) REFERENCES facilities(id, venue_id);
  END IF;
END $$;

-- ── contests ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  event_id       uuid REFERENCES events(id) ON DELETE SET NULL,
  venue_id       uuid REFERENCES venues(id) ON DELETE SET NULL,
  facility_id    uuid REFERENCES facilities(id) ON DELETE SET NULL,
  scheduled_at   timestamptz,
  round          text,
  status         text NOT NULL DEFAULT 'scheduled'
    CONSTRAINT contests_status_check
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'canceled', 'postponed')),
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contests_facility_requires_venue
    CHECK (facility_id IS NULL OR venue_id IS NOT NULL),
  CONSTRAINT contests_facility_venue_fk
    FOREIGN KEY (facility_id, venue_id) REFERENCES facilities(id, venue_id)
);

DROP TRIGGER IF EXISTS contests_updated_at ON contests;
CREATE TRIGGER contests_updated_at
  BEFORE UPDATE ON contests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── contest_participants ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contest_participants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id     uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  entry_id       uuid NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  side           text
    CONSTRAINT contest_participants_side_check CHECK (side IN ('home', 'away')),
  start_position integer,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contest_participants_uniq UNIQUE (contest_id, entry_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS contest_participants_side_uniq
  ON contest_participants (contest_id, side) WHERE side IS NOT NULL;

-- ── contest_results ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contest_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id     uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES contest_participants(id) ON DELETE CASCADE,
  payload        jsonb NOT NULL DEFAULT '{}',
  score          numeric,
  provenance     text NOT NULL DEFAULT 'club_recorded'
    CONSTRAINT contest_results_provenance_check
    CHECK (provenance IN ('sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported')),
  dispute_status text NOT NULL DEFAULT 'none'
    CONSTRAINT contest_results_dispute_check
    CHECK (dispute_status IN ('none', 'disputed', 'resolved')),
  entered_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contest_results_participant_uniq UNIQUE (participant_id)
);

DROP TRIGGER IF EXISTS contest_results_updated_at ON contest_results;
CREATE TRIGGER contest_results_updated_at
  BEFORE UPDATE ON contest_results
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS: service-only (the 151 posture; the R3 spike reads service-role) ─────
ALTER TABLE contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contests, contest_participants, contest_results FROM PUBLIC, anon, authenticated;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contests_competition ON contests (competition_id);
CREATE INDEX IF NOT EXISTS idx_contests_event ON contests (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contests_scheduled ON contests (scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest ON contest_participants (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_entry ON contest_participants (entry_id);
CREATE INDEX IF NOT EXISTS idx_contest_results_contest ON contest_results (contest_id);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contests') AS contests_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contest_participants') AS participants_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contest_results') AS results_exists,
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE relname IN ('contests', 'contest_participants', 'contest_results')) AS all_rls_on,
  NOT (has_table_privilege('anon', 'contests', 'SELECT')
    OR has_table_privilege('anon', 'contest_participants', 'SELECT')
    OR has_table_privilege('anon', 'contest_results', 'SELECT')) AS anon_revoked,
  NOT (has_table_privilege('authenticated', 'contests', 'SELECT')
    OR has_table_privilege('authenticated', 'contest_results', 'SELECT')) AS authed_revoked,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_id_venue_uniq') AS facility_pair_uniq,
  EXISTS (SELECT 1 FROM pg_constraint
   WHERE conname = 'events_facility_venue_fk' AND conrelid = 'events'::regclass) AS events_composite_fk,
  EXISTS (SELECT 1 FROM pg_constraint
   WHERE conname = 'contests_facility_venue_fk' AND conrelid = 'contests'::regclass) AS contests_composite_fk,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'contests_status_check') LIKE '%postponed%' AS contest_status_frontloaded,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_participants_uniq') AS participants_uniq,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'contest_participants_side_uniq') AS side_uniq_partial,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'contest_results_provenance_check') LIKE '%imported%' AS provenance_full_ladder,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'contest_results_dispute_check') LIKE '%disputed%' AS dispute_room,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_results_participant_uniq') AS one_result_per_participant,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
    'idx_contests_competition','idx_contests_event','idx_contests_scheduled',
    'idx_contest_participants_contest','idx_contest_participants_entry',
    'idx_contest_results_contest')) = 6 AS six_indexes,
  (SELECT count(*) FROM contests) AS contests_info,
  (SELECT count(*) FROM contest_results) AS results_info;
-- Expect: true × 16, then two info counts (0 on first run).

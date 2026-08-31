-- ============================================================================
-- 141: venues & facilities — the venue/org split becomes schema (phase 0, 0.4)
-- ============================================================================
-- The locked masterplan decision (docs/ORG_PLATFORM_MASTERPLAN.md §2, §3.1):
-- a golf club is an ORGANIZATION that competes and a PROPERTY with courses —
-- different owners, different lifecycles, many-to-many in general. `venues`
-- is the property; `facilities` are its playing surfaces (a course, an ice
-- pad, court 3, field B). Nothing migrates OUT of the org `clubs` table —
-- it never held facility data (city geo + free text only).
--
-- Tom's decisions (Aug 30):
--   * v1 surface is the ADMIN console only (/dashboard/venues); org/manager
--     venue UX arrives with phase 1's org dashboard.
--   * ORPHAN venues allowed — a rink outlives its tenant orgs, so the
--     owning-org pair may be entirely NULL (num_nonnulls <= 1, not = 1).
--   * golf reference data stays where it is: venues LINK to golf_clubs
--     (public-SELECT catalog tables) via golf_club_id — never unified.
--   * events gain venue_id/facility_id now (the 119 pattern) with NO picker
--     yet; every explicit event field list widens in the same PR so the
--     silent-drop class (DEVLOG, #249's review catch) cannot recur when a
--     writer arrives.
--
-- Facility integrity: `events_facility_requires_venue` guards the shape
-- (facility ⇒ venue). It deliberately does NOT guarantee the facility
-- belongs to THAT venue — the airtight version is a composite FK
-- (facilities UNIQUE(id, venue_id) + events FK (facility_id, venue_id)
-- REFERENCES facilities(id, venue_id)) and lands with the migration that
-- ships the event venue picker, when a writer exists to exercise it.
--
-- facilities.kind is free text v1 on purpose: a court/field/rink taxonomy
-- is a product decision; a named CHECK can be added later without a rewrite.
--
-- ORDER-STRICT: run BEFORE merging the venues PR (the admin console writes
-- these tables and would 500 pre-141; reads degrade to empty).
-- Run AFTER 140. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

-- ── venues ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  -- Owning org: the two-FK discriminator (140/119 pattern — FKs can't span
  -- the two org tables). BOTH null = orphan venue, allowed by decision.
  league_id     uuid REFERENCES leagues(id) ON DELETE SET NULL,
  club_id       uuid REFERENCES clubs(id) ON DELETE SET NULL,
  -- Link to the golf reference catalog (125) — recognition, not ownership.
  golf_club_id  uuid REFERENCES golf_clubs(id) ON DELETE SET NULL,
  place_id      uuid REFERENCES places(id) ON DELETE SET NULL,
  city text, region text, region_code text, country text, country_code text,
  lat double precision, lng double precision,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT venues_owner_check CHECK (num_nonnulls(league_id, club_id) <= 1)
);

DROP TRIGGER IF EXISTS venues_updated_at ON venues;
CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── facilities ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facilities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  kind       text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Same posture as golf_clubs (125): public reference reads, service-role
-- writes (the admin console runs on the admin client).
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Venues are viewable by everyone" ON venues;
CREATE POLICY "Venues are viewable by everyone" ON venues FOR SELECT USING (true);
DROP POLICY IF EXISTS "Facilities are viewable by everyone" ON facilities;
CREATE POLICY "Facilities are viewable by everyone" ON facilities FOR SELECT USING (true);

-- ── events gain a place (119 shape; no writer until the picker ships) ───────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_facility_requires_venue') THEN
    ALTER TABLE events ADD CONSTRAINT events_facility_requires_venue
      CHECK (facility_id IS NULL OR venue_id IS NOT NULL);
  END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_venues_league_id ON venues (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venues_club_id ON venues (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venues_golf_club_id ON venues (golf_club_id) WHERE golf_club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facilities_venue_id ON facilities (venue_id);
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_facility_id ON events (facility_id) WHERE facility_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'venues') AS venues_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'facilities') AS facilities_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'venues') AS venues_rls_on,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'facilities') AS facilities_rls_on,
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'venues' AND cmd = 'SELECT') AS venues_public_read,
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'facilities' AND cmd = 'SELECT') AS facilities_public_read,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'venues_owner_check') LIKE '%num_nonnulls%' AS owner_check_present,
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'events' AND column_name = 'venue_id') AS events_venue_col,
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'events' AND column_name = 'facility_id') AS events_facility_col,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'events_facility_requires_venue') LIKE '%venue_id IS NOT NULL%' AS facility_check_present,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'venues_updated_at') = 1 AS updated_at_trigger,
  (SELECT count(*) FROM pg_indexes WHERE tablename IN ('venues', 'facilities', 'events')
    AND indexname IN ('idx_venues_league_id','idx_venues_club_id','idx_venues_golf_club_id',
                      'idx_facilities_venue_id','idx_events_venue_id','idx_events_facility_id')) = 6 AS six_indexes,
  (SELECT count(*) FROM venues) AS venues_info,
  (SELECT count(*) FROM facilities) AS facilities_info;
-- Expect: true × 12, then two info counts (0 on first run).

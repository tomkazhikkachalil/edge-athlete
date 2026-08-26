-- ============================================================================
-- Migration 125 — golf clubs: multi-course facilities + combo rounds
-- ============================================================================
-- A club can hold several playable layouts (two 18s, three 9s, a 27-hole
-- rotation). Until now golf_courses had one row per catalog entry with no way
-- to relate siblings, so multi-course clubs (Greensmere, Ottawa Hunt, the
-- Rockland nines…) were either a single ambiguous row or unlinked duplicates,
-- and hole GPS correctly refused to guess (hole-geometry.ts nulls on
-- duplicate OSM refs).
--
-- Model (nines + combos, Tom's decision Aug 26 2026):
--   * golf_clubs        — one row per multi-course FACILITY, created lazily
--                         (single-course clubs never get one). NOT the
--                         multi-sport `clubs` orgs table (117) — this is golf
--                         reference geography, service-role-written only.
--   * golf_courses      — each SECTION (an 18, or an individual nine) is its
--                         own row: club_id links siblings, section_name names
--                         the section ("Premier", "North Nine"), section_kind
--                         classifies it. Per-row hole_data / hole_geometry /
--                         ratings therefore keep working untouched.
--   * an 18-hole round on a 27-hole club = TWO chosen nines, numbered 1–18
--     on the scorecard (front nine = 1–9, back = 10–18) — matching how WHS
--     rates 18-hole combinations. golf_scorecard_data.course_composition
--     records the pairing; course_id stays the FRONT nine's row so every
--     existing join/embed keeps resolving to a real course at the right
--     facility. NULL composition = a normal single-course round (all
--     existing rows).
--
-- Every ≤18 CHECK (002/004) and API validator is deliberately untouched:
-- hole numbers never exceed 18 under this model.
--
-- ⚠️ Supabase SQL Editor: run the WHOLE file; expect green "Success", then
-- eyeball the check grid at the bottom (all booleans true, count 3).
-- Re-runnable: IF NOT EXISTS / DO-block guards throughout.
-- ============================================================================

-- ── golf_clubs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golf_clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  place_id uuid REFERENCES places(id) ON DELETE SET NULL,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS golf_clubs_updated_at ON golf_clubs;
CREATE TRIGGER golf_clubs_updated_at
  BEFORE UPDATE ON golf_clubs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: public reference data, same shape as golf_courses (100). No write
-- policies — inserts/updates go through the service role only (the sweep
-- script and curation).
ALTER TABLE golf_clubs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Golf clubs are viewable by everyone" ON golf_clubs;
CREATE POLICY "Golf clubs are viewable by everyone"
  ON golf_clubs FOR SELECT
  USING (true);

-- ── golf_courses: section columns ───────────────────────────────────────────
ALTER TABLE golf_courses
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES golf_clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS section_name text,
  ADD COLUMN IF NOT EXISTS section_kind text;

-- ADD CONSTRAINT has no IF NOT EXISTS; DO-block keeps the file re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_section_kind_check') THEN
    ALTER TABLE golf_courses ADD CONSTRAINT golf_courses_section_kind_check
      CHECK (section_kind IS NULL OR section_kind IN ('course_18', 'nine', 'unspecified'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_golf_courses_club_id ON golf_courses (club_id);

-- ── golf_scorecard_data: combo composition ──────────────────────────────────
-- [{"course_id":"…","section_name":"North Nine","holes":"1-9"},
--  {"course_id":"…","section_name":"South Nine","holes":"10-18"}]
-- NULL for every existing and every single-course round. Validated in app
-- code (parseComposition, src/lib/golf/course-sections.ts) — jsonb here so a
-- malformed write degrades to "no composition" rather than a CHECK failure
-- mid-round.
ALTER TABLE golf_scorecard_data
  ADD COLUMN IF NOT EXISTS course_composition jsonb;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid ──────────────────────────────────────────────────
-- Expect: clubs_table true, clubs_rls true, clubs_select_policy true,
--         section_cols 3, section_check true, idx_club true, composition true.
SELECT
  EXISTS (SELECT 1 FROM pg_class WHERE relname = 'golf_clubs') AS clubs_table,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'golf_clubs') AS clubs_rls,
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'golf_clubs'
          AND policyname = 'Golf clubs are viewable by everyone') AS clubs_select_policy,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'golf_courses'
     AND column_name IN ('club_id', 'section_name', 'section_kind')) AS section_cols,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_courses_section_kind_check') AS section_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_club_id') AS idx_club,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'golf_scorecard_data'
            AND column_name = 'course_composition') AS composition;

-- ============================================================================
-- 169: venues.golf_course_id + the four phase-6b module keys (phase 6b, A1)
-- ============================================================================
-- The golf club page: an org club (117) and its golf property (the 125
-- catalog) meet through VENUES (141) — recognition, never unification.
-- 141 gave venues `golf_club_id`, but 125 creates `golf_clubs` rows LAZILY
-- and single-course facilities NEVER get one (only multi-course clubs do),
-- so a one-course club had nothing to point at. This column closes that:
--
--   * the manager picks a catalog COURSE (any golf_courses row);
--   * when that row carries club_id the venue links the CLUB (every
--     section/nine of the facility shows), else it links the COURSE;
--   * readers UNION both (courses WHERE club_id = golf_club_id OR
--     id = golf_course_id). One venue, at most one of the two set — the
--     app writes them as a pair and the CHECK below guards the shape.
--
-- Module keys: the org_site_modules CHECK widens ONCE to the whole phase
-- 6b set — 'courses' (A2), 'divisions', 'leaders', 'documents' (B3) — a
-- wider DB CHECK than the app is harmless (sitePATCH's set_module
-- self-heals a missing row; app-side MODULE_KEYS grows per round). Only
-- 'courses' is seeded for existing sites (DISABLED, the 164 recipe); the
-- B3 keys get their rows lazily from the toggle.
--
-- ORDER-STRICT: run AFTER 168, BEFORE merging the A1 PR. App code merged
-- ahead DEGRADES: the venues reader retries its select without
-- golf_course_id (42703), the link PATCH answers a friendly 409.
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP COLUMN
-- golf_course_id; restore the 12-key module CHECK; DELETE module rows
-- WHERE module_key IN ('courses','divisions','leaders','documents').

-- ── venues.golf_course_id ───────────────────────────────────────────────────
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS golf_course_id uuid REFERENCES golf_courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venues_golf_course_id
  ON venues (golf_course_id) WHERE golf_course_id IS NOT NULL;

-- At most one golf link per venue (club OR course, never both).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_golf_link_check') THEN
    ALTER TABLE venues ADD CONSTRAINT venues_golf_link_check
      CHECK (num_nonnulls(golf_club_id, golf_course_id) <= 1);
  END IF;
END $$;

-- ── Widen the module key CHECK (additive; re-runnable) ──────────────────────
ALTER TABLE org_site_modules
  DROP CONSTRAINT IF EXISTS org_site_modules_key_check;
ALTER TABLE org_site_modules
  ADD CONSTRAINT org_site_modules_key_check CHECK (module_key IN (
    'hero','standings','schedule','teams','staff','venues','affiliations',
    'sponsors','contact','news','gallery','register',
    'courses','divisions','leaders','documents'
  ));

-- ── Seed the courses module row for EXISTING sites — DISABLED ───────────────
INSERT INTO org_site_modules (site_id, module_key, enabled, sort_order, config)
SELECT s.id, 'courses', false, 12, '{}'::jsonb
FROM org_sites s
WHERE NOT EXISTS (
  SELECT 1 FROM org_site_modules m
  WHERE m.site_id = s.id AND m.module_key = 'courses'
);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'venues' AND column_name = 'golf_course_id')          AS golf_course_col,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'venues_golf_link_check') LIKE '%num_nonnulls%'            AS golf_link_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_venues_golf_course_id') AS golf_course_index,
  (SELECT pg_get_constraintdef(oid) LIKE '%documents%' FROM pg_constraint
     WHERE conname = 'org_site_modules_key_check')                            AS module_check_widened,
  (SELECT count(*) FROM org_site_modules WHERE module_key = 'courses')        AS courses_rows_seeded,
  (SELECT count(*) = 0 FROM org_site_modules
     WHERE module_key = 'courses' AND enabled)                                AS all_seeded_disabled,
  (SELECT count(*) FROM org_sites)                                            AS sites_total;

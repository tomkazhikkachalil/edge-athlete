-- ============================================================================
-- 101: golf_courses details + location search indexes + hydration marker
-- ============================================================================
-- Three riders from Tom's first device pass on the catalog (Aug 23):
--
-- 1. DETAILS — the providers carry course description (Wikipedia, CC BY-SA —
--    the attribution column exists because displaying it is a license DUTY,
--    not decoration), architect, year built, type, website, phone. New
--    columns feed the composer's course info card + embedded map.
-- 2. SEARCH — 100 indexed name only; the search now matches city/region too
--    (the "ottawa finds 1 of 3 courses" regression), so those columns get
--    the same trigram treatment to stay honest as providers backfill.
-- 3. hydrated_at — a course whose provider detail is genuinely empty used
--    to look "thin" forever and re-fetched on EVERY selection. The marker
--    records that hydration was ATTEMPTED; the app skips re-fetch for 7
--    days regardless of how much data came back.
-- ============================================================================

ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS description_attribution text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS architect text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS year_built integer;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS course_type text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS hydrated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_golf_courses_city_trgm
  ON golf_courses USING GIN (lower(city) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_region_trgm
  ON golf_courses USING GIN (lower(region) gin_trgm_ops);

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid ───────────────────────────────────────────────────
-- Expect: cols 8, idx_city true, idx_region true.
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'golf_courses'
     AND column_name IN ('description','description_attribution','architect','year_built','course_type','website','phone','hydrated_at')) AS cols,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_city_trgm') AS idx_city,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_region_trgm') AS idx_region;

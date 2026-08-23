-- ============================================================================
-- 103: golf_courses indexes for the worldwide OSM import (~30–40k rows)
-- ============================================================================
-- Migration 100 indexed name only (trgm + prefix) for a 68-row catalog. The
-- OSM bulk import multiplies the table ~500×, and two query shapes need help:
--
--  1. searchCatalog's OR across name/club_name/city/region (`col ILIKE %q%`).
--     Postgres can BitmapOr across per-column trigram indexes; with three of
--     the four columns unindexed it falls back to a seq scan of the whole
--     catalog on every keystroke. gin_trgm_ops on the RAW columns — pg_trgm
--     GIN indexes serve ILIKE directly (the lower() expression form in 100
--     only serves lower(col) LIKE queries).
--  2. The cross-source dedupe guard's lat/lng bounding box, and the browse
--     head's hydrated_at DESC NULLS LAST ordering.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_golf_courses_club_trgm
  ON golf_courses USING GIN (club_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_city_trgm
  ON golf_courses USING GIN (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_region_trgm
  ON golf_courses USING GIN (region gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_name_raw_trgm
  ON golf_courses USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_golf_courses_lat ON golf_courses (lat);
CREATE INDEX IF NOT EXISTS idx_golf_courses_hydrated_at
  ON golf_courses (hydrated_at DESC NULLS LAST);

-- ── Check grid (re-runnable; every row must say true) ───────────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_club_trgm') AS idx_club_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_city_trgm') AS idx_city_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_region_trgm') AS idx_region_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_name_raw_trgm') AS idx_name_raw_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_lat') AS idx_lat,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_hydrated_at') AS idx_hydrated_at;

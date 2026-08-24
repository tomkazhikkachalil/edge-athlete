-- ============================================================================
-- 111: drop the dead lower() indexes on golf_courses; finish 103's intent
-- ============================================================================
-- Migration 100 indexed lower(name) (trgm + COLLATE "C" prefix) and 101
-- lower(city)/lower(region), for PostgREST queries that can't emit lower()
-- — nothing has ever used them, and the 104 tsvector + 107 per-token
-- ranking replaced the whole ladder anyway. They cost write amplification
-- on every insert/update (29k rows imported, 27k backfilled, every
-- hydration) for no read.
--
-- The trap 103 walked into (audit, Aug 24): it created raw-column trigram
-- indexes with the SAME NAMES 101 had used for the lower() ones —
-- idx_golf_courses_city_trgm / idx_golf_courses_region_trgm — with IF NOT
-- EXISTS, so on a database where 101 had run those two were no-ops and the
-- live city/region indexes stayed the unusable lower() variants. This
-- migration therefore drops by DEFINITION (any golf_courses index whose
-- indexdef contains "lower("), then creates the raw-column indexes under
-- unambiguous names. Re-runnable.
-- ============================================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'golf_courses' AND indexdef ILIKE '%lower(%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
    RAISE NOTICE 'dropped dead lower() index %', r.indexname;
  END LOOP;
END $$;

-- Raw-column trigram GINs the search RPC's substring fallback can use.
-- name/club exist from 103 (idx_golf_courses_name_raw_trgm, _club_trgm);
-- city/region get unambiguous names here.
CREATE INDEX IF NOT EXISTS idx_golf_courses_city_raw_trgm
  ON golf_courses USING GIN (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_region_raw_trgm
  ON golf_courses USING GIN (region gin_trgm_ops);

-- ── Check grid (re-runnable; booleans must say true) ────────────────────────
SELECT
  NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'golf_courses' AND indexdef ILIKE '%lower(%') AS no_lower_indexes_left,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_name_raw_trgm') AS name_raw_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_club_trgm') AS club_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_city_raw_trgm') AS city_raw_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_region_raw_trgm') AS region_raw_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_search') AS search_vector_gin,
  (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'golf_courses') AS remaining_indexes;

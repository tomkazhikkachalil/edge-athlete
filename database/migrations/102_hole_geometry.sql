-- ============================================================================
-- 102: golf_courses per-hole geometry cache (OSM)
-- ============================================================================
-- Tom's device pass on the live map: "it doesn't bring you to hole one, it
-- just brings you to the general location". Other apps license mapped course
-- data; our free source is OpenStreetMap, which carries golf=hole ways
-- (tee→green polylines with hole number + par) for many courses — verified
-- live: Rideau View and Eagle Creek both have clean refs 1–18.
--
-- hole_geometry  — jsonb {"holes":[{"hole":1,"par":4,"line":[[lat,lng],..]}],
--                  "source":"osm"} or NULL when OSM has no unambiguous data
--                  (e.g. 27-hole clubs whose refs duplicate — Ottawa Hunt).
-- hole_geometry_at — when a fetch was ATTEMPTED (success or empty). The app
--                  serves the cache for 30 days either way, so flaky Overpass
--                  responses don't hammer the public servers. Geometry is
--                  fetched server-side, budgeted like the other providers.
-- ============================================================================

ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS hole_geometry jsonb;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS hole_geometry_at timestamptz;

-- ── Check grid (re-runnable; both rows must say ok) ─────────────────────────
SELECT
  'hole_geometry column' AS check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'golf_courses' AND column_name = 'hole_geometry'
      AND data_type = 'jsonb'
  ) THEN 'ok' ELSE 'MISSING' END AS status
UNION ALL
SELECT
  'hole_geometry_at column',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'golf_courses' AND column_name = 'hole_geometry_at'
      AND data_type = 'timestamp with time zone'
  ) THEN 'ok' ELSE 'MISSING' END;

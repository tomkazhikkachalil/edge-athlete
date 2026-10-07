-- ============================================================================
-- 254: golf_courses.hole_elevation — the elevation profile along each hole
--      (Golf near-me + elevation program PR C, Oct 7 2026; runs on BOTH
--      staging and prod; additive)
-- ============================================================================
-- Tom: "slope to help athletes make informed decisions on their shots" — the
-- rise or drop from where you stand to the green, and a "plays like"
-- distance. The course API carries no elevation; Open-Meteo's Elevation API
-- (90 m Copernicus DEM, up to 100 coordinates per request) does. Sampled
-- ONCE per course along each hole's OSM line (10 points per hole, tee and
-- green included) and cached here for 30 days — 18 holes × 10 points = 180
-- coordinates = 2 requests per course per month.
--
-- Its OWN columns, not inside hole_geometry (102): getCourseHoleGeometry
-- overwrites that column wholesale on refresh (and sibling rows through the
-- section split), so elevation stored inside it would race the geometry
-- writer — and the geometry path is untouched by this program.
--
--   hole_elevation    jsonb  {holes:[{hole, pts:[[lat,lng],…], elev:[m,…]}],
--                             sampled:'line10', source:'open-meteo'} — or
--                             NULL when the course has no geometry / the
--                             source answered nothing (stamped, like 102).
--   hole_elevation_at timestamptz — when it was last attempted; recomputed
--                             after 30 days or when hole_geometry_at is
--                             newer (a new line, a new profile).
--
-- Pre-flight: ledger head 253. Deploy order: FLEXIBLE — the code treats a
-- missing column (42703) as "no elevation". Reversal (data-safe): DROP the
-- two columns.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 254) THEN
    RAISE EXCEPTION '254 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 253 THEN RAISE EXCEPTION '254 pre-flight: ledger head is %, expected 253', n; END IF;
END $$;

-- ── 1. The columns ──────────────────────────────────────────────────────────
ALTER TABLE public.golf_courses ADD COLUMN IF NOT EXISTS hole_elevation jsonb;
ALTER TABLE public.golf_courses ADD COLUMN IF NOT EXISTS hole_elevation_at timestamptz;
COMMENT ON COLUMN public.golf_courses.hole_elevation IS 'Elevation profile along each hole (254): {holes:[{hole, pts:[[lat,lng]…], elev:[metres…]}], sampled:''line10'', source:''open-meteo''}; NULL = no geometry or no answer. Sampled from hole_geometry; 30-day cache keyed by hole_elevation_at. Written only by src/lib/golf/elevation-server.ts.';
COMMENT ON COLUMN public.golf_courses.hole_elevation_at IS 'When hole_elevation was last ATTEMPTED (254) — a null answer is stamped too; recomputed after 30 days or when hole_geometry_at is newer.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (254, '254_hole_elevation.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on both environments: 254 APPLIED | 2 | 254
SELECT '254 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_courses'
         AND column_name IN ('hole_elevation', 'hole_elevation_at')) AS new_columns_expect_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_254;

-- ============================================================================
-- 105: backfill course locations from `places` (run AFTER 104 and the seed)
-- ============================================================================
-- Every catalog row has coordinates; 95% had no country. Nearest GeoNames
-- place within 40 km supplies city (only when OSM/provider gave none — an
-- addr:city tag is more specific than "nearest big town"), region and
-- country with codes, and the FK. The gazetteer's region/country replace
-- whatever mixed-format value was there ('FL', 'USA', 'Canada'): the seed
-- normalized them once; provider writers normalize from now on
-- (src/lib/geo/regions.ts). Rows farther than 40 km from any place keep
-- their old values and are counted below.
--
-- Idempotent: re-running re-derives the same answer. The search vector is
-- recomputed by 104's trigger on every updated row.
-- ============================================================================

WITH nearest AS (
  SELECT c.id AS course_id, p.id AS place_id, p.name AS place_name,
         p.region, p.region_code, p.country, p.country_code, p.dist
  FROM golf_courses c
  CROSS JOIN LATERAL (
    SELECT p.id, p.name, p.region, p.region_code, p.country, p.country_code,
           public.haversine_km(c.lat, c.lng, p.lat, p.lng) AS dist
    FROM places p
    WHERE p.lat BETWEEN c.lat - 0.36 AND c.lat + 0.36
      AND p.lng BETWEEN c.lng - 0.36 / GREATEST(cos(radians(c.lat)), 0.1)
                    AND c.lng + 0.36 / GREATEST(cos(radians(c.lat)), 0.1)
    ORDER BY dist
    LIMIT 1
  ) p
  WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND p.dist <= 40
)
UPDATE golf_courses c SET
  place_id        = n.place_id,
  city            = COALESCE(NULLIF(trim(c.city), ''), n.place_name),
  region          = n.region,
  region_code     = n.region_code,
  country         = n.country,
  country_code    = n.country_code,
  location_source = COALESCE(c.location_source,
                      CASE WHEN NULLIF(trim(c.city), '') IS NOT NULL THEN 'osm' ELSE 'gazetteer' END)
FROM nearest n
WHERE n.course_id = c.id
  AND (c.place_id IS DISTINCT FROM n.place_id
       OR c.country_code IS DISTINCT FROM n.country_code
       OR c.region_code IS DISTINCT FROM n.region_code
       OR c.city IS NULL);

-- ── Report (re-runnable) ────────────────────────────────────────────────────
SELECT
  count(*) AS courses,
  count(*) FILTER (WHERE place_id IS NOT NULL) AS with_place,
  count(*) FILTER (WHERE city IS NOT NULL) AS with_city,
  count(*) FILTER (WHERE region_code IS NOT NULL) AS with_region,
  count(*) FILTER (WHERE country_code IS NOT NULL) AS with_country,
  count(*) FILTER (WHERE lat IS NOT NULL AND place_id IS NULL) AS orphans_over_40km,
  (SELECT count(*) FROM golf_courses WHERE country_code = 'CA' AND region_code = 'ON') AS ontario_courses
FROM golf_courses;

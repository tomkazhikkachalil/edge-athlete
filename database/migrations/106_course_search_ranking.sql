-- ============================================================================
-- 106: search_golf_courses ranking — name-token tier, ts_rank, richness first
-- ============================================================================
-- Prod probes after 104/105 (Aug 24):
--   "kanata ontario" ranked Thunderbird Sports Centre (city Kanata) above
--   Kanata Golf Club (Kanata in the NAME). ts_rank_cd rewards matched terms
--   sitting next to each other, and the vector concatenates name → club →
--   city → region, so a city token adjacent to a region token beat a name
--   token. "eagle" ranked three bare OSM rows with "Eagle" in name AND city
--   above Ottawa's seeded Eagle Creek: score ran before richness.
-- Fixes, same signature (CREATE OR REPLACE — re-runnable):
--   tiers 0 exact · 1 whole query is a name prefix · 2 EVERY token matches
--   the name · 3 vector match anywhere · 4 substring fallback;
--   plain ts_rank (weights, no cover density); richness before score.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_golf_courses(
  q text,
  max_results int DEFAULT 20,
  p_country_code text DEFAULT NULL,
  p_region_code text DEFAULT NULL,
  p_near_lat float8 DEFAULT NULL,
  p_near_lng float8 DEFAULT NULL,
  p_radius_km float8 DEFAULT NULL
)
RETURNS TABLE (
  id uuid, external_source text, external_id text, name text, club_name text,
  city text, region text, country text, total_par integer, holes_count integer,
  hole_data jsonb, course_rating jsonb, slope_rating jsonb,
  lat float8, lng float8, description text, description_attribution text,
  architect text, year_built integer, course_type text, website text, phone text,
  hydrated_at timestamptz, place_id uuid, country_code text, region_code text,
  location_source text, distance_km float8, match_rank int
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  qn     text    := public.search_normalize(q);
  tsq    tsquery := public.search_prefix_tsquery(q);
  lim    int     := GREATEST(COALESCE(max_results, 20), 1);
  near   boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius float8  := COALESCE(p_radius_km, 50);
  dlat   float8;
  dlng   float8;
BEGIN
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT c.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS dist
    FROM golf_courses c
    WHERE (p_country_code IS NULL OR c.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
      AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                    AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
  ),
  matched AS (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN public.search_normalize(b.name) = qn THEN 0
        WHEN public.search_normalize(b.name) LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(b.name)) @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL THEN ts_rank(b.search_vector, tsq) ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       OR (length(qn) >= 2 AND (
            b.name ILIKE '%' || qn || '%' OR b.club_name ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
  )
  SELECT m.id, m.external_source, m.external_id, m.name, m.club_name,
    m.city, m.region, m.country, m.total_par, m.holes_count,
    m.hole_data, m.course_rating, m.slope_rating,
    m.lat, m.lng, m.description, m.description_attribution,
    m.architect, m.year_built, m.course_type, m.website, m.phone,
    m.hydrated_at, m.place_id, m.country_code, m.region_code,
    m.location_source, m.dist, m.tier
  FROM matched m
  ORDER BY
    m.tier,
    CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
    -- richness first within a tier: real tees/holes > city known > bare
    (m.hole_data IS NOT NULL OR m.course_rating <> '{}'::jsonb) DESC,
    (m.city IS NOT NULL) DESC,
    m.hydrated_at DESC NULLS LAST,
    m.score DESC,
    m.dist ASC NULLS LAST,
    m.name
  LIMIT lim;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_golf_courses(text, int, text, text, float8, float8, float8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_golf_courses(text, int, text, text, float8, float8, float8)
  TO service_role;

-- ── Check grid (re-runnable; every row must say true) ───────────────────────
SELECT
  (SELECT name FROM public.search_golf_courses('kanata ontario', 3) LIMIT 1) ILIKE 'kanata%' AS kanata_name_first,
  (SELECT city FROM public.search_golf_courses('eagle', 1)) = 'Ottawa' AS eagle_ottawa_first,
  NOT has_function_privilege('anon', 'public.search_golf_courses(text, int, text, text, float8, float8, float8)', 'EXECUTE') AS anon_revoked;

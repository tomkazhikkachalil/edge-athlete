-- ============================================================================
-- 104: places (GeoNames) + location-aware course search
-- ============================================================================
-- Tom (Aug 24 2026): search "is only by name" — people search by country,
-- province/state, city, region, and that must hold for users, clubs and
-- leagues too. Prod audit the same day: of 28,968 catalog rows 5% carried a
-- country, 18% a region, 36% a city, in mixed formats ('US'/'USA', 'FL'). A
-- search function cannot match data a row doesn't have, so this migration
-- lays the shared location model first and the course search engine on it.
--
-- The model (docs/SEARCH.md): one `places` table (GeoNames cities5000, CC BY
-- 4.0 — attribution is rendered next to the OSM line) that every locatable
-- entity points at via `place_id` plus DENORMALIZED city/region/region_code/
-- country/country_code/lat/lng, so each entity's own search vector and
-- filters need no join. Every search RPC takes the same location parameters
-- (p_country_code, p_region_code, p_near_lat/lng, p_radius_km). Courses get
-- it here; profiles and clubs in 106; leagues/arenas on creation.
--
-- Text search: tokens AND'ed with PREFIX matching over an unaccented,
-- weight-tiered tsvector using the `simple` config (no stemming, NO stop
-- words — 087's websearch_to_tsquery('english') lesson), trigram substring
-- as the fallback, one ranking ladder: exact → prefix → ts_rank → richness →
-- recency → distance → name.
--
-- Order of operations for Tom: run this, then seed `places` (ops script,
-- recorded in DEVLOG), then run 105 (the SQL backfill of course locations).
-- App code deployed before this runs degrades to the old two-pass search
-- (course-catalog.ts handles 42883/PGRST202), so merge order is free.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── Shared helpers ───────────────────────────────────────────────────────────
-- lower(unaccent(x)) — declared IMMUTABLE (unaccent is STABLE only because
-- its dictionary could change; ours never does at runtime) so it can sit in
-- indexes and generated expressions. search_path covers Supabase installing
-- extensions into `extensions`.
CREATE OR REPLACE FUNCTION public.search_normalize(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$ SELECT lower(unaccent(coalesce(t, ''))) $$;

-- "eagle creek ottawa" → 'eagle:* & creek:* & ottawa:*'. NULL for no tokens.
-- Tokens are alphanumeric only after normalization, so the tsquery text is
-- safe by construction (no operators can be injected).
CREATE OR REPLACE FUNCTION public.search_prefix_tsquery(q text)
RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN cardinality(toks) = 0 THEN NULL
    ELSE to_tsquery('simple', array_to_string(ARRAY(SELECT t || ':*' FROM unnest(toks) AS t), ' & '))
  END
  FROM (
    SELECT array_remove(regexp_split_to_array(public.search_normalize(q), '[^[:alnum:]]+'), '') AS toks
  ) s
$$;

-- Great-circle km. Plain SQL so the planner can inline it.
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
RETURNS float8
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ── places ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geonames_id integer NOT NULL UNIQUE,
  name text NOT NULL,
  ascii_name text,
  region text,
  region_code text,           -- ISO-3166-2 letters where known (US, CA), else GeoNames admin1
  country text NOT NULL,
  country_code text NOT NULL, -- ISO-3166-1 alpha-2
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  population integer,
  feature_code text,
  search_vector tsvector,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE OR REPLACE FUNCTION public.places_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.ascii_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(concat_ws(' ', NEW.region, NEW.region_code))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(concat_ws(' ', NEW.country, NEW.country_code))), 'D');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS places_search_vector ON places;
CREATE TRIGGER places_search_vector
  BEFORE INSERT OR UPDATE OF name, ascii_name, region, region_code, country, country_code ON places
  FOR EACH ROW EXECUTE FUNCTION public.places_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_places_search ON places USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_places_country_region ON places (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_places_lat ON places (lat);
CREATE INDEX IF NOT EXISTS idx_places_name_trgm ON places USING GIN (name gin_trgm_ops);

ALTER TABLE places ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Places are viewable by everyone" ON places;
CREATE POLICY "Places are viewable by everyone" ON places FOR SELECT USING (true);
-- No write policies: the seed and any refresh go through the service role.

-- Autocomplete for location pickers (profile location, filters). Biggest
-- places first inside a tier so "lon" offers London before Londonderry.
CREATE OR REPLACE FUNCTION public.search_places(
  q text,
  max_results int DEFAULT 10,
  p_country_code text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, name text, region text, region_code text, country text, country_code text,
  lat float8, lng float8, population integer, match_rank int
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  qn  text := public.search_normalize(q);
  tsq tsquery := public.search_prefix_tsquery(q);
  lim int := GREATEST(COALESCE(max_results, 10), 1);
BEGIN
  IF tsq IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.region, p.region_code, p.country, p.country_code, p.lat, p.lng, p.population,
    CASE WHEN public.search_normalize(p.name) = qn THEN 0
         WHEN public.search_normalize(p.name) LIKE qn || '%' THEN 1
         ELSE 2 END AS match_rank
  FROM places p
  WHERE p.search_vector @@ tsq
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
  ORDER BY 10, p.population DESC NULLS LAST, p.name
  LIMIT lim;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_places(text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_places(text, int, text) TO service_role;

-- ── golf_courses: location columns + search vector ─────────────────────────
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS region_code text;
-- Who filled the location: 'osm' (addr:* tags), 'provider', 'nominatim',
-- 'gazetteer' (105). Writers never overwrite a better source with a worse one.
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS location_source text;
ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION public.golf_courses_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.club_name)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.city)), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code))), 'D');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS golf_courses_search_vector ON golf_courses;
CREATE TRIGGER golf_courses_search_vector
  BEFORE INSERT OR UPDATE OF name, club_name, city, region, region_code, country, country_code ON golf_courses
  FOR EACH ROW EXECUTE FUNCTION public.golf_courses_search_vector_update();

-- One-off recompute for existing rows (idempotent). This IS a bulk UPDATE, so
-- 100's updated_at trigger bumps every row once — acceptable for reference
-- data; nothing keys off golf_courses.updated_at.
UPDATE golf_courses SET search_vector =
  setweight(to_tsvector('simple', public.search_normalize(name)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(club_name)), 'B') ||
  setweight(to_tsvector('simple', public.search_normalize(city)), 'C') ||
  setweight(to_tsvector('simple', public.search_normalize(
    concat_ws(' ', region, region_code, country, country_code))), 'D')
WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_golf_courses_search ON golf_courses USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_golf_courses_country_region ON golf_courses (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_golf_courses_place ON golf_courses (place_id);

-- ── The course search RPC ────────────────────────────────────────────────────
-- Replaces the two-pass ILIKE window + JS ladder in course-catalog.ts: the
-- whole match set is ranked in SQL, every token must match somewhere, and
-- location is a first-class filter and sort key.
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
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 2
        ELSE 3
      END AS tier,
      CASE WHEN tsq IS NOT NULL THEN ts_rank_cd(b.search_vector, tsq) ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       -- Substring fallback on the raw columns (the 103 trigram GINs):
       -- "reek" still finds Eagle Creek. Accent folding is the vector's job.
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
    -- "Near me" browse: nearest first. A typed query keeps relevance first.
    CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
    m.score DESC,
    -- richness: real tees/holes > city known > bare identity (the same tier
    -- rule mergeSearchRows applied in JS)
    (m.hole_data IS NOT NULL OR m.course_rating <> '{}'::jsonb) DESC,
    (m.city IS NOT NULL) DESC,
    m.hydrated_at DESC NULLS LAST,
    m.dist ASC NULLS LAST,
    m.name
  LIMIT lim;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_golf_courses(text, int, text, text, float8, float8, float8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_golf_courses(text, int, text, text, float8, float8, float8)
  TO service_role;
COMMENT ON FUNCTION public.search_golf_courses IS
  'Ranked, location-aware course search over the tsvector + trigram fallback. Service-role only (104).';

-- Facets for the Explore dropdowns: countries with counts, or the regions of
-- one country. PostgREST cannot GROUP BY, hence an RPC.
CREATE OR REPLACE FUNCTION public.golf_course_location_facets(p_country_code text DEFAULT NULL)
RETURNS TABLE (country text, country_code text, region text, region_code text, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    min(c.country) AS country,
    c.country_code,
    CASE WHEN p_country_code IS NULL THEN NULL ELSE min(c.region) END AS region,
    CASE WHEN p_country_code IS NULL THEN NULL ELSE c.region_code END AS region_code,
    count(*) AS n
  FROM golf_courses c
  WHERE c.country_code IS NOT NULL
    AND (p_country_code IS NULL OR (c.country_code = upper(p_country_code) AND c.region_code IS NOT NULL))
  GROUP BY c.country_code, CASE WHEN p_country_code IS NULL THEN NULL ELSE c.region_code END
  ORDER BY n DESC, 1, 3
$$;
REVOKE EXECUTE ON FUNCTION public.golf_course_location_facets(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.golf_course_location_facets(text) TO service_role;

-- ── Check grid (re-runnable; every row must say true) ───────────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') AS ext_unaccent,
  EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'places') AS tbl_places,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_places_search') AS idx_places_search,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'golf_courses' AND column_name = 'search_vector') AS col_course_vector,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_search') AS idx_course_search,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'search_golf_courses') AS fn_search_courses,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'search_places') AS fn_search_places,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'golf_course_location_facets') AS fn_facets,
  (SELECT count(*) FROM golf_courses WHERE search_vector IS NULL) = 0 AS vectors_filled,
  NOT has_function_privilege('anon', 'public.search_golf_courses(text, int, text, text, float8, float8, float8)', 'EXECUTE') AS anon_revoked,
  public.search_prefix_tsquery('Eagle Creek, Ottawa') = to_tsquery('simple', 'eagle:* & creek:* & ottawa:*') AS tokenizer_ok,
  public.search_normalize('Montréal') = 'montreal' AS unaccent_ok;

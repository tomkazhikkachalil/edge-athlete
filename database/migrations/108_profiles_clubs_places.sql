-- ============================================================================
-- 108: users and clubs by location — the places model on profiles + clubs
-- ============================================================================
-- Tom (Aug 24): location search must work for users, clubs and leagues, not
-- just courses. This migration gives `profiles` and `clubs` the location
-- columns from docs/SEARCH.md, rebuilds their search vectors on the shared
-- contract (search_normalize + `simple`, weighted), rewrites `search_people`
-- and `search_clubs` to take the standard location parameters, and backfills
-- both from their free-text `location` by matching `places`.
--
-- Run AFTER 104 (places, helpers) and the places seed. Re-runnable.
--
-- ⚠️ search_people's SIGNATURE CHANGES (new optional params). PostgREST cannot
-- resolve overloaded RPCs (PGRST203), so the 087 signature is DROPPED first
-- and src/lib/search/people-server.ts is updated in the same PR. Deploy the
-- app before running this? No — the app tolerates both: it passes only the
-- old arguments until it needs the new ones, and every new param defaults.
-- ============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region_code text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location_source text; -- 'user' | 'backfill'

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS region_code text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS location_source text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_profiles_country_region ON profiles (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_profiles_lat ON profiles (lat);
CREATE INDEX IF NOT EXISTS idx_profiles_place ON profiles (place_id);
CREATE INDEX IF NOT EXISTS idx_clubs_country_region ON clubs (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_clubs_lat ON clubs (lat);

-- ── Place → entity copy (shared by the backfills and the app's writers) ──────
-- The app writes these columns itself on save (regions.ts); this helper is
-- for SQL-side fills so the denormalized copy can never drift by hand.
CREATE OR REPLACE FUNCTION public.place_fields(p_place_id uuid)
RETURNS TABLE (city text, region text, region_code text, country text, country_code text, lat float8, lng float8)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.name, p.region, p.region_code, p.country, p.country_code, p.lat, p.lng
  FROM places p WHERE p.id = p_place_id
$$;

-- ── profiles.search_vector on the contract (was 'english' over names+location) ─
CREATE OR REPLACE FUNCTION public.profiles_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  -- email deliberately absent (087). Names A; structured location and the
  -- free-text location C (a person named "Ottawa" must still outrank people
  -- IN Ottawa — the RPC's tier does that; weights only order within a tier).
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.first_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.last_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.full_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.handle)),     'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.location))), 'C');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_search_vector ON profiles;
DROP TRIGGER IF EXISTS profiles_search_vector_trigger ON profiles;
CREATE TRIGGER profiles_search_vector
  BEFORE INSERT OR UPDATE OF first_name, last_name, full_name, handle, location,
    city, region, region_code, country, country_code ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_search_vector_update();
CREATE INDEX IF NOT EXISTS idx_profiles_search ON profiles USING GIN (search_vector);

-- ── clubs.search_vector ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clubs_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.description)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.location))), 'C');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clubs_search_vector ON clubs;
DROP TRIGGER IF EXISTS clubs_search_vector_trigger ON clubs;
CREATE TRIGGER clubs_search_vector
  BEFORE INSERT OR UPDATE OF name, description, location, city, region, region_code, country, country_code ON clubs
  FOR EACH ROW EXECUTE FUNCTION public.clubs_search_vector_update();
CREATE INDEX IF NOT EXISTS idx_clubs_search ON clubs USING GIN (search_vector);

-- ── Backfill from free-text location ("City, ST" · "City, Country" · "City") ─
-- p1 = the city part, p2 = whatever follows the first comma. With a p2, the
-- place must match it (region name/code or country name/code); without one,
-- the city name must be UNIQUE in `places` — a bare "Springfield" stays
-- free text rather than becoming a guess. Never overwrites a user-picked
-- place (location_source = 'user').
CREATE OR REPLACE FUNCTION public.backfill_places_from_text(p_table regclass)
RETURNS int
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE n int;
BEGIN
  EXECUTE format($f$
    WITH parsed AS (
      SELECT t.id,
             public.search_normalize(btrim(split_part(t.location, ',', 1))) AS p1,
             public.search_normalize(btrim(split_part(t.location, ',', 2))) AS p2
      FROM %1$s t
      WHERE t.location IS NOT NULL AND btrim(t.location) <> ''
        AND (t.location_source IS NULL OR t.location_source <> 'user')
    ),
    cand AS (
      SELECT pr.id AS entity_id, pl.id AS place_id, pr.p2,
             (pr.p2 <> '' AND (
                public.search_normalize(pl.region) = pr.p2 OR public.search_normalize(pl.region_code) = pr.p2 OR
                public.search_normalize(pl.country) = pr.p2 OR public.search_normalize(pl.country_code) = pr.p2)) AS p2_match,
             count(*) OVER (PARTITION BY pr.id) AS n_cand,
             row_number() OVER (PARTITION BY pr.id ORDER BY
               (pr.p2 <> '' AND (
                public.search_normalize(pl.region) = pr.p2 OR public.search_normalize(pl.region_code) = pr.p2 OR
                public.search_normalize(pl.country) = pr.p2 OR public.search_normalize(pl.country_code) = pr.p2)) DESC,
               pl.population DESC NULLS LAST) AS rn
      FROM parsed pr
      JOIN places pl ON pr.p1 <> '' AND (public.search_normalize(pl.name) = pr.p1 OR public.search_normalize(pl.ascii_name) = pr.p1)
    ),
    chosen AS (
      SELECT c.entity_id, c.place_id FROM cand c
      WHERE c.rn = 1 AND ((c.p2 <> '' AND c.p2_match) OR (c.p2 = '' AND c.n_cand = 1))
    )
    UPDATE %1$s t SET
      place_id = ch.place_id,
      city = f.city, region = f.region, region_code = f.region_code,
      country = f.country, country_code = f.country_code, lat = f.lat, lng = f.lng,
      location_source = 'backfill'
    FROM chosen ch, LATERAL public.place_fields(ch.place_id) f
    WHERE t.id = ch.entity_id AND t.place_id IS DISTINCT FROM ch.place_id
  $f$, p_table);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.backfill_places_from_text(regclass) FROM PUBLIC, anon, authenticated;

SELECT public.backfill_places_from_text('profiles') AS profiles_backfilled,
       public.backfill_places_from_text('clubs')    AS clubs_backfilled;

-- Recompute vectors for rows the backfill didn't touch (the trigger covered
-- the touched ones). Bulk UPDATE; updated_at bumps once — reference data.
UPDATE profiles SET search_vector =
  setweight(to_tsvector('simple', public.search_normalize(first_name)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(last_name)),  'A') ||
  setweight(to_tsvector('simple', public.search_normalize(full_name)),  'A') ||
  setweight(to_tsvector('simple', public.search_normalize(handle)),     'B') ||
  setweight(to_tsvector('simple', public.search_normalize(
    concat_ws(' ', city, region, region_code, country, country_code, location))), 'C')
WHERE search_vector IS NULL OR location_source IS DISTINCT FROM 'backfill';
UPDATE clubs SET search_vector =
  setweight(to_tsvector('simple', public.search_normalize(name)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(description)), 'B') ||
  setweight(to_tsvector('simple', public.search_normalize(
    concat_ws(' ', city, region, region_code, country, country_code, location))), 'C')
WHERE search_vector IS NULL OR location_source IS DISTINCT FROM 'backfill';

-- ── search_people: 087's ladder + a location tier + the location parameters ─
DROP FUNCTION IF EXISTS public.search_people(TEXT, UUID[], BOOLEAN, INT, BOOLEAN, UUID);

CREATE FUNCTION public.search_people(
  search_term    TEXT,
  visible_ids    UUID[] DEFAULT '{}',
  include_public BOOLEAN DEFAULT TRUE,
  max_results    INT DEFAULT 20,
  require_handle BOOLEAN DEFAULT FALSE,
  exclude_id     UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_region_code  TEXT DEFAULT NULL,
  p_near_lat     FLOAT8 DEFAULT NULL,
  p_near_lng     FLOAT8 DEFAULT NULL,
  p_radius_km    FLOAT8 DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  handle      TEXT,
  first_name  TEXT,
  middle_name TEXT,
  last_name   TEXT,
  full_name   TEXT,
  avatar_url  TEXT,
  location    TEXT,
  sport       TEXT,
  school      TEXT,
  visibility  TEXT,
  city        TEXT,
  region      TEXT,
  region_code TEXT,
  country     TEXT,
  country_code TEXT,
  distance_km FLOAT8,
  match_rank  INT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  q        TEXT;
  q_c      TEXT;
  v_lo     TEXT;
  v_hi     TEXT;
  esc      TEXT;
  infix    TEXT;
  wordpre  TEXT;
  is_short BOOLEAN;
  tsq      TSQUERY;
  near     BOOLEAN := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   FLOAT8  := COALESCE(p_radius_km, 50);
  filtered BOOLEAN := p_country_code IS NOT NULL OR p_region_code IS NOT NULL
                      OR (p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL);
  dlat     FLOAT8;
  dlng     FLOAT8;
BEGIN
  q := lower(btrim(ltrim(btrim(COALESCE(search_term, '')), '@')));
  -- An empty query is allowed ONLY as a filtered browse (Explore: "athletes
  -- in Ontario"); unfiltered it returns nothing, as in 087.
  IF q = '' AND NOT filtered THEN
    RETURN;
  END IF;

  q_c  := q COLLATE "C";
  v_lo := q_c;
  v_hi := (q || chr(1114111)) COLLATE "C";
  esc     := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  infix   := '%' || esc || '%';
  wordpre := '% ' || esc || '%';
  is_short := length(q) < 3;
  tsq  := public.search_prefix_tsquery(q);
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));

  RETURN QUERY
  SELECT
    p.id, p.handle, p.first_name, p.middle_name, p.last_name, p.full_name,
    p.avatar_url, p.location, p.sport, p.school, p.visibility,
    p.city, p.region, p.region_code, p.country, p.country_code,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END AS distance_km,
    (CASE
       WHEN q = ''                                                    THEN 5
       WHEN (lower(p.handle) COLLATE "C") = q_c                       THEN 0
       WHEN (lower(p.handle) COLLATE "C") >= v_lo
        AND (lower(p.handle) COLLATE "C") <  v_hi                     THEN 1
       WHEN ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi)
         OR ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi)
         OR ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi)
                                                                      THEN 2
       WHEN lower(p.full_name)  LIKE wordpre
         OR lower(p.last_name)  LIKE wordpre
         OR lower(p.first_name) LIKE wordpre                          THEN 3
       WHEN NOT is_short AND (
            lower(p.handle)     LIKE infix OR lower(p.first_name) LIKE infix OR
            lower(p.last_name)  LIKE infix OR lower(p.full_name)  LIKE infix) THEN 4
       -- Location tier: every token of the query matches somewhere in the
       -- profile's vector (city, region, country, free-text location, or a
       -- name token mixed in: "sarah ottawa"). Always below name tiers.
       ELSE 5
     END)::INT AS match_rank
  FROM public.profiles p
  WHERE
    ((include_public AND p.visibility = 'public') OR p.id = ANY(visible_ids))
    AND (NOT require_handle OR p.handle IS NOT NULL)
    AND (exclude_id IS NULL OR p.id <> exclude_id)
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR p.region_code = upper(p_region_code))
    AND (NOT near OR (p.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND p.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (
      q = '' OR
      ((lower(p.handle)     COLLATE "C") >= v_lo AND (lower(p.handle)     COLLATE "C") < v_hi) OR
      ((lower(p.first_name) COLLATE "C") >= v_lo AND (lower(p.first_name) COLLATE "C") < v_hi) OR
      ((lower(p.last_name)  COLLATE "C") >= v_lo AND (lower(p.last_name)  COLLATE "C") < v_hi) OR
      ((lower(p.full_name)  COLLATE "C") >= v_lo AND (lower(p.full_name)  COLLATE "C") < v_hi) OR
      (NOT is_short AND (
        lower(p.handle)     LIKE infix OR
        lower(p.first_name) LIKE infix OR
        lower(p.last_name)  LIKE infix OR
        lower(p.full_name)  LIKE infix
      )) OR
      (tsq IS NOT NULL AND p.search_vector @@ tsq)
    )
  ORDER BY
    match_rank,
    CASE WHEN near AND q = '' THEN public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) END ASC NULLS LAST,
    length(COALESCE(p.full_name, p.handle, '')),
    COALESCE(p.full_name, p.handle, ''),
    p.id
  LIMIT GREATEST(COALESCE(max_results, 20), 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_people(TEXT, UUID[], BOOLEAN, INT, BOOLEAN, UUID, TEXT, TEXT, FLOAT8, FLOAT8, FLOAT8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_people(TEXT, UUID[], BOOLEAN, INT, BOOLEAN, UUID, TEXT, TEXT, FLOAT8, FLOAT8, FLOAT8)
  TO service_role;
COMMENT ON FUNCTION public.search_people IS
  'Ranked people search with location tier + filters (108). Privacy is the CALLER''s job. Service-role only.';

-- ── search_clubs on the contract (replaces the legacy websearch version) ────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_clubs'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE FUNCTION public.search_clubs(
  q text,
  max_results int DEFAULT 20,
  p_country_code text DEFAULT NULL,
  p_region_code text DEFAULT NULL,
  p_near_lat float8 DEFAULT NULL,
  p_near_lng float8 DEFAULT NULL,
  p_radius_km float8 DEFAULT NULL
)
RETURNS TABLE (
  id uuid, name text, description text, location text,
  city text, region text, region_code text, country text, country_code text,
  lat float8, lng float8, distance_km float8, match_rank int
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
  SELECT c.id, c.name, c.description, c.location,
    c.city, c.region, c.region_code, c.country, c.country_code, c.lat, c.lng,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS distance_km,
    CASE
      WHEN qn = '' THEN 3
      WHEN public.search_normalize(c.name) = qn THEN 0
      WHEN public.search_normalize(c.name) LIKE qn || '%' THEN 1
      WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(c.name)) @@ tsq THEN 2
      ELSE 3
    END AS match_rank
  FROM clubs c
  WHERE (p_country_code IS NULL OR c.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
    AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (qn = '' OR (tsq IS NOT NULL AND c.search_vector @@ tsq)
         OR (length(qn) >= 2 AND (c.name ILIKE '%' || qn || '%' OR c.location ILIKE '%' || qn || '%')))
  ORDER BY 13,
    CASE WHEN near AND qn = '' THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END ASC NULLS LAST,
    CASE WHEN tsq IS NOT NULL THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(c.name)), q) ELSE 0 END DESC,
    c.name
  LIMIT lim;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_clubs(text, int, text, text, float8, float8, float8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_clubs(text, int, text, text, float8, float8, float8)
  TO service_role;

-- ── Check grid (re-runnable; every row must say true) ───────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'place_id') AS profiles_cols,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clubs' AND column_name = 'search_vector') AS clubs_cols,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_people') = 1 AS one_search_people,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_clubs') = 1 AS one_search_clubs,
  NOT has_function_privilege('anon', 'public.search_people(text, uuid[], boolean, int, boolean, uuid, text, text, float8, float8, float8)', 'EXECUTE') AS people_anon_revoked,
  NOT has_function_privilege('anon', 'public.search_clubs(text, int, text, text, float8, float8, float8)', 'EXECUTE') AS clubs_anon_revoked,
  (SELECT count(*) FROM profiles WHERE search_vector IS NULL) = 0 AS profile_vectors_filled,
  (SELECT count(*) FROM profiles WHERE place_id IS NOT NULL) AS profiles_with_place,
  (SELECT count(*) FROM profiles WHERE location IS NOT NULL AND btrim(location) <> '') AS profiles_with_text_location;

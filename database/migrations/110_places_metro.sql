-- ============================================================================
-- 110: admin2 + metro — "ottawa" includes Kanata, Nepean, Orléans, Gatineau
-- ============================================================================
-- After 104–109, "ottawa" found the 20 courses whose city IS Ottawa: the
-- suburbs are their own GeoNames places. Tom: resolve it everywhere, not
-- just Ottawa. Two data-driven facts do that globally:
--
--   admin2  — GeoNames' county / census division / district for the place
--             (Kanata, Nepean and Orléans all sit in the "Ottawa" division;
--             Mississauga in "Peel"; Oakland in "Alameda County"). Seeded
--             from admin2Codes.txt by the places seed script.
--   metro   — computed here: the LARGEST place within 40 km whose
--             population is at least max(100k, 2× the place's own). Gatineau
--             (300k, admin2 "Outaouais") → Ottawa (1.0M); Mississauga (718k)
--             → Toronto (2.8M); Kanata → Ottawa. A place that is itself
--             100k+ with nothing twice its size nearby is its own metro.
--             Oakland (419k) stays its own metro next to San Francisco
--             (874k) — the 2× rule is what stops Fort Worth folding into
--             Dallas.
--
-- Entities don't get new columns: their search vectors pull admin2 + metro
-- through place_id at weight D, so a city-proper match (city, weight C)
-- still outscores a suburb match. Re-runnable: run once (metro computes
-- from the already-seeded coordinates), re-seed places with admin2, run
-- again (the vector recompute at the end picks admin2 up).
-- ============================================================================

ALTER TABLE places ADD COLUMN IF NOT EXISTS admin2 text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS admin2_code text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS metro text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS metro_geonames_id integer;
CREATE INDEX IF NOT EXISTS idx_places_population ON places (population DESC NULLS LAST);

-- ── Metro: largest qualifying city within 40 km ─────────────────────────────
WITH cand AS (
  SELECT p.geonames_id AS pid, m.name AS metro, m.geonames_id AS mid
  FROM places p
  CROSS JOIN LATERAL (
    SELECT m.name, m.geonames_id
    FROM places m
    WHERE m.geonames_id <> p.geonames_id
      AND m.population >= GREATEST(100000, 2 * COALESCE(p.population, 0))
      AND m.lat BETWEEN p.lat - 0.36 AND p.lat + 0.36
      AND m.lng BETWEEN p.lng - 0.36 / GREATEST(cos(radians(p.lat)), 0.1)
                    AND p.lng + 0.36 / GREATEST(cos(radians(p.lat)), 0.1)
      AND public.haversine_km(p.lat, p.lng, m.lat, m.lng) <= 40
    ORDER BY m.population DESC
    LIMIT 1
  ) m
)
UPDATE places p SET metro = c.metro, metro_geonames_id = c.mid
FROM cand c
WHERE c.pid = p.geonames_id
  AND (p.metro IS DISTINCT FROM c.metro OR p.metro_geonames_id IS DISTINCT FROM c.mid);

-- A 100k+ city with nothing twice its size nearby anchors its own metro.
UPDATE places SET metro = name, metro_geonames_id = geonames_id
WHERE metro IS NULL AND population >= 100000;

-- ── Entity search vectors: + admin2 + metro through place_id (weight D) ────
CREATE OR REPLACE FUNCTION public.place_context(p_place_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT concat_ws(' ', p.admin2, p.metro) FROM places p WHERE p.id = p_place_id
$$;

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
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code,
                public.place_context(NEW.place_id)))), 'D');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS golf_courses_search_vector ON golf_courses;
CREATE TRIGGER golf_courses_search_vector
  BEFORE INSERT OR UPDATE OF name, club_name, city, region, region_code, country, country_code, place_id ON golf_courses
  FOR EACH ROW EXECUTE FUNCTION public.golf_courses_search_vector_update();

CREATE OR REPLACE FUNCTION public.profiles_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.first_name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.last_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.full_name)),  'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.handle)),     'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_search_vector ON profiles;
CREATE TRIGGER profiles_search_vector
  BEFORE INSERT OR UPDATE OF first_name, last_name, full_name, handle, location,
    city, region, region_code, country, country_code, place_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_search_vector_update();

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
      concat_ws(' ', NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clubs_search_vector ON clubs;
CREATE TRIGGER clubs_search_vector
  BEFORE INSERT OR UPDATE OF name, description, location, city, region, region_code, country, country_code, place_id ON clubs
  FOR EACH ROW EXECUTE FUNCTION public.clubs_search_vector_update();

-- ── Recompute vectors for placed rows (bulk; updated_at bumps once) ─────────
UPDATE golf_courses c SET search_vector =
  setweight(to_tsvector('simple', public.search_normalize(c.name)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(c.club_name)), 'B') ||
  setweight(to_tsvector('simple', public.search_normalize(c.city)), 'C') ||
  setweight(to_tsvector('simple', public.search_normalize(
    concat_ws(' ', c.region, c.region_code, c.country, c.country_code, public.place_context(c.place_id)))), 'D')
WHERE c.place_id IS NOT NULL;
UPDATE profiles p SET search_vector =
  setweight(to_tsvector('simple', public.search_normalize(p.first_name)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(p.last_name)),  'A') ||
  setweight(to_tsvector('simple', public.search_normalize(p.full_name)),  'A') ||
  setweight(to_tsvector('simple', public.search_normalize(p.handle)),     'B') ||
  setweight(to_tsvector('simple', public.search_normalize(
    concat_ws(' ', p.city, p.region, p.region_code, p.country, p.country_code, p.location))), 'C') ||
  setweight(to_tsvector('simple', public.search_normalize(public.place_context(p.place_id))), 'D')
WHERE p.place_id IS NOT NULL;
UPDATE clubs c SET search_vector =
  setweight(to_tsvector('simple', public.search_normalize(c.name)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(c.description)), 'B') ||
  setweight(to_tsvector('simple', public.search_normalize(
    concat_ws(' ', c.city, c.region, c.region_code, c.country, c.country_code, c.location))), 'C') ||
  setweight(to_tsvector('simple', public.search_normalize(public.place_context(c.place_id))), 'D')
WHERE c.place_id IS NOT NULL;

-- ── Check grid (re-runnable; booleans true; counts informational) ───────────
SELECT
  (SELECT metro FROM places WHERE name = 'Kanata' AND country_code = 'CA' LIMIT 1) = 'Ottawa' AS kanata_metro_ottawa,
  (SELECT metro FROM places WHERE name = 'Gatineau' AND country_code = 'CA' LIMIT 1) = 'Ottawa' AS gatineau_metro_ottawa,
  (SELECT metro FROM places WHERE name = 'Mississauga' AND country_code = 'CA' LIMIT 1) = 'Toronto' AS mississauga_metro_toronto,
  (SELECT metro FROM places WHERE geonames_id = 5128581) = 'New York City' AS nyc_metro_self,
  (SELECT admin2 FROM places WHERE name = 'Nepean' AND country_code = 'CA' LIMIT 1) = 'Ottawa' AS nepean_admin2_ottawa,
  (SELECT count(*) FROM places WHERE admin2 IS NOT NULL) AS places_with_admin2,
  (SELECT count(*) FROM places WHERE metro IS NOT NULL) AS places_with_metro,
  (SELECT count(*) FROM golf_courses WHERE search_vector @@ to_tsquery('simple', 'ottawa:*')) AS courses_matching_ottawa;

-- ============================================================================
-- 109: place aliases — "New York, NY" finds New York City
-- ============================================================================
-- 108's free-text backfill matched on the place's exact name, so a club at
-- "New York, NY" stayed free text: GeoNames calls it "New York City". Its
-- `alternatenames` column carries what people actually type ("New York",
-- "NYC", "Nueva York", "Monreal"); this migration adds `place_aliases`,
-- makes the backfill and the place picker consult it, and re-runs the
-- backfills. Seeded by an ops script (src/lib/geo/aliases.ts holds the
-- selection rule); re-runnable — run once to create the table, seed, then
-- run again so the final backfill sees the aliases.
-- ============================================================================

CREATE TABLE IF NOT EXISTS place_aliases (
  geonames_id integer NOT NULL REFERENCES places(geonames_id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_norm text NOT NULL, -- search_normalize(alias), stored for the index
  PRIMARY KEY (geonames_id, alias_norm)
);
CREATE INDEX IF NOT EXISTS idx_place_aliases_norm ON place_aliases (alias_norm text_pattern_ops);
ALTER TABLE place_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Place aliases are viewable by everyone" ON place_aliases;
CREATE POLICY "Place aliases are viewable by everyone" ON place_aliases FOR SELECT USING (true);

-- Exact-name lookups on places were sequential scans per profile; fine for
-- a handful of rows, not for a backfill of thousands. search_normalize is
-- IMMUTABLE (104), so it can be indexed.
CREATE INDEX IF NOT EXISTS idx_places_name_norm ON places ((public.search_normalize(name)));
CREATE INDEX IF NOT EXISTS idx_places_ascii_norm ON places ((public.search_normalize(ascii_name)));

-- ── Backfill: name, ASCII name, OR alias ────────────────────────────────────
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
      JOIN LATERAL (
        SELECT pl.* FROM places pl
        WHERE public.search_normalize(pl.name) = pr.p1 OR public.search_normalize(pl.ascii_name) = pr.p1
        UNION
        SELECT pl.* FROM places pl
        JOIN place_aliases a ON a.geonames_id = pl.geonames_id
        WHERE a.alias_norm = pr.p1
      ) pl ON pr.p1 <> ''
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

-- ── search_places: aliases as a third tier ("nyc" → New York City) ──────────
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
         WHEN EXISTS (SELECT 1 FROM place_aliases a WHERE a.geonames_id = p.geonames_id AND a.alias_norm LIKE qn || '%') THEN 2
         ELSE 3 END AS match_rank
  FROM places p
  WHERE (p.search_vector @@ tsq
         OR EXISTS (SELECT 1 FROM place_aliases a WHERE a.geonames_id = p.geonames_id AND a.alias_norm LIKE qn || '%'))
    AND (p_country_code IS NULL OR p.country_code = upper(p_country_code))
  ORDER BY 10, p.population DESC NULLS LAST, p.name
  LIMIT lim;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_places(text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_places(text, int, text) TO service_role;

-- ── Re-run the backfills (no-ops until the alias seed has landed) ────────────
SELECT public.backfill_places_from_text('profiles') AS profiles_backfilled,
       public.backfill_places_from_text('clubs')    AS clubs_backfilled;

-- ── Check grid (re-runnable; booleans must say true; counts are informational) ─
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'place_aliases') AS tbl_aliases,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_places_name_norm') AS idx_name_norm,
  NOT has_function_privilege('anon', 'public.search_places(text, int, text)', 'EXECUTE') AS places_anon_revoked,
  (SELECT count(*) FROM place_aliases) AS aliases_seeded,
  (SELECT count(*) FROM clubs WHERE place_id IS NOT NULL) AS clubs_with_place,
  (SELECT count(*) FROM clubs WHERE location IS NOT NULL AND btrim(location) <> '') AS clubs_with_text_location;

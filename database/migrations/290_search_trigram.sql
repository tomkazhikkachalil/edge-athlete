-- 290 — search lever 4b: a trigram index serves the substring arm (the
-- leftovers program PR 6, Oct 28 2026). After 279 the floor of search_all
-- was the substring arm's full scan — five ILIKE '%q%' columns over every
-- document (a rare term: ~180 ms at 53k documents; docs/SEARCH.md). pg_trgm
-- is installed (schema `extensions`, 087 / 257) but search_documents had no
-- trigram index.
--
-- Two GIN trigram indexes — title, subtitle — and ONE change in search_all
-- (274/279's body otherwise verbatim, same signature, one overload): the
-- substring arm is title / subtitle at THREE or more characters. City,
-- region and country are already tokens in search_vector (the prefix
-- tsquery finds "ott" → Ottawa); a trigram index serves patterns of three
-- characters or more (087's note), so a two-character query keeps the
-- tsquery path alone. The trade-off, by design and enumerated in
-- database/tests/diagnostics/verify-290-search.sql: a mid-word substring of
-- a city / region / country ("tawa") and a two-character mid-word substring
-- of a title no longer match — the prefix and token paths are unchanged.
--
-- Plain CREATE INDEX inline (255 / 278's reasoning: the editor runs the file
-- as one transaction; 53k rows build in well under a second). Deploy order:
-- MIGRATION FIRST — there is no code change; the route reads the same
-- function. Reversal: re-run 279's body and DROP the two indexes.

CREATE INDEX IF NOT EXISTS idx_search_documents_title_trgm
  ON public.search_documents USING gin (title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_documents_subtitle_trgm
  ON public.search_documents USING gin (subtitle extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_all(
  q text,
  p_types text[] DEFAULT NULL,
  max_per_type int DEFAULT 20,
  visible_ids uuid[] DEFAULT '{}',
  include_public boolean DEFAULT TRUE,
  p_country_code text DEFAULT NULL,
  p_region_code text DEFAULT NULL,
  p_near_lat float8 DEFAULT NULL,
  p_near_lng float8 DEFAULT NULL,
  p_radius_km float8 DEFAULT NULL
)
RETURNS TABLE (
  entity_type text, entity_id uuid, title text, subtitle text, sport_key text,
  city text, region text, region_code text, country text, country_code text,
  place_id uuid, lat float8, lng float8, distance_km float8, match_rank int
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  qn       text    := public.search_normalize(q);
  tsq      tsquery := public.search_prefix_tsquery(q);
  -- 274: the query's token tsqueries, parsed ONCE per call (search_token_hits /
  -- search_token_rank parsed them per row).
  tqs      tsquery[] := ARRAY(SELECT to_tsquery('simple', t || ':*') FROM unnest(public.search_query_tokens(q)) AS t);
  per      int     := GREATEST(COALESCE(max_per_type, 20), 1);
  -- 279: the candidate cap per entity_type — see 279's header.
  cap      int     := 1000;
  near     boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   float8  := COALESCE(p_radius_km, 50);
  filtered boolean;
  dlat     float8;
  dlng     float8;
BEGIN
  filtered := p_country_code IS NOT NULL OR p_region_code IS NOT NULL OR near;
  IF qn = '' AND NOT filtered THEN RETURN; END IF;
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT d.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, d.lat, d.lng) END AS dist
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      AND ( (d.visibility = 'public' AND (d.entity_type <> 'athlete' OR include_public))
            OR (d.owner_id IS NOT NULL AND d.owner_id = ANY(visible_ids)) )
      AND (p_country_code IS NULL OR d.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR d.region_code = upper(p_region_code))
      AND (NOT near OR (d.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                    AND d.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
  ),
  matched0 AS MATERIALIZED (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN b.title_norm = qn THEN 0
        WHEN b.title_norm LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND b.title_vector @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       -- 290: the substring arm is title / subtitle at THREE or more characters —
       -- the length a trigram index can serve (087's note); city / region /
       -- country are tokens in search_vector already and a 2-character query
       -- keeps the prefix tsquery path.
       OR (length(qn) >= 3 AND (
            b.title ILIKE '%' || qn || '%' OR b.subtitle ILIKE '%' || qn || '%'))
  ),
  -- 279: at most `cap` candidates per (entity_type, tier), chosen by the
  -- ranking's own next keys (rich, recency) — the per-row name_hits / score
  -- below then run over at most a few thousand rows, never the whole match.
  -- A LATERAL top-N per group, not a window over every row: ORDER BY … LIMIT
  -- is a bounded heap sort (no disk spill at 50k rows — the window version
  -- sorted 52k rows through an external merge, 150 ms of the 250).
  groups AS (SELECT DISTINCT m0.entity_type FROM matched0 m0),
  capped AS (
    SELECT c.*
    FROM groups g
    CROSS JOIN LATERAL (
      SELECT m0.* FROM matched0 m0
      WHERE m0.entity_type = g.entity_type
      ORDER BY m0.tier,
               CASE WHEN near AND qn = '' THEN m0.dist END ASC NULLS LAST,
               m0.rich DESC, m0.recency DESC NULLS LAST, m0.updated_at DESC, m0.entity_id
      LIMIT cap
    ) c
  ),
  matched AS (
    SELECT c.*,
      CASE WHEN tsq IS NOT NULL
           THEN (SELECT count(*)::int FROM unnest(tqs) AS tq WHERE c.title_vector @@ tq)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL
           THEN (SELECT COALESCE(sum(ts_rank(c.search_vector, tq)), 0)::real FROM unnest(tqs) AS tq)
           ELSE 0 END AS score
    FROM capped c
  ),
  ranked AS (
    SELECT m.*, ROW_NUMBER() OVER (
      PARTITION BY m.entity_type
      ORDER BY
        m.tier,
        CASE WHEN near AND qn = '' THEN m.dist END ASC NULLS LAST,
        m.name_hits DESC,
        m.rich DESC,
        m.recency DESC NULLS LAST,
        m.score DESC,
        m.dist ASC NULLS LAST,
        m.title
    ) AS rn
    FROM matched m
  )
  SELECT r.entity_type, r.entity_id, r.title, r.subtitle, r.sport_key,
    r.city, r.region, r.region_code, r.country, r.country_code,
    r.place_id, r.lat, r.lng, r.dist, r.tier
  FROM ranked r
  WHERE r.rn <= per
  ORDER BY
    r.tier,
    CASE WHEN near AND qn = '' THEN r.dist END ASC NULLS LAST,
    r.name_hits DESC,
    r.rich DESC,
    r.recency DESC NULLS LAST,
    r.score DESC,
    r.dist ASC NULLS LAST,
    r.title;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)
  TO service_role;
COMMENT ON FUNCTION public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8) IS
  'Unified entity search over search_documents. Privacy is the CALLER''s job: pass the viewer''s audience via visible_ids/include_public (athletes) and filter post authors route-side. 274: stored title_norm / title_vector, token tsqueries parsed once. 279: at most 1,000 candidates per entity_type before the per-row ranking. 290: the substring arm is title / subtitle at 3+ characters, served by trigram indexes.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (290, '290_search_trigram.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 290 APPLIED | 2 | 1 | true | 290
SELECT '290 APPLIED' AS result,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'search_documents' AND indexname IN ('idx_search_documents_title_trgm', 'idx_search_documents_subtitle_trgm')) AS trigram_indexes_expect_2,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'search_all') AS search_all_overloads_expect_1,
       (SELECT prosrc LIKE '%length(qn) >= 3 AND (%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'search_all') AS narrowed_arm_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_290;

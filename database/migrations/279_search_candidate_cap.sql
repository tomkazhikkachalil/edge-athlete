-- 279 — search_all ranks a BOUNDED candidate set (hole 2b, Oct 26 2026 —
-- post-audit refinements, item 4; docs/SCALE_AUDIT.md §6 Oct 26, docs/SEARCH.md).
--
-- The number that decided it: at 53,051 documents on staging, `search_all('se')`
-- took 500 ms and `search_all('seed')` 557 ms AFTER 274 — a token every
-- document matches is 50,044 rows through the per-row ranking columns
-- (name_hits, score) at ~0.011 ms each. The order is tier → name hits →
-- rich → recency → score → distance → title, so a cut must respect it.
--
-- The cut: after the cheap tier is known, keep at most `cap` (1,000) rows per
-- entity_type, chosen by the ranking's own keys around name_hits — tier,
-- (distance for the near browse), rich DESC, recency DESC NULLS LAST (then
-- updated_at, entity_id for a stable cut) — as a bounded top-N per type (a
-- LATERAL ORDER BY … LIMIT: a heap sort, no disk spill; a window over every
-- row sorted 52k rows through an external merge). name_hits and score are
-- computed for the kept rows only. Because tier leads the cut as it leads
-- the final order, every tier-0/1/2 row is kept ahead of any tier-3 row; the
-- final ORDER BY, RETURNS, signature, grants are unchanged.
--
-- The trade-off, recorded: within ONE type with MORE than 1,000 matches, a
-- row can be left out that would have ranked above a kept one only through
-- name_hits (a multi-token query hitting its title with more tokens than a
-- newer row of the same tier) or through score after an exact tie on rich
-- and recency — a row ranked past the first thousand of its type. Proof: the nine captured lists at 53k
-- documents before and after (database/provenance/explain/2026-10-26/
-- search-results-{before,after}-279.json via scripts/search-capture.mjs).
--
-- Same signature (the overload trap), RETURNS, SECURITY INVOKER,
-- search_path; grants and COMMENT restated. search_all_facets untouched.

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
  -- 279: the candidate cap per (entity_type, tier) — see the header.
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
       OR (length(qn) >= 2 AND (
            b.title ILIKE '%' || qn || '%' OR b.subtitle ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
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
  'Unified entity search over search_documents. Privacy is the CALLER''s job: pass the viewer''s audience via visible_ids/include_public (athletes) and filter post authors route-side. 274: stored title_norm / title_vector, token tsqueries parsed once. 279: at most 1,000 candidates per entity_type chosen by tier, rich and recency before the per-row ranking; same order among the kept rows.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (279, '279_search_candidate_cap.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 279 APPLIED | 1 | true | 279
SELECT '279 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc WHERE proname = 'search_all') AS search_all_overloads_expect_1,
       (SELECT prosrc LIKE '%cap      int     := 1000;%' FROM pg_proc WHERE proname = 'search_all') AS capped_body_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_279;

-- verify-279-search.sql — 274's search_all (as a temp function) and 279's run side by side at the SAME instant; every list identical is the expected row (a difference is the recorded trade-off, visible only past 1,000 matches of one type).
BEGIN;
CREATE FUNCTION pg_temp.search_all_v274(
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
  matched AS (
    SELECT b.*,
      CASE
        WHEN qn = '' THEN 3
        WHEN b.title_norm = qn THEN 0
        WHEN b.title_norm LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND b.title_vector @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL
           THEN (SELECT count(*)::int FROM unnest(tqs) AS tq WHERE b.title_vector @@ tq)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL
           THEN (SELECT COALESCE(sum(ts_rank(b.search_vector, tq)), 0)::real FROM unnest(tqs) AS tq)
           ELSE 0 END AS score
    FROM base b
    WHERE qn = ''
       OR (tsq IS NOT NULL AND b.search_vector @@ tsq)
       OR (length(qn) >= 2 AND (
            b.title ILIKE '%' || qn || '%' OR b.subtitle ILIKE '%' || qn || '%'
         OR b.city ILIKE '%' || qn || '%' OR b.region ILIKE '%' || qn || '%'
         OR b.country ILIKE '%' || qn || '%'))
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

SELECT 'common_prefix' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('seed', NULL, 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('seed', NULL, 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('seed', NULL, 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('seed', NULL, 20, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'two_letters' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('se', NULL, 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('se', NULL, 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('se', NULL, 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('se', NULL, 20, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'rare_term' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('seed-0042', NULL, 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('seed-0042', NULL, 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('seed-0042', NULL, 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('seed-0042', NULL, 20, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'edge' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('edge', NULL, 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('edge', NULL, 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('edge', NULL, 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('edge', NULL, 20, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'ottawa' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('ottawa', NULL, 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('ottawa', NULL, 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('ottawa', NULL, 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('ottawa', NULL, 20, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'kanata_course' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('kanata golf', ARRAY['course'], 15, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('kanata golf', ARRAY['course'], 15, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('kanata golf', ARRAY['course'], 15, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('kanata golf', ARRAY['course'], 15, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'near_browse_empty_q' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('', NULL, 20, '{}'::uuid[], true, NULL, NULL, 45.42, -75.69, 50)) AS n_274,
       (SELECT count(*) FROM public.search_all('', NULL, 20, '{}'::uuid[], true, NULL, NULL, 45.42, -75.69, 50)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('', NULL, 20, '{}'::uuid[], true, NULL, NULL, 45.42, -75.69, 50) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('', NULL, 20, '{}'::uuid[], true, NULL, NULL, 45.42, -75.69, 50) s) b) AS identical
UNION ALL
SELECT 'athletes_widen_100' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('seed', ARRAY['athlete'], 100, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('seed', ARRAY['athlete'], 100, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('seed', ARRAY['athlete'], 100, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('seed', ARRAY['athlete'], 100, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'accent_and_case' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('SEÉD', NULL, 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('SEÉD', NULL, 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('SEÉD', NULL, 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('SEÉD', NULL, 20, '{}'::uuid[], true) s) b) AS identical
UNION ALL
SELECT 'multi_token_posts' AS query,
       (SELECT count(*) FROM pg_temp.search_all_v274('seed post', ARRAY['post'], 20, '{}'::uuid[], true)) AS n_274,
       (SELECT count(*) FROM public.search_all('seed post', ARRAY['post'], 20, '{}'::uuid[], true)) AS n_279,
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM pg_temp.search_all_v274('seed post', ARRAY['post'], 20, '{}'::uuid[], true) s) a)
         IS NOT DISTINCT FROM
       (SELECT string_agg(entity_type || ':' || entity_id || ':' || match_rank, '|' ORDER BY ord) FROM (SELECT s.*, row_number() OVER () AS ord FROM public.search_all('seed post', ARRAY['post'], 20, '{}'::uuid[], true) s) b) AS identical;
ROLLBACK;

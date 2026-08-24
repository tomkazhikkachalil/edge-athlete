-- ============================================================================
-- 115: search_all_facets — rank facet kinds, cap each group
-- ============================================================================
-- Found by the first prod probe of the facet UI (#241): for a broad query
-- ("golf" matches ~17k documents) the RPC's GROUPING SETS emit thousands of
-- rows, ordered `facet, n DESC` — and alphabetically 'country' < 'region' <
-- 'sport' < 'type', so PostgREST's 1000-row response cap filled with
-- country/region rows and TRUNCATED the tiny type/sport groups off the end.
-- The ⌘K panel showed countries but no type counts. Small queries fit and
-- looked fine — a truncation bug that only shows at scale, again.
--
-- Fix, in the function so no client can get it wrong:
--   1. ORDER facet kinds by usefulness-per-row: type (≤5 rows) → sport (≤11)
--      → country (≤ ~200) → region. The cheap groups can never be pushed out.
--   2. Cap every facet group at 100 rows (ROW_NUMBER per facet) — no
--      dropdown wants more, and the whole response is now ≤ ~400 rows,
--      independent of any transport cap.
--
-- Same signature, CREATE OR REPLACE; grants re-issued (REPLACE preserves
-- them, but the convention is explicit). Run AFTER 112. Re-runnable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_all_facets(
  q text,
  p_types text[] DEFAULT NULL,
  visible_ids uuid[] DEFAULT '{}',
  include_public boolean DEFAULT TRUE,
  p_country_code text DEFAULT NULL,
  p_region_code text DEFAULT NULL
)
RETURNS TABLE (facet text, code text, label text, n bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  qn  text    := public.search_normalize(q);
  tsq tsquery := public.search_prefix_tsquery(q);
BEGIN
  RETURN QUERY
  WITH matched AS (
    SELECT d.*
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      AND ( (d.visibility = 'public' AND (d.entity_type <> 'athlete' OR include_public))
            OR (d.owner_id IS NOT NULL AND d.owner_id = ANY(visible_ids)) )
      AND (p_country_code IS NULL OR d.country_code = upper(p_country_code))
      AND (p_region_code IS NULL OR d.region_code = upper(p_region_code))
      AND (qn = ''
        OR (tsq IS NOT NULL AND d.search_vector @@ tsq)
        OR (length(qn) >= 2 AND (
             d.title ILIKE '%' || qn || '%' OR d.subtitle ILIKE '%' || qn || '%'
          OR d.city ILIKE '%' || qn || '%' OR d.region ILIKE '%' || qn || '%'
          OR d.country ILIKE '%' || qn || '%')))
  ),
  grouped AS (
    SELECT
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN 'type'
        WHEN GROUPING(m.sport_key) = 0 THEN 'sport'
        WHEN GROUPING(m.region_code) = 0 THEN 'region'
        ELSE 'country'
      END AS g_facet,
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN m.entity_type
        WHEN GROUPING(m.sport_key) = 0 THEN m.sport_key
        WHEN GROUPING(m.region_code) = 0 THEN m.region_code
        ELSE m.country_code
      END AS g_code,
      CASE
        WHEN GROUPING(m.entity_type) = 0 THEN m.entity_type
        WHEN GROUPING(m.sport_key) = 0 THEN m.sport_key
        WHEN GROUPING(m.region_code) = 0 THEN min(m.region)
        ELSE min(m.country)
      END AS g_label,
      count(*) AS g_n
    FROM matched m
    GROUP BY GROUPING SETS ((m.entity_type), (m.sport_key), (m.country_code, m.region_code), (m.country_code))
  ),
  ranked AS (
    SELECT g.g_facet, g.g_code, g.g_label, g.g_n,
      ROW_NUMBER() OVER (PARTITION BY g.g_facet ORDER BY g.g_n DESC, g.g_code) AS rn
    FROM grouped g
    WHERE g.g_code IS NOT NULL
  )
  SELECT r.g_facet, r.g_code, r.g_label, r.g_n
  FROM ranked r
  WHERE r.rn <= 100
  ORDER BY
    CASE r.g_facet WHEN 'type' THEN 0 WHEN 'sport' THEN 1 WHEN 'country' THEN 2 ELSE 3 END,
    r.g_n DESC,
    r.g_code;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_all_facets(text, text[], uuid[], boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_all_facets(text, text[], uuid[], boolean, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; every boolean must read true) ───────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_all_facets') = 1 AS one_facets_fn,
  NOT has_function_privilege('anon', 'public.search_all_facets(text, text[], uuid[], boolean, text, text)', 'EXECUTE') AS anon_revoked,
  has_function_privilege('service_role', 'public.search_all_facets(text, text[], uuid[], boolean, text, text)', 'EXECUTE') AS service_ok,
  -- The failure mode, reproduced: the FIRST row for the broadest query must
  -- be a 'type' row (it used to be truncated off the response's far end).
  (SELECT f.facet FROM public.search_all_facets('golf', NULL) f LIMIT 1) = 'type' AS type_rows_first,
  -- Every facet group bounded.
  (SELECT COALESCE(max(cnt), 0) FROM (
     SELECT count(*) AS cnt FROM public.search_all_facets('golf', NULL) f GROUP BY f.facet
   ) g) <= 100 AS groups_capped,
  (SELECT count(*) FROM public.search_all_facets('golf', NULL)) AS total_rows_info;

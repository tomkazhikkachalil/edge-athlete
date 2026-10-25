-- ============================================================================
-- 274: search ranks cheaply, in the SAME order (Oct 25 2026 — scale fix 2,
--      docs/SCALE_AUDIT.md hole 2). Runs on BOTH staging and prod; no code
--      change rides with it (the route calls search_all exactly as before).
-- ============================================================================
-- The seeded EXPLAIN pass (docs/SCALE_AUDIT.md §2.1): search_all('se') cost
-- 355 ms at 2,471 documents, search_all('seed') 478 ms. The WHERE over every
-- document was 1.4 ms; the per-row RANKING columns of the `matched` CTE were
-- the rest — search_normalize(title) two or three times (lower + unaccent),
-- to_tsvector('simple', …) twice, and search_token_hits / search_token_rank
-- each PARSING one tsquery per query token — for EVERY matched row, before the
-- window function keeps 20 per type. 0.15 ms per matched row: a two-letter
-- keystroke that matches most of a 50,000-document corpus is ~7 s of shared
-- CPU. Content-bound, user-count-independent.
--
-- What this does, with the ORDER UNCHANGED (tier → name hits → rich →
-- recency → score → distance → title; richness and recency sort BEFORE the
-- token score, so a rank-chosen candidate set could not be trusted — the
-- per-row work is made cheap instead):
--   1. search_documents gains `title_norm` (= search_normalize(title)) and
--      `title_vector` (= to_tsvector('simple', title_norm)), kept by ONE
--      BEFORE INSERT OR UPDATE trigger — the four sync functions (course,
--      athlete, post, org) upsert whole rows and need no change; the backfill
--      is an UPDATE that fires the trigger.
--   2. search_all (same signature, same RETURNS) reads the two columns and
--      parses the query's token tsqueries ONCE per call (an array), so each
--      matched row costs a few @@ operations — no unaccent, no tsvector
--      build, no tsquery parse. search_all_facets is untouched (no per-row
--      ranking there).
--   No index rides with this: neither column is a WHERE term today (the
--   ILIKE arm stays a scan — 0.37 ms at this size; the trigram GIN on
--   title is the later step if the arm ever shows in a plan).
--
-- Proof shape: the SAME nine queries' ordered (entity_type, entity_id,
-- match_rank) lists before and after — identical — are saved under
-- database/provenance/explain/2026-10-25/search-results-{before,after}-274.json;
-- EXPLAIN after. The check grid lives in database/tests/diagnostics/verify-274-search.sql.
--
-- Reversal: DROP TRIGGER search_documents_title_sync ON search_documents;
-- DROP FUNCTION search_documents_title_sync(); ALTER TABLE search_documents
-- DROP COLUMN title_vector, DROP COLUMN title_norm; re-run 112's search_all.
-- Re-runnable: every statement IF NOT EXISTS / OR REPLACE; the backfill is
-- idempotent; the ledger row is ON CONFLICT.
-- ============================================================================

DO $$
BEGIN
  IF (SELECT max(number) FROM public.schema_migrations) < 273 THEN
    RAISE EXCEPTION '274 needs the ledger at 273 first (head is %)', (SELECT max(number) FROM public.schema_migrations);
  END IF;
END $$;

-- ── 1. The two columns (one ADD COLUMN per statement — the live-schema reader rule)
ALTER TABLE public.search_documents ADD COLUMN IF NOT EXISTS title_norm text;
ALTER TABLE public.search_documents ADD COLUMN IF NOT EXISTS title_vector tsvector;

-- ── 2. The ONE trigger that keeps them (SECURITY DEFINER like the sync functions, 114; no API EXECUTE)
CREATE OR REPLACE FUNCTION public.search_documents_title_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.title_norm := public.search_normalize(NEW.title);
  NEW.title_vector := to_tsvector('simple', NEW.title_norm);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_documents_title_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS search_documents_title_sync ON public.search_documents;
CREATE TRIGGER search_documents_title_sync
  BEFORE INSERT OR UPDATE ON public.search_documents
  FOR EACH ROW EXECUTE FUNCTION public.search_documents_title_sync();

-- ── 3. Backfill (fires the trigger; per entity_type to keep each statement short)
UPDATE public.search_documents SET title = title WHERE entity_type = 'post' AND title_norm IS NULL;
UPDATE public.search_documents SET title = title WHERE entity_type = 'athlete' AND title_norm IS NULL;
UPDATE public.search_documents SET title = title WHERE entity_type NOT IN ('post', 'athlete') AND title_norm IS NULL;

-- ── 4. search_all — the same signature, RETURNS, grants and order; the cheap per-row columns
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
REVOKE EXECUTE ON FUNCTION public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)
  TO service_role;
COMMENT ON FUNCTION public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8) IS
  'Unified entity search over search_documents. Privacy is the CALLER''s job: pass the viewer''s audience via visible_ids/include_public (athletes) and filter post authors route-side. 274: ranks on the stored title_norm / title_vector and once-parsed token tsqueries — same order as 112, a fraction of the per-row cost.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (274, '274_search_documents_title_columns.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 274 APPLIED | 2 | 0 | 1 | true | 274
SELECT '274 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'search_documents' AND column_name IN ('title_norm', 'title_vector')) AS columns_expect_2,
       (SELECT count(*) FROM public.search_documents WHERE title_norm IS NULL OR title_vector IS NULL) AS unfilled_rows_expect_0,
       (SELECT count(*) FROM pg_proc WHERE proname = 'search_all') AS search_all_overloads_expect_1,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'search_documents_title_sync' AND NOT tgisinternal) AS trigger_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_274;

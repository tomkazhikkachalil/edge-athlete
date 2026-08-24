-- ============================================================================
-- 112: search_all — one document table over every searchable entity
-- ============================================================================
-- docs/SEARCH.md §"Toward search_all", now due: four entity types are
-- searchable (athletes, clubs, courses, posts), each through its own RPC and
-- three different route-side fallbacks. This migration adds the promised
-- `search_documents` table (one row per searchable entity, maintained by
-- per-entity AFTER triggers), a `search_all(q, p_types, …)` RPC on the shared
-- contract (search_normalize + simple config + per-token ranking — 107's
-- ladder), and `search_all_facets` for type/sport/country/region counts.
--
-- The headline win is POSTS: their only vector was an english-config one from
-- an unnumbered feature script — stemmed, stop-worded, WHOLE-WORD (the exact
-- trap 087 diagnosed for people), with `posts.tags` (which holds tagged
-- profile UUIDs, not text) indexed at weight B. Post documents get a fresh
-- `simple` vector over caption/hashtags/sport_key, so prefixes and stop-word
-- captions finally match. The legacy posts vector/trigger/RPC are left
-- untouched — the app's fallback path still uses them until 112 has run.
--
-- Privacy (deliberate, see DEVLOG):
--   * athlete docs carry visibility + owner_id; search_all filters them
--     in-query (visible_ids/include_public — search_people semantics), so the
--     LIMIT lands after privacy.
--   * post docs EXIST only while the post is public AND published (the
--     trigger deletes otherwise). Author-level privacy (private athlete,
--     accepted followers may still see) stays in the ROUTE, preserving
--     today's behavior exactly.
--   * club and course docs are always public.
--
-- Leagues later = drop/re-add the NAMED entity_type CHECK + one trigger pair
-- + a backfill. Nothing else changes.
--
-- Run AFTER 104–111. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

-- ── The table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_documents (
  entity_type   text NOT NULL
    CONSTRAINT search_documents_entity_type_check
    CHECK (entity_type IN ('athlete', 'club', 'course', 'post')),
  entity_id     uuid NOT NULL,
  title         text NOT NULL,          -- the ranking name; tiers 0/1/2 run on it
  subtitle      text,
  sport_key     text,                   -- courses 'golf', posts their sport_key; athletes NULL
                                        -- (profiles.sport is a display label — see SEARCH.md)
  owner_id      uuid,                   -- athlete: the profile; post: the author; else NULL
  visibility    text NOT NULL DEFAULT 'public',
  place_id      uuid REFERENCES places(id) ON DELETE SET NULL,
  city text, region text, region_code text, country text, country_code text,
  lat double precision, lng double precision,
  rich          boolean NOT NULL DEFAULT false,  -- the entity's own "has real data" rule
  recency       timestamptz,
  search_vector tsvector NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (entity_type, entity_id)
);

-- Service-role only: routes apply privacy themselves (087's rule).
ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON search_documents FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_search_documents_vector ON search_documents USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_search_documents_country_region ON search_documents (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_search_documents_lat ON search_documents (lat);
CREATE INDEX IF NOT EXISTS idx_search_documents_type ON search_documents (entity_type);
CREATE INDEX IF NOT EXISTS idx_search_documents_owner ON search_documents (owner_id) WHERE owner_id IS NOT NULL;

-- ── Shared delete trigger (polymorphic id → a trigger, not an FK) ────────────
CREATE OR REPLACE FUNCTION public.search_document_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM search_documents sd
  WHERE sd.entity_type = TG_ARGV[0] AND sd.entity_id = OLD.id;
  RETURN NULL;
END;
$$;

-- ── Course documents ─────────────────────────────────────────────────────────
-- Vector: reuse the entity's own (110's contract vector, place_context and
-- all). The UPDATE OF list therefore includes search_vector — `UPDATE OF`
-- fires on columns in the SET clause, so a future 110-style bulk vector
-- recompute propagates to documents for free.
CREATE OR REPLACE FUNCTION public.search_doc_sync_course()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('course', NEW.id, NEW.name, NEW.club_name, 'golf',
    NULL, 'public', NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code,
    NEW.lat, NEW.lng,
    (NEW.hole_data IS NOT NULL OR NEW.course_rating <> '{}'::jsonb),
    NEW.hydrated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS golf_courses_search_doc ON golf_courses;
CREATE TRIGGER golf_courses_search_doc
  AFTER INSERT OR UPDATE OF name, club_name, city, region, region_code, country,
    country_code, place_id, lat, lng, hole_data, course_rating, hydrated_at, search_vector
  ON golf_courses
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_course();
DROP TRIGGER IF EXISTS golf_courses_search_doc_delete ON golf_courses;
CREATE TRIGGER golf_courses_search_doc_delete
  AFTER DELETE ON golf_courses
  FOR EACH ROW EXECUTE FUNCTION public.search_document_delete('course');

-- ── Athlete documents ────────────────────────────────────────────────────────
-- Upserts ALWAYS (private athletes stay self-findable via visible_ids); a
-- profile with neither a name nor a handle has no searchable identity and its
-- document is removed.
CREATE OR REPLACE FUNCTION public.search_doc_sync_athlete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  t text := COALESCE(NULLIF(btrim(COALESCE(NEW.full_name, '')), ''), NEW.handle);
BEGIN
  IF t IS NULL THEN
    DELETE FROM search_documents sd WHERE sd.entity_type = 'athlete' AND sd.entity_id = NEW.id;
    RETURN NULL;
  END IF;
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('athlete', NEW.id, t, NEW.handle, NULL,
    NEW.id, COALESCE(NEW.visibility, 'public'), NEW.place_id, NEW.city, NEW.region, NEW.region_code,
    NEW.country, NEW.country_code, NEW.lat, NEW.lng,
    (NEW.handle IS NOT NULL AND NEW.avatar_url IS NOT NULL),
    NEW.updated_at, COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS profiles_search_doc ON profiles;
CREATE TRIGGER profiles_search_doc
  AFTER INSERT OR UPDATE OF first_name, last_name, full_name, handle, location,
    city, region, region_code, country, country_code, place_id, lat, lng,
    visibility, avatar_url, search_vector
  ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_athlete();
DROP TRIGGER IF EXISTS profiles_search_doc_delete ON profiles;
CREATE TRIGGER profiles_search_doc_delete
  AFTER DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.search_document_delete('athlete');

-- ── Club documents ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_doc_sync_club()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('club', NEW.id, NEW.name, left(NEW.description, 140), NULL,
    NULL, 'public', NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code,
    NEW.lat, NEW.lng, (NEW.description IS NOT NULL), NEW.updated_at,
    COALESCE(NEW.search_vector, ''::tsvector))
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS clubs_search_doc ON clubs;
CREATE TRIGGER clubs_search_doc
  AFTER INSERT OR UPDATE OF name, description, location, city, region, region_code,
    country, country_code, place_id, lat, lng, search_vector
  ON clubs
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_club();
DROP TRIGGER IF EXISTS clubs_search_doc_delete ON clubs;
CREATE TRIGGER clubs_search_doc_delete
  AFTER DELETE ON clubs
  FOR EACH ROW EXECUTE FUNCTION public.search_document_delete('club');

-- ── Post documents ───────────────────────────────────────────────────────────
-- A document exists only while the post is public AND published — unpublish
-- or privatize deletes it, so post docs need no in-query privacy.
-- Fresh `simple` vector: caption A, hashtags B, sport_key C. `posts.tags` is
-- EXCLUDED on purpose — it holds tagged profile UUIDs, not text (the legacy
-- english vector was indexing UUIDs at weight B).
-- Subtitle is the author's name at write time; display-only, staleness
-- accepted (the route hydrates real author rows for rendering anyway).
CREATE OR REPLACE FUNCTION public.search_doc_sync_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  t text;
  author text;
BEGIN
  IF NEW.visibility = 'public' AND NEW.status = 'published' THEN
    t := left(btrim(COALESCE(NEW.caption, '')), 140);
    IF t = '' THEN
      t := left(btrim(array_to_string(COALESCE(NEW.hashtags, '{}'), ' ')), 140);
    END IF;
    IF t = '' THEN
      -- Nothing searchable: no caption, no hashtags.
      DELETE FROM search_documents sd WHERE sd.entity_type = 'post' AND sd.entity_id = NEW.id;
      RETURN NULL;
    END IF;
    SELECT p.full_name INTO author FROM profiles p WHERE p.id = NEW.profile_id;
    INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
      owner_id, visibility, place_id, city, region, region_code, country, country_code,
      lat, lng, rich, recency, search_vector)
    VALUES ('post', NEW.id, t, author, NEW.sport_key,
      NEW.profile_id, 'public', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      false, NEW.created_at,
      setweight(to_tsvector('simple', public.search_normalize(NEW.caption)), 'A') ||
      setweight(to_tsvector('simple', public.search_normalize(array_to_string(COALESCE(NEW.hashtags, '{}'), ' '))), 'B') ||
      setweight(to_tsvector('simple', public.search_normalize(NEW.sport_key)), 'C'))
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
      owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility,
      rich = EXCLUDED.rich, recency = EXCLUDED.recency,
      search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());
  ELSE
    DELETE FROM search_documents sd WHERE sd.entity_type = 'post' AND sd.entity_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS posts_search_doc ON posts;
CREATE TRIGGER posts_search_doc
  AFTER INSERT OR UPDATE OF caption, hashtags, sport_key, visibility, status
  ON posts
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_post();
DROP TRIGGER IF EXISTS posts_search_doc_delete ON posts;
CREATE TRIGGER posts_search_doc_delete
  AFTER DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.search_document_delete('post');

-- ── Backfill (idempotent; writes touch ONLY search_documents) ────────────────
INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
  owner_id, visibility, place_id, city, region, region_code, country, country_code,
  lat, lng, rich, recency, search_vector)
SELECT 'course', c.id, c.name, c.club_name, 'golf',
  NULL, 'public', c.place_id, c.city, c.region, c.region_code, c.country, c.country_code,
  c.lat, c.lng,
  (c.hole_data IS NOT NULL OR c.course_rating <> '{}'::jsonb),
  c.hydrated_at, COALESCE(c.search_vector, ''::tsvector)
FROM golf_courses c
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
  owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
  city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
  country = EXCLUDED.country, country_code = EXCLUDED.country_code,
  lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
  search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());

INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
  owner_id, visibility, place_id, city, region, region_code, country, country_code,
  lat, lng, rich, recency, search_vector)
SELECT 'athlete', p.id,
  COALESCE(NULLIF(btrim(COALESCE(p.full_name, '')), ''), p.handle), p.handle, NULL,
  p.id, COALESCE(p.visibility, 'public'), p.place_id, p.city, p.region, p.region_code,
  p.country, p.country_code, p.lat, p.lng,
  (p.handle IS NOT NULL AND p.avatar_url IS NOT NULL),
  p.updated_at, COALESCE(p.search_vector, ''::tsvector)
FROM profiles p
WHERE COALESCE(NULLIF(btrim(COALESCE(p.full_name, '')), ''), p.handle) IS NOT NULL
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
  owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
  city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
  country = EXCLUDED.country, country_code = EXCLUDED.country_code,
  lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
  search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());

INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
  owner_id, visibility, place_id, city, region, region_code, country, country_code,
  lat, lng, rich, recency, search_vector)
SELECT 'club', cl.id, cl.name, left(cl.description, 140), NULL,
  NULL, 'public', cl.place_id, cl.city, cl.region, cl.region_code, cl.country, cl.country_code,
  cl.lat, cl.lng, (cl.description IS NOT NULL), cl.updated_at,
  COALESCE(cl.search_vector, ''::tsvector)
FROM clubs cl
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
  owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
  city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
  country = EXCLUDED.country, country_code = EXCLUDED.country_code,
  lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
  search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());

INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
  owner_id, visibility, place_id, city, region, region_code, country, country_code,
  lat, lng, rich, recency, search_vector)
SELECT 'post', po.id,
  COALESCE(NULLIF(left(btrim(COALESCE(po.caption, '')), 140), ''),
           left(btrim(array_to_string(COALESCE(po.hashtags, '{}'), ' ')), 140)),
  pr.full_name, po.sport_key,
  po.profile_id, 'public', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  false, po.created_at,
  setweight(to_tsvector('simple', public.search_normalize(po.caption)), 'A') ||
  setweight(to_tsvector('simple', public.search_normalize(array_to_string(COALESCE(po.hashtags, '{}'), ' '))), 'B') ||
  setweight(to_tsvector('simple', public.search_normalize(po.sport_key)), 'C')
FROM posts po
LEFT JOIN profiles pr ON pr.id = po.profile_id
WHERE po.visibility = 'public' AND po.status = 'published'
  AND COALESCE(NULLIF(left(btrim(COALESCE(po.caption, '')), 140), ''),
               NULLIF(left(btrim(array_to_string(COALESCE(po.hashtags, '{}'), ' ')), 140), '')) IS NOT NULL
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
  owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility,
  rich = EXCLUDED.rich, recency = EXCLUDED.recency,
  search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());

-- Convergence: remove documents whose source row is gone or no longer
-- eligible, so a re-run always lands on the exact live state.
DELETE FROM search_documents sd
WHERE sd.entity_type = 'course'
  AND NOT EXISTS (SELECT 1 FROM golf_courses c WHERE c.id = sd.entity_id);
DELETE FROM search_documents sd
WHERE sd.entity_type = 'athlete'
  AND NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = sd.entity_id
      AND COALESCE(NULLIF(btrim(COALESCE(p.full_name, '')), ''), p.handle) IS NOT NULL);
DELETE FROM search_documents sd
WHERE sd.entity_type = 'club'
  AND NOT EXISTS (SELECT 1 FROM clubs cl WHERE cl.id = sd.entity_id);
DELETE FROM search_documents sd
WHERE sd.entity_type = 'post'
  AND NOT EXISTS (
    SELECT 1 FROM posts po WHERE po.id = sd.entity_id
      AND po.visibility = 'public' AND po.status = 'published'
      AND COALESCE(NULLIF(left(btrim(COALESCE(po.caption, '')), 140), ''),
                   NULLIF(left(btrim(array_to_string(COALESCE(po.hashtags, '{}'), ' ')), 140), '')) IS NOT NULL);

-- ── search_all ───────────────────────────────────────────────────────────────
-- The contract params (docs/SEARCH.md) + p_types/max_per_type + the
-- search_people privacy pair. Per-token ranking only (107's lesson: plain
-- ts_rank scores term proximity for AND queries).
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
  per      int     := GREATEST(COALESCE(max_per_type, 20), 1);
  near     boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius   float8  := COALESCE(p_radius_km, 50);
  filtered boolean;
  dlat     float8;
  dlng     float8;
BEGIN
  filtered := p_country_code IS NOT NULL OR p_region_code IS NOT NULL OR near;
  -- An empty query is a filtered browse or nothing (search_people precedent).
  IF qn = '' AND NOT filtered THEN RETURN; END IF;
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  WITH base AS (
    SELECT d.*,
      CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, d.lat, d.lng) END AS dist
    FROM search_documents d
    WHERE (p_types IS NULL OR d.entity_type = ANY(p_types))
      -- Privacy: public docs pass (athletes only when include_public);
      -- everything else needs the owner in the caller's audience.
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
        WHEN public.search_normalize(b.title) = qn THEN 0
        WHEN public.search_normalize(b.title) LIKE qn || '%' THEN 1
        WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(b.title)) @@ tsq THEN 2
        WHEN tsq IS NOT NULL AND b.search_vector @@ tsq THEN 3
        ELSE 4
      END AS tier,
      CASE WHEN tsq IS NOT NULL
           THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(b.title)), q)
           ELSE 0 END AS name_hits,
      CASE WHEN tsq IS NOT NULL THEN public.search_token_rank(b.search_vector, q) ELSE 0 END AS score
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
  'Unified entity search over search_documents. Privacy is the CALLER''s job: pass the viewer''s audience via visible_ids/include_public (athletes) and filter post authors route-side.';

-- ── search_all_facets ────────────────────────────────────────────────────────
-- Counts by type / sport / country / region for the matched set. Exists for
-- the same reason as golf_course_location_facets: PostgREST cannot GROUP BY.
-- UI wiring is a later PR; the contract ships with the table.
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
  )
  SELECT g.g_facet, g.g_code, g.g_label, g.g_n
  FROM grouped g
  WHERE g.g_code IS NOT NULL
  ORDER BY g.g_facet, g.g_n DESC, g.g_code;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_all_facets(text, text[], uuid[], boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_all_facets(text, text[], uuid[], boolean, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'search_documents') AS table_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'search_documents') AS rls_on,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'search_documents' AND indexname = 'idx_search_documents_vector') AS gin_exists,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN (
    'golf_courses_search_doc', 'golf_courses_search_doc_delete',
    'profiles_search_doc', 'profiles_search_doc_delete',
    'clubs_search_doc', 'clubs_search_doc_delete',
    'posts_search_doc', 'posts_search_doc_delete')) = 8 AS eight_triggers,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_all') = 1 AS one_search_all,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_all_facets') = 1 AS one_facets_fn,
  NOT has_function_privilege('anon', 'public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)', 'EXECUTE') AS search_all_anon_revoked,
  has_function_privilege('service_role', 'public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)', 'EXECUTE') AS search_all_service_ok,
  NOT has_function_privilege('anon', 'public.search_all_facets(text, text[], uuid[], boolean, text, text)', 'EXECUTE') AS facets_anon_revoked,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'course')
    = (SELECT count(*) FROM golf_courses) AS course_docs_match,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'athlete')
    = (SELECT count(*) FROM profiles p
       WHERE COALESCE(NULLIF(btrim(COALESCE(p.full_name, '')), ''), p.handle) IS NOT NULL) AS athlete_docs_match,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'club')
    = (SELECT count(*) FROM clubs) AS club_docs_match,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'post')
    = (SELECT count(*) FROM posts po
       WHERE po.visibility = 'public' AND po.status = 'published'
         AND COALESCE(NULLIF(left(btrim(COALESCE(po.caption, '')), 140), ''),
                      NULLIF(left(btrim(array_to_string(COALESCE(po.hashtags, '{}'), ' ')), 140), '')) IS NOT NULL) AS post_docs_match,
  (SELECT r.entity_type FROM public.search_all('kanata golf', ARRAY['course']::text[], 1) r LIMIT 1) = 'course' AS kanata_course_ok,
  public.search_normalize('Montréal') = 'montreal' AS unaccent_ok,
  NOT EXISTS (
    SELECT 1
    FROM public.search_all(
      (SELECT sd.title FROM search_documents sd WHERE sd.entity_type = 'athlete' AND sd.visibility = 'private' LIMIT 1),
      ARRAY['athlete']::text[], 20, '{}'::uuid[], TRUE) r
    JOIN search_documents sd2 ON sd2.entity_type = 'athlete'
      AND sd2.entity_id = r.entity_id AND sd2.visibility = 'private'
  ) AS private_athletes_hidden,
  EXISTS (SELECT 1 FROM public.search_all('', NULL, 5, '{}'::uuid[], TRUE, 'CA')) AS ca_browse_ok,
  (SELECT count(*) FROM public.search_all_facets('golf', NULL)) >= 1 AS facets_return_rows,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'athlete' AND visibility = 'private') AS private_athlete_docs_info,
  (SELECT count(*) FROM search_documents) AS total_docs_info;

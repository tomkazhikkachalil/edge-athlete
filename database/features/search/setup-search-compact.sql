-- FULL-TEXT SEARCH - COMPACT VERSION (Copy all and run in Supabase SQL Editor)

-- 1. Add search columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_profiles_search_vector ON profiles USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_clubs_search_vector ON clubs USING GIN(search_vector);

-- 3. Profile search function
CREATE OR REPLACE FUNCTION profiles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.email, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.first_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.last_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.location, '')), 'C');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- 4. Post search function
CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.caption, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.hashtags, ' '), '')), 'B');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- 5. Club search function
CREATE OR REPLACE FUNCTION clubs_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.location, '')), 'C');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- 6. Create triggers
DROP TRIGGER IF EXISTS profiles_search_vector_trigger ON profiles;
CREATE TRIGGER profiles_search_vector_trigger BEFORE INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION profiles_search_vector_update();

DROP TRIGGER IF EXISTS posts_search_vector_trigger ON posts;
CREATE TRIGGER posts_search_vector_trigger BEFORE INSERT OR UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();

DROP TRIGGER IF EXISTS clubs_search_vector_trigger ON clubs;
CREATE TRIGGER clubs_search_vector_trigger BEFORE INSERT OR UPDATE ON clubs FOR EACH ROW EXECUTE FUNCTION clubs_search_vector_update();

-- 7. Search helper functions
CREATE OR REPLACE FUNCTION search_profiles(search_query text, max_results int DEFAULT 20)
RETURNS TABLE (id uuid, full_name text, first_name text, middle_name text, last_name text, avatar_url text, location text, sport text, school text, visibility text, rank real) AS $$
BEGIN
  RETURN QUERY SELECT p.id, p.full_name, p.first_name, p.middle_name, p.last_name, p.avatar_url, p.location, p.sport, p.school, p.visibility,
    ts_rank(p.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM profiles p WHERE p.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, p.full_name ASC NULLS LAST LIMIT max_results;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION search_posts(search_query text, max_results int DEFAULT 15)
RETURNS TABLE (id uuid, caption text, sport_key text, created_at timestamptz, profile_id uuid, rank real) AS $$
BEGIN
  RETURN QUERY SELECT po.id, po.caption, po.sport_key, po.created_at, po.profile_id,
    ts_rank(po.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM posts po WHERE po.visibility = 'public' AND po.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, po.created_at DESC LIMIT max_results;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION search_clubs(search_query text, max_results int DEFAULT 10)
RETURNS TABLE (id uuid, name text, description text, location text, rank real) AS $$
BEGIN
  RETURN QUERY SELECT c.id, c.name, c.description, c.location,
    ts_rank(c.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM clubs c WHERE c.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, c.name ASC LIMIT max_results;
END; $$ LANGUAGE plpgsql STABLE;

-- 8. Backfill data
UPDATE profiles SET email = email;
UPDATE posts SET caption = COALESCE(caption, '');
UPDATE clubs SET name = name;

-- Success!
SELECT 'Full-text search installed! Test with: SELECT * FROM search_profiles(''test'', 5);' AS status;

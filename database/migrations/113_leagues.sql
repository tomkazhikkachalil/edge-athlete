-- ============================================================================
-- 113: leagues — the first org-managed entity, born inside search_all
-- ============================================================================
-- Tom's decisions (Aug 24): leagues become a REAL table (until now 'league'
-- was only an unused profiles.user_type and dead display config), creation is
-- ADMIN-PROVISIONED from the dashboard (self-service org signup stays the
-- "separate flow" the profile route promises), membership is OPEN JOIN/LEAVE
-- for athletes, and sport_key is REQUIRED (one SportRegistry sport per
-- league; a multi-sport org creates one league per sport).
--
-- Search: leagues join `search_documents` (112) via the named entity_type
-- CHECK swap that migration designed for, plus one doc-sync trigger pair and
-- a backfill. There is deliberately NO bespoke `search_leagues` RPC — a
-- deviation from docs/SEARCH.md's checklist item 3: every earlier entity got
-- its own RPC because it predated search_all and needed a contract to keep;
-- leagues are born inside search_all and never had a legacy path. Their doc
-- rows carry owner_id NULL on purpose: the `owner_id = ANY(visible_ids)`
-- privacy pass-through must never apply to an always-public type.
--
-- ORDER-STRICT like 098: run BEFORE merging the leagues PR — the admin
-- create route and the join route insert into these tables and would 500
-- pre-113. (The reverse order still degrades: /api/leagues catches 42P01 →
-- 404, and search_all simply matches nothing for p_types ['league'].)
--
-- Run AFTER 112. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

-- ── leagues ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leagues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  description       text,
  -- App-validated against FEATURE_SPORTS/SportRegistry (no DB enum — the
  -- registry is app-side and grows without migrations).
  sport_key         text NOT NULL,
  -- SET NULL, not RESTRICT/CASCADE: RESTRICT would break account deletion,
  -- CASCADE would vaporize a community asset. An orphaned league is
  -- re-assigned from the admin dashboard.
  owner_profile_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- The location model (docs/SEARCH.md).
  place_id          uuid REFERENCES places(id) ON DELETE SET NULL,
  city text, region text, region_code text, country text, country_code text,
  lat double precision, lng double precision,
  location_source   text,
  search_vector     tsvector,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS leagues_updated_at ON leagues;
CREATE TRIGGER leagues_updated_at
  BEFORE UPDATE ON leagues
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Service-role only (RLS on, zero policies): authorization is app-layer,
-- the waitlist/events/search_documents precedent.
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON leagues FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_leagues_search ON leagues USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_leagues_country_region ON leagues (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_leagues_lat ON leagues (lat);
CREATE INDEX IF NOT EXISTS idx_leagues_place ON leagues (place_id);
CREATE INDEX IF NOT EXISTS idx_leagues_owner ON leagues (owner_profile_id);

-- ── league_members ───────────────────────────────────────────────────────────
-- Open join: existence = active membership, no status column. The owner gets
-- a role='owner' row written by the admin-create route (the route is the only
-- creator, and authorization is app-layer — no trigger). 'manager' is allowed
-- by the CHECK but has no appointment UI yet (front-loaded so adding it later
-- is migration-free).
CREATE TABLE IF NOT EXISTS league_members (
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member'
    CONSTRAINT league_members_role_check CHECK (role IN ('owner', 'manager', 'member')),
  joined_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (league_id, profile_id)
);

ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON league_members FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_league_members_profile ON league_members (profile_id);

-- ── Contract search vector (110's club shape, plus sport at C) ───────────────
-- sport_key sits at weight C so "golf" reaches golf leagues the way it
-- reaches golf posts (112's post-doc precedent).
CREATE OR REPLACE FUNCTION public.leagues_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.description)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.sport_key))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code))), 'D') ||
    setweight(to_tsvector('simple', public.search_normalize(
      public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS leagues_search_vector ON leagues;
CREATE TRIGGER leagues_search_vector
  BEFORE INSERT OR UPDATE OF name, description, sport_key, city, region,
    region_code, country, country_code, place_id
  ON leagues
  FOR EACH ROW EXECUTE FUNCTION public.leagues_search_vector_update();

-- ── The named entity_type CHECK swap (what 112 designed for) ─────────────────
ALTER TABLE search_documents DROP CONSTRAINT IF EXISTS search_documents_entity_type_check;
ALTER TABLE search_documents ADD CONSTRAINT search_documents_entity_type_check
  CHECK (entity_type IN ('athlete', 'club', 'course', 'post', 'league'));

-- ── Doc sync pair (112's club-sync shape) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_doc_sync_league()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES ('league', NEW.id, NEW.name, left(NEW.description, 140), NEW.sport_key,
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
DROP TRIGGER IF EXISTS leagues_search_doc ON leagues;
CREATE TRIGGER leagues_search_doc
  AFTER INSERT OR UPDATE OF name, description, sport_key, city, region, region_code,
    country, country_code, place_id, lat, lng, search_vector
  ON leagues
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_league();
DROP TRIGGER IF EXISTS leagues_search_doc_delete ON leagues;
CREATE TRIGGER leagues_search_doc_delete
  AFTER DELETE ON leagues
  FOR EACH ROW EXECUTE FUNCTION public.search_document_delete('league');

-- ── Backfill + convergence (zero rows on first run; written anyway) ──────────
INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
  owner_id, visibility, place_id, city, region, region_code, country, country_code,
  lat, lng, rich, recency, search_vector)
SELECT 'league', l.id, l.name, left(l.description, 140), l.sport_key,
  NULL, 'public', l.place_id, l.city, l.region, l.region_code, l.country, l.country_code,
  l.lat, l.lng, (l.description IS NOT NULL), l.updated_at,
  COALESCE(l.search_vector, ''::tsvector)
FROM leagues l
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
  owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
  city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
  country = EXCLUDED.country, country_code = EXCLUDED.country_code,
  lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
  search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());

DELETE FROM search_documents sd
WHERE sd.entity_type = 'league'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.id = sd.entity_id);

-- ── Notification types: full-list re-ADD (the 028/053/059/089/095/098 house
-- pattern; base list = 098's live list). Both league types land now —
-- front-loading the constraint keeps follow-ups migration-free; an
-- allowed-but-unsent type is harmless, the reverse is a 23514 in prod.
-- Only league_join gets a sender in this PR.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request','follow_accepted','new_follower','like','comment',
    'comment_reply','mention','tag','achievement','system_announcement',
    'club_update','team_update','new_message','group_invite','group_update',
    'guardian_invite','athlete_added',
    'event_invite','event_update','event_cancelled','event_response',
    'event_reminder',
    'post_pending_approval','post_approval_result','transfer_update',
    'consent_result',
    'comment_pending_approval','comment_approval_result',
    'follow_request_guardian','follow_update','tag_alert','profile_change',
    'calendar_alert','safety_alert',
    'league_join','league_update'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leagues') AS leagues_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'league_members') AS members_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'leagues') AS leagues_rls_on,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'league_members') AS members_rls_on,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'leagues' AND indexname = 'idx_leagues_search') AS gin_exists,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN (
    'leagues_updated_at', 'leagues_search_vector',
    'leagues_search_doc', 'leagues_search_doc_delete')) = 4 AS four_triggers,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'search_documents_entity_type_check') LIKE '%league%' AS doc_check_has_league,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%league_join%' AS notif_check_has_join,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'notifications_type_check') LIKE '%league_update%' AS notif_check_has_update,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'league_members_role_check') LIKE '%manager%' AS role_check_has_manager,
  (SELECT count(*) FROM search_documents WHERE entity_type = 'league')
    = (SELECT count(*) FROM leagues) AS league_docs_match,
  (SELECT count(*) FROM public.search_all('anything', ARRAY['league']::text[], 1)) >= 0 AS search_all_accepts_league,
  NOT has_table_privilege('anon', 'leagues', 'SELECT') AS leagues_anon_revoked,
  NOT has_table_privilege('anon', 'league_members', 'SELECT') AS members_anon_revoked,
  (SELECT count(*) FROM leagues) AS leagues_info,
  (SELECT count(*) FROM league_members) AS members_info;

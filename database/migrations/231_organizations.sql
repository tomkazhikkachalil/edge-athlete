-- ============================================================================
-- 231: Round 5 (organizations unification), step A — ONE `organizations`
--      table, mirrored from leagues ∪ clubs by trigger (merges ALONE)
-- ============================================================================
-- The Sep 22 audit: no `organizations` table, no `org_id`, no discriminator —
-- an org is a nullable (league_id, club_id) pair on 16 tables, 32 FKs, 14
-- pairing CHECKs in three dialects, six NULLS-NOT-DISTINCT uniques that make
-- the pair behave like one key, ~66 hand-written column ternaries and ~50
-- table ternaries in code. `leagues` and `clubs` are the same table twice,
-- differing by `sport_key NOT NULL` (leagues) vs `primary_sport` nullable
-- (clubs) and clubs' legacy free-text `location`.
--
-- Tom's decisions (Sep 22): `kind` (league | club; school later) is the
-- org's SELF-DESCRIPTION — its route family and vocabulary — while the
-- capability flags `operates_competitions` / `operates_teams` (142) stay the
-- behaviour switches; both, never either. URLs do not change. Old and new
-- coexist by DATABASE triggers, never app dual-writes.
--
-- STEP A, this file: the table, backfilled with the SAME ids as the sources
-- (uuid; zero collisions, verified on prod and staging), and two mirror
-- triggers so every INSERT / UPDATE / DELETE the app still makes on
-- `leagues` or `clubs` lands here too. Nothing reads it yet (step B adds
-- `org_id` to the pair tables and the reads switch; step C reverses the
-- mirror; step D drops the pair and turns leagues/clubs into views).
-- search_documents keeps syncing from the OLD tables during the window —
-- syncing from here too would write the same (entity_type, id) twice.
-- Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL,
  name                   text NOT NULL,
  description            text,
  sport_key              text,
  owner_profile_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  place_id               uuid REFERENCES public.places(id) ON DELETE SET NULL,
  city                   text,
  region                 text,
  region_code            text,
  country                text,
  country_code           text,
  lat                    double precision,
  lng                    double precision,
  location_source        text,
  location               text,
  search_vector          tsvector,
  operates_competitions  boolean NOT NULL DEFAULT false,
  operates_teams         boolean NOT NULL DEFAULT false,
  approved_at            timestamptz DEFAULT now(),
  visibility             text NOT NULL DEFAULT 'public',
  join_policy            text NOT NULL DEFAULT 'open',
  listing_status         text NOT NULL DEFAULT 'listed',
  created_at             timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at             timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT organizations_kind_check CHECK (kind = ANY (ARRAY['league'::text, 'club'::text])),
  CONSTRAINT organizations_visibility_check CHECK (visibility = ANY (ARRAY['public'::text, 'private'::text])),
  CONSTRAINT organizations_join_policy_check CHECK (join_policy = ANY (ARRAY['open'::text, 'approval'::text])),
  CONSTRAINT organizations_listing_status_check CHECK (listing_status = ANY (ARRAY['unlisted'::text, 'pending'::text, 'listed'::text]))
);
COMMENT ON TABLE public.organizations IS '231: ONE org table — leagues ∪ clubs by `kind`; mirrored from the two tables by trigger during the unification window (Round 5).';
COMMENT ON COLUMN public.organizations.kind IS 'What the org calls itself and its route family (league | club; school later). Behaviour is the capability flags, never this.';
COMMENT ON COLUMN public.organizations.sport_key IS 'leagues.sport_key or clubs.primary_sport; nullable (a multi-sport club).';
COMMENT ON COLUMN public.organizations.location IS 'clubs'' legacy free-text location; superseded by the place block; carried so nothing is lost.';

-- Posture: service role only (the 113 / 117 rule for every org table).
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organizations FROM anon, authenticated;

-- The two tables' indexes, once.
CREATE INDEX IF NOT EXISTS idx_organizations_kind ON public.organizations USING btree (kind);
CREATE INDEX IF NOT EXISTS idx_organizations_search ON public.organizations USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_organizations_country_region ON public.organizations USING btree (country_code, region_code);
CREATE INDEX IF NOT EXISTS idx_organizations_lat ON public.organizations USING btree (lat);
CREATE INDEX IF NOT EXISTS idx_organizations_place ON public.organizations USING btree (place_id);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations USING btree (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm ON public.organizations USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS organizations_listing_idx ON public.organizations USING btree (listing_status) WHERE (listing_status <> 'listed'::text);
CREATE INDEX IF NOT EXISTS organizations_pending_idx ON public.organizations USING btree (created_at) WHERE (approved_at IS NULL);

-- ── Search vector: leagues' rule with the sport term for BOTH kinds ─────────
CREATE OR REPLACE FUNCTION public.organizations_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', public.search_normalize(NEW.name)), 'A') ||
    setweight(to_tsvector('simple', public.search_normalize(NEW.description)), 'B') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.city, NEW.sport_key, NEW.location))), 'C') ||
    setweight(to_tsvector('simple', public.search_normalize(
      concat_ws(' ', NEW.region, NEW.region_code, NEW.country, NEW.country_code))), 'D') ||
    setweight(to_tsvector('simple', public.search_normalize(
      public.place_context(NEW.place_id))), 'D');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.organizations_search_vector_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_search_vector ON public.organizations;
CREATE TRIGGER organizations_search_vector
  BEFORE INSERT OR UPDATE OF name, description, sport_key, location, city, region, region_code, country, country_code, place_id
  ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.organizations_search_vector_update();

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── The mirror: leagues → organizations ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organizations_mirror_league()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.organizations WHERE id = OLD.id AND kind = 'league';
    RETURN OLD;
  END IF;
  INSERT INTO public.organizations (id, kind, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source, location,
                                    operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status, created_at, updated_at)
  VALUES (NEW.id, 'league', NEW.name, NEW.description, NEW.sport_key, NEW.owner_profile_id, NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.lat, NEW.lng, NEW.location_source, NULL,
          NEW.operates_competitions, NEW.operates_teams, NEW.approved_at, NEW.visibility, NEW.join_policy, NEW.listing_status, NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description, sport_key = EXCLUDED.sport_key,
    owner_profile_id = EXCLUDED.owner_profile_id, place_id = EXCLUDED.place_id, city = EXCLUDED.city, region = EXCLUDED.region,
    region_code = EXCLUDED.region_code, country = EXCLUDED.country, country_code = EXCLUDED.country_code, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    location_source = EXCLUDED.location_source, operates_competitions = EXCLUDED.operates_competitions, operates_teams = EXCLUDED.operates_teams,
    approved_at = EXCLUDED.approved_at, visibility = EXCLUDED.visibility, join_policy = EXCLUDED.join_policy, listing_status = EXCLUDED.listing_status,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.organizations_mirror_league() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_mirror_league ON public.leagues;
CREATE TRIGGER organizations_mirror_league
  AFTER INSERT OR UPDATE OR DELETE ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.organizations_mirror_league();

-- ── The mirror: clubs → organizations ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organizations_mirror_club()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.organizations WHERE id = OLD.id AND kind = 'club';
    RETURN OLD;
  END IF;
  INSERT INTO public.organizations (id, kind, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source, location,
                                    operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status, created_at, updated_at)
  VALUES (NEW.id, 'club', NEW.name, NEW.description, NEW.primary_sport, NEW.owner_profile_id, NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.lat, NEW.lng, NEW.location_source, NEW.location,
          NEW.operates_competitions, NEW.operates_teams, NEW.approved_at, NEW.visibility, NEW.join_policy, NEW.listing_status, NEW.created_at, NEW.updated_at)
  ON CONFLICT (id) DO UPDATE SET
    kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description, sport_key = EXCLUDED.sport_key,
    owner_profile_id = EXCLUDED.owner_profile_id, place_id = EXCLUDED.place_id, city = EXCLUDED.city, region = EXCLUDED.region,
    region_code = EXCLUDED.region_code, country = EXCLUDED.country, country_code = EXCLUDED.country_code, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    location_source = EXCLUDED.location_source, location = EXCLUDED.location, operates_competitions = EXCLUDED.operates_competitions, operates_teams = EXCLUDED.operates_teams,
    approved_at = EXCLUDED.approved_at, visibility = EXCLUDED.visibility, join_policy = EXCLUDED.join_policy, listing_status = EXCLUDED.listing_status,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.organizations_mirror_club() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_mirror_club ON public.clubs;
CREATE TRIGGER organizations_mirror_club
  AFTER INSERT OR UPDATE OR DELETE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.organizations_mirror_club();

-- ── The backfill: every existing league and club, same id ───────────────────
INSERT INTO public.organizations (id, kind, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source, location,
                                  operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status, created_at, updated_at)
SELECT l.id, 'league', l.name, l.description, l.sport_key, l.owner_profile_id, l.place_id, l.city, l.region, l.region_code, l.country, l.country_code, l.lat, l.lng, l.location_source, NULL,
       l.operates_competitions, l.operates_teams, l.approved_at, l.visibility, l.join_policy, l.listing_status, l.created_at, l.updated_at
  FROM public.leagues l
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, kind, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source, location,
                                  operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status, created_at, updated_at)
SELECT c.id, 'club', c.name, c.description, c.primary_sport, c.owner_profile_id, c.place_id, c.city, c.region, c.region_code, c.country, c.country_code, c.lat, c.lng, c.location_source, c.location,
       c.operates_competitions, c.operates_teams, c.approved_at, c.visibility, c.join_policy, c.listing_status, c.created_at, c.updated_at
  FROM public.clubs c
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (231, '231_organizations.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 231 APPLIED | <leagues + clubs> | 0 | 0 | 2 | 231
SELECT '231 APPLIED' AS result,
       (SELECT count(*) FROM public.organizations) AS organizations_expect_leagues_plus_clubs,
       (SELECT count(*) FROM public.leagues l WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = l.id AND o.kind = 'league')) AS leagues_missing_expect_0,
       (SELECT count(*) FROM public.clubs c WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c.id AND o.kind = 'club')) AS clubs_missing_expect_0,
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname IN ('organizations_mirror_league', 'organizations_mirror_club') AND NOT t.tgisinternal) AS mirror_triggers_expect_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_231;

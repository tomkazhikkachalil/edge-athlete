-- ============================================================================
-- 233: Round 5 (organizations unification), step C — the flip: `org_id` is
--      the real column, the pair is mirrored FROM it, `organizations` is
--      the source and leagues / clubs are mirrored FROM it (merges ALONE)
-- ============================================================================
-- After 231 (organizations, mirrored from leagues ∪ clubs) and 232 (org_id
-- GENERATED from the pair, every read switched to it — code PR B1), the
-- direction reverses so the WRITES can switch (code PR C1: `pairFor` sends
-- `org_id`; the wizard inserts an organizations row):
--
--   1. org_id stops being generated (DROP EXPRESSION keeps every value) and
--      becomes NOT NULL on the ten tables whose pairing CHECK is `= 1`.
--   2. ONE trigger function `org_pair_sync()` BEFORE INSERT OR UPDATE on all
--      fifteen keeps the pair and org_id agreeing in BOTH directions: a row
--      written with the pair gets org_id; a row written with org_id gets the
--      pair from organizations.kind. So every old writer and every new
--      writer is right, and the pairing CHECKs stay satisfied.
--   3. The six NULLS NOT DISTINCT uniques are rebuilt on org_id (NULLS NOT
--      DISTINCT stays where OTHER columns are nullable — season_id,
--      scope_id, division_id, program_id — only the pair's nulls are gone).
--   4. organizations → leagues / clubs mirror (INSERT / UPDATE / DELETE),
--      with the 231 mirrors kept for the old writers. Both directions are
--      guarded by pg_trigger_depth() so a mirror never re-fires the other:
--      the app writes leagues (depth 0) → mirror to organizations (1) →
--      the reverse mirror sees depth 2 and returns. A league needs a
--      sport_key (NOT NULL there): an organizations row of kind league
--      without one is refused at the mirror — C1's wizard always sets it.
--
-- Nothing is dropped here: the pair columns, the CHECKs, the old mirrors
-- and the old FKs all stay until step D. Re-runnable.
-- ============================================================================

-- ── 1. org_id becomes a real column (DROP EXPRESSION keeps every value) ──
ALTER TABLE public.athlete_claim_invites ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.competitions ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.divisions ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.events ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.memberships ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.org_claim_invites ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.org_sites ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.org_staff_audit ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.org_staff_invites ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.registration_windows ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.registrations ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.seasons ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.sport_events ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.teams ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;
ALTER TABLE public.venues ALTER COLUMN org_id DROP EXPRESSION IF EXISTS;

-- NOT NULL where the pairing CHECK is `= 1` (the SET NULL tables and the audit trail stay nullable).
ALTER TABLE public.competitions ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.divisions ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.memberships ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.org_claim_invites ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.org_sites ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.org_staff_invites ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.registration_windows ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.registrations ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.seasons ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.teams ALTER COLUMN org_id SET NOT NULL;

-- ── 2. The pair ⇄ org_id sync, one function for all fifteen ─────────────────
CREATE OR REPLACE FUNCTION public.org_pair_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE k text;
BEGIN
  -- An old writer changing the pair on an existing row: the pair wins.
  IF TG_OP = 'UPDATE' AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
     AND (NEW.league_id IS DISTINCT FROM OLD.league_id OR NEW.club_id IS DISTINCT FROM OLD.club_id) THEN
    NEW.org_id := COALESCE(NEW.league_id, NEW.club_id);
  END IF;
  -- A row written with the pair only.
  IF NEW.org_id IS NULL THEN
    NEW.org_id := COALESCE(NEW.league_id, NEW.club_id);
  END IF;
  -- The pair follows org_id through organizations.kind.
  IF NEW.org_id IS NULL THEN
    NEW.league_id := NULL;
    NEW.club_id := NULL;
  ELSE
    SELECT o.kind INTO k FROM public.organizations o WHERE o.id = NEW.org_id;
    IF k = 'league' THEN
      NEW.league_id := NEW.org_id; NEW.club_id := NULL;
    ELSIF k = 'club' THEN
      NEW.club_id := NEW.org_id; NEW.league_id := NULL;
    END IF;
    -- k NULL: the FK refuses the row after us; nothing to decide here.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_pair_sync() FROM PUBLIC, anon, authenticated;

-- Named literally, one per table — the provenance trigger facet reads CREATE TRIGGER statements, never a DO loop.
DROP TRIGGER IF EXISTS org_pair_sync ON public.athlete_claim_invites;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.athlete_claim_invites FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.competitions;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.competitions FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.divisions;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.divisions FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.events;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.events FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.memberships;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_claim_invites;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.org_claim_invites FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_sites;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.org_sites FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_staff_audit;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.org_staff_audit FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_staff_invites;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.org_staff_invites FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.registration_windows;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.registration_windows FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.registrations;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.registrations FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.seasons;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.sport_events;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.sport_events FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.teams;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.teams FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();
DROP TRIGGER IF EXISTS org_pair_sync ON public.venues;
CREATE TRIGGER org_pair_sync BEFORE INSERT OR UPDATE OF org_id, league_id, club_id ON public.venues FOR EACH ROW EXECUTE FUNCTION public.org_pair_sync();

-- ── 3. The six uniques, on org_id ───────────────────────────────────────────
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_org_season_name_uniq;
ALTER TABLE public.competitions ADD CONSTRAINT competitions_org_season_name_uniq UNIQUE NULLS NOT DISTINCT (org_id, season_id, name);

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_uniq;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_uniq UNIQUE NULLS NOT DISTINCT (org_id, profile_id, kind, scope_type, scope_id, season_id);

ALTER TABLE public.registration_windows DROP CONSTRAINT IF EXISTS reg_windows_uniq;
ALTER TABLE public.registration_windows ADD CONSTRAINT reg_windows_uniq UNIQUE NULLS NOT DISTINCT (org_id, season_id, division_id, program_id);

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_uniq;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_uniq UNIQUE NULLS NOT DISTINCT (org_id, profile_id, season_id, division_id, program_id);

ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_org_label_uniq;
ALTER TABLE public.seasons ADD CONSTRAINT seasons_org_label_uniq UNIQUE (org_id, label);

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_org_name_uniq;
ALTER TABLE public.teams ADD CONSTRAINT teams_org_name_uniq UNIQUE (org_id, name);

-- ── 4. The reverse mirror: organizations → leagues / clubs ──────────────────
-- Depth guard on BOTH directions (see the header).
CREATE OR REPLACE FUNCTION public.organizations_mirror_league()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
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

CREATE OR REPLACE FUNCTION public.organizations_mirror_club()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
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

CREATE OR REPLACE FUNCTION public.organizations_mirror_sources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind = 'league' THEN DELETE FROM public.leagues WHERE id = OLD.id; ELSE DELETE FROM public.clubs WHERE id = OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'organizations.kind is immutable (% → %)', OLD.kind, NEW.kind USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'league' THEN
    IF NEW.sport_key IS NULL THEN
      RAISE EXCEPTION 'a league needs a sport_key' USING ERRCODE = 'not_null_violation';
    END IF;
    INSERT INTO public.leagues (id, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source,
                                operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status, created_at, updated_at)
    VALUES (NEW.id, NEW.name, NEW.description, NEW.sport_key, NEW.owner_profile_id, NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.lat, NEW.lng, NEW.location_source,
            NEW.operates_competitions, NEW.operates_teams, NEW.approved_at, NEW.visibility, NEW.join_policy, NEW.listing_status, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description, sport_key = EXCLUDED.sport_key,
      owner_profile_id = EXCLUDED.owner_profile_id, place_id = EXCLUDED.place_id, city = EXCLUDED.city, region = EXCLUDED.region,
      region_code = EXCLUDED.region_code, country = EXCLUDED.country, country_code = EXCLUDED.country_code, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
      location_source = EXCLUDED.location_source, operates_competitions = EXCLUDED.operates_competitions, operates_teams = EXCLUDED.operates_teams,
      approved_at = EXCLUDED.approved_at, visibility = EXCLUDED.visibility, join_policy = EXCLUDED.join_policy, listing_status = EXCLUDED.listing_status,
      updated_at = EXCLUDED.updated_at;
  ELSE
    INSERT INTO public.clubs (id, name, description, location, primary_sport, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source,
                              operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status, created_at, updated_at)
    VALUES (NEW.id, NEW.name, NEW.description, NEW.location, NEW.sport_key, NEW.owner_profile_id, NEW.place_id, NEW.city, NEW.region, NEW.region_code, NEW.country, NEW.country_code, NEW.lat, NEW.lng, NEW.location_source,
            NEW.operates_competitions, NEW.operates_teams, NEW.approved_at, NEW.visibility, NEW.join_policy, NEW.listing_status, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description, location = EXCLUDED.location, primary_sport = EXCLUDED.primary_sport,
      owner_profile_id = EXCLUDED.owner_profile_id, place_id = EXCLUDED.place_id, city = EXCLUDED.city, region = EXCLUDED.region,
      region_code = EXCLUDED.region_code, country = EXCLUDED.country, country_code = EXCLUDED.country_code, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
      location_source = EXCLUDED.location_source, operates_competitions = EXCLUDED.operates_competitions, operates_teams = EXCLUDED.operates_teams,
      approved_at = EXCLUDED.approved_at, visibility = EXCLUDED.visibility, join_policy = EXCLUDED.join_policy, listing_status = EXCLUDED.listing_status,
      updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.organizations_mirror_sources() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_mirror_sources ON public.organizations;
CREATE TRIGGER organizations_mirror_sources
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_mirror_sources();

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (233, '233_org_id_flip.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 233 APPLIED | 0 | 10 | 15 | 6 | 3 | 233
SELECT '233 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' AND is_generated = 'ALWAYS') AS still_generated_expect_0,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' AND is_nullable = 'NO') AS not_null_expect_10,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'org_pair_sync' AND NOT tgisinternal) AS sync_triggers_expect_15,
       (SELECT count(*) FROM pg_constraint WHERE contype = 'u' AND conname IN ('competitions_org_season_name_uniq','memberships_uniq','reg_windows_uniq','registrations_uniq','seasons_org_label_uniq','teams_org_name_uniq') AND pg_get_constraintdef(oid) LIKE '%(org_id,%') AS uniques_on_org_id_expect_6,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources') AND NOT tgisinternal) AS mirrors_expect_3,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_233;

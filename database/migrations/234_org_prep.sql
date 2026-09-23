-- ============================================================================
-- 234: Round 5 (organizations unification), step D prep — the org_id FKs carry
--      the pair's ON DELETE actions, one site per org, the two guards leave the
--      mirror, search syncs from organizations, the nine non-pair FKs re-point,
--      org_id is authoritative when IT changes, schema_dump() v3 (merges ALONE)
-- ============================================================================
-- After 231 (organizations), 232 (org_id) and 233 (the flip), step D drops the
-- pair (235) and makes leagues / clubs views over organizations. Everything a
-- view cannot carry and everything the pair still carried moves HERE first,
-- additively, while the pair and the mirrors stay as the safety net:
--
--   1. org_pair_sync(): org_id is AUTHORITATIVE when it CHANGED on UPDATE.
--      233's body refilled a NULL org_id from the pair, so an UPDATE that
--      detached a row through `org_id = null` alone (the calendar's "explicit
--      null detaches"; a sport event leaving its org) was silently undone
--      while the pair was unchanged. New order: org_id changed → the pair
--      follows it (NULL → both NULL); else the pair changed → the pair wins;
--      else a NULL org_id is filled from the pair (an INSERT with the pair).
--      Found writing D0-a (Sep 22 2026); D0-b's detach writes need it.
--   2. The fourteen *_org_id_fkey re-declared with the pair FKs' actions:
--      CASCADE on the ten `= 1` tables, SET NULL on the four nullable ones.
--      232 left them NO ACTION because a delete started at leagues / clubs;
--      after 235 it starts at organizations. Safe in the window — whichever
--      side a delete starts on, RI on the other finds the children already
--      gone or nulled (both paths traced in the plan).
--   3. org_sites_org_uniq UNIQUE (org_id): "one site per org" lived only in
--      the two pair uniques (org_sites_league_uniq / org_sites_club_uniq).
--   4. The two guards the mirror carried: a league needs a sport_key
--      (CHECK), and kind is immutable (a BEFORE UPDATE OF kind trigger — a
--      CHECK cannot see OLD). In the window mirror_sources raises the same
--      error first; harmless.
--   5. search_documents syncs FROM organizations: search_doc_sync_org()
--      (113's shape, entity_type := kind — the kind vocabulary IS the search
--      entity vocabulary; a future `school` kind must extend
--      search_documents_entity_type_check) + search_doc_delete_org(). The
--      four leagues / clubs triggers go in the same file (231's double-write
--      rule) and every document converges NOW. The club ranking formula
--      becomes the org one (sport at C, region at D — 231's vector).
--      search_clubs reads organizations WHERE kind = 'club'.
--   6. The nine FKs on non-pair tables that target leagues / clubs re-point to
--      organizations(id) with their actions (ids are identical). They lose
--      "must be that kind" until D-ii unifies the tables (236 / 237).
--   7. schema_dump() v3: the views element carries `options` (reloptions) so
--      the regenerated baseline can rebuild 235's security_invoker views.
--
-- Nothing is dropped from the pair; the mirrors stay. Re-runnable.
--
-- Reversal (documented, not executed): re-declare the fourteen FKs without an
-- action; DROP CONSTRAINT org_sites_org_uniq and organizations_league_sport_key_check;
-- DROP TRIGGER organizations_kind_immutable and its function; re-create 112 / 113's
-- four search triggers and drop the two org ones; restore 108's search_clubs body
-- (FROM clubs); re-point the nine FKs to leagues / clubs; restore 228's schema_dump;
-- restore 233's org_pair_sync body. Data is identical throughout (the mirror).
-- ============================================================================

-- ── 0. Pre-flight (aborts BEFORE any change) ────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 233 THEN RAISE EXCEPTION '234 needs 233 (ledger head is %)', n; END IF;
  SELECT count(*) INTO n FROM public.organizations WHERE kind = 'league' AND sport_key IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '234 pre-flight: % league rows without a sport_key', n; END IF;
  SELECT count(*) INTO n FROM (SELECT org_id FROM public.org_sites GROUP BY org_id HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION '234 pre-flight: % orgs with more than one site', n; END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass;
  IF n <> 14 THEN RAISE EXCEPTION '234 pre-flight: expected 14 FKs to organizations, found %', n; END IF;
END $$;

-- ── 1. org_pair_sync(): org_id is authoritative when IT changed ──────────────
CREATE OR REPLACE FUNCTION public.org_pair_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE k text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    -- org_id CHANGED (a new writer — including a detach to NULL): it is
    -- authoritative; the pair follows it below.
    NULL;
  ELSIF TG_OP = 'UPDATE'
     AND (NEW.league_id IS DISTINCT FROM OLD.league_id OR NEW.club_id IS DISTINCT FROM OLD.club_id) THEN
    -- An old writer changing the pair on an existing row: the pair wins.
    NEW.org_id := COALESCE(NEW.league_id, NEW.club_id);
  ELSIF NEW.org_id IS NULL THEN
    -- A row written with the pair only.
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
-- The fifteen org_pair_sync triggers (233) are unchanged.

-- ── 2. The fourteen org_id FKs carry the pair's actions ─────────────────────
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_org_id_fkey;
ALTER TABLE public.competitions ADD CONSTRAINT competitions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.divisions DROP CONSTRAINT IF EXISTS divisions_org_id_fkey;
ALTER TABLE public.divisions ADD CONSTRAINT divisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_org_id_fkey;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_org_id_fkey;
ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_org_id_fkey;
ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.org_staff_invites DROP CONSTRAINT IF EXISTS org_staff_invites_org_id_fkey;
ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.registration_windows DROP CONSTRAINT IF EXISTS registration_windows_org_id_fkey;
ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_org_id_fkey;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_org_id_fkey;
ALTER TABLE public.seasons ADD CONSTRAINT seasons_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_org_id_fkey;
ALTER TABLE public.teams ADD CONSTRAINT teams_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.athlete_claim_invites DROP CONSTRAINT IF EXISTS athlete_claim_invites_org_id_fkey;
ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_org_id_fkey;
ALTER TABLE public.events ADD CONSTRAINT events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.sport_events DROP CONSTRAINT IF EXISTS sport_events_org_id_fkey;
ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_org_id_fkey;
ALTER TABLE public.venues ADD CONSTRAINT venues_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ── 3. One site per org, on the one column ──────────────────────────────────
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_org_uniq;
ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_org_uniq UNIQUE (org_id);

-- ── 4. The two guards leave the mirror ──────────────────────────────────────
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_league_sport_key_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_league_sport_key_check CHECK (kind <> 'league' OR sport_key IS NOT NULL);

CREATE OR REPLACE FUNCTION public.organizations_kind_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'organizations.kind is immutable (% → %)', OLD.kind, NEW.kind USING ERRCODE = 'check_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.organizations_kind_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_kind_immutable ON public.organizations;
CREATE TRIGGER organizations_kind_immutable
  BEFORE UPDATE OF kind ON public.organizations
  FOR EACH ROW WHEN (OLD.kind IS DISTINCT FROM NEW.kind)
  EXECUTE FUNCTION public.organizations_kind_immutable();

-- ── 5. search_documents syncs from organizations ───────────────────────────
CREATE OR REPLACE FUNCTION public.search_doc_sync_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO search_documents (entity_type, entity_id, title, subtitle, sport_key,
    owner_id, visibility, place_id, city, region, region_code, country, country_code,
    lat, lng, rich, recency, search_vector)
  VALUES (NEW.kind, NEW.id, NEW.name, left(NEW.description, 140), NEW.sport_key,
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
REVOKE EXECUTE ON FUNCTION public.search_doc_sync_org() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_doc_delete_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM search_documents sd
  WHERE sd.entity_type = OLD.kind AND sd.entity_id = OLD.id;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_doc_delete_org() FROM PUBLIC, anon, authenticated;

-- The old four go first (231: syncing from both writes the same (entity_type, id) twice).
DROP TRIGGER IF EXISTS clubs_search_doc ON public.clubs;
DROP TRIGGER IF EXISTS clubs_search_doc_delete ON public.clubs;
DROP TRIGGER IF EXISTS leagues_search_doc ON public.leagues;
DROP TRIGGER IF EXISTS leagues_search_doc_delete ON public.leagues;

DROP TRIGGER IF EXISTS organizations_search_doc ON public.organizations;
CREATE TRIGGER organizations_search_doc
  AFTER INSERT OR UPDATE OF name, description, sport_key, location, city, region, region_code,
    country, country_code, place_id, lat, lng, search_vector
  ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_sync_org();
DROP TRIGGER IF EXISTS organizations_search_doc_delete ON public.organizations;
CREATE TRIGGER organizations_search_doc_delete
  AFTER DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.search_doc_delete_org();

-- Converge every league and club document on the org row NOW (not on its next edit).
INSERT INTO public.search_documents (entity_type, entity_id, title, subtitle, sport_key,
  owner_id, visibility, place_id, city, region, region_code, country, country_code,
  lat, lng, rich, recency, search_vector)
SELECT o.kind, o.id, o.name, left(o.description, 140), o.sport_key,
  NULL, 'public', o.place_id, o.city, o.region, o.region_code, o.country, o.country_code,
  o.lat, o.lng, (o.description IS NOT NULL), o.updated_at,
  COALESCE(o.search_vector, ''::tsvector)
FROM public.organizations o
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sport_key = EXCLUDED.sport_key,
    owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, place_id = EXCLUDED.place_id,
    city = EXCLUDED.city, region = EXCLUDED.region, region_code = EXCLUDED.region_code,
    country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, rich = EXCLUDED.rich, recency = EXCLUDED.recency,
    search_vector = EXCLUDED.search_vector, updated_at = timezone('utc', now());

DELETE FROM public.search_documents sd
WHERE sd.entity_type IN ('league', 'club')
  AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = sd.entity_id AND o.kind = sd.entity_type);

-- search_clubs: 108's body over organizations WHERE kind = 'club' (the one RPC that read a table).
CREATE OR REPLACE FUNCTION public.search_clubs(q text, max_results integer DEFAULT 20, p_country_code text DEFAULT NULL::text, p_region_code text DEFAULT NULL::text, p_near_lat double precision DEFAULT NULL::double precision, p_near_lng double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, name text, description text, location text, city text, region text, region_code text, country text, country_code text, lat double precision, lng double precision, distance_km double precision, match_rank integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  qn     text    := public.search_normalize(q);
  tsq    tsquery := public.search_prefix_tsquery(q);
  lim    int     := GREATEST(COALESCE(max_results, 20), 1);
  near   boolean := p_near_lat IS NOT NULL AND p_near_lng IS NOT NULL;
  radius float8  := COALESCE(p_radius_km, 50);
  dlat   float8;
  dlng   float8;
BEGIN
  dlat := radius / 111.0;
  dlng := radius / (111.0 * GREATEST(cos(radians(COALESCE(p_near_lat, 0))), 0.1));
  RETURN QUERY
  SELECT c.id, c.name, c.description, c.location,
    c.city, c.region, c.region_code, c.country, c.country_code, c.lat, c.lng,
    CASE WHEN near THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END AS distance_km,
    CASE
      WHEN qn = '' THEN 3
      WHEN public.search_normalize(c.name) = qn THEN 0
      WHEN public.search_normalize(c.name) LIKE qn || '%' THEN 1
      WHEN tsq IS NOT NULL AND to_tsvector('simple', public.search_normalize(c.name)) @@ tsq THEN 2
      ELSE 3
    END AS match_rank
  FROM public.organizations c
  WHERE c.kind = 'club'
    AND (p_country_code IS NULL OR c.country_code = upper(p_country_code))
    AND (p_region_code IS NULL OR c.region_code = upper(p_region_code))
    AND (NOT near OR (c.lat BETWEEN p_near_lat - dlat AND p_near_lat + dlat
                  AND c.lng BETWEEN p_near_lng - dlng AND p_near_lng + dlng))
    AND (qn = '' OR (tsq IS NOT NULL AND c.search_vector @@ tsq)
         OR (length(qn) >= 2 AND (c.name ILIKE '%' || qn || '%' OR c.location ILIKE '%' || qn || '%')))
  ORDER BY 13,
    CASE WHEN near AND qn = '' THEN public.haversine_km(p_near_lat, p_near_lng, c.lat, c.lng) END ASC NULLS LAST,
    CASE WHEN tsq IS NOT NULL THEN public.search_token_hits(to_tsvector('simple', public.search_normalize(c.name)), q) ELSE 0 END DESC,
    c.name
  LIMIT lim;
END;
$function$;

-- ── 6. The nine non-pair FKs re-point to organizations(id) ──────────────────
ALTER TABLE public.club_join_requests DROP CONSTRAINT IF EXISTS club_join_requests_club_id_fkey;
ALTER TABLE public.club_join_requests ADD CONSTRAINT club_join_requests_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.club_requests DROP CONSTRAINT IF EXISTS club_requests_created_club_id_fkey;
ALTER TABLE public.club_requests ADD CONSTRAINT club_requests_created_club_id_fkey FOREIGN KEY (created_club_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.league_affiliations DROP CONSTRAINT IF EXISTS league_affiliations_league_id_fkey;
ALTER TABLE public.league_affiliations ADD CONSTRAINT league_affiliations_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.league_affiliations DROP CONSTRAINT IF EXISTS league_affiliations_parent_league_id_fkey;
ALTER TABLE public.league_affiliations ADD CONSTRAINT league_affiliations_parent_league_id_fkey FOREIGN KEY (parent_league_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.league_clubs DROP CONSTRAINT IF EXISTS league_clubs_club_id_fkey;
ALTER TABLE public.league_clubs ADD CONSTRAINT league_clubs_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.league_clubs DROP CONSTRAINT IF EXISTS league_clubs_league_id_fkey;
ALTER TABLE public.league_clubs ADD CONSTRAINT league_clubs_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.league_join_requests DROP CONSTRAINT IF EXISTS league_join_requests_league_id_fkey;
ALTER TABLE public.league_join_requests ADD CONSTRAINT league_join_requests_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.league_requests DROP CONSTRAINT IF EXISTS league_requests_created_league_id_fkey;
ALTER TABLE public.league_requests ADD CONSTRAINT league_requests_created_league_id_fkey FOREIGN KEY (created_league_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.sanction_grants DROP CONSTRAINT IF EXISTS sanction_grants_grantor_league_id_fkey;
ALTER TABLE public.sanction_grants ADD CONSTRAINT sanction_grants_grantor_league_id_fkey FOREIGN KEY (grantor_league_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ── 7. schema_dump() v3 — the views element carries reloptions (228's text otherwise) ──
CREATE OR REPLACE FUNCTION public.schema_dump()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_buckets jsonb;
  v_cron    jsonb;
  v_seed    jsonb;
  v_ledger  jsonb;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'public', b.public,
             'file_size_limit', b.file_size_limit, 'allowed_mime_types', to_jsonb(b.allowed_mime_types)
           ) ORDER BY b.id), '[]'::jsonb)
      INTO v_buckets
      FROM storage.buckets b;
  EXCEPTION WHEN OTHERS THEN
    v_buckets := NULL;
  END;

  -- The cron commands carry a live bearer token (059 / 135 were run with
  -- CRON_SECRET pasted in): REDACTED here, so the secret never leaves the
  -- database — the rebuild carries the placeholder the files carry.
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'command', regexp_replace(j.command, 'Bearer [^''"\s]+', 'Bearer __CRON_SECRET__', 'g')
           ) ORDER BY j.jobname), '[]'::jsonb)
      INTO v_cron
      FROM cron.job j;
  EXCEPTION WHEN OTHERS THEN
    v_cron := NULL;
  END;

  -- Reference rows the app cannot run without. ONE table today:
  -- reserved_handles (the root-segment + system-path seed, 006 onward).
  -- `sports` is empty on prod (the registry lives in code); the golf
  -- catalog is DATA (28k courses), copied separately, never a baseline.
  BEGIN
    SELECT jsonb_build_object(
             'reserved_handles', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.handle), '[]'::jsonb) FROM public.reserved_handles r)
           )
      INTO v_seed;
  EXCEPTION WHEN OTHERS THEN
    v_seed := NULL;
  END;

  BEGIN
    SELECT jsonb_build_object('head', max(m.number), 'rows', count(*))
      INTO v_ledger
      FROM public.schema_migrations m;
  EXCEPTION WHEN OTHERS THEN
    v_ledger := NULL;
  END;

  RETURN jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 3,
      'generated_at', now(),
      'role', current_user,
      'server_version', current_setting('server_version'),
      'ledger', v_ledger
    ),
    'extensions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) ORDER BY e.extname), '[]'::jsonb)
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql'
    ),
    'types', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', t.typname,
               'labels', (SELECT jsonb_agg(l.enumlabel ORDER BY l.enumsortorder) FROM pg_enum l WHERE l.enumtypid = t.oid)
             ) ORDER BY t.typname), '[]'::jsonb)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    ),
    'sequences', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', s.sequencename, 'data_type', s.data_type::text,
               'start', s.start_value, 'increment', s.increment_by, 'min', s.min_value, 'max', s.max_value, 'cycle', s.cycle,
               'owned_by', (
                 SELECT c.relname || '.' || a.attname
                 FROM pg_depend d
                 JOIN pg_class c ON c.oid = d.refobjid
                 JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
                 LIMIT 1
               ),
               'identity', EXISTS (
                 SELECT 1 FROM pg_depend d
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   AND d.deptype = 'i'
               ),
               'grants', jsonb_build_object(
                 'anon', has_sequence_privilege('anon', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'authenticated', has_sequence_privilege('authenticated', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE'),
                 'service_role', has_sequence_privilege('service_role', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'USAGE')
               )
             ) ORDER BY s.sequencename), '[]'::jsonb)
      FROM pg_sequences s
      WHERE s.schemaname = 'public'
    ),
    'tables', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname,
               'kind', c.relkind,
               'rls', c.relrowsecurity,
               'rls_forced', c.relforcerowsecurity,
               'comment', obj_description(c.oid, 'pg_class'),
               'columns', (
                 SELECT jsonb_agg(jsonb_build_object(
                          'name', a.attname,
                          'type', format_type(a.atttypid, a.atttypmod),
                          'not_null', a.attnotnull,
                          'default', pg_get_expr(d.adbin, d.adrelid),
                          'identity', a.attidentity,
                          'generated', a.attgenerated,
                          'comment', col_description(c.oid, a.attnum)
                        ) ORDER BY a.attnum)
                 FROM pg_attribute a
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               ),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', c.relname, 'name', k.conname, 'type', k.contype,
               'definition', pg_get_constraintdef(k.oid),
               'index', (SELECT i.relname FROM pg_class i WHERE i.oid = k.conindid AND k.conindid <> 0)
             ) ORDER BY c.relname, k.contype, k.conname), '[]'::jsonb)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ),
    'indexes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'table', i.tablename, 'name', i.indexname, 'definition', i.indexdef,
               'constraint', EXISTS (
                 SELECT 1 FROM pg_constraint k WHERE k.conindid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
               )
             ) ORDER BY i.tablename, i.indexname), '[]'::jsonb)
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
    ),
    'views', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.relname, 'materialized', c.relkind = 'm',
               'definition', pg_get_viewdef(c.oid, true),
               -- 234: the view's reloptions (security_invoker, check_option …) — pg_get_viewdef
               -- never carries them, and a rebuilt view without them is a different view.
               'options', to_jsonb(c.reloptions),
               'grants', (
                 -- has_table_privilege per role × privilege: visible whoever calls
                 -- (role_table_grants showed only the CALLER's grants — 228).
                 SELECT COALESCE(jsonb_object_agg(g.grantee, g.privs), '{}'::jsonb)
                 FROM (
                   SELECT r.grantee,
                          (SELECT jsonb_agg(p.priv ORDER BY p.priv)
                             FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) AS p(priv)
                            WHERE has_table_privilege(r.grantee, c.oid, p.priv)) AS privs
                   FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(grantee)
                 ) g
                 WHERE g.privs IS NOT NULL
               )
             ) ORDER BY c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ),
    'functions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', p.proname,
               'identity_args', pg_get_function_identity_arguments(p.oid),
               'kind', p.prokind,
               'language', l.lanname,
               'definition', pg_get_functiondef(p.oid),
               'grants', jsonb_build_object(
                 'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
               ),
               'comment', obj_description(p.oid, 'pg_proc')
             ) ORDER BY p.proname, oidvectortypes(p.proargtypes)), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ),
    'triggers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
               'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)
             ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
               'permissive', p.permissive, 'roles', to_jsonb(p.roles), 'cmd', p.cmd,
               'qual', p.qual, 'with_check', p.with_check
             ) ORDER BY p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public' OR (p.schemaname = 'storage' AND p.tablename = 'objects')
    ),
    'publications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('publication', pt.pubname, 'table', pt.tablename) ORDER BY pt.pubname, pt.tablename), '[]'::jsonb)
      FROM pg_publication_tables pt
      WHERE pt.schemaname = 'public'
    ),
    'storage_buckets', v_buckets,
    'cron_jobs', v_cron,
    'seed_rows', v_seed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schema_dump() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schema_dump() TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Post-change check (WARNING only — never rolls the file back) ────────────
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM (
      SELECT o.kind, o.id FROM public.organizations o
      EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd WHERE sd.entity_type IN ('league', 'club')
    ) x;
    IF n <> 0 THEN RAISE WARNING '234 CHECK: % org rows without a search document', n; ELSE RAISE NOTICE '234 OK — every org has its search document'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '234 CHECK FAILED: % [%] — the changes above are still committed', SQLERRM, SQLSTATE;
  END;
END $$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (234, '234_org_prep.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 234 APPLIED | 10 | 4 | 28 | 1 | 2 | 0 | 0 | 3 | 234
SELECT '234 APPLIED' AS result,
       (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'c') AS org_fk_cascade_expect_10,
       (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.organizations'::regclass AND conname LIKE '%\_org\_id\_fkey' AND confdeltype = 'n') AS org_fk_setnull_expect_4,
       (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass)) AS fks_to_leagues_clubs_expect_28,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'org_sites_org_uniq' AND contype = 'u') AS org_sites_uniq_expect_1,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('organizations_search_doc', 'organizations_search_doc_delete') AND NOT tgisinternal) AS org_search_triggers_expect_2,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('clubs_search_doc', 'clubs_search_doc_delete', 'leagues_search_doc', 'leagues_search_doc_delete') AND NOT tgisinternal) AS old_search_triggers_expect_0,
       (SELECT count(*) FROM (SELECT o.kind, o.id FROM public.organizations o EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd) x) AS orgs_without_search_doc_expect_0,
       (public.schema_dump() -> 'meta' ->> 'version')::int AS dump_version_expect_3,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_234;

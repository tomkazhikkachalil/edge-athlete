-- ============================================================================
-- 235: Round 5 (organizations unification), step D — THE DROP: the pair
--      columns, their CHECKs, indexes and FKs, org_pair_sync and the three
--      mirrors are gone; `leagues` and `clubs` become VIEWS over
--      `organizations` (merges ALONE — the LAST step before D-ii)
-- ============================================================================
-- After 231 (organizations), 232 (org_id), 233 (the flip), 234 (the prep:
-- org_id FK actions, one site per org, the guards and search on
-- organizations, org_id authoritative on UPDATE) and the code steps D0-a,
-- D0-b, D0-e and D1 — DEPLOYED and proven before this file runs — nothing
-- reads or writes `league_id` / `club_id` on the fifteen pair tables and
-- nothing inserts into `leagues` / `clubs`. This file removes what is left:
--
--   1. The fifteen org_pair_sync triggers and the three mirror triggers,
--      then their eight functions (org_pair_sync, organizations_mirror_league,
--      organizations_mirror_club, organizations_mirror_sources,
--      leagues_search_vector_update, clubs_search_vector_update,
--      search_doc_sync_league, search_doc_sync_club — the last four idle
--      since 234 moved search to organizations).
--   2. Per pair table: the 28 pair FKs, the 14 pairing CHECKs
--      (events_one_scope_check is RE-ADDED over org_id — dropping league_id
--      would have auto-dropped it silently), the 26 pair indexes named for
--      the record, then the 30 columns. Never CASCADE: a hidden dependent
--      fails loudly.
--   3. `DROP TABLE leagues` and `DROP TABLE clubs` — ONE table per statement
--      (the provenance parser captures one ident per DROP TABLE). Their own
--      triggers, indexes, constraints and comments go with them;
--      handle_updated_at() is shared and stays. Prerequisite: zero FKs
--      target them (asserted).
--   4. `CREATE VIEW leagues` / `clubs` WITH (security_invoker = true),
--      projecting EXACTLY the old column sets (clubs: sport_key AS
--      primary_sport; no `kind`) so every `select()` reader keeps its
--      shape, an UPDATE cannot move a row across kinds, and no CHECK
--      OPTION is needed. Grants: Supabase's default privileges hand every
--      new relation ALL to anon, authenticated AND service_role — REVOKE
--      ALL, then GRANT SELECT, UPDATE, DELETE to service_role only. No
--      INSERT (Tom, Sep 22 2026): a stray insert through an old name fails
--      loudly (42501) instead of landing a mis-kinded row. Comments go on
--      organizations (the baseline generator ignores view comments).
--
-- REVERSAL: none short of a PITR / backup restore to the pre-235 point plus
-- the pre-235 code (docs/RUNBOOK_BACKUP.md). A forward reconstruction exists
-- because organizations is lossless (CREATE TABLE leagues AS SELECT … WHERE
-- kind = 'league', re-derive the pair from kind, re-declare 108–233's
-- constraints / indexes / triggers / grants by hand) — the fallback, not
-- the plan. Rehearsed on staging FIRST with the org e2e set green against it.
-- NOT re-runnable in the usual sense: a second run stops in the pre-flight
-- ("already run") with nothing changed — the pre-flight itself names the
-- columns this file drops, and the events CHECK re-add is not IF EXISTS.
-- The result row counts INSERT grants on the views for the API roles only:
-- the OWNER (postgres) always shows every privilege in role_table_grants.
-- ============================================================================

-- ── 0. Pre-flight (aborts BEFORE any change) ────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  -- a re-run stops HERE (the later pre-flight names the columns this file drops)
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 235) THEN RAISE EXCEPTION '235 has already run here — nothing to do'; END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 234 THEN RAISE EXCEPTION '235 needs 234 (ledger head is %)', n; END IF;
  -- the pair and org_id agree on every row of every pair table
  SELECT (SELECT count(*) FROM public.athlete_claim_invites WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.competitions WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.divisions WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.events WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.memberships WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.org_claim_invites WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.org_sites WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.org_staff_audit WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.org_staff_invites WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.registration_windows WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.registrations WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.seasons WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.sport_events WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.teams WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
       + (SELECT count(*) FROM public.venues WHERE org_id IS DISTINCT FROM COALESCE(league_id, club_id))
    INTO n;
  IF n > 0 THEN RAISE EXCEPTION '235 pre-flight: % pair-table rows where org_id disagrees with the pair', n; END IF;
  -- set identity both ways: organizations ≡ leagues ∪ clubs
  SELECT (SELECT count(*) FROM public.leagues l WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = l.id AND o.kind = 'league'))
       + (SELECT count(*) FROM public.clubs c WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c.id AND o.kind = 'club'))
       + (SELECT count(*) FROM public.organizations o WHERE o.kind = 'league' AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = o.id))
       + (SELECT count(*) FROM public.organizations o WHERE o.kind = 'club' AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = o.id))
    INTO n;
  IF n > 0 THEN RAISE EXCEPTION '235 pre-flight: organizations and leagues ∪ clubs differ by % rows', n; END IF;
  -- exactly the 28 pair FKs still target the two tables (234 re-pointed the nine others)
  SELECT count(*) INTO n FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass);
  IF n <> 28 THEN RAISE EXCEPTION '235 pre-flight: expected 28 FKs to leagues / clubs, found %', n; END IF;
  -- 234's objects are in place
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_sites_org_uniq') THEN RAISE EXCEPTION '235 pre-flight: 234 did not run (org_sites_org_uniq missing)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_search_doc' AND NOT tgisinternal) THEN RAISE EXCEPTION '235 pre-flight: 234 did not run (organizations_search_doc missing)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_kind_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION '235 pre-flight: 234 did not run (organizations_kind_immutable missing)'; END IF;
  -- no live function body outside the eight we drop names the pair or the tables (023's lesson)
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname NOT IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources','leagues_search_vector_update','clubs_search_vector_update','search_doc_sync_league','search_doc_sync_club','schema_dump','provenance_inventory')
     AND (p.prosrc ~ '\mleague_id\M' OR p.prosrc ~ '\mclub_id\M' OR p.prosrc ~ '\mpublic\.leagues\M' OR p.prosrc ~ '\mpublic\.clubs\M' OR p.prosrc ~ '\mFROM leagues\M' OR p.prosrc ~ '\mFROM clubs\M');
  IF n > 0 THEN RAISE EXCEPTION '235 pre-flight: % live function(s) still name the pair or the old tables — list them with the query in the header before running', n; END IF;
END $$;

-- ── 1. The sync and the mirrors ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS org_pair_sync ON public.athlete_claim_invites;
DROP TRIGGER IF EXISTS org_pair_sync ON public.competitions;
DROP TRIGGER IF EXISTS org_pair_sync ON public.divisions;
DROP TRIGGER IF EXISTS org_pair_sync ON public.events;
DROP TRIGGER IF EXISTS org_pair_sync ON public.memberships;
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_claim_invites;
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_sites;
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_staff_audit;
DROP TRIGGER IF EXISTS org_pair_sync ON public.org_staff_invites;
DROP TRIGGER IF EXISTS org_pair_sync ON public.registration_windows;
DROP TRIGGER IF EXISTS org_pair_sync ON public.registrations;
DROP TRIGGER IF EXISTS org_pair_sync ON public.seasons;
DROP TRIGGER IF EXISTS org_pair_sync ON public.sport_events;
DROP TRIGGER IF EXISTS org_pair_sync ON public.teams;
DROP TRIGGER IF EXISTS org_pair_sync ON public.venues;
DROP TRIGGER IF EXISTS organizations_mirror_league ON public.leagues;
DROP TRIGGER IF EXISTS organizations_mirror_club ON public.clubs;
DROP TRIGGER IF EXISTS organizations_mirror_sources ON public.organizations;
DROP FUNCTION IF EXISTS public.org_pair_sync();
DROP FUNCTION IF EXISTS public.organizations_mirror_league();
DROP FUNCTION IF EXISTS public.organizations_mirror_club();
DROP FUNCTION IF EXISTS public.organizations_mirror_sources();
-- idle since 234 dropped their search_doc triggers (search syncs from
-- organizations); the search_vector triggers go with their functions here
DROP TRIGGER IF EXISTS leagues_search_vector ON public.leagues;
DROP TRIGGER IF EXISTS clubs_search_vector ON public.clubs;
DROP FUNCTION IF EXISTS public.leagues_search_vector_update();
DROP FUNCTION IF EXISTS public.clubs_search_vector_update();
DROP FUNCTION IF EXISTS public.search_doc_sync_league();
DROP FUNCTION IF EXISTS public.search_doc_sync_club();

-- ── 2. The pair leaves the fifteen tables ───────────────────────────────────
ALTER TABLE public.athlete_claim_invites DROP CONSTRAINT IF EXISTS athlete_claim_invites_league_id_fkey;
ALTER TABLE public.athlete_claim_invites DROP CONSTRAINT IF EXISTS athlete_claim_invites_club_id_fkey;
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_league_id_fkey;
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_club_id_fkey;
ALTER TABLE public.divisions DROP CONSTRAINT IF EXISTS divisions_league_id_fkey;
ALTER TABLE public.divisions DROP CONSTRAINT IF EXISTS divisions_club_id_fkey;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_league_id_fkey;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_club_id_fkey;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_league_id_fkey;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_club_id_fkey;
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_league_id_fkey;
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_club_id_fkey;
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_league_id_fkey;
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_club_id_fkey;
ALTER TABLE public.org_staff_invites DROP CONSTRAINT IF EXISTS org_staff_invites_league_id_fkey;
ALTER TABLE public.org_staff_invites DROP CONSTRAINT IF EXISTS org_staff_invites_club_id_fkey;
ALTER TABLE public.registration_windows DROP CONSTRAINT IF EXISTS registration_windows_league_id_fkey;
ALTER TABLE public.registration_windows DROP CONSTRAINT IF EXISTS registration_windows_club_id_fkey;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_league_id_fkey;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_club_id_fkey;
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_league_id_fkey;
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_club_id_fkey;
ALTER TABLE public.sport_events DROP CONSTRAINT IF EXISTS sport_events_league_id_fkey;
ALTER TABLE public.sport_events DROP CONSTRAINT IF EXISTS sport_events_club_id_fkey;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_league_id_fkey;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_club_id_fkey;
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_league_id_fkey;
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_club_id_fkey;

ALTER TABLE public.athlete_claim_invites DROP CONSTRAINT IF EXISTS athlete_claim_one_org;
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_org_check;
ALTER TABLE public.divisions DROP CONSTRAINT IF EXISTS divisions_org_check;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_one_scope_check;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_org_check;
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_one_org;
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_org_check;
ALTER TABLE public.org_staff_invites DROP CONSTRAINT IF EXISTS org_staff_invites_one_org;
ALTER TABLE public.registration_windows DROP CONSTRAINT IF EXISTS reg_windows_org_check;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_org_check;
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_org_check;
ALTER TABLE public.sport_events DROP CONSTRAINT IF EXISTS sport_events_one_org_check;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_org_check;
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_owner_check;
-- events keep "one scope at most" — over org_id now.
ALTER TABLE public.events ADD CONSTRAINT events_one_scope_check CHECK (num_nonnulls(org_id, division_id, team_id) <= 1);

DROP INDEX IF EXISTS public.idx_competitions_club_id;
DROP INDEX IF EXISTS public.idx_competitions_league_id;
DROP INDEX IF EXISTS public.idx_divisions_club_id;
DROP INDEX IF EXISTS public.idx_divisions_league_id;
DROP INDEX IF EXISTS public.idx_events_club_starts;
DROP INDEX IF EXISTS public.idx_events_league_starts;
DROP INDEX IF EXISTS public.idx_memberships_club;
DROP INDEX IF EXISTS public.idx_memberships_league;
DROP INDEX IF EXISTS public.idx_memberships_staff_club;
DROP INDEX IF EXISTS public.idx_memberships_staff_league;
DROP INDEX IF EXISTS public.idx_org_claim_invites_club;
DROP INDEX IF EXISTS public.idx_org_claim_invites_league;
DROP INDEX IF EXISTS public.org_sites_club_uniq;
DROP INDEX IF EXISTS public.org_sites_league_uniq;
DROP INDEX IF EXISTS public.idx_org_staff_audit_club;
DROP INDEX IF EXISTS public.idx_org_staff_audit_league;
DROP INDEX IF EXISTS public.idx_org_staff_invites_club;
DROP INDEX IF EXISTS public.idx_org_staff_invites_league;
DROP INDEX IF EXISTS public.idx_seasons_club_id;
DROP INDEX IF EXISTS public.idx_seasons_league_id;
DROP INDEX IF EXISTS public.idx_sport_events_club;
DROP INDEX IF EXISTS public.idx_sport_events_league;
DROP INDEX IF EXISTS public.idx_teams_club_id;
DROP INDEX IF EXISTS public.idx_teams_league_id;
DROP INDEX IF EXISTS public.idx_venues_club_id;
DROP INDEX IF EXISTS public.idx_venues_league_id;

ALTER TABLE public.athlete_claim_invites DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.athlete_claim_invites DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.competitions DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.competitions DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.divisions DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.divisions DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.events DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.events DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.memberships DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.memberships DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.org_claim_invites DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.org_claim_invites DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.org_sites DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.org_sites DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.org_staff_audit DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.org_staff_audit DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.org_staff_invites DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.org_staff_invites DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.registration_windows DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.registration_windows DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.registrations DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.registrations DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.seasons DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.seasons DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.sport_events DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.sport_events DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.teams DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.teams DROP COLUMN IF EXISTS club_id;
ALTER TABLE public.venues DROP COLUMN IF EXISTS league_id;
ALTER TABLE public.venues DROP COLUMN IF EXISTS club_id;

-- ── 3. The two tables go ────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('public.leagues'::regclass, 'public.clubs'::regclass);
  IF n <> 0 THEN RAISE EXCEPTION '235: % FK(s) still target leagues / clubs', n; END IF;
END $$;
DROP TRIGGER IF EXISTS leagues_updated_at ON public.leagues;
DROP TRIGGER IF EXISTS handle_updated_at_clubs ON public.clubs;
DROP TABLE IF EXISTS public.leagues;
DROP TABLE IF EXISTS public.clubs;

-- ── 4. The old names live on as views over organizations ───────────────────
CREATE OR REPLACE VIEW public.leagues WITH (security_invoker = true) AS
  SELECT id, name, description, sport_key, owner_profile_id, place_id, city, region, region_code, country, country_code, lat, lng, location_source, search_vector, created_at, updated_at, operates_competitions, operates_teams, approved_at, visibility, join_policy, listing_status
    FROM public.organizations
   WHERE kind = 'league';
CREATE OR REPLACE VIEW public.clubs WITH (security_invoker = true) AS
  SELECT id, name, description, location, created_at, updated_at, search_vector, place_id, city, region, region_code, country, country_code, lat, lng, location_source, owner_profile_id, operates_teams, operates_competitions, approved_at, sport_key AS primary_sport, visibility, join_policy, listing_status
    FROM public.organizations
   WHERE kind = 'club';
REVOKE ALL ON public.leagues, public.clubs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, DELETE ON public.leagues, public.clubs TO service_role;
COMMENT ON TABLE public.organizations IS 'One row per league or club (Round 5, 231–235): kind is the org''s self-description and route family; operates_competitions / operates_teams are the behaviour switches. `leagues` and `clubs` are security_invoker VIEWS over this table (235) — SELECT / UPDATE / DELETE for service_role, never INSERT.';

NOTIFY pgrst, 'reload schema';

-- ── Post-change check (WARNING only — never rolls the file back) ────────────
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM (SELECT o.kind, o.id FROM public.organizations o EXCEPT SELECT sd.entity_type, sd.entity_id FROM public.search_documents sd) x;
    IF n <> 0 THEN RAISE WARNING '235 CHECK: % org rows without a search document', n; ELSE RAISE NOTICE '235 OK — every org has its search document'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '235 CHECK FAILED: % [%] — the changes above are still committed', SQLERRM, SQLSTATE;
  END;
END $$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (235, '235_org_drop.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 235 APPLIED | 0 | 0 | 0 | 0 | 2 | 0 | 235
SELECT '235 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('league_id', 'club_id') AND table_name IN ('athlete_claim_invites','competitions','divisions','events','memberships','org_claim_invites','org_sites','org_staff_audit','org_staff_invites','registration_windows','registrations','seasons','sport_events','teams','venues')) AS pair_columns_expect_0,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources') AND NOT tgisinternal) AS sync_and_mirror_triggers_expect_0,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('org_pair_sync','organizations_mirror_league','organizations_mirror_club','organizations_mirror_sources','leagues_search_vector_update','clubs_search_vector_update','search_doc_sync_league','search_doc_sync_club')) AS dead_functions_expect_0,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('leagues','clubs') AND c.relkind = 'r') AS old_tables_expect_0,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('leagues','clubs') AND c.relkind = 'v' AND 'security_invoker=true' = ANY(c.reloptions)) AS invoker_views_expect_2,
       (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('leagues','clubs') AND privilege_type = 'INSERT' AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')) AS api_view_insert_grants_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_235;

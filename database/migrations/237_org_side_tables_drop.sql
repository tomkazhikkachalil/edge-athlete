-- ============================================================================
-- 237: Round 5 (organizations unification), step D-ii DROP — the six
--      side-named tables and sanction_grants' three side columns go; the
--      org columns 236 added become NOT NULL (merges ALONE; runs AFTER the
--      D3 code is DEPLOYED and proven — nothing may still read or write
--      what this file drops)
-- ============================================================================
-- 236 created affiliations / org_requests / org_join_requests and the two
-- sanction org columns beside the old shapes and backfilled them; the D3
-- code switched every reader and writer to the new shapes. In the window
-- between 236 running and D3 deploying, the OLD code kept writing the OLD
-- shapes — so this file's pre-flight RE-RUNS 236's backfills (idempotent:
-- ON CONFLICT DO NOTHING / WHERE … IS NULL) before it checks anything, and
-- aborts unless every old row has its new row. Then:
--
--   1. sanction_grants.grantor_org_id / grantee_org_id SET NOT NULL
--   2. DROP TABLE league_clubs · league_affiliations · league_requests ·
--      club_requests · league_join_requests · club_join_requests — one
--      table per statement (the provenance parser captures one ident per
--      DROP TABLE), never CASCADE (a hidden dependent fails loudly). Their
--      own FKs, indexes, CHECKs, triggers and comments go with them;
--      handle_updated_at() is shared and stays.
--   3. sanction_grants DROP COLUMN grantor_league_id · grantee_kind ·
--      grantee_id (their index and CHECK named first, for the record).
--
-- REVERSAL: none short of a PITR / backup restore to the pre-237 point plus
-- the pre-D3 code (docs/RUNBOOK_BACKUP.md). The new shapes are lossless
-- copies, so a forward reconstruction of the old tables exists (CREATE
-- TABLE league_clubs AS SELECT … FROM affiliations JOIN organizations …,
-- re-declare 118 / 167 / 116 / 117 / 176 / 177's constraints by hand) —
-- the fallback, not the plan. Rehearsed on staging FIRST with the D-ii
-- e2e set green against it.
-- NOT re-runnable in the usual sense: a second run stops in the pre-flight
-- ("already run") with nothing changed.
-- ============================================================================

-- ── 0. Pre-flight: re-backfill the window, then assert (EXCEPTIONs before any drop) ──
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 237) THEN RAISE EXCEPTION '237 has already run here — nothing to do'; END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 236 THEN RAISE EXCEPTION '237 needs 236 (ledger head is %)', n; END IF;
END $$;

-- 236's backfills, verbatim — the rows the deployed code wrote to the old shapes after 236 ran
INSERT INTO public.affiliations (org_id, parent_org_id, affiliation_type, status, initiated_by, requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at)
SELECT club_id, league_id, affiliation_type, status,
       CASE initiated_by WHEN 'club' THEN 'child' ELSE 'parent' END,
       requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at
  FROM public.league_clubs
ON CONFLICT (org_id, parent_org_id) DO NOTHING;
INSERT INTO public.affiliations (org_id, parent_org_id, affiliation_type, status, initiated_by, requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at)
SELECT league_id, parent_league_id, affiliation_type, status, initiated_by,
       requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at
  FROM public.league_affiliations
ON CONFLICT (org_id, parent_org_id) DO NOTHING;
INSERT INTO public.org_requests (id, kind, requester_profile_id, name, description, sport_key, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_org_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft)
SELECT id, 'league', requester_profile_id, name, description, sport_key, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_league_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft
  FROM public.league_requests
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_requests (id, kind, requester_profile_id, name, description, sport_key, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_org_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft)
SELECT id, 'club', requester_profile_id, name, description, NULL, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_club_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft
  FROM public.club_requests
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_join_requests (id, org_id, profile_id, message, created_at)
SELECT id, league_id, profile_id, message, created_at FROM public.league_join_requests
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_join_requests (id, org_id, profile_id, message, created_at)
SELECT id, club_id, profile_id, message, created_at FROM public.club_join_requests
ON CONFLICT (id) DO NOTHING;
UPDATE public.sanction_grants SET grantor_org_id = grantor_league_id WHERE grantor_org_id IS NULL;
UPDATE public.sanction_grants SET grantee_org_id = grantee_id WHERE grantee_org_id IS NULL;

DO $$
DECLARE n int;
BEGIN
  -- every old row has its new row (the drop loses nothing)
  SELECT (SELECT count(*) FROM public.league_clubs lc WHERE NOT EXISTS (SELECT 1 FROM public.affiliations a WHERE a.org_id = lc.club_id AND a.parent_org_id = lc.league_id))
       + (SELECT count(*) FROM public.league_affiliations la WHERE NOT EXISTS (SELECT 1 FROM public.affiliations a WHERE a.org_id = la.league_id AND a.parent_org_id = la.parent_league_id))
       + (SELECT count(*) FROM public.league_requests r WHERE NOT EXISTS (SELECT 1 FROM public.org_requests o WHERE o.id = r.id))
       + (SELECT count(*) FROM public.club_requests r WHERE NOT EXISTS (SELECT 1 FROM public.org_requests o WHERE o.id = r.id))
       + (SELECT count(*) FROM public.league_join_requests j WHERE NOT EXISTS (SELECT 1 FROM public.org_join_requests o WHERE o.id = j.id))
       + (SELECT count(*) FROM public.club_join_requests j WHERE NOT EXISTS (SELECT 1 FROM public.org_join_requests o WHERE o.id = j.id))
       + (SELECT count(*) FROM public.sanction_grants WHERE grantor_org_id IS NULL OR grantee_org_id IS NULL)
    INTO n;
  IF n > 0 THEN RAISE EXCEPTION '237 pre-flight: % old row(s) without a new row after the re-backfill', n; END IF;
  -- the new shapes are in place
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('affiliations', 'org_requests', 'org_join_requests')) <> 3 THEN RAISE EXCEPTION '237 pre-flight: 236 did not run (the three org tables are missing)'; END IF;
  -- no live function body names what this file drops (023's lesson)
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname NOT IN ('schema_dump', 'provenance_inventory')
     AND (p.prosrc ~ '\mleague_clubs\M' OR p.prosrc ~ '\mleague_affiliations\M' OR p.prosrc ~ '\mleague_requests\M' OR p.prosrc ~ '\mclub_requests\M'
          OR p.prosrc ~ '\mleague_join_requests\M' OR p.prosrc ~ '\mclub_join_requests\M' OR p.prosrc ~ '\mgrantor_league_id\M' OR p.prosrc ~ '\mgrantee_kind\M');
  IF n > 0 THEN RAISE EXCEPTION '237 pre-flight: % live function(s) still name a shape this file drops', n; END IF;
END $$;

-- ── 1. The org columns are the columns ──────────────────────────────────────
ALTER TABLE public.sanction_grants ALTER COLUMN grantor_org_id SET NOT NULL;
ALTER TABLE public.sanction_grants ALTER COLUMN grantee_org_id SET NOT NULL;

-- ── 2. The six side-named tables go (one per statement; never CASCADE) ──────
DROP TABLE IF EXISTS public.league_clubs;
DROP TABLE IF EXISTS public.league_affiliations;
DROP TABLE IF EXISTS public.league_join_requests;
DROP TABLE IF EXISTS public.club_join_requests;
DROP TABLE IF EXISTS public.league_requests;
DROP TABLE IF EXISTS public.club_requests;

-- ── 3. sanction_grants' three side columns go ───────────────────────────────
DROP INDEX IF EXISTS public.idx_sanction_grants_grantee;
ALTER TABLE public.sanction_grants DROP CONSTRAINT IF EXISTS sanction_grants_kind_check;
ALTER TABLE public.sanction_grants DROP CONSTRAINT IF EXISTS sanction_grants_grantor_league_id_fkey;
ALTER TABLE public.sanction_grants DROP COLUMN IF EXISTS grantor_league_id;
ALTER TABLE public.sanction_grants DROP COLUMN IF EXISTS grantee_kind;
ALTER TABLE public.sanction_grants DROP COLUMN IF EXISTS grantee_id;
COMMENT ON TABLE public.sanction_grants IS 'The append-only sanction history (167): one row per grant a parent org opened for a child (236: grantor_org_id → grantee_org_id, both organizations; revoked_at closes it). The polymorphic (grantee_kind, grantee_id) and grantor_league_id left in 237.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (237, '237_org_side_tables_drop.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 237 APPLIED | 0 | 0 | 2 | 3 | 237
SELECT '237 APPLIED' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('league_clubs', 'league_affiliations', 'league_requests', 'club_requests', 'league_join_requests', 'club_join_requests')) AS old_tables_expect_0,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_league_id', 'grantee_kind', 'grantee_id')) AS old_sanction_columns_expect_0,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_org_id', 'grantee_org_id') AND is_nullable = 'NO') AS sanction_org_columns_not_null_expect_2,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('affiliations', 'org_requests', 'org_join_requests')) AS org_tables_expect_3,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_237;

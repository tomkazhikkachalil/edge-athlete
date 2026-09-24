-- ============================================================================
-- 236: Round 5 (organizations unification), step D-ii ADDITIVE — the four
--      side-specific shapes become ORG shapes: `affiliations`, `org_requests`,
--      `org_join_requests` are created and backfilled; `sanction_grants`
--      gains grantor_org_id / grantee_org_id (merges ALONE; the old tables
--      and columns stay until 237, after the D3 code switches over)
-- ============================================================================
-- After 235 every org is one row of `organizations` and the fifteen pair
-- tables name it by `org_id`. Four shapes still spell the SIDE in their
-- table or column names because the two sides used to be two tables:
--
--   league_clubs (club ↔ league) + league_affiliations (league ↔ parent
--   league)                        → affiliations (org_id = the CHILD,
--                                    parent_org_id = the PARENT; the kind
--                                    of either end is organizations.kind)
--   league_requests + club_requests → org_requests (kind; sport_key nullable,
--                                    required for a league; created_org_id)
--   league_join_requests + club_join_requests → org_join_requests (org_id)
--   sanction_grants.grantor_league_id / (grantee_kind, grantee_id)
--                                  → grantor_org_id / grantee_org_id (the
--                                    kind is the org's; no polymorphic pair)
--
-- This file is ADDITIVE and safe under the deployed code: the old tables
-- and columns are untouched and stay the readers' source until the D3 code
-- (which reads and writes the new shapes) is deployed; 237 then drops the
-- old ones. Backfills are `ON CONFLICT DO NOTHING` (re-runnable); ids are
-- carried over where the old shape had them (the two request tables, the
-- two join-request tables — random uuids, no collision possible).
--
-- Pre-flight (EXCEPTIONs, before any change): ledger head ≥ 235; no profile
-- with a pending request on BOTH sides (the unified one_pending unique);
-- every live sanction grantee is an organization (the new FK); no duplicate
-- live (grantor, grantee) pair (the new partial unique). Prod, Sep 23 2026:
-- 0 league requests · 1 club request · 0 join requests · 0 sanction grants —
-- all three preconditions trivially true; staging may need a QA sweep.
--
-- RLS on, no policies, service_role only (the 113 / 117 posture-A rule):
-- every reader is a server route on the admin client.
--
-- REVERSAL (SQL): DROP TABLE public.affiliations; DROP TABLE public.org_requests;
-- DROP TABLE public.org_join_requests; ALTER TABLE public.sanction_grants
-- DROP COLUMN grantor_org_id, DROP COLUMN grantee_org_id; DELETE FROM
-- schema_migrations WHERE number = 236. Nothing else changes.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 235 THEN RAISE EXCEPTION '236 needs 235 (ledger head is %)', n; END IF;
  SELECT count(*) INTO n
    FROM public.league_requests l JOIN public.club_requests c ON c.requester_profile_id = l.requester_profile_id
   WHERE l.status = 'pending' AND c.status = 'pending';
  IF n > 0 THEN RAISE EXCEPTION '236 pre-flight: % profile(s) hold a pending request on BOTH sides — decide one before the unified one_pending unique', n; END IF;
  SELECT count(*) INTO n FROM public.sanction_grants g WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = g.grantee_id);
  IF n > 0 THEN RAISE EXCEPTION '236 pre-flight: % sanction grant(s) name a grantee that is not an organization', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT grantor_league_id, grantee_id FROM public.sanction_grants WHERE revoked_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION '236 pre-flight: % duplicate live (grantor, grantee) sanction pair(s) — revoke the extras first', n; END IF;
END $$;

-- ── 1. affiliations — the one edge table (child → parent) ───────────────────
CREATE TABLE IF NOT EXISTS public.affiliations (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  affiliation_type text NOT NULL DEFAULT 'partner_of',
  status text NOT NULL DEFAULT 'pending',
  initiated_by text NOT NULL,
  requested_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT affiliations_pkey PRIMARY KEY (org_id, parent_org_id),
  CONSTRAINT affiliations_no_self CHECK (org_id <> parent_org_id),
  CONSTRAINT affiliations_type_check CHECK (affiliation_type IN ('partner_of', 'member_of', 'sanctioned_by')),
  CONSTRAINT affiliations_status_check CHECK (status IN ('pending', 'active')),
  CONSTRAINT affiliations_initiated_by_check CHECK (initiated_by IN ('child', 'parent'))
);
CREATE INDEX IF NOT EXISTS idx_affiliations_parent ON public.affiliations (parent_org_id);
DROP TRIGGER IF EXISTS affiliations_updated_at ON public.affiliations;
CREATE TRIGGER affiliations_updated_at BEFORE UPDATE ON public.affiliations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.affiliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.affiliations FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.affiliations IS 'One edge per (child org, parent org) — Round 5 D-ii (236). A club in a league: org_id = the club, parent_org_id = the league. A league under a parent league: org_id = the child league. initiated_by is which END asked (child | parent). Replaces league_clubs + league_affiliations (dropped in 237).';

-- the club ↔ league edges: the club is the child; `club` asked → child
INSERT INTO public.affiliations (org_id, parent_org_id, affiliation_type, status, initiated_by, requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at)
SELECT club_id, league_id, affiliation_type, status,
       CASE initiated_by WHEN 'club' THEN 'child' ELSE 'parent' END,
       requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at
  FROM public.league_clubs
ON CONFLICT (org_id, parent_org_id) DO NOTHING;
-- the league ↔ parent league edges, as they are
INSERT INTO public.affiliations (org_id, parent_org_id, affiliation_type, status, initiated_by, requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at)
SELECT league_id, parent_league_id, affiliation_type, status, initiated_by,
       requested_by_profile_id, decided_by_profile_id, created_at, decided_at, updated_at
  FROM public.league_affiliations
ON CONFLICT (org_id, parent_org_id) DO NOTHING;

-- ── 2. org_requests — the two request tables as one, with a kind ────────────
CREATE TABLE IF NOT EXISTS public.org_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  requester_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sport_key text,
  place_id uuid REFERENCES public.places(id) ON DELETE SET NULL,
  city text,
  region text,
  region_code text,
  country text,
  country_code text,
  lat double precision,
  lng double precision,
  location_source text,
  status text NOT NULL DEFAULT 'pending',
  decline_reason text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  operates_competitions boolean,
  operates_teams boolean,
  structure_draft jsonb,
  connections_draft jsonb,
  site_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT org_requests_kind_check CHECK (kind IN ('league', 'club')),
  CONSTRAINT org_requests_league_sport_key_check CHECK (kind <> 'league' OR sport_key IS NOT NULL),
  CONSTRAINT org_requests_status_check CHECK (status IN ('pending', 'approved', 'declined', 'unlisted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS org_requests_one_pending ON public.org_requests (requester_profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_requests_status ON public.org_requests (kind, status, created_at DESC);
DROP TRIGGER IF EXISTS org_requests_updated_at ON public.org_requests;
CREATE TRIGGER org_requests_updated_at BEFORE UPDATE ON public.org_requests FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.org_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_requests FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.org_requests IS 'A request to create an org — Round 5 D-ii (236): kind (league | club; a league needs sport_key), the wizard drafts, the decision, the org it created. One pending request per profile across BOTH kinds. Replaces league_requests + club_requests (dropped in 237).';

INSERT INTO public.org_requests (id, kind, requester_profile_id, name, description, sport_key, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_org_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft)
SELECT id, 'league', requester_profile_id, name, description, sport_key, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_league_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft
  FROM public.league_requests
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_requests (id, kind, requester_profile_id, name, description, sport_key, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_org_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft)
SELECT id, 'club', requester_profile_id, name, description, NULL, place_id, city, region, region_code, country, country_code, lat, lng, location_source, status, decline_reason, reviewed_by, decided_at, created_club_id, created_at, updated_at, operates_competitions, operates_teams, structure_draft, connections_draft, site_draft
  FROM public.club_requests
ON CONFLICT (id) DO NOTHING;

-- ── 3. org_join_requests ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_join_requests_org_profile_key UNIQUE (org_id, profile_id)
);
CREATE INDEX IF NOT EXISTS org_join_requests_org_idx ON public.org_join_requests (org_id, created_at);
ALTER TABLE public.org_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_join_requests FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.org_join_requests IS 'A member''s request to join an org whose join_policy is approval — Round 5 D-ii (236); one per (org, profile). Replaces league_join_requests + club_join_requests (dropped in 237).';

INSERT INTO public.org_join_requests (id, org_id, profile_id, message, created_at)
SELECT id, league_id, profile_id, message, created_at FROM public.league_join_requests
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_join_requests (id, org_id, profile_id, message, created_at)
SELECT id, club_id, profile_id, message, created_at FROM public.club_join_requests
ON CONFLICT (id) DO NOTHING;

-- ── 4. sanction_grants — both ends are orgs ─────────────────────────────────
ALTER TABLE public.sanction_grants ADD COLUMN IF NOT EXISTS grantor_org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.sanction_grants ADD COLUMN IF NOT EXISTS grantee_org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
UPDATE public.sanction_grants SET grantor_org_id = grantor_league_id WHERE grantor_org_id IS NULL;
UPDATE public.sanction_grants SET grantee_org_id = grantee_id WHERE grantee_org_id IS NULL;
ALTER TABLE public.sanction_grants ALTER COLUMN grantor_org_id SET NOT NULL;
ALTER TABLE public.sanction_grants ALTER COLUMN grantee_org_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sanction_grants_live_pair ON public.sanction_grants (grantor_org_id, grantee_org_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sanction_grants_grantee_org ON public.sanction_grants (grantee_org_id);
COMMENT ON COLUMN public.sanction_grants.grantor_org_id IS 'The sanctioning org (236) — replaces grantor_league_id (dropped in 237).';
COMMENT ON COLUMN public.sanction_grants.grantee_org_id IS 'The sanctioned org (236) — replaces (grantee_kind, grantee_id); the kind is organizations.kind. Dropped in 237 with them.';

NOTIFY pgrst, 'reload schema';

-- ── Post-change check (WARNING only — never rolls the file back) ────────────
DO $$
DECLARE a int; b int; c int;
BEGIN
  BEGIN
    SELECT (SELECT count(*) FROM public.affiliations) - (SELECT count(*) FROM public.league_clubs) - (SELECT count(*) FROM public.league_affiliations) INTO a;
    SELECT (SELECT count(*) FROM public.org_requests) - (SELECT count(*) FROM public.league_requests) - (SELECT count(*) FROM public.club_requests) INTO b;
    SELECT (SELECT count(*) FROM public.org_join_requests) - (SELECT count(*) FROM public.league_join_requests) - (SELECT count(*) FROM public.club_join_requests) INTO c;
    IF a <> 0 OR b <> 0 OR c <> 0 THEN RAISE WARNING '236 CHECK: row-count deltas affiliations % · org_requests % · org_join_requests % (expected 0 0 0)', a, b, c;
    ELSE RAISE NOTICE '236 OK — every old row has its new row'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '236 CHECK FAILED: % [%] — the changes above are still committed', SQLERRM, SQLSTATE;
  END;
END $$;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (236, '236_org_side_tables.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 236 APPLIED | 3 | 0 | 0 | 0 | 2 | 236
SELECT '236 APPLIED' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('affiliations', 'org_requests', 'org_join_requests')) AS new_tables_expect_3,
       (SELECT count(*) FROM public.affiliations) - (SELECT count(*) FROM public.league_clubs) - (SELECT count(*) FROM public.league_affiliations) AS affiliations_delta_expect_0,
       (SELECT count(*) FROM public.org_requests) - (SELECT count(*) FROM public.league_requests) - (SELECT count(*) FROM public.club_requests) AS requests_delta_expect_0,
       (SELECT count(*) FROM public.org_join_requests) - (SELECT count(*) FROM public.league_join_requests) - (SELECT count(*) FROM public.club_join_requests) AS join_requests_delta_expect_0,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanction_grants' AND column_name IN ('grantor_org_id', 'grantee_org_id') AND is_nullable = 'NO') AS sanction_org_columns_expect_2,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_236;

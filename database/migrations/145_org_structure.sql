-- ============================================================================
-- 145: seasons, divisions, teams — the program structure (phase 0, 0.5)
-- ============================================================================
-- The layer the masterplan's phases 1–5 stand on (docs/
-- ORG_PLATFORM_MASTERPLAN.md §3.2): per-org SEASONS, per-season DIVISIONS
-- (the survivability layer — never hang hundreds of teams off an org), and
-- PERSISTENT TEAMS placed into divisions by TEAM_ENTRIES.
--
-- Tom's decisions (Aug 31):
--   * PER-ORG seasons — a hockey association's Sep–Apr and a golf club's
--     May–Oct are different rows; rollover clones within the org. The org
--     pair is REQUIRED (num_nonnulls = 1).
--   * team_entries is the PAIR (team_id, division_id) — AMENDED from the
--     earlier triple: divisions are per-season rows, so the division
--     functionally determines the season; a denormalized season_id would
--     be a consistency obligation nothing enforces. Side effect, a
--     feature: a team may enter TWO divisions in one season (playing up).
--     If one-division-per-season is ever wanted, THAT is the moment
--     season_id gets denormalized here with UNIQUE (team_id, season_id).
--   * Teams PERSIST (rollover re-enters the same row — teams_org_name_uniq
--     means name reuse across years never needs a duplicate); the console
--     archives via status, deletes only for admin mistake-cleanup.
--   * v1 surface is the ADMIN console (/dashboard/structure); org-manager
--     CRUD arrives with phase 1's dashboard.
--
-- App-layer consistency (no cross-row CHECKs in the house):
--   * division.org must equal its season's org — validated ONCE in the
--     division-create route.
--   * entry: team.org must equal division.org — validated in the entry
--     route.
--   * sport_key is app-gated (isSportEnabled); DB stays plain text — the
--     registry is app-side (the 113 convention).
--
-- memberships: scope CHECK widens to org|division|team and scope_id
-- becomes REQUIRED for sub-org scopes; season_id gains its FK (the job
-- 140's header reserved for this migration). memberships_uniq is
-- DELIBERATELY UNTOUCHED — 144's ON CONFLICT names it, and 140's header
-- forbids re-keying; the grid asserts it survives. scope_id stays a bare
-- uuid (polymorphic across divisions/teams — referent integrity is
-- app-layer and arrives with 0.9's writer).
--
-- ORDER-STRICT: the scope-pinned-reads PR must be DEPLOYED before this
-- runs (the widening arms the scope landmine those filters defuse), and
-- this runs BEFORE merging the structure PR (its console writes these
-- tables; GETs degrade to empty pre-145).
-- Run AFTER 144. Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP team_entries,
-- divisions, teams, seasons (child-first); re-narrow the two memberships
-- CHECKs to their 140 definitions; DROP CONSTRAINT memberships_season_fk;
-- DROP INDEX idx_memberships_season.
-- ============================================================================

-- ── Pre-flight: NULLS NOT DISTINCT needs PG15+ ──────────────────────────────
DO $$ BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '145 requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT); server is %',
      current_setting('server_version');
  END IF;
END $$;

-- ── seasons ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id    uuid REFERENCES clubs(id) ON DELETE CASCADE,
  label      text NOT NULL,
  starts_on  date,
  ends_on    date,
  sport_key  text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT seasons_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  CONSTRAINT seasons_date_order_check
    CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT seasons_org_label_uniq UNIQUE NULLS NOT DISTINCT (league_id, club_id, label)
);

DROP TRIGGER IF EXISTS seasons_updated_at ON seasons;
CREATE TRIGGER seasons_updated_at
  BEFORE UPDATE ON seasons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── divisions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS divisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id           uuid REFERENCES clubs(id) ON DELETE CASCADE,
  season_id         uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  sport_key         text NOT NULL,
  name              text NOT NULL,
  age_band          text,
  gender_stream     text,
  tier              text,
  capacity_estimate integer,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT divisions_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  CONSTRAINT divisions_season_name_uniq UNIQUE (season_id, name)
);

-- ── teams ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id      uuid REFERENCES clubs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  display_name text,
  status       text NOT NULL DEFAULT 'active'
    CONSTRAINT teams_status_check CHECK (status IN ('active', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT teams_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  CONSTRAINT teams_org_name_uniq UNIQUE NULLS NOT DISTINCT (league_id, club_id, name)
);

DROP TRIGGER IF EXISTS teams_updated_at ON teams;
CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── team_entries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  division_id uuid NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT team_entries_uniq UNIQUE (team_id, division_id)
);

-- ── RLS: service-only like leagues/clubs/memberships (113/117/140) — NOT
-- venues. Public projection is phase 3's spike; SELECT policies are
-- additive later. ─────────────────────────────────────────────────────────────
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON seasons, divisions, teams, team_entries FROM PUBLIC, anon, authenticated;

-- ── memberships: scope widening + the season FK (140's reserved job) ────────
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_scope_type_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_scope_type_check
  CHECK (scope_type IN ('org', 'division', 'team'));

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_org_scope_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_org_scope_check
  CHECK ((scope_type = 'org' AND scope_id IS NULL)
      OR (scope_type <> 'org' AND scope_id IS NOT NULL));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_season_fk') THEN
    ALTER TABLE memberships ADD CONSTRAINT memberships_season_fk
      FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_seasons_league_id ON seasons (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_seasons_club_id ON seasons (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_divisions_league_id ON divisions (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_divisions_club_id ON divisions (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_divisions_season ON divisions (season_id);
CREATE INDEX IF NOT EXISTS idx_teams_league_id ON teams (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_club_id ON teams (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_entries_division ON team_entries (division_id);
CREATE INDEX IF NOT EXISTS idx_memberships_season ON memberships (season_id) WHERE season_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'seasons') AS seasons_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'divisions') AS divisions_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'teams') AS teams_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'team_entries') AS entries_exists,
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE relname IN ('seasons', 'divisions', 'teams', 'team_entries')) AS all_rls_on,
  NOT (has_table_privilege('anon', 'seasons', 'SELECT')
    OR has_table_privilege('anon', 'divisions', 'SELECT')
    OR has_table_privilege('anon', 'teams', 'SELECT')
    OR has_table_privilege('anon', 'team_entries', 'SELECT')) AS anon_revoked,
  NOT (has_table_privilege('authenticated', 'seasons', 'SELECT')
    OR has_table_privilege('authenticated', 'teams', 'SELECT')) AS authed_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_scope_type_check') LIKE '%team%' AS scope_check_widened,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_org_scope_check') LIKE '%IS NOT NULL%' AS org_scope_check_swapped,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_season_fk') AS season_fk_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'seasons_org_label_uniq') LIKE '%NULLS NOT DISTINCT%' AS season_label_uniq_nnd,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'teams_org_name_uniq') LIKE '%NULLS NOT DISTINCT%' AS team_name_uniq_nnd,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_season_name_uniq') AS division_name_uniq,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_entries_uniq') AS entries_uniq,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'memberships_uniq')
    LIKE '%league_id, club_id, profile_id, kind, scope_type, scope_id, season_id%' AS memberships_uniq_untouched,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
    'idx_seasons_league_id','idx_seasons_club_id','idx_divisions_league_id','idx_divisions_club_id',
    'idx_divisions_season','idx_teams_league_id','idx_teams_club_id','idx_team_entries_division',
    'idx_memberships_season')) = 9 AS nine_indexes,
  (SELECT count(*) FROM seasons) AS seasons_info,
  (SELECT count(*) FROM divisions) AS divisions_info,
  (SELECT count(*) FROM teams) AS teams_info,
  (SELECT count(*) FROM team_entries) AS entries_info;
-- Expect: true × 16, then four info counts (0 on first run).

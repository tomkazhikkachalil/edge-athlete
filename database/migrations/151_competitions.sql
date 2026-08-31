-- ============================================================================
-- 151: competitions + competition_entries — the competition model opens
-- (phase 2, round 1)
-- ============================================================================
-- Masterplan §3.3's first two tables: a COMPETITION owned by one org for
-- one season (optionally pinned to a division for house play), and its
-- ENTRIES — the polymorphic entrant list (team XOR athlete). Contests,
-- results, and standings arrive in rounds 2–3 (migs 152–153).
--
-- Tom's phase-2 decisions (Aug 31):
--   * FIVE rounds: R1 this core → R2 contests/results → R3 standings +
--     the public-projection spike → R4 cross-org rep → R5 leaderboard.
--   * Entries tie to TEAMS, not team_entries — a rep team from another
--     org has no team_entry under the owner league, so team_entries can
--     never be the ref. When competitions.division_id is set, the
--     entered team must hold a team_entry in that division — app-layer,
--     once, in the entry route (the house no-cross-row-CHECKs rule).
--   * Polymorphism lives in THIS table only: separate FK columns +
--     num_nonnulls = 1 (the 146 rationale — a generic type/id pair
--     forfeits FK integrity). contest_participants (152) reference
--     entry_id, never team/profile again.
--   * visibility defaults PRIVATE — the R3 spike page and public org
--     sections show only visibility='public' competitions.
--
-- Front-loaded CHECK values (allowed-but-unsent is harmless; the reverse
-- is a prod 23514): formats bracket|meet and entrant ad_hoc_team are
-- app-gated OFF in v1; entry status pending|rejected|withdrawn arm in
-- R4 (cross-org entries default 'pending'); seed/pool are bracket room.
--
-- App-layer consistency (competition-server.ts, ONCE):
--   * season.org == competition.org; division belongs to that season.
--   * format×entrant_type compatibility (fixture⇒team,
--     leaderboard⇒athlete in v1); entrant kind matches entrant_type.
--   * Entered teams: own-org in v1 (R4 widens to affiliated orgs);
--     athlete entrants resolve through ROSTER-kind memberships only
--     (§8 invariant 3 — the follow edge is never a pipe).
--   * sport_key / format / scoring_rule are plain text, app-gated (the
--     113 convention — the registry is app-side).
--
-- ORDER-STRICT: run AFTER 150, BEFORE merging the manager-routes/console
-- PRs (their GETs degrade to empty pre-151; writes would 42P01).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP competition_entries,
-- competitions (child-first).
-- ============================================================================

-- ── Pre-flight: NULLS NOT DISTINCT needs PG15+ ──────────────────────────────
DO $$ BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '151 requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT); server is %',
      current_setting('server_version');
  END IF;
END $$;

-- ── competitions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id      uuid REFERENCES clubs(id) ON DELETE CASCADE,
  season_id    uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  division_id  uuid REFERENCES divisions(id) ON DELETE SET NULL,
  sport_key    text NOT NULL,
  name         text NOT NULL,
  format       text NOT NULL
    CONSTRAINT competitions_format_check
    CHECK (format IN ('fixture', 'leaderboard', 'bracket', 'meet')),
  entrant_type text NOT NULL
    CONSTRAINT competitions_entrant_type_check
    CHECK (entrant_type IN ('team', 'athlete', 'ad_hoc_team')),
  scoring_rule text,
  status       text NOT NULL DEFAULT 'draft'
    CONSTRAINT competitions_status_check
    CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  visibility   text NOT NULL DEFAULT 'private'
    CONSTRAINT competitions_visibility_check
    CHECK (visibility IN ('public', 'private')),
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT competitions_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  CONSTRAINT competitions_org_season_name_uniq
    UNIQUE NULLS NOT DISTINCT (league_id, club_id, season_id, name)
);

DROP TRIGGER IF EXISTS competitions_updated_at ON competitions;
CREATE TRIGGER competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── competition_entries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competition_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id        uuid REFERENCES teams(id) ON DELETE CASCADE,
  profile_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'approved'
    CONSTRAINT competition_entries_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  seed           integer,
  pool           text,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT competition_entries_entrant_check CHECK (num_nonnulls(team_id, profile_id) = 1),
  CONSTRAINT competition_entries_uniq
    UNIQUE NULLS NOT DISTINCT (competition_id, team_id, profile_id)
);

DROP TRIGGER IF EXISTS competition_entries_updated_at ON competition_entries;
CREATE TRIGGER competition_entries_updated_at
  BEFORE UPDATE ON competition_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS: service-only like the 145 structure tables. The R3 spike reads
-- these through the SERVER (service role) gated on visibility='public';
-- public SELECT policies are phase 3's, additive later. ──────────────────────
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON competitions, competition_entries FROM PUBLIC, anon, authenticated;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_competitions_league_id ON competitions (league_id) WHERE league_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_competitions_club_id ON competitions (club_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_competitions_season ON competitions (season_id);
CREATE INDEX IF NOT EXISTS idx_competitions_division ON competitions (division_id) WHERE division_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_competition_entries_competition ON competition_entries (competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_team ON competition_entries (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_competition_entries_profile ON competition_entries (profile_id) WHERE profile_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'competitions') AS competitions_exists,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'competition_entries') AS entries_exists,
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE relname IN ('competitions', 'competition_entries')) AS all_rls_on,
  NOT (has_table_privilege('anon', 'competitions', 'SELECT')
    OR has_table_privilege('anon', 'competition_entries', 'SELECT')) AS anon_revoked,
  NOT (has_table_privilege('authenticated', 'competitions', 'SELECT')
    OR has_table_privilege('authenticated', 'competition_entries', 'SELECT')) AS authed_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competitions_org_check') LIKE '%num_nonnulls%' AS org_check_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competitions_format_check') LIKE '%meet%' AS format_check_frontloaded,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competitions_entrant_type_check') LIKE '%ad_hoc_team%' AS entrant_check_frontloaded,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competitions_org_season_name_uniq') LIKE '%NULLS NOT DISTINCT%' AS comp_name_uniq_nnd,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competition_entries_entrant_check') LIKE '%num_nonnulls%' AS entry_entrant_check,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competition_entries_uniq') LIKE '%NULLS NOT DISTINCT%' AS entry_uniq_nnd,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'competition_entries_status_check') LIKE '%withdrawn%' AS entry_status_frontloaded,
  (SELECT count(*) FROM pg_indexes WHERE indexname IN (
    'idx_competitions_league_id','idx_competitions_club_id','idx_competitions_season',
    'idx_competitions_division','idx_competition_entries_competition',
    'idx_competition_entries_team','idx_competition_entries_profile')) = 7 AS seven_indexes,
  (SELECT count(*) FROM competitions) AS competitions_info,
  (SELECT count(*) FROM competition_entries) AS entries_info;
-- Expect: true × 13, then two info counts (0 on first run).

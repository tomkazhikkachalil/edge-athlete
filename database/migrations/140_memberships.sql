-- ============================================================================
-- 140: memberships — the unified org membership table (phase 0, step 0.2)
-- ============================================================================
-- Replaces the mirrored league_members (113) / club_members (117) pair with
-- ONE table shaped for the org-platform master plan (docs/
-- ORG_PLATFORM_MASTERPLAN.md §3.4): every structure the plan needs — org
-- follow, team roster spot, scoped staff grant — is a row here with a scope
-- on it. This migration only creates + backfills; behavior is identical
-- until the read-switch deploy.
--
-- Tom's decisions (Aug 30):
--   * follow and roster are SEPARATE rows per (org, profile) — the unique
--     key includes `kind`; existence = active per edge; 0.10 gates
--     roster-row CREATION only.
--   * `status` ships NOW, inert (default 'active'; 'pending' reserved for
--     0.10's guardian queue; the registration lifecycle lands later via a
--     named-CHECK swap).
--   * `season_id` participates in the unique key from day one via
--     NULLS NOT DISTINCT, so 0.5 never re-keys the table. No FK until 0.5
--     creates seasons.
--
-- Shape notes:
--   * Two-FK org discriminator (league_id/club_id + num_nonnulls = 1), the
--     events-119 pattern — FKs cannot span the two org tables. The future
--     single-organization table collapses the pair into one column.
--   * Surrogate uuid PK is FORCED, not stylistic: the natural key contains
--     nullable columns (league_id, club_id, scope_id, season_id) and a PK
--     requires NOT NULL.
--   * kind/status CHECKs front-load 'roster'/'pending' (the 113/139 house
--     pattern: an allowed-but-unsent value is harmless; the reverse is a
--     23514 in prod). scope_type stays CHECK ('org') until 0.5 widens it.
--   * ALL THREE FKs CASCADE: account deletion has no member-delete step
--     (rides profiles CASCADE), org create-rollback deletes only the org
--     row, and e2e teardown deletes org rows.
--   * joined_at keeps the old tables' name and default — the org-page
--     member preview returns it verbatim. No updated_at, no triggers,
--     matching 113/117 ("authorization is app-layer — no trigger").
--
-- ORDER-STRICT: run BEFORE merging the dual-write PR (its write layer
-- inserts into this table and would 500 pre-140 — inserts are mirror
-- writes that log rather than fail, but the point of the window is
-- convergence, not error tolerance). Then RE-RUN this migration once the
-- dual-write deploy is live: the backfill is convergent (ON CONFLICT DO
-- UPDATE), so the re-run repairs any joins/role changes that landed in the
-- gap between the first run and the deploy (the 109/110 run-again
-- precedent).
--
-- Divergence probe (run before the read-switch deploy; expect counts equal
-- and every drift/stale column 0):
--
--   SELECT
--     (SELECT count(*) FROM league_members) AS old_league,
--     (SELECT count(*) FROM memberships WHERE league_id IS NOT NULL) AS new_league,
--     (SELECT count(*) FROM club_members) AS old_club,
--     (SELECT count(*) FROM memberships WHERE club_id IS NOT NULL) AS new_club,
--     (SELECT count(*) FROM league_members lm WHERE NOT EXISTS (
--        SELECT 1 FROM memberships m WHERE m.league_id = lm.league_id
--          AND m.profile_id = lm.profile_id AND m.role = lm.role)) AS league_missing_or_drift,
--     (SELECT count(*) FROM club_members cm WHERE NOT EXISTS (
--        SELECT 1 FROM memberships m WHERE m.club_id = cm.club_id
--          AND m.profile_id = cm.profile_id AND m.role = cm.role)) AS club_missing_or_drift,
--     (SELECT count(*) FROM memberships m WHERE m.league_id IS NOT NULL AND NOT EXISTS (
--        SELECT 1 FROM league_members lm WHERE lm.league_id = m.league_id
--          AND lm.profile_id = m.profile_id)) AS league_stale,
--     (SELECT count(*) FROM memberships m WHERE m.club_id IS NOT NULL AND NOT EXISTS (
--        SELECT 1 FROM club_members cm WHERE cm.club_id = m.club_id
--          AND cm.profile_id = m.profile_id)) AS club_stale;
--
-- WINDOW-ONLY repair (valid ONLY between the first run of 140 and the
-- read-switch deploy — it deletes memberships rows whose old-table
-- counterpart is gone, i.e. leaves that happened in the gap. NEVER run it
-- after the old tables freeze; it lives here as documentation, not in the
-- executable body, so 140 stays re-runnable forever):
--
--   DELETE FROM memberships m WHERE m.kind = 'follow' AND m.scope_type = 'org'
--     AND ((m.league_id IS NOT NULL AND NOT EXISTS (
--            SELECT 1 FROM league_members lm WHERE lm.league_id = m.league_id
--              AND lm.profile_id = m.profile_id))
--      OR  (m.club_id IS NOT NULL AND NOT EXISTS (
--            SELECT 1 FROM club_members cm WHERE cm.club_id = m.club_id
--              AND cm.profile_id = m.profile_id)));
--
-- Run AFTER 113/117/123. Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

-- ── Pre-flight: UNIQUE NULLS NOT DISTINCT needs PG15+ ───────────────────────
DO $$ BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '140 requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT); server is %',
      current_setting('server_version');
  END IF;
END $$;

-- ── memberships ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs(id)   ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'follow'
    CONSTRAINT memberships_kind_check CHECK (kind IN ('follow', 'roster')),
  role        text NOT NULL DEFAULT 'member'
    CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'manager', 'member')),
  status      text NOT NULL DEFAULT 'active'
    CONSTRAINT memberships_status_check CHECK (status IN ('active', 'pending')),
  scope_type  text NOT NULL DEFAULT 'org'
    CONSTRAINT memberships_scope_type_check CHECK (scope_type IN ('org')),
  scope_id    uuid,
  season_id   uuid,
  joined_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT memberships_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  -- org scope = the FK pair itself; scope_id is for sub-org scopes (0.5+)
  CONSTRAINT memberships_org_scope_check CHECK (scope_type <> 'org' OR scope_id IS NULL),
  CONSTRAINT memberships_uniq UNIQUE NULLS NOT DISTINCT
    (league_id, club_id, profile_id, kind, scope_type, scope_id, season_id)
);

-- profile-first lookups (org-peers, calendar merge, profile organizations)
CREATE INDEX IF NOT EXISTS idx_memberships_profile ON memberships (profile_id);
-- org-first scans (member lists, fan-out) + (org, profile) point reads —
-- the second column restores the old composite PKs' access path
CREATE INDEX IF NOT EXISTS idx_memberships_league ON memberships (league_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_memberships_club   ON memberships (club_id, profile_id);

-- Same posture as 113/117: RLS on, zero policies, service-role only —
-- authorization is app-layer (src/lib/orgs/authz.ts).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON memberships FROM PUBLIC, anon, authenticated;

-- ── Backfill (idempotent + convergent: re-runs repair role/joined_at drift) ──
-- Every existing row becomes a kind='follow' org-scope edge; role is
-- orthogonal to kind, so owner/manager rows stay owner/manager follows.
INSERT INTO memberships (league_id, profile_id, role, kind, joined_at)
SELECT lm.league_id, lm.profile_id, lm.role, 'follow', lm.joined_at
FROM league_members lm
ON CONFLICT ON CONSTRAINT memberships_uniq
  DO UPDATE SET role = EXCLUDED.role, joined_at = EXCLUDED.joined_at;

INSERT INTO memberships (club_id, profile_id, role, kind, joined_at)
SELECT cm.club_id, cm.profile_id, cm.role, 'follow', cm.joined_at
FROM club_members cm
ON CONFLICT ON CONSTRAINT memberships_uniq
  DO UPDATE SET role = EXCLUDED.role, joined_at = EXCLUDED.joined_at;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'memberships') AS memberships_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'memberships') AS memberships_rls_on,
  NOT has_table_privilege('anon', 'memberships', 'SELECT') AS memberships_anon_revoked,
  NOT has_table_privilege('authenticated', 'memberships', 'SELECT') AS memberships_authed_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_uniq') LIKE '%NULLS NOT DISTINCT%' AS uniq_nulls_not_distinct,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_kind_check') LIKE '%roster%' AS kind_check_has_roster,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_status_check') LIKE '%pending%' AS status_check_has_pending,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_role_check') LIKE '%manager%' AS role_check_has_manager,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'memberships_org_check') LIKE '%num_nonnulls%' AS org_check_present,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'memberships' AND indexname = 'idx_memberships_profile') AS profile_idx_exists,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'memberships' AND indexname = 'idx_memberships_league') AS league_idx_exists,
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'memberships' AND indexname = 'idx_memberships_club') AS club_idx_exists,
  (SELECT count(*) FROM memberships WHERE league_id IS NOT NULL)
    = (SELECT count(*) FROM league_members) AS league_counts_match,
  (SELECT count(*) FROM memberships WHERE club_id IS NOT NULL)
    = (SELECT count(*) FROM club_members) AS club_counts_match,
  (SELECT count(*) FROM memberships) AS memberships_info,
  (SELECT count(*) FROM league_members) AS league_members_info,
  (SELECT count(*) FROM club_members) AS club_members_info;
-- Expect: true × 14, then three info counts (memberships = league + club).

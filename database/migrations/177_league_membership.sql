-- ============================================================================
-- 177: league membership — visibility, join policy, join requests (program 11 L1)
-- ============================================================================
-- Tom (Sep 3 2026): "leagues parity with clubs" — everything phase 9 (176)
-- gave clubs, for leagues. Same shape, same rules:
--
--   leagues.visibility    — 'public' (today) | 'private' (members-only site
--     content: standings, results, players, teams, divisions, leaders, the
--     gallery and the staff panel — the SAME rule as clubs, by decision).
--   leagues.join_policy   — 'open' (today: one tap) | 'approval' (a manager
--     approves).
--   league_join_requests  — the approval queue. A request is NOT a
--     membership: every membership reader is status-blind on purpose, so a
--     "pending" memberships row would grant member privileges. Approve =
--     the existing join + delete; decline = delete. RLS on, zero policies —
--     every write is app-layer (the memberships / club_join_requests
--     precedent). One open request per (league, profile).
--
-- A SEPARATE mirror table rather than folding club_join_requests into an
-- org_join_requests: memberships already carries league_id / club_id side
-- by side, and renaming a prod-proven table would force a code/DDL
-- ordering dance for no product gain.
--
-- org_site_news.audience (176) already serves both sides.
--
-- ORDER-STRICT: run BEFORE #554 deploys; every reader is 42703 / 42P01-safe
-- (pre-177 reads "public / open", the queue answers 503 "not available
-- yet"), so the failure mode is "the settings don't exist yet", never a
-- broken page. Re-runnable end to end.
--
-- Down-steps (documentation only, never executed):
--   DROP TABLE league_join_requests;
--   ALTER TABLE leagues DROP COLUMN visibility, DROP COLUMN join_policy;

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_visibility_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_visibility_check CHECK (visibility IN ('public', 'private'));

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS join_policy text NOT NULL DEFAULT 'open';
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_join_policy_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_join_policy_check CHECK (join_policy IN ('open', 'approval'));

CREATE TABLE IF NOT EXISTS league_join_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, profile_id)
);
CREATE INDEX IF NOT EXISTS league_join_requests_league_idx ON league_join_requests (league_id, created_at);
ALTER TABLE league_join_requests ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: reads and writes go through the app (service role).
REVOKE ALL ON league_join_requests FROM anon, authenticated;

COMMENT ON COLUMN leagues.visibility IS 'public | private — a private league''s site shows identity + public items only (program 11, the phase-9 rule)';
COMMENT ON COLUMN leagues.join_policy IS 'open | approval — approval queues joins in league_join_requests (program 11)';
COMMENT ON TABLE league_join_requests IS 'The approval queue for joining a league (program 11). Not a membership; approve = join + delete.';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'leagues' AND column_name IN ('visibility', 'join_policy'))          AS leagues_cols,        -- 2
  EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'league_join_requests')                   AS requests_table,      -- true
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'league_join_requests')                  AS requests_indexes,    -- 3 (pk, unique, league_idx)
  (SELECT count(*) FROM leagues WHERE visibility <> 'public' OR join_policy <> 'open')        AS leagues_non_default, -- 0
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'league_join_requests')                AS requests_rls;        -- true

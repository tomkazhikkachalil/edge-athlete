-- ============================================================================
-- 176: club membership — visibility, join policy, join requests, news audience (phase 9 V1)
-- ============================================================================
-- Tom (Sep 2 2026): joining a club "needs an approval process", and clubs
-- get a "private or public setting" — a private club's public site shows
-- identity + public items only (hero, contact, courses, registration,
-- news marked public); standings, results, players and the roster are
-- members-only; members see everything in the app once approved.
--
--   clubs.visibility   — 'public' (today) | 'private' (members-only site content).
--   clubs.join_policy  — 'open' (today: one tap) | 'approval' (a manager approves).
--   club_join_requests — the approval queue. A request is NOT a membership:
--     every membership reader is status-blind on purpose (roles, counts,
--     org cards), so a "pending" memberships row would grant member
--     privileges. Approve = the existing join + delete; decline = delete.
--     RLS on, zero policies — every write is app-layer (the memberships
--     precedent). One open request per (club, profile).
--   org_site_news.audience — 'public' (today) | 'members'; a PRIVATE club's
--     site lists public posts only (a public club shows everything).
--
-- CLUBS ONLY for now (leagues untouched by decision). ORDER-STRICT: run
-- BEFORE #539 deploys; every reader is 42703-safe (pre-176 reads "public /
-- open"), so the failure mode is "the settings don't exist yet", never a
-- broken page. Re-runnable end to end.
--
-- Down-steps (documentation only, never executed):
--   DROP TABLE club_join_requests;
--   ALTER TABLE clubs DROP COLUMN visibility, DROP COLUMN join_policy;
--   ALTER TABLE org_site_news DROP COLUMN audience;

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_visibility_check;
ALTER TABLE clubs ADD CONSTRAINT clubs_visibility_check CHECK (visibility IN ('public', 'private'));

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS join_policy text NOT NULL DEFAULT 'open';
ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_join_policy_check;
ALTER TABLE clubs ADD CONSTRAINT clubs_join_policy_check CHECK (join_policy IN ('open', 'approval'));

ALTER TABLE org_site_news ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'public';
ALTER TABLE org_site_news DROP CONSTRAINT IF EXISTS org_site_news_audience_check;
ALTER TABLE org_site_news ADD CONSTRAINT org_site_news_audience_check CHECK (audience IN ('public', 'members'));

CREATE TABLE IF NOT EXISTS club_join_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, profile_id)
);
CREATE INDEX IF NOT EXISTS club_join_requests_club_idx ON club_join_requests (club_id, created_at);
ALTER TABLE club_join_requests ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: reads and writes go through the app (service role).
REVOKE ALL ON club_join_requests FROM anon, authenticated;

COMMENT ON COLUMN clubs.visibility IS 'public | private — a private club''s site shows identity + public items only (phase 9)';
COMMENT ON COLUMN clubs.join_policy IS 'open | approval — approval queues joins in club_join_requests (phase 9)';
COMMENT ON COLUMN org_site_news.audience IS 'public | members — a private club''s site lists public posts only (phase 9)';
COMMENT ON TABLE club_join_requests IS 'The approval queue for joining a club (phase 9). Not a membership; approve = join + delete.';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'clubs' AND column_name IN ('visibility', 'join_policy'))           AS clubs_cols,       -- 2
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'org_site_news' AND column_name = 'audience')                        AS news_cols,        -- 1
  EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'club_join_requests')                    AS requests_table,   -- true
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'club_join_requests')                   AS requests_indexes, -- 3 (pk, unique, club_idx)
  (SELECT count(*) FROM clubs WHERE visibility <> 'public' OR join_policy <> 'open')         AS clubs_non_default, -- 0
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'club_join_requests')                 AS requests_rls;     -- true

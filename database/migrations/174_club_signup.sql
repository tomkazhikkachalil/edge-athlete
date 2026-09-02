-- ============================================================================
-- 174: club sign-up — approval state, a club's primary sport, site drafts (phase 7 C2)
-- ============================================================================
-- Phase 7 lets a club start from the LOGIN PAGE and build while it waits for
-- approval (C4). This migration is the whole program's DDL:
--
--   clubs.approved_at / leagues.approved_at  — NULL = pending (C4 provisions
--     the org at REQUEST time; approval stamps it). Every existing org is
--     live, so the backfill stamps them all from created_at.
--   clubs.primary_sport  — the sport the club leads with ('golf' picks the
--     PGA-shaped site order in C3 and the golf-first console in C5). Plain
--     text, app-validated, CHECK-free — the leagues.sport_key precedent;
--     clubs stay multi-sport (divisions carry the rest).
--   club_requests.site_draft / league_requests.site_draft — what the golf
--     fast path collects beyond the request itself: the sports, the OPTIONAL
--     home course, and the site's contact (website, phone). Shape is owned
--     by SiteDraftSchema (src/lib/orgs/wizard-validate.ts).
--
-- ORDER-STRICT: run BEFORE #528 deploys — the requests routes insert
-- site_draft (they retry without it on a missing column, so the failure
-- mode is a dropped draft, not a failed request). Re-runnable end to end.
-- No search-trigger DDL: pending orgs are filtered app-side (C4).
--
-- Down-steps (documentation only, never executed):
--   ALTER TABLE clubs DROP COLUMN approved_at, DROP COLUMN primary_sport;
--   ALTER TABLE leagues DROP COLUMN approved_at;
--   ALTER TABLE club_requests DROP COLUMN site_draft;
--   ALTER TABLE league_requests DROP COLUMN site_draft;

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS primary_sport text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Every org that exists today is live.
UPDATE clubs SET approved_at = COALESCE(created_at, now()) WHERE approved_at IS NULL;
UPDATE leagues SET approved_at = COALESCE(created_at, now()) WHERE approved_at IS NULL;

-- The pending set is tiny; a partial index keeps "is this org pending?" and
-- the admin queue cheap without touching the live rows.
CREATE INDEX IF NOT EXISTS clubs_pending_idx ON clubs (created_at) WHERE approved_at IS NULL;
CREATE INDEX IF NOT EXISTS leagues_pending_idx ON leagues (created_at) WHERE approved_at IS NULL;

ALTER TABLE club_requests ADD COLUMN IF NOT EXISTS site_draft jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE league_requests ADD COLUMN IF NOT EXISTS site_draft jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clubs.approved_at IS 'NULL = awaiting admin approval (phase 7); stamped by the admin queue';
COMMENT ON COLUMN clubs.primary_sport IS 'The sport the club leads with (app-validated sport key); picks the site order and console shape';
COMMENT ON COLUMN leagues.approved_at IS 'NULL = awaiting admin approval (phase 7); stamped by the admin queue';
COMMENT ON COLUMN club_requests.site_draft IS 'Golf fast-path extras: {sports, homeCourseId, contact:{website, phone}} — SiteDraftSchema';
COMMENT ON COLUMN league_requests.site_draft IS 'Golf fast-path extras: {sports, homeCourseId, contact:{website, phone}} — SiteDraftSchema';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'clubs' AND column_name IN ('approved_at', 'primary_sport'))          AS clubs_cols,      -- 2
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'leagues' AND column_name = 'approved_at')                             AS leagues_cols,    -- 1
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name IN ('club_requests', 'league_requests') AND column_name = 'site_draft')  AS request_cols,    -- 2
  (SELECT count(*) FROM clubs WHERE approved_at IS NULL)                                      AS clubs_pending,   -- 0
  (SELECT count(*) FROM leagues WHERE approved_at IS NULL)                                    AS leagues_pending, -- 0
  (SELECT count(*) FROM pg_indexes WHERE indexname IN ('clubs_pending_idx', 'leagues_pending_idx')) AS pending_idx; -- 2

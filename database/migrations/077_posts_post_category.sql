-- ============================================================================
-- Migration 077 — posts.post_category: 'training' stops masquerading as a sport
-- ============================================================================
-- ⚠️ ORDER OF OPERATIONS: RUN THIS FIRST, THEN DEPLOY THE APP (the 074/075
-- direction, NOT 076's). The old app is unaffected by a new nullable column;
-- the new app both WRITES post_category on insert and FILTERS on it in the
-- vitals feed — deploying it first would 42703 post creation and take the
-- vitals tab down.
--
-- WHAT: the registry has said it since Phase 1 (SportRegistry.ts): "'training'
-- is used as sport_key for training-tagged posts... Long-term, this should
-- become a post_category field separate from sport_key." This migration makes
-- it so:
--   (a) posts.post_category TEXT, nullable, NO CHECK — the vocabulary is
--       app-validated (src/lib/posts/post-category.ts), the same reasoning
--       migration 020 recorded for activity_mode: a DB enum needs a migration
--       per value and rejects nothing an attacker couldn't already write via
--       the service-role path.
--   (b) Backfill: every sport_key='training' row becomes sport_key='general'
--       + post_category='training'. Training posts are vitals shares and
--       workout shares (they always carry stats_data), so the 074 STATEMENT
--       predicate is invariant under this rewrite — no post can move between
--       the Media grid and the Notions rail, and no RPC changes.
--   (c) No index: the only filtered read is per-profile with a small limit
--       (api/vitals), carried by the existing profile_id index.
--
-- RE-RUNNABLE BACKFILL: the UPDATE below is idempotent. Rows created in the
-- window between this migration and the app deploy still get
-- sport_key='training' from the OLD app — RE-RUN the backfill UPDATE (just
-- that one statement) after the deploy to catch them.
--
-- PRE-FLIGHT:
--   1. Column absent (expect 0 rows):
--        SELECT column_name FROM information_schema.columns
--        WHERE table_name = 'posts' AND column_name = 'post_category';
--   2. Training-post count, for the record:
--        SELECT count(*) FROM posts WHERE sport_key = 'training';
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_category TEXT;

COMMENT ON COLUMN posts.post_category IS
  'Cross-cutting content category (currently only ''training''), orthogonal to sport_key. NO CHECK by design — vocabulary is validated in the API (src/lib/posts/post-category.ts), the migration-020 activity_mode reasoning.';

-- Backfill — idempotent and RE-RUNNABLE (run again after the app deploy to
-- catch rows written by the old app in the gap window):
UPDATE posts
SET post_category = 'training', sport_key = 'general'
WHERE sport_key = 'training';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. Column present (expect 1 row):
--      SELECT column_name, is_nullable FROM information_schema.columns
--      WHERE table_name = 'posts' AND column_name = 'post_category';
--
-- 2. No training pseudo-sport rows remain (expect 0 — re-check AFTER the app
--    deploy + backfill re-run):
--      SELECT count(*) FROM posts WHERE sport_key = 'training';
--
-- 3. The backfilled rows kept their content classification (count matches
--    pre-flight #2):
--      SELECT count(*) FROM posts WHERE post_category = 'training';
--
-- 4. 074 invariance spot-check (training posts all carry stats_data, so
--    Media/Notions membership is unchanged; expect 0):
--      SELECT count(*) FROM posts
--      WHERE post_category = 'training'
--        AND (stats_data IS NULL OR stats_data = '{}'::jsonb);
-- ============================================================================

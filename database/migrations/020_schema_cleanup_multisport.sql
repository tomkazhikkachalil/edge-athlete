-- ============================================================================
-- Migration 020 — Schema Cleanup for Multi-Sport Foundation
-- ============================================================================
-- Audit (July 17, 2026) found:
--   1. posts.game_id / match_id / race_id — speculative per-sport FK columns
--      from an archived migration. ZERO rows ever written, ZERO code
--      references. Superseded by the sport_key pattern.
--   2. Five dead tables — zero rows AND zero code references.
--   3. posts.golf_mode — hardcoded golf naming on the core posts table.
--      Written by exactly one code path, read by nothing. Generalized to
--      activity_mode (sport-agnostic); golf_mode kept one release for
--      rollback safety, dropped in a future migration (021+).
--
-- SAFETY: A1/A2 drops are destructive DDL but cannot destroy data — every
-- dropped object was verified to contain 0 rows on July 17, 2026.
-- Re-verify before running if significant time has passed:
--   SELECT count(*) FROM posts WHERE game_id IS NOT NULL
--     OR match_id IS NOT NULL OR race_id IS NOT NULL;      -- expect 0
--   SELECT count(*) FROM athlete_season_highlights;         -- expect 0
--   SELECT count(*) FROM athlete_performances;              -- expect 0
--   SELECT count(*) FROM athlete_socials;                   -- expect 0
--   SELECT count(*) FROM hockey_game_data;                  -- expect 0
--   SELECT count(*) FROM volleyball_match_data;             -- expect 0
--
-- ORDER OF OPERATIONS: run this migration BEFORE deploying the code that
-- writes posts.activity_mode (the code insert fails if the column is absent).
-- ============================================================================

-- ── A1a. Recreate the composite stats-media index without dead columns ──────
-- (The existing index's WHERE clause references game_id/match_id/race_id,
--  which would block the column drops.)
DROP INDEX IF EXISTS idx_posts_stats_media;

CREATE INDEX idx_posts_stats_media
  ON posts (profile_id, created_at DESC)
  WHERE (
    (stats_data IS NOT NULL AND stats_data != '{}'::jsonb)
    OR round_id IS NOT NULL
  );

-- ── A1b. Drop dead per-sport FK columns + their indexes ─────────────────────
DROP INDEX IF EXISTS idx_posts_game_id;
DROP INDEX IF EXISTS idx_posts_match_id;
DROP INDEX IF EXISTS idx_posts_race_id;

ALTER TABLE posts
  DROP COLUMN IF EXISTS game_id,
  DROP COLUMN IF EXISTS match_id,
  DROP COLUMN IF EXISTS race_id;

-- ── A2. Drop dead tables (0 rows, 0 code references) ────────────────────────
DROP TABLE IF EXISTS athlete_season_highlights;
DROP TABLE IF EXISTS athlete_performances;
DROP TABLE IF EXISTS athlete_socials;
DROP TABLE IF EXISTS hockey_game_data;
DROP TABLE IF EXISTS volleyball_match_data;

-- ── A3. Generalize golf_mode → activity_mode ────────────────────────────────
-- No CHECK constraint: the value vocabulary is per-sport (scoped by
-- posts.sport_key) and will grow as sports are added. Current golf values:
-- 'round_recap', 'hole_highlight'.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS activity_mode TEXT;

UPDATE posts
  SET activity_mode = golf_mode
  WHERE golf_mode IS NOT NULL
    AND activity_mode IS NULL;

COMMENT ON COLUMN posts.activity_mode IS
  'Sport-agnostic post mode (e.g. round_recap, hole_highlight), scoped by sport_key. Replaces golf_mode, which is deprecated and will be dropped in a later migration.';

COMMENT ON COLUMN posts.golf_mode IS
  'DEPRECATED — replaced by activity_mode (migration 020). Kept one release for rollback safety; do not add new readers/writers.';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'posts'
--     AND column_name IN ('game_id','match_id','race_id','activity_mode','golf_mode');
--   → expect: activity_mode, golf_mode (game/match/race gone)
-- SELECT count(*) FROM posts WHERE activity_mode IS DISTINCT FROM golf_mode;
--   → expect: 0 (backfill complete)

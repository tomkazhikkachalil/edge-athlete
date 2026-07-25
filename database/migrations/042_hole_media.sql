-- ============================================================================
-- Migration 042 — Hole-tagged round media
-- ============================================================================
-- Photos/videos taken during (or after) a round attach to a specific hole:
-- "Add photo to hole 3" in live score entry, displayed grouped by hole on
-- the full scorecard. group_post_media already exists (004) with
-- participant-only insert RLS — this adds the hole linkage.
--
-- ⚠️ RUN BEFORE DEPLOYING (the scorecard SELECT embeds hole_number → 42703
--    otherwise). Idempotent. Supabase SQL Editor; expect green "Success".
-- ============================================================================

ALTER TABLE group_post_media ADD COLUMN IF NOT EXISTS hole_number INTEGER
  CHECK (hole_number BETWEEN 1 AND 18);
COMMENT ON COLUMN group_post_media.hole_number IS
  'Hole this media belongs to (1-18); NULL = round-level media.';

CREATE INDEX IF NOT EXISTS idx_group_media_hole
  ON group_post_media(group_post_id, hole_number);

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'group_post_media' AND column_name = 'hole_number';  → 1 row

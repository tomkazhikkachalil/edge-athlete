-- ============================================================================
-- Migration 060 — Poster frames for hole media
-- ============================================================================
-- A video captured during a round had nowhere to store its poster frame, so
-- <video preload="metadata"> rendered a black tile on the scorecard and the
-- mirrored feed post. The capture pipeline already PRODUCES a poster
-- (exportVideo -> posterBlob); ScoreEntryModal simply had nowhere to put it.
--
-- post_media already has thumbnail_url; this gives group_post_media the same
-- column so the round->post mirror can carry it across.
--
-- ⚠️ RUN BEFORE DEPLOYING (the mirror and the media POST both write this
--    column → 42703 otherwise). Idempotent. Supabase SQL Editor; expect a
--    green "Success".
-- ============================================================================

ALTER TABLE group_post_media ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
COMMENT ON COLUMN group_post_media.thumbnail_url IS
  'Poster frame for videos (captured client-side at export). NULL for images.';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'group_post_media' AND column_name = 'thumbnail_url';  → 1 row

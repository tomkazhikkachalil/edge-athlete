-- ============================================================================
-- Migration 046 — Per-set workout media
-- ============================================================================
-- Athletes can attach photos/videos to individual sets while recording
-- (form-check clips, lift videos). Stored as a JSONB array on the set —
-- sets already sync as whole snapshots (replace-all in the entries PUT),
-- so media travels with the snapshot; no extra table/RLS needed.
--
-- Shape: [{"url": "https://…", "type": "image" | "video"}], max 4 per set
-- (validated in the API; JSONB is schema-free by design).
--
-- ⚠️ RUN BEFORE DEPLOYING (the entries PUT and manual workout POST write
--    this column → 42703 otherwise). Idempotent. Supabase SQL Editor.
-- ============================================================================

ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN workout_sets.media IS
  'Array of {url, type:image|video} attached to this set; max 4, API-validated.';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name, column_default FROM information_schema.columns
--  WHERE table_name = 'workout_sets' AND column_name = 'media';
--                                        → 1 row, default '[]'::jsonb

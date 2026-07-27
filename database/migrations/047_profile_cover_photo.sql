-- ============================================================================
-- Migration 047 — Profile cover photo
-- ============================================================================
-- Adds a cover/banner image to profiles (3:1, cropped client-side in the
-- media editor, uploaded via the new /api/upload/cover route to the
-- uploads bucket at covers/{userId}/...). Displayed atop both profile
-- header cards; null → existing gradient fallback.
--
-- ⚠️ RUN BEFORE DEPLOYING (the cover upload route writes this column and
--    profile selects return it → 42703 otherwise). Idempotent.
--    Supabase SQL Editor.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cover_url TEXT;
COMMENT ON COLUMN profiles.cover_url IS
  'Profile cover/banner image (3:1), uploaded via /api/upload/cover.';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'profiles' AND column_name = 'cover_url';   → 1 row

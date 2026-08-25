-- ============================================================================
-- 122: profiles.vitals_privacy — elective Vitals hiding (whole or by aspect)
-- ============================================================================
-- A public profile can keep its Vitals section private, or hide individual
-- aspects of it. Shape (all keys optional; absent/NULL column = everything
-- follows profile visibility, exactly today's behavior — nothing silently
-- disappears when this runs):
--
--   { "hidden": bool,     -- whole Vitals section
--     "body": bool,       -- body-category rows + current height/weight
--     "records": bool,    -- speed/strength/conditioning rows (PBs, metrics)
--     "workouts": bool }  -- workout sessions (log, weekly numbers)
--
-- true = private. Training-feed posts keep their own posts.visibility and
-- are NOT re-gated by this column.
--
-- Schema-less JSONB on purpose (theme_prefs precedent, migration 069):
-- every write goes through PATCH /api/settings/vitals-privacy, which
-- zod-sanitizes to the contract; every read is parsed tolerantly
-- (src/lib/vitals-privacy.ts). Enforcement is APP-LAYER in the vitals /
-- workouts / media-count routes — they read via the admin client, so RLS
-- deliberately does not change here (the app norm; see guardian notes).
--
-- Column rides existing profiles RLS/grants. Re-runnable.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vitals_privacy jsonb;

COMMENT ON COLUMN profiles.vitals_privacy IS
  'Elective Vitals hiding: {hidden, body, records, workouts}, true = private. NULL = all visible (follows profile visibility). Sanitized by /api/settings/vitals-privacy; enforced app-layer.';

-- Verification (run as a separate SELECT — do not wrap with the migration
-- in one transaction; see migration-verification notes):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'vitals_privacy';
-- Expect one row: vitals_privacy | jsonb

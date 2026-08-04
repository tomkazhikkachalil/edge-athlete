-- ============================================================================
-- Migration 065 — profiles.equipment_prefs (equipment display settings)
-- ============================================================================
-- WHAT: one nullable JSONB column holding the athlete's Equipment-tab
-- display settings: sport display order, default sort & season, visibility
-- (hide History / hide whole sports from visitors), and card detail level.
-- Edited from the tab's own settings gear — no trip to main Settings.
--
-- Shape is enforced app-side by sanitizeEquipmentPrefs
-- (src/lib/equipment-prefs.ts): known keys only, valid enums, capped array
-- lengths. NULL = defaults = today's behavior exactly.
--
-- The `hiddenSports` rule is enforced SERVER-SIDE in GET /api/equipment
-- (non-owners never receive those rows) — the column is not merely cosmetic,
-- which is why it lives on the profile row rather than in localStorage.
--
-- ⚠️ ORDER OF OPERATIONS: RUN THIS BEFORE DEPLOYING the PR that ships it.
-- GET /api/equipment selects the column explicitly and PATCH
-- /api/equipment/prefs writes it → 42703 without the column. Running it
-- early breaks nothing (no reader references it until the deploy).
--
-- PRE-FLIGHT (expect: column absent):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'equipment_prefs';
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS equipment_prefs JSONB;

COMMENT ON COLUMN profiles.equipment_prefs IS
  'Equipment-tab display settings (sport order, defaults, visibility, card detail). App-validated; NULL = defaults.';

-- VERIFY (expect: one row, data_type jsonb):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'equipment_prefs';

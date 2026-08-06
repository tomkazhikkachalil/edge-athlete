-- ============================================================================
-- Migration 069 — profiles.theme_prefs (dark-mode preference)
-- ============================================================================
-- WHAT: one nullable JSONB column holding the ACCOUNT's theme preference:
-- mode ('off' | 'on' | 'scheduled' | 'system'), the scheduled window
-- (minutes since local midnight, default 20:00–07:00), and a transient
-- manual override for scheduled mode. Edited from Settings → Appearance.
--
-- Shape is enforced app-side by sanitizeThemePrefs (src/lib/theme-prefs.ts):
-- known keys only, valid enums, minutes clamped 0–1439. NULL = light theme
-- = pre-069 behavior exactly.
--
-- This is an ACCOUNT preference, not an athlete-profile one: it lives on the
-- caller's own row (profiles.id = auth.users.id) and the API route writes
-- .eq('id', user.id) only — guardian profile switching never touches it, so
-- the theme follows the human at the keyboard, and it syncs across devices
-- because every device reads the same row.
--
-- ⚠️ ORDER OF OPERATIONS: RUN THIS BEFORE DEPLOYING the PR that ships it.
-- PATCH /api/settings/theme writes the column → 42703 without it. Running it
-- early breaks nothing (no reader references it until the deploy).
--
-- PRE-FLIGHT (expect: column absent):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'theme_prefs';
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme_prefs JSONB;

COMMENT ON COLUMN profiles.theme_prefs IS
  'Account-level theme preference (mode, scheduled window, override). App-validated; NULL = light.';

-- VERIFY (expect: one row, data_type jsonb):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'theme_prefs';

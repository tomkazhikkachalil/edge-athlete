-- ============================================================================
-- Migration 029 — profiles.onboarded_at (first-run onboarding gate)
-- ============================================================================
-- New signups land on /onboarding (avatar → find golfers → first round)
-- until this timestamp is set. Existing users are backfilled with their
-- created_at so ONLY fresh signups ever see the wizard.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Existing users are already "onboarded"
UPDATE profiles SET onboarded_at = created_at WHERE onboarded_at IS NULL;

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT count(*) FROM profiles WHERE onboarded_at IS NULL;  → expect 0

-- ============================================================================
-- 132: household policy — per-guardian safety defaults (Family Console W4)
-- ============================================================================
-- The retire-the-toggles round's data shape. A guardian's household safety
-- defaults live on THEIR OWN profiles row as schema-less jsonb (the
-- vitals_privacy/122 pattern: nullable column, one PATCH route that
-- parse-sanitizes to contract, tolerant parseHouseholdPolicy in src/lib,
-- enforcement app-layer, RLS unchanged).
--
--   { "defaults":      { visibility, messaging_permission, comment_moderation },
--     "olderDefaults": { ...sparse per-field overrides... } | null }
--
--   * NULL column = the guardian never adopted a policy: creation keeps the
--     hard-coded restrictive defaults and deviation chips render nothing.
--   * defaults apply at athlete creation (visibility ALWAYS clamped private
--     there — consent cannot exist before the profile does) and via the
--     apply-to-all endpoint, which loops per-athlete through the SAME
--     semantics as the safety PATCH (supervised gate, consent gate on
--     public, changed-only audit rows). Never applied silently.
--   * olderDefaults = null means "not configured": the age-crossing prompt
--     (mig 133) never fires, and defining it later never retro-prompts.
--   * PER-GUARDIAN deliberately: co-guardians may hold different defaults;
--     the creating guardian's apply at creation, and any apply-to-all is
--     visible in the safety audit feed + deviation chips — visibility and
--     veto, not arbitration.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS household_policy jsonb;

COMMENT ON COLUMN profiles.household_policy IS
  'Per-guardian household safety defaults (132): {defaults:{visibility,messaging_permission,comment_moderation}, olderDefaults: partial|null}. NULL = not adopted. Sanitized by PATCH /api/guardian/household; applied app-layer at athlete creation and via the apply endpoint — never silently.';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — expect: household_policy | jsonb ────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'household_policy';

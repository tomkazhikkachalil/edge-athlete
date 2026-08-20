-- ============================================================================
-- Migration 097 — 'parent' user_type
-- ============================================================================
-- Guardian funnel round (Aug 20 2026). Parent signup stored
-- user_type:'athlete' — nothing marked a parent account, so post-signup
-- routing dumped parents into the ATHLETE onboarding wizard ("What sports
-- do you play?") and never showed them their child. The signup route now
-- forces user_type:'parent' on the guardian branch and routing sends
-- parents to the family console.
--
-- Deploy order: STRICT — run before merging (parent inserts violate the
-- old CHECK).

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_user_type_check
  CHECK (user_type IN ('athlete', 'club', 'league', 'fan', 'parent'));

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check (run separately if pasting mangles quotes) ─────────────
-- Expect: parent_allowed = true.
SELECT
  (pg_get_constraintdef(oid) LIKE '%parent%') AS parent_allowed
FROM pg_constraint
WHERE conname = 'profiles_user_type_check';

-- ============================================================================
-- 049 — Guardian/minors foundation: profiles columns, pending_profiles,
--       guardian_invites
-- ============================================================================
-- ⚠️ Run AFTER 048. Safe pre-deploy: nothing reads these until
-- FEATURE_GUARDIAN_PROFILES=true code ships.
-- ============================================================================

-- ── profiles additions ──────────────────────────────────────────────────────
-- is_minor is DERIVED (dob + minor_threshold_age vs today) — never stored, so
-- nobody forgets to flip it on a birthday. jurisdiction + threshold are
-- immutable snapshots taken at consent time; law changes never retroactively
-- re-classify existing accounts.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS supervision_state TEXT NOT NULL DEFAULT 'self'
    CHECK (supervision_state IN ('self','supervised')),
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS minor_threshold_age SMALLINT,
  ADD COLUMN IF NOT EXISTS dob_locked BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_supervised
  ON profiles (id) WHERE supervision_state = 'supervised';

-- ── pending_profiles: parked under-threshold self-signups ───────────────────
-- Deliberately a separate table, NOT a profiles state: no auth user or
-- profile row exists pre-consent (COPPA data-minimization), and un-consented
-- children never enter the content tables or search. auth_user_id is set
-- only for the OAuth hole (a signed-in-but-profileless minor).
CREATE TABLE IF NOT EXISTS pending_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload             JSONB NOT NULL,
  child_email         TEXT,
  dob                 DATE NOT NULL,
  jurisdiction        TEXT NOT NULL,
  threshold_age       SMALLINT NOT NULL,
  auth_user_id        UUID,
  state               TEXT NOT NULL DEFAULT 'awaiting_guardian'
    CHECK (state IN ('awaiting_guardian','consent_pending','approved','rejected','expired')),
  promoted_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS idx_pending_profiles_state
  ON pending_profiles (state, expires_at);

-- Service-role only: RLS on, ZERO policies (027_waitlist precedent).
ALTER TABLE pending_profiles ENABLE ROW LEVEL SECURITY;

-- ── guardian_invites: app-owned single-use tokens ───────────────────────────
-- NOT Supabase PKCE links — those require same-browser redemption, and a
-- parent opens the invite on a different device by definition. token_hash =
-- sha256 of a 32-byte base64url token; the raw token exists only in the email.
-- Redemption is atomic: UPDATE ... SET consumed_at = now()
--   WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
--   RETURNING *;  -- zero rows = invalid/expired/used
CREATE TABLE IF NOT EXISTS guardian_invites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash         TEXT NOT NULL UNIQUE,
  invite_type        TEXT NOT NULL CHECK (invite_type IN
    ('guardian_for_pending','guardian_additional','athlete_activation','transfer_contact_verify')),
  invited_email      TEXT NOT NULL,
  pending_profile_id UUID REFERENCES pending_profiles(id) ON DELETE CASCADE,
  profile_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  consumed_at        TIMESTAMPTZ,
  CHECK (num_nonnulls(pending_profile_id, profile_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_guardian_invites_email
  ON guardian_invites (invited_email) WHERE consumed_at IS NULL;

ALTER TABLE guardian_invites ENABLE ROW LEVEL SECURITY;

-- ── on_auth_user_created ────────────────────────────────────────────────────
-- DO NOT DROP YET. Phase 0 dump question 1 confirms whether it still exists
-- live; it is dropped only in the same release that converts /api/signup and
-- /api/auth/complete-profile to create_profile_with_owner() — otherwise a
-- trigger-created profile would bypass the access-row guarantee, or dropping
-- it early would break nothing but is pointless churn. The DROP ships with
-- the Phase-2 signup migration.
-- (Planned statement, for reference:)
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification
-- ============================================================================
-- 1. Columns exist:
--    SELECT supervision_state, jurisdiction, minor_threshold_age, dob_locked
--    FROM profiles LIMIT 1;
-- 2. All existing profiles are 'self' — must equal total profiles count:
--    SELECT count(*) FROM profiles WHERE supervision_state = 'self';
-- 3. Tables service-role-only (RLS on, zero policies) — both must return 0:
--    SELECT count(*) FROM pg_policies WHERE tablename IN
--      ('pending_profiles','guardian_invites');
-- ============================================================================

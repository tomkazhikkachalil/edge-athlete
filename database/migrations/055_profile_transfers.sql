-- ============================================================================
-- 055 — profile_transfers: transfer-of-control state machine (guardian Phase 5)
-- ============================================================================
-- ⚠️ Run AFTER 054. Safe anytime: nothing reads it until Phase-5 code deploys.
--
-- States: eligible_notified → requested (athlete-initiated, guardian must
-- approve) → initiated → credentials_pending (independent email OTP) →
-- dual_confirm (both parties) → cooling_off (7 days, either cancels) →
-- executing (idempotent step journal) → completed.
-- Terminals: cancelled / expired / aborted / failed.
-- dob_snapshot: any DOB divergence mid-flow aborts the transfer (anti-abuse).
-- ============================================================================

CREATE TABLE IF NOT EXISTS profile_transfers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state                 TEXT NOT NULL DEFAULT 'initiated' CHECK (state IN
                          ('eligible_notified','requested','initiated','credentials_pending',
                           'dual_confirm','cooling_off','executing','completed',
                           'cancelled','expired','aborted','failed')),
  initiated_by          TEXT NOT NULL CHECK (initiated_by IN ('guardian','athlete','system')),
  initiator_user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  athlete_contact_email TEXT,
  contact_verified_at   TIMESTAMPTZ,
  athlete_confirmed_at  TIMESTAMPTZ,
  guardian_confirmed_at TIMESTAMPTZ,
  guardian_confirmed_by UUID,
  cooling_off_ends_at   TIMESTAMPTZ,
  executed_steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
  guardian_post_role    TEXT CHECK (guardian_post_role IN ('viewer','removed')),
  dob_snapshot          DATE NOT NULL,
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID,
  cancel_reason         TEXT,
  failure_reason        TEXT,
  failure_count         SMALLINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active transfer per profile, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_transfers_one_active
  ON profile_transfers (profile_id)
  WHERE state NOT IN ('completed','cancelled','expired','aborted');

CREATE INDEX IF NOT EXISTS idx_profile_transfers_cron
  ON profile_transfers (state)
  WHERE state IN ('cooling_off','executing','requested','credentials_pending','dual_confirm');

DROP TRIGGER IF EXISTS handle_updated_at_profile_transfers ON profile_transfers;
CREATE TRIGGER handle_updated_at_profile_transfers
  BEFORE UPDATE ON profile_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Service-role only: RLS on, zero policies (state is served via app routes
-- that authorize guardian/supervised roles per profile).
ALTER TABLE profile_transfers ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification
-- ============================================================================
-- 1. Table + one-active index:
--    SELECT indexname FROM pg_indexes WHERE tablename='profile_transfers';
-- 2. Zero policies: SELECT count(*) FROM pg_policies
--    WHERE tablename='profile_transfers';  -- 0
-- 3. updated_at trigger fires: INSERT a row w/ a real profile_id, UPDATE it,
--    check updated_at > created_at, then DELETE it.
-- ============================================================================

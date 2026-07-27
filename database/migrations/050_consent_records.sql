-- ============================================================================
-- 050 — consent_records: append-only verifiable-parental-consent audit
-- ============================================================================
-- ⚠️ Run AFTER 049.
--
-- Every consent event is a NEW row (action column); current consent state =
-- latest row per profile. Immutability is a trigger, not RLS — triggers bind
-- even service-role writes. Proof must survive both guardian account deletion
-- (guardian FK SET NULL + email snapshot) and minor hard-deletion
-- (profile FK SET NULL + dob-year snapshot).
-- ============================================================================

CREATE TABLE IF NOT EXISTS consent_records (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id              UUID REFERENCES profiles(id) ON DELETE SET NULL,
  pending_profile_id      UUID,   -- no FK: survives pending_profiles purge
  subject_dob_year        SMALLINT NOT NULL,
  guardian_user_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  guardian_email_snapshot TEXT NOT NULL,
  method                  TEXT NOT NULL CHECK (method IN
    ('signed_form','card_charge','id_verification','video_call','email_plus')),
  action                  TEXT NOT NULL CHECK (action IN
    ('granted','review_approved','review_rejected','withdrawn','superseded')),
  policy_version          TEXT NOT NULL,
  jurisdiction            TEXT NOT NULL,
  threshold_age           SMALLINT NOT NULL,
  evidence_path           TEXT,   -- object path in the private consent-evidence bucket
  reviewed_by             UUID,
  ip                      INET,
  user_agent              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_records_profile
  ON consent_records (profile_id, created_at DESC);

-- Append-only (forbid_mutation() created in 048).
DROP TRIGGER IF EXISTS consent_records_immutable ON consent_records;
CREATE TRIGGER consent_records_immutable
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();

-- Service-role only: RLS on, zero policies.
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- ── Private evidence bucket ─────────────────────────────────────────────────
-- Signed consent forms live here; NEVER public. No storage RLS policies are
-- created — with none, only the service role can read/write objects.
INSERT INTO storage.buckets (id, name, public)
VALUES ('consent-evidence', 'consent-evidence', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification
-- ============================================================================
-- 1. Immutability — must ERROR (roll back after):
--    BEGIN;
--    INSERT INTO consent_records (subject_dob_year, guardian_email_snapshot,
--      method, action, policy_version, jurisdiction, threshold_age)
--    VALUES (2015,'test@example.com','signed_form','granted','v1','US',13);
--    UPDATE consent_records SET policy_version='v2'
--      WHERE guardian_email_snapshot='test@example.com';  -- expect exception
--    ROLLBACK;
-- 2. Bucket private:
--    SELECT id, public FROM storage.buckets WHERE id='consent-evidence';
--    -- expect public = false
-- 3. Zero policies:
--    SELECT count(*) FROM pg_policies WHERE tablename='consent_records';  -- 0
-- ============================================================================

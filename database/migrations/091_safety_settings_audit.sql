-- ============================================================================
-- Migration 091 — Safety-settings audit trail
-- ============================================================================
-- Family console Round 4 (Aug 19 2026). The guardian safety PATCH (visibility,
-- messaging_permission) shipped in Round 1 deliberately without an audit —
-- profile_access_audit is scoped to access-ROLE changes. This is the record of
-- WHO changed a supervised athlete's safety posture, WHEN, and old → new.
--
-- House pattern from profile_access_audit: NO foreign keys — the trail must
-- survive deletion of the athlete, the guardian, or both. Append-only via the
-- shared forbid_mutation() trigger (048). RLS on with zero policies:
-- service-role writes only; a future console view reads through the API.

CREATE TABLE IF NOT EXISTS safety_settings_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  actor_id uuid,
  field text NOT NULL CHECK (field IN ('visibility', 'messaging_permission')),
  old_value text,
  new_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_audit_profile
  ON safety_settings_audit (profile_id, created_at DESC);

ALTER TABLE safety_settings_audit ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS safety_settings_audit_immutable ON safety_settings_audit;
CREATE TRIGGER safety_settings_audit_immutable
  BEFORE UPDATE OR DELETE ON safety_settings_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect one row: table_present = true, rls_on = true, trigger_present = true
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'safety_settings_audit'
  ) AS table_present,
  (
    SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.safety_settings_audit'::regclass
  ) AS rls_on,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.safety_settings_audit'::regclass
      AND tgname = 'safety_settings_audit_immutable'
  ) AS trigger_present;

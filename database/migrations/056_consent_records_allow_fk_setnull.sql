-- ============================================================================
-- 056 — consent_records: let the FKs' ON DELETE SET NULL through the
--       append-only guard (REQUIRED for any deletion of consented accounts)
-- ============================================================================
-- ⚠️ Run AFTER 055. REQUIRED before guardian hard-delete / account deletion
-- of anyone with consent rows.
--
-- BUG (found by delete-parity E2E, July 28 2026): 050's design REQUIRES
-- consent rows to survive profile/guardian deletion via the FKs'
-- ON DELETE SET NULL — but the shared forbid_mutation() trigger blocks the
-- very UPDATE those FKs perform. Net effect: ANY profile with consent rows
-- was undeletable ("rows in consent_records are append-only"), including
-- via auth.users cascade. This replaces the consent trigger with a
-- consent-specific guard that permits EXACTLY ONE kind of update: the FK
-- columns (profile_id / guardian_user_id) transitioning to NULL with every
-- other column untouched. All other UPDATEs and every DELETE still raise.
-- profile_access_audit keeps using the original forbid_mutation() —
-- untouched by this migration.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consent_records_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     -- each FK: unchanged, or transitioning to NULL
     AND (NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id
          OR (NEW.profile_id IS NULL AND OLD.profile_id IS NOT NULL))
     AND (NEW.guardian_user_id IS NOT DISTINCT FROM OLD.guardian_user_id
          OR (NEW.guardian_user_id IS NULL AND OLD.guardian_user_id IS NOT NULL))
     -- at least one FK actually changing (no-op updates stay forbidden)
     AND (NEW.profile_id IS DISTINCT FROM OLD.profile_id
          OR NEW.guardian_user_id IS DISTINCT FROM OLD.guardian_user_id)
     -- everything else identical
     AND (to_jsonb(NEW) - 'profile_id' - 'guardian_user_id')
         = (to_jsonb(OLD) - 'profile_id' - 'guardian_user_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rows in consent_records are append-only';
END; $$;

DROP TRIGGER IF EXISTS consent_records_immutable ON consent_records;
CREATE TRIGGER consent_records_immutable
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_forbid_mutation();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification (run after applying)
-- ============================================================================
-- 1. Plain UPDATE still forbidden (expect: ERROR "append-only"):
--    UPDATE consent_records SET method = method WHERE id =
--      (SELECT id FROM consent_records LIMIT 1);
-- 2. DELETE still forbidden (expect: ERROR "append-only"):
--    DELETE FROM consent_records WHERE id =
--      (SELECT id FROM consent_records LIMIT 1);
-- 3. The FK SET NULL path now works: deleting a profile with consent rows
--    succeeds and leaves the rows with profile_id NULL (exercised
--    end-to-end by the delete-parity E2E suite).
-- ============================================================================

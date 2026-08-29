-- ============================================================================
-- 136 — DB last-guardian backstop (Family Console follow-on, Wave 6)
-- ============================================================================
-- The route layer already refuses to remove the last guardian of a supervised
-- profile (guardians DELETE returns 409), but the DB had no backstop: 048's
-- profile_access_nonempty only fires at zero access rows over ALL roles, and
-- a supervised child always keeps its self row — so a service-role bug or a
-- hand-run statement could silently orphan a child. This trigger closes that.
--
-- The exemptions are load-bearing; every one was hit in practice:
--   * profile_transfers.state = 'executing' — executeTransfer's flip_access
--     step downgrades/deletes guardian rows in ONE REST statement and only
--     sets supervision_state='self' in the LATER finalize statement. Separate
--     transactions, so DEFERRABLE gives no cover; the executing transfer row
--     (unique-active per profile, 055) is the honest signal.
--   * Cascade tolerance (048 stance) — deleting the guardian's or the child's
--     profiles row cascades through profile_access; both EXISTS guards let
--     those pass (the account-delete route blocks last-guardian deletion at
--     the app layer with names, which the DB cannot).
--   * Parked children (deletion_requested_at IS NOT NULL) are exempt: the
--     purge path hard-deletes the guardian link order-independently.
--
-- Kept as a DEFERRABLE INITIALLY DEFERRED constraint trigger so a future
-- single-transaction guardian swap (remove A + add B) judges the final state,
-- matching profile_access_nonempty.
--
-- While here, for the record (deliberately NOT changed): 048's
-- enforce_guardian_cap fires on the post-insert count with `> 2`, which is
-- correct for an AFTER trigger judging final state — the "admits a third row"
-- reading is a misread, since count(*) after a third insert is 3.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_last_guardian()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only departures from the guardian role matter.
  IF OLD.role <> 'guardian' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'guardian' THEN
    RETURN NULL;
  END IF;

  -- Cascade tolerance: either side's profiles row already gone = a cascade
  -- in flight; the app layer owns those flows.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.profile_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    RETURN NULL;
  END IF;

  -- Only supervised, un-parked children are protected.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = OLD.profile_id
      AND supervision_state = 'supervised'
      AND deletion_requested_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- The transfer executor's flip_access→finalize window.
  IF EXISTS (
    SELECT 1 FROM public.profile_transfers
    WHERE profile_id = OLD.profile_id AND state = 'executing'
  ) THEN
    RETURN NULL;
  END IF;

  -- Deferred AFTER trigger: the count reflects the transaction's final state.
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = OLD.profile_id AND role = 'guardian'
  ) THEN
    RAISE EXCEPTION
      'profile % must keep at least one guardian while supervised (last-guardian backstop, migration 136)',
      OLD.profile_id;
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_last_guardian() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_access_last_guardian ON profile_access;
CREATE CONSTRAINT TRIGGER profile_access_last_guardian
  AFTER DELETE OR UPDATE OF role ON profile_access
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_guardian();

-- ── Check grid (re-runnable; SELECTs only — RAISE EXCEPTION in the SQL
--    editor's single transaction would roll the migration back) ─────────────
SELECT
  (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enforce_last_guardian'
      AND p.prosecdef
  )) AS function_present_secdef,
  (SELECT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'profile_access'
      AND t.tgname = 'profile_access_last_guardian'
      AND t.tgdeferrable AND t.tginitdeferred
  )) AS trigger_present_deferred,
  (SELECT NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND p.proname = 'enforce_last_guardian'
      AND r.rolname IN ('anon', 'authenticated')
  )) AS execute_revoked;
-- Expect: true / true / true.
--
-- Functional probe (run MANUALLY in a throwaway transaction, never as part
-- of this migration):
--   BEGIN;
--     DELETE FROM profile_access
--       WHERE profile_id = '<a supervised child>' AND role = 'guardian';
--   -- expect: ERROR ... last-guardian backstop, migration 136
--   ROLLBACK;

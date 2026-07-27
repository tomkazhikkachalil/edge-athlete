-- ============================================================================
-- 048 — profile_access: auth-identity ↔ athlete-profile join (guardian feature)
-- ============================================================================
-- ⚠️ RUN BEFORE DEPLOYING any code with FEATURE_GUARDIAN_PROFILES=true.
-- Safe to run before that: with the flag off, no code path reads this table.
--
-- Separates WHO can act (a user) from the athlete entity (a profiles row).
-- profiles.id keeps its auth.users FK (shadow-identity architecture — see
-- the guardian-profiles proposal); this table is the single source of truth
-- for roles: owner | guardian | supervised | viewer.
--
-- Invariants enforced here:
--   1. check_role_identity — owner/supervised are self rows (user_id =
--      profile_id); guardian/viewer never are.
--   2. At most ONE self role per profile (partial unique index).
--   3. A profile can never end a transaction with ZERO access rows
--      (deferred constraint trigger; deletion cascades pass because the
--      profiles row is already gone at deferred-check time).
--   4. At most 2 guardians per profile.
-- ============================================================================

CREATE TABLE IF NOT EXISTS profile_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','guardian','supervised','viewer')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (user_id, profile_id),
  CONSTRAINT check_role_identity CHECK (
    (role IN ('owner','supervised') AND user_id = profile_id) OR
    (role IN ('guardian','viewer')  AND user_id <> profile_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_profile_access_profile_role
  ON profile_access (profile_id, role);
CREATE INDEX IF NOT EXISTS idx_profile_access_guardians
  ON profile_access (profile_id) WHERE role = 'guardian';
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_access_one_self_role
  ON profile_access (profile_id) WHERE role IN ('owner','supervised');

-- Append-only audit of grants/revokes/role changes (written by RPCs/routes).
CREATE TABLE IF NOT EXISTS profile_access_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL,
  user_id     UUID NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('granted','revoked','role_changed')),
  old_role    TEXT,
  new_role    TEXT,
  actor_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_access_audit_profile
  ON profile_access_audit (profile_id, created_at DESC);

-- Immutability: audit rows can never be updated or deleted (triggers bind
-- even service-role writes, unlike RLS).
CREATE OR REPLACE FUNCTION public.forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'rows in % are append-only', TG_TABLE_NAME;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.forbid_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_access_audit_immutable ON profile_access_audit;
CREATE TRIGGER profile_access_audit_immutable
  BEFORE UPDATE OR DELETE ON profile_access_audit
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();

-- ── Zero-access-row constraint (deferred, so transfers can swap roles in one
--    transaction without a transient zero/duplicate state) ──────────────────
CREATE OR REPLACE FUNCTION public.enforce_profile_has_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected UUID;
BEGIN
  affected := COALESCE(OLD.profile_id, NEW.profile_id);
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = affected)
     AND NOT EXISTS (SELECT 1 FROM public.profile_access WHERE profile_id = affected) THEN
    RAISE EXCEPTION 'profile % cannot be left with zero access rows', affected;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_has_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_access_nonempty ON profile_access;
CREATE CONSTRAINT TRIGGER profile_access_nonempty
  AFTER DELETE OR UPDATE OF profile_id, role ON profile_access
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_has_access();

-- ── Guardian cap (defense; the grant RPC also checks) ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_guardian_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'guardian' AND (
    SELECT count(*) FROM public.profile_access
    WHERE profile_id = NEW.profile_id AND role = 'guardian'
  ) > 2 THEN
    RAISE EXCEPTION 'profile % already has the maximum of 2 guardians', NEW.profile_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_guardian_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_access_guardian_cap ON profile_access;
CREATE CONSTRAINT TRIGGER profile_access_guardian_cap
  AFTER INSERT OR UPDATE OF role ON profile_access
  FOR EACH ROW EXECUTE FUNCTION public.enforce_guardian_cap();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- ⚠️ 035 lesson (42P17): these policies must NOT EXISTS-check profile_access
-- itself. Reads: you can see rows where you're either side. Writes: none —
-- all writes go through service-role routes / SECURITY DEFINER RPCs.
ALTER TABLE profile_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_access_select_policy ON profile_access;
CREATE POLICY profile_access_select_policy ON profile_access
  FOR SELECT USING (
    user_id = (select auth.uid()) OR profile_id = (select auth.uid())
  );

ALTER TABLE profile_access_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_access_audit_select_policy ON profile_access_audit;
CREATE POLICY profile_access_audit_select_policy ON profile_access_audit
  FOR SELECT USING (
    user_id = (select auth.uid()) OR profile_id = (select auth.uid())
  );

-- ── RLS helper for OTHER tables' policies (052 uses this) ───────────────────
-- SECURITY DEFINER is mandatory: lets policies consult profile_access without
-- recursing into its own policies (035's 42P17).
CREATE OR REPLACE FUNCTION public.has_profile_access(p_profile_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = p_profile_id
      AND user_id = (select auth.uid())
      AND role = ANY (p_roles)
  );
$$;
REVOKE ALL ON FUNCTION public.has_profile_access(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_profile_access(uuid, text[]) TO authenticated, anon;

-- ── Creation RPC: profile + first access row atomically ─────────────────────
-- Server-only (service role): signup/complete-profile routes call this so a
-- profile can never exist without an access row. The insert-side constraint
-- trigger on profiles ships LAST (055), once every insert path uses this.
CREATE OR REPLACE FUNCTION public.create_profile_with_owner(p_profile jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.profiles
  SELECT * FROM jsonb_populate_record(NULL::public.profiles, p_profile)
  RETURNING id INTO new_id;

  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (new_id, new_id, 'owner', new_id);

  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_profile_with_owner(jsonb) FROM PUBLIC, anon, authenticated;

-- ── Backfill: every existing profile is owned by itself ─────────────────────
INSERT INTO profile_access (user_id, profile_id, role, granted_at)
SELECT id, id, 'owner', created_at FROM profiles
ON CONFLICT (user_id, profile_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification (run after; expected results in comments)
-- ============================================================================
-- 1. Backfill complete — must return 0:
--    SELECT count(*) FROM profiles p
--    WHERE NOT EXISTS (SELECT 1 FROM profile_access a WHERE a.profile_id = p.id);
-- 2. All backfilled rows are owner self-rows — must equal profiles count:
--    SELECT count(*) FROM profile_access WHERE role='owner' AND user_id=profile_id;
-- 3. Zero-access trigger works — must ERROR:
--    BEGIN; DELETE FROM profile_access WHERE profile_id =
--      (SELECT id FROM profiles LIMIT 1); COMMIT;  -- expect exception, then ROLLBACK
-- 4. Helper callable as authenticated:
--    SELECT public.has_profile_access((SELECT id FROM profiles LIMIT 1), ARRAY['owner']);
-- ============================================================================

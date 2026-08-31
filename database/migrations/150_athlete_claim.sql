-- ============================================================================
-- 150: athlete claim — stub athletes + claim invites (phase 1 R3)
-- ============================================================================
-- The roster-import growth loop: an org imports its roster as CLAIMABLE
-- stub profiles (supervised SELF access row — Tom's decision; the row IS
-- the profile, so "history merges" is free at claim). This migration is
-- the storage half: the claim-invite table (the 149 org_claim_invites
-- shape — hashed at rest, single-use, atomic redeem) and the atomic stub
-- mint RPC (profiles + access row must land in ONE transaction).
--
-- Design notes, load-bearing:
--   * org/team columns on the invite are DISPLAY PROVENANCE for the claim
--     page, never authority (roster rows are the authority) — SET NULL,
--     not CASCADE: the invite is about the PERSON and survives org
--     deletion. profile_id CASCADEs — no stub, no invite.
--   * invited_email NULLABLE (house rule: the claim URL in the import
--     report is the guaranteed channel; email is a convenience).
--   * The unconsumed index is NON-unique on purpose: restore-after-lost-
--     race must never be blocked by a concurrent re-mint.
--   * create_stub_profile uses plain INSERT...VALUES with NAMED columns —
--     unnamed columns take their DEFAULTs. NOT jsonb_populate_record
--     (053's trap: absent keys become explicit NULLs, bypassing defaults).
--   * visibility='private' is MANDATORY in the insert: the
--     search_doc_sync_athlete trigger COALESCEs a missing visibility to
--     'public' — an unnamed column here would make stubs publicly
--     searchable at birth.
--   * @stubs.invalid ⇔ unclaimed is the app-layer invariant: the adult
--     claim swaps in a real email; the guardian claim re-keys to
--     @minors.invalid. isSyntheticEmail keeps meaning "supervised minor".
--
-- ORDER-STRICT: run AFTER 149, BEFORE merging the roster-import PR (its
-- routes call create_stub_profile — PGRST202 → 500 pre-150). Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS athlete_claim_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  league_id     uuid REFERENCES leagues(id) ON DELETE SET NULL,
  club_id       uuid REFERENCES clubs(id)   ON DELETE SET NULL,
  team_id       uuid REFERENCES teams(id)   ON DELETE SET NULL,
  invited_email text,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  consumed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT athlete_claim_one_org CHECK (num_nonnulls(league_id, club_id) <= 1)
);

ALTER TABLE athlete_claim_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON athlete_claim_invites FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_profile
  ON athlete_claim_invites (profile_id) WHERE consumed_at IS NULL;

-- ── create_stub_profile — atomic profile + supervised self row + audit ──────
CREATE OR REPLACE FUNCTION public.create_stub_profile(
  p_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_full text := trim(p_first_name || ' ' || coalesce(p_last_name, ''));
BEGIN
  INSERT INTO public.profiles
    (id, email, first_name, last_name, full_name, display_name,
     user_type, visibility, supervision_state)
  VALUES
    (p_id, p_email, p_first_name, NULLIF(p_last_name, ''), v_full, v_full,
     'athlete', 'private', 'supervised');

  -- 048: a supervised SELF row is legal (user_id = profile_id) and takes
  -- the one-self-role slot. The adult claim FLIPS it to owner; the
  -- guardian claim DELETES it (after the guardian row exists) so the
  -- credentials_gap queue item surfaces.
  INSERT INTO public.profile_access (user_id, profile_id, role, granted_by)
  VALUES (p_id, p_id, 'supervised', p_created_by);

  INSERT INTO public.profile_access_audit (profile_id, user_id, action, new_role, actor_id)
  VALUES (p_id, p_id, 'granted', 'supervised', p_created_by);

  RETURN p_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.create_stub_profile(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, count is info) ────
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
          AND tablename = 'athlete_claim_invites') AS claim_table,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'athlete_claim_invites') AS claim_rls,
  NOT has_table_privilege('anon', 'athlete_claim_invites', 'SELECT') AS claim_anon_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'athlete_claim_one_org') LIKE '%num_nonnulls%' AS claim_org_check,
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_athlete_claim_invites_profile') AS claim_profile_idx,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_stub_profile') AS rpc_exists,
  (SELECT prosecdef FROM pg_proc WHERE proname = 'create_stub_profile') AS rpc_secdef,
  NOT has_function_privilege('anon',
    'public.create_stub_profile(uuid,text,text,text,uuid)', 'EXECUTE') AS rpc_anon_revoked,
  (SELECT count(*) FROM athlete_claim_invites) AS invite_rows_info;
-- Expect: true × 8, then one info count (0 on first run).

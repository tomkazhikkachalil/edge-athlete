-- ============================================================================
-- 149: org onboarding wizard — request drafts + org claim invites (phase 1 R2)
-- ============================================================================
-- The wizard (docs/ORG_PLATFORM_MASTERPLAN.md §4, as amended: it runs
-- INSIDE the existing approval queue) stores its output ON the request row
-- and admin approval replays it through round 1's structure core.
--
-- TWO draft columns, not one: the approval replay consumes them under
-- DIFFERENT failure policies (structure = strict rollback via the org-
-- delete cascade; connections = best-effort with a per-item report), each
-- has its own zod boundary at the POST, and e2e asserts per-step truth.
-- Capabilities stay REAL columns (the 116 "approval copies them VERBATIM"
-- rule — they map 1:1 onto 142's org columns) and are TRISTATE: NULL =
-- the wizard didn't say ⇒ approval passes nothing ⇒ 142 defaults apply.
--
-- org_claim_invites: stub-org handover tokens (guardian_invites' shape —
-- hashed at rest, single-use, atomic redeem). invited_email is NULLABLE
-- deliberately: the claim URL in the approve response is the GUARANTEED
-- channel (house rule — email is a convenience). 30-day expiry: the
-- recipient is an external org operator reached out-of-band, and the stub
-- is visible-but-harmless while unclaimed; admin re-mint is manual.
--
-- ORDER-STRICT: run BEFORE merging the foundations PR — its widened
-- request POST inserts the new columns, and pre-149 that is a PGRST204
-- 500 on every wizard submit (worse than 116's degrade). Run AFTER 148.
-- Re-runnable end to end.
-- ============================================================================

-- ── Wizard columns on BOTH request tables ────────────────────────────────────
ALTER TABLE league_requests
  ADD COLUMN IF NOT EXISTS operates_competitions boolean,
  ADD COLUMN IF NOT EXISTS operates_teams boolean,
  ADD COLUMN IF NOT EXISTS structure_draft jsonb,
  ADD COLUMN IF NOT EXISTS connections_draft jsonb;

ALTER TABLE club_requests
  ADD COLUMN IF NOT EXISTS operates_competitions boolean,
  ADD COLUMN IF NOT EXISTS operates_teams boolean,
  ADD COLUMN IF NOT EXISTS structure_draft jsonb,
  ADD COLUMN IF NOT EXISTS connections_draft jsonb;

-- ── org_claim_invites — stub-org handover tokens ─────────────────────────────
CREATE TABLE IF NOT EXISTS org_claim_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  league_id     uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id       uuid REFERENCES clubs(id)   ON DELETE CASCADE,
  invited_email text,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  consumed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT org_claim_one_org CHECK (num_nonnulls(league_id, club_id) = 1)
);

ALTER TABLE org_claim_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_claim_invites FROM PUBLIC, anon, authenticated;

-- Outstanding-invite lookups per org (re-mint dedupe, admin listing).
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_league
  ON org_claim_invites (league_id) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_club
  ON org_claim_invites (club_id) WHERE consumed_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, count is info) ─────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'league_requests' AND column_name = 'structure_draft') AS lr_structure,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'league_requests' AND column_name = 'connections_draft') AS lr_connections,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'league_requests' AND column_name = 'operates_teams') AS lr_teams_flag,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'club_requests' AND column_name = 'structure_draft') AS cr_structure,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'club_requests' AND column_name = 'operates_competitions') AS cr_comps_flag,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
          AND tablename = 'org_claim_invites') AS claim_table,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'org_claim_invites') AS claim_rls,
  NOT has_table_privilege('anon', 'org_claim_invites', 'SELECT') AS claim_anon_revoked,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'org_claim_one_org') LIKE '%num_nonnulls%' AS claim_xor_check,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_org_claim_invites_league') AS claim_league_idx,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_org_claim_invites_club') AS claim_club_idx,
  (SELECT count(*) FROM org_claim_invites) AS claim_rows_info;
-- Expect: true × 11, then one info count (0 on first run).

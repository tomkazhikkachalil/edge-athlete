-- ============================================================================
-- 138 — Wave 8 autonomy riders (Family Console follow-on)
-- ============================================================================
-- Two small columns for the autonomy wave; one run covers both PRs.
--
-- 1. guardian_invites.grant_role — the view-only co-guardian (8A). The
--    invite ceremony is reused verbatim; this column records which role the
--    claim grants. 'viewer' already exists in 048's profile_access CHECK,
--    already passes check_role_identity, already has read-only RLS grants
--    (052) and exactly `read` in the profile-roles matrix — so the tier
--    itself is ZERO structural DDL; only the invite needs to carry intent.
--    The guardian cap trigger counts only role='guardian' (deliberate);
--    the viewer cap (≤2) is route-layer.
--
-- 2. profile_transfers.handover_prompted_at — the handover moment (8C).
--    Rides the eligible_notified row exactly like 133's age_preset_prompt:
--    a one-shot stamp, not a state; the transfer state machine is untouched
--    and nothing auto-transfers, ever.
-- ============================================================================

ALTER TABLE guardian_invites
  ADD COLUMN IF NOT EXISTS grant_role TEXT NOT NULL DEFAULT 'guardian'
    CONSTRAINT guardian_invites_grant_role_check CHECK (grant_role IN ('guardian', 'viewer'));

COMMENT ON COLUMN guardian_invites.grant_role IS
  'Role the claim grants (migration 138): guardian (default, pre-138 invites) or viewer (view-only co-guardian).';

ALTER TABLE profile_transfers
  ADD COLUMN IF NOT EXISTS handover_prompted_at TIMESTAMPTZ;

COMMENT ON COLUMN profile_transfers.handover_prompted_at IS
  'Handover-moment stamp (migration 138): set once by the sweep when a supervised athlete reaches adulthood with the transfer still parked at eligible_notified. Dedup only — never a state.';

-- ── Check grid (re-runnable; SELECTs only) ──────────────────────────────────
SELECT
  (SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guardian_invites'
      AND column_name = 'grant_role')) AS grant_role_present,
  (SELECT column_default LIKE '%guardian%' FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guardian_invites'
      AND column_name = 'grant_role') AS grant_role_defaults_guardian,
  (SELECT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'guardian_invites_grant_role_check')) AS grant_role_check_present,
  (SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profile_transfers'
      AND column_name = 'handover_prompted_at')) AS handover_stamp_present;
-- Expect: true / true / true / true.

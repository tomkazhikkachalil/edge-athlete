-- ============================================================================
-- 161: the registration lifecycle — memberships status CHECK widens (phase 5, R1)
-- ============================================================================
-- The named-CHECK swap migration 140 promised verbatim ("the registration
-- lifecycle lands later via a named-CHECK swap"). The org-scope roster row
-- becomes the masterplan §3.4 lifecycle: an athlete registers with the org
-- (status 'registered', season_id stamped — the column has waited unwritten
-- since 140), a registrar evaluates ('evaluating'), placement mints the
-- TEAM-scope roster row and flips the org row 'placed', release flips it
-- 'released'. 'active' and 'pending' keep their exact meanings (legacy
-- membership and the invite flow — NULL-season rows).
--
-- This migration is DELIBERATELY only the CHECK: no writers of the new
-- statuses exist until phase-5 R2 ships, so running it early is inert, and
-- code shipped ahead of it degrades (the registration writer maps a 23514
-- to a friendly "database not yet migrated" error). memberships_uniq is
-- NOT touched — 140/145 forbid re-keying it, and season-scoped rows get
-- their uniqueness from the NULLS NOT DISTINCT key as designed.
--
-- ORDER-STRICT: run AFTER 159. Re-runnable (the swap is idempotent, the
-- grid is a SELECT).
--
-- Down-steps (documentation only, never executed): restore
-- CHECK (status IN ('active','pending')) — valid only while no rows carry
-- the new values.

ALTER TABLE memberships
  DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_status_check CHECK (status IN (
    'active', 'pending', 'registered', 'evaluating', 'placed', 'released'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%registered%' FROM pg_constraint
     WHERE conname = 'memberships_status_check')                  AS lifecycle_widened,
  (SELECT pg_get_constraintdef(oid) LIKE '%pending%' FROM pg_constraint
     WHERE conname = 'memberships_status_check')                  AS invite_flow_kept,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'memberships_uniq')                          AS unique_key_untouched,
  (SELECT count(*) FROM memberships
     WHERE status NOT IN ('active', 'pending'))                   AS lifecycle_rows_yet;

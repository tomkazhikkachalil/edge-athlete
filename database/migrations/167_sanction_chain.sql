-- ============================================================================
-- 167: The sanctioning chain (phase 6 R3)
-- ============================================================================
-- Two tables:
--
-- 1) league_affiliations — league→league edges (child → parent), the 118
--    league_clubs design VERBATIM as a SIBLING table (118 stays untouched:
--    its PK doubles as duplicate-authority and decline-eraser, and its
--    consumers assume the league↔club shape). KMHA → District → Federation
--    becomes expressible; 'district_of' stays deferred per 143's header.
--    Affiliation grants NOTHING (the 143 invariant): sanctioning affects
--    display/provenance only — authorization and entry eligibility do not
--    read this table for authority.
--
-- 2) sanction_grants — an APPEND-ONLY history of sanctioned_by edges, so
--    "was this org sanctioned on the date of that contest" is answerable
--    later (the documented retroactivity hazard in provenance.ts). Live
--    display keeps reading live edges (the chip may change — documented
--    semantics); the grants table is the audit record. Rows are written
--    by the accept path (insert) and dissolve path (revoked_at) of
--    sanctioned_by edges on BOTH edge tables, best-effort in app code.
--
-- Run AFTER 166. Re-runnable end to end.
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_affiliations (
  league_id        uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE, -- the CHILD
  parent_league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending'
    CONSTRAINT league_affiliations_status_check CHECK (status IN ('pending', 'active')),
  affiliation_type text NOT NULL DEFAULT 'member_of'
    CONSTRAINT league_affiliations_type_check
    CHECK (affiliation_type IN ('partner_of', 'member_of', 'sanctioned_by')),
  initiated_by text NOT NULL
    CONSTRAINT league_affiliations_initiated_by_check CHECK (initiated_by IN ('child', 'parent')),
  requested_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_by_profile_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (league_id, parent_league_id),
  CONSTRAINT league_affiliations_no_self CHECK (league_id <> parent_league_id)
);

DROP TRIGGER IF EXISTS league_affiliations_updated_at ON league_affiliations;
CREATE TRIGGER league_affiliations_updated_at
  BEFORE UPDATE ON league_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE league_affiliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON league_affiliations FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_league_affiliations_parent
  ON league_affiliations (parent_league_id);

-- ── sanction_grants — append-only history ───────────────────────────────────
CREATE TABLE IF NOT EXISTS sanction_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  grantee_kind      text NOT NULL
    CONSTRAINT sanction_grants_kind_check CHECK (grantee_kind IN ('club', 'league')),
  grantee_id        uuid NOT NULL,
  granted_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  revoked_at        timestamptz
);

ALTER TABLE sanction_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sanction_grants FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_sanction_grants_grantee
  ON sanction_grants (grantee_kind, grantee_id);

-- Backfill: one open grant per currently-active sanctioned_by club edge
-- (granted_at = the edge's decided_at). Idempotent via the NOT EXISTS.
INSERT INTO sanction_grants (grantor_league_id, grantee_kind, grantee_id, granted_at)
SELECT lc.league_id, 'club', lc.club_id, COALESCE(lc.decided_at, lc.created_at)
FROM league_clubs lc
WHERE lc.status = 'active'
  AND lc.affiliation_type = 'sanctioned_by'
  AND NOT EXISTS (
    SELECT 1 FROM sanction_grants g
    WHERE g.grantor_league_id = lc.league_id
      AND g.grantee_kind = 'club'
      AND g.grantee_id = lc.club_id
      AND g.revoked_at IS NULL
  );

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans true, counts info) ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='league_affiliations') AS parents_table,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sanction_grants')     AS grants_table,
  (SELECT relrowsecurity FROM pg_class WHERE relname='league_affiliations') AS parents_rls,
  (SELECT relrowsecurity FROM pg_class WHERE relname='sanction_grants')     AS grants_rls,
  NOT has_table_privilege('anon', 'league_affiliations', 'SELECT') AS parents_anon_revoked,
  NOT has_table_privilege('anon', 'sanction_grants', 'SELECT')     AS grants_anon_revoked,
  (SELECT count(*) FROM sanction_grants WHERE revoked_at IS NULL)  AS open_grants,
  (SELECT count(*) FROM league_clubs WHERE status='active' AND affiliation_type='sanctioned_by') AS live_sanction_edges;
-- open_grants must be >= live_sanction_edges (backfill covered every edge).

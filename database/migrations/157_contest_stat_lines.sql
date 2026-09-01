-- ============================================================================
-- 157: contest_stat_lines — per-athlete stats on a contest (phase 4, R1)
-- ============================================================================
-- The masterplan's "result → stat_line rows (athlete, team, contest)". The
-- result chain (152) bottoms out at competition_entries.team_id for team
-- competitions — no athlete appears anywhere in it. This table is the
-- missing hop. Shape decisions:
--   * stats is a jsonb object whose keys are the sport's STAT_SCHEMAS
--     field keys (the posts.stats_data vocabulary) — APP-validated against
--     the competition's sport_key; no sport_key column here (derive via
--     contests → competitions; a stored copy could drift).
--   * team_id records WHICH side the athlete played for and is SET NULL on
--     team deletion — §8 invariant 2: the athlete's record outlives the
--     org edge. profile_id CASCADEs with the profile (their data).
--   * provenance reuses the 152 five-rung ladder VERBATIM. Stamped
--     server-side by writer authority: owning-org manager ⇒
--     'league_verified'; participating-club staff ⇒ 'club_recorded'.
--     'sanctioned' is DERIVED at display time from the sanctioned_by
--     affiliation edge, never stored (the org graph mutates).
--   * UNIQUE (contest_id, profile_id) — one line per athlete per contest;
--     re-entry upserts. INDEX (profile_id, created_at DESC) serves the
--     profile-side reads (phase 4 R2).
--   * Posture A, like every org table: RLS on, zero policies, REVOKEd —
--     service-role reads with app-layer authz.
--
-- ORDER-STRICT: run AFTER 152 (contests). App code merged ahead of this
-- migration DEGRADES: stat-line reads return empty, writes answer a
-- friendly error, the console hides the player-stats surface.
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP contest_stat_lines.

CREATE TABLE IF NOT EXISTS contest_stat_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id  uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE SET NULL,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stats       jsonb NOT NULL DEFAULT '{}',
  provenance  text NOT NULL
    CONSTRAINT contest_stat_lines_provenance_check
    CHECK (provenance IN ('sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported')),
  entered_by  uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contest_stat_lines_uniq UNIQUE (contest_id, profile_id)
);

DROP TRIGGER IF EXISTS contest_stat_lines_updated_at ON contest_stat_lines;
CREATE TRIGGER contest_stat_lines_updated_at
  BEFORE UPDATE ON contest_stat_lines
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE contest_stat_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contest_stat_lines FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_contest_stat_lines_contest
  ON contest_stat_lines (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_stat_lines_profile
  ON contest_stat_lines (profile_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) > 0 FROM information_schema.tables
     WHERE table_name = 'contest_stat_lines')                        AS lines_exists,
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'contest_stat_lines')                           AS lines_rls_on,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'contest_stat_lines_uniq')                      AS lines_uniq,
  (SELECT pg_get_constraintdef(oid) LIKE '%imported%' FROM pg_constraint
     WHERE conname = 'contest_stat_lines_provenance_check')          AS provenance_full_ladder,
  (SELECT count(*) = 2 FROM pg_indexes
     WHERE tablename = 'contest_stat_lines'
       AND indexname LIKE 'idx_contest_stat_lines_%')                AS lines_indexed,
  (SELECT count(*) FROM contest_stat_lines)                          AS lines_total;

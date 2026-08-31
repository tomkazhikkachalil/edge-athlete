-- ============================================================================
-- 153: competition_standings — the materialized table (phase 2, round 3)
-- ============================================================================
-- Tom's decision (Aug 31): standings are MATERIALIZED (masterplan §3.3's
-- "(materialized)" wins over the WHS read-time precedent) because the
-- read pattern is the opposite of a handicap: public, cacheable,
-- high-fanout reads vs. rare writes — and this table IS the phase-3
-- public-projection artifact, collapsing the §12 batching risk and the
-- projection spike into one object.
--
-- Recompute contract (competitions/standings.ts): a FULL-competition
-- rewrite on every result write / contest status change / entry change —
-- bounded (~30 entrants × a season of contests), chunked reads ≤500 (the
-- PostgREST 1000-row-cap lesson), best-effort warn-and-continue at the
-- hook sites, and an admin repair route for drift. `stats` is the
-- adapter-declared column blob ({w,l,t,gf,ga,diff} for fixtures;
-- {rounds,total} shapes arrive with R5) — the DB stays shape-blind, the
-- scoring registry is app-side (the 113 convention).
--
-- Posture A (service-only) like 151/152: THE SPIKE reads this table
-- through the SERVER (service role) gated on competitions.visibility;
-- whether phase 3 adds a SELECT policy + anon GRANT is exactly what the
-- spike's DEVLOG verdict decides.
--
-- ORDER-STRICT: run AFTER 152, BEFORE merging the R3 PRs (recompute
-- writes this table; reads degrade to empty pre-153).
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP competition_standings.
-- ============================================================================

CREATE TABLE IF NOT EXISTS competition_standings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  entry_id       uuid NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  rank           integer NOT NULL,
  points         numeric,
  played         integer NOT NULL DEFAULT 0,
  stats          jsonb NOT NULL DEFAULT '{}',
  computed_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT competition_standings_uniq UNIQUE (competition_id, entry_id)
);

ALTER TABLE competition_standings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON competition_standings FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_competition_standings_rank
  ON competition_standings (competition_id, rank);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, count is info) ─────
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'competition_standings') AS standings_exists,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'competition_standings') AS rls_on,
  NOT has_table_privilege('anon', 'competition_standings', 'SELECT') AS anon_revoked,
  NOT has_table_privilege('authenticated', 'competition_standings', 'SELECT') AS authed_revoked,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_standings_uniq') AS standings_uniq,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_competition_standings_rank') AS rank_index,
  (SELECT count(*) FROM competition_standings) AS standings_info;
-- Expect: true × 6, then one info count (0 on first run).

-- ============================================================================
-- 194: athlete_performances — ONE queryable table of athletic performances
--      (data foundation, F3 — Sep 13 2026)
-- ============================================================================
-- Tom's stated vision is a multi-sport ANALYSIS / RECRUITING dataset. Today
-- the platform holds two performance shapes that cannot be queried
-- together: golf's deep tables (golf_rounds + golf_holes, with the league
-- sync's contest_results overlay) and every other sport's posts.stats_data
-- JSONB. This table is the common shape: one row per EVENT per athlete,
-- fed by every existing writer (F4), backfilled (F5), read first by the
-- scout search (F6). Existing readers keep their tables — this is a
-- projection they never depend on.
--
-- Shape decisions (docs/PERFORMANCE_DATA.md is the reference):
--   * ONE FACT PER EVENT. A golf league result is an OVERLAY on the round's
--     row (contest_id, provenance, dispute_status, entered_by) — never a
--     second row.
--   * natural_key is the ORIGIN ROW id ('post:<id>' | 'golf_round:<id>' |
--     'contest_stat_line:<id>'), never (contest, profile): a stub-profile
--     claim re-points profile_id and would orphan a composite key.
--     UNIQUE, so every writer is an idempotent upsert.
--   * source is HOW the fact entered: post | live_round | org_entry |
--     import (the plan also named golf_sync; no row would ever carry it —
--     a league round's origin stays the round, the league is the overlay).
--   * provenance is the 152 five-rung ladder VERBATIM, DEFAULT
--     'self_reported' — load-bearing: a PostgREST upsert updates only the
--     columns in the payload, so a round-edit re-upsert that OMITS the
--     overlay columns leaves an existing overlay untouched.
--     'sanctioned' is derived at read (the org graph mutates) — a stored
--     rung is a floor. A disputed line stays on the table and leaves the
--     headline reads.
--   * metrics is NUMERIC-ONLY {key: number} in the sport's stat-schema
--     vocabulary (golf normalised: gross, to_par, holes, putts?, fir_pct?,
--     gir_pct?, differential? — the differential ONLY when the round has
--     a rating and a slope, via handicap.ts; never estimated).
--   * headline is the sport's ONE number (stat-line: schema.heroStat;
--     golf: gross). Direction is per sport in app code (golf and track are
--     lower-is-better) — the column stores the number, not the rank.
--   * No visibility snapshot: derived at read from the origin (a post's
--     status / the profile's visibility).
--   * Posture A, like every org table: RLS on, zero policies, REVOKEd —
--     service-role writes and reads with app-layer authz.
--   * The table is created EMPTY in this file, so plain CREATE INDEX is
--     correct here. Any index added AFTER the backfill goes through the
--     .indexes.sql CONCURRENTLY rule (database/MIGRATIONS.md, Provenance).
--
-- ORDER-STRICT: run AFTER 152 (contests). App code merged ahead of this
-- migration DEGRADES: the writer answers {skipped: 'missing_table'} on
-- 42P01 / PGRST205 and the user's write succeeds regardless.
-- Re-runnable end to end (the check grid is a SELECT).
--
-- Down-steps (documentation only, never executed): DROP athlete_performances.

CREATE TABLE IF NOT EXISTS athlete_performances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sport_key      text NOT NULL,
  occurred_on    date NOT NULL,
  source         text NOT NULL
    CONSTRAINT athlete_performances_source_check
    CHECK (source IN ('post', 'live_round', 'org_entry', 'import')),
  source_table   text NOT NULL
    CONSTRAINT athlete_performances_source_table_check
    CHECK (source_table IN ('posts', 'golf_rounds', 'contest_stat_lines')),
  source_id      uuid NOT NULL,
  natural_key    text NOT NULL,
  contest_id     uuid REFERENCES contests(id) ON DELETE SET NULL,
  provenance     text NOT NULL DEFAULT 'self_reported'
    CONSTRAINT athlete_performances_provenance_check
    CHECK (provenance IN ('sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported')),
  dispute_status text NOT NULL DEFAULT 'none'
    CONSTRAINT athlete_performances_dispute_check
    CHECK (dispute_status IN ('none', 'disputed', 'resolved')),
  entered_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  metrics        jsonb NOT NULL DEFAULT '{}',
  context        jsonb,
  headline       numeric,
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT athlete_performances_natural_key_uniq UNIQUE (natural_key)
);

DROP TRIGGER IF EXISTS athlete_performances_updated_at ON athlete_performances;
CREATE TRIGGER athlete_performances_updated_at
  BEFORE UPDATE ON athlete_performances
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE athlete_performances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON athlete_performances FROM PUBLIC, anon, authenticated;

-- The table is empty at this point (see the header) — plain CREATE INDEX.
CREATE INDEX IF NOT EXISTS idx_athlete_performances_sport_date
  ON athlete_performances (sport_key, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_profile
  ON athlete_performances (profile_id, sport_key, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_headline
  ON athlete_performances (sport_key, headline) WHERE headline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_athlete_performances_source
  ON athlete_performances (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_metrics
  ON athlete_performances USING gin (metrics jsonb_path_ops);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) > 0 FROM information_schema.tables
     WHERE table_name = 'athlete_performances')                        AS perf_exists,
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'athlete_performances')                           AS perf_rls_on,
  (SELECT count(*) = 0 FROM pg_policies
     WHERE tablename = 'athlete_performances')                         AS perf_zero_policies,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'athlete_performances_natural_key_uniq')          AS perf_natural_key_uniq,
  (SELECT pg_get_constraintdef(oid) LIKE '%imported%' FROM pg_constraint
     WHERE conname = 'athlete_performances_provenance_check')          AS provenance_full_ladder,
  (SELECT column_default LIKE '%self_reported%' FROM information_schema.columns
     WHERE table_name = 'athlete_performances' AND column_name = 'provenance') AS provenance_default,
  (SELECT count(*) = 5 FROM pg_indexes
     WHERE tablename = 'athlete_performances'
       AND indexname LIKE 'idx_athlete_performances_%')                AS perf_indexed,
  (SELECT count(*) FROM athlete_performances)                          AS perf_total;

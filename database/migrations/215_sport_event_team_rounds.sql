-- ============================================================================
-- 215: team rounds — the event's SHAPE, a game's live score on the round,
--      the per-player stat lines (Events program, phase 4 — the second of
--      the phase's three schema migrations; 214 = open joining + recorders,
--      216 = media)
-- ============================================================================
-- Tom (Sep 16 2026): every enabled sport joins Events — golf keeps its
-- hole-by-hole cards; the stat-line sports (ice hockey, basketball, soccer,
-- baseball, volleyball) get LIVE per-player stats in the same event shell. A
-- team-sport event is a GAME (two ad-hoc sides from the joiners + a live
-- score) or a SESSION (one roster), chosen at creation.
--
--   * sport_events.shape text NOT NULL DEFAULT 'round' — one decision at
--     creation like `format`: round | game | session, with
--     `(sport_key = 'golf') = (shape = 'round')` holding BOTH ways (every
--     existing row is golf + the default). `format` stays golf vocabulary
--     (never widened; hidden off golf — a documented wart).
--   * sport_event_rounds gains nullable columns, no new table: `starts_at`
--     (a game has one clock), the game's live score ON the round —
--     `side1_score`, `side2_score` (>= 0), `period` (>= 1) — and
--     `score_version` (the app-level compare-and-set for the score write;
--     a different predicate from the lifecycle's status CAS). `course_name`
--     stays the round's PLACE for every sport (the rink, the field — every
--     reader already prints it as the "where"). Golf's columns keep their
--     defaults off golf.
--   * sport_event_stat_lines — ONE row per fielded player per round, minted
--     at go-live for a stat-line sport (nothing golf-ish: no group post).
--     `stats` is the WHOLE object in the sport's stat-schema vocabulary
--     (validated in the app, never clamped); `version` is the app-level
--     compare-and-set (the 212 shape: UPDATE … WHERE id AND version = seen;
--     0 rows = 409 with the current row; never trigger-bumped). NO status
--     column (the 204 ladder is a golf attestation model — a recorder makes
--     "submit" meaningless; write gates come from the ROUND's status). NO
--     side column (a game is ONE group per round with two sides on
--     sport_event_group_members.side, 212). `profile_id` is denormalised for
--     the completion mirror; `entered_by` is the last writer.
--
-- Posture A (the 187 shape): RLS on, zero policies, REVOKE from anon and
-- authenticated; the admin client behind the ONE event gate is the only
-- reader. NOTIFY pgrst so the table enters the OpenAPI inventory
-- (check:schema) at once.
--
-- READERS: nothing selects `shape` / the score columns / the new table until
-- phase 4 PR 8, gated on `check:schema` OK after this ran (the 207 lesson).
-- The app names a non-golf `sport_key` only after this ran (a team event
-- created before the shape CHECK would violate it here).
-- ============================================================================

-- ── The event's shape ───────────────────────────────────────────────────────
ALTER TABLE sport_events
  ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'round';

ALTER TABLE sport_events DROP CONSTRAINT IF EXISTS sport_events_shape_check;
ALTER TABLE sport_events ADD CONSTRAINT sport_events_shape_check
  CHECK (shape IN ('round', 'game', 'session'));

ALTER TABLE sport_events DROP CONSTRAINT IF EXISTS sport_events_sport_shape_check;
ALTER TABLE sport_events ADD CONSTRAINT sport_events_sport_shape_check
  CHECK ((sport_key = 'golf') = (shape = 'round'));

-- ── The round: a start time, the game's live score ──────────────────────────
ALTER TABLE sport_event_rounds
  ADD COLUMN IF NOT EXISTS starts_at     timestamptz,
  ADD COLUMN IF NOT EXISTS side1_score   integer,
  ADD COLUMN IF NOT EXISTS side2_score   integer,
  ADD COLUMN IF NOT EXISTS period        smallint,
  ADD COLUMN IF NOT EXISTS score_version integer NOT NULL DEFAULT 0;

ALTER TABLE sport_event_rounds DROP CONSTRAINT IF EXISTS sport_event_rounds_side1_score_check;
ALTER TABLE sport_event_rounds ADD CONSTRAINT sport_event_rounds_side1_score_check CHECK (side1_score IS NULL OR side1_score >= 0);
ALTER TABLE sport_event_rounds DROP CONSTRAINT IF EXISTS sport_event_rounds_side2_score_check;
ALTER TABLE sport_event_rounds ADD CONSTRAINT sport_event_rounds_side2_score_check CHECK (side2_score IS NULL OR side2_score >= 0);
ALTER TABLE sport_event_rounds DROP CONSTRAINT IF EXISTS sport_event_rounds_period_check;
ALTER TABLE sport_event_rounds ADD CONSTRAINT sport_event_rounds_period_check CHECK (period IS NULL OR period >= 1);
ALTER TABLE sport_event_rounds DROP CONSTRAINT IF EXISTS sport_event_rounds_score_version_check;
ALTER TABLE sport_event_rounds ADD CONSTRAINT sport_event_rounds_score_version_check CHECK (score_version >= 0);

-- ── The stat line ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sport_event_stat_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_event_round_id uuid NOT NULL REFERENCES sport_event_rounds(id) ON DELETE CASCADE,
  participant_id       uuid NOT NULL REFERENCES sport_event_participants(id) ON DELETE CASCADE,
  profile_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stats                jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT sport_event_stat_lines_stats_check CHECK (jsonb_typeof(stats) = 'object'),
  version              integer NOT NULL DEFAULT 0 CONSTRAINT sport_event_stat_lines_version_check CHECK (version >= 0),
  entered_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_stat_lines_round_participant_uniq UNIQUE (sport_event_round_id, participant_id)
);

ALTER TABLE sport_event_stat_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_event_stat_lines FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sport_event_stat_lines_updated_at ON sport_event_stat_lines;
CREATE TRIGGER sport_event_stat_lines_updated_at
  BEFORE UPDATE ON sport_event_stat_lines
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- The reads: a round's lines (the board, polled); a player's lines newest first (the mirror, the sheet).
CREATE INDEX IF NOT EXISTS idx_sport_event_stat_lines_round
  ON sport_event_stat_lines (sport_event_round_id);
CREATE INDEX IF NOT EXISTS idx_sport_event_stat_lines_profile
  ON sport_event_stat_lines (profile_id, created_at DESC);

COMMENT ON COLUMN sport_events.shape IS 'round (golf: hole-by-hole cards) | game (a team sport: two ad-hoc sides + a live score) | session (a team sport: one roster) — one decision at creation (215); (sport_key = golf) = (shape = round).';
COMMENT ON COLUMN sport_event_rounds.course_name IS 'The round''s PLACE for every sport (215): a golf course, or the rink / field / court of a team round.';
COMMENT ON COLUMN sport_event_rounds.starts_at IS 'A game''s start (215); null on golf (tee times live on the groups).';
COMMENT ON COLUMN sport_event_rounds.side1_score IS 'The game''s live score, side 1 (215); null off a game or before the first score.';
COMMENT ON COLUMN sport_event_rounds.side2_score IS 'The game''s live score, side 2 (215).';
COMMENT ON COLUMN sport_event_rounds.period IS 'The period / half / set the game is in (215); null off a game.';
COMMENT ON COLUMN sport_event_rounds.score_version IS 'App-level CAS for the score write (215): UPDATE … WHERE id AND score_version = seen; 0 rows = 409. Never trigger-bumped.';
COMMENT ON TABLE  sport_event_stat_lines IS 'One row per fielded player per round of a stat-line sport (215), minted at go-live. `stats` is the whole object in the sport''s stat-schema vocabulary; `version` is the app-level compare-and-set; no status (the round''s status gates writes); no side (the group member carries it).';
COMMENT ON COLUMN sport_event_stat_lines.version IS 'App-level CAS: every write is UPDATE … SET stats, version = v + 1 WHERE id AND version = v; 0 rows = 409 with the current row. Never trigger-bumped (the 039 lesson).';
COMMENT ON CONSTRAINT sport_events_sport_shape_check ON sport_events IS 'Golf is a round and a round is golf (215): the shape follows the sport both ways.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 215 APPLIED | 1 | 5 | 1
SELECT '215 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'shape' AND data_type = 'text') AS shape_column_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_rounds' AND column_name IN ('starts_at', 'side1_score', 'side2_score', 'period', 'score_version')) AS round_columns_expect_5,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sport_event_stat_lines') AS table_expect_1;

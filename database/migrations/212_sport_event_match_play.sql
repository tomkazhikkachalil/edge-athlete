-- ============================================================================
-- 212: match play — the format vocabulary, a side per group member and the
--      match row (Events program, phase 3 — the phase's ONE schema migration;
--      213 is the bell)
-- ============================================================================
-- A MATCH is a group with two SIDES on a match-format round. The strokes
-- stay on the cards exactly as today (an opponent may mark; the outbox and
-- the per-hole CAS of 209 apply). What a card cannot carry lives on ONE row
-- per match, `sport_event_matches`: concessions, sudden-death extra holes
-- (`golf_hole_scores.hole_number` is CHECK 1..18 and UNIQUE per card — an
-- extra hole can never live in the card), an organizer's decision, a bye —
-- INTENT, plus the outcome written ONCE at round completion (the
-- golf_rounds-mirrors-cards posture). The match STATUS ("2 UP thru 14",
-- dormie, all square after the last) is computed on every read from the
-- cards + this row and is never stored while live: no `status` column.
--
--   * sport_events.format widens to match_gross | match_net (DROP + ADD of
--     the ONE named CHECK — 201's grid still counts 11 constraints on the
--     table, 207's 12). A 23514 window, not 42703: the app names the new
--     values only after this has run (phase 3, PR 4).
--   * sport_event_group_members.side smallint NULL, 1 | 2 — uniform on
--     every match format (singles too; the engine never guesses a side
--     from position); NULL on a stroke round.
--   * sport_event_matches: one per group (UNIQUE on group_id), CASCADE
--     with the group and the round. `concessions` [{hole: n | null,
--     by_side, by, at}] — the side that GIVES it; hole null concedes the
--     match. `extra_holes` [{n, hole_number, strokes: {participantId: n |
--     null}}] — keyed by participant so four-ball keeps both balls.
--     decided_by | winner_side | result | decided_at are set TOGETHER (a
--     CHECK). `version` is the app-level compare-and-set (the 039 lesson:
--     a trigger-bumped stamp defeats a CAS; two players may concede or
--     enter an extra hole at once) — every write is
--     UPDATE … WHERE id = $1 AND version = $2; 0 rows = 409.
--
-- Posture A (the 187 shape): RLS on, zero policies, REVOKE from anon and
-- authenticated — the service client behind the event gate is the only
-- reader. NOTIFY pgrst so the table enters the OpenAPI inventory
-- (`npm run check:schema` reads it CHAIN-ONLY until this has run).
--
-- READERS: nothing selects `side` or the table until phase 3 PR 4, gated on
-- `check:schema` OK after this ran (a select naming a missing column 404s
-- the whole event API — the 207 lesson).
-- ============================================================================

-- ── The format vocabulary ───────────────────────────────────────────────────
ALTER TABLE sport_events DROP CONSTRAINT IF EXISTS sport_events_format_check;
ALTER TABLE sport_events ADD CONSTRAINT sport_events_format_check
  CHECK (format IN ('stroke_gross', 'stroke_net', 'match_gross', 'match_net'));

-- ── A side per member ───────────────────────────────────────────────────────
ALTER TABLE sport_event_group_members
  ADD COLUMN IF NOT EXISTS side smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_group_members_side_check' AND conrelid = 'public.sport_event_group_members'::regclass) THEN
    ALTER TABLE sport_event_group_members ADD CONSTRAINT sport_event_group_members_side_check CHECK (side IS NULL OR side IN (1, 2));
  END IF;
END $$;

-- ── The match row ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sport_event_matches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_event_round_id uuid NOT NULL REFERENCES sport_event_rounds(id) ON DELETE CASCADE,
  group_id             uuid NOT NULL REFERENCES sport_event_groups(id) ON DELETE CASCADE,
  concessions          jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT sport_event_matches_concessions_check CHECK (jsonb_typeof(concessions) = 'array'),
  extra_holes          jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT sport_event_matches_extra_holes_check CHECK (jsonb_typeof(extra_holes) = 'array'),
  decided_by           text CONSTRAINT sport_event_matches_decided_by_check CHECK (decided_by IS NULL OR decided_by IN ('holes', 'concession', 'extra_holes', 'organizer', 'bye')),
  winner_side          smallint CONSTRAINT sport_event_matches_winner_side_check CHECK (winner_side IS NULL OR winner_side IN (1, 2)),
  result               text CONSTRAINT sport_event_matches_result_check CHECK (result IS NULL OR length(btrim(result)) BETWEEN 1 AND 40),
  decided_at           timestamptz,
  version              integer NOT NULL DEFAULT 0 CONSTRAINT sport_event_matches_version_check CHECK (version >= 0),
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sport_event_matches_group_uniq   UNIQUE (group_id),
  CONSTRAINT sport_event_matches_decided_check CHECK (
    ((decided_by IS NULL) = (winner_side IS NULL))
    AND ((decided_by IS NULL) = (result IS NULL))
    AND ((decided_by IS NULL) = (decided_at IS NULL))
  )
);

ALTER TABLE sport_event_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_event_matches FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sport_event_matches_updated_at ON sport_event_matches;
CREATE TRIGGER sport_event_matches_updated_at
  BEFORE UPDATE ON sport_event_matches
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- The read: a round's matches (the bracket reads every round's).
CREATE INDEX IF NOT EXISTS idx_sport_event_matches_round
  ON sport_event_matches (sport_event_round_id);

COMMENT ON TABLE  sport_event_matches IS 'One row per match (= a group with two sides on a match-format round; 212). Intent that no card can carry — concessions, sudden-death extra holes, an organizer decision, a bye — plus the outcome written ONCE at round completion. Status is computed on read, never stored. `version` is the app-level compare-and-set.';
COMMENT ON COLUMN sport_event_matches.concessions IS '[{hole: n | null, by_side: 1|2, by: participant_id, at}] — the side that GIVES the concession; hole null concedes the match (decided at once).';
COMMENT ON COLUMN sport_event_matches.extra_holes IS '[{n, hole_number, strokes: {participant_id: n | null}}] — sudden death after all square on the last; keyed by participant so four-ball keeps both balls; never in golf_hole_scores (CHECK 1..18, UNIQUE per card).';
COMMENT ON COLUMN sport_event_matches.version IS 'App-level CAS: every write is UPDATE … WHERE id AND version = seen; 0 rows = 409. Never trigger-bumped (the 039 lesson).';
COMMENT ON COLUMN sport_event_group_members.side IS '1 | 2 on a match-format round (212; uniform, singles too — the engine never guesses a side from position); NULL on a stroke round.';
COMMENT ON CONSTRAINT sport_events_format_check ON sport_events IS 'stroke_gross | stroke_net | match_gross | match_net (widened by 212).';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 212 APPLIED | 1 | 1 | 1
SELECT '212 APPLIED' AS result,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sport_event_matches') AS table_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_group_members' AND column_name = 'side' AND data_type = 'smallint') AS side_column_expect_1,
       (SELECT (pg_get_constraintdef(oid) LIKE '%match_net%')::int FROM pg_constraint WHERE conname = 'sport_events_format_check' AND conrelid = 'public.sport_events'::regclass) AS format_carries_match_expect_1;

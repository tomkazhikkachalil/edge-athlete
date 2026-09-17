-- ============================================================================
-- 221: Events + formats leftovers — the ONE migration of the program
--      (Stableford · the one-act bracket link · a round's own timezone)
-- ============================================================================
-- Three additive changes on the events tables, each with its own app-side
-- window (nothing selects the new columns until its reader PR, gated on
-- `check:schema` OK after this ran — a select naming a missing column 404s
-- the whole read, the 207 lesson; the two format values are a 23514 window
-- until the parser's list widens):
--
--   * sport_events.format widens to stableford_gross | stableford_net (DROP +
--     ADD of 212's CHECK — Stableford in BOTH flavours, Tom's decision; the
--     boards rank by points, the mirror keeps the strokes).
--   * sport_events.competition_id uuid → competitions(id) ON DELETE SET NULL:
--     a BRACKETED match event's org golf bracket, kept from link time so each
--     round's matches are stamped onto the bracket's contests (220) at
--     go-live — stage n ↔ round n, slot k ↔ match k. Written ONLY by the
--     match-bracket path (a stroke / game event keeps 211's contest rows);
--     a partial index for the org console's reverse lookup.
--   * sport_event_rounds.timezone text: a team round's start is read on the
--     ROUND's clock (nullable = today's behaviour: the viewer's clock); the
--     length CHECK matches the app's validator (an IANA name, ≤ 64).
-- ============================================================================

-- ── The format vocabulary ───────────────────────────────────────────────────
ALTER TABLE sport_events DROP CONSTRAINT IF EXISTS sport_events_format_check;
ALTER TABLE sport_events ADD CONSTRAINT sport_events_format_check
  CHECK (format IN ('stroke_gross', 'stroke_net', 'match_gross', 'match_net', 'stableford_gross', 'stableford_net'));

-- ── The bracket link ────────────────────────────────────────────────────────
ALTER TABLE sport_events
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES competitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sport_events_competition
  ON sport_events (competition_id) WHERE competition_id IS NOT NULL;

-- ── The round's zone ────────────────────────────────────────────────────────
ALTER TABLE sport_event_rounds
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE sport_event_rounds DROP CONSTRAINT IF EXISTS sport_event_rounds_timezone_check;
ALTER TABLE sport_event_rounds ADD CONSTRAINT sport_event_rounds_timezone_check
  CHECK (timezone IS NULL OR length(timezone) BETWEEN 1 AND 64);

COMMENT ON COLUMN sport_events.competition_id IS 'A bracketed MATCH event''s org golf bracket (221): kept from link time; each round''s matches are stamped onto the bracket''s contests (220) at go-live — stage n ↔ round n, slot k ↔ match k. Written only by the match-bracket path.';
COMMENT ON COLUMN sport_event_rounds.timezone IS 'The round''s own IANA zone (221): its start is read on this clock; NULL = the viewer''s clock.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 221 APPLIED | 1 | 1 | 1 | 1
SELECT '221 APPLIED' AS result,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'sport_events_format_check' AND conrelid = 'public.sport_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%stableford_net%') AS format_check_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'competition_id' AND data_type = 'uuid') AS competition_column_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_sport_events_competition' AND indexdef LIKE '%WHERE%') AS competition_index_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_rounds' AND column_name = 'timezone' AND data_type = 'text') AS timezone_column_expect_1;

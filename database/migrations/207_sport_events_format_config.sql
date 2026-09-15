-- ============================================================================
-- 207: sport_events.format_config · sport_event_rounds.name · the flight
--      CHECK (Events program, phase 2 — the phase's ONE migration)
-- ============================================================================
-- Phase 2 (tournaments) needed no DDL for N rounds, the round lifecycle,
-- the overall board, flights, breakdowns or regrouping — 201–204 already
-- carry the sequence, the per-round status, the per-round groups and posts
-- and the participant's flight. What an organizer must STORE is here:
--
--   sport_events.format_config  jsonb, {} by default — the organizer's
--       format options. Today: {cut?: {after_round, top_n? | to_par?}} —
--       after round K, the top N (ties at the nth place all make it, the
--       PGA norm) or everyone at or under a to-par score play on; the
--       missed-cut set is excluded from the mint of every later round and
--       ranked below the line on the overall board. Reserved key:
--       `stableford` (parked). Validated by src/lib/sport-events/
--       format-config.ts parseFormatConfig (strict keys — an unknown key is
--       a 400 naming it); ONE writer: PATCH /api/sport-events/[id]. A jsonb
--       and not columns because the option set is the format's, not the
--       table's — a Stableford or a match-play format brings its own keys
--       and no ALTER; the shape is pinned by the parser's tests.
--   sport_event_rounds.name  text, nullable — an optional label
--       ("Saturday", "Final round"); `sequence` stays the order.
--   sport_event_participants.flight  gains the CHECK the app already
--       enforces (validate.ts normalizeFlight: 1..20 characters, trimmed).
--       Phase 1 never wrote the column; phase 2's writers (PR 6) only write
--       normalized labels, so no live row violates it. Pre-flight, if in
--       doubt:  SELECT count(*) FROM sport_event_participants
--               WHERE flight IS NOT NULL
--                 AND length(btrim(flight)) NOT BETWEEN 1 AND 20;  -- 0
--
-- Fast defaults (PG ≥ 11), small tables, no rewrite, no red window. The
-- constraints are added in a DO block so a re-run is a no-op (the 204
-- shape): `ADD COLUMN IF NOT EXISTS … CONSTRAINT` skips the constraint
-- with the column when the column already exists.
--
-- ORDER: this file runs BEFORE the PR that reads the columns (PR 8). Every
-- gate read selects EVENT_COLUMNS / ROUND_COLUMNS — a select naming a
-- column that does not exist is 42703 and 404s the whole API — so those
-- lists name `format_config` and `name` only once this has run.
-- ============================================================================

ALTER TABLE sport_events
  ADD COLUMN IF NOT EXISTS format_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sport_event_rounds
  ADD COLUMN IF NOT EXISTS name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_events_format_config_check' AND conrelid = 'public.sport_events'::regclass) THEN
    ALTER TABLE sport_events ADD CONSTRAINT sport_events_format_config_check CHECK (jsonb_typeof(format_config) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_rounds_name_check' AND conrelid = 'public.sport_event_rounds'::regclass) THEN
    ALTER TABLE sport_event_rounds ADD CONSTRAINT sport_event_rounds_name_check CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sport_event_participants_flight_check' AND conrelid = 'public.sport_event_participants'::regclass) THEN
    ALTER TABLE sport_event_participants ADD CONSTRAINT sport_event_participants_flight_check CHECK (flight IS NULL OR length(btrim(flight)) BETWEEN 1 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN sport_events.format_config IS 'Organizer format options (207): {cut?: {after_round, top_n? | to_par?}}. Validated by src/lib/sport-events/format-config.ts parseFormatConfig; ONE writer: PATCH /api/sport-events/[id]. Reserved key: stableford (parked).';
COMMENT ON COLUMN sport_event_rounds.name IS 'Optional label ("Saturday", "Final round"); sequence stays the order. Written by the rounds routes.';

NOTIFY pgrst, 'reload schema';

-- ── Result (the ONE row the editor shows; the nine-row grid is the twin,
--    database/tests/diagnostics/verify-207-sport-events.sql) ──────────────
-- Expected: 207 APPLIED | 2 | 3
SELECT '207 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'sport_events' AND column_name = 'format_config')
             OR (table_name = 'sport_event_rounds' AND column_name = 'name'))) AS columns_expect_2,
       (SELECT count(*) FROM pg_constraint
         WHERE conname IN ('sport_events_format_config_check', 'sport_event_rounds_name_check', 'sport_event_participants_flight_check')) AS constraints_expect_3;

-- ============================================================================
-- 214: open joining + recorders (Events program, phase 4 — the first of the
--      phase's three schema migrations; 215 = team rounds, 216 = media)
-- ============================================================================
-- Tom (Sep 16 2026): joining is FULLY OPEN unless the organizer closes it;
-- new events default to public; the organizer picks the recording mode —
-- named recorders (anyone, playing or not) and/or self-entry.
--
--   * sport_events.join_mode widens to 'open' (DROP + ADD of the ONE named
--     CHECK — 201's grid still counts 11 constraints on the table, 207's 12;
--     a 23514 window, not 42703: the app names 'open' only after this ran,
--     phase 4 PR 4). One-tap Join for any signed-in person; capacity and the
--     waitlist still apply.
--   * sport_events.visibility DEFAULT → 'public' (existing rows UNTOUCHED —
--     no UPDATE; the app's parsers and the wizard flip their fallbacks in
--     PR 4).
--   * sport_events.self_entry boolean NOT NULL DEFAULT true — "players enter
--     their own". The recording mode is DERIVED (self | recorder | both) from
--     this flag and the recorder rows: no CHECK, no impossible state.
--   * sport_event_participants.recorder boolean NOT NULL DEFAULT false — set
--     on ANY accepted row: a player, a co-organizer, or a follower (a
--     follower row with recorder = true is the non-playing recorder; 202's
--     follower_check still holds since playing stays false). A recorder
--     enters for everyone on the admin client (`via: 'recorder'`).
--
-- READERS: nothing selects `self_entry` / `recorder` until phase 4 PR 4/5,
-- gated on `check:schema` OK after this ran (a select naming a missing
-- column 404s the whole event API — the 207 lesson).
-- ============================================================================

ALTER TABLE sport_events DROP CONSTRAINT IF EXISTS sport_events_join_mode_check;
ALTER TABLE sport_events ADD CONSTRAINT sport_events_join_mode_check
  CHECK (join_mode IN ('invite', 'request', 'open'));

ALTER TABLE sport_events ALTER COLUMN visibility SET DEFAULT 'public';

ALTER TABLE sport_events
  ADD COLUMN IF NOT EXISTS self_entry boolean NOT NULL DEFAULT true;

ALTER TABLE sport_event_participants
  ADD COLUMN IF NOT EXISTS recorder boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sport_events.self_entry IS 'Players enter their own scores / stats (214). The recording mode is derived: self_entry + the recorder rows → self | recorder | both. Organizers always may record.';
COMMENT ON COLUMN sport_event_participants.recorder IS 'A named recorder (214): enters scores / stats for everyone in the event; on any accepted row — a player, a co-organizer, or a follower (non-playing).';
COMMENT ON CONSTRAINT sport_events_join_mode_check ON sport_events IS 'invite | request | open (widened by 214: one-tap Join for any signed-in person).';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 214 APPLIED | 3 | 1 | 1
SELECT '214 APPLIED' AS result,
       (SELECT (pg_get_constraintdef(oid) LIKE '%''open''%')::int + (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'self_entry' AND data_type = 'boolean')::int + (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_event_participants' AND column_name = 'recorder' AND data_type = 'boolean')::int
          FROM pg_constraint WHERE conname = 'sport_events_join_mode_check' AND conrelid = 'public.sport_events'::regclass) AS changes_expect_3,
       (SELECT (column_default LIKE '%public%')::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'visibility') AS default_public_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.sport_events'::regclass AND contype IN ('c', 'u', 'p')) / 12 AS constraints_12_expect_1;

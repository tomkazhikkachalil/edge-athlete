-- ============================================================================
-- 265: activity details, effort, and the sport session (Oct 16 2026; the
--      activities details program's first DDL — runs on BOTH staging and
--      prod BEFORE A6 deploys. Nothing selects the new columns until then.)
-- ============================================================================
-- Tom's review (Oct 16): every activity takes an optional EFFORT 1–10 at the
-- finish (the only intensity a timer-only session has; Training's load is
-- minutes × effort), and each type asks up to three optional questions
-- whose answers live in ONE flexible field, so a new question is code, not
-- a migration.
--
-- The model (every column nullable — an activity without them is exactly
-- what it was):
--   activities.effort        1–10, the athlete's rating at the finish
--   activities.details       the per-type answers (yoga style, pool length,
--                            the climbs …) — a jsonb OBJECT validated per type
--                            in code (src/lib/activities/details.ts), ≤ 8,000
--                            characters (50 climbs fit with room)
--   activities.sport_key     a sport_session's sport (a SportRegistry key —
--                            no CHECK pins sport keys, adding a sport is data)
--   activities.session_kind  practice | game | other; needs a sport_key
--   workout_sessions.effort  1–10, the same rating on a gym session
-- and activity_type gains 'sport_session' (a timed practice or game tagged
-- with a sport — counts toward Training's week, never a result).
--
-- REVERSAL: drop the five columns and their checks; re-add the type CHECK
-- without 'sport_session' (only if no row uses it). Re-runnable until the
-- ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 265) THEN
    RAISE EXCEPTION '265 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 264 THEN RAISE EXCEPTION '265 pre-flight: ledger head is %, expected 264', n; END IF;
END $$;

-- ── 1. activity_type: + sport_session (widening only; every row stays valid) ─
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN (
    -- outdoor, GPS
    'run', 'trail_run', 'walk', 'hike', 'ride', 'mountain_bike', 'open_water_swim', 'paddle', 'ski', 'xc_ski', 'snowboard', 'skate',
    -- indoor, a timer, distance entered at finish
    'swim', 'row', 'indoor_ride', 'treadmill', 'elliptical', 'stair_climber',
    -- duration only
    'yoga', 'pilates', 'stretch', 'hiit', 'martial_arts', 'dance', 'climb', 'other',
    -- a sport practice or game
    'sport_session')) NOT VALID;
ALTER TABLE public.activities VALIDATE CONSTRAINT activities_activity_type_check;

-- ── 2. activities: effort, details, the sport session ───────────────────────
-- One statement per column: the departed-account tests read the chain above
-- the baseline one ADD COLUMN per ALTER.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS effort smallint;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS details jsonb;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS sport_key text;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS session_kind text;

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_effort_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_effort_check
  CHECK (effort IS NULL OR effort BETWEEN 1 AND 10);
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_details_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_details_check
  CHECK (details IS NULL OR (jsonb_typeof(details) = 'object' AND length(details::text) <= 8000));
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_sport_key_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_sport_key_check
  CHECK (sport_key IS NULL OR length(sport_key) BETWEEN 1 AND 40);
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_session_kind_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_session_kind_check
  CHECK (session_kind IS NULL OR (session_kind IN ('practice', 'game', 'other') AND sport_key IS NOT NULL));

COMMENT ON COLUMN public.activities.effort IS 'How hard it felt, 1–10, asked at the finish (265). Training load = minutes × effort; an unrated activity adds no load.';
COMMENT ON COLUMN public.activities.details IS 'The per-type answers (265): a jsonb object validated per type by src/lib/activities/details.ts — a new question is code, never DDL.';
COMMENT ON COLUMN public.activities.sport_key IS 'A sport_session''s sport (265): a SportRegistry key. Never a result.';
COMMENT ON COLUMN public.activities.session_kind IS 'A sport_session''s kind (265): practice | game | other.';

-- ── 3. workout_sessions: effort ─────────────────────────────────────────────
ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS effort smallint;
ALTER TABLE public.workout_sessions DROP CONSTRAINT IF EXISTS workout_sessions_effort_check;
ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_effort_check
  CHECK (effort IS NULL OR effort BETWEEN 1 AND 10);
COMMENT ON COLUMN public.workout_sessions.effort IS 'How hard the session felt, 1–10, asked at the finish (265).';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (265, '265_activity_details_effort.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 265 APPLIED | 5 | 5 | true | 265
SELECT '265 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
          AND ((table_name = 'activities' AND column_name IN ('effort', 'details', 'sport_key', 'session_kind'))
            OR (table_name = 'workout_sessions' AND column_name = 'effort'))) AS cols_expect_5,
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('activities_effort_check', 'activities_details_check', 'activities_sport_key_check', 'activities_session_kind_check', 'workout_sessions_effort_check')) AS checks_expect_5,
       (SELECT pg_get_constraintdef(oid) LIKE '%sport_session%' FROM pg_constraint WHERE conname = 'activities_activity_type_check') AS type_has_sport_session,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_265;

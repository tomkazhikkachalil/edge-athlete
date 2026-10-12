-- ============================================================================
-- 260: the workout screen program — a stable exercise id, supersets and
--      circuits, pauses, an untimed workout, rest per set (Oct 12 2026; the
--      program's ONLY DDL; runs on BOTH staging and prod BEFORE PR 1 deploys —
--      the TypeScript insert paths name the new columns)
-- ============================================================================
-- Tom's spec: Start/Pause beside the clock and a menu with "Hide timer" /
-- "Don't time this workout"; Add superset / Add circuit (grouped exercises
-- done for rounds, each keeping its own reps and weight per round); rename an
-- exercise without losing its sets, with a STABLE id; a rest timer that
-- records each rest and a stopwatch that saves to the set; a summary of
-- total / active / rest time saved into stats — every new field optional so
-- every saved workout opens, displays and counts exactly as today.
--
-- The model (every column defaulted or nullable):
--   workout_sessions
--     timed           the clock runs (default true); false → duration_seconds
--                     is NULL at finish and Vitals counts no minutes
--     paused_seconds  closed pauses so far (the recorder's pausedTotalMs rule)
--     paused_at       a live pause; NULL otherwise. Only an ACTIVE session may
--                     be paused — every finish (the PATCH, the 7-day sweep)
--                     writes it NULL.
--   workout_exercises
--     client_id       the STABLE id. Every save is a whole-snapshot replace
--                     (256: delete + reinsert), so `id` is re-minted on each
--                     save; the editor mints client_id once (crypto.randomUUID)
--                     and the replace CARRIES it. The volatile default fills
--                     every existing row distinctly. UNIQUE per session.
--     group_id / group_kind / group_rounds
--                     a superset or circuit, denormalized on every member
--                     (the group = the members sharing group_id, consecutive
--                     by position; a member's SETS are its rounds). All three
--                     set or all three NULL. The rounds cap is the routines'
--                     target_sets cap (079: 1..10) — one number everywhere.
--   workout_sets
--     rest_seconds    the rest taken BEFORE this set (the rest timer). Never
--                     "data": a rest-only row is not a set.
--   workout_routine_exercises
--     group_id / group_kind / group_rounds — a routine keeps its circuits.
--   No session-level rest column: review-mode edits change sets without
--   re-finishing, so a Σ written at finish would drift; Σ rest is derived
--   from the sets (computeSummary) by every reader, which already loads them.
--
--   replace_workout_entries is re-declared (same signature, CREATE OR
--   REPLACE — the grants survive) to carry client_id (COALESCE with the
--   default: a payload without one — an old client — still gets a distinct
--   id), the group fields and rest_seconds.
--
-- REVERSAL: drop the eleven columns and the index; re-declare the function
-- from 256. Re-runnable until the ledger row lands; a second run stops in
-- the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 260) THEN
    RAISE EXCEPTION '260 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 259 THEN RAISE EXCEPTION '260 pre-flight: ledger head is %, expected 259', n; END IF;
END $$;

-- ── 1. workout_sessions: the clock's facts ──────────────────────────────────
ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS timed          boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS paused_seconds int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at      timestamptz;
ALTER TABLE public.workout_sessions DROP CONSTRAINT IF EXISTS workout_sessions_paused_seconds_check;
ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_paused_seconds_check
  CHECK (paused_seconds >= 0);
ALTER TABLE public.workout_sessions DROP CONSTRAINT IF EXISTS workout_sessions_paused_at_check;
ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_sessions_paused_at_check
  CHECK (paused_at IS NULL OR status = 'active');
COMMENT ON COLUMN public.workout_sessions.timed IS 'The clock runs (260). false: duration_seconds is NULL at finish; Vitals counts the session with no minutes.';
COMMENT ON COLUMN public.workout_sessions.paused_seconds IS 'Closed pauses so far, seconds (260). The clock = now − started_at − paused_seconds − an open pause.';
COMMENT ON COLUMN public.workout_sessions.paused_at IS 'A live pause (260); NULL otherwise. Only an active session may be paused — every finish writes NULL.';

-- ── 2. workout_exercises: the stable id and the group ───────────────────────
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS client_id    uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS group_id     uuid,
  ADD COLUMN IF NOT EXISTS group_kind   text,
  ADD COLUMN IF NOT EXISTS group_rounds int;
ALTER TABLE public.workout_exercises DROP CONSTRAINT IF EXISTS workout_exercises_group_kind_check;
ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_group_kind_check
  CHECK (group_kind IS NULL OR group_kind IN ('superset', 'circuit'));
ALTER TABLE public.workout_exercises DROP CONSTRAINT IF EXISTS workout_exercises_group_rounds_check;
ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_group_rounds_check
  CHECK (group_rounds IS NULL OR group_rounds BETWEEN 1 AND 10);
ALTER TABLE public.workout_exercises DROP CONSTRAINT IF EXISTS workout_exercises_group_all_or_none_check;
ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_group_all_or_none_check
  CHECK ((group_id IS NULL) = (group_kind IS NULL) AND (group_id IS NULL) = (group_rounds IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_exercises_session_client
  ON public.workout_exercises(session_id, client_id);
COMMENT ON COLUMN public.workout_exercises.client_id IS 'The STABLE exercise id (260): minted once by the editor and carried through every snapshot replace (id is re-minted per save). Unique per session.';
COMMENT ON COLUMN public.workout_exercises.group_id IS 'A superset or circuit (260): the members share it, consecutive by position; kind and rounds are denormalized on every member.';
COMMENT ON COLUMN public.workout_exercises.group_kind IS 'superset | circuit (260).';
COMMENT ON COLUMN public.workout_exercises.group_rounds IS 'Rounds of the group (260), 1..10 — the routines target_sets cap. A member''s sets are its rounds.';

-- ── 3. workout_sets: the rest before a set ──────────────────────────────────
ALTER TABLE public.workout_sets
  ADD COLUMN IF NOT EXISTS rest_seconds int;
ALTER TABLE public.workout_sets DROP CONSTRAINT IF EXISTS workout_sets_rest_seconds_check;
ALTER TABLE public.workout_sets ADD CONSTRAINT workout_sets_rest_seconds_check
  CHECK (rest_seconds IS NULL OR (rest_seconds >= 0 AND rest_seconds <= 86400));
COMMENT ON COLUMN public.workout_sets.rest_seconds IS 'The rest taken BEFORE this set, seconds (260; the rest timer). Not data: a rest-only row is not a set.';

-- ── 4. workout_routine_exercises: a routine keeps its circuits ──────────────
ALTER TABLE public.workout_routine_exercises
  ADD COLUMN IF NOT EXISTS group_id     uuid,
  ADD COLUMN IF NOT EXISTS group_kind   text,
  ADD COLUMN IF NOT EXISTS group_rounds int;
ALTER TABLE public.workout_routine_exercises DROP CONSTRAINT IF EXISTS workout_routine_exercises_group_kind_check;
ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_group_kind_check
  CHECK (group_kind IS NULL OR group_kind IN ('superset', 'circuit'));
ALTER TABLE public.workout_routine_exercises DROP CONSTRAINT IF EXISTS workout_routine_exercises_group_rounds_check;
ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_group_rounds_check
  CHECK (group_rounds IS NULL OR group_rounds BETWEEN 1 AND 10);
ALTER TABLE public.workout_routine_exercises DROP CONSTRAINT IF EXISTS workout_routine_exercises_group_all_or_none_check;
ALTER TABLE public.workout_routine_exercises ADD CONSTRAINT workout_routine_exercises_group_all_or_none_check
  CHECK ((group_id IS NULL) = (group_kind IS NULL) AND (group_id IS NULL) = (group_rounds IS NULL));

-- ── 5. The replace carries the new fields ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_workout_entries(
  p_session_id uuid,
  p_profile_id uuid,
  p_saved_at timestamptz,
  p_exercises jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_last timestamptz;
  v_exercise record;
  v_set jsonb;
  v_exercise_id uuid;
BEGIN
  -- The lock: concurrent PUTs for the same session queue here, one at a time.
  SELECT status, last_activity_at INTO v_status, v_last
    FROM public.workout_sessions
   WHERE id = p_session_id AND profile_id = p_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- The stale rule, inside the lock (live sessions only — entries-stale.ts).
  IF v_status <> 'completed' AND v_last IS NOT NULL AND p_saved_at <= v_last THEN
    RETURN jsonb_build_object('ok', false, 'stale', true);
  END IF;

  DELETE FROM public.workout_exercises WHERE session_id = p_session_id;

  FOR v_exercise IN
    SELECT value AS ex, (ordinality - 1)::int AS position
      FROM jsonb_array_elements(COALESCE(p_exercises, '[]'::jsonb)) WITH ORDINALITY
  LOOP
    -- 260: client_id is CARRIED (the editor's stable id); a payload without
    -- one (an old client) gets a distinct id from the default.
    INSERT INTO public.workout_exercises (
      session_id, profile_id, name, exercise_key, category, position, notes,
      client_id, group_id, group_kind, group_rounds
    )
    VALUES (
      p_session_id,
      p_profile_id,
      v_exercise.ex->>'name',
      v_exercise.ex->>'exerciseKey',
      COALESCE(v_exercise.ex->>'category', 'strength'),
      v_exercise.position,
      v_exercise.ex->>'notes',
      COALESCE((v_exercise.ex->>'clientId')::uuid, gen_random_uuid()),
      (v_exercise.ex->>'groupId')::uuid,
      v_exercise.ex->>'groupKind',
      (v_exercise.ex->>'groupRounds')::int
    )
    RETURNING id INTO v_exercise_id;

    FOR v_set IN SELECT value FROM jsonb_array_elements(COALESCE(v_exercise.ex->'sets', '[]'::jsonb))
    LOOP
      INSERT INTO public.workout_sets (
        exercise_id, profile_id, set_number, reps, weight, weight_unit,
        duration_seconds, distance, distance_unit, completed_at, media, rest_seconds
      )
      VALUES (
        v_exercise_id,
        p_profile_id,
        (v_set->>'setNumber')::int,
        (v_set->>'reps')::int,
        (v_set->>'weight')::numeric,
        v_set->>'weightUnit',
        (v_set->>'durationSeconds')::int,
        (v_set->>'distance')::numeric,
        v_set->>'distanceUnit',
        (v_set->>'completedAt')::timestamptz,
        COALESCE(v_set->'media', '[]'::jsonb),
        (v_set->>'restSeconds')::int
      );
    END LOOP;
  END LOOP;

  -- A live session's activity moves with the write; a completed one keeps its end.
  IF v_status <> 'completed' THEN
    UPDATE public.workout_sessions SET last_activity_at = p_saved_at WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
COMMENT ON FUNCTION public.replace_workout_entries IS 'Replace a workout session''s exercises and sets in ONE transaction, serialized per session by FOR UPDATE (256): the stale rule for live sessions runs inside the lock; a completed session is never guarded and its end time never moves. Since 260 it carries the editor''s stable client_id, the group fields and rest_seconds. Service role only; the route validates and heals the payload first.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (260, '260_workout_screen.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 260 APPLIED | 3 | 4 | 1 | 3 | true | 260
SELECT '260 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workout_sessions' AND column_name IN ('timed', 'paused_seconds', 'paused_at')) AS session_cols_expect_3,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workout_exercises' AND column_name IN ('client_id', 'group_id', 'group_kind', 'group_rounds')) AS exercise_cols_expect_4,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workout_sets' AND column_name = 'rest_seconds') AS set_cols_expect_1,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workout_routine_exercises' AND column_name IN ('group_id', 'group_kind', 'group_rounds')) AS routine_cols_expect_3,
       (SELECT pg_get_functiondef('public.replace_workout_entries(uuid, uuid, timestamptz, jsonb)'::regprocedure) LIKE '%client_id%') AS rpc_carries_client_id_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_260;

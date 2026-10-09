-- ============================================================================
-- Migration 256 — the workout entries replace is ONE transaction, serialized
-- per session (workout capture round PR 4, Oct 9 2026)
--
-- WHY: `PUT /api/workouts/[id]/entries` replaced a session's exercises with
-- three admin-client calls — read the session, DELETE the exercises (sets
-- cascade), INSERT the new ones — and its stale-write guard compared the
-- snapshot's savedAt to `last_activity_at` read BEFORE either write. Two
-- PUTs in flight at once (the editor's debounced save and the keepalive
-- flush a reload fires) both passed the guard, both deleted, both inserted —
-- and the athlete came back to every exercise TWICE (three times on the
-- retry). The capture round's production probe caught it: a reload mid-save
-- on production's latency duplicated "Bench Press" on two attempts out of
-- two. The race is older than the round (the route's own header called the
-- pair "not a true transaction"); the round made a reload mid-save a tested
-- path.
--
-- WHAT: `public.replace_workout_entries(session, profile, saved_at, exercises)`
-- — `SELECT … FOR UPDATE` on the session row serializes concurrent callers;
-- the stale rule runs INSIDE the lock (live sessions only — a completed
-- session's last_activity_at is its END time, `entries-stale.ts`); delete +
-- reinsert + the activity stamp are one transaction. The payload is the
-- validated EntryExercise[] the route already builds (camelCase keys); the
-- route validates and heals BEFORE calling, as before. Service role only.
--
-- Pre-flight: ledger head 255. Deploy order: FLEXIBLE — the route calls the
-- function and falls back to the three-call path while it is missing
-- (42883), so the code may ship first. Reversal (data-safe): drop the function;
-- the route falls back.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 256) THEN
    RAISE EXCEPTION '256 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 255 THEN RAISE EXCEPTION '256 pre-flight: ledger head is %, expected 255', n; END IF;
END $$;

-- ── 1. The replace ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.replace_workout_entries(uuid, uuid, timestamptz, jsonb);
CREATE FUNCTION public.replace_workout_entries(
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
    INSERT INTO public.workout_exercises (session_id, profile_id, name, exercise_key, category, position, notes)
    VALUES (
      p_session_id,
      p_profile_id,
      v_exercise.ex->>'name',
      v_exercise.ex->>'exerciseKey',
      COALESCE(v_exercise.ex->>'category', 'strength'),
      v_exercise.position,
      v_exercise.ex->>'notes'
    )
    RETURNING id INTO v_exercise_id;

    FOR v_set IN SELECT value FROM jsonb_array_elements(COALESCE(v_exercise.ex->'sets', '[]'::jsonb))
    LOOP
      INSERT INTO public.workout_sets (
        exercise_id, profile_id, set_number, reps, weight, weight_unit,
        duration_seconds, distance, distance_unit, completed_at, media
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
        COALESCE(v_set->'media', '[]'::jsonb)
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
REVOKE EXECUTE ON FUNCTION public.replace_workout_entries(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_workout_entries(uuid, uuid, timestamptz, jsonb) TO service_role;
COMMENT ON FUNCTION public.replace_workout_entries IS 'Replace a workout session''s exercises and sets in ONE transaction, serialized per session by FOR UPDATE (256): the stale rule for live sessions runs inside the lock; a completed session is never guarded and its end time never moves. Service role only; the route validates and heals the payload first.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (256, '256_workout_entries_atomic_replace.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 256 APPLIED | 1 | 256
SELECT '256 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc WHERE proname = 'replace_workout_entries') AS fn_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_256;

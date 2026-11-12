-- ============================================================================
-- 306: one exercise, one indexed reference; and the pins of the Training
--      showcase (Training redesign PR 2 of 8, Nov 11 2026). Runs on BOTH
--      staging and prod BEFORE the code deploys: the writers of PR 2 insert
--      `exercise_ref`, and a direct insert of a missing column fails.
-- ============================================================================
-- Tom: "we need to group and store information, slightly differently."
--
-- A. workout_exercises.exercise_ref — the exercise's identity as
--    src/lib/workouts/exercise-identity.ts spells it (a catalog key, a slug
--    the catalog knows, else the name's slug). Until now one exercise's
--    history could only be read by reading EVERY set the athlete ever logged
--    (no index on the exercise at all; a typed name had no key to index).
--    The column is an INDEX FILTER, never the truth: every reader recomputes
--    the identity from exercise_key and name, so a stale ref can miss a row
--    but can never put a row under the wrong exercise. Bests stay derived
--    from the sets — nothing here stores a record.
--      • backfilled once below (the catalog's keys, label slugs and aliases
--        as of Nov 11 2026, the SAME slug expression as the TypeScript:
--        lowercase, every run of anything but a letter or digit → "_",
--        trimmed, 80 characters). scripts/check-exercise-refs.mjs proves
--        stored = TypeScript on real rows, both databases;
--      • filled by the route from then on (replace_workout_entries carries
--        `exerciseRef`; the two direct inserts set the column);
--      • (profile_id, exercise_ref) replaces idx_workout_exercises_profile,
--        which it prefix-covers (the 276 rule).
--    Nullable until 307 (rows a pre-306 deploy writes between this file and
--    the code are healed there, then SET NOT NULL).
--
-- B. training_pins — up to six bests an athlete pins to the top of Training
--    (Tom's decision 4). Posture A: RLS on, zero policies, service_role only;
--    the route is the privacy boundary, as for every Training read.
--      kind 'exercise' → ref = an exercise_ref, record_kind = a PrKind
--      kind 'test'     → ref = an athlete_vitals metric_key, record_kind NULL
--      kind 'effort'   → reserved (an activity's best effort), not written yet
--
-- Reversal: DROP TABLE training_pins; re-declare replace_workout_entries
-- from 260; CREATE INDEX idx_workout_exercises_profile (profile_id); DROP
-- INDEX idx_workout_exercises_profile_ref; DROP COLUMN exercise_ref.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 306) THEN
    RAISE EXCEPTION '306 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 305 THEN RAISE EXCEPTION '306 pre-flight: ledger head is %, expected 305', n; END IF;
  IF to_regprocedure('public.replace_workout_entries(uuid,uuid,timestamptz,jsonb)') IS NULL THEN
    RAISE EXCEPTION '306 pre-flight: replace_workout_entries (260''s signature) is missing';
  END IF;
END $$;

-- ── 1. The column ───────────────────────────────────────────────────────────
ALTER TABLE public.workout_exercises ADD COLUMN IF NOT EXISTS exercise_ref text;
ALTER TABLE public.workout_exercises DROP CONSTRAINT IF EXISTS workout_exercises_exercise_ref_check;
ALTER TABLE public.workout_exercises ADD CONSTRAINT workout_exercises_exercise_ref_check
  CHECK (exercise_ref IS NULL OR char_length(exercise_ref) BETWEEN 1 AND 80);
COMMENT ON COLUMN public.workout_exercises.exercise_ref IS 'The exercise''s identity (306; src/lib/workouts/exercise-identity.ts): a catalog key, a slug the catalog knows, else the name''s slug. An INDEX FILTER written by the route — readers recompute identity from exercise_key and name. NULL = written by a deploy older than 306 (307 heals).';

-- ── 2. The backfill (one pass over a narrow table) ──────────────────────────
WITH cat(key) AS (VALUES ('bench_press'), ('incline_bench_press'), ('squat'), ('front_squat'), ('deadlift'), ('romanian_deadlift'), ('overhead_press'), ('pull_ups'), ('chin_ups'), ('push_ups'), ('dips'), ('barbell_row'), ('dumbbell_row'), ('lat_pulldown'), ('bicep_curl'), ('tricep_extension'), ('lateral_raise'), ('lunge'), ('leg_press'), ('leg_curl'), ('calf_raise'), ('hip_thrust'), ('kettlebell_swing'), ('clean'), ('snatch'), ('med_ball_slam'), ('sit_ups'), ('walk'), ('hike'), ('run'), ('sprint'), ('bike'), ('row_erg'), ('swim'), ('stair_climber'), ('elliptical'), ('jump_rope'), ('hiit_circuit'), ('plank'), ('stretching'), ('yoga'), ('foam_roll')),
slugs(slug, key) AS (VALUES ('lunges','lunge'), ('power_clean','clean'), ('sprints','sprint'), ('rowing_erg','row_erg'), ('foam_rolling','foam_roll'), ('bench','bench_press'), ('back_squat','squat'), ('ohp','overhead_press'), ('rdl','romanian_deadlift'), ('pull_up','pull_ups'), ('pullup','pull_ups'), ('pullups','pull_ups'), ('chin_up','chin_ups'), ('chinup','chin_ups'), ('chinups','chin_ups'), ('push_up','push_ups'), ('pushup','push_ups'), ('pushups','push_ups'), ('sit_up','sit_ups'), ('situp','sit_ups'), ('situps','sit_ups'), ('dip','dips'), ('planks','plank')),
src AS (
  SELECT e.id,
         e.exercise_key,
         e.name,
         left(trim(both '_' from regexp_replace(lower(e.name), '[^[:alnum:]]+', '_', 'g')), 80) AS slug
    FROM public.workout_exercises e
   WHERE e.exercise_ref IS NULL
)
UPDATE public.workout_exercises w
   SET exercise_ref = CASE
         WHEN s.exercise_key IN (SELECT key FROM cat) THEN s.exercise_key
         WHEN s.slug = '' THEN NULLIF(left(lower(btrim(s.name, E' \t\n\r')), 80), '')
         WHEN s.slug IN (SELECT key FROM cat) THEN s.slug
         ELSE COALESCE((SELECT k.key FROM slugs k WHERE k.slug = s.slug), s.slug)
       END
  FROM src s
 WHERE w.id = s.id;

-- ── 3. The index (and the one it prefix-covers goes — the 276 rule) ─────────
CREATE INDEX IF NOT EXISTS idx_workout_exercises_profile_ref ON public.workout_exercises (profile_id, exercise_ref);
DROP INDEX IF EXISTS public.idx_workout_exercises_profile;

-- ── 4. The replace carries the reference ────────────────────────────────────
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
      client_id, group_id, group_kind, group_rounds, exercise_ref
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
      (v_exercise.ex->>'groupRounds')::int,
      -- 306: the identity the ROUTE computed (exercise-identity.ts); a payload
      -- without one (a deploy older than the migration) leaves it NULL — readers
      -- recompute identity from key and name, and 307 heals the gap.
      left(NULLIF(v_exercise.ex->>'exerciseRef', ''), 80)
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
COMMENT ON FUNCTION public.replace_workout_entries IS 'Replace a workout session''s exercises and sets in ONE transaction, serialized per session by FOR UPDATE (256): the stale rule for live sessions runs inside the lock; a completed session is never guarded and its end time never moves. Since 260 it carries the editor''s stable client_id, the group fields and rest_seconds; since 306 the exercise_ref the route computed. Service role only; the route validates and heals the payload first.';

-- ── 5. The pins ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_pins (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  kind text NOT NULL,
  ref text NOT NULL,
  record_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, position)
);
ALTER TABLE public.training_pins DROP CONSTRAINT IF EXISTS training_pins_position_check;
ALTER TABLE public.training_pins ADD CONSTRAINT training_pins_position_check CHECK (position BETWEEN 1 AND 6);
ALTER TABLE public.training_pins DROP CONSTRAINT IF EXISTS training_pins_kind_check;
ALTER TABLE public.training_pins ADD CONSTRAINT training_pins_kind_check CHECK (kind IN ('exercise', 'test', 'effort'));
ALTER TABLE public.training_pins DROP CONSTRAINT IF EXISTS training_pins_ref_check;
ALTER TABLE public.training_pins ADD CONSTRAINT training_pins_ref_check CHECK (char_length(ref) BETWEEN 1 AND 80);
ALTER TABLE public.training_pins DROP CONSTRAINT IF EXISTS training_pins_record_kind_check;
ALTER TABLE public.training_pins ADD CONSTRAINT training_pins_record_kind_check
  CHECK (record_kind IS NULL OR record_kind IN ('heaviest', 'e1rm', 'reps', 'volume', 'duration'));
-- One thing is pinned once (NULL record_kind included: a test has one best).
CREATE UNIQUE INDEX IF NOT EXISTS training_pins_one_per_thing ON public.training_pins (profile_id, kind, ref, COALESCE(record_kind, ''));

ALTER TABLE public.training_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_pins FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_pins TO service_role;
COMMENT ON TABLE public.training_pins IS 'The bests an athlete pins to the top of Training (306): up to six per profile, in order. kind exercise (ref = workout_exercises.exercise_ref, record_kind = heaviest|e1rm|reps|volume|duration), test (ref = athlete_vitals.metric_key), effort (reserved). The VALUE is never stored here — it is derived on read. RLS on, no policies: service role only; the route applies the training privacy rule.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (306, '306_training_exercise_ref_pins.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 306 APPLIED | <rows> | 0 (or the count of nameless rows) | 1 | 0 | true | 1 | false | 306
SELECT '306 APPLIED' AS result,
       (SELECT count(*) FROM public.workout_exercises) AS exercise_rows,
       (SELECT count(*) FROM public.workout_exercises WHERE exercise_ref IS NULL) AS null_refs_expect_0,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_workout_exercises_profile_ref') AS new_index_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_workout_exercises_profile') AS old_index_expect_0,
       (SELECT pg_get_functiondef('public.replace_workout_entries(uuid, uuid, timestamptz, jsonb)'::regprocedure) LIKE '%exerciseRef%') AS rpc_carries_ref_expect_true,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'training_pins') AS pins_table_expect_1,
       has_table_privilege('anon', 'public.training_pins', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_306;

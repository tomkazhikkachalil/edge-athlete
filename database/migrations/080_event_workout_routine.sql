-- ============================================================================
-- Migration 080 — Scheduled workouts: events ↔ workout_routines
-- ============================================================================
-- A calendar event can carry a workout routine, so users schedule a workout
-- for a date, open the event on the day, and start the session from it.
--
-- routine_id is a LIVE reference: the detail view and the start endpoint
-- always resolve the organizer's CURRENT routine version (Tom's decision —
-- edit the routine Tuesday, Friday's event runs the updated version).
-- ON DELETE SET NULL, not CASCADE: the event outlives the routine via
-- routine_snapshot.
--
-- routine_snapshot is a frozen {name, exercises: RoutineExercise[]} captured
-- when the routine is attached (create, or PATCH that changes routine_id) —
-- the fallback when the routine is later deleted. JSONB rather than rows
-- (contrast 079's rows-not-JSONB stance): this is a write-once display
-- artifact with no independent lifecycle, never queried per-exercise, and
-- copied verbatim onto every recurrence occurrence. Shape is exactly the
-- validateRoutinePayload output (src/lib/workouts/routines.ts):
--   { "name": "Push Day", "exercises": [ { "name": "Bench Press",
--     "exerciseKey": "bench_press", "category": "strength",
--     "notes": null, "targetSets": 3 } ] }
--
-- No expected-duration column: the event window (ends_at - starts_at, which
-- the form already collects) IS the expected duration.
-- No RLS changes: events is service-role-only with app-layer auth (057).
-- No notification changes: event_invite/event_update/etc. reuse as-is.
--
-- ⚠️ RUN BEFORE DEPLOYING the calendar-workouts PR (EVENT_FIELDS selects the
--    new columns → 42703 otherwise). Idempotent. Supabase SQL Editor.
-- ============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS routine_id UUID
    REFERENCES public.workout_routines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routine_snapshot JSONB;

-- The ON DELETE SET NULL fan-out on routine delete must not seq-scan events
CREATE INDEX IF NOT EXISTS idx_events_routine_id
  ON public.events(routine_id) WHERE routine_id IS NOT NULL;

-- Widen the category enum with 'workout' (full-list drop + re-add; 057
-- declared this CHECK inline on the column, which Postgres auto-names
-- events_category_check. If the DROP is a no-op, find the real name with:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.events'::regclass AND contype = 'c';
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_category_check;
ALTER TABLE public.events ADD CONSTRAINT events_category_check CHECK (category IN
  ('general','practice','game','tournament','training','social','other','workout'));

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'events'
--    AND column_name IN ('routine_id','routine_snapshot');       → 2 rows
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'events' AND indexname = 'idx_events_routine_id';
--                                                                → 1 row
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.events'::regclass
--    AND conname = 'events_category_check';    → list includes 'workout'
-- INSERT INTO public.events (organizer_id, title, starts_at, ends_at, category)
--  SELECT id, 'check', now(), now() + interval '1 hour', 'workout'
--    FROM public.profiles LIMIT 1;  -- then DELETE it — CHECK accepts 'workout'

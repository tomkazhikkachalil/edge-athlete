// Scheduled-workout routine resolution (migration 080).
//
// An event's routine_id is a LIVE reference — the detail view and the start
// endpoint always resolve the organizer's CURRENT routine. routine_snapshot
// is the frozen copy taken at attach time, used only when the live routine is
// gone (deleted, or no longer owned by the organizer). Same rule for every
// viewer, one code path.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateRoutinePayload,
  type RoutineExercise,
  type ServerRoutineRow,
} from '@/lib/workouts/routines';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface RoutinePlan {
  name: string;
  exercises: RoutineExercise[];
}

export interface EventRoutine extends RoutinePlan {
  source: 'live' | 'snapshot';
}

/** Frozen snapshot shape written to events.routine_snapshot at attach time. */
export function buildRoutineSnapshot(row: ServerRoutineRow): RoutinePlan {
  return {
    name: row.name,
    exercises: [...(row.exercises ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(exercise => ({
        name: exercise.name,
        exerciseKey: exercise.exercise_key,
        category: exercise.category,
        notes: exercise.notes,
        targetSets: exercise.target_sets,
      })),
  };
}

/**
 * Guard for snapshots read back from the DB. Snapshots are written server-side
 * only, so this exists for forward-compat and corrupt-data safety — a failed
 * parse means "no workout attached", never seeding garbage into a session.
 */
export function parseRoutineSnapshot(raw: unknown): RoutinePlan | null {
  const validated = validateRoutinePayload(raw);
  if (!validated.ok) return null;
  return { name: validated.name, exercises: validated.exercises };
}

/** Live routine wins; snapshot is the deletion fallback. */
export function pickRoutineSource(
  live: RoutinePlan | null,
  snapshot: unknown
): EventRoutine | null {
  if (live) return { ...live, source: 'live' };
  const parsed = parseRoutineSnapshot(snapshot);
  return parsed ? { ...parsed, source: 'snapshot' } : null;
}

/**
 * Resolve the routine an event shows/starts. Live only when the routine row
 * still exists AND is still owned by the organizer — an id recycled to some
 * other user must never leak through the admin client.
 */
export async function resolveEventRoutine(
  admin: Admin,
  event: { organizer_id: string; routine_id: string | null; routine_snapshot: unknown }
): Promise<EventRoutine | null> {
  if (!event.routine_id && !event.routine_snapshot) return null;
  let live: RoutinePlan | null = null;
  if (event.routine_id) {
    const { data: row } = await admin
      .from('workout_routines')
      .select(
        `id, name, created_at, updated_at,
         exercises:workout_routine_exercises (
           name, exercise_key, category, position, notes, target_sets
         )`
      )
      .eq('id', event.routine_id)
      .eq('profile_id', event.organizer_id)
      .maybeSingle();
    if (row) live = buildRoutineSnapshot(row as unknown as ServerRoutineRow);
  }
  return pickRoutineSource(live, event.routine_snapshot);
}

/** 'YYYY-MM-DD' of an instant in an IANA zone (dependency-free). */
function dayKeyInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Client-side gate for the Start This Workout CTA: active event, viewer not
 * declined (organizer bypasses status), and "today" in the EVENT's zone falls
 * within [start day … end day]. The exclusive all-day end (midnight of the
 * following day, 057 convention) is handled by the -1ms on ends_at.
 *
 * Deliberately a UX nudge only — the server checks access + cancellation but
 * not the day window (starting your own workout early is harmless).
 */
export function canStartEventWorkout(input: {
  status: 'active' | 'cancelled';
  starts_at: string;
  ends_at: string;
  timezone: string;
  isOrganizer: boolean;
  myStatus: string | null;
  now: number;
}): boolean {
  if (input.status !== 'active') return false;
  if (!input.isOrganizer && input.myStatus === 'declined') return false;
  let today: string;
  let firstDay: string;
  let lastDay: string;
  try {
    today = dayKeyInZone(input.now, input.timezone);
    firstDay = dayKeyInZone(Date.parse(input.starts_at), input.timezone);
    lastDay = dayKeyInZone(Date.parse(input.ends_at) - 1, input.timezone);
  } catch {
    return false;
  }
  return today >= firstDay && today <= lastDay;
}

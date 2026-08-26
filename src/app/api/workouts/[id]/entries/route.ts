import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { validateEntriesPayload } from '@/lib/workouts/entries';

/**
 * PUT /api/workouts/[id]/entries — owner only.
 *
 * Full-snapshot replace of a session's exercises+sets. The client's state is
 * the source of truth (mirrored to localStorage + here, debounced + on a
 * keepalive flush). Body: { savedAt: epochMs, exercises: EntryExercise[] }.
 *
 * Stale-write guard: snapshots with savedAt <= last_activity_at no-op with
 * { stale: true } — an out-of-order debounce/keepalive race can never
 * overwrite a newer snapshot.
 *
 * The delete-then-reinsert pair is not a true transaction (two admin-client
 * calls). On a set-insert failure we retry once, then 500 — the client draft
 * still holds the snapshot and the next debounced PUT repairs.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid workout ID' }, { status: 400 });
    }
    const body = await request.json();

    const savedAt = Number(body.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0) {
      return NextResponse.json({ error: 'savedAt is required' }, { status: 400 });
    }
    const validated = validateEntriesPayload(body.exercises ?? []);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { data: session, error: fetchError } = await supabase
      .from('workout_sessions')
      .select('profile_id, last_activity_at')
      .eq('id', id)
      .single();

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
    }
    if (session.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Stale-write guard
    if (session.last_activity_at && savedAt <= Date.parse(session.last_activity_at)) {
      return NextResponse.json({ stale: true, savedAt });
    }

    // Replace children: delete (sets cascade via exercises) + bulk reinsert
    const { error: deleteError } = await supabase
      .from('workout_exercises')
      .delete()
      .eq('session_id', id);
    if (deleteError) {
      console.error('Entries replace: delete failed:', deleteError);
      return NextResponse.json({ error: 'Failed to save workout entries' }, { status: 500 });
    }

    if (validated.exercises.length > 0) {
      const { data: exerciseRows, error: exercisesError } = await supabase
        .from('workout_exercises')
        .insert(
          validated.exercises.map((exercise, index) => ({
            session_id: id,
            profile_id: user.id,
            name: exercise.name,
            exercise_key: exercise.exerciseKey,
            category: exercise.category,
            position: index,
            notes: exercise.notes,
          }))
        )
        .select('id, position');

      if (exercisesError || !exerciseRows) {
        console.error('Entries replace: exercise insert failed:', exercisesError);
        return NextResponse.json({ error: 'Failed to save workout entries' }, { status: 500 });
      }

      const byPosition = new Map(exerciseRows.map(row => [row.position, row.id]));
      const setRows = validated.exercises.flatMap((exercise, index) =>
        exercise.sets.map(set => ({
          exercise_id: byPosition.get(index),
          profile_id: user.id,
          set_number: set.setNumber,
          reps: set.reps,
          weight: set.weight,
          weight_unit: set.weightUnit,
          duration_seconds: set.durationSeconds,
          distance: set.distance,
          distance_unit: set.distanceUnit,
          completed_at: set.completedAt,
          media: set.media,
        }))
      );

      if (setRows.length > 0) {
        let { error: setsError } = await supabase.from('workout_sets').insert(setRows);
        if (setsError) {
          // One retry — transient failures shouldn't strand a half-written snapshot
          ({ error: setsError } = await supabase.from('workout_sets').insert(setRows));
        }
        if (setsError) {
          console.error('Entries replace: set insert failed twice:', setsError);
          return NextResponse.json({ error: 'Failed to save workout entries' }, { status: 500 });
        }
      }
    }

    await supabase
      .from('workout_sessions')
      .update({ last_activity_at: new Date(savedAt).toISOString() })
      .eq('id', id);

    return NextResponse.json({ ok: true, savedAt });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PUT /api/workouts/[id]/entries error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

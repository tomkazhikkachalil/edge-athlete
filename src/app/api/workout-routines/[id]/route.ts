import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import {
  ROUTINE_SELECT,
  serverToRoutine,
  validateRoutinePayload,
  type ServerRoutineRow,
} from '@/lib/workouts/routines';

/**
 * PATCH  /api/workout-routines/[id] — owner only. { name?, exercises? }.
 *   Exercises are a full-snapshot replace (delete + reinsert, like the
 *   session entries PUT). No stale-write guard: this is a settings surface
 *   with one editor, last write wins. 409 on a duplicate name.
 * DELETE /api/workout-routines/[id] — owner only; cascade removes exercises.
 *   Sessions started from the routine are copies and are untouched.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid routine ID' }, { status: 400 });
    }
    const body = await request.json();

    const { data: routine, error: fetchError } = await supabase
      .from('workout_routines')
      .select('id, profile_id, name')
      .eq('id', id)
      .single();

    if (fetchError || !routine) {
      return NextResponse.json({ error: 'Routine not found' }, { status: 404 });
    }
    if (routine.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const hasName = body.name !== undefined;
    const hasExercises = body.exercises !== undefined;
    if (!hasName && !hasExercises) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Validate the full shape once — reuse the create validator with the
    // routine's current name standing in when only exercises change (and a
    // placeholder exercise when only the name changes).
    const validated = validateRoutinePayload({
      name: hasName ? body.name : routine.name,
      exercises: hasExercises
        ? body.exercises
        : [{ name: 'x', exerciseKey: null, category: 'other', notes: null, targetSets: 1 }],
    });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    if (hasName) {
      const { error: nameError } = await supabase
        .from('workout_routines')
        .update({ name: validated.name })
        .eq('id', id);
      if (nameError) {
        if (nameError.code === '23505') {
          return NextResponse.json(
            { error: 'You already have a routine with this name' },
            { status: 409 }
          );
        }
        console.error('Error renaming routine:', nameError);
        return NextResponse.json({ error: 'Failed to save routine' }, { status: 500 });
      }
    }

    if (hasExercises) {
      const { error: deleteError } = await supabase
        .from('workout_routine_exercises')
        .delete()
        .eq('routine_id', id);
      if (deleteError) {
        console.error('Routine replace: delete failed:', deleteError);
        return NextResponse.json({ error: 'Failed to save routine' }, { status: 500 });
      }

      let { error: insertError } = await supabase.from('workout_routine_exercises').insert(
        validated.exercises.map((exercise, index) => ({
          routine_id: id,
          profile_id: user.id,
          name: exercise.name,
          exercise_key: exercise.exerciseKey,
          category: exercise.category,
          position: index,
          notes: exercise.notes,
          target_sets: exercise.targetSets,
        }))
      );
      if (insertError) {
        // One retry — a transient failure shouldn't strand an emptied routine
        ({ error: insertError } = await supabase.from('workout_routine_exercises').insert(
          validated.exercises.map((exercise, index) => ({
            routine_id: id,
            profile_id: user.id,
            name: exercise.name,
            exercise_key: exercise.exerciseKey,
            category: exercise.category,
            position: index,
            notes: exercise.notes,
            target_sets: exercise.targetSets,
          }))
        ));
      }
      if (insertError) {
        console.error('Routine replace: insert failed twice:', insertError);
        return NextResponse.json({ error: 'Failed to save routine' }, { status: 500 });
      }

      // Exercise-only edits still bump updated_at for list ordering
      if (!hasName) {
        await supabase
          .from('workout_routines')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', id);
      }
    }

    const { data: full } = await supabase
      .from('workout_routines')
      .select(ROUTINE_SELECT)
      .eq('id', id)
      .single();

    return NextResponse.json({
      routine: serverToRoutine(full as unknown as ServerRoutineRow),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/workout-routines/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid routine ID' }, { status: 400 });
    }

    const { data: routine, error: fetchError } = await supabase
      .from('workout_routines')
      .select('id, profile_id')
      .eq('id', id)
      .single();

    if (fetchError || !routine) {
      return NextResponse.json({ error: 'Routine not found' }, { status: 404 });
    }
    if (routine.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from('workout_routines')
      .delete()
      .eq('id', id);
    if (deleteError) {
      console.error('Error deleting routine:', deleteError);
      return NextResponse.json({ error: 'Failed to delete routine' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/workout-routines/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import {
  MAX_ROUTINES,
  ROUTINE_SELECT,
  serverToRoutine,
  validateRoutinePayload,
  type ServerRoutineRow,
} from '@/lib/workouts/routines';

/**
 * Saved workout routines (presets). Owner-only in both directions — routines
 * are private planning data with no visitor-facing surface, so there is no
 * profileId param and no public branch (contrast /api/workouts GET).
 *
 * GET  /api/workout-routines            → { routines } newest-updated first
 * POST /api/workout-routines            → { name, exercises } — create;
 *      409 on a duplicate name (case-insensitive), 400 at the routine cap
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    const { data: rows, error } = await supabase
      .from('workout_routines')
      .select(ROUTINE_SELECT)
      .eq('profile_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching routines:', error);
      return NextResponse.json({ error: 'Failed to fetch routines' }, { status: 500 });
    }

    return NextResponse.json({
      routines: ((rows ?? []) as unknown as ServerRoutineRow[]).map(serverToRoutine),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/workout-routines error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const body = await request.json();

    const validated = validateRoutinePayload(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { count } = await supabase
      .from('workout_routines')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id);
    if ((count ?? 0) >= MAX_ROUTINES) {
      return NextResponse.json(
        { error: `Routine limit reached (max ${MAX_ROUTINES})` },
        { status: 400 }
      );
    }

    const { data: routine, error: routineError } = await supabase
      .from('workout_routines')
      .insert({ profile_id: user.id, name: validated.name })
      .select('id')
      .single();

    if (routineError || !routine) {
      if (routineError?.code === '23505') {
        return NextResponse.json(
          { error: 'You already have a routine with this name' },
          { status: 409 }
        );
      }
      console.error('Error creating routine:', routineError);
      return NextResponse.json({ error: 'Failed to save routine' }, { status: 500 });
    }

    const { error: exercisesError } = await supabase.from('workout_routine_exercises').insert(
      validated.exercises.map((exercise, index) => ({
        routine_id: routine.id,
        profile_id: user.id,
        name: exercise.name,
        exercise_key: exercise.exerciseKey,
        category: exercise.category,
        position: index,
        notes: exercise.notes,
        target_sets: exercise.targetSets,
      }))
    );

    if (exercisesError) {
      // Compensating delete — nothing half-saved (cascade removes children)
      console.error('Routine creation failed at exercises:', exercisesError);
      await supabase.from('workout_routines').delete().eq('id', routine.id);
      return NextResponse.json(
        { error: 'Nothing was saved — please try again.' },
        { status: 500 }
      );
    }

    const { data: full } = await supabase
      .from('workout_routines')
      .select(ROUTINE_SELECT)
      .eq('id', routine.id)
      .single();

    return NextResponse.json(
      { routine: serverToRoutine(full as unknown as ServerRoutineRow) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/workout-routines error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

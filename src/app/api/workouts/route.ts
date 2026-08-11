import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { validateEntriesPayload, type EntryExercise } from '@/lib/workouts/entries';
import { routineToEntries, type ServerRoutineRow } from '@/lib/workouts/routines';
import { effectiveSessionStatus, staleFinalizeFields } from '@/lib/workouts/status';

/**
 * Edge Vitals workout sessions.
 *
 * GET  /api/workouts?profileId=xxx[&status=active][&limit=20]
 *   Sessions with nested exercises/sets, newest first. Access model mirrors
 *   /api/vitals: owner sees all; public profiles visible to everyone;
 *   accepted followers see private profiles. Non-owners only ever receive
 *   COMPLETED sessions. The owner's read lazily finalizes stale actives
 *   (>6h idle) — no cron.
 *
 * POST /api/workouts
 *   { mode: 'live', title?, routineId? } → start a live session (409 if one
 *                                          is already in progress). With
 *                                          routineId, the routine's exercises
 *                                          are MATERIALIZED into the session
 *                                          (copy-on-start: target_sets empty
 *                                          set rows each; the routine itself
 *                                          is never referenced again) before
 *                                          the response, so a refresh right
 *                                          after starting still sees them.
 *   { mode: 'manual', title?, startedAt, durationSeconds, notes?, exercises }
 *                                        → back-log a completed workout
 *                                          atomically (compensating delete)
 */

const SESSION_SELECT = `
  *,
  exercises:workout_exercises (
    *,
    sets:workout_sets (*)
  )
`;

interface SessionRow {
  id: string;
  status: string;
  started_at: string;
  last_activity_at: string;
  exercises?: Array<{ position: number; sets?: Array<{ set_number: number }> }>;
}

function sortNested(sessions: SessionRow[]): void {
  for (const session of sessions) {
    session.exercises?.sort((a, b) => a.position - b.position);
    for (const exercise of session.exercises ?? []) {
      exercise.sets?.sort((a, b) => a.set_number - b.set_number);
    }
  }
}

/**
 * Bulk-insert a session's exercises+sets (two admin-client calls, not a true
 * transaction). Callers compensate by deleting the session on failure —
 * cascade removes any half-written children.
 */
async function insertSessionEntries(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  profileId: string,
  exercises: EntryExercise[]
): Promise<{ ok: true } | { ok: false; step: string; error: unknown }> {
  if (exercises.length === 0) return { ok: true };

  const { data: exerciseRows, error: exercisesError } = await supabase
    .from('workout_exercises')
    .insert(
      exercises.map((exercise, index) => ({
        session_id: sessionId,
        profile_id: profileId,
        name: exercise.name,
        exercise_key: exercise.exerciseKey,
        category: exercise.category,
        position: index,
        notes: exercise.notes,
      }))
    )
    .select('id, position');

  if (exercisesError || !exerciseRows) {
    return { ok: false, step: 'exercises', error: exercisesError };
  }

  const byPosition = new Map(exerciseRows.map(row => [row.position, row.id]));
  const setRows = exercises.flatMap((exercise, index) =>
    exercise.sets.map(set => ({
      exercise_id: byPosition.get(index),
      profile_id: profileId,
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
    const { error: setsError } = await supabase.from('workout_sets').insert(setRows);
    if (setsError) {
      return { ok: false, step: 'sets', error: setsError };
    }
  }
  return { ok: true };
}

/** Persist auto-end for any of the owner's stale active sessions. */
async function finalizeStaleActives(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string
): Promise<void> {
  const { data: actives } = await supabase
    .from('workout_sessions')
    .select('id, status, started_at, last_activity_at')
    .eq('profile_id', profileId)
    .eq('status', 'active');

  for (const session of actives ?? []) {
    if (
      effectiveSessionStatus({ status: 'active', lastActivityAt: session.last_activity_at }) ===
      'completed'
    ) {
      await supabase
        .from('workout_sessions')
        .update(
          staleFinalizeFields({
            startedAt: session.started_at,
            lastActivityAt: session.last_activity_at,
          })
        )
        .eq('id', session.id);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const statusFilter = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 50);

    if (!profileId) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    // Optional auth — needed for private profile / owner access
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      currentUserId = null;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, visibility')
      .eq('id', profileId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const isOwner = currentUserId === profileId;
    const isPublic = profile.visibility === 'public';

    if (!isOwner && !isPublic) {
      if (!currentUserId) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
      const { data: followRecord } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', currentUserId)
        .eq('following_id', profileId)
        .eq('status', 'accepted')
        .maybeSingle();
      if (!followRecord) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    // Owner reads finalize abandoned live sessions before listing
    if (isOwner) {
      await finalizeStaleActives(supabase, profileId);
    }

    let query = supabase
      .from('workout_sessions')
      .select(SESSION_SELECT)
      .eq('profile_id', profileId)
      .order('started_at', { ascending: false })
      .limit(limit);

    // Non-owners never see in-progress sessions
    if (!isOwner) {
      query = query.eq('status', 'completed');
    } else if (statusFilter === 'active') {
      query = query.eq('status', 'active');
    }

    const { data: sessions, error } = await query;

    if (error) {
      console.error('Error fetching workouts:', error);
      return NextResponse.json({ error: 'Failed to fetch workouts' }, { status: 500 });
    }

    sortNested((sessions ?? []) as unknown as SessionRow[]);
    return NextResponse.json({ sessions: sessions || [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/workouts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const body = await request.json();

    const title =
      typeof body.title === 'string' && body.title.trim().length > 0
        ? body.title.trim().slice(0, 120)
        : null;

    if (body.mode === 'live') {
      // One live session at a time: finalize a stale one, 409 on a fresh one
      const { data: actives } = await supabase
        .from('workout_sessions')
        .select('id, started_at, last_activity_at')
        .eq('profile_id', user.id)
        .eq('status', 'active');

      for (const active of actives ?? []) {
        const effective = effectiveSessionStatus({
          status: 'active',
          lastActivityAt: active.last_activity_at,
        });
        if (effective === 'completed') {
          await supabase
            .from('workout_sessions')
            .update(
              staleFinalizeFields({
                startedAt: active.started_at,
                lastActivityAt: active.last_activity_at,
              })
            )
            .eq('id', active.id);
        } else {
          return NextResponse.json(
            { error: 'Workout already in progress', activeSessionId: active.id },
            { status: 409 }
          );
        }
      }

      // Starting from a saved routine: authorize + load it BEFORE creating
      // the session, so a bad routineId never leaves an empty session behind
      let routine: ServerRoutineRow | null = null;
      if (body.routineId !== undefined) {
        if (typeof body.routineId !== 'string' || body.routineId.length === 0) {
          return NextResponse.json({ error: 'Invalid routine' }, { status: 400 });
        }
        const { data: routineRow, error: routineError } = await supabase
          .from('workout_routines')
          .select(
            `id, name, created_at, updated_at, profile_id,
             exercises:workout_routine_exercises (
               name, exercise_key, category, position, notes, target_sets
             )`
          )
          .eq('id', body.routineId)
          .single();
        if (routineError || !routineRow) {
          return NextResponse.json({ error: 'Routine not found' }, { status: 404 });
        }
        if (routineRow.profile_id !== user.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }
        routine = routineRow as unknown as ServerRoutineRow;
      }

      const now = new Date().toISOString();
      const { data: session, error } = await supabase
        .from('workout_sessions')
        .insert({
          profile_id: user.id,
          title: title ?? routine?.name ?? null,
          status: 'active',
          source: 'live',
          started_at: now,
          last_activity_at: now,
        })
        .select()
        .single();

      if (error) {
        console.error('Error starting workout:', error);
        return NextResponse.json({ error: 'Failed to start workout' }, { status: 500 });
      }

      if (routine) {
        // Copy-on-start: materialize the routine's exercises with empty sets
        const seeded = routineToEntries(
          [...(routine.exercises ?? [])]
            .sort((a, b) => a.position - b.position)
            .map(exercise => ({
              name: exercise.name,
              exerciseKey: exercise.exercise_key,
              category: exercise.category,
              notes: exercise.notes,
              targetSets: exercise.target_sets,
            }))
        );
        const result = await insertSessionEntries(supabase, session.id, user.id, seeded);
        if (!result.ok) {
          console.error(`Routine start failed at ${result.step}:`, result.error);
          await supabase.from('workout_sessions').delete().eq('id', session.id);
          return NextResponse.json(
            { error: 'Nothing was saved — please try again.' },
            { status: 500 }
          );
        }
        const { data: full } = await supabase
          .from('workout_sessions')
          .select(SESSION_SELECT)
          .eq('id', session.id)
          .single();
        sortNested([full] as unknown as SessionRow[]);
        return NextResponse.json({ session: full ?? session }, { status: 201 });
      }

      return NextResponse.json({ session }, { status: 201 });
    }

    if (body.mode === 'manual') {
      const startedAtMs = Date.parse(body.startedAt);
      if (Number.isNaN(startedAtMs) || startedAtMs > Date.now() + 24 * 60 * 60 * 1000) {
        return NextResponse.json({ error: 'A valid start date is required' }, { status: 400 });
      }
      const durationSeconds = Number(body.durationSeconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds < 60 || durationSeconds > 86400) {
        return NextResponse.json(
          { error: 'Duration must be between 1 minute and 24 hours' },
          { status: 400 }
        );
      }
      const notes =
        typeof body.notes === 'string' && body.notes.trim().length > 0
          ? body.notes.trim().slice(0, 1000)
          : null;
      const validated = validateEntriesPayload(body.exercises ?? []);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }

      const startedAtIso = new Date(startedAtMs).toISOString();
      const endedAtIso = new Date(startedAtMs + durationSeconds * 1000).toISOString();

      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          profile_id: user.id,
          title,
          notes,
          status: 'completed',
          source: 'manual',
          started_at: startedAtIso,
          ended_at: endedAtIso,
          duration_seconds: Math.floor(durationSeconds),
          last_activity_at: endedAtIso,
        })
        .select()
        .single();

      if (sessionError || !session) {
        console.error('Error creating manual workout:', sessionError);
        return NextResponse.json({ error: 'Failed to save workout' }, { status: 500 });
      }

      // Children — compensating delete on failure (session cascade removes all)
      const result = await insertSessionEntries(supabase, session.id, user.id, validated.exercises);
      if (!result.ok) {
        console.error(`Manual workout creation failed at ${result.step}:`, result.error);
        await supabase.from('workout_sessions').delete().eq('id', session.id);
        return NextResponse.json(
          { error: 'Nothing was saved — please try again.' },
          { status: 500 }
        );
      }

      const { data: full } = await supabase
        .from('workout_sessions')
        .select(SESSION_SELECT)
        .eq('id', session.id)
        .single();
      sortNested([full] as unknown as SessionRow[]);
      return NextResponse.json({ session: full ?? session }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/workouts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

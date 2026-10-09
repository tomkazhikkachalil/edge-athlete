import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { validateEntriesPayload } from '@/lib/workouts/entries';
import { healEntriesMedia } from '@/lib/workouts/entries-heal-server';
import { entriesWriteIsStale, entriesWriteStampsActivity } from '@/lib/workouts/entries-stale';
import { reportRouteError } from '@/lib/observability/report';

/**
 * PUT /api/workouts/[id]/entries — owner only.
 *
 * Full-snapshot replace of a session's exercises+sets. The client's state is
 * the source of truth (mirrored to localStorage + here, debounced + on a
 * keepalive flush). Body: { savedAt: epochMs, exercises: EntryExercise[] }.
 *
 * Since migration 256 the replace is ONE transaction serialized per session
 * (`replace_workout_entries`, FOR UPDATE on the session row) — two PUTs in
 * flight at once used to both pass the guard and both reinsert (every
 * exercise twice; the capture round's production probe caught it). The
 * three-call path below it is the pre-256 fallback (42883).
 *
 * Stale-write guard (LIVE sessions only — `entries-stale.ts`): snapshots
 * with savedAt <= last_activity_at no-op with { stale: true } — an
 * out-of-order debounce/keepalive race can never overwrite a newer
 * snapshot. A COMPLETED session's last_activity_at is its END time (which a
 * manual log can put in the future), so review-mode edits are never
 * guarded and never move it (Oct 9 2026 — the share step's Edit / Remove
 * used to be dropped silently until the clock passed the workout's end).
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
    // The editor sends back the proxied paths the GET handed it — heal them to
    // the stored storage URLs before the pure validator (Oct 4 2026).
    const validated = validateEntriesPayload(healEntriesMedia(body.exercises ?? []));
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { data: session, error: fetchError } = await supabase
      .from('workout_sessions')
      .select('profile_id, status, last_activity_at')
      .eq('id', id)
      .single();

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
    }
    if (session.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // ONE transaction, serialized per session (256, Oct 9 2026): the lock, the
    // stale rule, the delete, the reinsert and the activity stamp happen
    // inside `replace_workout_entries`. Two PUTs in flight at once (the
    // debounced save and a reload's keepalive flush) used to both pass the
    // guard below and both reinsert — every exercise twice. Pre-256 (42883:
    // the function is missing) the three-call path below still runs.
    const { data: replaced, error: rpcError } = await supabase.rpc('replace_workout_entries', {
      p_session_id: id,
      p_profile_id: user.id,
      p_saved_at: new Date(savedAt).toISOString(),
      p_exercises: validated.exercises,
    });
    if (!rpcError) {
      const result = (replaced ?? {}) as { ok?: boolean; stale?: boolean; error?: string };
      if (result.ok) return NextResponse.json({ ok: true, savedAt });
      if (result.stale) return NextResponse.json({ stale: true, savedAt });
      if (result.error === 'not_found') return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
      reportRouteError('Entries replace: unexpected RPC result:', result);
      return NextResponse.json({ error: 'Failed to save workout entries' }, { status: 500 });
    }
    if (rpcError.code !== '42883') {
      reportRouteError('Entries replace: RPC failed:', rpcError);
      return NextResponse.json({ error: 'Failed to save workout entries' }, { status: 500 });
    }

    // ── Pre-256 fallback: the three-call path ──────────────────────────────
    // Stale-write guard — live sessions only (see the header).
    if (entriesWriteIsStale({ status: session.status, lastActivityAt: session.last_activity_at, savedAt })) {
      return NextResponse.json({ stale: true, savedAt });
    }

    // Replace children: delete (sets cascade via exercises) + bulk reinsert
    const { error: deleteError } = await supabase
      .from('workout_exercises')
      .delete()
      .eq('session_id', id);
    if (deleteError) {
      reportRouteError('Entries replace: delete failed:', deleteError);
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
        reportRouteError('Entries replace: exercise insert failed:', exercisesError);
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
          reportRouteError('Entries replace: set insert failed twice:', setsError);
          return NextResponse.json({ error: 'Failed to save workout entries' }, { status: 500 });
        }
      }
    }

    // A live session's activity moves with every write; a completed one keeps
    // its end time (the sweep and the history read it as the END).
    if (entriesWriteStampsActivity(session.status)) {
      await supabase
        .from('workout_sessions')
        .update({ last_activity_at: new Date(savedAt).toISOString() })
        .eq('id', id);
    }

    return NextResponse.json({ ok: true, savedAt });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('PUT /api/workouts/[id]/entries error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

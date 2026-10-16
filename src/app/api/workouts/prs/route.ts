import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { isUuid } from '@/lib/uuid';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import { bestsOf, foldBests, workoutUnit, type ExerciseBests } from '@/lib/workouts/prs';
import type { EntryExercise } from '@/lib/workouts/entries';

/**
 * GET /api/workouts/prs[?exclude=<sessionId>] — the signed-in athlete's
 * all-time bests per exercise (activities details A10, Oct 16 2026), derived
 * from every COMPLETED session's sets (workouts/prs.ts — no PR table; the sets
 * are the one fact). `exclude` leaves out the session being finished, so its
 * own sets are judged against everything BEFORE it. Owner-only, like every
 * workout read that is not a shared post. Viewer-dependent → private, no-store.
 * 200 { bests: { [exerciseId]: { name, heaviest, e1rm, reps, volume } }, unit: 'lb' | 'kg' }
 * — `unit` is the one most of the athlete's own sets were logged in (the
 * records read in it, as a workout's summary does).
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const PAGE = 200;
const MAX_SESSIONS = 2000;
const SELECT = 'id, exercises:workout_exercises ( name, exercise_key, position, client_id, category, notes, group_id, group_kind, group_rounds, sets:workout_sets (*) )';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const exclude = request.nextUrl.searchParams.get('exclude');
    if (exclude !== null && !isUuid(exclude)) return NextResponse.json({ error: 'Invalid workout ID' }, { status: 400, headers: NO_STORE });
    const admin = getSupabaseAdmin();
    const perSession: Map<string, ExerciseBests>[] = [];
    const allExercises: EntryExercise[] = [];
    for (let from = 0; from < MAX_SESSIONS; from += PAGE) {
      let q = admin.from('workout_sessions').select(SELECT).eq('profile_id', user.id).eq('status', 'completed').order('started_at', { ascending: false }).range(from, from + PAGE - 1);
      if (exclude) q = q.neq('id', exclude);
      const { data, error } = await q;
      if (error) {
        reportRouteError('[workouts/prs] read failed:', error);
        return NextResponse.json({ error: 'Could not read your records.' }, { status: 500, headers: NO_STORE });
      }
      for (const row of data ?? []) {
        const entries = serverToEntries(row as unknown as ServerWorkoutSession);
        perSession.push(bestsOf(entries));
        allExercises.push(...entries);
      }
      if (!data || data.length < PAGE) break;
    }
    return NextResponse.json({ bests: Object.fromEntries(foldBests(perSession)), unit: workoutUnit(allExercises) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[workouts/prs] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

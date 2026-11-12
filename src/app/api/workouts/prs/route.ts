import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { isUuid } from '@/lib/uuid';
import { readBestsSources } from '@/lib/workouts/bests-server';
import { bestsOf, foldBests, workoutUnit } from '@/lib/workouts/prs';

/**
 * GET /api/workouts/prs[?exclude=<sessionId>] — the signed-in athlete's
 * all-time bests per exercise (activities details A10, Oct 16 2026), derived
 * from every COMPLETED session's sets (workouts/prs.ts — no PR table; the sets
 * are the one fact). `exclude` leaves out the session being finished, so its
 * own sets are judged against everything BEFORE it — before in TIME (Training
 * redesign PR 1, Nov 11 2026): only sessions that started earlier are folded,
 * so a back-dated workout is never measured against the weeks after it.
 * Owner-only, like every
 * workout read that is not a shared post. Viewer-dependent → private, no-store.
 * 200 { bests: { [exerciseId]: { name, heaviest, e1rm, reps, volume } }, unit: 'lb' | 'kg' }
 * — `unit` is the one most of the athlete's own sets were logged in (the
 * records read in it, as a workout's summary does).
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const exclude = request.nextUrl.searchParams.get('exclude');
    if (exclude !== null && !isUuid(exclude)) return NextResponse.json({ error: 'Invalid workout ID' }, { status: 400, headers: NO_STORE });
    const admin = getSupabaseAdmin();
    // The narrow reader (Training redesign PR 5, Nov 11 2026): the exercise rows with five set
    // columns, never a clip — this route used to read every session with every set's media.
    // PR 6: a tested max raises the bar a session must beat, exactly as an earlier session does.
    const read = await readBestsSources(admin, user.id, { visitor: false });
    if (!read.ok) {
      reportRouteError('[workouts/prs] read failed:', new Error('exercise sessions read failed'));
      return NextResponse.json({ error: 'Could not read your records.' }, { status: 500, headers: NO_STORE });
    }
    // The excluded session's own start is the line: nothing at or after it is "earlier" (PR 1).
    // A session with no exercise rows is not in the read: its start is asked for directly.
    let before: number | null = null;
    if (exclude) {
      const own = read.workouts.find(s => s.id === exclude);
      if (own) before = Date.parse(own.startedAt);
      else {
        const { data } = await admin.from('workout_sessions').select('started_at').eq('id', exclude).eq('profile_id', user.id).maybeSingle();
        const startedAt = (data as { started_at?: string | null } | null)?.started_at;
        before = startedAt ? Date.parse(startedAt) : null;
      }
    }
    const earlier = read.sessions.filter(s => s.id !== exclude && (before === null || Date.parse(s.startedAt) < before));
    return NextResponse.json(
      { bests: Object.fromEntries(foldBests(earlier.map(s => bestsOf(s.exercises)))), unit: workoutUnit(earlier.filter(s => !s.tested).flatMap(s => s.exercises)) },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[workouts/prs] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

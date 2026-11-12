import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { resolveActivityAccess } from '@/lib/activities/read-server';
import { aspectHidden } from '@/lib/training-privacy';
import { fetchTrainingPrivacy } from '@/lib/training-privacy-server';
import { readBestsSources } from '@/lib/workouts/bests-server';
import { describeExercise, exerciseTimeline, sessionBests, summarizeExercises } from '@/lib/workouts/exercise-list';
import { foldBests, workoutUnit } from '@/lib/workouts/prs';

/**
 * GET /api/profile/[profileId]/training/bests — Training's Exercises view
 * (Training redesign PR 5, Nov 11 2026): every exercise the athlete has
 * trained with its all-time bests, derived from the sets on read.
 *   → { exercises: [{ ref, name, area, bests, headline, lastAt, sessions }], unit, isOwner }
 *
 * ?exercise=<ref> answers ONE exercise instead — its bests and its sessions,
 * newest first, each with its sets and the kinds it set a record in:
 *   → { exercise: { ref, name, area, bests }, timeline: [...], unit, isOwner }
 *
 * Until this route a visitor could see an athlete's workouts but never their
 * bests (GET /api/workouts/prs is the signed-in athlete's own). The gate is
 * the activity readers' ONE gate, then the Training privacy `records` aspect
 * (`hidden: true`, nothing else). A NON-OWNER's bests are folded only from
 * sessions that viewer could open — completed, not hidden, decided — so a
 * hidden workout's numbers never surface through a best; and when the
 * `workouts` aspect is hidden the timeline is withheld (the bests stand, the
 * sessions behind them stay private). Viewer-dependent: `private, no-store`.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };
/** An identity is a catalog key or a name's slug: letters, digits, underscores (exercise-identity.ts); nothing else reaches the filter. */
const REF = /^[\p{L}\p{N}_]{1,80}$/u;

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const access = await resolveActivityAccess(admin, user?.id ?? null, profileId);
    if (!access.ok) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });

    const isOwner = access.audience === 'owner';
    const privacy = isOwner ? null : await fetchTrainingPrivacy(admin, profileId);
    if (privacy && aspectHidden(privacy, 'records', isOwner)) {
      return NextResponse.json({ exercises: [], unit: 'lb', isOwner: false, hidden: true }, { headers: NO_STORE });
    }

    const ref = new URL(request.url).searchParams.get('exercise');
    if (ref !== null && !REF.test(ref)) return NextResponse.json({ error: 'Exercise not found' }, { status: 404, headers: NO_STORE });

    // PR 6: the logged sets AND the tested maxes — one fold, one best per exercise.
    const read = await readBestsSources(admin, profileId, { visitor: !isOwner, ...(ref ? { ref } : {}) });
    if (!read.ok) return NextResponse.json({ error: 'Could not load exercises' }, { status: 500, headers: NO_STORE });
    const unit = workoutUnit(read.workouts.flatMap(s => s.exercises));

    const sessionsHidden = privacy ? aspectHidden(privacy, 'workouts', isOwner) : false;
    if (ref === null) {
      const exercises = summarizeExercises(read.sessions);
      // With the sessions private, when and how often an exercise was trained is private too: the bests alone.
      return NextResponse.json({ exercises: sessionsHidden ? exercises.map(e => ({ ...e, lastAt: null, sessions: null })) : exercises, sessionsHidden, unit, isOwner }, { headers: NO_STORE });
    }

    const timeline = exerciseTimeline(read.sessions, ref);
    if (timeline.length === 0) return NextResponse.json({ error: 'Exercise not found' }, { status: 404, headers: NO_STORE });
    const bests = foldBests(read.sessions.map(sessionBests)).get(ref)!;
    return NextResponse.json(
      { exercise: { ref, ...describeExercise(ref, bests.name), bests }, timeline: sessionsHidden ? [] : timeline, sessionsHidden, unit, isOwner },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[training/bests] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

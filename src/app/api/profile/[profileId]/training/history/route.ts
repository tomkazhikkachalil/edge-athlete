import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { countActivities, decodeCursor, listActivitySessions, readWeeklyTotals, resolveActivityAccess } from '@/lib/activities/read-server';
import { aspectHidden } from '@/lib/training-privacy';
import { fetchTrainingPrivacy } from '@/lib/training-privacy-server';
import { parseHistoryKind } from '@/lib/training/history';
import { listTrainingHistory } from '@/lib/training/history-server';
import { listWorkoutSessions } from '@/lib/workouts/read-server';

/**
 * GET /api/profile/[profileId]/training/history — Training's History view
 * (Training redesign PR 4, Nov 11 2026): every completed workout and every
 * activity of the profile in ONE list, newest first.
 *
 *   ?kind=all|workouts|activities   which sessions (anything else = all)
 *   ?cursor=<opaque>                the next page (20 a page, keyset over both tables)
 *   → { items: [{ kind: 'workout', session } | { kind: 'activity', activity }], next, isOwner }
 *     The first page of ?kind=activities also carries the activities' last
 *     twelve weeks (`totals`) and their `count`.
 *
 *   ?sessions=1 answers Training's week maths instead of a page: the last 52
 *   weeks as { workouts: TrainingSession[], activities: ActivitySession[] } —
 *   it replaces "the last 50 workouts" the Overview used to count from.
 *
 * The gate is the activity readers' ONE gate (resolveActivityAccess: blocks,
 * a departed athlete, supervision, guardians as the owner), then the Training
 * privacy `workouts` aspect — `hidden: true` and nothing else, the workouts
 * route's own answer. A non-owner never receives a workout the owner hid or
 * has not decided, nor an "Only me" activity (history-server.ts).
 * Viewer-dependent: `private, no-store`.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const access = await resolveActivityAccess(admin, user?.id ?? null, profileId);
    if (!access.ok) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });

    const url = new URL(request.url);
    const isOwner = access.audience === 'owner';
    const wantsSessions = url.searchParams.get('sessions') === '1';
    if (!isOwner && aspectHidden(await fetchTrainingPrivacy(admin, profileId), 'workouts', isOwner)) {
      return NextResponse.json(wantsSessions ? { workouts: [], activities: [], hidden: true } : { items: [], next: null, isOwner: false, hidden: true }, { headers: NO_STORE });
    }

    if (wantsSessions) {
      const [workouts, activities] = await Promise.all([listWorkoutSessions(admin, profileId, isOwner), listActivitySessions(admin, profileId, access.audience)]);
      if (!workouts.ok || !activities.ok) return NextResponse.json({ error: 'Could not load training' }, { status: 500, headers: NO_STORE });
      return NextResponse.json({ workouts: workouts.sessions, activities: activities.sessions }, { headers: NO_STORE });
    }

    const kind = parseHistoryKind(url.searchParams.get('kind'));
    const rawCursor = url.searchParams.get('cursor');
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400, headers: NO_STORE });

    const firstActivitiesPage = kind === 'activities' && !cursor;
    const today = new Date().toISOString().slice(0, 10);
    const [list, totals, count] = await Promise.all([
      listTrainingHistory(admin, profileId, access.audience, kind, cursor),
      firstActivitiesPage ? readWeeklyTotals(admin, profileId, access.audience, today) : Promise.resolve(null),
      firstActivitiesPage ? countActivities(admin, profileId, access.audience) : Promise.resolve(null),
    ]);
    if (!list.ok) return NextResponse.json({ error: 'Could not load training history' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ items: list.items, next: list.next, isOwner, ...(firstActivitiesPage ? { totals: totals ?? [], count: count ?? 0 } : {}) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[training/history] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { isOrgKind } from '@/lib/orgs/org-ref';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { parseVideoBody, placeOf } from '@/lib/videos/rules';
import {
  activityAccess,
  anonymousProfileCanView,
  contestListAccess,
  createVideo,
  listVideos,
  orgVideoAccess,
  placeRight,
  profileManages,
  projectVideo,
  roundAccess,
  VIEW_COLUMNS,
  workoutAccess,
  type VideoFilter,
} from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = (what = 'Not found') => NextResponse.json({ error: what }, { status: 404, headers: PRIVATE });

/**
 * GET ?profileId= | ?side=&orgId= | ?sportEventId= | ?contestId= |
 * ?groupPostId= | ?activityId= | ?workoutSessionId= — the videos of ONE
 * context (Videos program, 296; the three places of 297), newest first,
 * anonymous allowed where the context is: a public profile, a public org, a
 * public event, contest or round. Hidden rows ride only for whoever manages
 * the context. `can_add` says whether THIS viewer may link a video here.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const url = new URL(request.url);
    const profileId = url.searchParams.get('profileId');
    const side = url.searchParams.get('side');
    const orgId = url.searchParams.get('orgId');
    const sportEventId = url.searchParams.get('sportEventId');
    const contestId = url.searchParams.get('contestId');
    const groupPostId = url.searchParams.get('groupPostId');
    const activityId = url.searchParams.get('activityId');
    const workoutSessionId = url.searchParams.get('workoutSessionId');
    const admin = getSupabaseAdmin();
    let filter: VideoFilter;

    if (profileId) {
      if (!UUID_RE.test(profileId)) return NOT_FOUND('Profile not found');
      const canManage = viewerId ? await profileManages(viewerId, profileId) : false;
      const canView = canManage || (viewerId ? (await canViewProfile(profileId, viewerId)).canView : await anonymousProfileCanView(admin, profileId));
      if (!canView) return NOT_FOUND('Profile not found');
      filter = { kind: 'profile', profileId, includeHidden: canManage, canManage };
    } else if (orgId || side) {
      if (!isOrgKind(side) || !orgId || !UUID_RE.test(orgId)) return NextResponse.json({ error: 'side and orgId are required' }, { status: 400, headers: PRIVATE });
      const access = await orgVideoAccess(admin, side, orgId, viewerId);
      if (!access.known) return NOT_FOUND(side === 'league' ? 'League not found' : 'Club not found');
      if (access.access === null) return NextResponse.json({ error: 'Members only' }, { status: 403, headers: PRIVATE });
      filter = { kind: 'org', orgId, includeHidden: access.canManage, canManage: access.canManage };
    } else if (sportEventId) {
      if (!UUID_RE.test(sportEventId)) return NOT_FOUND('Event not found');
      const read = await readSportEventAccess(admin, sportEventId, viewerId, url.searchParams.get('token'));
      if (!read) return NOT_FOUND('Event not found');
      filter = { kind: 'sport_event', sportEventId, includeHidden: read.access.canManage, canManage: read.access.canManage };
    } else if (contestId) {
      if (!UUID_RE.test(contestId)) return NOT_FOUND('Game not found');
      const access = await contestListAccess(admin, contestId, user ?? null);
      if (!access.canView) return NOT_FOUND('Game not found');
      filter = { kind: 'contest', contestId, includeHidden: access.canManage, canManage: access.canManage };
    } else if (groupPostId) {
      if (!UUID_RE.test(groupPostId)) return NOT_FOUND('Round not found');
      const a = await roundAccess(admin, groupPostId, viewerId);
      if (!a.canView) return NOT_FOUND('Round not found');
      filter = { kind: 'round', groupPostId, includeHidden: a.canManage, canManage: a.canManage };
    } else if (activityId) {
      if (!UUID_RE.test(activityId)) return NOT_FOUND('Activity not found');
      const a = await activityAccess(admin, activityId, viewerId);
      if (!a.canView) return NOT_FOUND('Activity not found');
      filter = { kind: 'activity', activityId, includeHidden: a.canManage, canManage: a.canManage };
    } else if (workoutSessionId) {
      if (!UUID_RE.test(workoutSessionId)) return NOT_FOUND('Workout not found');
      const a = await workoutAccess(admin, workoutSessionId, viewerId);
      if (!a.canView) return NOT_FOUND('Workout not found');
      filter = { kind: 'workout', workoutSessionId, includeHidden: a.canManage, canManage: a.canManage };
    } else {
      return NextResponse.json({ error: 'A context is required: profileId, side + orgId, sportEventId, contestId, groupPostId, activityId or workoutSessionId' }, { status: 400, headers: PRIVATE });
    }

    const videos = await listVideos(admin, filter);
    return NextResponse.json({ videos, can_add: filter.canManage }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST {url, title?, description?, sport_key?, status?, profile_id? |
 * side + org_id, and at most ONE place: sport_event_id | contest_id |
 * group_post_id | activity_id | workout_session_id} — link a YouTube video
 * to a profile (your own, or an athlete you guard) or to an org you manage
 * video for; a place needs the place's manager. 201 {video}; 409
 * {error, existing_id} when the same video is already on that owner.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseVideoBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;
    const admin = getSupabaseAdmin();

    let owner: { profileId: string } | { orgId: string };
    let actorProfileId = user.id;
    if (input.owner.kind === 'org') {
      const gate = await requireOrgManager(admin, user, input.owner.side, input.owner.orgId, { intent: 'manage_video' });
      if (!gate.ok) return gate.response;
      owner = { orgId: input.owner.orgId };
    } else {
      const acting = await resolveActingProfile(user.id, input.owner.profileId, 'Not authorized to add videos for this profile');
      if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status });
      actorProfileId = acting.actorId;
      owner = { profileId: acting.actorId };
    }

    const place = placeOf(input);
    if (place) {
      const right = await placeRight(admin, place, actorProfileId, user);
      if (!right.ok) return NextResponse.json({ error: right.error }, { status: right.status });
    }

    const created = await createVideo(admin, { input, owner, userId: user.id });
    if (!created.ok) return NextResponse.json({ error: created.error, ...(created.existing_id ? { existing_id: created.existing_id } : {}) }, { status: created.status });
    const { data } = await admin.from('videos').select(VIEW_COLUMNS).eq('id', created.value.id).single();
    const video = data ? projectVideo(data as never, true) : projectVideo(created.value as never, true);
    return NextResponse.json({ video }, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

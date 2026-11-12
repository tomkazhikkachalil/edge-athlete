/**
 * Videos (296) — the ONE writer and the readers. Posture A tables: the app
 * gate IS the authorization. Every read gathers the facts the pure rule
 * needs (rules.ts) and answers through it; every write goes through here.
 *
 * Owner facts: a profile's video → the profile's privacy (`canViewProfile`
 * for a viewer, `visibility = 'public'` for a stranger) and the owner /
 * guardian for management (resolveActingProfile — the one acting-as gate);
 * an org's video → the org's visibility + membership for a view (the org
 * gallery's rule) and the `manage_video` capability for management.
 * A place (a sport event or a contest) is attached only by someone who
 * manages THAT place — `readSportEventAccess(...).canManage`, or the
 * competition's manager.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { readOrgAccess } from '@/lib/orgs/access';
import { capabilityAllows, getOrgAndRole, getOrgCapabilities } from '@/lib/orgs/authz';
import { isOrgKind, type OrgKind } from '@/lib/orgs/org-ref';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { fetchContestView } from '@/lib/competitions/contest-view';
import { canViewSharedRound } from '@/lib/golf/round-access';
import { readActivityForViewer } from '@/lib/activities/read-server';
import { aspectHidden } from '@/lib/training-privacy';
import { fetchTrainingPrivacy } from '@/lib/training-privacy-server';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { sortLiveFirst } from './live-rules';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { embedSrcAt, parseYouTubeLink, thumbUrl, watchUrl } from './youtube';
import {
  defaultVideoTitle,
  highlightRangeOk,
  manageRight,
  PLACE_KEYS,
  viewRight,
  type HighlightInput,
  type VideoCreateInput,
  type VideoPatch,
  type VideoRightFacts,
} from './rules';
import type { HighlightPerson, HighlightRow, VideoOwnerView, VideoPlaceView, VideoRow, VideoView } from './types';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { checkTag, tagPersonKey, type TagInput, type TagPersonInput } from './tag-rules';
import { gameSheetFor } from './game-sheets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the house Admin alias (schema-agnostic helper)
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[videos]';

export const VIDEO_COLUMNS =
  'id, provider, provider_video_id, profile_id, org_id, sport_event_id, contest_id, group_post_id, activity_id, workout_session_id, created_by_user_id, title, description, sport_key, duration_ms, status, live_status, scheduled_start_at, live_started_at, live_ended_at, live_checked_at, created_at, updated_at';
/** The read shape: the row, the marker count, the owner and the place by name. Two FKs reach profiles, so the owner embed names its constraint. */
export const VIEW_COLUMNS = `${VIDEO_COLUMNS}, highlights:video_highlights(count), profile:profiles!videos_profile_id_fkey(id, full_name, display_name, handle, avatar_url), org:organizations(id, name, kind), sport_event:sport_events(id, name), contest:contests(id, round, competition:competitions(id, name)), group_post:group_posts(id, title, date, golf_data:golf_scorecard_data(course_name)), activity:activities(id, name), workout_session:workout_sessions(id, title)`;
export const HIGHLIGHT_COLUMNS = 'id, video_id, start_ms, end_ms, label, meta, created_by_user_id, created_at, updated_at, event_key, period, side, value';

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 500; error: string; existing_id?: string };

interface ReadRow extends VideoRow {
  highlights?: { count: number }[] | null;
  profile?: { id: string; full_name: string | null; display_name: string | null; handle: string | null; avatar_url: string | null } | null;
  org?: { id: string; name: string; kind: string } | null;
  sport_event?: { id: string; name: string } | null;
  contest?: { id: string; round: string | null; competition: { id: string; name: string } | null } | null;
  group_post?: { id: string; title: string; date: string | null; golf_data: { course_name: string } | { course_name: string }[] | null } | null;
  activity?: { id: string; name: string } | null;
  workout_session?: { id: string; title: string | null } | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function projectVideo(raw: ReadRow, canManage: boolean): VideoView {
  const profile = one(raw.profile);
  const org = one(raw.org);
  const event = one(raw.sport_event);
  const contest = one(raw.contest);
  const owner: VideoOwnerView = org && raw.org_id
    ? { kind: 'org', id: org.id, side: isOrgKind(org.kind) ? org.kind : 'club', name: org.name }
    : { kind: 'profile', id: raw.profile_id ?? '', name: profile?.display_name || profile?.full_name || 'Athlete', handle: profile?.handle ?? null, avatar_url: profile?.avatar_url ?? null };
  const round = one(raw.group_post);
  const activity = one(raw.activity);
  const workout = one(raw.workout_session);
  let place: VideoPlaceView = null;
  if (raw.sport_event_id && event) place = { kind: 'sport_event', id: event.id, name: event.name };
  else if (raw.contest_id && contest) {
    const comp = one(contest.competition);
    place = { kind: 'contest', id: contest.id, name: comp ? (contest.round ? `${comp.name} · ${contest.round}` : comp.name) : 'Game' };
  } else if (raw.group_post_id && round) {
    const course = one(round.golf_data)?.course_name;
    place = { kind: 'round', id: round.id, name: `${course || round.title || 'Round'}${round.date ? ` · ${round.date}` : ''}` };
  } else if (raw.activity_id && activity) place = { kind: 'activity', id: activity.id, name: activity.name || 'Activity' };
  else if (raw.workout_session_id && workout) place = { kind: 'workout', id: workout.id, name: workout.title || 'Workout' };
  const counts = one(raw.highlights);
  return {
    id: raw.id,
    provider: raw.provider,
    provider_video_id: raw.provider_video_id,
    watch_url: watchUrl(raw.provider_video_id),
    embed_src: embedSrcAt(raw.provider_video_id, null),
    thumb_url: thumbUrl(raw.provider_video_id),
    title: raw.title,
    description: raw.description,
    sport_key: raw.sport_key,
    duration_ms: raw.duration_ms,
    status: raw.status,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    live_status: raw.live_status ?? 'none',
    scheduled_start_at: raw.scheduled_start_at ?? null,
    live_started_at: raw.live_started_at ?? null,
    live_ended_at: raw.live_ended_at ?? null,
    owner,
    place,
    highlight_count: counts?.count ?? 0,
    can_manage: canManage,
  };
}

// ── The owner facts ─────────────────────────────────────────────────────────

/** A stranger sees a public, present profile's published videos. */
export async function anonymousProfileCanView(admin: Admin, profileId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('visibility, departed_at').eq('id', profileId).maybeSingle();
  return !!data && !data.departed_at && data.visibility === 'public';
}

/** The owner, or an approved guardian acting for them (the one acting-as gate). */
export async function profileManages(userId: string, profileId: string): Promise<boolean> {
  if (userId === profileId) return true;
  const gate = await resolveActingProfile(userId, profileId, 'Not authorized');
  return gate.ok;
}

export interface OrgVideoAccess {
  known: boolean;
  access: 'public' | 'member' | null;
  canManage: boolean;
}

/** The org gallery's rule + the manage_video capability. */
export async function orgVideoAccess(admin: Admin, side: OrgKind, orgId: string, userId: string | null): Promise<OrgVideoAccess> {
  const access = await readOrgAccess(admin, side, orgId);
  if (!access.known) return { known: false, access: null, canManage: false };
  let isMember = false;
  let canManage = false;
  if (userId) {
    const [loaded, caps] = await Promise.all([getOrgAndRole(admin, side, orgId, userId), getOrgCapabilities(admin, side, orgId, userId)]);
    if (loaded.status !== 'found') return { known: false, access: null, canManage: false };
    isMember = !!loaded.role || loaded.org.owner_profile_id === userId;
    canManage = capabilityAllows(caps, 'manage_video');
  }
  const reach: 'public' | 'member' | null = access.visibility === 'private' ? (isMember ? 'member' : null) : 'public';
  return { known: true, access: canManage && reach === null ? 'member' : reach, canManage };
}

async function factsFor(admin: Admin, row: VideoRow, user: User | null): Promise<VideoRightFacts> {
  const viewerId = user?.id ?? null;
  if (row.org_id) {
    const { data: org } = await admin.from('organizations').select('kind').eq('id', row.org_id).maybeSingle();
    const side: OrgKind = isOrgKind(org?.kind) ? org.kind : 'club';
    const a = await orgVideoAccess(admin, side, row.org_id, viewerId);
    return { viewerId, status: row.status, owner: 'org', orgAccess: a.known ? a.access : null, orgCanManage: a.canManage };
  }
  const profileId = row.profile_id ?? '';
  const isOwner = !!viewerId && viewerId === profileId;
  const isGuardian = !isOwner && !!viewerId ? (await resolveActingProfile(viewerId, profileId, 'Not authorized')).ok : false;
  const profileCanView = viewerId ? (await canViewProfile(profileId, viewerId)).canView : await anonymousProfileCanView(admin, profileId);
  return { viewerId, status: row.status, owner: 'profile', isOwner, isGuardian, profileCanView };
}

// ── The readers ─────────────────────────────────────────────────────────────

export type VideoFilter =
  | { kind: 'profile'; profileId: string; includeHidden: boolean; canManage: boolean }
  | { kind: 'org'; orgId: string; includeHidden: boolean; canManage: boolean }
  // A place's list applies the OWNER's rule row by row — the viewer rides along for it.
  | { kind: 'sport_event'; sportEventId: string; includeHidden: boolean; canManage: boolean; viewerId: string | null }
  | { kind: 'contest'; contestId: string; includeHidden: boolean; canManage: boolean; viewerId: string | null }
  // Phase 1b (297): a golf round, an activity, a workout session.
  | { kind: 'round'; groupPostId: string; includeHidden: boolean; canManage: boolean; viewerId: string | null }
  | { kind: 'activity'; activityId: string; includeHidden: boolean; canManage: boolean; viewerId: string | null }
  | { kind: 'workout'; workoutSessionId: string; includeHidden: boolean; canManage: boolean; viewerId: string | null };

/** The list for one context, newest first. Hidden rows ride only for a manager. */
export async function listVideos(admin: Admin, filter: VideoFilter): Promise<VideoView[]> {
  let q = admin.from('videos').select(VIEW_COLUMNS).order('created_at', { ascending: false }).limit(200);
  if (filter.kind === 'profile') q = q.eq('profile_id', filter.profileId);
  else if (filter.kind === 'org') q = q.eq('org_id', filter.orgId);
  else if (filter.kind === 'sport_event') q = q.eq('sport_event_id', filter.sportEventId);
  else if (filter.kind === 'contest') q = q.eq('contest_id', filter.contestId);
  else if (filter.kind === 'round') q = q.eq('group_post_id', filter.groupPostId);
  else if (filter.kind === 'activity') q = q.eq('activity_id', filter.activityId);
  else q = q.eq('workout_session_id', filter.workoutSessionId);
  if (!filter.includeHidden) q = q.eq('status', 'published');
  const { data, error } = await q;
  if (error) {
    console.error(`${TAG} list failed:`, error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as ReadRow[];
  // A place's list may hold videos owned by profiles the viewer cannot see
  // (a private profile's video on a public event): the owner's rule still
  // applies row by row, never the place's alone.
  if (filter.kind !== 'profile' && filter.kind !== 'org') {
    const out: VideoView[] = [];
    for (const row of rows) {
      if (filter.canManage) {
        out.push(projectVideo(row, true));
        continue;
      }
      if (row.status !== 'published') continue;
      if (row.profile_id && row.profile_id !== filter.viewerId) {
        // The owner's own rule: the profile's privacy for a viewer (a follow counts), public for a stranger.
        const visible = filter.viewerId ? (await canViewProfile(row.profile_id, filter.viewerId)).canView : await anonymousProfileCanView(admin, row.profile_id);
        if (!visible) continue;
      }
      out.push(projectVideo(row, false));
    }
    return sortLiveFirst(out);
  }
  // Phase 4a: a broadcast that is live (or about to be) sits first on every list.
  return sortLiveFirst(rows.map(r => projectVideo(r, filter.canManage)));
}

/** Phase 4a, PR B: the broadcasts streaming now that THIS viewer may see — the owner's own rule row by row; newest start first; at most ten. */
export async function listLiveVideos(admin: Admin, viewerId: string | null): Promise<VideoView[]> {
  const { data, error } = await admin
    .from('videos')
    .select(VIEW_COLUMNS)
    .eq('live_status', 'live')
    .eq('status', 'published')
    .order('live_started_at', { ascending: false, nullsFirst: false })
    .limit(40);
  if (error) {
    console.error(`${TAG} live list failed:`, error.message);
    return [];
  }
  const out: VideoView[] = [];
  const orgReach = new Map<string, boolean>();
  for (const row of (data ?? []) as unknown as ReadRow[]) {
    if (out.length >= 10) break;
    if (row.org_id) {
      let reach = orgReach.get(row.org_id);
      if (reach === undefined) {
        const org = one(row.org);
        const a = await orgVideoAccess(admin, isOrgKind(org?.kind) ? org!.kind : 'club', row.org_id, viewerId);
        reach = a.known && a.access !== null;
        orgReach.set(row.org_id, reach);
      }
      if (!reach) continue;
      out.push(projectVideo(row, false));
      continue;
    }
    if (!row.profile_id) continue;
    const visible = row.profile_id === viewerId
      ? true
      : viewerId ? (await canViewProfile(row.profile_id, viewerId)).canView : await anonymousProfileCanView(admin, row.profile_id);
    if (!visible) continue;
    out.push(projectVideo(row, false));
  }
  return out;
}

export interface VideoRead {
  row: VideoRow;
  view: VideoView;
  highlights: HighlightRow[];
  canManage: boolean;
}

/** One video for THIS viewer, or null (the same 404 as not-found). */
export async function readVideoForViewer(admin: Admin, id: string, user: User | null): Promise<VideoRead | null> {
  const { data, error } = await admin.from('videos').select(VIEW_COLUMNS).eq('id', id).maybeSingle();
  if (error) {
    console.error(`${TAG} read failed:`, error.message);
    return null;
  }
  if (!data) return null;
  const raw = data as unknown as ReadRow;
  const facts = await factsFor(admin, raw, user);
  const view = viewRight(facts);
  if (!view.allowed) return null;
  const canManage = manageRight(facts).allowed;
  const highlights = await listHighlights(admin, id, { id: user?.id ?? null, canManage });
  return { row: raw, view: projectVideo(raw, canManage), highlights, canManage };
}

/** Who reads the tags: a manager sees every name; anyone else sees a linked athlete's name only where they may see that profile. */
export interface TagViewer { id: string | null; canManage: boolean }

/**
 * The video's highlights in time order, each with the people in it (active
 * tags only). A linked athlete the viewer may NOT see is still counted — as
 * "Player", with no link — so a game's numbers are the same for everyone
 * and a private profile is never named to a stranger.
 */
export async function listHighlights(admin: Admin, videoId: string, viewer: TagViewer = { id: null, canManage: false }): Promise<HighlightRow[]> {
  const { data, error } = await admin
    .from('video_highlights')
    .select(HIGHLIGHT_COLUMNS)
    .eq('video_id', videoId)
    .order('start_ms', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(HIGHLIGHT_READ_MAX);
  if (error) {
    console.error(`${TAG} highlights read failed:`, error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as Array<Omit<HighlightRow, 'people'>>;
  const people = await readTagPeople(admin, videoId, viewer);
  return rows.map(r => ({ ...r, people: people.get(r.id) ?? [] }));
}

/** A fully tagged game has a tag per scoring play — far more than a list of highlights (Sprint 3). */
export const HIGHLIGHT_READ_MAX = 2000;
export const MASKED_PERSON_NAME = 'Player';

interface PersonRow {
  id: string;
  highlight_id: string;
  profile_id: string | null;
  name: string | null;
  role: string;
  side: 1 | 2 | null;
  profile: { id: string; full_name: string | null; display_name: string | null; handle: string | null; avatar_url: string | null; visibility: string | null; departed_at: string | null } | null;
}

async function readTagPeople(admin: Admin, videoId: string, viewer: TagViewer): Promise<Map<string, HighlightPerson[]>> {
  const out = new Map<string, HighlightPerson[]>();
  const { data, error } = await admin
    .from('video_highlight_people')
    .select('id, highlight_id, profile_id, name, role, side, profile:profiles!video_highlight_people_profile_id_fkey(id, full_name, display_name, handle, avatar_url, visibility, departed_at)')
    .eq('video_id', videoId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(HIGHLIGHT_READ_MAX * 4);
  if (error) {
    // 307 not here yet = nobody is tagged; anything else is said in the log and the highlights still read.
    if (error.code !== '42P01' && error.code !== 'PGRST205') console.error(`${TAG} tag people read failed:`, error.message);
    return out;
  }
  const rows = (data ?? []) as unknown as PersonRow[];
  // Whose names may THIS viewer read? A manager: all. Otherwise each distinct profile once.
  const visible = new Map<string, boolean>();
  if (!viewer.canManage) {
    const ids = [...new Set(rows.map(r => r.profile_id).filter((v): v is string => !!v))];
    await Promise.all(ids.map(async id => {
      const p = rows.find(r => r.profile_id === id)?.profile;
      if (!p) { visible.set(id, false); return; }
      if (viewer.id === id || p.visibility === 'public') { visible.set(id, true); return; }
      visible.set(id, viewer.id ? (await canViewProfile(id, viewer.id)).canView : false);
    }));
  }
  for (const r of rows) {
    // A typed name is always shown; a linked athlete only while their profile stands AND this viewer may see it.
    const shown = !r.profile_id || (!!r.profile && !r.profile.departed_at && (viewer.canManage || visible.get(r.profile_id) === true));
    const person: HighlightPerson = r.profile_id && r.profile && shown
      ? { id: r.id, profile_id: r.profile_id, name: r.profile.display_name || r.profile.full_name || MASKED_PERSON_NAME, handle: r.profile.handle, avatar_url: r.profile.avatar_url, role: r.role, side: r.side }
      : { id: r.id, profile_id: null, name: r.profile_id ? MASKED_PERSON_NAME : (r.name ?? MASKED_PERSON_NAME), handle: null, avatar_url: null, role: r.role, side: r.side };
    const list = out.get(r.highlight_id);
    if (list) list.push(person);
    else out.set(r.highlight_id, [person]);
  }
  return out;
}

/**
 * Who a tagger may name (the photo-tag rule): only profiles the tagger can
 * SEE; anyone with a block in either direction is silently left out (never
 * reveal who blocked whom); a typed name is always allowed.
 */
export async function taggablePeople(admin: Admin, people: readonly TagPersonInput[], taggerId: string): Promise<Outcome<TagPersonInput[]>> {
  const ids = [...new Set(people.map(p => p.profile_id).filter((v): v is string => !!v && v !== taggerId))];
  if (ids.length === 0) return { ok: true, value: [...people] };
  const checks = await Promise.all(ids.map(id => canViewProfile(id, taggerId)));
  if (checks.some(c => !c.canView)) return { ok: false, status: 403, error: 'You can only tag people whose profile you can view' };
  const { allowed } = await filterBlockedBidirectional(admin, taggerId, ids);
  const ok = new Set(allowed);
  return { ok: true, value: people.filter(p => !p.profile_id || p.profile_id === taggerId || ok.has(p.profile_id)) };
}

/**
 * The people on one tag become exactly `people`: rows no longer wanted go,
 * new ones are added. A row someone REMOVED of themselves stays removed —
 * a manager's save never tags them back in.
 */
async function writeTagPeople(admin: Admin, videoId: string, highlightId: string, people: readonly TagPersonInput[], userId: string): Promise<boolean> {
  const { data: existing, error: readError } = await admin.from('video_highlight_people').select('id, profile_id, name, role, status').eq('highlight_id', highlightId);
  if (readError) {
    console.error(`${TAG} tag people read failed:`, readError.message);
    return false;
  }
  const keyOf = (p: { profile_id: string | null; name: string | null; role: string }) => `${tagPersonKey(p)}|${p.role}`;
  const have = new Map((existing ?? []).map(r => [keyOf(r as { profile_id: string | null; name: string | null; role: string }), r as { id: string; status: string }]));
  const want = new Map(people.map(p => [keyOf(p), p]));
  const gone = [...have.entries()].filter(([k, r]) => r.status === 'active' && !want.has(k)).map(([, r]) => r.id);
  if (gone.length > 0) {
    const { error } = await admin.from('video_highlight_people').delete().in('id', gone);
    if (error) { console.error(`${TAG} tag people delete failed:`, error.message); return false; }
  }
  const fresh = [...want.entries()].filter(([k]) => !have.has(k)).map(([, p]) => ({ highlight_id: highlightId, video_id: videoId, profile_id: p.profile_id, name: p.name, role: p.role, side: p.side, created_by_user_id: userId }));
  if (fresh.length > 0) {
    const { error } = await admin.from('video_highlight_people').insert(fresh);
    if (error) { console.error(`${TAG} tag people insert failed:`, error.message); return false; }
  }
  // A person kept on the tag may have changed side.
  for (const [k, p] of want) {
    const row = have.get(k);
    if (row && row.status === 'active') await admin.from('video_highlight_people').update({ side: p.side }).eq('id', row.id);
  }
  return true;
}

/**
 * A tag is ready to save: its event and roles are the game's sheet's (no game
 * = no events), and its people are ones this tagger may name.
 */
export async function prepareTag(admin: Admin, videoId: string, tag: TagInput, taggerId: string): Promise<Outcome<TagInput>> {
  const { data } = await admin.from('video_games').select('sport_key').eq('video_id', videoId).maybeSingle();
  const checked = checkTag(gameSheetFor((data as { sport_key?: string } | null)?.sport_key ?? null), tag);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const people = await taggablePeople(admin, tag.people, taggerId);
  if (!people.ok) return people;
  return { ok: true, value: { ...tag, people: people.value } };
}

const tagColumns = (tag: TagInput) => ({ event_key: tag.event_key, period: tag.period, side: tag.side, value: tag.value });

// ── The places ──────────────────────────────────────────────────────────────

/** Attaching to a sport event: the actor must manage it. */
export async function sportEventPlaceRight(admin: Admin, eventId: string, actorProfileId: string): Promise<Outcome<{ id: string }>> {
  const read = await readSportEventAccess(admin, eventId, actorProfileId, null);
  if (!read) return { ok: false, status: 404, error: 'Event not found' };
  if (!read.access.canManage) return { ok: false, status: 403, error: 'Only an organizer can add a video to this event.' };
  return { ok: true, value: { id: eventId } };
}

/** Attaching to a contest: the user must manage its competition. */
export async function contestPlaceRight(admin: Admin, contestId: string, user: User): Promise<Outcome<{ id: string }>> {
  const result = await fetchContestView(admin, contestId, { viewerId: user.id });
  if (!result) return { ok: false, status: 404, error: 'Game not found' };
  const gate = await requireCompetitionManager(admin, user, result.view.org.side, result.view.org.id, { competitionId: result.view.competition.id });
  if (!gate.ok) return { ok: false, status: 403, error: 'Only the competition\'s managers can add a video to this game.' };
  return { ok: true, value: { id: contestId } };
}

/** The viewer's reach on a contest for the list: public / member / none, and whether they manage it. */
export async function contestListAccess(admin: Admin, contestId: string, user: User | null): Promise<{ canView: boolean; canManage: boolean }> {
  const result = await fetchContestView(admin, contestId, { viewerId: user?.id ?? null });
  if (!result) return { canView: false, canManage: false };
  if (!user) return { canView: true, canManage: false };
  const gate = await requireCompetitionManager(admin, user, result.view.org.side, result.view.org.id, { competitionId: result.view.competition.id });
  return { canView: true, canManage: gate.ok };
}

/** A golf round (group_posts): the viewer's reach (canViewSharedRound over EVERY participant row) and whether they manage its media (the Media tab's rule: the creator or a CONFIRMED participant). */
export async function roundAccess(admin: Admin, groupPostId: string, viewerId: string | null): Promise<{ canView: boolean; canManage: boolean }> {
  const { data, error } = await admin
    .from('group_posts')
    .select('id, creator_id, visibility, participants:group_post_participants(profile_id, status)')
    .eq('id', groupPostId)
    .maybeSingle();
  if (error || !data) return { canView: false, canManage: false };
  const row = data as unknown as { creator_id: string | null; visibility: string | null; participants: { profile_id: string; status: string | null }[] | null };
  const participants = row.participants ?? [];
  const canView = canViewSharedRound({ viewerId, creatorId: row.creator_id, visibility: row.visibility, participantProfileIds: participants.map(p => p.profile_id) });
  const canManage = !!viewerId && (viewerId === row.creator_id || participants.some(p => p.profile_id === viewerId && p.status === 'confirmed'));
  return { canView, canManage };
}

/** An activity: its own gate (the owner or an approved guardian manage; a viewer passes the profile's privacy and `only_me`). */
export async function activityAccess(admin: Admin, activityId: string, viewerId: string | null): Promise<{ canView: boolean; canManage: boolean }> {
  const read = await readActivityForViewer(admin, viewerId, activityId);
  if (!read.ok) return { canView: false, canManage: false };
  return { canView: true, canManage: read.audience === 'owner' };
}

/** A workout session: the owner manages; a viewer passes the `/api/workouts/[id]` rule — completed, decided, not hidden, the training privacy aspect, the profile public or an accepted follow. A refusal is a 404 here (the videos convention). */
export async function workoutAccess(admin: Admin, sessionId: string, viewerId: string | null): Promise<{ canView: boolean; canManage: boolean }> {
  const { data, error } = await admin
    .from('workout_sessions')
    .select('id, profile_id, status, share_decided_at, profile_hidden_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return { canView: false, canManage: false };
  const session = data as { profile_id: string; status: string; share_decided_at: string | null; profile_hidden_at: string | null };
  if (viewerId && viewerId === session.profile_id) return { canView: true, canManage: true };
  if (session.status !== 'completed' || session.profile_hidden_at || !session.share_decided_at) return { canView: false, canManage: false };
  if (aspectHidden(await fetchTrainingPrivacy(admin, session.profile_id), 'workouts', false)) return { canView: false, canManage: false };
  const { data: profile } = await admin.from('profiles').select('visibility, departed_at').eq('id', session.profile_id).maybeSingle();
  if (!profile || profile.departed_at) return { canView: false, canManage: false };
  if (profile.visibility === 'public') return { canView: true, canManage: false };
  if (!viewerId) return { canView: false, canManage: false };
  const { data: follow } = await admin.from('follows').select('id').eq('follower_id', viewerId).eq('following_id', session.profile_id).eq('status', 'accepted').maybeSingle();
  return { canView: !!follow, canManage: false };
}

/** Attaching to a place (Phase 1b): the place's own manager — never the video's owner alone. */
export async function placeRight(admin: Admin, place: { key: string; id: string }, actorProfileId: string, user: User): Promise<Outcome<null>> {
  if (place.key === 'sport_event_id') {
    const r = await sportEventPlaceRight(admin, place.id, actorProfileId);
    return r.ok ? { ok: true, value: null } : r;
  }
  if (place.key === 'contest_id') {
    const r = await contestPlaceRight(admin, place.id, user);
    return r.ok ? { ok: true, value: null } : r;
  }
  if (place.key === 'group_post_id') {
    const a = await roundAccess(admin, place.id, actorProfileId);
    if (!a.canView) return { ok: false, status: 404, error: 'Round not found' };
    if (!a.canManage) return { ok: false, status: 403, error: 'Only a player in this round can add a video to it.' };
    return { ok: true, value: null };
  }
  if (place.key === 'activity_id') {
    const a = await activityAccess(admin, place.id, user.id);
    if (!a.canView) return { ok: false, status: 404, error: 'Activity not found' };
    if (!a.canManage) return { ok: false, status: 403, error: 'Only the activity\'s owner can add a video to it.' };
    return { ok: true, value: null };
  }
  if (place.key === 'workout_session_id') {
    const a = await workoutAccess(admin, place.id, user.id);
    if (!a.canView) return { ok: false, status: 404, error: 'Workout not found' };
    if (!a.canManage) return { ok: false, status: 403, error: 'Only the workout\'s owner can add a video to it.' };
    return { ok: true, value: null };
  }
  return { ok: false, status: 400, error: 'Unknown place' };
}

/** An org-owned write changes what the org's public site shows (Phase 1b: the Videos tile) — purge its tag. Best-effort. */
async function purgeOrgSite(admin: Admin, orgId: string | null): Promise<void> {
  if (!orgId) return;
  try {
    const { data } = await admin.from('organizations').select('kind').eq('id', orgId).maybeSingle();
    if (isOrgKind(data?.kind)) await revalidateOrgSiteForOrg(admin, data.kind, orgId);
  } catch (err) {
    console.error(`${TAG} site purge failed:`, err);
  }
}

// ── The writer ──────────────────────────────────────────────────────────────

function sportKeyOk(key: string | null): boolean {
  return key === null || Object.prototype.hasOwnProperty.call(SPORT_REGISTRY, key);
}

export interface CreateVideoArgs {
  input: VideoCreateInput;
  owner: { profileId: string } | { orgId: string };
  /** The session user — `created_by_user_id` when it is not the owner's own profile. */
  userId: string;
}

export async function createVideo(admin: Admin, args: CreateVideoArgs): Promise<Outcome<VideoRow>> {
  const link = parseYouTubeLink(args.input.url);
  if (!link) return { ok: false, status: 400, error: 'That is not a YouTube video link we can play. Paste a youtube.com/watch or youtu.be link.' };
  if (!sportKeyOk(args.input.sport_key)) return { ok: false, status: 400, error: 'Unknown sport' };
  const profileId = 'profileId' in args.owner ? args.owner.profileId : null;
  const orgId = 'orgId' in args.owner ? args.owner.orgId : null;
  const { data: existing } = await admin
    .from('videos')
    .select('id')
    .eq('provider', 'youtube')
    .eq('provider_video_id', link.id)
    .eq(profileId ? 'profile_id' : 'org_id', profileId ?? orgId)
    .maybeSingle();
  if (existing) return { ok: false, status: 409, error: 'This video is already linked here.', existing_id: (existing as { id: string }).id };
  const { data, error } = await admin
    .from('videos')
    .insert({
      provider: 'youtube',
      provider_video_id: link.id,
      profile_id: profileId,
      org_id: orgId,
      sport_event_id: args.input.sport_event_id,
      contest_id: args.input.contest_id,
      group_post_id: args.input.group_post_id,
      activity_id: args.input.activity_id,
      workout_session_id: args.input.workout_session_id,
      created_by_user_id: profileId === args.userId ? null : args.userId,
      title: args.input.title ?? defaultVideoTitle(),
      description: args.input.description,
      sport_key: args.input.sport_key,
      status: args.input.status,
    })
    .select(VIDEO_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, status: 409, error: 'This video is already linked here.' };
    console.error(`${TAG} insert failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the video' };
  }
  await purgeOrgSite(admin, orgId);
  return { ok: true, value: data as unknown as VideoRow };
}

export async function updateVideo(admin: Admin, id: string, patch: VideoPatch): Promise<Outcome<VideoRow>> {
  if (patch.sport_key !== undefined && !sportKeyOk(patch.sport_key)) return { ok: false, status: 400, error: 'Unknown sport' };
  const set: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  // A new place clears every other place (one place, the DB's CHECK).
  const newPlace = PLACE_KEYS.find(k => !!patch[k]);
  if (newPlace) for (const k of PLACE_KEYS) if (k !== newPlace) set[k] = null;
  const { data, error } = await admin.from('videos').update(set).eq('id', id).select(VIDEO_COLUMNS).single();
  if (error || !data) {
    console.error(`${TAG} update failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the video' };
  }
  const row = data as unknown as VideoRow;
  await purgeOrgSite(admin, row.org_id);
  return { ok: true, value: row };
}

/** A link, not a result: the row goes, its markers cascade. */
/** Phase 3: what the Data API read of the video — the duration Phase 1 left null; the title only when ours is still the default. */
export async function recordVideoDetails(admin: Admin, id: string, details: { durationMs: number | null }): Promise<Outcome<VideoRow>> {
  const patch: Record<string, unknown> = {};
  if (typeof details.durationMs === 'number' && details.durationMs >= 0) patch.duration_ms = Math.round(details.durationMs);
  if (Object.keys(patch).length === 0) {
    const { data } = await admin.from('videos').select(VIDEO_COLUMNS).eq('id', id).maybeSingle();
    return data ? { ok: true, value: data as VideoRow } : { ok: false, status: 404, error: 'Not found' };
  }
  const { data, error } = await admin.from('videos').update(patch).eq('id', id).select(VIDEO_COLUMNS).single();
  if (error || !data) return { ok: false, status: 500, error: 'Could not save the details' };
  return { ok: true, value: data as VideoRow };
}

export async function deleteVideo(admin: Admin, id: string, orgId: string | null = null): Promise<Outcome<null>> {
  const { error } = await admin.from('videos').delete().eq('id', id);
  if (error) {
    console.error(`${TAG} delete failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not delete the video' };
  }
  await purgeOrgSite(admin, orgId);
  return { ok: true, value: null };
}

export async function addHighlight(admin: Admin, videoId: string, input: HighlightInput, userId: string): Promise<Outcome<HighlightRow>> {
  const { data, error } = await admin
    .from('video_highlights')
    .insert({ video_id: videoId, start_ms: input.start_ms, end_ms: input.end_ms, label: input.label, meta: input.meta, created_by_user_id: userId, ...(input.tag ? tagColumns(input.tag) : {}) })
    .select(HIGHLIGHT_COLUMNS)
    .single();
  if (error || !data) {
    console.error(`${TAG} highlight insert failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not add the highlight' };
  }
  const row = data as unknown as Omit<HighlightRow, 'people'>;
  if (input.tag && input.tag.people.length > 0 && !(await writeTagPeople(admin, videoId, row.id, input.tag.people, userId))) {
    // A tag without its people would count a stat for nobody: take the highlight back rather than keep half of it.
    await admin.from('video_highlights').delete().eq('id', row.id);
    return { ok: false, status: 500, error: 'Could not add the highlight' };
  }
  return { ok: true, value: { ...row, people: [] } };
}

/** Paste and go (Nov 6): YouTube's chapters as markers — ONE insert, refused when the video already has any marker (never a duplicate pile). */
export async function addHighlights(admin: Admin, videoId: string, inputs: readonly HighlightInput[], userId: string): Promise<Outcome<HighlightRow[]>> {
  if (inputs.length === 0) return { ok: false, status: 400, error: 'Nothing to add' };
  const { count } = await admin.from('video_highlights').select('id', { count: 'exact', head: true }).eq('video_id', videoId);
  if ((count ?? 0) > 0) return { ok: false, status: 409, error: 'This video already has highlights — add chapters only to an empty list.' };
  const { data, error } = await admin
    .from('video_highlights')
    .insert(inputs.map(i => ({ video_id: videoId, start_ms: i.start_ms, end_ms: i.end_ms, label: i.label, meta: i.meta, created_by_user_id: userId })))
    .select(HIGHLIGHT_COLUMNS);
  if (error || !data) {
    console.error(`${TAG} highlights import failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not add the highlights' };
  }
  return { ok: true, value: (data as unknown as Array<Omit<HighlightRow, 'people'>>).map(r => ({ ...r, people: [] })) };
}

export async function updateHighlight(admin: Admin, videoId: string, highlightId: string, patch: Partial<HighlightInput>, userId: string | null = null): Promise<Outcome<HighlightRow>> {
  const { data: stored } = await admin.from('video_highlights').select('id, start_ms, end_ms').eq('id', highlightId).eq('video_id', videoId).maybeSingle();
  if (!stored) return { ok: false, status: 404, error: 'Highlight not found' };
  if (!highlightRangeOk(stored as { start_ms: number; end_ms: number | null }, patch)) return { ok: false, status: 400, error: 'end_ms must be after start_ms' };
  const { data, error } = await admin
    .from('video_highlights')
    .update({ ...(patch.start_ms !== undefined ? { start_ms: patch.start_ms } : {}), ...(patch.end_ms !== undefined ? { end_ms: patch.end_ms } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.meta !== undefined ? { meta: patch.meta } : {}), ...(patch.tag ? tagColumns(patch.tag) : {}), updated_at: new Date().toISOString() })
    .eq('id', highlightId)
    .eq('video_id', videoId)
    .select(HIGHLIGHT_COLUMNS)
    .single();
  if (error || !data) {
    console.error(`${TAG} highlight update failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the highlight' };
  }
  if (patch.tag && userId && !(await writeTagPeople(admin, videoId, highlightId, patch.tag.people, userId))) return { ok: false, status: 500, error: 'Could not save who is in the highlight' };
  return { ok: true, value: { ...(data as unknown as Omit<HighlightRow, 'people'>), people: [] } };
}

export async function deleteHighlight(admin: Admin, videoId: string, highlightId: string): Promise<Outcome<null>> {
  const { data, error } = await admin.from('video_highlights').delete().eq('id', highlightId).eq('video_id', videoId).select('id');
  if (error) {
    console.error(`${TAG} highlight delete failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not remove the highlight' };
  }
  if (!data || data.length === 0) return { ok: false, status: 404, error: 'Highlight not found' };
  return { ok: true, value: null };
}

export { getSupabaseAdmin };

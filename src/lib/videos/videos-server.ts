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
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { embedSrcAt, parseYouTubeLink, thumbUrl, watchUrl } from './youtube';
import {
  defaultVideoTitle,
  highlightRangeOk,
  manageRight,
  viewRight,
  type HighlightInput,
  type VideoCreateInput,
  type VideoPatch,
  type VideoRightFacts,
} from './rules';
import type { HighlightRow, VideoOwnerView, VideoPlaceView, VideoRow, VideoView } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the house Admin alias (schema-agnostic helper)
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[videos]';

export const VIDEO_COLUMNS =
  'id, provider, provider_video_id, profile_id, org_id, sport_event_id, contest_id, created_by_user_id, title, description, sport_key, duration_ms, status, created_at, updated_at';
/** The read shape: the row, the marker count, the owner and the place by name. Two FKs reach profiles, so the owner embed names its constraint. */
const VIEW_COLUMNS = `${VIDEO_COLUMNS}, highlights:video_highlights(count), profile:profiles!videos_profile_id_fkey(id, full_name, display_name, handle, avatar_url), org:organizations(id, name, kind), sport_event:sport_events(id, name), contest:contests(id, round, competition:competitions(id, name))`;
export const HIGHLIGHT_COLUMNS = 'id, video_id, start_ms, end_ms, label, meta, created_by_user_id, created_at, updated_at';

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 500; error: string };

interface ReadRow extends VideoRow {
  highlights?: { count: number }[] | null;
  profile?: { id: string; full_name: string | null; display_name: string | null; handle: string | null; avatar_url: string | null } | null;
  org?: { id: string; name: string; kind: string } | null;
  sport_event?: { id: string; name: string } | null;
  contest?: { id: string; round: string | null; competition: { id: string; name: string } | null } | null;
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
  let place: VideoPlaceView = null;
  if (raw.sport_event_id && event) place = { kind: 'sport_event', id: event.id, name: event.name };
  else if (raw.contest_id && contest) {
    const comp = one(contest.competition);
    place = { kind: 'contest', id: contest.id, name: comp ? (contest.round ? `${comp.name} · ${contest.round}` : comp.name) : 'Game' };
  }
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
  | { kind: 'sport_event'; sportEventId: string; includeHidden: boolean; canManage: boolean }
  | { kind: 'contest'; contestId: string; includeHidden: boolean; canManage: boolean };

/** The list for one context, newest first. Hidden rows ride only for a manager. */
export async function listVideos(admin: Admin, filter: VideoFilter): Promise<VideoView[]> {
  let q = admin.from('videos').select(VIEW_COLUMNS).order('created_at', { ascending: false }).limit(200);
  if (filter.kind === 'profile') q = q.eq('profile_id', filter.profileId);
  else if (filter.kind === 'org') q = q.eq('org_id', filter.orgId);
  else if (filter.kind === 'sport_event') q = q.eq('sport_event_id', filter.sportEventId);
  else q = q.eq('contest_id', filter.contestId);
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
  if (filter.kind === 'sport_event' || filter.kind === 'contest') {
    const out: VideoView[] = [];
    for (const row of rows) {
      if (filter.canManage) {
        out.push(projectVideo(row, true));
        continue;
      }
      if (row.status !== 'published') continue;
      if (row.profile_id) {
        const visible = await anonymousProfileCanView(admin, row.profile_id);
        if (!visible) continue;
      }
      out.push(projectVideo(row, false));
    }
    return out;
  }
  return rows.map(r => projectVideo(r, filter.canManage));
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
  const highlights = await listHighlights(admin, id);
  return { row: raw, view: projectVideo(raw, canManage), highlights, canManage };
}

export async function listHighlights(admin: Admin, videoId: string): Promise<HighlightRow[]> {
  const { data, error } = await admin
    .from('video_highlights')
    .select(HIGHLIGHT_COLUMNS)
    .eq('video_id', videoId)
    .order('start_ms', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error(`${TAG} highlights read failed:`, error.message);
    return [];
  }
  return (data ?? []) as unknown as HighlightRow[];
}

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
  if (existing) return { ok: false, status: 409, error: `This video is already here: ${(existing as { id: string }).id}` };
  const { data, error } = await admin
    .from('videos')
    .insert({
      provider: 'youtube',
      provider_video_id: link.id,
      profile_id: profileId,
      org_id: orgId,
      sport_event_id: args.input.sport_event_id,
      contest_id: args.input.contest_id,
      created_by_user_id: profileId === args.userId ? null : args.userId,
      title: args.input.title ?? defaultVideoTitle(),
      description: args.input.description,
      sport_key: args.input.sport_key,
      status: args.input.status,
    })
    .select(VIDEO_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, status: 409, error: 'This video is already here.' };
    console.error(`${TAG} insert failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the video' };
  }
  return { ok: true, value: data as unknown as VideoRow };
}

export async function updateVideo(admin: Admin, id: string, patch: VideoPatch): Promise<Outcome<VideoRow>> {
  if (patch.sport_key !== undefined && !sportKeyOk(patch.sport_key)) return { ok: false, status: 400, error: 'Unknown sport' };
  const set: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  // A new place clears the other kind (one place, the DB's CHECK).
  if (patch.sport_event_id) set.contest_id = null;
  if (patch.contest_id) set.sport_event_id = null;
  const { data, error } = await admin.from('videos').update(set).eq('id', id).select(VIDEO_COLUMNS).single();
  if (error || !data) {
    console.error(`${TAG} update failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the video' };
  }
  return { ok: true, value: data as unknown as VideoRow };
}

/** A link, not a result: the row goes, its markers cascade. */
export async function deleteVideo(admin: Admin, id: string): Promise<Outcome<null>> {
  const { error } = await admin.from('videos').delete().eq('id', id);
  if (error) {
    console.error(`${TAG} delete failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not delete the video' };
  }
  return { ok: true, value: null };
}

export async function addHighlight(admin: Admin, videoId: string, input: HighlightInput, userId: string): Promise<Outcome<HighlightRow>> {
  const { data, error } = await admin
    .from('video_highlights')
    .insert({ video_id: videoId, start_ms: input.start_ms, end_ms: input.end_ms, label: input.label, meta: input.meta, created_by_user_id: userId })
    .select(HIGHLIGHT_COLUMNS)
    .single();
  if (error || !data) {
    console.error(`${TAG} highlight insert failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not add the highlight' };
  }
  return { ok: true, value: data as unknown as HighlightRow };
}

export async function updateHighlight(admin: Admin, videoId: string, highlightId: string, patch: Partial<HighlightInput>): Promise<Outcome<HighlightRow>> {
  const { data: stored } = await admin.from('video_highlights').select('id, start_ms, end_ms').eq('id', highlightId).eq('video_id', videoId).maybeSingle();
  if (!stored) return { ok: false, status: 404, error: 'Highlight not found' };
  if (!highlightRangeOk(stored as { start_ms: number; end_ms: number | null }, patch)) return { ok: false, status: 400, error: 'end_ms must be after start_ms' };
  const { data, error } = await admin
    .from('video_highlights')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', highlightId)
    .eq('video_id', videoId)
    .select(HIGHLIGHT_COLUMNS)
    .single();
  if (error || !data) {
    console.error(`${TAG} highlight update failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the highlight' };
  }
  return { ok: true, value: data as unknown as HighlightRow };
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

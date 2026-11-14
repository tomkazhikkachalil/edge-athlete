import type { SupabaseClient } from '@supabase/supabase-js';
import { isStubEmail } from '@/lib/config/stubs-config';
import { linkTargets, type ClaimTarget, type LinkTarget } from './tag-claims';
import type { HighlightRow } from './types';
import { linkTagTarget, type TagOwner } from './videos-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper, as in videos-server.ts
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[VIDEOS claims]';
const COLUMNS = 'id, video_id, requester_profile_id, asked_name, status, created_at';
const isMissing = (code: string | undefined) => code === '42P01' || code === 'PGRST205';

export type ClaimStatus = 'pending' | 'approved' | 'declined';
export interface ClaimView { id: string; status: ClaimStatus; asked_name: string | null; created_at: string; requester: { id: string; name: string; handle: string | null; avatar_url: string | null } }
export type ClaimOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409 | 500 | 503; error: string };

interface ClaimRow { id: string; video_id: string; requester_profile_id: string; asked_name: string | null; status: ClaimStatus; created_at: string }

/** The one writer of video_tag_claims (migration 308): "this is me" requests on a game, and their decisions. */

/** The viewer's own latest request on this video, or null. */
export async function myClaim(admin: Admin, videoId: string, profileId: string): Promise<{ id: string; status: ClaimStatus; asked_name: string | null } | null> {
  const { data, error } = await admin.from('video_tag_claims').select(COLUMNS).eq('video_id', videoId).eq('requester_profile_id', profileId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (!isMissing(error.code)) console.error(`${TAG} own read failed:`, error.message);
    return null;
  }
  const row = data as ClaimRow | null;
  return row ? { id: row.id, status: row.status, asked_name: row.asked_name } : null;
}

/** The open requests on a video, with who asks — for its managers. */
export async function pendingClaims(admin: Admin, videoId: string): Promise<ClaimView[]> {
  const { data, error } = await admin.from('video_tag_claims').select(COLUMNS).eq('video_id', videoId).eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
  if (error) {
    if (!isMissing(error.code)) console.error(`${TAG} read failed:`, error.message);
    return [];
  }
  const rows = (data ?? []) as ClaimRow[];
  if (rows.length === 0) return [];
  const { data: profiles } = await admin.from('profiles').select('id, full_name, display_name, handle, avatar_url, departed_at').in('id', rows.map(r => r.requester_profile_id));
  const byId = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null; display_name: string | null; handle: string | null; avatar_url: string | null; departed_at: string | null }>).filter(p => !p.departed_at).map(p => [p.id, p]));
  return rows.flatMap(r => {
    const p = byId.get(r.requester_profile_id);
    return p ? [{ id: r.id, status: r.status, asked_name: r.asked_name, created_at: r.created_at, requester: { id: p.id, name: p.display_name || p.full_name || (p.handle ? `@${p.handle}` : 'Athlete'), handle: p.handle, avatar_url: p.avatar_url } }] : [];
  });
}

/** What a manager can link on this video: the typed names and the placeholder players in its tags. */
export async function claimTargets(admin: Admin, highlights: readonly HighlightRow[]): Promise<ClaimTarget[]> {
  const people = highlights.flatMap(h => h.people.map(p => ({ highlight_id: h.id, profile_id: p.profile_id, name: p.name, masked: p.masked })));
  const ids = [...new Set(people.map(p => p.profile_id).filter((v): v is string => !!v))];
  const stubs = new Set<string>();
  if (ids.length > 0) {
    const { data } = await admin.from('profiles').select('id, email').in('id', ids);
    for (const p of (data ?? []) as Array<{ id: string; email: string | null }>) if (isStubEmail(p.email)) stubs.add(p.id);
  }
  return linkTargets(people, stubs);
}

/** The athlete asks. One open request per person per game; asking again while one is open is the same request. The video's uploader is told. */
export async function requestClaim(admin: Admin, video: { id: string; title: string | null; created_by_user_id: string | null }, requesterId: string, userId: string, askedName: string | null): Promise<ClaimOutcome<{ id: string; status: ClaimStatus }>> {
  const { data, error } = await admin.from('video_tag_claims').insert({ video_id: video.id, requester_profile_id: requesterId, requested_by_user_id: userId, asked_name: askedName }).select('id, status').single();
  if (error || !data) {
    if (error?.code === '23505') {
      const open = await myClaim(admin, video.id, requesterId);
      if (open) return { ok: true, value: { id: open.id, status: open.status } };
    }
    if (error && isMissing(error.code)) return { ok: false, status: 503, error: 'Requests are not available here yet' };
    console.error(`${TAG} request failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not send the request' };
  }
  if (video.created_by_user_id && video.created_by_user_id !== userId) {
    try {
      const { data: who } = await admin.from('profiles').select('full_name, display_name').eq('id', requesterId).maybeSingle();
      const name = (who as { full_name: string | null; display_name: string | null } | null)?.display_name || (who as { full_name: string | null } | null)?.full_name || 'An athlete';
      const { error: nError } = await admin.from('notifications').insert({
        user_id: video.created_by_user_id, type: 'tag', actor_id: userId, title: `${name} asks to be linked in ${(video.title ?? 'a game').slice(0, 120)}`, message: 'They say they are in this game. Open the video to say which name or player they are, or to decline.', action_url: `/videos/${video.id}`, is_read: false, metadata: { video_id: video.id, claim_id: (data as { id: string }).id },
      });
      if (nError) console.error(`${TAG} request notification failed:`, nError.message);
    } catch (e) {
      console.error(`${TAG} request notification failed:`, e);
    }
  }
  return { ok: true, value: data as { id: string; status: ClaimStatus } };
}

/** A manager decides. Approve = the tags of `target` become the requester's (across the owner's videos); the request closes either way, once. */
export async function decideClaim(admin: Admin, videoId: string, claimId: string, decision: { action: 'decline' } | { action: 'approve'; target: LinkTarget }, owner: TagOwner, byUserId: string): Promise<ClaimOutcome<{ status: ClaimStatus; linked: number; videos: number }>> {
  const { data } = await admin.from('video_tag_claims').select(COLUMNS).eq('id', claimId).eq('video_id', videoId).maybeSingle();
  const claim = data as ClaimRow | null;
  if (!claim) return { ok: false, status: 404, error: 'Request not found' };
  if (claim.status !== 'pending') return { ok: false, status: 409, error: 'That request was already decided' };
  let linked = 0;
  let videos = 0;
  if (decision.action === 'approve') {
    const done = await linkTagTarget(admin, owner, decision.target, claim.requester_profile_id, byUserId, { checkWho: false });
    if (!done.ok) return { ok: false, status: done.status === 401 ? 403 : done.status, error: done.error };
    if (done.value.linked === 0) return { ok: false, status: 409, error: 'Nothing was linked: there are no tags under that name or player that this person can take.' };
    linked = done.value.linked;
    videos = done.value.videos;
  }
  const status: ClaimStatus = decision.action === 'approve' ? 'approved' : 'declined';
  const { data: closed, error } = await admin
    .from('video_tag_claims')
    .update({ status, decided_by_user_id: byUserId, decided_at: new Date().toISOString(), linked_count: linked, target_name: decision.action === 'approve' && decision.target.kind === 'name' ? decision.target.name : null, target_profile_id: decision.action === 'approve' && decision.target.kind === 'placeholder' ? decision.target.profileId : null })
    .eq('id', claimId)
    .eq('status', 'pending')
    .select('id');
  if (error || (closed ?? []).length === 0) {
    console.error(`${TAG} decision failed:`, error?.message ?? 'already decided');
    return { ok: false, status: 500, error: 'Could not record the decision' };
  }
  // An approval is told by the link itself ("You were tagged in …"); a decline is said plainly.
  if (decision.action === 'decline' && claim.requester_profile_id !== byUserId) {
    const { error: nError } = await admin.from('notifications').insert({ user_id: claim.requester_profile_id, type: 'tag', actor_id: byUserId, title: 'Your request to be linked in a game was not approved', message: 'The people who manage the video did not link you. If that is a mistake, ask them directly.', action_url: `/videos/${videoId}`, is_read: false, metadata: { video_id: videoId, claim_id: claimId } });
    if (nError) console.error(`${TAG} decline notification failed:`, nError.message);
  }
  return { ok: true, value: { status, linked, videos } };
}

/**
 * Unclaimed profiles — the reads and the one writer (Sprint 4 PR 6b,
 * migration 312). Server only. The rules are unclaimed.ts.
 *
 * An approved request MOVES THE FILM (Tom, Nov 16 2026): the placeholder's
 * tags on the deciding organization's videos become the requester's own,
 * through the writer that already does it for "this is me" on a video
 * (linkTagTarget). There is no account merge: the placeholder, its roster
 * seat and any official result stay with the organization.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { isOrgKind, type OrgKind } from '@/lib/orgs/org-ref';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { guardedAthletes, videoManagerIds } from '@/lib/videos/video-claims-server';
import { linkTagTarget, orgVideoAccess } from '@/lib/videos/videos-server';
import { isUnclaimed, unclaimedName, unclaimedOpen, type ClaimRequestStatus } from './unclaimed';
import { keptPrivate, readStub } from './unclaimed-open-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper, as in the other server modules
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[UNCLAIMED]';
const isMissing = (code: string | undefined) => code === '42P01' || code === 'PGRST205';

/** The organizations that tagged this placeholder, the one with the most of its games first (it decides a request). */
async function taggingOrgs(admin: Admin, profileId: string): Promise<Array<{ id: string; name: string; side: OrgKind; videos: number }>> {
  const { data: tags } = await admin.from('video_highlight_people').select('video_id').eq('profile_id', profileId).eq('status', 'active').limit(4000);
  const videoIds = [...new Set(((tags ?? []) as Array<{ video_id: string }>).map(t => t.video_id))].slice(0, 300);
  if (videoIds.length === 0) return [];
  const { data: vids } = await admin.from('videos').select('id, org_id, org:organizations(id, name, kind)').in('id', videoIds).not('org_id', 'is', null);
  const by = new Map<string, { id: string; name: string; side: OrgKind; videos: number }>();
  for (const v of (vids ?? []) as unknown as Array<{ org_id: string; org: { id: string; name: string; kind: string } | Array<{ id: string; name: string; kind: string }> | null }>) {
    const org = Array.isArray(v.org) ? v.org[0] : v.org;
    if (!org) continue;
    const row = by.get(org.id) ?? { id: org.id, name: org.name, side: isOrgKind(org.kind) ? org.kind : 'club', videos: 0 };
    row.videos += 1;
    by.set(org.id, row);
  }
  return [...by.values()].sort((a, b) => b.videos - a.videos || a.id.localeCompare(b.id));
}

/**
 * The organizations a placeholder belongs to: the ones that tagged it (most
 * games first — the first decides a request), then the ones whose roster it
 * is on. The roster is what still says whose player this is after its film
 * has moved to the person who claimed it.
 */
async function stubOrgs(admin: Admin, profileId: string): Promise<Array<{ id: string; name: string; side: OrgKind; videos: number }>> {
  const tagged = await taggingOrgs(admin, profileId);
  const { data: seats } = await admin.from('memberships').select('org_id, org:organizations(id, name, kind)').eq('profile_id', profileId).eq('kind', 'roster').eq('status', 'active').limit(20);
  const seen = new Set(tagged.map(o => o.id));
  const out = [...tagged];
  for (const m of (seats ?? []) as unknown as Array<{ org: { id: string; name: string; kind: string } | Array<{ id: string; name: string; kind: string }> | null }>) {
    const org = Array.isArray(m.org) ? m.org[0] : m.org;
    if (!org || seen.has(org.id)) continue;
    seen.add(org.id);
    out.push({ id: org.id, name: org.name, side: isOrgKind(org.kind) ? org.kind : 'club', videos: 0 });
  }
  return out;
}

/** The sports the placeholder has film in (the ones with a stat sheet here), most games first. */
async function filmSports(admin: Admin, profileId: string): Promise<Array<{ sportKey: string; sportLabel: string }>> {
  const { data: tags } = await admin.from('video_highlight_people').select('video_id').eq('profile_id', profileId).eq('status', 'active').limit(4000);
  const videoIds = [...new Set(((tags ?? []) as Array<{ video_id: string }>).map(t => t.video_id))].slice(0, 300);
  if (videoIds.length === 0) return [];
  const { data: games } = await admin.from('video_games').select('sport_key').in('video_id', videoIds);
  const count = new Map<string, number>();
  for (const g of (games ?? []) as Array<{ sport_key: string }>) count.set(g.sport_key, (count.get(g.sport_key) ?? 0) + 1);
  return [...count.entries()]
    .filter(([k]) => !!getStatSchema(k))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => ({ sportKey: k, sportLabel: getSportDefinition(k as SportKey)?.display_name ?? k }));
}

export interface ClaimRequestView { id: string; status: ClaimRequestStatus; created_at: string; requester: { id: string; name: string } }

export interface UnclaimedView {
  profile_id: string;
  name: string;
  sports: Array<{ sportKey: string; sportLabel: string }>;
  org: { id: string; name: string } | null;
  /** Open to signed-in visitors (false: the organization keeps it private — only its managers get this answer). */
  listed: boolean;
  /** The viewer manages the deciding organization's videos: they see the requests and the switch. */
  can_manage: boolean;
  /** Who the viewer may ask for: themselves, and the athletes they are a guardian of. */
  candidates: Array<{ id: string; name: string; self: boolean }>;
  /** The viewer's own requests on this placeholder (for themselves or a child), newest first. */
  mine: Array<{ id: string; status: ClaimRequestStatus; for_id: string }>;
  /** Open requests — managers only. */
  requests: ClaimRequestView[];
}

/** The unclaimed page's own facts for one signed-in viewer, or null: not a placeholder, or not theirs to see. */
export async function readUnclaimed(admin: Admin, profileId: string, viewerId: string): Promise<UnclaimedView | null> {
  const stub = await readStub(admin, profileId);
  if (!stub) return null;
  const [off, orgs, sports] = await Promise.all([keptPrivate(admin, profileId), stubOrgs(admin, profileId), filmSports(admin, profileId)]);
  const org = orgs[0] ?? null;
  const canManage = org ? (await orgVideoAccess(admin, org.side, org.id, viewerId)).canManage : false;
  if (off && !canManage) return null;
  const [{ data: mineRows }, guarded, { data: me }] = await Promise.all([
    admin.from('profile_claim_requests').select('id, status, requester_profile_id, created_at').eq('profile_id', profileId).eq('requested_by_user_id', viewerId).order('created_at', { ascending: false }).limit(10),
    guardedAthletes(admin, viewerId),
    admin.from('profiles').select('display_name, full_name, first_name').eq('id', viewerId).maybeSingle(),
  ]);
  let requests: ClaimRequestView[] = [];
  if (canManage && org) {
    const { data: open } = await admin
      .from('profile_claim_requests')
      .select('id, status, created_at, requester:profiles!profile_claim_requests_requester_profile_id_fkey(id, display_name, full_name)')
      .eq('profile_id', profileId).eq('org_id', org.id).eq('status', 'pending').order('created_at', { ascending: true }).limit(20);
    type Row = { id: string; status: ClaimRequestStatus; created_at: string; requester: { id: string; display_name: string | null; full_name: string | null } | Array<{ id: string; display_name: string | null; full_name: string | null }> | null };
    requests = ((open ?? []) as unknown as Row[]).flatMap(r => {
      const who = Array.isArray(r.requester) ? r.requester[0] : r.requester;
      return who ? [{ id: r.id, status: r.status, created_at: r.created_at, requester: { id: who.id, name: who.display_name || who.full_name || 'An athlete' } }] : [];
    });
  }
  const self = me as { display_name: string | null; full_name: string | null; first_name: string | null } | null;
  return {
    profile_id: profileId,
    name: unclaimedName(stub),
    sports,
    org: org ? { id: org.id, name: org.name } : null,
    listed: !off,
    can_manage: canManage,
    candidates: [{ id: viewerId, name: self?.display_name || self?.full_name || self?.first_name || 'Me', self: true }, ...guarded.map(g => ({ ...g, self: false }))],
    mine: ((mineRows ?? []) as Array<{ id: string; status: ClaimRequestStatus; requester_profile_id: string }>).map(r => ({ id: r.id, status: r.status, for_id: r.requester_profile_id })),
    requests,
  };
}

export type UnclaimedOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409 | 500 | 503; error: string };

/**
 * Start a request: `requesterId` (the person asking, or the child their
 * guardian asks for) wants this placeholder's film. One open request per
 * person per placeholder — asking again is the same request. The deciding
 * organization's video managers are told.
 */
export async function requestProfileClaim(admin: Admin, profileId: string, requesterId: string, userId: string): Promise<UnclaimedOutcome<{ id: string; status: ClaimRequestStatus }>> {
  const stub = await readStub(admin, profileId);
  if (!stub || !unclaimedOpen(stub, await keptPrivate(admin, profileId))) return { ok: false, status: 404, error: 'Profile not found' };
  const { data: asker } = await admin.from('profiles').select('id, email, departed_at, display_name, full_name').eq('id', requesterId).maybeSingle();
  const who = asker as { id: string; email: string | null; departed_at: string | null; display_name: string | null; full_name: string | null } | null;
  if (!who || who.departed_at || isUnclaimed(who)) return { ok: false, status: 400, error: 'Only a person with their own profile can ask for this one' };
  const org = (await taggingOrgs(admin, profileId))[0];
  if (!org) return { ok: false, status: 409, error: 'No organization has tagged this player yet, so there is nobody to ask' };
  const { data, error } = await admin.from('profile_claim_requests').insert({ profile_id: profileId, requester_profile_id: requesterId, requested_by_user_id: userId, org_id: org.id }).select('id, status').single();
  if (error || !data) {
    if (error?.code === '23505') {
      const { data: open } = await admin.from('profile_claim_requests').select('id, status').eq('profile_id', profileId).eq('requester_profile_id', requesterId).eq('status', 'pending').maybeSingle();
      if (open) return { ok: true, value: open as { id: string; status: ClaimRequestStatus } };
    }
    if (error && isMissing(error.code)) return { ok: false, status: 503, error: 'Requests are not available here yet' };
    console.error(`${TAG} request failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not send the request' };
  }
  try {
    const told = (await videoManagerIds(admin, org.id)).filter(id => id !== userId && id !== requesterId);
    // Never tell a manager about a request from someone they have blocked, or who blocked them.
    const { allowed } = told.length > 0 ? await filterBlockedBidirectional(admin, requesterId, told) : { allowed: [] as string[] };
    if (allowed.length > 0) {
      const name = who.display_name || who.full_name || 'An athlete';
      const sport = (await filmSports(admin, profileId))[0]?.sportKey;
      const row = { type: 'tag', actor_id: userId, title: `${name} says they are ${unclaimedName(stub)}`, message: `They ask for the clips and stats ${org.name} tagged for this player. Open the player's page to approve or decline.`, action_url: sport ? `/athlete/${profileId}/sport/${sport}` : `/athlete/${profileId}`, is_read: false };
      const { error: nError } = await admin.from('notifications').insert(allowed.map(user_id => ({ ...row, user_id })));
      if (nError) console.error(`${TAG} request notification failed:`, nError.message);
    }
  } catch (e) {
    console.error(`${TAG} request notification failed:`, e);
  }
  return { ok: true, value: data as { id: string; status: ClaimRequestStatus } };
}

/**
 * The organization answers. Approve: the placeholder's tags on THIS
 * organization's videos move to the requester (linkTagTarget tells them
 * once); the request records how many. Decline: the requester is told.
 * Only someone who manages the organization's videos; only an open request.
 */
export async function decideProfileClaim(admin: Admin, profileId: string, requestId: string, action: 'approve' | 'decline', byUserId: string): Promise<UnclaimedOutcome<{ status: ClaimRequestStatus; linked: number }>> {
  const { data: found, error } = await admin.from('profile_claim_requests').select('id, profile_id, requester_profile_id, org_id, status').eq('id', requestId).eq('profile_id', profileId).maybeSingle();
  if (error && isMissing(error.code)) return { ok: false, status: 503, error: 'Requests are not available here yet' };
  const req = found as { id: string; profile_id: string; requester_profile_id: string; org_id: string; status: ClaimRequestStatus } | null;
  if (!req) return { ok: false, status: 404, error: 'Request not found' };
  const { data: orgRow } = await admin.from('organizations').select('kind, name').eq('id', req.org_id).maybeSingle();
  const org = orgRow as { kind: string; name: string } | null;
  const access = org ? await orgVideoAccess(admin, isOrgKind(org.kind) ? org.kind : 'club', req.org_id, byUserId) : null;
  if (!access?.canManage) return { ok: false, status: 404, error: 'Request not found' };
  if (req.status !== 'pending') return { ok: false, status: 409, error: 'That request was already answered' };

  let linked = 0;
  if (action === 'approve') {
    const moved = await linkTagTarget(admin, { orgId: req.org_id, profileId: null }, { kind: 'placeholder', profileId }, req.requester_profile_id, byUserId, { checkWho: false });
    if (!moved.ok) return { ok: false, status: moved.status === 401 ? 403 : moved.status, error: moved.error };
    linked = moved.value.linked;
  }
  const status: ClaimRequestStatus = action === 'approve' ? 'approved' : 'declined';
  const { data: saved, error: saveError } = await admin.from('profile_claim_requests').update({ status, linked_count: linked, decided_by_user_id: byUserId, decided_at: new Date().toISOString() }).eq('id', req.id).eq('status', 'pending').select('id');
  if (saveError || !saved || saved.length === 0) {
    console.error(`${TAG} decision save failed:`, saveError?.message ?? 'no row');
    return { ok: false, status: 500, error: 'Could not save the answer' };
  }
  if (action === 'decline') {
    const { error: nError } = await admin.from('notifications').insert({ user_id: req.requester_profile_id, type: 'tag', actor_id: byUserId, title: 'Your request for a player\'s profile was not approved', message: `${org?.name ?? 'The organization'} did not approve it. If you think that is a mistake, talk to them directly.`, action_url: '/athlete', is_read: false });
    if (nError) console.error(`${TAG} decline notification failed:`, nError.message);
  }
  return { ok: true, value: { status, linked } };
}

/** The organization's switch: keep this placeholder's page private (`listed: false`), or open it again. Only its video managers. */
export async function setUnclaimedListed(admin: Admin, profileId: string, listed: boolean, byUserId: string): Promise<UnclaimedOutcome<{ listed: boolean }>> {
  const stub = await readStub(admin, profileId);
  if (!stub) return { ok: false, status: 404, error: 'Profile not found' };
  const org = (await stubOrgs(admin, profileId))[0];
  const access = org ? await orgVideoAccess(admin, org.side, org.id, byUserId) : null;
  if (!access?.canManage) return { ok: false, status: 404, error: 'Profile not found' };
  const { error } = listed
    ? await admin.from('unclaimed_page_private').delete().eq('profile_id', profileId)
    : await admin.from('unclaimed_page_private').upsert({ profile_id: profileId, set_by_user_id: byUserId }, { onConflict: 'profile_id' });
  if (error) {
    if (isMissing(error.code)) return { ok: false, status: 503, error: 'This is not available here yet' };
    console.error(`${TAG} listed save failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not save that' };
  }
  return { ok: true, value: { listed } };
}

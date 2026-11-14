import type { SupabaseClient } from '@supabase/supabase-js';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { ORG_ID } from '@/lib/orgs/org-ref';
import { currentTeamRosterRows } from '@/lib/teams/roster-server';
import { readGame } from './video-games-server';
import { importRoster } from '@/lib/orgs/roster-import';
import type { OrgKind } from '@/lib/orgs/org-ref';
import { orderCandidates, PLACEHOLDER_REFUSALS, type TagCandidate, type TagGroup } from './tag-people';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper, as in videos-server.ts
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[VIDEOS tag people]';
const GROUP_MAX = 300;

/** Everyone `userId` follows or is followed by (accepted), capped. */
export async function connectionIds(admin: Admin, userIds: readonly string[], within: readonly string[] | null = null): Promise<Set<string>> {
  const out = new Set<string>();
  const mine = [...new Set(userIds.filter(Boolean))];
  if (mine.length === 0) return out;
  let following = admin.from('follows').select('following_id').in('follower_id', mine).eq('status', 'accepted');
  let followers = admin.from('follows').select('follower_id').in('following_id', mine).eq('status', 'accepted');
  if (within) {
    if (within.length === 0) return out;
    following = following.in('following_id', [...within]);
    followers = followers.in('follower_id', [...within]);
  }
  const [a, b] = await Promise.all([following.limit(GROUP_MAX), followers.limit(GROUP_MAX)]);
  if (a.error || b.error) console.error(`${TAG} follows read failed:`, (a.error ?? b.error)?.message);
  for (const r of (a.data ?? []) as Array<{ following_id: string }>) out.add(r.following_id);
  for (const r of (b.data ?? []) as Array<{ follower_id: string }>) out.add(r.follower_id);
  return out;
}

/**
 * Who the tag form offers BEFORE anything is typed (round 2, Nov 13 2026).
 * A club's or league's own video: the rosters of the teams its game's sides
 * are linked to, then the rest of the organization's roster — its OWN players
 * only, private and not-yet-claimed ones included (the manager entered them).
 * A person's video: the people they are connected to. Blocked people (either
 * direction) and closed accounts are never listed. Managers only — the route
 * holds the gate.
 */
export async function tagCandidates(admin: Admin, video: { id: string; org_id: string | null; profile_id: string | null }, userId: string): Promise<TagCandidate[]> {
  const ids: Partial<Record<TagGroup, string[]>> = {};
  if (video.org_id) {
    const game = await readGame(admin, video.id);
    const t1 = game?.side1.team_id ?? null;
    const t2 = game?.side2.team_id ?? null;
    const teamIds = [t1, t2].filter((v): v is string => !!v);
    const [teamRows, orgRows] = await Promise.all([
      currentTeamRosterRows(admin, teamIds, { orgId: video.org_id }),
      admin.from('memberships').select('profile_id').eq(ORG_ID, video.org_id).eq('kind', 'roster').eq('scope_type', 'org').limit(GROUP_MAX),
    ]);
    if (orgRows.error) console.error(`${TAG} roster read failed:`, orgRows.error.message);
    ids.side1 = t1 ? teamRows.filter(r => r.scope_id === t1).map(r => r.profile_id) : [];
    ids.side2 = t2 ? teamRows.filter(r => r.scope_id === t2).map(r => r.profile_id) : [];
    ids.roster = ((orgRows.data ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id);
  } else {
    ids.connections = [...(await connectionIds(admin, [userId, video.profile_id ?? userId]))];
  }
  const all = [...new Set(Object.values(ids).flat())].filter(id => id !== userId);
  if (all.length === 0) return [];
  const { allowed } = await filterBlockedBidirectional(admin, userId, all);
  if (allowed.length === 0) return [];
  const { data, error } = await admin.from('profiles').select('id, full_name, display_name, first_name, last_name, handle, avatar_url, departed_at').in('id', allowed);
  if (error) {
    console.error(`${TAG} profiles read failed:`, error.message);
    return [];
  }
  type Row = { id: string; full_name: string | null; display_name: string | null; first_name: string | null; last_name: string | null; handle: string | null; avatar_url: string | null; departed_at: string | null };
  const byId = new Map(((data ?? []) as Row[]).filter(p => !p.departed_at).map(p => [p.id, p]));
  const person = (id: string) => {
    const p = byId.get(id);
    if (!p) return null;
    const name = p.display_name || p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || (p.handle ? `@${p.handle}` : 'Athlete');
    return { id: p.id, name, handle: p.handle, avatar_url: p.avatar_url };
  };
  const group = (g: TagGroup) => (ids[g] ?? []).map(person).filter((v): v is NonNullable<ReturnType<typeof person>> => !!v);
  return orderCandidates({ side1: group('side1'), side2: group('side2'), roster: group('roster'), connections: group('connections') });
}

/**
 * A player without an account, added from a club's or league's own video
 * (round 2, Nov 13 2026). It is a roster STUB — the same private profile a
 * roster import makes, with its claim invite — so its tags and stats carry
 * across every game the organization tags, and are already the player's the
 * day they activate the account. It joins the roster of the team the tag's
 * side is linked to (when that team has a live season), else the
 * organization's roster alone. The caller holds the gates (a manager of the
 * video AND of the organization's roster).
 */
export async function addPlaceholderPlayer(
  admin: Admin,
  input: { videoId: string; org: { id: string; side: OrgKind; name: string }; firstName: string; lastName: string | null; side: 1 | 2 | null; createdBy: string; appUrl: string },
): Promise<{ ok: true; person: TagCandidate } | { ok: false; error: string }> {
  const game = input.side ? await readGame(admin, input.videoId) : null;
  const teamId = input.side === 1 ? (game?.side1.team_id ?? null) : input.side === 2 ? (game?.side2.team_id ?? null) : null;
  const base = { side: input.org.side, orgId: input.org.id, orgName: input.org.name, rows: [{ firstName: input.firstName, lastName: input.lastName, email: null }], createdBy: input.createdBy, appUrl: input.appUrl };
  let made = teamId ? await importRoster(admin, { ...base, teamId }) : null;
  const onTeam = !!made && made.ok;
  // A team that is gone or has no live season does not stop the player being added: the organization's roster takes them.
  if (!made || !made.ok) made = await importRoster(admin, { ...base, teamId: null });
  const row = made.ok ? made.report[0] : null;
  if (!row || !row.profileId || row.error) {
    console.error(`${TAG} placeholder failed:`, row?.error ?? 'no row');
    return { ok: false, error: PLACEHOLDER_REFUSALS.failed };
  }
  return { ok: true, person: { id: row.profileId, name: row.name, handle: null, avatar_url: null, group: onTeam && input.side ? (input.side === 1 ? 'side1' : 'side2') : 'roster' } };
}

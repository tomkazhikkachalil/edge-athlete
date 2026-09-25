// ── The backup-account guard (departed accounts, Sep 24 2026) ───────────────
// Tom: "there always needs to be two accounts to create an event, tourney,
// club, league". The creation-time rule is the NEXT round; this round keeps
// the promise at the other end: you cannot delete your account while you
// are the ONLY person able to run something other people depend on —
//   * an unfinished sport event (draft · open · live) where nobody else is
//     the host or an accepted organizer / co-organizer, or
//   * a club or league where nobody else is an owner.
// The account-delete route answers 409 with the list (the guardian check's
// shape), so the person names a backup first. A finished event needs no
// one: its results stand on their own.
//
// The pure part decides; `findSoleAuthority` reads. A consent withdrawal is
// NOT gated (a guardian's withdrawal must always be honoured) — the engine
// hands a minor's hosted event to a co-organizer instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgKind } from '@/lib/orgs/org-ref';

export interface SoleAuthorityBlocker {
  kind: 'event' | OrgKind;
  id: string;
  name: string;
}

export const UNFINISHED_EVENT_STATUSES = ['draft', 'open', 'live'] as const;

export interface EventAuthorityInput {
  events: Array<{ id: string; name: string | null; status: string; host_profile_id: string }>;
  organizerRows: Array<{ sport_event_id: string; profile_id: string; role: string; status: string }>;
}

/** Unfinished events where no one but `userId` can run them. */
export function soleEventBlockers(userId: string, input: EventAuthorityInput): SoleAuthorityBlocker[] {
  const others = new Map<string, number>();
  for (const r of input.organizerRows) {
    if (r.profile_id === userId || r.status !== 'accepted') continue;
    if (r.role !== 'organizer' && r.role !== 'co_organizer') continue;
    others.set(r.sport_event_id, (others.get(r.sport_event_id) ?? 0) + 1);
  }
  return input.events
    .filter(e => (UNFINISHED_EVENT_STATUSES as readonly string[]).includes(e.status))
    .filter(e => (e.host_profile_id !== userId ? 1 : 0) + (others.get(e.id) ?? 0) === 0)
    .map(e => ({ kind: 'event' as const, id: e.id, name: e.name?.trim() || 'Untitled event' }));
}

export interface OrgAuthorityInput {
  orgs: Array<{ id: string; name: string | null; kind: string }>;
  ownerRows: Array<{ org_id: string; profile_id: string }>;
}

/** Clubs and leagues where `userId` is the only owner. */
export function soleOrgBlockers(userId: string, input: OrgAuthorityInput): SoleAuthorityBlocker[] {
  const others = new Map<string, number>();
  for (const r of input.ownerRows) {
    if (r.profile_id === userId) continue;
    others.set(r.org_id, (others.get(r.org_id) ?? 0) + 1);
  }
  return input.orgs
    .filter(o => (others.get(o.id) ?? 0) === 0)
    .map(o => {
      const kind: OrgKind = o.kind === 'league' ? 'league' : 'club';
      return { kind, id: o.id, name: o.name?.trim() || `Your ${kind}` };
    });
}

/** The sentence the delete dialog shows. */
export function soleAuthorityMessage(blockers: SoleAuthorityBlocker[]): string {
  const names = blockers.map(b => b.name);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `You're the only one who can run ${list}. Add a co-organizer or co-owner first, so it keeps going without you.`;
}

type Admin = SupabaseClient;

/** Read what the person runs and answer the blockers. Throws on a read error
 *  (the route answers 500 — a guard that cannot read must not wave through). */
export async function findSoleAuthority(admin: Admin, userId: string): Promise<SoleAuthorityBlocker[]> {
  // Events: the ones hosted, plus the ones the person organizes.
  const [{ data: hosted, error: hostErr }, { data: mine, error: mineErr }] = await Promise.all([
    admin.from('sport_events').select('id').eq('host_profile_id', userId).in('status', [...UNFINISHED_EVENT_STATUSES]),
    admin.from('sport_event_participants').select('sport_event_id').eq('profile_id', userId).eq('status', 'accepted').in('role', ['organizer', 'co_organizer']),
  ]);
  if (hostErr || mineErr) throw new Error(`sole-authority event read: ${(hostErr ?? mineErr)!.message}`);
  const eventIds = [...new Set([...(hosted ?? []).map(r => r.id as string), ...(mine ?? []).map(r => r.sport_event_id as string)])];
  let blockers: SoleAuthorityBlocker[] = [];
  if (eventIds.length > 0) {
    const [{ data: events, error: evErr }, { data: organizerRows, error: orgRowErr }] = await Promise.all([
      admin.from('sport_events').select('id, name, status, host_profile_id').in('id', eventIds),
      admin.from('sport_event_participants').select('sport_event_id, profile_id, role, status').in('sport_event_id', eventIds).in('role', ['organizer', 'co_organizer']),
    ]);
    if (evErr || orgRowErr) throw new Error(`sole-authority event detail read: ${(evErr ?? orgRowErr)!.message}`);
    blockers = soleEventBlockers(userId, { events: (events ?? []) as EventAuthorityInput['events'], organizerRows: (organizerRows ?? []) as EventAuthorityInput['organizerRows'] });
  }

  // Orgs: the ones the person owns.
  const { data: owned, error: ownErr } = await admin
    .from('memberships').select('org_id')
    .eq('profile_id', userId).eq('role', 'owner').eq('kind', 'follow').eq('scope_type', 'org');
  if (ownErr) throw new Error(`sole-authority owner read: ${ownErr.message}`);
  const orgIds = [...new Set((owned ?? []).map(r => r.org_id as string).filter(Boolean))];
  if (orgIds.length > 0) {
    const [{ data: orgs, error: orgsErr }, { data: ownerRows, error: ownersErr }] = await Promise.all([
      admin.from('organizations').select('id, name, kind').in('id', orgIds),
      admin.from('memberships').select('org_id, profile_id').in('org_id', orgIds).eq('role', 'owner').eq('kind', 'follow').eq('scope_type', 'org'),
    ]);
    if (orgsErr || ownersErr) throw new Error(`sole-authority org read: ${(orgsErr ?? ownersErr)!.message}`);
    blockers = blockers.concat(soleOrgBlockers(userId, { orgs: (orgs ?? []) as OrgAuthorityInput['orgs'], ownerRows: (ownerRows ?? []) as OrgAuthorityInput['ownerRows'] }));
  }
  return blockers;
}

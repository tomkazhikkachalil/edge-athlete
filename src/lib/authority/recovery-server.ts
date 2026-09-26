// ── Recovery — the Edge Athlete team's tools (Authority PR 4, Sep 25 2026) ──
// Tom's decision 3: recovery is decided by the team on a support ticket, and
// every act is audited. Every WRITE here:
//   * names an open ticket (`openRecovery` resolves EA-1042 or an id; a
//     closed ticket refuses — reopen it first);
//   * records the act in the authority log as a PLATFORM actor on that ticket
//     (240's CHECK refuses a platform row without one);
//   * appends `action_taken` to the ticket's own history;
//   * bells the org's owners / managers or the event's organizers with an
//     `authority_notice` that says "Edge Athlete support" — never the admin.
// The rules are pure in recovery.ts; this module only reads, writes and
// tells people. Service role throughout; the routes gate on
// requireModerator(intent 'recover_authority') — owner-only today.

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { recordAuthority } from '@/lib/authority/audit-server';
import type { AuthorityAction } from './types';
import {
  RECOVERY_NOTE_MAX,
  identityRestorePatch,
  parseRecoveryQuery,
  planAddOwner,
  planEventCancel,
  planEventHost,
  planRemoveOwner,
  planSetRole,
  type EventStatus,
  type RecoveryCandidate,
  type Refusal,
} from './recovery';
import { holdsAuthority } from '@/lib/moderation/state';
import { formatTicketNumber, parseTicketNumber } from '@/lib/tickets/number';
import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import { insertOwnerRow, ownerRows, promoteFollowToOwner, setMemberRole } from '@/lib/orgs/members';
import { recomputePrimaryOwner } from '@/lib/orgs/owners';
import { deleteStaffRow, readStaffRow } from '@/lib/orgs/staff';
import { writeStaffAudit } from '@/lib/orgs/staff-invites';
import { notifyOrgRole } from '@/lib/orgs/notify';
import { applyListing } from '@/lib/orgs/listing-server';
import { createOrgClaimInvite, peekOrgClaimInvite, redeemOrgClaimInvite, restoreOrgClaimInvite } from '@/lib/orgs/org-claim';
import { loadSitePointers, publishDraft, restoreRevision } from '@/lib/org-sites/revisions-server';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { transferHost } from '@/lib/sport-events/host-transfer-server';
import { applyTransition } from '@/lib/sport-events/lifecycle-server';
import { EVENT_COLUMNS } from '@/lib/sport-events/access-server';
import { UUID_RE } from '@/lib/uuid';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[authority recovery]';

export type Result<T extends object = object> = ({ ok: true } & T) | Refusal;

/** The team's context for one act: who, on which ticket, and why. */
export interface RecoveryContext {
  actorId: string;
  ticketId: string;
  ticketLabel: string;
  note: string | null;
}

// ── The ticket ─────────────────────────────────────────────────────────────

/** Resolve the ticket an act rides on. Unknown → 404; closed → 409 (reopen it first). */
export async function openRecovery(admin: Admin, actorId: string, ticketRef: string, note: string | null | undefined): Promise<Result<{ ctx: RecoveryContext }>> {
  const ref = ticketRef.trim();
  const byNumber = parseTicketNumber(ref);
  if (!byNumber && !UUID_RE.test(ref)) return { ok: false, status: 400, error: 'Name the support ticket (EA-1042) this change is for.' };
  const q = admin.from('tickets').select('id, number, status');
  const { data } = await (byNumber ? q.eq('number', byNumber) : q.eq('id', ref)).maybeSingle();
  const t = data as { id: string; number: number; status: string } | null;
  if (!t) return { ok: false, status: 404, error: 'No such ticket.' };
  if (t.status === 'closed') return { ok: false, status: 409, error: 'That ticket is closed — reopen it first.' };
  const trimmed = (note ?? '').trim().slice(0, RECOVERY_NOTE_MAX);
  return { ok: true, ctx: { actorId, ticketId: t.id, ticketLabel: formatTicketNumber(t.number), note: trimmed || null } };
}

/** The ticket's own history line — internal (the requester sees the resolution, not each step). */
async function ticketAction(admin: Admin, ctx: RecoveryContext, action: string, detail: string | null): Promise<void> {
  const body = [detail, ctx.note].filter(Boolean).join(' — ') || null;
  const { error } = await admin.from('ticket_events').insert({
    ticket_id: ctx.ticketId,
    actor_profile_id: ctx.actorId,
    kind: 'action_taken',
    old_value: null,
    new_value: action,
    body,
    visible_to_user: false,
  });
  if (error) console.error(`${TAG} ticket history failed:`, error.message);
}

async function audit(admin: Admin, ctx: RecoveryContext, subject: { type: 'org' | 'sport_event'; id: string }, action: AuthorityAction, targetProfileId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await recordAuthority(admin, {
    subject,
    actor: { kind: 'platform', profileId: ctx.actorId },
    action,
    targetProfileId,
    ticketId: ctx.ticketId,
    detail: { ...detail, note: ctx.note },
  });
}

/** The authority bell: "Edge Athlete support …" — never the admin's name, never the ticket. */
async function bell(admin: Admin, recipients: Iterable<string>, title: string, message: string, actionUrl: string): Promise<void> {
  const ids = [...new Set(recipients)].filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await admin.from('notifications').insert(ids.map(user_id => ({
    user_id,
    type: 'authority_notice',
    actor_id: null,
    title,
    message,
    action_url: actionUrl,
    is_read: false,
    metadata: {},
  })));
  if (error) console.error(`${TAG} bell failed:`, error.message);
}

// ── People ─────────────────────────────────────────────────────────────────

export interface PersonFacts {
  id: string;
  name: string;
  handle: string | null;
  email: string | null;
  supervised: boolean;
  departed: boolean;
  moderation: string;
  holds: boolean;
}

const PERSON_COLUMNS = 'id, first_name, last_name, full_name, handle, email, supervision_state, departed_at, moderation_state, moderation_until';

function toFacts(p: Record<string, unknown>): PersonFacts {
  const name = (p.full_name as string | null) || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
  const state = (p.moderation_state as string | null) ?? 'active';
  return {
    id: p.id as string,
    name,
    handle: (p.handle as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    supervised: p.supervision_state === 'supervised',
    departed: !!p.departed_at,
    moderation: state,
    holds: holdsAuthority(p as { moderation_state?: string | null; moderation_until?: string | null; departed_at?: string | null }),
  };
}

export async function readPeople(admin: Admin, ids: readonly string[]): Promise<Map<string, PersonFacts>> {
  const out = new Map<string, PersonFacts>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return out;
  const { data, error } = await admin.from('profiles').select(PERSON_COLUMNS).in('id', unique);
  if (error) console.error(`${TAG} people read failed:`, error.message);
  for (const p of (data ?? []) as Record<string, unknown>[]) out.set(p.id as string, toFacts(p));
  return out;
}

const candidateOf = (f: PersonFacts | undefined): RecoveryCandidate | null => (f ? { supervised: f.supervised, departed: f.departed, holds: f.holds } : null);

/** A person by id, @handle or email — the three ways a ticket names someone. */
export async function findPerson(admin: Admin, ref: string): Promise<PersonFacts | null> {
  const r = ref.trim();
  if (!r) return null;
  let q = admin.from('profiles').select(PERSON_COLUMNS);
  if (UUID_RE.test(r)) q = q.eq('id', r.toLowerCase());
  else if (r.includes('@') && !r.startsWith('@')) q = q.ilike('email', r);
  else q = q.ilike('handle', r.replace(/^@/, ''));
  const { data } = await q.limit(2);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.length === 1 ? toFacts(rows[0]) : null;
}

// ── Search ─────────────────────────────────────────────────────────────────

export interface SearchHit {
  subject: 'org' | 'sport_event';
  id: string;
  kind: string;
  name: string;
  detail: string | null;
}

async function orgHitsByIds(admin: Admin, ids: string[]): Promise<SearchHit[]> {
  if (ids.length === 0) return [];
  const { data } = await admin.from('organizations').select('id, kind, name, city').in('id', ids);
  return ((data ?? []) as { id: string; kind: string; name: string; city: string | null }[]).map(o => ({ subject: 'org', id: o.id, kind: o.kind, name: o.name, detail: o.city }));
}

async function eventHitsByIds(admin: Admin, ids: string[]): Promise<SearchHit[]> {
  if (ids.length === 0) return [];
  const { data } = await admin.from('sport_events').select('id, name, status, sport_key').in('id', ids);
  return ((data ?? []) as { id: string; name: string; status: string; sport_key: string }[]).map(e => ({ subject: 'sport_event', id: e.id, kind: e.sport_key, name: e.name, detail: e.status }));
}

async function orgIdsBySlug(admin: Admin, slug: string): Promise<string[]> {
  const { data } = await admin.from('org_sites').select(ORG_ID).ilike('subdomain', slug).limit(1);
  return ((data ?? []) as { org_id: string }[]).map(r => r.org_id);
}

/** Find the org or event a ticket is about: EA-1042, an id, a pasted link, a custom domain, or a name. */
export async function searchRecovery(admin: Admin, raw: string): Promise<{ hits: SearchHit[]; ticketId: string | null }> {
  const q = parseRecoveryQuery(raw);
  switch (q.kind) {
    case 'empty':
      return { hits: [], ticketId: null };
    case 'ticket': {
      const { data } = await admin.from('tickets').select('id, target_type, target_id, description').eq('number', q.number).maybeSingle();
      const t = data as { id: string; target_type: string | null; target_id: string | null; description: string | null } | null;
      if (!t) return { hits: [], ticketId: null };
      if (t.target_id && t.target_type === 'org') return { hits: await orgHitsByIds(admin, [t.target_id]), ticketId: t.id };
      if (t.target_id && t.target_type === 'sport_event') return { hits: await eventHitsByIds(admin, [t.target_id]), ticketId: t.id };
      // A help ticket names the thing in its words — search for a link in them.
      const link = /https?:\/\/\S+/.exec(t.description ?? '')?.[0];
      const inner = link ? await searchRecovery(admin, link) : { hits: [] };
      return { hits: inner.hits, ticketId: t.id };
    }
    case 'id':
      return { hits: [...(await orgHitsByIds(admin, [q.id])), ...(await eventHitsByIds(admin, [q.id]))], ticketId: null };
    case 'org':
      return { hits: await orgHitsByIds(admin, [q.id]), ticketId: null };
    case 'event':
      return { hits: await eventHitsByIds(admin, [q.id]), ticketId: null };
    case 'slug':
      return { hits: await orgHitsByIds(admin, await orgIdsBySlug(admin, q.slug)), ticketId: null };
    case 'domain': {
      const { data } = await admin.from('org_sites').select(ORG_ID).ilike('custom_domain', q.host.replace(/^www\./, '')).limit(1);
      return { hits: await orgHitsByIds(admin, ((data ?? []) as { org_id: string }[]).map(r => r.org_id)), ticketId: null };
    }
    case 'text': {
      const pattern = `%${q.text.replace(/[%_\\]/g, '')}%`;
      const [orgs, events, slugIds] = await Promise.all([
        admin.from('organizations').select('id').ilike('name', pattern).limit(10),
        admin.from('sport_events').select('id').ilike('name', pattern).limit(10),
        /^[a-z0-9-]+$/i.test(q.text) ? orgIdsBySlug(admin, q.text) : Promise.resolve([] as string[]),
      ]);
      const orgIds = [...new Set([...((orgs.data ?? []) as { id: string }[]).map(o => o.id), ...slugIds])];
      return { hits: [...(await orgHitsByIds(admin, orgIds)), ...(await eventHitsByIds(admin, ((events.data ?? []) as { id: string }[]).map(e => e.id)))], ticketId: null };
    }
  }
}

// ── The authority log (the team's full view) ───────────────────────────────

export interface LogEntry {
  id: string;
  action: string;
  actorKind: string;
  actorName: string | null;
  targetName: string | null;
  ticketId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

async function readLog(admin: Admin, subjectType: 'org' | 'sport_event', subjectId: string): Promise<LogEntry[]> {
  const { data, error } = await admin
    .from('authority_audit')
    .select('id, action, actor_kind, actor_profile_id, target_profile_id, ticket_id, detail, created_at')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    if (error.code !== '42P01') console.error(`${TAG} log read failed:`, error.message);
    return [];
  }
  const rows = (data ?? []) as { id: string; action: string; actor_kind: string; actor_profile_id: string | null; target_profile_id: string | null; ticket_id: string | null; detail: Record<string, unknown> | null; created_at: string }[];
  const people = await readPeople(admin, rows.flatMap(r => [r.actor_profile_id, r.target_profile_id]).filter((x): x is string => !!x));
  return rows.map(r => ({
    id: r.id,
    action: r.action,
    actorKind: r.actor_kind,
    actorName: r.actor_profile_id ? people.get(r.actor_profile_id)?.name ?? 'Deleted account' : null,
    targetName: r.target_profile_id ? people.get(r.target_profile_id)?.name ?? 'Deleted account' : null,
    ticketId: r.ticket_id,
    detail: r.detail ?? {},
    createdAt: r.created_at,
  }));
}

async function ticketsAbout(admin: Admin, id: string): Promise<{ id: string; number: string; status: string; type: string }[]> {
  const { data } = await admin.from('tickets').select('id, number, status, type').eq('target_id', id).order('created_at', { ascending: false }).limit(20);
  return ((data ?? []) as { id: string; number: number; status: string; type: string }[]).map(t => ({ id: t.id, number: formatTicketNumber(t.number), status: t.status, type: t.type }));
}

// ── Orgs: the panel read ───────────────────────────────────────────────────

interface OrgRow { id: string; kind: OrgKind; name: string; description: string | null; visibility: string | null; listing_status: string | null; owner_profile_id: string | null }

async function readOrg(admin: Admin, orgId: string): Promise<OrgRow | null> {
  const { data } = await admin.from('organizations').select('id, kind, name, description, visibility, listing_status, owner_profile_id').eq('id', orgId).maybeSingle();
  return (data as OrgRow | null) ?? null;
}

interface SiteState { id: string; subdomain: string; published_at: string | null; held_at: string | null; custom_domain: string | null }

async function readSite(admin: Admin, orgId: string): Promise<SiteState | null> {
  const { data, error } = await admin.from('org_sites').select('id, subdomain, published_at, held_at, custom_domain').eq(ORG_ID, orgId).maybeSingle();
  if (error) {
    if (!['42P01', '42703'].includes(error.code ?? '')) console.error(`${TAG} site read failed:`, error.message);
    return null;
  }
  return (data as SiteState | null) ?? null;
}

interface MembershipRow { id: string; profile_id: string; kind: string; role: string; status: string | null; sections: string[] | null; scope_type: string | null }

async function readAuthorityRows(admin: Admin, orgId: string): Promise<MembershipRow[]> {
  const { data } = await admin
    .from('memberships')
    .select('id, profile_id, kind, role, status, sections, scope_type')
    .eq(ORG_ID, orgId)
    .or('and(kind.eq.follow,role.in.(owner,manager)),kind.eq.staff');
  return (data ?? []) as MembershipRow[];
}

async function followRole(admin: Admin, orgId: string, profileId: string): Promise<'owner' | 'manager' | 'member' | null> {
  const { data } = await admin.from('memberships').select('role').eq(ORG_ID, orgId).eq('profile_id', profileId).eq('kind', 'follow').eq('scope_type', 'org').maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'manager' || role === 'member' ? role : null;
}

export async function readOrgPanel(admin: Admin, orgId: string) {
  const org = await readOrg(admin, orgId);
  if (!org) return null;
  const [rows, site, log, tickets, links] = await Promise.all([
    readAuthorityRows(admin, orgId),
    readSite(admin, orgId),
    readLog(admin, 'org', orgId),
    ticketsAbout(admin, orgId),
    admin.from('org_claim_invites').select('id, expires_at, consumed_at, created_at, purpose').eq(ORG_ID, orgId).eq('purpose', 'recovery').order('created_at', { ascending: false }).limit(10),
  ]);
  const people = await readPeople(admin, rows.map(r => r.profile_id));
  const revisions = site
    ? (((await admin.from('org_site_revisions').select('id, label, created_at, published_at').eq('site_id', site.id).not('published_at', 'is', null).order('created_at', { ascending: false }).limit(30)).data ?? []) as { id: string; label: string | null; created_at: string; published_at: string }[])
    : [];
  return {
    org,
    people: rows.map(r => ({ rowId: r.id, kind: r.kind, role: r.role, status: r.status, sections: r.sections, person: people.get(r.profile_id) ?? null, profileId: r.profile_id })),
    site,
    revisions,
    recoveryLinks: ((links.data ?? []) as { id: string; expires_at: string; consumed_at: string | null; created_at: string }[]),
    log,
    tickets,
  };
}

async function orgRecipients(admin: Admin, orgId: string, exclude: string[] = []): Promise<string[]> {
  const rows = await readAuthorityRows(admin, orgId);
  return rows.filter(r => r.kind === 'follow' && !exclude.includes(r.profile_id)).map(r => r.profile_id);
}

const orgHref = (org: Pick<OrgRow, 'id' | 'kind'>) => `/${org.kind}/${org.id}`;

// ── Orgs: owners and roles ─────────────────────────────────────────────────

async function makeOwner(admin: Admin, org: OrgRow, person: PersonFacts): Promise<Result<{ fromRole: string | null }>> {
  const currentRole = await followRole(admin, org.id, person.id);
  const plan = planAddOwner({ candidate: candidateOf(person), currentRole });
  if (!plan.ok) return plan;
  const ref = { side: org.kind, orgId: org.id };
  if (plan.mode === 'promote') {
    const { updated, error } = await promoteFollowToOwner(admin, ref, person.id);
    if (error || !updated) return { ok: false, status: 409, error: 'The membership changed — reload and try again.' };
  } else {
    const { error } = await insertOwnerRow(admin, ref, person.id);
    if (error) {
      console.error(`${TAG} owner insert failed:`, error.message);
      return { ok: false, status: 409, error: 'Could not add the owner — reload and try again.' };
    }
  }
  const { error: cacheError } = await recomputePrimaryOwner(admin, ref);
  if (cacheError) console.warn(`${TAG} owner cache recompute failed:`, cacheError.message);
  return { ok: true, fromRole: currentRole };
}

export async function addOwner(admin: Admin, ctx: RecoveryContext, orgId: string, personRef: string): Promise<Result> {
  const org = await readOrg(admin, orgId);
  if (!org) return { ok: false, status: 404, error: 'No such organization.' };
  const person = await findPerson(admin, personRef);
  if (!person) return { ok: false, status: 404, error: 'No single account matches that id, handle or email.' };
  const made = await makeOwner(admin, org, person);
  if (!made.ok) return made;
  await audit(admin, ctx, { type: 'org', id: org.id }, 'owner_added', person.id, { from_role: made.fromRole, to_role: 'owner' });
  await ticketAction(admin, ctx, 'owner_added', `${person.name} is now an owner of ${org.name}`);
  await notifyOrgRole(admin, { kind: org.kind, orgId: org.id, orgName: org.name, profileId: person.id, role: 'owner' });
  await bell(admin, await orgRecipients(admin, org.id, [person.id]), `Edge Athlete support added an owner to ${org.name}`, `${person.name} can now run ${org.name}.`, orgHref(org));
  return { ok: true };
}

export async function removeOwner(admin: Admin, ctx: RecoveryContext, orgId: string, profileId: string, replacementRef: string | null): Promise<Result> {
  const org = await readOrg(admin, orgId);
  if (!org) return { ok: false, status: 404, error: 'No such organization.' };
  const ref = { side: org.kind, orgId: org.id };
  const { rows } = await ownerRows(admin, ref);
  const replacement = replacementRef ? await findPerson(admin, replacementRef) : null;
  if (replacementRef && !replacement) return { ok: false, status: 404, error: 'No single account matches the replacement.' };
  const plan = planRemoveOwner({ ownerIds: rows.map(r => r.profile_id), targetId: profileId, replacementId: replacement?.id ?? null });
  if (!plan.ok) return plan;
  // The replacement FIRST — the org is never left without an owner, even for a moment.
  if (replacement && !rows.some(r => r.profile_id === replacement.id)) {
    const added = await addOwner(admin, ctx, org.id, replacement.id);
    if (!added.ok) return added;
  }
  const { error: cacheError } = await recomputePrimaryOwner(admin, ref, { excludeProfileId: profileId });
  if (cacheError) return { ok: false, status: 409, error: 'Could not move the primary owner — nothing was changed.' };
  const { data: demoted, error } = await admin
    .from('memberships')
    .update({ role: 'member' })
    .eq(ORG_ID, org.id).eq('profile_id', profileId).eq('kind', 'follow').eq('scope_type', 'org').eq('role', 'owner')
    .select('id');
  if (error || !demoted || demoted.length === 0) return { ok: false, status: 409, error: 'Ownership changed — reload and try again.' };
  const people = await readPeople(admin, [profileId]);
  const name = people.get(profileId)?.name ?? 'The owner';
  await audit(admin, ctx, { type: 'org', id: org.id }, 'owner_removed', profileId, { from_role: 'owner', to_role: 'member' });
  await ticketAction(admin, ctx, 'owner_removed', `${name} is no longer an owner of ${org.name}`);
  await bell(admin, [profileId], `Your role in ${org.name} changed`, `Edge Athlete support changed your role in ${org.name} to member. Reply on your support request if you think this is wrong.`, orgHref(org));
  await bell(admin, await orgRecipients(admin, org.id, [profileId]), `Edge Athlete support removed an owner from ${org.name}`, `${name} is no longer an owner of ${org.name}.`, orgHref(org));
  return { ok: true };
}

export async function setRole(admin: Admin, ctx: RecoveryContext, orgId: string, profileId: string, to: 'manager' | 'member'): Promise<Result> {
  const org = await readOrg(admin, orgId);
  if (!org) return { ok: false, status: 404, error: 'No such organization.' };
  const [currentRole, people] = await Promise.all([followRole(admin, org.id, profileId), readPeople(admin, [profileId])]);
  const person = people.get(profileId);
  const plan = planSetRole({ currentRole, to, candidate: candidateOf(person) });
  if (!plan.ok) return plan;
  const { error } = await setMemberRole(admin, { side: org.kind, orgId: org.id }, profileId, to);
  if (error) return { ok: false, status: 409, error: 'Could not change the role — reload and try again.' };
  await audit(admin, ctx, { type: 'org', id: org.id }, to === 'manager' ? 'manager_added' : 'manager_removed', profileId, { from_role: currentRole, to_role: to });
  await ticketAction(admin, ctx, to === 'manager' ? 'manager_added' : 'manager_removed', `${person?.name ?? 'Member'} → ${to} in ${org.name}`);
  await notifyOrgRole(admin, { kind: org.kind, orgId: org.id, orgName: org.name, profileId, role: to });
  return { ok: true };
}

export async function revokeStaff(admin: Admin, ctx: RecoveryContext, orgId: string, rowId: string): Promise<Result> {
  const org = await readOrg(admin, orgId);
  if (!org) return { ok: false, status: 404, error: 'No such organization.' };
  const row = await readStaffRow(admin, org.kind, org.id, rowId);
  if (!row) return { ok: false, status: 404, error: 'No such staff grant.' };
  if (!(await deleteStaffRow(admin, rowId))) return { ok: false, status: 409, error: 'Could not revoke the grant.' };
  await writeStaffAudit(admin, {
    side: org.kind, orgId: org.id, profileId: row.profileId, actorId: ctx.actorId, action: 'revoked',
    role: row.role, scopeType: row.scopeType, scopeId: row.scopeId, seasonId: row.seasonId, oldSections: row.sections,
    platformTicketId: ctx.ticketId,
  });
  await ticketAction(admin, ctx, 'staff_revoked', `A staff grant in ${org.name} was revoked`);
  await bell(admin, [row.profileId], `Your staff access to ${org.name} was removed`, `Edge Athlete support removed your staff access to ${org.name}.`, orgHref(org));
  return { ok: true };
}

// ── Orgs: the recovery link ────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A single-use link that ADDS an owner (it removes no one): bound to the
 * email the team verified, carrying the ticket, living a week. The team
 * sends it in their reply — the URL is the guaranteed channel.
 */
export async function mintRecoveryLink(admin: Admin, ctx: RecoveryContext, orgId: string, email: string, origin: string): Promise<Result<{ url: string; expiresAt: string }>> {
  const org = await readOrg(admin, orgId);
  if (!org) return { ok: false, status: 404, error: 'No such organization.' };
  const invitedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(invitedEmail)) return { ok: false, status: 400, error: 'A recovery link is bound to one email address.' };
  const invite = await createOrgClaimInvite(admin, { side: org.kind, orgId: org.id, invitedEmail, createdBy: ctx.actorId, purpose: 'recovery', ticketId: ctx.ticketId });
  if (!invite) return { ok: false, status: 409, error: 'Could not mint the link — is migration 240 live?' };
  await audit(admin, ctx, { type: 'org', id: org.id }, 'recovery_link_minted', null, { invite_id: invite.inviteId, expires_at: invite.expiresAt });
  await ticketAction(admin, ctx, 'recovery_link_minted', `A recovery link for ${org.name} (expires ${invite.expiresAt.slice(0, 10)})`);
  return { ok: true, url: `${origin}/org-claim/${invite.rawToken}`, expiresAt: invite.expiresAt };
}

/**
 * Redeem a recovery link (the org-claim route's recovery branch). The
 * handover branch needs an ownerless org; a recovery link never does — it
 * adds the redeemer as an owner beside whoever is there. The redeemer must
 * be signed in with the email the link was sent to, and be able to run an
 * org at all. A lost race or failed write restores the token.
 */
export async function redeemRecoveryLink(admin: Admin, token: string, user: User): Promise<Result<{ side: OrgKind; orgId: string }>> {
  const peeked = await peekOrgClaimInvite(admin, token);
  if (!peeked || peeked.purpose !== 'recovery') return { ok: false, status: 404, error: 'This link has expired or was already used.' };
  if (!peeked.invitedEmail || (user.email ?? '').toLowerCase() !== peeked.invitedEmail.toLowerCase()) {
    return { ok: false, status: 409, error: 'This link was sent to a different email address. Sign in with that account.' };
  }
  const people = await readPeople(admin, [user.id]);
  const person = people.get(user.id);
  const org = await readOrg(admin, peeked.org.id);
  if (!person || !org) return { ok: false, status: 404, error: 'This link has expired or was already used.' };
  const currentRole = await followRole(admin, org.id, user.id);
  const plan = planAddOwner({ candidate: candidateOf(person), currentRole });
  if (!plan.ok) return plan;
  const redeemed = await redeemOrgClaimInvite(admin, token, user.id);
  if (!redeemed) return { ok: false, status: 404, error: 'This link has expired or was already used.' };
  const made = await makeOwner(admin, org, person);
  if (!made.ok) {
    await restoreOrgClaimInvite(admin, token);
    return made;
  }
  await recordAuthority(admin, {
    subject: { type: 'org', id: org.id },
    actor: { kind: 'member', profileId: user.id },
    action: 'recovery_link_redeemed',
    targetProfileId: user.id,
    ticketId: peeked.ticketId,
    detail: { invite_id: peeked.inviteId, from_role: currentRole, to_role: 'owner' },
  });
  await bell(admin, await orgRecipients(admin, org.id, [user.id]), `A new owner joined ${org.name}`, `${person.name} is now an owner of ${org.name}, through a recovery link from Edge Athlete support.`, orgHref(org));
  return { ok: true, side: org.kind, orgId: org.id };
}

// ── Orgs: the site ─────────────────────────────────────────────────────────

function purgeSite(subdomain: string): void {
  revalidateTag(`org-site:${subdomain}`, { expire: 0 });
  revalidateTag('org-sitemap', { expire: 0 });
}

export type SiteAction =
  | { action: 'hold' }
  | { action: 'release' }
  | { action: 'delist' }
  | { action: 'restore_revision'; revisionId: string }
  | { action: 'restore_identity'; auditId: string };

export async function siteAction(admin: Admin, ctx: RecoveryContext, orgId: string, input: SiteAction): Promise<Result> {
  const org = await readOrg(admin, orgId);
  if (!org) return { ok: false, status: 404, error: 'No such organization.' };
  const managers = () => orgRecipients(admin, org.id);

  if (input.action === 'delist') {
    const applied = await applyListing(admin, { side: org.kind, orgId: org.id, orgName: org.name, actorId: ctx.actorId, target: 'unlisted' });
    // applyListing answers a NextResponse on failure (a Response has its own `ok`, so test the class).
    if (applied instanceof NextResponse) return { ok: false, status: 409, error: 'Could not delist it.' };
    await audit(admin, ctx, { type: 'org', id: org.id }, 'listing_changed', null, { listing: 'unlisted' });
    await ticketAction(admin, ctx, 'delisted', `${org.name} was taken out of the directory`);
    await bell(admin, await managers(), `${org.name} was taken out of the directory`, `Edge Athlete support removed ${org.name} from the directory and search. People with the link can still reach it.`, orgHref(org));
    return { ok: true };
  }

  if (input.action === 'restore_identity') {
    const { data } = await admin.from('authority_audit').select('id, action, subject_type, subject_id, detail').eq('id', input.auditId).maybeSingle();
    const row = data as { action: string; subject_type: string; subject_id: string; detail: Record<string, unknown> } | null;
    if (!row || row.subject_type !== 'org' || row.subject_id !== org.id || row.action !== 'identity_changed') return { ok: false, status: 404, error: 'No such change to undo.' };
    const { patch, skipped } = identityRestorePatch(row.detail);
    const fields = Object.keys(patch);
    if (fields.length === 0) return { ok: false, status: 409, error: 'Nothing in that change can be restored automatically.' };
    const before = Object.fromEntries(fields.map(f => [f, (org as unknown as Record<string, unknown>)[f] ?? null]));
    const { error } = await admin.from('organizations').update(patch).eq('id', org.id);
    if (error) return { ok: false, status: 409, error: 'Could not restore it.' };
    await audit(admin, ctx, { type: 'org', id: org.id }, 'identity_changed', null, { fields, before, after: patch, via: 'restore' });
    await ticketAction(admin, ctx, 'identity_restored', `Restored ${fields.join(', ')}${skipped.length ? ` (not ${skipped.join(', ')})` : ''}`);
    await revalidateOrgSiteForOrg(admin, org.kind, org.id);
    await bell(admin, await managers(), `Edge Athlete support restored ${org.name}'s details`, `The ${fields.join(', ')} of ${org.name} were put back to an earlier version.`, orgHref(org));
    return { ok: true };
  }

  const site = await readSite(admin, org.id);
  if (!site) return { ok: false, status: 404, error: 'This organization has no site.' };

  if (input.action === 'hold') {
    if (site.held_at) return { ok: false, status: 409, error: 'The site is already paused.' };
    const { error } = await admin.from('org_sites').update({ held_at: new Date().toISOString(), held_ticket_id: ctx.ticketId, published_at: null }).eq('id', site.id).is('held_at', null);
    if (error) return { ok: false, status: 409, error: 'Could not pause the site — is migration 240 live?' };
    purgeSite(site.subdomain);
    await audit(admin, ctx, { type: 'org', id: org.id }, 'site_held', null, { subdomain: site.subdomain, status: site.published_at ? 'was_live' : 'was_offline' });
    await ticketAction(admin, ctx, 'site_held', `${site.subdomain} is paused`);
    await bell(admin, await managers(), `${org.name}'s website is paused`, `Edge Athlete support took the ${org.name} website offline while a report is reviewed. It cannot go live until support releases it.`, orgHref(org));
    return { ok: true };
  }

  if (input.action === 'release') {
    if (!site.held_at) return { ok: false, status: 409, error: 'The site is not paused.' };
    const { error } = await admin.from('org_sites').update({ held_at: null, held_ticket_id: null }).eq('id', site.id);
    if (error) return { ok: false, status: 409, error: 'Could not release the site.' };
    await audit(admin, ctx, { type: 'org', id: org.id }, 'site_released', null, { subdomain: site.subdomain });
    await ticketAction(admin, ctx, 'site_released', `${site.subdomain} is released (still offline until an owner takes it live)`);
    await bell(admin, await managers(), `${org.name}'s website is released`, `Edge Athlete support released the ${org.name} website. An owner or manager can take it live again.`, orgHref(org));
    return { ok: true };
  }

  // restore_revision: the old version becomes the draft, then publishes — WITHOUT pruning the history.
  const { site: pointers, support } = await loadSitePointers(admin, org.kind, org.id);
  if (!pointers || support !== 'supported') return { ok: false, status: 409, error: 'This site has no history to restore from.' };
  const restored = await restoreRevision(admin, pointers, ctx.actorId, input.revisionId);
  if (restored === 'not_found') return { ok: false, status: 404, error: 'No such version of this site.' };
  if (restored !== 'ok') return { ok: false, status: 409, error: 'The draft changed while restoring — try again.' };
  const { site: fresh } = await loadSitePointers(admin, org.kind, org.id);
  if (!fresh) return { ok: false, status: 409, error: 'The site changed — reload and try again.' };
  const published = await publishDraft(admin, fresh, ctx.actorId, `Restored by support ${ctx.ticketLabel}`, { prune: false });
  if (published.status !== 'published' && published.status !== 'materialised' && published.status !== 'noop') {
    return { ok: false, status: 409, error: 'The version was restored to the draft but did not publish — try again.' };
  }
  await audit(admin, ctx, { type: 'org', id: org.id }, 'revision_restored', null, { revision_id: input.revisionId, label: `Restored by support ${ctx.ticketLabel}` });
  await ticketAction(admin, ctx, 'revision_restored', `${site.subdomain} restored to an earlier version`);
  await bell(admin, await managers(), `${org.name}'s website was restored`, `Edge Athlete support put the ${org.name} website back to an earlier version. It is in the site's history.`, orgHref(org));
  return { ok: true };
}

// ── Events ─────────────────────────────────────────────────────────────────

interface EventRow { id: string; name: string; status: EventStatus; host_profile_id: string; visibility: string; sport_key: string; org_id: string | null }
interface EventPerson { id: string; profile_id: string; role: string; status: string; playing: boolean }

async function readEvent(admin: Admin, eventId: string): Promise<EventRow | null> {
  const { data } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  return (data as unknown as EventRow | null) ?? null;
}

async function eventOrganizers(admin: Admin, eventId: string): Promise<EventPerson[]> {
  const { data } = await admin.from('sport_event_participants').select('id, profile_id, role, status, playing').eq('sport_event_id', eventId).in('role', ['organizer', 'co_organizer']);
  return (data ?? []) as EventPerson[];
}

export async function readEventPanel(admin: Admin, eventId: string) {
  const event = await readEvent(admin, eventId);
  if (!event) return null;
  const [rows, log, tickets, count] = await Promise.all([
    eventOrganizers(admin, eventId),
    readLog(admin, 'sport_event', eventId),
    ticketsAbout(admin, eventId),
    admin.from('sport_event_participants').select('id', { count: 'exact', head: true }).eq('sport_event_id', eventId).eq('status', 'accepted'),
  ]);
  const people = await readPeople(admin, [event.host_profile_id, ...rows.map(r => r.profile_id)]);
  return {
    event: { id: event.id, name: event.name, status: event.status, visibility: event.visibility, sport_key: event.sport_key, org_id: event.org_id, host: people.get(event.host_profile_id) ?? null, hostProfileId: event.host_profile_id },
    organizers: rows.filter(r => r.status === 'accepted' || r.status === 'invited').map(r => ({ participantId: r.id, role: r.role, status: r.status, playing: r.playing, person: people.get(r.profile_id) ?? null, profileId: r.profile_id })),
    acceptedCount: count.count ?? 0,
    log,
    tickets,
  };
}

async function eventRecipients(admin: Admin, event: EventRow, exclude: string[] = []): Promise<string[]> {
  const rows = await eventOrganizers(admin, event.id);
  return [event.host_profile_id, ...rows.filter(r => r.status === 'accepted').map(r => r.profile_id)].filter(id => !exclude.includes(id));
}

const eventHref = (id: string) => `/events/${id}`;

/**
 * Re-host: someone the team verified takes the event over. A non-participant
 * joins first as an accepted, NON-playing co-organizer (they take no seat);
 * the old host stays as a plain participant unless kept as a co-organizer.
 */
export async function eventHost(admin: Admin, ctx: RecoveryContext, eventId: string, personRef: string, keepOldHostAsCoOrganizer: boolean): Promise<Result> {
  const event = await readEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const person = await findPerson(admin, personRef);
  if (!person) return { ok: false, status: 404, error: 'No single account matches that id, handle or email.' };
  const plan = planEventHost({ eventStatus: event.status, currentHostId: event.host_profile_id, targetId: person.id, candidate: { supervised: person.supervised, departed: person.departed, holds: person.holds } });
  if (!plan.ok) return plan;

  const now = new Date().toISOString();
  const { data: existing } = await admin.from('sport_event_participants').select('id, status').eq('sport_event_id', event.id).eq('profile_id', person.id).maybeSingle();
  const row = existing as { id: string; status: string } | null;
  if (!row) {
    const { error } = await admin.from('sport_event_participants').insert({ sport_event_id: event.id, profile_id: person.id, role: 'co_organizer', status: 'accepted', playing: false, invited_by: null, accepted_at: now, responded_at: now });
    if (error) return { ok: false, status: 409, error: 'Could not add them to the event — reload and try again.' };
  } else if (row.status !== 'accepted') {
    const { error } = await admin.from('sport_event_participants').update({ role: 'co_organizer', status: 'accepted', playing: false, waitlist_position: null, accepted_at: now, responded_at: now, updated_at: now }).eq('id', row.id);
    if (error) return { ok: false, status: 409, error: 'Could not add them to the event — reload and try again.' };
  }
  const oldHost = event.host_profile_id;
  const moved = await transferHost(admin as SupabaseClient, {
    eventId: event.id,
    fromProfileId: oldHost,
    toProfileId: person.id,
    actor: { kind: 'platform', profileId: ctx.actorId },
    ticketId: ctx.ticketId,
    oldHostRole: keepOldHostAsCoOrganizer ? 'co_organizer' : 'participant',
    reason: ctx.note ?? undefined,
  });
  if (!moved.ok) return { ok: false, status: moved.status === 500 ? 409 : moved.status, error: moved.error };
  await ticketAction(admin, ctx, 'host_transferred', `${person.name} now hosts ${event.name}`);
  await bell(admin, [person.id], `You now host ${event.name}`, `Edge Athlete support made you the host of ${event.name}.`, eventHref(event.id));
  await bell(admin, [oldHost], `${event.name} has a new host`, `Edge Athlete support handed ${event.name} to ${person.name}. Reply on your support request if you think this is wrong.`, eventHref(event.id));
  return { ok: true };
}

/** Take away a co-organizer's authority: they stay in the event as a participant. */
export async function removeCoOrganizer(admin: Admin, ctx: RecoveryContext, eventId: string, participantId: string): Promise<Result> {
  const event = await readEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const { data } = await admin.from('sport_event_participants').update({ role: 'participant', updated_at: new Date().toISOString() }).eq('id', participantId).eq('sport_event_id', event.id).eq('role', 'co_organizer').select('profile_id');
  const row = ((data ?? []) as { profile_id: string }[])[0];
  if (!row) return { ok: false, status: 404, error: 'That person is not a co-organizer.' };
  await audit(admin, ctx, { type: 'sport_event', id: event.id }, 'co_organizer_removed', row.profile_id, { participant_id: participantId, to_role: 'participant' });
  await ticketAction(admin, ctx, 'co_organizer_removed', `A co-organizer of ${event.name} is now a participant`);
  await bell(admin, [row.profile_id], `Your role in ${event.name} changed`, `Edge Athlete support removed your co-organizer role in ${event.name}. You are still in the event.`, eventHref(event.id));
  return { ok: true };
}

export async function cancelEvent(admin: Admin, ctx: RecoveryContext, eventId: string): Promise<Result> {
  const event = await readEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const plan = planEventCancel(event.status);
  if (!plan.ok) return plan;
  const recipients = await eventRecipients(admin, event);
  const done = await applyTransition(admin, { eventId: event.id, to: 'cancelled', actorProfileId: ctx.actorId, platformTicketId: ctx.ticketId });
  if (!done.ok) return { ok: false, status: done.status === 500 ? 409 : done.status, error: done.error };
  await ticketAction(admin, ctx, 'event_cancelled', `${event.name} was cancelled`);
  await bell(admin, recipients, `${event.name} was cancelled`, `Edge Athlete support cancelled ${event.name}.`, eventHref(event.id));
  return { ok: true };
}

/** A live event is never cancelled; the team can take it out of public view instead. */
export async function makeEventPrivate(admin: Admin, ctx: RecoveryContext, eventId: string): Promise<Result> {
  const event = await readEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  if (event.visibility === 'private') return { ok: false, status: 409, error: 'The event is already private.' };
  const { error } = await admin.from('sport_events').update({ visibility: 'private' }).eq('id', event.id);
  if (error) return { ok: false, status: 409, error: 'Could not change it.' };
  await audit(admin, ctx, { type: 'sport_event', id: event.id }, 'event_details_changed', null, { fields: ['visibility'], before: { visibility: event.visibility }, after: { visibility: 'private' } });
  await ticketAction(admin, ctx, 'event_made_private', `${event.name} is now private`);
  await bell(admin, await eventRecipients(admin, event), `${event.name} is now private`, `Edge Athlete support made ${event.name} private while a report is reviewed.`, eventHref(event.id));
  return { ok: true };
}

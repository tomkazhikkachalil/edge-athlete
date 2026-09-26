// ── Recovery — the pure rules (Authority PR 4, Sep 25 2026) ────────────────
// Tom: "Even if there isn't a contact, we need a way to recover and for users
// to manage the site if something were to happen or if someone is being
// malicious." Recovery is decided by the Edge Athlete team on a support
// ticket; these are the rules its tools apply, pinned in
// __tests__/authority-recovery.test.ts. Zero server imports.
import type { OrgKind } from '@/lib/orgs/org-ref';

export const RECOVERY_NOTE_MAX = 500;

/** What the team knows about the person it is about to give authority to. */
export interface RecoveryCandidate {
  supervised: boolean;
  departed: boolean;
  /** holdsAuthority — not limited, suspended or banned. */
  holds: boolean;
}

export type Refusal = { ok: false; status: 400 | 404 | 409; error: string };

function refuse(status: Refusal['status'], error: string): Refusal {
  return { ok: false, status, error };
}

/** Can this person be given the running of something at all? */
export function candidateRefusal(c: RecoveryCandidate | null): Refusal | null {
  if (!c) return refuse(404, 'No such person.');
  if (c.departed) return refuse(409, 'That account has been deleted.');
  if (c.supervised) return refuse(409, 'A supervised athlete cannot run an organization.');
  if (!c.holds) return refuse(409, 'That account is limited, suspended or banned — lift that first.');
  return null;
}

/** Add an owner: promote an existing member / manager row, or add a fresh owner row. */
export function planAddOwner(input: {
  candidate: RecoveryCandidate | null;
  /** The person's follow row's role in this org, if any. */
  currentRole: 'owner' | 'manager' | 'member' | null;
}): { ok: true; mode: 'promote' | 'insert' } | Refusal {
  const r = candidateRefusal(input.candidate);
  if (r) return r;
  if (input.currentRole === 'owner') return refuse(409, 'Already an owner.');
  return { ok: true, mode: input.currentRole ? 'promote' : 'insert' };
}

/**
 * Remove an owner: they become a plain MEMBER (never a manager — the reason
 * the team is removing them may be the misuse). The last owner goes only with
 * a replacement named in the same act, so an org is never left ownerless by
 * the team's own hand.
 */
export function planRemoveOwner(input: {
  ownerIds: readonly string[];
  targetId: string;
  replacementId: string | null;
}): { ok: true } | Refusal {
  if (!input.ownerIds.includes(input.targetId)) return refuse(404, 'That person is not an owner.');
  if (input.replacementId === input.targetId) return refuse(400, 'The replacement cannot be the owner being removed.');
  const remaining = input.ownerIds.filter(id => id !== input.targetId);
  if (remaining.length === 0 && !input.replacementId) {
    return refuse(409, 'This is the last owner — name a replacement owner in the same step.');
  }
  return { ok: true };
}

/** Manager ↔ member. Owners change through the owner tools, never here. */
export function planSetRole(input: {
  currentRole: 'owner' | 'manager' | 'member' | null;
  to: 'manager' | 'member';
  candidate: RecoveryCandidate | null;
}): { ok: true } | Refusal {
  if (!input.currentRole) return refuse(404, 'That person is not a member.');
  if (input.currentRole === 'owner') return refuse(409, 'Use the owner tools to change an owner.');
  if (input.currentRole === input.to) return refuse(409, `Already a ${input.to}.`);
  if (input.to === 'manager') {
    const r = candidateRefusal(input.candidate);
    if (r) return r;
  }
  return { ok: true };
}

export type EventStatus = 'draft' | 'open' | 'live' | 'completed' | 'cancelled';

/** Re-host an event. A supervised profile MAY host (convention 17). */
export function planEventHost(input: {
  eventStatus: EventStatus;
  currentHostId: string;
  targetId: string;
  candidate: RecoveryCandidate | null;
}): { ok: true } | Refusal {
  if (input.eventStatus === 'cancelled') return refuse(409, 'The event is cancelled.');
  if (input.targetId === input.currentHostId) return refuse(409, 'That person is already the host.');
  const c = input.candidate;
  if (!c) return refuse(404, 'No such person.');
  if (c.departed) return refuse(409, 'That account has been deleted.');
  if (!c.holds) return refuse(409, 'That account is limited, suspended or banned — lift that first.');
  return { ok: true };
}

/**
 * Cancel: only before it starts. A live event is never cancelled (the
 * lifecycle's rule) — the team makes it private or re-hosts it instead.
 */
export function planEventCancel(status: EventStatus): { ok: true } | Refusal {
  if (status === 'draft' || status === 'open') return { ok: true };
  if (status === 'live') return refuse(409, 'A live event cannot be cancelled — make it private or re-host it.');
  return refuse(409, status === 'cancelled' ? 'The event is already cancelled.' : 'The event is finished.');
}

// ── Restoring a vandalised identity ────────────────────────────────────────

/** The org columns an identity restore may write (the PATCH's identity fields). */
export const RESTORABLE_IDENTITY_FIELDS = ['name', 'description', 'city', 'region', 'country', 'visibility', 'join_policy'] as const;

/**
 * The patch that puts an `identity_changed` row's BEFORE values back. The
 * audit detail caps strings at 200 characters (an ellipsis marks a cut), so a
 * truncated value is never written back — it is reported as skipped.
 */
export function identityRestorePatch(detail: Record<string, unknown> | null | undefined): { patch: Record<string, string | null>; skipped: string[] } {
  const before = detail && typeof detail.before === 'object' && detail.before !== null ? (detail.before as Record<string, unknown>) : {};
  const patch: Record<string, string | null> = {};
  const skipped: string[] = [];
  for (const [field, value] of Object.entries(before)) {
    if (!(RESTORABLE_IDENTITY_FIELDS as readonly string[]).includes(field)) { skipped.push(field); continue; }
    if (value === null) { if (field !== 'name') patch[field] = null; else skipped.push(field); continue; }
    if (typeof value !== 'string') { skipped.push(field); continue; }
    if (value.length > 200) { skipped.push(field); continue; }
    if (field === 'name' && value.trim().length === 0) { skipped.push(field); continue; }
    patch[field] = value;
  }
  return { patch, skipped };
}

// ── Finding the thing ───────────────────────────────────────────────────────

export type RecoveryQuery =
  | { kind: 'ticket'; number: number }
  | { kind: 'id'; id: string }
  | { kind: 'org'; side: OrgKind; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'slug'; slug: string }
  | { kind: 'domain'; host: string }
  | { kind: 'text'; text: string }
  | { kind: 'empty' };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/i;

/** Hosts that are the app itself — anything else in a pasted URL is a custom domain. */
function isAppHost(host: string, appHosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h.endsWith('.vercel.app') || appHosts.some(a => h === a || h === `www.${a}`);
}

/**
 * What the team (or a person asking for recovery) typed: a ticket number
 * (EA-1042), an id, a pasted link to a club / league / event / org site
 * (the vanity path too), a custom domain, or a name.
 */
export function parseRecoveryQuery(raw: string, appHosts: readonly string[] = ['edgeathlete.com', 'edge-athlete.com']): RecoveryQuery {
  const q = raw.trim();
  if (!q) return { kind: 'empty' };
  const ticket = /^EA-?(\d{3,9})$/i.exec(q);
  if (ticket) return { kind: 'ticket', number: Number(ticket[1]) };
  if (/^[0-9a-f-]{36}$/i.test(q) && UUID.test(q)) return { kind: 'id', id: q.toLowerCase() };

  let url: URL | null = null;
  if (/^https?:\/\//i.test(q)) {
    try { url = new URL(q); } catch { url = null; }
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(q) && !/\s/.test(q)) {
    try { url = new URL(`https://${q}`); } catch { url = null; }
  }
  if (url) {
    if (!isAppHost(url.hostname, appHosts)) return { kind: 'domain', host: url.hostname.toLowerCase() };
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts.find(p => UUID.test(p))?.toLowerCase();
    // /club/<id>, /league/<id>, /app/org/<kind>/<id>(/…), /club/<id>/standings …
    const kindAt = parts.findIndex(p => p === 'club' || p === 'league');
    if (kindAt >= 0 && id) return { kind: 'org', side: parts[kindAt] as OrgKind, id };
    if (parts[0] === 'events' && id) return { kind: 'event', id };
    if (parts[0] === 'org' && parts[1] && SLUG.test(parts[1])) return { kind: 'slug', slug: parts[1].toLowerCase() };
    if (parts.length >= 1 && SLUG.test(parts[0]) && !id) return { kind: 'slug', slug: parts[0].toLowerCase() };
    if (id) return { kind: 'id', id };
    return { kind: 'text', text: q };
  }
  if (q.startsWith('/')) return parseRecoveryQuery(`https://${appHosts[0]}${q}`, appHosts);
  return { kind: 'text', text: q };
}

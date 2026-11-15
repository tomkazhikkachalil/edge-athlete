/**
 * Unclaimed profiles (Sprint 4 PR 6b, migration 312) — the pure rules. No
 * imports. Tom, Nov 15 2026: a player a club has tagged who has not claimed
 * their profile has a public page marked "Unclaimed", and claiming is a
 * request the person starts from it.
 *
 * A placeholder is a roster stub: its email is on the reserved stub domain
 * (stubs-config.ts — `@stubs.invalid ⇔ unclaimed`). Its page is OPEN unless
 * the account is gone or the organization keeps it private. What is open is
 * the SPORT profile only — film stats and clips — under a short name; no
 * posts, no follow, no messages, no search listing: the profile itself stays
 * private.
 */
const STUB_DOMAIN = '@stubs.invalid';

export interface UnclaimedFacts { email: string | null; departed_at: string | null }

/** Is this profile a placeholder nobody has claimed? */
export function isUnclaimed(p: UnclaimedFacts | null | undefined): boolean {
  return !!p && !p.departed_at && !!p.email && p.email.toLowerCase().endsWith(STUB_DOMAIN);
}

/** Is its page open to a signed-in visitor? (`keptPrivate`: the organization's switch.) */
export function unclaimedOpen(p: UnclaimedFacts | null | undefined, keptPrivate: boolean): boolean {
  return isUnclaimed(p) && !keptPrivate;
}

/** The name an unclaimed page shows: "Sam K." — a first name and an initial, never the full name (many of these players are minors). */
export function unclaimedName(p: { first_name?: string | null; last_name?: string | null; full_name?: string | null; display_name?: string | null }): string {
  const whole = (p.full_name || p.display_name || '').trim();
  const first = (p.first_name || whole.split(/\s+/)[0] || '').trim();
  const last = (p.last_name || whole.split(/\s+/).slice(1).join(' ') || '').trim();
  if (!first) return 'Player';
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

export type ClaimRequestStatus = 'pending' | 'approved' | 'declined';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH …/claim-request/[id] {action}. */
export function parseDecision(body: unknown): { ok: true; action: 'approve' | 'decline' } | { ok: false; error: string } {
  const a = (body as { action?: unknown } | null)?.action;
  return a === 'approve' || a === 'decline' ? { ok: true, action: a } : { ok: false, error: 'Say whether to approve or decline' };
}

/** PATCH …/unclaimed {listed}. */
export function parseListed(body: unknown): { ok: true; listed: boolean } | { ok: false; error: string } {
  const v = (body as { listed?: unknown } | null)?.listed;
  return typeof v === 'boolean' ? { ok: true, listed: v } : { ok: false, error: 'Say whether the page is open' };
}

/** `?for=<profile id>`: who the film goes to when a guardian asks for a child — or null (the person asking). A malformed id is refused, never guessed. */
export function parseFor(raw: string | null): { ok: true; forId: string | null } | { ok: false; error: string } {
  if (raw === null || raw === '') return { ok: true, forId: null };
  return UUID.test(raw) ? { ok: true, forId: raw.toLowerCase() } : { ok: false, error: 'That is not a profile' };
}

/** What the page says about a request, to the person who made it. */
export const REQUEST_COPY: Readonly<Record<ClaimRequestStatus, string>> = {
  pending: 'Your request is with the organization that tagged these games. You will be told when they answer.',
  approved: 'Approved — the clips and stats from these games are on your own profile now.',
  declined: 'The organization did not approve this request.',
};

export const UNCLAIMED_COPY = {
  mark: 'Unclaimed',
  intro: 'This player was tagged by their club or league and has not joined Edge Athlete yet. The stats and clips here come from those games.',
  ask: 'This is me — request this profile',
  askFor: (name: string) => `This is ${name} — request this profile`,
  whatHappens: 'The organization that tagged these games decides. If they approve, the clips and stats from their games move to your own profile. The roster spot stays with the organization.',
  keptPrivate: 'This page is private: only your organization\'s managers see it.',
} as const;

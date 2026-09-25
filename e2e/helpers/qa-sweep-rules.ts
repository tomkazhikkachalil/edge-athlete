// ── The QA sweep's rules — PURE, node-tested, the one place they live ────────
// Every disposable thing the e2e suite mints is recognisable by shape, and a
// run that dies before its `finally` leaves them behind. These predicates say
// what the sweep may take; `scripts/staging-sweep.mjs` mirrors the org rule
// as SQL and `src/lib/__tests__/qa-sweep-rules.test.ts` pins both spellings.
//
// Tom's rule for orgs (Sep 24 2026, applies on PROD probes too): a name in the
// QA shape (`QA <words> <13-digit epoch>` — every spec names its orgs
// `QA Something ${Date.now()}`), older than the cutoff, AND an owner that is
// null or itself a stale QA user. A real org never matches all three.

/** 24 hours: a run in flight is never swept by a concurrent one. */
export const SWEEP_CUTOFF_MS = 24 * 60 * 60 * 1000;

/** The e2e users: `edgeqa-<rand>@example.com` (createQaUser). */
export const QA_USER_EMAIL_RE = /^edgeqa-[a-z0-9]+@example\.com$/;
/** Roster stubs (`<uuid>@stubs.invalid`) and supervised minors
 *  (`<uuid>@minors.invalid`, `pending-<hex>@minors.invalid`) — shadow auth
 *  users the flows mint; QA runs leave them behind with their guardians. */
export const SHADOW_EMAIL_RE = /@(stubs|minors)\.invalid$/;
/** `QA <anything> <Date.now()>` — 13 digits is the epoch-milliseconds width until 2286. */
export const QA_ORG_NAME_RE = /^QA .* \d{13}$/;
/** The SQL twin of QA_ORG_NAME_RE, for the bulk script (POSIX regex). */
export const QA_ORG_NAME_SQL = '^QA .* [0-9]{13}$';

export function isQaUserEmail(email: string | null | undefined): boolean {
  return !!email && QA_USER_EMAIL_RE.test(email);
}
export function isShadowEmail(email: string | null | undefined): boolean {
  return !!email && SHADOW_EMAIL_RE.test(email);
}
export function isQaOrgName(name: string | null | undefined): boolean {
  return !!name && QA_ORG_NAME_RE.test(name);
}
export function isStale(createdAt: string | Date, cutoffMs: number): boolean {
  return new Date(createdAt).getTime() <= cutoffMs;
}

export interface OrgRow { id: string; name: string; created_at: string; owner_profile_id: string | null }

/** The orgs the sweep may take: QA-shaped name, older than the cutoff, and an
 *  owner that is null or in the stale QA user set. */
export function staleQaOrgs(rows: OrgRow[], cutoffMs: number, staleUserIds: ReadonlySet<string>): OrgRow[] {
  return rows.filter(o => isQaOrgName(o.name) && isStale(o.created_at, cutoffMs)
    && (o.owner_profile_id === null || staleUserIds.has(o.owner_profile_id)));
}

export interface ShadowRow { id: string; email: string; created_at: string }
export interface AccessRow { profile_id: string; user_id: string }

/** The shadow users the sweep may take: older than the cutoff, and NO access
 *  row held by a live holder — a holder is live unless it is a stale QA user,
 *  another shadow candidate, or the shadow itself (a stub's own row). */
export function staleShadows(
  shadows: ShadowRow[],
  access: AccessRow[],
  cutoffMs: number,
  staleUserIds: ReadonlySet<string>
): ShadowRow[] {
  const candidates = new Set(shadows.filter(s => isShadowEmail(s.email) && isStale(s.created_at, cutoffMs)).map(s => s.id));
  const liveHolders = new Set<string>();
  for (const a of access) {
    if (!candidates.has(a.profile_id)) continue;
    const holderIsQa = staleUserIds.has(a.user_id) || candidates.has(a.user_id) || a.user_id === a.profile_id;
    if (!holderIsQa) liveHolders.add(a.profile_id);
  }
  return shadows.filter(s => candidates.has(s.id) && !liveHolders.has(s.id));
}

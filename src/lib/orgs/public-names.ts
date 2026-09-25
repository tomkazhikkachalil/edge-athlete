// ── Public display names — the crawlable-page masking rule ──────────────────
// Extracted from public-standings.ts (the phase-2 stage-gate fix) so every
// public org-site surface applies the SAME rule. A full name appears on a
// crawlable page ONLY for a claimed, UNSUPERVISED profile that chose
// visibility='public'; everyone else renders "First L.".
//
// The supervision check is phase 4 R4, closing a measured gap: a guardian
// flipping a supervised minor's profile public used to publish the full
// name on crawlable org pages. Supervision — not age math — is the
// boundary on purpose: it is the platform's operational minor state
// (minors are supervised from signup), needs no timezone-safe date
// arithmetic on public pages, and a self-managed athlete who set
// themselves public made their own call. The field is REQUIRED on
// MaskableProfile so the compiler forces every caller to select it —
// an optional field would let a new caller silently skip the check.
//
// Pure and node-testable; callers select email/supervision_state ONLY to
// feed this function and must never let them leave their return types.
//
// Departed accounts (migration 238, Sep 24 2026): a DEPARTED profile is a
// name-only tombstone that keeps a person's results after they left. Tom's
// rule is the FULL name on those results, "the way a printed results sheet
// would", so a departed row answers its full name here — never "First L." —
// while `isPublicProfile` answers false for it (no link, no player page, no
// recruiting: there is no person behind it any more). `departed_at` is
// REQUIRED for the same reason `supervision_state` is: the compiler names
// every reader that forgot to select it.

import { isStubEmail } from '@/lib/config/stubs-config';

export interface MaskableProfile {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  visibility: string | null;
  email: string | null;
  supervision_state: string | null;
  /** 238: set on a departed tombstone (src/lib/account-departure.ts). */
  departed_at: string | null;
}

/** 238: THE departed predicate — a tombstone that outlives its person. */
export function isDeparted(p: { departed_at?: string | null }): boolean {
  return typeof p.departed_at === 'string' && p.departed_at.length > 0;
}

/** Phase 8 P2 — THE public-profile predicate: a claimed, UNSUPERVISED
 *  profile that chose visibility='public'. The one gate for a player page
 *  or a linked name on an org site (Tom: public profiles only). */
export function isPublicProfile(p: MaskableProfile): boolean {
  return p.visibility === 'public' && !isStubEmail(p.email) && p.supervision_state !== 'supervised' && !isDeparted(p);
}

/** The handle a public surface may link to — only for a public profile
 *  with a handle; null for everyone else (masked names never link). */
export function publicHandle(p: MaskableProfile & { handle?: string | null }): string | null {
  return isPublicProfile(p) && typeof p.handle === 'string' && p.handle ? p.handle : null;
}

export function publicDisplayName(p: MaskableProfile): string {
  // A departed tombstone shows its full name (a masked minor's row already
  // carries "Athlete" — the engine renamed it).
  if (isDeparted(p)) return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete';
  const first = p.first_name || p.full_name?.split(' ')[0] || 'Athlete';
  const last = p.last_name || '';
  const isPublic = isPublicProfile(p);
  return isPublic
    ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete'
    : `${first}${last ? ` ${last[0]}.` : ''}`;
}

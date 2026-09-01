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

import { isStubEmail } from '@/lib/config/stubs-config';

export interface MaskableProfile {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  visibility: string | null;
  email: string | null;
  supervision_state: string | null;
}

export function publicDisplayName(p: MaskableProfile): string {
  const first = p.first_name || p.full_name?.split(' ')[0] || 'Athlete';
  const last = p.last_name || '';
  const isPublic =
    p.visibility === 'public' && !isStubEmail(p.email) && p.supervision_state !== 'supervised';
  return isPublic
    ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete'
    : `${first}${last ? ` ${last[0]}.` : ''}`;
}

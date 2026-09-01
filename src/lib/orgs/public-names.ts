// ── Public display names — the crawlable-page masking rule ──────────────────
// Extracted from public-standings.ts (the phase-2 stage-gate fix) so every
// public org-site surface applies the SAME rule. A full name appears on a
// crawlable page ONLY for a claimed profile that chose visibility='public';
// private profiles and unclaimed stubs (@stubs.invalid) render "First L." —
// a manager's roster entry must never publish a private athlete's full name.
// Pure and node-testable; callers select email ONLY to feed this function
// and must never let it leave their return types.

import { isStubEmail } from '@/lib/config/stubs-config';

export interface MaskableProfile {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  visibility: string | null;
  email: string | null;
}

export function publicDisplayName(p: MaskableProfile): string {
  const first = p.first_name || p.full_name?.split(' ')[0] || 'Athlete';
  const last = p.last_name || '';
  const isPublic = p.visibility === 'public' && !isStubEmail(p.email);
  return isPublic
    ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete'
    : `${first}${last ? ` ${last[0]}.` : ''}`;
}

// The PURE half of scout access (Recruiting skeleton R2): what makes a profile
// a scout account. Its own file (maintenance pass, Oct 10 2026) because client
// pages ask it too — importing it from scout-access.ts pulled the server auth
// module (and its admin client) into their browser bundle.

import { isStubEmail } from '@/lib/config/stubs-config';

export interface ScoutCandidate {
  user_type: string | null | undefined;
  supervision_state?: string | null;
  email?: string | null;
}

/** PURE: a scout account is a claimed, unsupervised profile of type 'scout'. */
export function isScoutAccount(p: ScoutCandidate | null | undefined): boolean {
  if (!p) return false;
  if (p.user_type !== 'scout') return false;
  if (p.supervision_state === 'supervised') return false;
  if (isStubEmail(p.email)) return false;
  return true;
}

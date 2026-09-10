// ── Scout access (Recruiting skeleton R2) ─────────────────────────────────
// A scout is an ACCOUNT TYPE (Tom's call, Sep 10 2026): user_type 'scout',
// minted only by the signup actor branch — never by a client-sent
// user_type (the signup-user-type.ts seam). The pure decider is what every
// scout route and page consults; the wrapper is the route gate.

import type { NextRequest } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
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

/** The route gate: a session whose profile is a scout account, else a
 *  thrown 403 in the requireAuth style (401 rides through from requireAuth). */
export async function requireScout(request: NextRequest): Promise<{ id: string; email: string | null }> {
  const user = await requireAuth(request);
  const { data } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, user_type, supervision_state, email')
    .eq('id', user.id)
    .maybeSingle();
  if (!isScoutAccount(data as ScoutCandidate | null)) {
    throw new Response(JSON.stringify({ error: 'This is for scout accounts' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return { id: user.id, email: user.email ?? null };
}

// ── Who may START a club or league (Onboarding v2 R0) ───────────────────────
// A safety gap found Sep 8 2026: /api/clubs/requests and /api/leagues/
// requests gated on requireAuth alone, so a SUPERVISED athlete (a minor
// under a guardian, 049) could create an org — its owner, publisher and
// inviter — with no guardian in the loop. Every other act a minor takes
// runs through the guardian rails; this one now does too, the way
// registration does (registration-server.ts: "A guardian registers a
// supervised athlete"). Guardian acting-as does not reach the org routes,
// so a supervised profile is simply refused: the guardian starts the org
// from their own account, which is what the organizer door assumes anyway.
//
// The pure half is node-tested; the route audit test asserts both request
// routes call requireOrgCreator.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export const SUPERVISED_ORG_CREATOR_ERROR = 'A guardian starts an organization for a supervised athlete';

/** PURE: `supervisionState` is the profile's column (049: 'self' |
 *  'supervised'); null = an older profile with no state (adult); undefined
 *  = no profile row. */
export function canCreateOrg(input: {
  supervisionState: string | null | undefined;
}): { ok: true } | { ok: false; status: 403 | 404; error: string } {
  if (input.supervisionState === undefined) {
    return { ok: false, status: 404, error: 'Profile not found' };
  }
  if (input.supervisionState === 'supervised') {
    return { ok: false, status: 403, error: SUPERVISED_ORG_CREATOR_ERROR };
  }
  return { ok: true };
}

/** The one profile read the guardian-aware org paths share (hoisted from
 *  owners.ts / roster-server.ts). undefined = profile missing; null/other
 *  = the state. */
export async function readSupervisionState(
  admin: Admin,
  profileId: string
): Promise<string | null | undefined> {
  const { data } = await admin
    .from('profiles')
    .select('id, supervision_state')
    .eq('id', profileId)
    .maybeSingle();
  return data ? (data.supervision_state as string | null) : undefined;
}

/** Route gate: null = may proceed; otherwise the response to return.
 *  Call it right after requireAuth on every org-creation route. */
export async function requireOrgCreator(admin: Admin, userId: string): Promise<NextResponse | null> {
  const verdict = canCreateOrg({ supervisionState: await readSupervisionState(admin, userId) });
  if (verdict.ok) return null;
  return NextResponse.json({ error: verdict.error }, { status: verdict.status });
}

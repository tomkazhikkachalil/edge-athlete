// ── League creation — the league name over `src/lib/orgs/create.ts` ─────────
// Since Round 5 step E one function creates both kinds (kind, the sport,
// the capability defaults). This wrapper keeps the league-named input and
// result its importers use until step F retires it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createOrgWithOwner, type CreateOrgInput, type OrgRow } from '@/lib/orgs/create';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export type LeagueRow = OrgRow;

export interface CreateLeagueInput extends Omit<CreateOrgInput, 'kind' | 'sportKey'> {
  /** A league's one sport — required (234's CHECK). */
  sportKey: string;
}

export type CreateLeagueResult = { league: LeagueRow } | { error: 'insert_failed' | 'member_failed' };

export async function createLeagueWithOwner(admin: Admin, input: CreateLeagueInput): Promise<CreateLeagueResult> {
  const created = await createOrgWithOwner(admin, { ...input, kind: 'league' });
  return 'error' in created ? created : { league: created.org };
}

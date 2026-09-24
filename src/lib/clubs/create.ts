// ── Club creation — the club name over `src/lib/orgs/create.ts` ─────────────
// Since Round 5 step E one function creates both kinds (kind, the sport,
// the capability defaults). This wrapper keeps the club-named input and
// result its importers use until step F retires it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createOrgWithOwner, type CreateOrgInput, type OrgRow } from '@/lib/orgs/create';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export type ClubRow = OrgRow;

export interface CreateClubInput extends Omit<CreateOrgInput, 'kind' | 'sportKey'> {
  /** The sport the club leads with (174) — the golf site shape (C3). */
  primarySport?: string | null;
}

export type CreateClubResult = { club: ClubRow } | { error: 'insert_failed' | 'member_failed' };

export async function createClubWithOwner(admin: Admin, input: CreateClubInput): Promise<CreateClubResult> {
  const { primarySport, ...rest } = input;
  const created = await createOrgWithOwner(admin, { ...rest, kind: 'club', sportKey: primarySport ?? null });
  return 'error' in created ? created : { club: created.org };
}

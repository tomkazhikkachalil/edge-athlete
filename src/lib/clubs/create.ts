// ── Club creation — the ONE place a club and its owner row are born ─────────
// Mirror of src/lib/leagues/create.ts (deliberately NOT generalized into a
// createOrgWithOwner: table names, sport_key presence and rollback targets
// differ, and two explicit functions beat one generic one). Two inserts, no
// transaction over PostgREST — a failed owner-member insert deletes the
// fresh club by hand so an owner-less club is never CREATED this way (the
// 001 demo rows are the grandfathered exception, reassignable later).

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertOwnerRow } from '@/lib/orgs/members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface ClubRow {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CreateClubInput {
  name: string;
  description: string | null;
  ownerProfileId: string;
  /** Pre-built location columns: placeToClubColumns(place), or a
   *  club_requests row's nine columns verbatim on the approval path. */
  placeColumns: Record<string, string | number | null>;
  /** Capability flags (142) — absent ⇒ the column DEFAULTs apply (the
   *  wizard's tristate: NULL request columns pass nothing through). */
  capabilities?: { operatesCompetitions: boolean; operatesTeams: boolean };
  /** Phase 7 C4 (174): undefined ⇒ live now (every direct/admin create);
   *  null ⇒ PENDING (provisioned at request time, approval stamps it). */
  approvedAt?: string | null;
  /** The sport the club leads with (174) — the golf site shape (C3). */
  primarySport?: string | null;
}

export type CreateClubResult =
  | { club: ClubRow }
  | { error: 'insert_failed' | 'member_failed' };

export async function createClubWithOwner(
  admin: Admin,
  input: CreateClubInput
): Promise<CreateClubResult> {
  const base = {
    name: input.name,
    description: input.description,
    owner_profile_id: input.ownerProfileId,
    ...input.placeColumns,
    ...(input.capabilities
      ? {
          operates_competitions: input.capabilities.operatesCompetitions,
          operates_teams: input.capabilities.operatesTeams,
        }
      : {}),
  };
  const approval = {
    approved_at: input.approvedAt === undefined ? new Date().toISOString() : input.approvedAt,
    ...(input.primarySport ? { primary_sport: input.primarySport } : {}),
  };
  let { data: club, error: insertError } = await admin
    .from('clubs')
    .insert({ ...base, ...approval })
    .select()
    .single();
  if (insertError?.code === 'PGRST204' && /approved_at|primary_sport/.test(insertError.message ?? '')) {
    // Pre-174 database: no approval state exists — the club is simply live.
    ({ data: club, error: insertError } = await admin.from('clubs').insert(base).select().single());
  }
  if (insertError || !club) {
    console.error('[CLUBS CREATE] insert error:', insertError);
    return { error: 'insert_failed' };
  }

  const { error: memberError } = await insertOwnerRow(
    admin,
    { side: 'club', orgId: club.id },
    input.ownerProfileId
  );
  if (memberError) {
    console.error('[CLUBS CREATE] owner member insert error:', memberError);
    // The rollback delete also fires the 112 doc-delete trigger — search
    // stays convergent for free.
    await admin.from('clubs').delete().eq('id', club.id);
    return { error: 'member_failed' };
  }

  return { club: club as ClubRow };
}

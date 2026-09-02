// ── League creation — the ONE place a league and its owner row are born ─────
// Extracted from /api/admin/leagues POST so the request-approval path
// (116) and the admin console share the identical two-insert-with-rollback
// discipline: no transaction exists over PostgREST, so on a failed owner
// member insert the league row is deleted by hand — an owner-less league
// must never exist.

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertOwnerRow } from '@/lib/orgs/members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface LeagueRow {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CreateLeagueInput {
  name: string;
  description: string | null;
  sportKey: string;
  ownerProfileId: string;
  /** Pre-built location columns: `placeToLeagueColumns(place)` from a picker
   *  value, or a league_requests row's nine columns verbatim — no PlaceValue
   *  round-trip on the approval path. */
  placeColumns: Record<string, string | number | null>;
  /** Capability flags (142) — absent ⇒ the column DEFAULTs apply (the
   *  wizard's tristate: NULL request columns pass nothing through). */
  capabilities?: { operatesCompetitions: boolean; operatesTeams: boolean };
  /** Phase 7 C4 (174): undefined ⇒ live now (every direct/admin create);
   *  null ⇒ PENDING (provisioned at request time, approval stamps it). */
  approvedAt?: string | null;
}

export type CreateLeagueResult =
  | { league: LeagueRow }
  | { error: 'insert_failed' | 'member_failed' };

export async function createLeagueWithOwner(
  admin: Admin,
  input: CreateLeagueInput
): Promise<CreateLeagueResult> {
  const base = {
    name: input.name,
    description: input.description,
    sport_key: input.sportKey,
    owner_profile_id: input.ownerProfileId,
    ...input.placeColumns,
    ...(input.capabilities
      ? {
          operates_competitions: input.capabilities.operatesCompetitions,
          operates_teams: input.capabilities.operatesTeams,
        }
      : {}),
  };
  const approvedAt = input.approvedAt === undefined ? new Date().toISOString() : input.approvedAt;
  let { data: league, error: insertError } = await admin
    .from('leagues')
    .insert({ ...base, approved_at: approvedAt })
    .select()
    .single();
  if (insertError?.code === 'PGRST204' && /approved_at/.test(insertError.message ?? '')) {
    // Pre-174 database: no approval state exists — the league is simply live.
    ({ data: league, error: insertError } = await admin.from('leagues').insert(base).select().single());
  }
  if (insertError || !league) {
    console.error('[LEAGUES CREATE] insert error:', insertError);
    return { error: 'insert_failed' };
  }

  const { error: memberError } = await insertOwnerRow(
    admin,
    { side: 'league', orgId: league.id },
    input.ownerProfileId
  );
  if (memberError) {
    console.error('[LEAGUES CREATE] owner member insert error:', memberError);
    await admin.from('leagues').delete().eq('id', league.id);
    return { error: 'member_failed' };
  }

  return { league: league as LeagueRow };
}

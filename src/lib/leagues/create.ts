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
   *  value, or a request row's nine columns verbatim (org_requests since 236) — no PlaceValue
   *  round-trip on the approval path. */
  placeColumns: Record<string, string | number | null>;
  /** Capability flags (142) — absent ⇒ the column DEFAULTs apply (the
   *  wizard's tristate: NULL request columns pass nothing through). */
  capabilities?: { operatesCompetitions: boolean; operatesTeams: boolean };
  /** Phase 7 C4 (174): undefined ⇒ live now (every direct/admin create);
   *  null ⇒ PENDING (provisioned at request time, approval stamps it). */
  approvedAt?: string | null;
  /** Listing state (179): undefined ⇒ the column DEFAULT ('listed' — every
   *  direct/admin create); pending-org.ts passes 'pending' or 'unlisted'. */
  listingStatus?: 'unlisted' | 'pending' | 'listed';
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
  };
  const approvedAt = input.approvedAt === undefined ? new Date().toISOString() : input.approvedAt;
  const listing = input.listingStatus ? { listing_status: input.listingStatus } : {};
  // Round 5 D1: the org row is born in `organizations` (kind = league); the
  // mirror keeps the `leagues` twin until 235. The old table's capability
  // DEFAULTS (142: a league operates competitions) are explicit here —
  // organizations' own defaults are false / false.
  const { data: league, error: insertError } = await admin
    .from('organizations')
    .insert({
      kind: 'league',
      ...base,
      operates_competitions: input.capabilities?.operatesCompetitions ?? true,
      operates_teams: input.capabilities?.operatesTeams ?? false,
      approved_at: approvedAt,
      ...listing,
    })
    .select()
    .single();
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
    await admin.from('organizations').delete().eq('id', league.id);
    return { error: 'member_failed' };
  }

  return { league: league as LeagueRow };
}

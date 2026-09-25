// ── Org creation — the ONE place an org and its owner row are born (Round 5
// step E: one function for both kinds) ──────────────────────────────────────
// Extracted from the admin POSTs so the request-approval path (116 / 117),
// the admin console and the pending provision (174) share the identical
// two-insert-with-rollback discipline: no transaction exists over PostgREST,
// so on a failed owner member insert the org row is deleted by hand — an
// owner-less org must never be CREATED this way (the 001 demo rows are the
// grandfathered exception, reassignable later).
//
// What the kind decides: `kind` on the row, the sport (a league's is
// required — 234's CHECK; a club's is the sport it leads with, optional) and
// the capability DEFAULTS (142: a league operates competitions, a club
// operates teams — `organizations`' own defaults are false / false, so they
// are explicit here). The two side wrappers were deleted in step F.

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertOwnerRow } from './members';
import type { OrgKind } from './org-ref';
import { recordAuthority } from '@/lib/authority/audit-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface OrgRow {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CreateOrgInput {
  kind: OrgKind;
  name: string;
  description: string | null;
  /** A league's one sport (required — 234's CHECK refuses a league without
   *  it); the sport a club leads with (174 — the golf site shape), or null. */
  sportKey?: string | null;
  ownerProfileId: string;
  /** Pre-built location columns: `placeToOrgColumns(place)` from a picker
   *  value, or a request row's nine columns verbatim — no PlaceValue
   *  round-trip on the approval path. */
  placeColumns: Record<string, string | number | null>;
  /** Capability flags (142) — absent ⇒ the kind's defaults apply (the
   *  wizard's tristate: NULL request columns pass nothing through). */
  capabilities?: { operatesCompetitions: boolean; operatesTeams: boolean };
  /** Phase 7 C4 (174): undefined ⇒ live now (every direct/admin create);
   *  null ⇒ PENDING (provisioned at request time, approval stamps it). */
  approvedAt?: string | null;
  /** Listing state (179): undefined ⇒ the column DEFAULT ('listed' — every
   *  direct/admin create); pending-org.ts passes 'pending' or 'unlisted'. */
  listingStatus?: 'unlisted' | 'pending' | 'listed';
}

export type CreateOrgResult = { org: OrgRow } | { error: 'insert_failed' | 'member_failed' };

/** The kinds' capability defaults (142) — what the old two tables' column
 *  DEFAULTs said; `organizations`' are false / false. */
export const ORG_CAPABILITY_DEFAULTS: Record<OrgKind, { operatesCompetitions: boolean; operatesTeams: boolean }> = {
  league: { operatesCompetitions: true, operatesTeams: false },
  club: { operatesCompetitions: false, operatesTeams: true },
};

export async function createOrgWithOwner(admin: Admin, input: CreateOrgInput): Promise<CreateOrgResult> {
  const defaults = ORG_CAPABILITY_DEFAULTS[input.kind];
  const tag = input.kind === 'league' ? '[LEAGUES CREATE]' : '[CLUBS CREATE]';
  const { data: org, error: insertError } = await admin
    .from('organizations')
    .insert({
      kind: input.kind,
      name: input.name,
      description: input.description,
      owner_profile_id: input.ownerProfileId,
      ...input.placeColumns,
      ...(input.sportKey ? { sport_key: input.sportKey } : {}),
      operates_competitions: input.capabilities?.operatesCompetitions ?? defaults.operatesCompetitions,
      operates_teams: input.capabilities?.operatesTeams ?? defaults.operatesTeams,
      approved_at: input.approvedAt === undefined ? new Date().toISOString() : input.approvedAt,
      ...(input.listingStatus ? { listing_status: input.listingStatus } : {}),
    })
    .select()
    .single();
  if (insertError || !org) {
    console.error(`${tag} insert error:`, insertError);
    return { error: 'insert_failed' };
  }

  const { error: memberError } = await insertOwnerRow(admin, { side: input.kind, orgId: org.id }, input.ownerProfileId);
  if (memberError) {
    console.error(`${tag} owner member insert error:`, memberError);
    await admin.from('organizations').delete().eq('id', org.id);
    return { error: 'member_failed' };
  }

  await recordAuthority(admin, {
    subject: { type: 'org', id: org.id as string },
    actor: { kind: 'member', profileId: input.ownerProfileId },
    action: 'org_created',
    targetProfileId: input.ownerProfileId,
  });
  return { org: org as OrgRow };
}

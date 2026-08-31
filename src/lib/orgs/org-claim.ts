// ── Org claim invites (phase 1 round 2) — stub-org handover tokens ──────────
// guardian_invites' semantics on the org_claim_invites table (149): hashed
// at rest, single-use, atomic redeem, restore-on-failed-precondition (the
// invites-claim "token intact" principle). The token helpers are imported
// from guardian-invites — they're pure and generic, no clone.
//
// invited_email is nullable ON PURPOSE: the claim URL returned in the
// approve response is the guaranteed channel (house rule — email is a
// convenience).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { generateInviteToken, hashInviteToken } from '@/lib/guardian-invites';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const ORG_CLAIM_EXPIRY_DAYS = 30;

export interface OrgClaimOrg {
  side: OrgSide;
  id: string;
  name: string;
  sport_key?: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  owner_profile_id: string | null;
}

export async function createOrgClaimInvite(
  admin: Admin,
  input: { side: OrgSide; orgId: string; invitedEmail: string | null; createdBy: string }
): Promise<{ rawToken: string; inviteId: string } | null> {
  const rawToken = generateInviteToken();
  const expiresAt = new Date(Date.now() + ORG_CLAIM_EXPIRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('org_claim_invites')
    .insert({
      token_hash: hashInviteToken(rawToken),
      [input.side === 'league' ? 'league_id' : 'club_id']: input.orgId,
      invited_email: input.invitedEmail,
      created_by: input.createdBy,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[ORG CLAIM] invite insert failed:', error);
    return null;
  }
  return { rawToken, inviteId: data.id as string };
}

/** Never consumes. Null on unknown/expired/consumed — uniform outside. */
export async function peekOrgClaimInvite(
  admin: Admin,
  rawToken: string
): Promise<{ inviteId: string; org: OrgClaimOrg } | null> {
  const { data: invite } = await admin
    .from('org_claim_invites')
    .select('id, league_id, club_id, expires_at, consumed_at')
    .eq('token_hash', hashInviteToken(rawToken))
    .maybeSingle();
  if (!invite || invite.consumed_at || new Date(invite.expires_at as string) <= new Date()) {
    return null;
  }
  const side: OrgSide = invite.league_id ? 'league' : 'club';
  const orgId = (invite.league_id ?? invite.club_id) as string;
  const { data: org } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select('id, name, city, region, country, owner_profile_id' + (side === 'league' ? ', sport_key' : ''))
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return null;
  // The dynamic select string defeats supabase's inference — round-trip
  // through unknown; the shape is the columns selected above.
  return {
    inviteId: invite.id as string,
    org: { side, ...(org as unknown as Omit<OrgClaimOrg, 'side'>) },
  };
}

/** Atomic single-use redeem; null = invalid/expired/already used. */
export async function redeemOrgClaimInvite(
  admin: Admin,
  rawToken: string,
  consumedBy: string
): Promise<{ side: OrgSide; orgId: string } | null> {
  const { data } = await admin
    .from('org_claim_invites')
    .update({ consumed_at: new Date().toISOString(), consumed_by: consumedBy })
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('league_id, club_id');
  const row = data?.[0];
  if (!row) return null;
  return {
    side: row.league_id ? 'league' : 'club',
    orgId: (row.league_id ?? row.club_id) as string,
  };
}

/** Compensation: a failed precondition after redeem must not burn the
 *  token (the invites-claim principle). Best-effort. */
export async function restoreOrgClaimInvite(
  admin: Admin,
  rawToken: string
): Promise<{ error: PostgrestError | null }> {
  const { error } = await admin
    .from('org_claim_invites')
    .update({ consumed_at: null, consumed_by: null })
    .eq('token_hash', hashInviteToken(rawToken));
  if (error) console.error('[ORG CLAIM] invite restore failed:', error);
  return { error };
}

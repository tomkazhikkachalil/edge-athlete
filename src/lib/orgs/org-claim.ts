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

import { orgIdOf, orgKindOf, pairFor, type OrgKind } from './org-ref';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const ORG_CLAIM_EXPIRY_DAYS = 30;
/** Authority (240): a RECOVERY token — minted by the Edge Athlete team on a
 *  ticket, bound to one email — lives a week, not a month. */
export const ORG_RECOVERY_EXPIRY_DAYS = 7;

export type OrgClaimPurpose = 'handover' | 'recovery';

export interface OrgClaimOrg {
  side: OrgKind;
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
  input: { side: OrgKind; orgId: string; invitedEmail: string | null; createdBy: string; purpose?: OrgClaimPurpose; ticketId?: string | null }
): Promise<{ rawToken: string; inviteId: string; expiresAt: string } | null> {
  const rawToken = generateInviteToken();
  const recovery = input.purpose === 'recovery';
  const expiresAt = new Date(Date.now() + (recovery ? ORG_RECOVERY_EXPIRY_DAYS : ORG_CLAIM_EXPIRY_DAYS) * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('org_claim_invites')
    .insert({
      token_hash: hashInviteToken(rawToken),
      ...pairFor(input),
      invited_email: input.invitedEmail,
      created_by: input.createdBy,
      expires_at: expiresAt,
      // 240: only a recovery token names its purpose (the column defaults to handover).
      ...(recovery ? { purpose: 'recovery', ticket_id: input.ticketId ?? null } : {}),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[ORG CLAIM] invite insert failed:', error);
    return null;
  }
  return { rawToken, inviteId: data.id as string, expiresAt };
}

/** Never consumes. Null on unknown/expired/consumed — uniform outside. */
export async function peekOrgClaimInvite(
  admin: Admin,
  rawToken: string
): Promise<{ inviteId: string; org: OrgClaimOrg; purpose: OrgClaimPurpose; invitedEmail: string | null; ticketId: string | null } | null> {
  const hash = hashInviteToken(rawToken);
  const read = (cols: string) => admin.from('org_claim_invites').select(cols).eq('token_hash', hash).maybeSingle();
  let { data, error } = await read('id, org_id, org:organizations(kind), expires_at, consumed_at, invited_email, purpose, ticket_id');
  // Pre-240 (no purpose column): every token is a handover.
  if (error?.code === '42703') ({ data, error } = await read('id, org_id, org:organizations(kind), expires_at, consumed_at, invited_email'));
  const invite = data as unknown as { id: string; org_id: string; org: { kind: string } | { kind: string }[] | null; expires_at: string; consumed_at: string | null; invited_email: string | null; purpose?: string; ticket_id?: string | null } | null;
  if (!invite || invite.consumed_at || new Date(invite.expires_at as string) <= new Date()) {
    return null;
  }
  const side: OrgKind = orgKindOf(invite) ?? 'club';
  const orgId = orgIdOf(invite) as string;
  const { data: org } = await admin
    .from('organizations')
    .select('id, name, city, region, country, owner_profile_id' + (side === 'league' ? ', sport_key' : ''))
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return null;
  // The dynamic select string defeats supabase's inference — round-trip
  // through unknown; the shape is the columns selected above.
  return {
    inviteId: invite.id as string,
    org: { side, ...(org as unknown as Omit<OrgClaimOrg, 'side'>) },
    purpose: invite.purpose === 'recovery' ? 'recovery' : 'handover',
    invitedEmail: invite.invited_email ?? null,
    ticketId: invite.ticket_id ?? null,
  };
}

/** Atomic single-use redeem; null = invalid/expired/already used. */
export async function redeemOrgClaimInvite(
  admin: Admin,
  rawToken: string,
  consumedBy: string
): Promise<{ side: OrgKind; orgId: string } | null> {
  const { data } = await admin
    .from('org_claim_invites')
    .update({ consumed_at: new Date().toISOString(), consumed_by: consumedBy })
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('org_id, org:organizations(kind)');
  const row = data?.[0];
  if (!row) return null;
  return {
    side: orgKindOf(row) ?? 'club',
    orgId: orgIdOf(row) as string,
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

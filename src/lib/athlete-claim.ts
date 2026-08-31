// ── Athlete claim invites (phase 1 R3) — stub-athlete handover tokens ───────
// The org-claim.ts shape on athlete_claim_invites (150): hashed at rest,
// single-use, atomic redeem, restore-on-failed-precondition. Token helpers
// imported from guardian-invites (pure and generic).
//
// The peek NEVER returns the invited email (enumeration hygiene) and
// answers uniformly null once the stub is claimed — a consumed identity
// looks exactly like a bogus token from outside.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { generateInviteToken, hashInviteToken } from '@/lib/guardian-invites';
import { ATHLETE_CLAIM_EXPIRY_DAYS, isStubEmail } from '@/lib/config/stubs-config';
import type { OrgSide } from '@/lib/orgs/authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface AthleteClaimContext {
  side: OrgSide;
  orgId: string;
  teamId: string | null;
}

export async function createAthleteClaimInvite(
  admin: Admin,
  input: {
    profileId: string;
    context: AthleteClaimContext | null;
    invitedEmail: string | null;
    createdBy: string;
  }
): Promise<{ rawToken: string; inviteId: string } | null> {
  const rawToken = generateInviteToken();
  const expiresAt = new Date(Date.now() + ATHLETE_CLAIM_EXPIRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('athlete_claim_invites')
    .insert({
      token_hash: hashInviteToken(rawToken),
      profile_id: input.profileId,
      league_id: input.context?.side === 'league' ? input.context.orgId : null,
      club_id: input.context?.side === 'club' ? input.context.orgId : null,
      team_id: input.context?.teamId ?? null,
      invited_email: input.invitedEmail,
      created_by: input.createdBy,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[ATHLETE CLAIM] invite insert failed:', error);
    return null;
  }
  return { rawToken, inviteId: data.id as string };
}

export interface AthleteClaimPeek {
  inviteId: string;
  profileId: string;
  athleteName: string;
  orgName: string | null;
  teamName: string | null;
}

/** Never consumes. Null on unknown/expired/consumed — AND once the stub is
 *  claimed (real email, or the self row no longer 'supervised'). */
export async function peekAthleteClaimInvite(
  admin: Admin,
  rawToken: string
): Promise<AthleteClaimPeek | null> {
  const { data: invite } = await admin
    .from('athlete_claim_invites')
    .select('id, profile_id, league_id, club_id, team_id, expires_at, consumed_at')
    .eq('token_hash', hashInviteToken(rawToken))
    .maybeSingle();
  if (!invite || invite.consumed_at || new Date(invite.expires_at as string) <= new Date()) {
    return null;
  }
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, first_name, last_name, full_name, display_name')
    .eq('id', invite.profile_id)
    .maybeSingle();
  if (!profile || !isStubEmail(profile.email as string)) return null;
  const { data: selfRow } = await admin
    .from('profile_access')
    .select('role')
    .eq('user_id', invite.profile_id)
    .eq('profile_id', invite.profile_id)
    .maybeSingle();
  if (!selfRow || selfRow.role !== 'supervised') return null;

  let orgName: string | null = null;
  if (invite.league_id || invite.club_id) {
    const { data: org } = await admin
      .from(invite.league_id ? 'leagues' : 'clubs')
      .select('name')
      .eq('id', (invite.league_id ?? invite.club_id) as string)
      .maybeSingle();
    orgName = (org?.name as string | null) ?? null;
  }
  let teamName: string | null = null;
  if (invite.team_id) {
    const { data: team } = await admin
      .from('teams')
      .select('name')
      .eq('id', invite.team_id as string)
      .maybeSingle();
    teamName = (team?.name as string | null) ?? null;
  }
  return {
    inviteId: invite.id as string,
    profileId: invite.profile_id as string,
    athleteName:
      (profile.full_name as string | null) ||
      (profile.display_name as string | null) ||
      (profile.first_name as string | null) ||
      'This athlete',
    orgName,
    teamName,
  };
}

/** Atomic single-use redeem; null = invalid/expired/already used. */
export async function redeemAthleteClaimInvite(
  admin: Admin,
  rawToken: string,
  consumedBy: string | null
): Promise<{ profileId: string } | null> {
  const { data } = await admin
    .from('athlete_claim_invites')
    .update({ consumed_at: new Date().toISOString(), consumed_by: consumedBy })
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('profile_id');
  const row = data?.[0];
  if (!row) return null;
  return { profileId: row.profile_id as string };
}

/** Compensation: a failed precondition after redeem never burns the token. */
export async function restoreAthleteClaimInvite(
  admin: Admin,
  rawToken: string
): Promise<{ error: PostgrestError | null }> {
  const { error } = await admin
    .from('athlete_claim_invites')
    .update({ consumed_at: null, consumed_by: null })
    .eq('token_hash', hashInviteToken(rawToken));
  if (error) console.error('[ATHLETE CLAIM] invite restore failed:', error);
  return { error };
}

// Guardian-invite tokens: app-owned, single-use, hashed at rest.
// NOT Supabase PKCE links — a parent opens the invite on a different device
// by definition, and PKCE requires same-browser redemption.
//
// Pure helpers (token generation/hashing) are separated from the DB ops so
// they get unit tests without mocks.

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GUARDIAN_INVITE_EXPIRY_DAYS } from './config/minors-config';

export type InviteType =
  | 'guardian_for_pending'
  | 'guardian_additional'
  | 'athlete_activation'
  | 'transfer_contact_verify';

/** 32 random bytes, base64url — the raw token exists only in the email link. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex — what's stored. Constant-time comparison is unnecessary:
 *  lookup is by exact hash match on a unique index. */
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Role a guardian_additional claim grants (migration 138). */
export type InviteGrantRole = 'guardian' | 'viewer';

interface CreateInviteParams {
  admin: SupabaseClient;
  inviteType: InviteType;
  invitedEmail: string;
  pendingProfileId?: string;
  profileId?: string;
  createdBy?: string;
  /** Only meaningful for guardian_additional; DB defaults to 'guardian'. */
  grantRole?: InviteGrantRole;
}

/** Inserts the invite row; returns the RAW token (for the email) or null. */
export async function createGuardianInvite(
  params: CreateInviteParams
): Promise<{ rawToken: string; inviteId: string } | null> {
  const rawToken = generateInviteToken();
  const { data, error } = await params.admin
    .from('guardian_invites')
    .insert({
      token_hash: hashInviteToken(rawToken),
      invite_type: params.inviteType,
      invited_email: normalizeInviteEmail(params.invitedEmail),
      pending_profile_id: params.pendingProfileId ?? null,
      profile_id: params.profileId ?? null,
      created_by: params.createdBy ?? null,
      grant_role: params.grantRole ?? 'guardian',
      expires_at: new Date(
        Date.now() + GUARDIAN_INVITE_EXPIRY_DAYS * 86_400_000
      ).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[INVITES] insert failed:', error);
    return null;
  }
  return { rawToken, inviteId: data.id };
}

export interface RedeemedInvite {
  id: string;
  invite_type: InviteType;
  invited_email: string;
  pending_profile_id: string | null;
  profile_id: string | null;
  created_by: string | null;
  grant_role: InviteGrantRole;
  /** When the invite was minted (Round 1 PR 1: the claimant's account must predate it). */
  created_at?: string;
}

/**
 * Round 1 PR 1 (Tom, Sep 20 2026): a GUARDIAN invite may be claimed only by
 * an account that existed BEFORE the invite was minted. The parked screen
 * shows the minor the bearer link (email is a convenience — Tom's Aug rule),
 * and consent auto-approves, so without this a 13-year-old could open their
 * own link, create a "parent" account and approve themselves. A parent who
 * signs up AFTER the invite is refused with the way forward: contact
 * support, who re-mints from /dashboard/guardians — a human in the loop for
 * the edge case, never a self-service re-mint (that would reopen the hole).
 * Applies to the guardian types only; an athlete's own activation and a
 * transfer's contact check are not guardian grants. Pure; pinned by test.
 */
export function guardianAccountPredatesInvite(
  inviteType: InviteType,
  accountCreatedAt: string | null | undefined,
  inviteCreatedAt: string | null | undefined
): boolean {
  if (inviteType !== 'guardian_for_pending' && inviteType !== 'guardian_additional') return true;
  const account = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  const invite = inviteCreatedAt ? Date.parse(inviteCreatedAt) : NaN;
  // An unreadable timestamp fails CLOSED — the gate is a child-safety rule.
  if (!Number.isFinite(account) || !Number.isFinite(invite)) return false;
  return account < invite;
}

export const GUARDIAN_PREDATES_REFUSAL =
  'This link was created before your account existed, so it cannot be used to become a guardian. A parent needs an account first: contact support from the Help Center and we will issue a fresh link.';

/**
 * Atomic single-use redemption: the UPDATE's WHERE clause is the whole
 * validity check — zero rows back means invalid, expired, or already used.
 * Pass inviteType when the caller only accepts one kind of token, so a
 * valid token of another type is refused WITHOUT being consumed.
 */
export async function redeemGuardianInvite(
  admin: SupabaseClient,
  rawToken: string,
  inviteType?: InviteType
): Promise<RedeemedInvite | null> {
  let query = admin
    .from('guardian_invites')
    .update({ consumed_at: new Date().toISOString() })
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString());
  if (inviteType) query = query.eq('invite_type', inviteType);
  const { data, error } = await query
    .select('id, invite_type, invited_email, pending_profile_id, profile_id, created_by, grant_role')
    .maybeSingle();
  if (error) {
    console.error('[INVITES] redemption failed:', error);
    return null;
  }
  return (data as RedeemedInvite) ?? null;
}

/** Peek without consuming (for rendering the landing page). */
export async function peekGuardianInvite(
  admin: SupabaseClient,
  rawToken: string
): Promise<RedeemedInvite | null> {
  const { data, error } = await admin
    .from('guardian_invites')
    .select('id, invite_type, invited_email, pending_profile_id, profile_id, created_by, grant_role, created_at')
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) return null;
  return (data as RedeemedInvite) ?? null;
}

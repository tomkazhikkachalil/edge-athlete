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
}

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
    .select('id, invite_type, invited_email, pending_profile_id, profile_id, created_by, grant_role')
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) return null;
  return (data as RedeemedInvite) ?? null;
}

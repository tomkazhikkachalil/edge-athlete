// ── Staff invites (org staff program, 178) — the grant-bearing token ────────
// org-claim.ts' semantics on the org_staff_invites table: hashed at rest,
// single-use, atomic redeem, restore-on-failed-precondition. Unlike a
// stub-org handover, an invite is addressed to a PERSON: invited_email is
// NOT NULL and the redeemer's account email must match. The grant rides
// the row (role / sections / scope / season) and lands as a `kind='staff'`
// memberships row on accept (grants are additive: an existing row at the
// same scope takes the union of sections).
//
// SAFETY BOUNDARY (authz.ts charter 2): nothing here reads guardian data;
// a supervised profile can never hold a staff row (the redeem route checks
// supervision_state before granting).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { generateInviteToken, hashInviteToken } from '@/lib/guardian-invites';
import type { OrgSection, OrgSide } from './authz';
import { mergeSections, normalizeSections, type StaffGrantInput } from './staff-validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const STAFF_INVITE_EXPIRY_DAYS = 30;
const TAG = '[ORG STAFF]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

export interface StaffGrant {
  role: 'admin' | 'staff';
  sections: OrgSection[] | null;
  scopeType: 'org' | 'division' | 'team';
  scopeId: string | null;
  seasonId: string | null;
}

export function grantFromInput(input: StaffGrantInput): StaffGrant {
  const scopeType = input.scopeType ?? 'org';
  return {
    role: input.role,
    sections: input.role === 'admin' ? null : (normalizeSections(input.sections) as OrgSection[]),
    scopeType,
    scopeId: scopeType === 'org' ? null : (input.scopeId ?? null),
    seasonId: input.seasonId ?? null,
  };
}

export async function createStaffInvite(
  admin: Admin,
  input: { side: OrgSide; orgId: string; invitedEmail: string; grant: StaffGrant; createdBy: string }
): Promise<{ rawToken: string; inviteId: string; expiresAt: string } | { error: PostgrestError }> {
  const rawToken = generateInviteToken();
  const expiresAt = new Date(Date.now() + STAFF_INVITE_EXPIRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('org_staff_invites')
    .insert({
      token_hash: hashInviteToken(rawToken),
      [orgColumn(input.side)]: input.orgId,
      invited_email: input.invitedEmail.toLowerCase(),
      role: input.grant.role,
      sections: input.grant.sections,
      scope_type: input.grant.scopeType,
      scope_id: input.grant.scopeId,
      season_id: input.grant.seasonId,
      created_by: input.createdBy,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error(`${TAG} invite insert failed:`, error);
    return { error: error as PostgrestError };
  }
  return { rawToken, inviteId: data.id as string, expiresAt };
}

export interface PeekedStaffInvite {
  inviteId: string;
  /** For the server's own match — NEVER returned to a client. */
  invitedEmail: string;
  side: OrgSide;
  orgId: string;
  orgName: string;
  grant: StaffGrant;
  /** "U13 Boys" / "Kanata Rangers" — the scope's display name, when it exists. */
  scopeName: string | null;
  seasonLabel: string | null;
  expiresAt: string;
}

/** Never consumes. Null on unknown / consumed / revoked / expired — uniform
 *  outside, so token guessing learns nothing. */
export async function peekStaffInvite(admin: Admin, rawToken: string): Promise<PeekedStaffInvite | null> {
  const { data: invite } = await admin
    .from('org_staff_invites')
    .select('id, league_id, club_id, invited_email, role, sections, scope_type, scope_id, season_id, expires_at, consumed_at, revoked_at')
    .eq('token_hash', hashInviteToken(rawToken))
    .maybeSingle();
  if (!invite || invite.consumed_at || invite.revoked_at || new Date(invite.expires_at as string) <= new Date()) {
    return null;
  }
  const side: OrgSide = invite.league_id ? 'league' : 'club';
  const orgId = (invite.league_id ?? invite.club_id) as string;
  const { data: org } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return null;
  let scopeName: string | null = null;
  if (invite.scope_type === 'division' && invite.scope_id) {
    const { data } = await admin.from('divisions').select('name').eq('id', invite.scope_id).maybeSingle();
    scopeName = (data?.name as string | undefined) ?? null;
  } else if (invite.scope_type === 'team' && invite.scope_id) {
    const { data } = await admin.from('teams').select('name').eq('id', invite.scope_id).maybeSingle();
    scopeName = (data?.name as string | undefined) ?? null;
  }
  let seasonLabel: string | null = null;
  if (invite.season_id) {
    const { data } = await admin.from('seasons').select('label').eq('id', invite.season_id).maybeSingle();
    seasonLabel = (data?.label as string | undefined) ?? null;
  }
  return {
    inviteId: invite.id as string,
    invitedEmail: (invite.invited_email as string).toLowerCase(),
    side,
    orgId,
    orgName: org.name as string,
    grant: {
      role: invite.role as 'admin' | 'staff',
      sections: (invite.sections as OrgSection[] | null) ?? null,
      scopeType: invite.scope_type as 'org' | 'division' | 'team',
      scopeId: (invite.scope_id as string | null) ?? null,
      seasonId: (invite.season_id as string | null) ?? null,
    },
    scopeName,
    seasonLabel,
    expiresAt: invite.expires_at as string,
  };
}

/** Atomic single-use redeem; null = invalid / expired / used / revoked. */
export async function redeemStaffInvite(admin: Admin, rawToken: string, consumedBy: string): Promise<boolean> {
  const { data } = await admin
    .from('org_staff_invites')
    .update({ consumed_at: new Date().toISOString(), consumed_by: consumedBy })
    .eq('token_hash', hashInviteToken(rawToken))
    .is('consumed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id');
  return !!data?.[0];
}

/** Compensation: a failed precondition after redeem must not burn the
 *  token (the invites-claim principle). Best-effort. */
export async function restoreStaffInvite(admin: Admin, rawToken: string): Promise<void> {
  const { error } = await admin
    .from('org_staff_invites')
    .update({ consumed_at: null, consumed_by: null })
    .eq('token_hash', hashInviteToken(rawToken));
  if (error) console.error(`${TAG} invite restore failed:`, error);
}

export interface StaffInviteRow {
  id: string;
  invitedEmail: string;
  role: 'admin' | 'staff';
  sections: string[] | null;
  scopeType: 'org' | 'division' | 'team';
  scopeId: string | null;
  seasonId: string | null;
  createdAt: string;
  expiresAt: string;
}

/** The org's OPEN invites (not consumed, not revoked, not expired). 42P01-
 *  safe: a pre-178 database answers an empty list. */
export async function listStaffInvites(admin: Admin, side: OrgSide, orgId: string): Promise<StaffInviteRow[]> {
  const { data, error } = await admin
    .from('org_staff_invites')
    .select('id, invited_email, role, sections, scope_type, scope_id, season_id, created_at, expires_at')
    .eq(orgColumn(side), orgId)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id as string,
    invitedEmail: r.invited_email as string,
    role: r.role as 'admin' | 'staff',
    sections: (r.sections as string[] | null) ?? null,
    scopeType: r.scope_type as 'org' | 'division' | 'team',
    scopeId: (r.scope_id as string | null) ?? null,
    seasonId: (r.season_id as string | null) ?? null,
    createdAt: r.created_at as string,
    expiresAt: r.expires_at as string,
  }));
}

/** Revoke an open invite. False when it was not this org's open invite. */
export async function revokeStaffInvite(admin: Admin, side: OrgSide, orgId: string, inviteId: string): Promise<boolean> {
  const { data } = await admin
    .from('org_staff_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq(orgColumn(side), orgId)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .select('id');
  return !!data?.[0];
}

// ── The grant row ───────────────────────────────────────────────────────────

export interface GrantResult {
  rowId: string;
  oldSections: string[] | null;
  newSections: string[] | null;
  role: 'admin' | 'staff';
}

/** Land a grant as a `kind='staff'` row: one row per (profile, scope,
 *  season). An existing row at that scope takes the UNION of sections
 *  (additive); an admin grant replaces a staff row at org scope. Null on
 *  a write failure (the caller restores the invite). */
export async function grantStaffRow(
  admin: Admin,
  input: { side: OrgSide; orgId: string; profileId: string; grant: StaffGrant; grantedBy: string }
): Promise<GrantResult | null> {
  const col = orgColumn(input.side);
  let q = admin
    .from('memberships')
    .select('id, role, sections')
    .eq(col, input.orgId)
    .eq('profile_id', input.profileId)
    .eq('kind', 'staff')
    .eq('scope_type', input.grant.scopeType);
  q = input.grant.scopeId ? q.eq('scope_id', input.grant.scopeId) : q.is('scope_id', null);
  q = input.grant.seasonId ? q.eq('season_id', input.grant.seasonId) : q.is('season_id', null);
  const { data: existing, error: readError } = await q.maybeSingle();
  if (readError) {
    console.error(`${TAG} grant read failed:`, readError);
    return null;
  }
  const now = new Date().toISOString();
  if (existing) {
    const oldSections = (existing.sections as string[] | null) ?? null;
    const becomesAdmin = input.grant.role === 'admin' || existing.role === 'admin';
    const newSections = becomesAdmin ? null : mergeSections(oldSections, input.grant.sections ?? []);
    const { error } = await admin
      .from('memberships')
      .update({
        role: becomesAdmin ? 'admin' : 'staff',
        sections: newSections,
        granted_by: input.grantedBy,
        granted_at: now,
        expires_at: null,
      })
      .eq('id', existing.id);
    if (error) {
      console.error(`${TAG} grant update failed:`, error);
      return null;
    }
    return { rowId: existing.id as string, oldSections, newSections, role: becomesAdmin ? 'admin' : 'staff' };
  }
  const { data, error } = await admin
    .from('memberships')
    .insert({
      [col]: input.orgId,
      profile_id: input.profileId,
      kind: 'staff',
      role: input.grant.role,
      status: 'active',
      scope_type: input.grant.scopeType,
      scope_id: input.grant.scopeId,
      season_id: input.grant.seasonId,
      sections: input.grant.sections,
      granted_by: input.grantedBy,
      granted_at: now,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error(`${TAG} grant insert failed:`, error);
    return null;
  }
  return { rowId: data.id as string, oldSections: null, newSections: input.grant.sections, role: input.grant.role };
}

/** Append-only trail (048/091 pattern). Best-effort — never blocks a grant. */
export async function writeStaffAudit(
  admin: Admin,
  entry: {
    side: OrgSide;
    orgId: string;
    profileId: string | null;
    actorId: string | null;
    action: 'invited' | 'accepted' | 'changed' | 'revoked' | 'expired' | 'invite_revoked';
    role?: string | null;
    scopeType?: string | null;
    scopeId?: string | null;
    seasonId?: string | null;
    oldSections?: string[] | null;
    newSections?: string[] | null;
  }
): Promise<void> {
  const { error } = await admin.from('org_staff_audit').insert({
    [orgColumn(entry.side)]: entry.orgId,
    profile_id: entry.profileId,
    actor_id: entry.actorId,
    action: entry.action,
    role: entry.role ?? null,
    scope_type: entry.scopeType ?? null,
    scope_id: entry.scopeId ?? null,
    season_id: entry.seasonId ?? null,
    old_sections: entry.oldSections ?? null,
    new_sections: entry.newSections ?? null,
  });
  if (error) console.error(`${TAG} audit insert failed:`, error);
}

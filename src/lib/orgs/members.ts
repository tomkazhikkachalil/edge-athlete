// ── Org membership data-access layer (0.2) ──────────────────────────────────
// The ONE place org membership rows are written (and, after the read-switch,
// read). Routes keep their own authorization (orgs/authz.ts) and their own
// response bodies; this module owns the queries.
//
// DUAL-WRITE TRANSITION (temporary — removed in the cleanup PR): every write
// goes to the LEGACY table (league_members/club_members) first and to the new
// `memberships` table second. The legacy write is authoritative: its error is
// what callers receive, and it alone can fail a request. The memberships
// mirror never fails a request — a duplicate (23505, backfill overlap) is
// swallowed silently, anything else logs with the greppable tag
// [MEMBERSHIPS DUAL-WRITE] and is repaired by re-running migration 140.
//
// Mirror UPDATE/DELETE writes filter kind='follow' AND scope_type='org'
// explicitly: during the transition every row is a follow/org row anyway, but
// the filter makes 0.3's future roster rows structurally unreachable from
// these legacy-shaped paths.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface OrgRef {
  side: OrgSide;
  orgId: string;
}

type WriteResult = { error: PostgrestError | null };

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

function legacyTable(side: OrgSide): 'league_members' | 'club_members' {
  return side === 'league' ? 'league_members' : 'club_members';
}

function logMirrorError(op: string, error: PostgrestError): void {
  if (error.code === '23505') return; // backfill/re-run overlap — expected
  console.error(`[MEMBERSHIPS DUAL-WRITE] ${op} mirror failed:`, error);
}

async function insertBoth(admin: Admin, ref: OrgRef, profileId: string, role?: 'owner'): Promise<WriteResult> {
  const col = orgColumn(ref.side);
  const row: Record<string, unknown> = { [col]: ref.orgId, profile_id: profileId };
  if (role) row.role = role;

  const { error } = await admin.from(legacyTable(ref.side)).insert(row);
  if (error) return { error };

  const { error: mirrorError } = await admin.from('memberships').insert(row);
  if (mirrorError) logMirrorError(role ? 'owner insert' : 'join', mirrorError);
  return { error: null };
}

/** POST join branch: the session user joins as a plain member (role default). */
export function joinOrg(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return insertBoth(admin, ref, profileId);
}

/** Org creation: the owner's role='owner' member row. */
export function insertOwnerRow(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return insertBoth(admin, ref, profileId, 'owner');
}

async function deleteBoth(admin: Admin, ref: OrgRef, profileId: string, op: string): Promise<WriteResult> {
  const col = orgColumn(ref.side);

  const { error } = await admin
    .from(legacyTable(ref.side))
    .delete()
    .eq(col, ref.orgId)
    .eq('profile_id', profileId);
  if (error) return { error };

  const { error: mirrorError } = await admin
    .from('memberships')
    .delete()
    .eq(col, ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org');
  if (mirrorError) logMirrorError(op, mirrorError);
  return { error: null };
}

/** POST leave branch: the session user leaves. */
export function leaveOrg(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return deleteBoth(admin, ref, profileId, 'leave');
}

/** DELETE route: owner/manager removes a plain member. */
export function removeMember(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return deleteBoth(admin, ref, profileId, 'remove');
}

/** PATCH route: the owner promotes/demotes between manager and member. */
export async function setMemberRole(
  admin: Admin,
  ref: OrgRef,
  profileId: string,
  role: 'manager' | 'member'
): Promise<WriteResult> {
  const col = orgColumn(ref.side);

  const { error } = await admin
    .from(legacyTable(ref.side))
    .update({ role })
    .eq(col, ref.orgId)
    .eq('profile_id', profileId);
  if (error) return { error };

  const { error: mirrorError } = await admin
    .from('memberships')
    .update({ role })
    .eq(col, ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org');
  if (mirrorError) logMirrorError('role update', mirrorError);
  return { error: null };
}

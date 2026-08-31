// ── Owner-set changes — the shared core behind both /owners routes (0.8) ────
// The roster-server pattern: thin league/club wrappers, the matrix ONCE here.
//
//   actor            target            verb    result
//   owner            member/manager    POST    role → owner, cache recompute,
//                                              notify ("You're now an owner")
//   owner            supervised        POST    403 (guardian rail — an owner
//                                              grant is worse than a roster spot)
//   owner            non-member        POST    400 (owners come from members)
//   owner            already owner     POST    400
//   non-owner        any               POST    403
//   owner (self)     not last owner    DELETE  own row → manager, cache moves
//                                              to earliest remaining owner
//   owner (self)     LAST owner        DELETE  400 — promote a co-owner first
//   anyone           ?profileId=other  DELETE  400 — the no-coup contract:
//                                              owners never remove each other
//
// TRANSFER = promote + step down (Tom, Aug 31): no dedicated endpoint; the
// two-owner window is the safe direction. Step-down ORDER matters: the
// primary cache is recomputed EXCLUDING self BEFORE the demote (a cache
// error aborts with nothing changed), so the column never names a
// non-owner. Concurrent step-downs are compensated: guarded demote →
// recount → zero owners left → restore own row + 409.
//
// The owner_profile_id column is a CACHE (earliest-joined owner, id
// tie-break) feeding display defaults + notification recipients only; all
// authorization reads the rows (authz.ts, rows-first since 0.8).

import { NextResponse } from 'next/server';
import type { PostgrestError, SupabaseClient, User } from '@supabase/supabase-js';
import { getOrgAndRole, roleAllows, type OrgRole, type OrgSide } from './authz';
import {
  demoteOwnerToManager,
  membershipEdges,
  ownerRows,
  promoteFollowToOwner,
  type OrgRef,
} from './members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

interface SideConfig {
  noun: 'league' | 'club';
  notFound: string;
  orgTable: 'leagues' | 'clubs';
}

const SIDES: Record<OrgSide, SideConfig> = {
  league: { noun: 'league', notFound: 'League not found', orgTable: 'leagues' },
  club: { noun: 'club', notFound: 'Club not found', orgTable: 'clubs' },
};

const SUPERVISED_MESSAGE =
  "Supervised athletes can't be made owners — guardian approval arrives with the guardian queue";

/** Pure promote gate — unit-tested. */
export function promoteGuard(input: {
  callerRole: OrgRole | null;
  targetFollowRole: OrgRole | null;
  targetSupervised: boolean;
}): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  if (!roleAllows(input.callerRole, 'manage_owners')) {
    return { ok: false, status: 403, error: 'Only owners can add owners' };
  }
  if (input.targetSupervised) {
    return { ok: false, status: 403, error: SUPERVISED_MESSAGE };
  }
  if (!input.targetFollowRole) {
    return { ok: false, status: 400, error: 'Only current members can be made owners' };
  }
  if (input.targetFollowRole === 'owner') {
    return { ok: false, status: 400, error: 'Already an owner' };
  }
  return { ok: true };
}

/** Pure step-down gate — unit-tested. */
export function stepDownGuard(input: {
  callerIsOwner: boolean;
  ownerCount: number;
}): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  if (!input.callerIsOwner) {
    return { ok: false, status: 403, error: 'Only owners can step down' };
  }
  if (input.ownerCount <= 1) {
    return { ok: false, status: 400, error: "You're the last owner — promote a co-owner first" };
  }
  return { ok: true };
}

async function supervisionState(admin: Admin, profileId: string): Promise<string | null | undefined> {
  const { data } = await admin
    .from('profiles')
    .select('id, supervision_state')
    .eq('id', profileId)
    .maybeSingle();
  return data ? (data.supervision_state as string | null) : undefined;
}

/** Recompute the primary-owner cache: earliest remaining owner (id
 *  tie-break). Zero owners → no-op + warn (the column is never NULLed by
 *  these paths — the invariant guards run first). Exported for
 *  account-deletion's pre-delete recompute. */
export async function recomputePrimaryOwner(
  admin: Admin,
  ref: OrgRef,
  opts?: { excludeProfileId?: string }
): Promise<{ error: PostgrestError | null }> {
  const { rows, error } = await ownerRows(admin, ref);
  if (error) return { error };
  const remaining = opts?.excludeProfileId
    ? rows.filter(r => r.profile_id !== opts.excludeProfileId)
    : rows;
  if (remaining.length === 0) {
    console.warn(`[ORG OWNERS] recompute found no owners for ${ref.side} ${ref.orgId} — cache untouched`);
    return { error: null };
  }
  const { error: updateError } = await admin
    .from(SIDES[ref.side].orgTable)
    .update({ owner_profile_id: remaining[0].profile_id })
    .eq('id', ref.orgId);
  return { error: updateError };
}

/** POST ?profileId= — an owner promotes a member/manager to co-owner. */
export async function promoteToOwner(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  targetProfileId: string
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ORG OWNERS] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const targetSupervision = await supervisionState(admin, targetProfileId);
  if (targetSupervision === undefined) {
    return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
  }

  const { followRole, error: edgesError } = await membershipEdges(admin, { side, orgId }, targetProfileId);
  if (edgesError) {
    console.error('[ORG OWNERS] edges fetch error:', edgesError);
    return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
  }

  const gate = promoteGuard({
    callerRole: loaded.role,
    targetFollowRole: followRole,
    targetSupervised: targetSupervision === 'supervised',
  });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { updated, error } = await promoteFollowToOwner(admin, { side, orgId }, targetProfileId);
  if (error) {
    console.error('[ORG OWNERS] promote error:', error);
    return NextResponse.json({ error: 'Failed to add the owner' }, { status: 500 });
  }
  if (!updated) {
    // Raced away (left, or promoted by someone else between read and write).
    return NextResponse.json({ error: 'Only current members can be made owners' }, { status: 400 });
  }

  // Non-fatal convergence: a promoted member joined after creation, so the
  // earliest owner rarely changes — but ties deserve the deterministic pick.
  const { error: cacheError } = await recomputePrimaryOwner(admin, { side, orgId });
  if (cacheError) console.warn('[ORG OWNERS] cache recompute failed:', cacheError);

  await notifyOwnerPromoted(admin, side, orgId, loaded.org.name, targetProfileId);
  return NextResponse.json({ action: 'promoted' });
}

/** DELETE — the caller steps down (self only; the route 400s a foreign
 *  profileId before reaching here). */
export async function stepDownAsOwner(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ORG OWNERS] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const { rows, error: ownersError } = await ownerRows(admin, { side, orgId });
  if (ownersError) {
    console.error('[ORG OWNERS] owner list error:', ownersError);
    return NextResponse.json({ error: 'Failed to check ownership' }, { status: 500 });
  }
  const gate = stepDownGuard({
    callerIsOwner: rows.some(r => r.profile_id === user.id),
    ownerCount: rows.length,
  });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  // Cache first, EXCLUDING self: a failure here aborts with nothing changed
  // (the caller is still an owner), and the column never names a non-owner.
  const { error: cacheError } = await recomputePrimaryOwner(
    admin,
    { side, orgId },
    { excludeProfileId: user.id }
  );
  if (cacheError) {
    console.error('[ORG OWNERS] cache recompute failed:', cacheError);
    return NextResponse.json({ error: 'Failed to step down' }, { status: 500 });
  }

  const { updated, error } = await demoteOwnerToManager(admin, { side, orgId }, user.id);
  if (error) {
    console.error('[ORG OWNERS] demote error:', error);
    return NextResponse.json({ error: 'Failed to step down' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Ownership changed — try again' }, { status: 409 });
  }

  // TOCTOU compensation: two co-owners stepping down concurrently can both
  // pass the count. Recount; zero owners left → restore own row + 409.
  const { rows: after } = await ownerRows(admin, { side, orgId });
  if (after.length === 0) {
    await promoteFollowToOwner(admin, { side, orgId }, user.id);
    await recomputePrimaryOwner(admin, { side, orgId });
    return NextResponse.json({ error: 'Ownership changed — try again' }, { status: 409 });
  }

  // Quiet — a self-action (the withdraw-quiet precedent).
  return NextResponse.json({ action: 'stepped_down' });
}

async function notifyOwnerPromoted(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string,
  profileId: string
): Promise<void> {
  if (side === 'league') {
    const { notifyLeagueRole } = await import('@/lib/leagues/notify');
    await notifyLeagueRole(admin, { profileId, leagueId: orgId, leagueName: orgName, role: 'owner' });
  } else {
    const { notifyClubRole } = await import('@/lib/clubs/notify');
    await notifyClubRole(admin, { profileId, clubId: orgId, clubName: orgName, role: 'owner' });
  }
}

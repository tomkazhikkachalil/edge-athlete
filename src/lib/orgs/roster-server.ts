// ── Roster offers — the shared core behind both /roster routes (0.3) ───────
// The affiliations/server.ts pattern: league/club routes are thin wrappers,
// the authorization matrix lives ONCE here.
//
//   actor                     target state          verb    result
//   manager (manage_members)  follow, no roster     POST    pending row + offer notification
//   manager                   no follow row         POST    400 (roster ⊆ follow — v1 invariant)
//   manager                   supervised target     POST    403 (see below)
//   manager                   pending / active      POST    400 already invited / already on roster
//   athlete (self)            pending               PATCH   status → active, notify owner
//   athlete (self)            pending               DELETE  row deleted (declined), notify owner
//   athlete (self)            active                DELETE  row deleted (left), quiet
//   manager ?profileId        pending               DELETE  row deleted (cancelled), quiet
//   manager ?profileId        active                DELETE  row deleted (removed), notify athlete
//   anyone else               any                   any     403
//
// SECURITY — guardian rail: a SUPERVISED athlete cannot be offered a roster
// spot (403) and cannot accept one, until 0.10 routes the offer through the
// guardian queue. Without this gate a pending row a child can self-accept
// would bypass that future queue. Checked at POST (target) AND PATCH
// (session user) — defense in depth on a child-safety-adjacent path.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getOrgAndRole, roleAllows, type OrgSide } from './authz';
import {
  acceptRosterOffer,
  deleteRosterRow,
  insertRosterOffer,
  membershipEdges,
  type RosterStatus,
} from './members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

interface SideConfig {
  noun: 'league' | 'club';
  notFound: string;
}

const SIDES: Record<OrgSide, SideConfig> = {
  league: { noun: 'league', notFound: 'League not found' },
  club: { noun: 'club', notFound: 'Club not found' },
};

const SUPERVISED_MESSAGE =
  "Supervised athletes can't be invited to rosters yet — guardian approval arrives with the guardian queue";

/** Pure outcome decision for DELETE — exported for unit tests. */
export function rosterDeleteOutcome(input: {
  isSelf: boolean;
  status: RosterStatus;
}): 'declined' | 'left' | 'cancelled' | 'removed' {
  if (input.isSelf) return input.status === 'pending' ? 'declined' : 'left';
  return input.status === 'pending' ? 'cancelled' : 'removed';
}

async function supervisionState(admin: Admin, profileId: string): Promise<string | null | undefined> {
  const { data } = await admin
    .from('profiles')
    .select('id, supervision_state')
    .eq('id', profileId)
    .maybeSingle();
  // undefined = profile missing; null/other = state
  return data ? (data.supervision_state as string | null) : undefined;
}

/** POST ?profileId= — a manager offers a roster spot to an existing member. */
export async function rosterPost(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  targetProfileId: string
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }
  if (!roleAllows(loaded.role, 'manage_members')) {
    return NextResponse.json({ error: 'Not authorized to manage the roster' }, { status: 403 });
  }

  const targetSupervision = await supervisionState(admin, targetProfileId);
  if (targetSupervision === undefined) {
    return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
  }
  if (targetSupervision === 'supervised') {
    return NextResponse.json({ error: SUPERVISED_MESSAGE }, { status: 403 });
  }

  const { followRole, rosterStatus, error: edgesError } = await membershipEdges(
    admin,
    { side, orgId },
    targetProfileId
  );
  if (edgesError) {
    console.error('[ROSTER] edges fetch error:', edgesError);
    return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
  }
  if (!followRole) {
    return NextResponse.json(
      { error: 'Only current members can be invited to the roster' },
      { status: 400 }
    );
  }
  if (rosterStatus === 'pending') {
    return NextResponse.json({ error: 'Already invited to the roster' }, { status: 400 });
  }
  if (rosterStatus === 'active') {
    return NextResponse.json({ error: 'Already on the roster' }, { status: 400 });
  }

  const { error: insertError } = await insertRosterOffer(admin, { side, orgId }, targetProfileId);
  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ error: 'Already invited to the roster' }, { status: 400 });
    }
    console.error('[ROSTER] offer insert error:', insertError);
    return NextResponse.json({ error: 'Failed to send the invitation' }, { status: 500 });
  }

  await notifyOffer(admin, side, orgId, loaded.org.name, targetProfileId);
  return NextResponse.json({ action: 'invited' });
}

/** PATCH { action: 'accept' } — the athlete accepts their own pending offer. */
export async function rosterPatch(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const selfSupervision = await supervisionState(admin, user.id);
  if (selfSupervision === 'supervised') {
    return NextResponse.json({ error: SUPERVISED_MESSAGE }, { status: 403 });
  }

  const { accepted, error } = await acceptRosterOffer(admin, { side, orgId }, user.id);
  if (error) {
    console.error('[ROSTER] accept error:', error);
    return NextResponse.json({ error: 'Failed to accept the invitation' }, { status: 500 });
  }
  if (!accepted) {
    return NextResponse.json({ error: 'No pending roster invitation' }, { status: 404 });
  }

  await notifyResult(admin, side, orgId, loaded.org, user.id, 'accepted');
  return NextResponse.json({ action: 'accepted' });
}

/** DELETE [?profileId=] — self decline/leave, or manager cancel/remove. */
export async function rosterDelete(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  targetProfileId: string | null
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const target = targetProfileId ?? user.id;
  const isSelf = target === user.id;
  if (!isSelf && !roleAllows(loaded.role, 'manage_members')) {
    return NextResponse.json({ error: 'Not authorized to manage the roster' }, { status: 403 });
  }

  const { rosterStatus, error: edgesError } = await membershipEdges(admin, { side, orgId }, target);
  if (edgesError) {
    console.error('[ROSTER] edges fetch error:', edgesError);
    return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
  }
  if (!rosterStatus) {
    return NextResponse.json(
      { error: isSelf ? 'No pending roster invitation' : 'Not on the roster' },
      { status: 404 }
    );
  }

  const { deleted, error } = await deleteRosterRow(admin, { side, orgId }, target);
  if (error || !deleted) {
    console.error('[ROSTER] delete error:', error);
    return NextResponse.json({ error: 'Failed to update the roster' }, { status: 500 });
  }

  const action = rosterDeleteOutcome({ isSelf, status: rosterStatus });
  if (action === 'declined') {
    await notifyResult(admin, side, orgId, loaded.org, user.id, 'declined');
  } else if (action === 'removed') {
    await notifyRemoved(admin, side, orgId, loaded.org.name, target);
  }
  return NextResponse.json({ action });
}

// ── Notifications (best-effort; never fail the request) ─────────────────────

async function notifyOffer(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string,
  profileId: string
): Promise<void> {
  if (side === 'league') {
    const { notifyRosterOffer } = await import('@/lib/leagues/notify');
    await notifyRosterOffer(admin, { profileId, leagueId: orgId, leagueName: orgName });
  } else {
    const { notifyRosterOffer } = await import('@/lib/clubs/notify');
    await notifyRosterOffer(admin, { profileId, clubId: orgId, clubName: orgName });
  }
}

async function notifyResult(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  org: { name: string; owner_profile_id: string | null },
  actorId: string,
  result: 'accepted' | 'declined'
): Promise<void> {
  if (!org.owner_profile_id || org.owner_profile_id === actorId) return;
  if (side === 'league') {
    const { notifyRosterResult } = await import('@/lib/leagues/notify');
    await notifyRosterResult(admin, {
      ownerProfileId: org.owner_profile_id,
      actorId,
      leagueId: orgId,
      leagueName: org.name,
      result,
    });
  } else {
    const { notifyRosterResult } = await import('@/lib/clubs/notify');
    await notifyRosterResult(admin, {
      ownerProfileId: org.owner_profile_id,
      actorId,
      clubId: orgId,
      clubName: org.name,
      result,
    });
  }
}

async function notifyRemoved(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string,
  profileId: string
): Promise<void> {
  if (side === 'league') {
    const { notifyRosterRemoved } = await import('@/lib/leagues/notify');
    await notifyRosterRemoved(admin, { profileId, leagueId: orgId, leagueName: orgName });
  } else {
    const { notifyRosterRemoved } = await import('@/lib/clubs/notify');
    await notifyRosterRemoved(admin, { profileId, clubId: orgId, clubName: orgName });
  }
}

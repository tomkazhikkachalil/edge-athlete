// ── Roster offers — the shared core behind both /roster routes (0.3/0.10) ───
// The affiliations/server.ts pattern: league/club routes are thin wrappers,
// the authorization matrix lives ONCE here.
//
//   actor                     target state          verb    result
//   manager (manage_members)  follow, no roster     POST    pending row + offer notification
//   manager                   no follow row         POST    400 (roster ⊆ follow — v1 invariant)
//   manager                   supervised target     POST    flag OFF: 403; flag ON: pending row
//                                                           + child bell + GUARDIAN roster_invite
//   manager                   pending / active      POST    400 already invited / already on roster
//   athlete (self)            pending               PATCH   status → active, notify owner
//   supervised athlete (self) pending               PATCH   flag OFF: 403; flag ON: accepted
//                                                           (either-approves) + guardians told
//   guardian (profileId)      pending               PATCH   status → active (acting-for), child told
//   athlete (self)            pending               DELETE  row deleted (declined), notify owner
//   athlete (self)            active                DELETE  row deleted (left), quiet
//   guardian (as=guardian)    pending/active        DELETE  self-equivalent acting-for, child told
//   manager ?profileId        pending               DELETE  row deleted (cancelled), quiet
//   manager ?profileId        active                DELETE  row deleted (removed), notify athlete
//   anyone else               any                   any     403
//
// SECURITY — guardian rail (0.10, EITHER-APPROVES per Tom; its launch
// flag retired in the consolidation round — the flow below is PERMANENT
// and must never regrow a flag): an offer to a supervised athlete
// creates the pending row, guardians are belled (roster_invite) and see
// it in the guardian queue, and EITHER the child or a guardian accepts —
// the follow convention. Whoever didn't act is told (followers/route.ts
// cross-notify model). Guardian acting-for arrives pre-authorized from
// the routes (requireProfileRole 'manage_privacy'); this core trusts
// actingFor only when the route vouches for it.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { capabilityAllows, getOrgAndCapabilities, getOrgAndRole, type OrgSide } from './authz';
import {
  acceptRosterOffer,
  deleteRosterRow,
  insertRosterOffer,
  membershipEdges,
  pickRosterEdge,
  type RosterStatus,
} from './members';
import { canGrantPhotoConsent, setPhotoConsent } from './photo-consent';

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
  const loaded = await getOrgAndCapabilities(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }
  if (!capabilityAllows(loaded.caps, 'manage_members')) {
    return NextResponse.json({ error: 'Not authorized to manage the roster' }, { status: 403 });
  }

  const targetSupervision = await supervisionState(admin, targetProfileId);
  if (targetSupervision === undefined) {
    return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
  }
  const targetSupervised = targetSupervision === 'supervised';

  const { followRole, rosterEdges, error: edgesError } = await membershipEdges(
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
  // Phase 5: one live workflow per athlete per org. Any live edge —
  // NULL-season invite/membership OR a season registration — blocks a new
  // invite with a status-specific message (this also kills the old
  // re-offer → 23505 path at the source). Only 'released' edges permit
  // re-inviting: that workflow is over.
  const liveEdge = pickRosterEdge(rosterEdges.filter(e => e.status !== 'released'));
  if (liveEdge) {
    const message =
      liveEdge.status === 'pending'
        ? 'Already invited to the roster'
        : liveEdge.status === 'active'
          ? 'Already on the roster'
          : liveEdge.status === 'placed'
            ? 'Already placed on a team this season'
            : 'Already registered for this season';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: insertError } = await insertRosterOffer(admin, { side, orgId }, targetProfileId);
  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ error: 'Already invited to the roster' }, { status: 400 });
    }
    console.error('[ROSTER] offer insert error:', insertError);
    return NextResponse.json({ error: 'Failed to send the invitation' }, { status: 500 });
  }

  // Parallel-notify (Tom, 0.10): the child keeps their own offer bell,
  // and a supervised child's guardians get the roster_invite half.
  await notifyOffer(admin, side, orgId, loaded.org.name, targetProfileId);
  if (targetSupervised) {
    await notifyGuardiansOfRoster(admin, side, orgId, loaded.org.name, targetProfileId, 'offer', user.id);
  }
  return NextResponse.json({ action: 'invited' });
}

/** PATCH { action: 'accept', profileId?, photoConsent? } — the athlete
 *  (or, acting for a supervised athlete, their guardian — pre-authorized
 *  by the route via requireProfileRole) accepts the pending offer.
 *  photoConsent (phase 4 R4) is written only when canGrantPhotoConsent
 *  passes — a supervised child ticking the box leaves NULL, which is
 *  what generates the guardian queue's ask; a pre-159 database drops it
 *  silently (the accept must never break). */
export async function rosterPatch(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  actingFor?: string,
  photoConsent?: boolean
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const target = actingFor ?? user.id;
  const guardianActing = target !== user.id;
  const loaded = await getOrgAndRole(admin, side, orgId, target);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const targetSupervision = await supervisionState(admin, target);
  const targetSupervised = targetSupervision === 'supervised';

  const { accepted, error } = await acceptRosterOffer(admin, { side, orgId }, target);
  if (error) {
    console.error('[ROSTER] accept error:', error);
    return NextResponse.json({ error: 'Failed to accept the invitation' }, { status: 500 });
  }
  if (!accepted) {
    return NextResponse.json({ error: 'No pending roster invitation' }, { status: 404 });
  }

  // Phase 4 R4: record the consent decision when the accepting actor has
  // the authority; otherwise leave NULL (never asked) so the guardian
  // queue asks. Best-effort by design — the accept already succeeded.
  let consentRecorded = false;
  if (
    photoConsent !== undefined &&
    canGrantPhotoConsent({
      actorIsSelf: !guardianActing,
      actorIsGuardian: guardianActing,
      subjectSupervised: targetSupervised,
    })
  ) {
    consentRecorded =
      (await setPhotoConsent(admin, side, orgId, target, photoConsent, user.id)) === 'ok';
  }

  await notifyResult(admin, side, orgId, loaded.org, user.id, 'accepted');
  // Either-approves cross-notify: whoever didn't act hears about it.
  if (targetSupervised) {
    if (guardianActing) {
      await notifyChildOfGuardianDecision(admin, side, orgId, loaded.org.name, target, 'accepted');
    } else {
      await notifyGuardiansOfRoster(admin, side, orgId, loaded.org.name, target, 'accepted', user.id);
    }
  }
  return NextResponse.json({ action: 'accepted', photoConsentRecorded: consentRecorded });
}

/** PATCH { action: 'set_photo_consent', profileId?, consent } — the
 *  standalone consent toggle (phase 4 R4): an adult athlete for
 *  themselves, or a guardian acting for a supervised athlete
 *  (pre-authorized by the route). Orgs never reach this path. Revoking
 *  purges the public site so the R5 gallery drops the media within the
 *  ISR window. */
export async function rosterConsentPatch(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  consent: boolean,
  actingFor?: string
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const target = actingFor ?? user.id;
  const guardianActing = target !== user.id;
  const loaded = await getOrgAndRole(admin, side, orgId, target);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const targetSupervision = await supervisionState(admin, target);
  if (targetSupervision === undefined) {
    return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
  }
  if (
    !canGrantPhotoConsent({
      actorIsSelf: !guardianActing,
      actorIsGuardian: guardianActing,
      subjectSupervised: targetSupervision === 'supervised',
    })
  ) {
    return NextResponse.json(
      { error: 'Photo consent for a supervised athlete is a guardian decision' },
      { status: 403 }
    );
  }

  const result = await setPhotoConsent(admin, side, orgId, target, consent, user.id);
  if (result === 'no_row') {
    return NextResponse.json({ error: 'Not on the roster' }, { status: 404 });
  }
  if (result === 'unavailable') {
    return NextResponse.json(
      { error: 'Photo consent isn’t set up yet — ask your admin (migration 159)' },
      { status: 400 }
    );
  }
  if (result === 'error') {
    return NextResponse.json({ error: 'Failed to update photo consent' }, { status: 500 });
  }
  await revalidateOrgSiteForOrg(admin, side, orgId);
  return NextResponse.json({ action: 'photo_consent', consent });
}

/** DELETE [?profileId=] — self decline/leave, manager cancel/remove, or
 *  (guardianActing, pre-authorized by the route) a guardian declining/
 *  leaving on their supervised athlete's behalf — the self-equivalent path. */
export async function rosterDelete(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  targetProfileId: string | null,
  guardianActing = false
): Promise<NextResponse> {
  const cfg = SIDES[side];
  const loaded = await getOrgAndCapabilities(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[ROSTER] org fetch error:', loaded.error);
    return NextResponse.json({ error: `Failed to load ${cfg.noun}` }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json({ error: cfg.notFound }, { status: 404 });
  }

  const target = targetProfileId ?? user.id;
  // A guardian acting for their child takes the SELF path (refusing a spot
  // is the athlete side of the matrix, never the org side — the safety
  // boundary keeps the two authorities separate).
  const isSelf = target === user.id || guardianActing;
  if (!isSelf && !capabilityAllows(loaded.caps, 'manage_members')) {
    return NextResponse.json({ error: 'Not authorized to manage the roster' }, { status: 403 });
  }

  const { rosterEdges, error: edgesError } = await membershipEdges(admin, { side, orgId }, target);
  if (edgesError) {
    console.error('[ROSTER] edges fetch error:', edgesError);
    return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
  }
  // This flow acts ONLY on the NULL-season edge (invite/legacy membership):
  // season registration rows move through registration-server's
  // transitions, never a roster DELETE (deleteRosterRow is season-pinned
  // to match).
  const rosterStatus = pickRosterEdge(rosterEdges, null)?.status ?? null;
  if (!rosterStatus) {
    const hasSeasonEdge = rosterEdges.length > 0;
    return NextResponse.json(
      {
        error: hasSeasonEdge
          ? 'This membership is a season registration — manage it from the registrations screen'
          : isSelf
            ? 'No pending roster invitation'
            : 'Not on the roster',
      },
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
  // Cross-notify on the supervised decline path (leaves stay quiet — the
  // withdraw-quiet precedent).
  if (action === 'declined') {
    const targetSupervision = await supervisionState(admin, target);
    if (targetSupervision === 'supervised') {
      if (guardianActing) {
        await notifyChildOfGuardianDecision(admin, side, orgId, loaded.org.name, target, 'declined');
      } else {
        await notifyGuardiansOfRoster(admin, side, orgId, loaded.org.name, target, 'declined', user.id);
      }
    }
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

/** The guardian half (0.10, roster_invite): offer → "you or your athlete
 *  can accept"; accepted/declined by the child → the guardians hear.
 *  Direct-insert convention via notifyGuardians; actorId excludes the
 *  acting guardian from their own bell. */
async function notifyGuardiansOfRoster(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string,
  childProfileId: string,
  event: 'offer' | 'accepted' | 'declined',
  actorId: string
): Promise<void> {
  try {
    const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
    const childName = await profileFirstName(admin, childProfileId);
    const title =
      event === 'offer'
        ? `${orgName} invited ${childName} to its roster`
        : `${childName} ${event} the roster invitation from ${orgName}`;
    await notifyGuardians(
      admin,
      childProfileId,
      {
        type: 'roster_invite',
        title,
        message: event === 'offer' ? 'You or your athlete can accept or decline.' : null,
        actionUrl: '/app/guardian',
        actorId,
        metadata: { [side === 'league' ? 'league_id' : 'club_id']: orgId, roster: event },
      },
      actorId
    );
  } catch (e) {
    console.error('[ROSTER] guardian notify failed:', e);
  }
}

/** The child half of a guardian decision — rides league/club_update like
 *  every athlete-facing roster bell (metadata.roster disambiguates; direct
 *  insert per the org-sender convention — the RPC would drop it). */
async function notifyChildOfGuardianDecision(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string,
  childProfileId: string,
  result: 'accepted' | 'declined'
): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: childProfileId,
      type: side === 'league' ? 'league_update' : 'club_update',
      actor_id: null,
      title: `Your guardian ${result} the roster invitation from ${orgName}`,
      message: null,
      action_url: side === 'league' ? `/league/${orgId}` : `/club/${orgId}`,
      is_read: false,
      metadata: { [side === 'league' ? 'league_id' : 'club_id']: orgId, roster: result },
    });
    if (error) console.error('[ROSTER] child notify failed:', error);
  } catch (e) {
    console.error('[ROSTER] child notify failed:', e);
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

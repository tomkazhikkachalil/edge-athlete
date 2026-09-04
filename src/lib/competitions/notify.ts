// ── Competition entry notifications (phase 2 R4) ────────────────────────────
// The leagues/notify charter: never-throws best-effort, DIRECT admin
// inserts (create_notification's preference gate has no branch for these
// types and would silently drop them), self-contained titles (they land
// verbatim in the email digest), metadata as the e2e disambiguator.
// Marker dedup is unnecessary here — each sender fires once per explicit
// manager action, not per fan-out sweep.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[COMPETITION NOTIFY]';

/** Owner|manager profile ids for one org (follow rows, org scope). */
async function orgManagerIds(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<string[]> {
  const col = side === 'league' ? 'league_id' : 'club_id';
  const { data } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(col, orgId)
    .eq('scope_type', 'org')
    // Org staff program: org-scope admins are managers for bells too.
    .in('kind', ['follow', 'staff'])
    .in('role', ['owner', 'manager', 'admin'])
    .limit(200);
  return [...new Set((data ?? []).map(r => r.profile_id as string))];
}

/** A cross-org entry awaits the owner org's decision. Belled to the
 *  owner's managers minus the actor (self-noise guard — v1 adds are
 *  owner-initiated; club-initiated requests reuse this unchanged). */
export async function notifyEntryPending(
  admin: Admin,
  input: {
    ownerSide: OrgSide;
    ownerOrgId: string;
    competitionId: string;
    competitionName: string;
    teamName: string;
    actorId: string;
  }
): Promise<void> {
  try {
    const managers = (await orgManagerIds(admin, input.ownerSide, input.ownerOrgId)).filter(
      id => id !== input.actorId
    );
    if (managers.length === 0) return;
    const { error } = await admin.from('notifications').insert(
      managers.map(userId => ({
        user_id: userId,
        type: 'competition_entry_pending',
        actor_id: input.actorId,
        title: `${input.teamName} awaits approval in ${input.competitionName}`,
        message: 'Review the entry from the competition console.',
        action_url: `/app/org/${input.ownerSide}/${input.ownerOrgId}/competitions/${input.competitionId}`,
        is_read: false,
        metadata: { competition_id: input.competitionId, entry: 'pending' },
      }))
    );
    if (error) console.error(`${TAG} pending insert failed:`, error);
  } catch (e) {
    console.error(`${TAG} pending failed:`, e);
  }
}

/** The owner decided — belled to the ENTERING club's managers. */
export async function notifyEntryDecided(
  admin: Admin,
  input: {
    clubId: string;
    competitionId: string;
    competitionName: string;
    teamName: string;
    decision: 'approved' | 'rejected';
    actorId: string;
  }
): Promise<void> {
  try {
    const managers = await orgManagerIds(admin, 'club', input.clubId);
    if (managers.length === 0) return;
    const { error } = await admin.from('notifications').insert(
      managers.map(userId => ({
        user_id: userId,
        type: 'competition_entry_decided',
        actor_id: null,
        title:
          input.decision === 'approved'
            ? `${input.teamName} is in: ${input.competitionName} approved the entry`
            : `${input.teamName}'s entry to ${input.competitionName} was declined`,
        message:
          input.decision === 'approved'
            ? 'The schedule will include your team as games are added.'
            : 'The organizing league declined this entry.',
        action_url: `/club/${input.clubId}`,
        is_read: false,
        metadata: { competition_id: input.competitionId, entry: input.decision },
      }))
    );
    if (error) console.error(`${TAG} decided insert failed:`, error);
  } catch (e) {
    console.error(`${TAG} decided failed:`, e);
  }
}

/** Phase 6 R4: dispute raised/resolved — belled to every org with
 *  standing (owner + participating orgs) minus the actor. Best-effort:
 *  a 23514 on a pre-168 CHECK drops the bell, never the transition. */
export async function notifyDispute(
  admin: Admin,
  input: {
    orgs: { side: OrgSide; orgId: string }[];
    actorId: string;
    competitionId: string;
    kind: 'raised' | 'resolved' | null;
    note: string | null;
    side: OrgSide;
    orgId: string;
  }
): Promise<void> {
  if (!input.kind) return; // withdraw is quiet — the raise bell said enough
  try {
    const { data: comp } = await admin
      .from('competitions')
      .select('name')
      .eq('id', input.competitionId)
      .maybeSingle();
    const compName = (comp?.name as string | undefined) ?? 'a competition';
    const managerLists = await Promise.all(
      input.orgs.map(o => orgManagerIds(admin, o.side, o.orgId))
    );
    const recipients = [...new Set(managerLists.flat())].filter(id => id !== input.actorId);
    if (recipients.length === 0) return;
    const { error } = await admin.from('notifications').insert(
      recipients.map(userId => ({
        user_id: userId,
        type: input.kind === 'raised' ? 'contest_dispute_raised' : 'contest_dispute_resolved',
        actor_id: null,
        title:
          input.kind === 'raised'
            ? `A result in ${compName} was disputed`
            : `A disputed result in ${compName} was resolved`,
        message: input.kind === 'raised' ? (input.note || null) : null,
        action_url: `/app/org/${input.side}/${input.orgId}/competitions/${input.competitionId}`,
        is_read: false,
        metadata: { competition_id: input.competitionId },
      }))
    );
    if (error) console.error(`${TAG} dispute insert failed:`, error);
  } catch (e) {
    console.error(`${TAG} dispute failed:`, e);
  }
}

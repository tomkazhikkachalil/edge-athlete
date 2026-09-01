// ── Registration notifications (phase 5 R4, mig 163) ────────────────────────
// The competitions/notify charter: never-throws best-effort, DIRECT
// admin inserts (create_notification's preference gate would silently
// drop these types), self-contained titles (they land verbatim in the
// email digest), metadata as the e2e disambiguator. A 23514 on a
// pre-163 CHECK only drops the bell — never the transition.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { notifyGuardians } from '@/lib/guardian-notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[REGISTRATION NOTIFY]';

/** Owner|manager profile ids for one org (follow rows, org scope) — the
 *  registrar audience until dedicated Registrar roles exist. */
async function orgManagerIds(admin: Admin, side: OrgSide, orgId: string): Promise<string[]> {
  const col = side === 'league' ? 'league_id' : 'club_id';
  const { data } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(col, orgId)
    .eq('scope_type', 'org')
    .eq('kind', 'follow')
    .in('role', ['owner', 'manager'])
    .limit(200);
  return [...new Set((data ?? []).map(r => r.profile_id as string))];
}

/** A new registration arrived — belled to the org's managers minus the
 *  submitter (a manager registering their own kid needs no self-bell). */
export async function notifyRegistrationReceived(
  admin: Admin,
  input: {
    side: OrgSide;
    orgId: string;
    athleteName: string;
    offeringName: string;
    actorId: string;
  }
): Promise<void> {
  try {
    const managers = (await orgManagerIds(admin, input.side, input.orgId)).filter(
      id => id !== input.actorId
    );
    if (managers.length === 0) return;
    const { error } = await admin.from('notifications').insert(
      managers.map(userId => ({
        user_id: userId,
        type: 'org_registration_received',
        actor_id: input.actorId,
        title: `${input.athleteName} registered for ${input.offeringName}`,
        message: 'Review and place from the registrations screen.',
        action_url: `/app/org/${input.side}/${input.orgId}`,
        is_read: false,
        metadata: { registration: 'received' },
      }))
    );
    if (error) console.error(`${TAG} received insert failed:`, error);
  } catch (e) {
    console.error(`${TAG} received failed:`, e);
  }
}

/** Placed / released — belled to the athlete, and (when supervised) to
 *  their guardians via the roster-invite cross-notify model. */
export async function notifyRegistrationDecision(
  admin: Admin,
  input: {
    side: OrgSide;
    orgId: string;
    orgName: string;
    profileId: string;
    supervised: boolean;
    decision: 'placed' | 'released';
    teamName?: string | null;
    actorId: string;
  }
): Promise<void> {
  const type =
    input.decision === 'placed' ? 'org_registration_placed' : 'org_registration_released';
  const title =
    input.decision === 'placed'
      ? `Placed${input.teamName ? ` on ${input.teamName}` : ''} at ${input.orgName}`
      : `Released from ${input.orgName}'s season roster`;
  const message =
    input.decision === 'placed'
      ? 'Schedules, stats and team media attach to this roster spot.'
      : 'Contact the organization if this looks wrong.';
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: input.profileId,
      type,
      actor_id: null,
      title,
      message,
      action_url: `/${input.side}/${input.orgId}`,
      is_read: false,
      metadata: { registration: input.decision },
    });
    if (error) console.error(`${TAG} decision insert failed:`, error);
    if (input.supervised) {
      await notifyGuardians(
        admin,
        input.profileId,
        {
          type,
          actorId: input.actorId,
          title,
          message,
          actionUrl: `/${input.side}/${input.orgId}`,
          metadata: { registration: input.decision },
        },
        input.actorId
      );
    }
  } catch (e) {
    console.error(`${TAG} decision failed:`, e);
  }
}

// ── Team roster notices (teams & divisions program, PR 4; mig 242) ───────────
// The registration/notify.ts charter: never throws, a DIRECT insert
// (create_notification's preference gate would drop the type), a
// self-contained title (it lands verbatim in the email digest), and
// `metadata.team_roster` as the e2e disambiguator. The player hears; a
// supervised player's guardians get a copy naming the child. A failed bell
// never fails the roster change.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgKind } from '@/lib/orgs/org-ref';
import { notifyGuardians, profileFirstName } from '@/lib/guardian-notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[TEAM ROSTER NOTIFY]';

export type TeamRosterNotice =
  | { kind: 'added'; teamName: string }
  | { kind: 'moved'; fromName: string; teamName: string }
  | { kind: 'removed'; teamName: string }
  | { kind: 'carried'; teamName: string; seasonLabel: string };

/** PURE: the player's title and message (exported for the unit test). */
export function teamRosterCopy(n: TeamRosterNotice, orgName: string, who: string | null = null): { title: string; message: string } {
  const subject = who ?? 'You';
  const verb = (you: string, them: string) => (who ? them : you);
  switch (n.kind) {
    case 'added':
      return { title: `${subject} ${verb('were', 'was')} added to ${n.teamName} at ${orgName}`, message: 'Team events, schedules and stats attach to this spot.' };
    case 'moved':
      return { title: `${subject} moved from ${n.fromName} to ${n.teamName} at ${orgName}`, message: 'Your team events and schedule follow the new team.' };
    case 'removed':
      return { title: `${subject} ${verb('were', 'was')} taken off ${n.teamName} at ${orgName}`, message: 'Past results stay on the record. Contact the organization if this looks wrong.' };
    case 'carried':
      return { title: `${subject} ${verb('are', 'is')} on ${n.teamName} again for ${n.seasonLabel} at ${orgName}`, message: 'Your spot carried forward to the new season.' };
  }
}

export async function notifyTeamRoster(
  admin: Admin,
  input: { side: OrgKind; orgId: string; orgName: string; profileId: string; actorId: string; notice: TeamRosterNotice }
): Promise<void> {
  const actionUrl = `/${input.side}/${input.orgId}`;
  const metadata = { team_roster: input.notice.kind };
  try {
    const own = teamRosterCopy(input.notice, input.orgName);
    const { error } = await admin.from('notifications').insert({
      user_id: input.profileId,
      type: 'team_roster',
      actor_id: null,
      title: own.title,
      message: own.message,
      action_url: actionUrl,
      is_read: false,
      metadata,
    });
    if (error) console.error(`${TAG} insert failed:`, error);

    const { data: profile } = await admin.from('profiles').select('supervision_state').eq('id', input.profileId).maybeSingle();
    if ((profile as { supervision_state?: string } | null)?.supervision_state === 'supervised') {
      const name = await profileFirstName(admin, input.profileId);
      const copy = teamRosterCopy(input.notice, input.orgName, name);
      await notifyGuardians(admin, input.profileId, { type: 'team_roster', actorId: input.actorId, title: copy.title, message: copy.message, actionUrl, metadata }, input.actorId);
    }
  } catch (e) {
    console.error(`${TAG} failed:`, e);
  }
}

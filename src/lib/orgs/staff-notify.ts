// ── Staff bells (org staff program, 178) ────────────────────────────────────
// org_staff_invite → the invitee (only when the email already has a
// profile; the link is the guaranteed channel either way);
// org_staff_accepted → the org's owners; org_staff_revoked → the person.
// Never-throws (the leagues/notify.ts contract).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[STAFF NOTIFY]';

async function insertBell(admin: Admin, row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({ is_read: false, actor_id: null, message: null, ...row });
    if (error) console.error(`${TAG} insert failed:`, error);
  } catch (e) {
    console.error(`${TAG} insert failed:`, e);
  }
}

/** Bell the invitee if their email already has an account. */
export async function notifyStaffInvite(
  admin: Admin,
  n: { invitedEmail: string; side: OrgSide; orgId: string; orgName: string; summary: string; inviteUrlPath: string }
): Promise<boolean> {
  const { data: profile } = await admin.from('profiles').select('id').eq('email', n.invitedEmail.toLowerCase()).maybeSingle();
  if (!profile) return false;
  await insertBell(admin, {
    user_id: profile.id,
    type: 'org_staff_invite',
    title: `${n.orgName} invited you to help run it — ${n.summary}`,
    action_url: n.inviteUrlPath,
    metadata: { [n.side === 'league' ? 'league_id' : 'club_id']: n.orgId },
  });
  return true;
}

/** The org's owners hear that someone accepted. */
export async function notifyStaffAccepted(
  admin: Admin,
  n: { side: OrgSide; orgId: string; orgName: string; personName: string; summary: string; exceptProfileId: string }
): Promise<void> {
  const col = n.side === 'league' ? 'league_id' : 'club_id';
  const { data } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(col, n.orgId)
    .eq('scope_type', 'org')
    .eq('kind', 'follow')
    .eq('role', 'owner')
    .limit(50);
  const owners = [...new Set((data ?? []).map(r => r.profile_id as string))].filter(id => id !== n.exceptProfileId);
  await Promise.all(
    owners.map(user_id =>
      insertBell(admin, {
        user_id,
        type: 'org_staff_accepted',
        title: `${n.personName} joined ${n.orgName}'s staff — ${n.summary}`,
        action_url: `/app/org/${n.side}/${n.orgId}`,
        metadata: { [col]: n.orgId },
      })
    )
  );
}

export async function notifyStaffRevoked(
  admin: Admin,
  n: { profileId: string; side: OrgSide; orgId: string; orgName: string }
): Promise<void> {
  await insertBell(admin, {
    user_id: n.profileId,
    type: 'org_staff_revoked',
    title: `Your staff access to ${n.orgName} was removed`,
    action_url: `/${n.side}/${n.orgId}`,
    metadata: { [n.side === 'league' ? 'league_id' : 'club_id']: n.orgId },
  });
}

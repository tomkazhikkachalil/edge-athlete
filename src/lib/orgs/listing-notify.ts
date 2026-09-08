// ── The admin bell for a listing request (Onboarding v2 R1, 179) ────────────
// Before R1 nothing told an admin a request had landed — they polled
// /dashboard/clubs. Now every listing request (the public default at
// creation, or an owner flipping "link only" → "ask to be listed") bells
// every ADMIN_EMAILS account. Best-effort by contract: a 23514 on a
// pre-179 CHECK, a missing admin profile, any insert error → log, never
// fail the request. Direct insert, the staff-notify.ts shape.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './listing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG LISTING NOTIFY]';

/** PURE: the allowlist as lower-cased emails (the isAdminEmail parse). */
export function adminEmailsFrom(allowlist: string | undefined): string[] {
  return (allowlist || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function notifyAdminsOfListingRequest(
  admin: Admin,
  n: { side: OrgSide; orgId: string; orgName: string; requesterId: string }
): Promise<void> {
  try {
    const emails = adminEmailsFrom(process.env.ADMIN_EMAILS);
    if (emails.length === 0) return;
    const { data: admins } = await admin.from('profiles').select('id').in('email', emails);
    const ids = ((admins ?? []) as { id: string }[]).map(a => a.id).filter(id => id !== n.requesterId);
    if (ids.length === 0) return;
    const plural = n.side === 'league' ? 'leagues' : 'clubs';
    const rows = ids.map(user_id => ({
      user_id,
      type: 'org_listing_request',
      title: `${n.orgName} asked to be listed in the ${n.side} directory`,
      message: null,
      action_url: `/dashboard/${plural}`,
      actor_id: n.requesterId,
      is_read: false,
      metadata: { [n.side === 'league' ? 'league_id' : 'club_id']: n.orgId },
    }));
    const { error } = await admin.from('notifications').insert(rows);
    if (error) console.error(`${TAG} insert failed:`, error);
  } catch (e) {
    console.error(`${TAG} failed:`, e);
  }
}

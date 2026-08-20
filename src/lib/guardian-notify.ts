// ── Guardian notification fan-out ─────────────────────────────────────────────
// The family console answers "what needs me?" only when opened; these are the
// push half. Same contract as the shared-round notifiers
// (src/lib/golf/group-notifications.ts): direct inserts on the admin client
// (create_notification's preference gate has no branch for these types and
// would silently drop them), and ALL senders are BEST-EFFORT — a failed
// notification never fails the action that triggered it.
//
// Recipients are always addressed by their OWN user_id, so the existing
// bell/notifications page/RLS need no changes. A supervised child's rows
// reach them on their next PIN login, and the email digest routes a
// synthetic-address child's items to their guardians (sendChildDigest,
// digest-server.ts).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export type GuardianNotificationType =
  | 'post_pending_approval'
  | 'post_approval_result'
  | 'comment_pending_approval'
  | 'comment_approval_result'
  | 'transfer_update'
  | 'consent_result'
  | 'athlete_added';

export interface GuardianNotification {
  type: GuardianNotificationType;
  title: string;
  message?: string | null;
  actionUrl?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Pure recipient selection: dedupe, drop the excluded actor. Exported for
 *  node tests — the fan-out below is a thin I/O wrapper around it. */
export function guardianRecipients(
  rows: Array<{ user_id: string }>,
  excludeUserId?: string | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.user_id || r.user_id === excludeUserId || seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    out.push(r.user_id);
  }
  return out;
}

/** The supervised athlete's display name, for notification titles. */
export async function profileFirstName(admin: Admin, profileId: string): Promise<string> {
  const { data } = await admin
    .from('profiles')
    .select('first_name, full_name, display_name')
    .eq('id', profileId)
    .maybeSingle();
  return data?.first_name || data?.display_name || data?.full_name || 'Your athlete';
}

/** Notify every guardian of a profile (optionally excluding the acting one). */
export async function notifyGuardians(
  admin: Admin,
  profileId: string,
  n: GuardianNotification,
  excludeUserId?: string | null
): Promise<void> {
  try {
    const { data: rows } = await admin
      .from('profile_access')
      .select('user_id')
      .eq('profile_id', profileId)
      .eq('role', 'guardian');
    const recipients = guardianRecipients(rows ?? [], excludeUserId);
    if (recipients.length === 0) return;
    const { error } = await admin.from('notifications').insert(
      recipients.map(user_id => ({
        user_id,
        type: n.type,
        actor_id: n.actorId ?? null,
        title: n.title,
        message: n.message ?? null,
        action_url: n.actionUrl ?? null,
        is_read: false,
        metadata: { profile_id: profileId, ...(n.metadata ?? {}) },
      }))
    );
    if (error) console.error('[GUARDIAN NOTIFY] fan-out failed:', error);
  } catch (e) {
    console.error('[GUARDIAN NOTIFY] fan-out failed:', e);
  }
}

/** Notify one user directly (e.g. the supervised athlete themselves). */
export async function notifyUser(
  admin: Admin,
  userId: string,
  n: GuardianNotification
): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: userId,
      type: n.type,
      actor_id: n.actorId ?? null,
      title: n.title,
      message: n.message ?? null,
      action_url: n.actionUrl ?? null,
      is_read: false,
      metadata: n.metadata ?? {},
    });
    if (error) console.error('[GUARDIAN NOTIFY] user notify failed:', error);
  } catch (e) {
    console.error('[GUARDIAN NOTIFY] user notify failed:', e);
  }
}

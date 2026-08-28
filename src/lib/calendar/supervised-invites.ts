import type { SupabaseClient } from '@supabase/supabase-js';
import { canInviteSupervised, type MessagingPermission } from '@/lib/supervised-gates';

// ── Supervised-athlete gate for calendar guests ───────────────────────────────
// Event invites carry real-world times and places, so they honor the same
// family dial that gates DMs: the child's messaging_permission. Both event
// routes (create + edit's add_guests) call this before inserting guest rows.
// Guest validation elsewhere checks only that profiles EXIST — this is the
// relationship check.

/** Byte-identical copy across both event routes — probes assert it. */
export const SUPERVISED_INVITE_BLOCKED_MESSAGE =
  "This athlete's family only accepts invites from approved contacts.";
export const SUPERVISED_EMAIL_GUESTS_MESSAGE =
  "Email invites aren't available on a supervised account.";

export type InviteGateResult = { ok: true } | { ok: false; error: string };

/**
 * Checks every supervised profile in `inviteeProfileIds` against the
 * inviter's relationship with them, and blocks a supervised INVITER from
 * adding raw-email guests (outbound mail to arbitrary addresses is a
 * contact channel the family never approved; the child has no email
 * identity of their own).
 */
export async function checkSupervisedInviteGate(
  admin: SupabaseClient,
  inviterId: string,
  inviteeProfileIds: string[],
  emailGuestCount: number
): Promise<InviteGateResult> {
  // Unconditional (Wave 1 inversion): this gate protects supervised minors
  // and reads only their own profile state — no flag may open it.
  if (emailGuestCount > 0) {
    const { data: inviter } = await admin
      .from('profiles')
      .select('supervision_state')
      .eq('id', inviterId)
      .maybeSingle();
    if (inviter?.supervision_state === 'supervised') {
      return { ok: false, error: SUPERVISED_EMAIL_GUESTS_MESSAGE };
    }
  }

  if (inviteeProfileIds.length === 0) return { ok: true };
  const { data: invitees } = await admin
    .from('profiles')
    .select('id, supervision_state, messaging_permission')
    .in('id', inviteeProfileIds);
  const supervised = (invitees ?? []).filter(
    (p) => p.supervision_state === 'supervised'
  );
  if (supervised.length === 0) return { ok: true };

  const { getProfileRole } = await import('@/lib/auth-server');
  for (const child of supervised) {
    const role = await getProfileRole(inviterId, child.id);
    const [{ data: inviterFollows }, { data: childFollows }] = await Promise.all([
      admin
        .from('follows')
        .select('id')
        .eq('follower_id', inviterId)
        .eq('following_id', child.id)
        .eq('status', 'accepted')
        .maybeSingle(),
      admin
        .from('follows')
        .select('id')
        .eq('follower_id', child.id)
        .eq('following_id', inviterId)
        .eq('status', 'accepted')
        .maybeSingle(),
    ]);
    const permission = (child.messaging_permission || 'everyone') as MessagingPermission;
    if (!canInviteSupervised(permission, role === 'guardian', !!inviterFollows, !!childFollows)) {
      return { ok: false, error: SUPERVISED_INVITE_BLOCKED_MESSAGE };
    }
  }
  return { ok: true };
}

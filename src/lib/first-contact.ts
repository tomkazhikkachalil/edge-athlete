// First-contact hold (Wave 3, mig 131) — Tom's locked decision ③: the first
// message from ANY account with no prior approved contact and no accepted
// follow reaches a supervised child only after a guardian approves. The
// messaging-permission tiers run FIRST and are unchanged; this gate only
// applies when the tiers allow the message. Modeled on
// checkSupervisedInviteGate (pure decider + thin I/O wrapper), unconditional
// like every safety pipeline since the Wave 1 flag-off inversion.

import type { SupabaseClient } from '@supabase/supabase-js';

export type FirstContactAction =
  | 'allow'                        // known contact — nothing to record
  | 'allow_record_guardian'        // sender is the child's guardian → ledger 'guardian'
  | 'allow_record_follow'          // accepted follow either direction → ledger 'follow'
  | 'allow_record_child_initiated' // the child started it → ledger 'child_initiated'
  | 'hold';                        // unknown (no row or denied) → hold for the guardian

/** Pure decider — node-tested. `contactStatus` = the ledger row, if any. */
export function decideFirstContact(input: {
  childIsSender: boolean;
  senderIsGuardianOfChild: boolean;
  contactStatus: 'approved' | 'denied' | null;
  followEitherDirection: boolean;
}): FirstContactAction {
  if (input.contactStatus === 'approved') return 'allow';
  if (input.senderIsGuardianOfChild) return 'allow_record_guardian';
  // An accepted follow implies guardian awareness — follows touching
  // supervised children pass the guardian queue — so it may supersede an
  // earlier denial.
  if (input.followEitherDirection) return 'allow_record_follow';
  if (input.childIsSender) {
    // The child reaching OUT is visibility-not-lockdown (D8): allowed, and
    // the contact lands in the guardian's roster. But a child's outbound
    // must NOT overwrite a guardian's denial — the denial keeps governing
    // INBOUND holds; only the ledger write is skipped.
    return input.contactStatus === 'denied' ? 'allow' : 'allow_record_child_initiated';
  }
  return 'hold';
}

const RECORD_SOURCE: Partial<Record<FirstContactAction, string>> = {
  allow_record_guardian: 'guardian',
  allow_record_follow: 'follow',
  allow_record_child_initiated: 'child_initiated',
};

/**
 * Run the gate for a direct conversation between senderId and counterpartId.
 * Returns { hold: false } when the counterpart isn't a supervised child or
 * the contact is known (auto-approve sources are upserted as a side effect);
 * { hold: true, childId } when the child's participant row must be held.
 *
 * Callers run this AFTER the tier and block gates.
 */
export async function applyFirstContactGate(
  admin: SupabaseClient,
  senderId: string,
  counterpartId: string
): Promise<{ hold: boolean; childId?: string }> {
  const { data: counterpart } = await admin
    .from('profiles')
    .select('id, supervision_state')
    .eq('id', counterpartId)
    .maybeSingle();
  const { data: sender } = await admin
    .from('profiles')
    .select('id, supervision_state')
    .eq('id', senderId)
    .maybeSingle();

  // The held party is always the supervised CHILD in the pair. When the
  // child is the sender, the gate records the contact but never holds (D8).
  const childId =
    counterpart?.supervision_state === 'supervised'
      ? counterpartId
      : sender?.supervision_state === 'supervised'
      ? senderId
      : null;
  if (!childId) return { hold: false };
  const contactId = childId === counterpartId ? senderId : counterpartId;

  const [{ data: ledger }, roleResult, { data: followRows }] = await Promise.all([
    admin
      .from('approved_contacts')
      .select('status')
      .eq('child_profile_id', childId)
      .eq('contact_profile_id', contactId)
      .maybeSingle(),
    (async () => {
      const { getProfileRole } = await import('./auth-server');
      return getProfileRole(contactId, childId);
    })(),
    admin
      .from('follows')
      .select('follower_id')
      .eq('status', 'accepted')
      .or(
        `and(follower_id.eq.${childId},following_id.eq.${contactId}),and(follower_id.eq.${contactId},following_id.eq.${childId})`
      )
      .limit(1),
  ]);

  const action = decideFirstContact({
    childIsSender: senderId === childId,
    senderIsGuardianOfChild: roleResult === 'guardian',
    contactStatus: (ledger?.status as 'approved' | 'denied' | undefined) ?? null,
    followEitherDirection: (followRows ?? []).length > 0,
  });

  const source = RECORD_SOURCE[action];
  if (source) {
    // Best-effort ledger write — the allow itself must never fail on it.
    const { error } = await admin.from('approved_contacts').upsert(
      {
        child_profile_id: childId,
        contact_profile_id: contactId,
        status: 'approved',
        source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'child_profile_id,contact_profile_id' }
    );
    if (error) console.error('[first-contact] ledger upsert failed:', error);
  }

  return action === 'hold' ? { hold: true, childId } : { hold: false };
}

/** Bell the guardians about a new held contact — refs only, never content. */
export async function notifyContactHold(
  admin: SupabaseClient,
  childId: string,
  senderId: string,
  conversationId: string
): Promise<void> {
  const { notifyGuardians, profileFirstName } = await import('./guardian-notify');
  const childName = await profileFirstName(admin, childId);
  await notifyGuardians(admin, childId, {
    type: 'safety_alert',
    title: `Someone new wants to message ${childName}`,
    actionUrl: '/app/guardian',
    actorId: senderId,
    metadata: { conversation_id: conversationId, contact_profile_id: senderId },
  });
}

/**
 * Hold the child's participant row on a conversation, belling the guardians
 * only on the NULL→held transition (an already-held row never re-bells).
 */
export async function holdChildRow(
  admin: SupabaseClient,
  conversationId: string,
  childId: string,
  senderId: string
): Promise<{ held: boolean }> {
  const { data: row } = await admin
    .from('conversation_participants')
    .select('id, held_at')
    .eq('conversation_id', conversationId)
    .eq('profile_id', childId)
    .maybeSingle();
  if (!row) return { held: false };
  if (row.held_at) return { held: true };
  const { error } = await admin
    .from('conversation_participants')
    .update({ held_at: new Date().toISOString() })
    .eq('id', row.id);
  if (error) {
    console.error('[first-contact] hold stamp failed:', error);
    return { held: false };
  }
  await notifyContactHold(admin, childId, senderId, conversationId);
  return { held: true };
}

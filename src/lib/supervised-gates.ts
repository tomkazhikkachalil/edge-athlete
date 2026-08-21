// Pure decision helpers for supervised-athlete gates (guardian-profiles).
// No imports on purpose — node-only vitest covers these directly; the
// routes supply the looked-up facts.

export type CommentModeration = 'instant' | 'held';

/**
 * Where a freshly written comment lands. Only supervised authors are ever
 * gated; the toggle is the guardian's per-athlete comment_moderation.
 * Guardian acting-as comments are the guardian's words — never held.
 */
export function resolveCommentStatus(
  selfRole: string | null,
  moderation: CommentModeration | null | undefined
): 'published' | 'pending_approval' {
  if (selfRole !== 'supervised') return 'published';
  return moderation === 'instant' ? 'published' : 'pending_approval';
}

export type MessagingPermission = 'everyone' | 'fans_only' | 'mutual_fans' | 'nobody';

/**
 * Outbound half of a supervised athlete's messaging_permission: the setting
 * is symmetric for them ("who can talk WITH your child"), so the same rule
 * that gates inbound senders gates who the child may initiate with.
 * `theyFollowMe` = the counterparty is an accepted follower of the child;
 * `iFollowThem` = the child follows the counterparty.
 */
export function outboundAllowed(
  permission: MessagingPermission,
  iFollowThem: boolean,
  theyFollowMe: boolean
): boolean {
  switch (permission) {
    case 'everyone':
      return true;
    case 'fans_only':
      return theyFollowMe;
    case 'mutual_fans':
      return theyFollowMe && iFollowThem;
    case 'nobody':
      return false;
  }
}

/**
 * May this inviter put a calendar event in front of a supervised athlete?
 * Real-world times and places are at least as sensitive as DMs, so the
 * child's messaging_permission is the family's one "who may reach my child"
 * dial and event invites honor it too. The child's own guardians always
 * pass — they manage the account.
 * `inviterFollowsChild` = inviter is an accepted fan of the child;
 * `childFollowsInviter` = the child follows the inviter.
 */
export function canInviteSupervised(
  permission: MessagingPermission,
  inviterIsGuardian: boolean,
  inviterFollowsChild: boolean,
  childFollowsInviter: boolean
): boolean {
  if (inviterIsGuardian) return true;
  return outboundAllowed(permission, childFollowsInviter, inviterFollowsChild);
}

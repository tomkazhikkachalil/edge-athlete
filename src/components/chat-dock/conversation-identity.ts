import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { Conversation, ParticipantProfile } from '@/types/messages';

// Single source of truth for how the dock labels a conversation. This
// derivation was copy-pasted across the dock's row, mini window and
// minimized bubble with subtly different fallbacks, so a list row could
// read "Unknown" while the window it opened said "Conversation". Two
// details matter and are easy to get wrong:
//
//  - Match on `profile_id`, not the nested `profile?.id`: a participant
//    row whose embedded profile failed to load has no `profile.id`, and
//    the nested form would then happily select the current user.
//  - Groups never get a presence dot (presence is per-person).

export interface ConversationIdentity {
  /** Display title — the other person for direct chats, the group name otherwise. */
  title: string;
  avatarUrl: string | null;
  /** Two-letter fallback for when there's no avatar image. */
  initials: string;
  isGroup: boolean;
  /** The other participant's profile, for direct conversations only. */
  other: ParticipantProfile | null;
}

export function conversationIdentity(
  conversation: Conversation,
  currentUserId: string
): ConversationIdentity {
  if (conversation.type === 'group') {
    const title = conversation.name || 'Group';
    return {
      title,
      avatarUrl: conversation.avatar_url ?? null,
      initials: getInitials(title),
      isGroup: true,
      other: null,
    };
  }

  const other =
    (conversation.participants ?? []).find(p => p.profile_id !== currentUserId)?.profile ?? null;
  const title = other
    ? formatDisplayName(other.first_name, null, other.last_name, other.full_name)
    : 'Conversation';

  return {
    title,
    avatarUrl: other?.avatar_url ?? null,
    initials: getInitials(title),
    isGroup: false,
    other,
  };
}

/** Presence applies to a person, so only direct conversations can be "online". */
export function isConversationPartnerOnline(
  identity: ConversationIdentity,
  onlineIds: Set<string>
): boolean {
  return !identity.isGroup && !!identity.other && onlineIds.has(identity.other.id);
}

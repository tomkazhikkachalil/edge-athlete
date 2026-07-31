// Group-conversation creation rules — pure, unit tested, shared by BOTH
// surfaces that can start a group: the full board (NewConversationModal) and
// the chat dock's in-pill composer. One module so the two cannot drift; that
// shared behaviour is the point, not an incidental refactor.
//
// The server (POST /api/messages, the `type: 'group'` branch) is the authority
// on what it accepts; these rules are the stricter client contract that stops
// pointless round trips and, in one case, a real footgun — see
// GROUP_MIN_MEMBERS.

/** Matches the server's own cap and the board's `maxLength`. */
export const GROUP_NAME_MAX = 100;

/**
 * Deliberately 2, though the SERVER accepts 1 other participant.
 *
 * A 2-person "group" is functionally a DM — the API says so in its own comment
 * — but it takes the group code path, which has NO duplicate detection. So a
 * user picking exactly one person would mint a brand-new room on every attempt
 * instead of reopening the DM they already have; the direct path dedupes and
 * reactivates properly and is one tap away.
 *
 * The server staying permissive costs nothing: every member is block- and
 * permission-checked on both paths, so this is a usability floor, not a
 * security boundary.
 */
export const GROUP_MIN_MEMBERS = 2;

/** The subset of a search result a group draft needs. */
export interface GroupMember {
  id: string;
}

/** Add or remove a member, preserving selection order. */
export function toggleGroupMember<T extends GroupMember>(members: T[], profile: T): T[] {
  const exists = members.some(m => m.id === profile.id);
  if (exists) return members.filter(m => m.id !== profile.id);
  return [...members, profile];
}

/**
 * The validation message, or null when the draft is submittable. Strings are
 * the board's existing copy verbatim, so migrating it changes nothing a user
 * can see.
 */
export function groupDraftError(name: string, members: GroupMember[]): string | null {
  if (!name.trim()) return 'Group name is required';
  if (members.length < GROUP_MIN_MEMBERS) return `Add at least ${GROUP_MIN_MEMBERS} members`;
  return null;
}

/**
 * Whether the submit control should be enabled. Derived from the SAME
 * predicate as the error above so the button and the validator can never
 * disagree — the pattern `canSendMessage` uses in composer-layout.
 */
export function canCreateGroup({
  name,
  members,
  creating,
}: {
  name: string;
  members: GroupMember[];
  creating: boolean;
}): boolean {
  return !creating && groupDraftError(name, members) === null;
}

export interface GroupCreateBody {
  type: 'group';
  name: string;
  participantIds: string[];
}

/**
 * The POST /api/messages payload. Trims the name and dedupes ids while keeping
 * selection order — the server dedupes and drops self anyway, but sending a
 * clean body keeps the two surfaces byte-identical on the wire.
 */
export function buildGroupCreateBody(name: string, members: GroupMember[]): GroupCreateBody {
  return {
    type: 'group',
    name: name.trim(),
    participantIds: [...new Set(members.map(m => m.id))],
  };
}

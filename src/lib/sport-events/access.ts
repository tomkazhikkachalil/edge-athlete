/**
 * The ONE access gate for a sport event (Events program, phase 1).
 *
 * Pure: the server half (`access-server.ts`) reads the rows and calls this;
 * every route and every page reads the answer from here and nowhere else.
 * A refusal is `null`, and the caller answers the same 404 as not-found —
 * the contest rule (src/lib/competitions/contest-view.ts).
 *
 * Visibility:
 *   public  — everyone, anonymous included.
 *   link    — anyone presenting the link token, any participant row that is
 *             not declined / removed, and the host.
 *   private — participant rows of ANY role, followers included (Tom's call:
 *             a private event's leaderboard is visible to followers), and
 *             the organizers. Invited / requested / waitlisted rows count:
 *             a person asked to join may look before answering.
 * Management: the organizer and every co-organizer manage; only the
 * organizer deletes or transfers. The host is always an organizer.
 */
import { isManagingRole, type SportEventParticipantStatus, type SportEventRole, type SportEventStatus, type SportEventVisibility } from './types';

export interface AccessInput {
  event: { hostProfileId: string; visibility: SportEventVisibility; status: SportEventStatus; linkToken: string | null };
  viewerId: string | null;
  presentedToken: string | null;
  /** The viewer's own participant row, if any. */
  participant: { role: SportEventRole; status: SportEventParticipantStatus } | null;
}

export type ViewerRole = SportEventRole | 'viewer';

export interface SportEventAccess {
  canView: true;
  canManage: boolean;
  canDelete: boolean;
  role: ViewerRole;
  participantStatus: SportEventParticipantStatus | null;
}

const GONE: ReadonlySet<SportEventParticipantStatus> = new Set(['declined', 'removed']);

/** A participant row that still gives its owner a way in. */
export function participantAdmits(p: AccessInput['participant']): boolean {
  return Boolean(p) && !GONE.has(p!.status);
}

export function resolveSportEventAccess(input: AccessInput): SportEventAccess | null {
  const { event, viewerId, presentedToken, participant } = input;
  const isHost = Boolean(viewerId) && viewerId === event.hostProfileId;
  const role: ViewerRole = isHost ? 'organizer' : participant?.role ?? 'viewer';
  // Authority PR 2: running the event needs an ACCEPTED organizer row — an
  // invited, requested or waitlisted co-organizer is not a backup yet.
  const manages = isHost || (participant?.status === 'accepted' && isManagingRole(participant.role));

  let admitted = false;
  if (isHost || manages) admitted = true;
  else if (event.visibility === 'public') admitted = true;
  else if (event.visibility === 'link') admitted = (presentedToken !== null && presentedToken !== '' && presentedToken === event.linkToken) || participantAdmits(participant);
  else admitted = participantAdmits(participant); // private

  if (!admitted) return null;
  return {
    canView: true,
    canManage: manages,
    canDelete: isHost,
    role,
    participantStatus: participant?.status ?? null,
  };
}

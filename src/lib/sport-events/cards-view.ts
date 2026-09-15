/**
 * The Scorecard tab's rows (Events program, PR 13) — pure. The round's
 * scorecard (the group_post payload) joined to the event's participants
 * by profile: one row per card with its 204 status, what the viewer may
 * do with it, and the list the Complete confirm names.
 */
import type { CardStatus } from './scoring-authz';

export interface ScorecardParticipant {
  participant: { id: string; profile_id: string; status: string; role: string };
  scores: { status?: string | null; holes_completed: number | null; total_score: number | null; to_par: number | null; hole_scores: Array<{ hole_number: number }> };
}

export interface EventParticipantName {
  profile_id: string;
  name: string;
  status: string;
  playing: boolean;
  role: string;
}

export interface CardRow {
  /** The round's group_post_participants id — the cards routes' [pid]. */
  pid: string;
  profileId: string;
  name: string;
  status: CardStatus;
  holesCompleted: number;
  total: number | null;
  toPar: number | null;
  isSelf: boolean;
  /** The viewer may submit it (their own, in progress, at least one hole). */
  canSubmit: boolean;
  /** Organizers: mark final / reopen. */
  canFinalize: boolean;
  canReopen: boolean;
}

export const CARD_STATUS_LABEL: Readonly<Record<CardStatus, string>> = { in_progress: 'In progress', submitted: 'Submitted', final: 'Final' };

export function cardRows(scorecard: ScorecardParticipant[], people: EventParticipantName[], viewer: { profileId: string | null; canManage: boolean }): CardRow[] {
  const nameOf = new Map(people.map(p => [p.profile_id, p.name]));
  return scorecard
    .filter(p => p.participant.status !== 'declined')
    .map(p => {
      const status = (p.scores.status === 'submitted' || p.scores.status === 'final' ? p.scores.status : 'in_progress') as CardStatus;
      const holes = p.scores.holes_completed ?? p.scores.hole_scores.length;
      const isSelf = viewer.profileId !== null && viewer.profileId === p.participant.profile_id;
      return {
        pid: p.participant.id,
        profileId: p.participant.profile_id,
        name: nameOf.get(p.participant.profile_id) ?? 'Player',
        status,
        holesCompleted: holes,
        total: p.scores.total_score,
        toPar: p.scores.to_par,
        isSelf,
        canSubmit: isSelf && status === 'in_progress' && holes > 0,
        canFinalize: viewer.canManage && status !== 'final',
        canReopen: viewer.canManage && status !== 'in_progress',
      };
    });
}

/** The players whose card is not final — the Complete confirm names them. */
export function notFinalNames(rows: CardRow[]): string[] {
  return rows.filter(r => r.status !== 'final').map(r => r.name);
}

/**
 * Who may enter a stat line, and who may set the game score (Events
 * program, phase 4) — pure, the `scoringRight` shape. Rights come from
 * the ROUND's status (a line has no status of its own — the 204 ladder is
 * a golf attestation model):
 *
 *   scheduled  nobody (the round is not live)                 → 409
 *   live       an organizer / co-organizer; a named recorder; the
 *              player on their OWN line when the event has self_entry
 *              (else 403 `recorder_only`); anyone else               → 403
 *   completed  organizers only (the write re-runs the mirror)  → 409
 *   cancelled  nobody                                          → 409
 *
 * The game SCORE is a recorder's or an organizer's — never a player's.
 */
import type { SportEventRole, SportEventRoundStatus } from './types';

export type StatVia = 'self' | 'organizer' | 'recorder';

export interface StatRightInput {
  viewerId: string;
  /** The line's player. */
  ownerProfileId: string;
  eventRole: SportEventRole | 'viewer' | null;
  recorder: boolean;
  selfEntry: boolean;
  roundStatus: SportEventRoundStatus;
}

export type StatRight =
  | { allowed: true; via: StatVia }
  | { allowed: false; status: 403 | 409; error: string; reason?: 'recorder_only' | 'not_live' | 'over' };

const isOrganizer = (role: StatRightInput['eventRole']) => role === 'organizer' || role === 'co_organizer';

export function statEntryRight(i: StatRightInput): StatRight {
  const organizer = isOrganizer(i.eventRole);
  if (i.roundStatus === 'cancelled') return { allowed: false, status: 409, error: 'This round was cancelled.', reason: 'over' };
  if (i.roundStatus === 'completed') {
    return organizer ? { allowed: true, via: 'organizer' } : { allowed: false, status: 409, error: 'The round is over — only an organizer can change the stats now.', reason: 'over' };
  }
  if (i.roundStatus !== 'live') return { allowed: false, status: 409, error: 'The round is not live yet.', reason: 'not_live' };
  if (organizer) return { allowed: true, via: 'organizer' };
  if (i.recorder) return { allowed: true, via: 'recorder' };
  if (i.viewerId === i.ownerProfileId) {
    return i.selfEntry ? { allowed: true, via: 'self' } : { allowed: false, status: 403, error: 'A recorder enters the stats for this event.', reason: 'recorder_only' };
  }
  return { allowed: false, status: 403, error: 'Only the player, a recorder or an organizer can enter these stats.' };
}

export function scoreWriteRight(i: Pick<StatRightInput, 'eventRole' | 'recorder' | 'roundStatus'>): StatRight {
  const organizer = isOrganizer(i.eventRole);
  if (i.roundStatus === 'cancelled') return { allowed: false, status: 409, error: 'This round was cancelled.', reason: 'over' };
  if (i.roundStatus === 'completed') {
    return organizer ? { allowed: true, via: 'organizer' } : { allowed: false, status: 409, error: 'The round is over — only an organizer can change the score now.', reason: 'over' };
  }
  if (i.roundStatus !== 'live') return { allowed: false, status: 409, error: 'The round is not live yet.', reason: 'not_live' };
  if (organizer) return { allowed: true, via: 'organizer' };
  if (i.recorder) return { allowed: true, via: 'recorder' };
  return { allowed: false, status: 403, error: 'Only a recorder or an organizer keeps the score.' };
}

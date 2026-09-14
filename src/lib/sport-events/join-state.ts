/**
 * What the join control shows a viewer (Events program, the event page) —
 * pure. One rule for the header button and the players tab: the viewer's
 * participant row (role + status) and the event's state decide.
 */
import type { SportEventJoinMode, SportEventParticipantStatus, SportEventRole, SportEventStatus } from './types';

export type JoinControl =
  | { kind: 'manage' }
  | { kind: 'respond' }            // Accept / Decline
  | { kind: 'request' }            // Request to join
  | { kind: 'requested' }          // Requested · (cancel)
  | { kind: 'in'; playing: boolean } // You're in · Withdraw
  | { kind: 'waitlisted'; position: number | null }
  | { kind: 'follow' }
  | { kind: 'following' }
  | { kind: 'none' };

export interface JoinStateInput {
  signedIn: boolean;
  canManage: boolean;
  role: SportEventRole | 'viewer';
  participantStatus: SportEventParticipantStatus | null;
  playing: boolean;
  waitlistPosition: number | null;
  event: { status: SportEventStatus; joinMode: SportEventJoinMode };
}

export function joinControl(i: JoinStateInput): JoinControl {
  if (!i.signedIn) return { kind: 'none' };
  if (i.canManage) return { kind: 'manage' };
  const over = i.event.status === 'completed' || i.event.status === 'cancelled';
  if (i.role === 'follower' && i.participantStatus === 'accepted') return { kind: 'following' };
  if (i.role === 'participant' || i.role === 'co_organizer') {
    switch (i.participantStatus) {
      case 'invited': return over ? { kind: 'none' } : { kind: 'respond' };
      case 'requested': return over ? { kind: 'none' } : { kind: 'requested' };
      case 'accepted': return { kind: 'in', playing: i.playing };
      case 'waitlisted': return { kind: 'waitlisted', position: i.waitlistPosition };
      default: break; // declined / removed / withdrawn fall through to follow
    }
  }
  if (over) return { kind: 'none' };
  if (i.event.status === 'open' && i.event.joinMode === 'request' && i.participantStatus !== 'removed') return { kind: 'request' };
  return { kind: 'follow' };
}

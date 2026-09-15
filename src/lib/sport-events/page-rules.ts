/**
 * The event page's organizer rules (Events program, phase 2) — pure. What
 * the header's primary action is, which actions a round's card offers, and
 * the confirm copy each one reads. The lifecycle (lifecycle.ts) decides
 * what is ALLOWED; this file decides what is SHOWN — and shows only what
 * the lifecycle would accept, so a tap never lands on a named refusal.
 */
import { nextStartableRound } from './lifecycle';
import { activeRounds, deleteRefusal } from './rounds';
import type { SportEventRoundStatus, SportEventStatus } from './types';

export interface RoundForRules {
  id: string;
  sequence: number;
  status: SportEventRoundStatus;
}

export type OrganizerStep =
  | { kind: 'publish' }
  | { kind: 'start'; round: RoundForRules }
  | { kind: 'complete'; round: RoundForRules }
  | null;

/** The header's one primary action: Publish → Start round n → Complete round n → nothing. */
export function nextOrganizerStep(event: { status: SportEventStatus }, rounds: ReadonlyArray<RoundForRules>): OrganizerStep {
  if (event.status === 'draft') return { kind: 'publish' };
  if (event.status !== 'open' && event.status !== 'live') return null;
  const live = rounds.find(r => r.status === 'live');
  if (live) return { kind: 'complete', round: live };
  const next = nextStartableRound(rounds);
  return next ? { kind: 'start', round: next } : null;
}

export type RoundAction = 'start' | 'complete' | 'cancel' | 'edit' | 'remove';

/** The actions a round's card offers an organizer — only the ones the lifecycle and the rounds rules would accept. */
export function roundActionsFor(round: RoundForRules, rounds: ReadonlyArray<RoundForRules>, event: { status: SportEventStatus }): RoundAction[] {
  if (event.status === 'completed' || event.status === 'cancelled') return [];
  if (round.status === 'live') return ['complete'];
  if (round.status !== 'scheduled') return [];
  const out: RoundAction[] = [];
  if (event.status !== 'draft' && nextStartableRound(rounds)?.id === round.id) out.push('start');
  out.push('edit');
  if (deleteRefusal(round, rounds) === null) out.push('remove', 'cancel');
  return out;
}

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
}

/** The confirm each action reads. A single-round event keeps phase 1's words; a tournament names the round. Phase 3: a match round never promises "finalized as they stand" — every match must be decided first. */
export function confirmCopyFor(action: Exclude<RoundAction, 'edit'>, round: RoundForRules, rounds: ReadonlyArray<RoundForRules>, opts: { matchPlay?: boolean } = {}): ConfirmCopy {
  const active = activeRounds(rounds);
  const single = active.length <= 1;
  const n = round.sequence;
  const last = !active.some(r => r.status === 'scheduled' && r.id !== round.id);
  if (action === 'complete' && opts.matchPlay) {
    const results = 'Each match\'s result is recorded and every played hole posts to the players\' profiles unless they opted out.';
    return single
      ? { title: 'Complete the event?', message: `Every match must be decided. ${results}`, confirmText: 'Complete' }
      : last
        ? { title: `Complete round ${n}?`, message: `This is the last round: every match must be decided. ${results}`, confirmText: 'Complete' }
        : { title: `Complete round ${n}?`, message: `Every match must be decided. ${results} The event stays live until its last round completes.`, confirmText: 'Complete' };
  }
  switch (action) {
    case 'start':
      return single
        ? { title: 'Go live?', message: 'The round starts for everyone who accepted. Invites close; late accepts still join.', confirmText: 'Go live' }
        : { title: `Start round ${n}?`, message: 'The round starts for everyone who accepted. Late accepts join this round.', confirmText: `Start round ${n}` };
    case 'complete':
      return single
        ? { title: 'Complete the event?', message: 'Cards that are not final are finalized as they stand. Results post to every player\'s profile unless they opted out.', confirmText: 'Complete' }
        : last
          ? { title: `Complete round ${n}?`, message: 'This is the last round: cards that are not final are finalized as they stand, and the results post to every player\'s profile unless they opted out.', confirmText: 'Complete' }
          : { title: `Complete round ${n}?`, message: 'Cards that are not final are finalized as they stand. The event stays live until its last round completes.', confirmText: 'Complete' };
    case 'cancel':
      return { title: `Cancel round ${n}?`, message: 'Players are no longer expected for this round. This cannot be undone.', confirmText: 'Cancel round', danger: true };
    case 'remove':
      return { title: `Remove round ${n}?`, message: 'The round and its groups are removed; later rounds move up.', confirmText: 'Remove', danger: true };
  }
}

export const ROUND_ACTION_LABEL: Readonly<Record<RoundAction, string>> = {
  start: 'Start',
  complete: 'Complete',
  cancel: 'Cancel round',
  edit: 'Edit',
  remove: 'Remove',
};

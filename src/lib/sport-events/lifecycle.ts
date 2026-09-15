/**
 * The organizer-intent lifecycle of a sport event (Events program, phase 1).
 *
 *   draft ──► open ──► live ──► completed
 *     │         │
 *     └────► cancelled ◄┘
 *
 * Explicit transitions with validation — never a free-text status (Tom's
 * spec, decision 4). This is the layer ABOVE the round's own score-derived
 * machine (src/lib/golf/round-status.ts: pending → active → completed by
 * what the scoring did); the two never write each other's column. The
 * server half (`lifecycle-server.ts`) applies a transition with a
 * compare-and-set on `status` and runs the side effects: Open mints the
 * round's post (the announced card), Live mints the round's group_post
 * and attaches the post, Completed forces the round complete and runs the
 * mirror. Cancelled is only reachable from draft / open — nothing has been
 * minted but a post, which is deleted; a live event is completed, never
 * cancelled (the round has real scores in real players' histories).
 */
import type { SportEventRoundStatus, SportEventStatus } from './types';

export const TRANSITIONS: Readonly<Record<SportEventStatus, readonly SportEventStatus[]>> = {
  draft: ['open', 'cancelled'],
  open: ['live', 'cancelled'],
  live: ['completed'],
  completed: [],
  cancelled: [],
};

export type TransitionRefusal =
  | 'invalid_transition'
  | 'name_required'
  | 'round_required'
  | 'no_players'
  | 'round_not_minted'
  | 'cards_not_final'
  /** Phase 2: the event completes only through its LAST round — another round is still scheduled. */
  | 'rounds_remaining';

export interface TransitionFacts {
  name: string;
  rounds: Array<{ scheduledOn: string; groupPostMinted: boolean; status?: SportEventRoundStatus }>;
  /** Accepted AND playing participants. */
  acceptedPlaying: number;
  /** The cards of the accepted + playing participants, by status. */
  cards: Array<{ status: 'in_progress' | 'submitted' | 'final' }>;
  /** The organizer completes with cards not yet final: they are finalized as they stand. */
  override?: boolean;
}

export type TransitionVerdict = { ok: true } | { ok: false; reason: TransitionRefusal };

export function canTransition(from: SportEventStatus, to: SportEventStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Validate a transition against the facts. The server mints BEFORE judging
 * `round_not_minted` on open → live, so a failed mint leaves the event open.
 */
export function validateTransition(from: SportEventStatus, to: SportEventStatus, facts: TransitionFacts): TransitionVerdict {
  if (!canTransition(from, to)) return { ok: false, reason: 'invalid_transition' };
  if (to === 'open') {
    if (!facts.name.trim()) return { ok: false, reason: 'name_required' };
    if (facts.rounds.length === 0) return { ok: false, reason: 'round_required' };
  }
  if (to === 'live') {
    if (facts.acceptedPlaying < 1) return { ok: false, reason: 'no_players' };
    if (!facts.rounds.some(r => r.groupPostMinted)) return { ok: false, reason: 'round_not_minted' };
  }
  if (to === 'completed' && facts.rounds.some(r => r.status === 'scheduled')) return { ok: false, reason: 'rounds_remaining' };
  if (to === 'completed' && !facts.override) {
    if (facts.cards.length < facts.acceptedPlaying || facts.cards.some(c => c.status !== 'final')) return { ok: false, reason: 'cards_not_final' };
  }
  return { ok: true };
}

/** The timestamp column a transition stamps, if any. */
export function transitionStamp(to: SportEventStatus): 'opened_at' | 'went_live_at' | 'completed_at' | 'cancelled_at' | null {
  switch (to) {
    case 'open': return 'opened_at';
    case 'live': return 'went_live_at';
    case 'completed': return 'completed_at';
    case 'cancelled': return 'cancelled_at';
    default: return null;
  }
}

/** Refusal copy for the API / UI — one place. */
export const TRANSITION_REFUSAL_COPY: Readonly<Record<TransitionRefusal, string>> = {
  invalid_transition: 'That change is not allowed from the event\'s current state.',
  name_required: 'Give the event a name before publishing it.',
  round_required: 'Add a round before publishing the event.',
  no_players: 'At least one player must have accepted before the event goes live.',
  round_not_minted: 'The round could not be started. Try again.',
  cards_not_final: 'Some scorecards are not final yet. Mark them final, or complete anyway to finalize them as they stand.',
  rounds_remaining: 'Another round is still scheduled. Complete or cancel it first — the event completes with its last round.',
};

// ── The round's own lifecycle (Events program, phase 2) ─────────────────────
//
//   scheduled ──► live ──► completed
//       │
//       └────► cancelled
//
// Rounds run ONE AT A TIME (Tom): a round starts only when every earlier
// round is completed or cancelled and no other round is live; a completed
// round mirrors on its own; the EVENT'S status follows its rounds
// (`eventStatusAfterRound`): the first start takes an open event live, the
// last completion takes a live event to completed. The event-level live /
// completed transitions above are sugar over these.

export const ROUND_TRANSITIONS: Readonly<Record<SportEventRoundStatus, readonly SportEventRoundStatus[]>> = {
  scheduled: ['live', 'cancelled'],
  live: ['completed'],
  completed: [],
  cancelled: [],
};

export type RoundTransitionRefusal =
  | 'invalid_transition'
  | 'event_not_open'
  | 'event_over'
  | 'another_round_live'
  | 'earlier_round_pending'
  | 'no_players'
  | 'round_not_minted'
  | 'cards_not_final'
  | 'last_round';

export interface RoundTransitionFacts {
  eventStatus: SportEventStatus;
  round: { sequence: number; status: SportEventRoundStatus; groupPostMinted: boolean };
  /** Every round of the event (this one included). */
  rounds: Array<{ sequence: number; status: SportEventRoundStatus }>;
  acceptedPlaying: number;
  /** THIS round's cards, by status. */
  cards: Array<{ status: 'in_progress' | 'submitted' | 'final' }>;
  override?: boolean;
}

export type RoundTransitionVerdict = { ok: true } | { ok: false; reason: RoundTransitionRefusal };

export function canRoundTransition(from: SportEventRoundStatus, to: SportEventRoundStatus): boolean {
  return ROUND_TRANSITIONS[from].includes(to);
}

export function validateRoundTransition(to: SportEventRoundStatus, facts: RoundTransitionFacts): RoundTransitionVerdict {
  if (!canRoundTransition(facts.round.status, to)) return { ok: false, reason: 'invalid_transition' };
  if (facts.eventStatus === 'completed' || facts.eventStatus === 'cancelled') return { ok: false, reason: 'event_over' };
  const others = facts.rounds.filter(r => r.sequence !== facts.round.sequence);
  if (to === 'live') {
    if (facts.eventStatus === 'draft') return { ok: false, reason: 'event_not_open' };
    if (others.some(r => r.status === 'live')) return { ok: false, reason: 'another_round_live' };
    if (others.some(r => r.sequence < facts.round.sequence && r.status !== 'completed' && r.status !== 'cancelled')) return { ok: false, reason: 'earlier_round_pending' };
    if (facts.acceptedPlaying < 1) return { ok: false, reason: 'no_players' };
    if (!facts.round.groupPostMinted) return { ok: false, reason: 'round_not_minted' };
  }
  if (to === 'completed' && !facts.override) {
    if (facts.cards.length < facts.acceptedPlaying || facts.cards.some(c => c.status !== 'final')) return { ok: false, reason: 'cards_not_final' };
  }
  if (to === 'cancelled') {
    if (!others.some(r => r.status !== 'cancelled')) return { ok: false, reason: 'last_round' };
  }
  return { ok: true };
}

/**
 * The event's status after a round transition: an open event goes live
 * with its first started round; a live event completes when no
 * non-cancelled round is scheduled or live any more. Null = no change.
 */
export function eventStatusAfterRound(eventStatus: SportEventStatus, rounds: ReadonlyArray<{ status: SportEventRoundStatus }>): 'live' | 'completed' | null {
  if (eventStatus === 'open' && rounds.some(r => r.status === 'live')) return 'live';
  if (eventStatus === 'live' && rounds.some(r => r.status !== 'cancelled') && !rounds.some(r => r.status === 'scheduled' || r.status === 'live')) return 'completed';
  return null;
}

/** The round the event-level `live` starts: the lowest scheduled round with every earlier round completed or cancelled. */
export function nextStartableRound<T extends { sequence: number; status: SportEventRoundStatus }>(rounds: ReadonlyArray<T>): T | null {
  const sorted = [...rounds].sort((a, b) => a.sequence - b.sequence);
  for (const r of sorted) {
    if (r.status === 'completed' || r.status === 'cancelled') continue;
    return r.status === 'scheduled' ? r : null;
  }
  return null;
}

export const ROUND_REFUSAL_COPY: Readonly<Record<RoundTransitionRefusal, string>> = {
  invalid_transition: 'That change is not allowed from the round\'s current state.',
  event_not_open: 'Publish the event before starting a round.',
  event_over: 'The event is over.',
  another_round_live: 'Another round is live. Complete it before starting this one.',
  earlier_round_pending: 'An earlier round has not been completed yet. Rounds run in order.',
  no_players: 'At least one player must have accepted before a round starts.',
  round_not_minted: 'The round could not be started. Try again.',
  cards_not_final: 'Some scorecards are not final yet. Mark them final, or complete anyway to finalize them as they stand.',
  last_round: 'An event needs at least one round — cancel the event instead.',
};

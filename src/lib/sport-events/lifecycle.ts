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
import type { SportEventStatus } from './types';

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
  | 'cards_not_final';

export interface TransitionFacts {
  name: string;
  rounds: Array<{ scheduledOn: string; groupPostMinted: boolean }>;
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
};

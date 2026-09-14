/**
 * A scorecard's status moves (Events program, PR 6) — pure. 204 gave
 * golf_participant_scores `status in_progress | submitted | final`:
 *
 *   submit    the OWNER attests their card (in_progress → submitted;
 *             submitted again is a no-op; a final card is closed)
 *   finalize  an ORGANIZER closes a card as it stands (any → final)
 *   reopen    an ORGANIZER reopens a submitted or final card
 *
 * The owner's own reopen is implicit: a score write on a submitted card
 * reopens it (scoring-authz `reopens`). `scores_confirmed` stays "the
 * owner attested" and is set by submit.
 */
import type { CardStatus } from './scoring-authz';

export type CardAction = 'submit' | 'finalize' | 'reopen';

export interface CardActor {
  isOwner: boolean;
  canManage: boolean;
}

export type CardPlan =
  | { ok: true; changed: boolean; next: { status: CardStatus; submitted_at: 'now' | 'keep' | null; finalized_by: 'actor' | 'keep' | null; scores_confirmed?: true } }
  | { ok: false; status: 403 | 409; error: string };

export function planCardAction(action: CardAction, status: CardStatus, actor: CardActor): CardPlan {
  switch (action) {
    case 'submit':
      if (!actor.isOwner) return { ok: false, status: 403, error: 'Only the player submits their own card.' };
      if (status === 'final') return { ok: false, status: 409, error: 'This card is final. Ask the organizer to reopen it.' };
      if (status === 'submitted') return { ok: true, changed: false, next: { status: 'submitted', submitted_at: 'keep', finalized_by: 'keep', scores_confirmed: true } };
      return { ok: true, changed: true, next: { status: 'submitted', submitted_at: 'now', finalized_by: null, scores_confirmed: true } };
    case 'finalize':
      if (!actor.canManage) return { ok: false, status: 403, error: 'Only an organizer marks a card final.' };
      if (status === 'final') return { ok: true, changed: false, next: { status: 'final', submitted_at: 'keep', finalized_by: 'keep' } };
      return { ok: true, changed: true, next: { status: 'final', submitted_at: status === 'submitted' ? 'keep' : 'now', finalized_by: 'actor' } };
    case 'reopen':
      if (!actor.canManage) return { ok: false, status: 403, error: 'Only an organizer reopens a card.' };
      if (status === 'in_progress') return { ok: false, status: 409, error: 'This card is already open.' };
      return { ok: true, changed: true, next: { status: 'in_progress', submitted_at: null, finalized_by: null } };
  }
}

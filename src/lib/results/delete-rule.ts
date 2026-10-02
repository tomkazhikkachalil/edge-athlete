// ── May this result be DELETED? (quick fixes, Oct 2026) — pure, zero imports ──
//
// Convention 27 (Sep 26 2026) said a player never deletes a recorded result —
// "Delete" was a hide. Tom amended it on Oct 2 2026: a result that is NOT
// from a tournament, a club or a league may be deleted by its player for
// real (it stops counting toward the handicap, the stats and the dataset),
// and Hide stays beside it for anyone who only wants it off their profile.
// An official result, and any round of an event, can still only be hidden.
//
// One more thing a played round is not: UNFINISHED. A round that is still
// pending or live has recorded nothing yet (the stats row is written when it
// completes), so its creator may always discard it — the only way out used to
// be End Round, which RECORDS it.
//
// "Results outlive the person" still holds between players: in a shared round
// a delete removes YOUR result only. Pinned in __tests__/results-delete.test.ts.

export interface ResultDeleteFacts {
  /** resolveResultOrigin().official — it fails CLOSED, so a failed read is `true`. */
  official: boolean;
  /** A round of a sport event (the organizer's record), official or not. */
  eventRound: boolean;
  /** The round has completed. A stat line or any other post is always "finished". */
  finished: boolean;
  /** The requester created the round (a post's owner is its creator). */
  isCreator: boolean;
  /** OTHER people with a recorded result on it (scores on the card, or a stats row). */
  othersPlayed: number;
}

export type ResultDeletePlan =
  | { action: 'refuse'; reason: 'official' | 'event' | 'unfinished_not_creator' }
  /** Unfinished: the whole round goes — nothing was recorded. */
  | { action: 'discard_round' }
  /** Finished, and nobody else played: the whole round goes. */
  | { action: 'delete_round' }
  /** Finished and shared: only the requester's result; the creator's post goes with theirs. */
  | { action: 'remove_own_result'; removePost: boolean };

export function planResultDelete(f: ResultDeleteFacts): ResultDeletePlan {
  if (f.eventRound) return { action: 'refuse', reason: 'event' };
  if (f.official) return { action: 'refuse', reason: 'official' };
  if (!f.finished) return f.isCreator ? { action: 'discard_round' } : { action: 'refuse', reason: 'unfinished_not_creator' };
  if (f.isCreator && f.othersPlayed === 0) return { action: 'delete_round' };
  return { action: 'remove_own_result', removePost: f.isCreator };
}

/** What a door says when it refuses. Plain words; the way out is named. */
export const DELETE_REFUSALS: Record<Extract<ResultDeletePlan, { action: 'refuse' }>['reason'], string> = {
  official:
    'This is an official result, so it stays on the record. You can hide it from your profile — and if it isn’t you, report it and our team will fix it.',
  event: 'This round is part of an event, so it stays on the event’s record. You can hide it from your profile.',
  unfinished_not_creator: 'Only the person who started this round can delete it while it is still being played.',
};

/**
 * What the owner's menu may OFFER, from what the client can see. The server
 * decides for real (it alone knows a result's provenance): a card that offers
 * Delete on an official result is answered with the refusal above.
 */
export function offersDelete(c: { eventRound: boolean; contestLinked: boolean }): boolean {
  return !c.eventRound && !c.contestLinked;
}

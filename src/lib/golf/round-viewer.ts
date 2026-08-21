// ── What a viewer gets on the live-round screen ───────────────────────────────
// One place that decides whether you are scoring, watching, or looking at a
// finished round — so /live/[groupPostId] has no branching logic of its own and
// the rules are unit-testable without a DOM.
//
// Deliberately reuses the existing domain functions rather than re-deriving:
// effectiveRoundStatus (which carries the 6h auto-end rule), isActiveParticipant,
// and the same "own card is complete" rule the resume banner uses.

import { effectiveRoundStatus, isActiveParticipant } from './round-status';

export interface ViewerParticipant {
  participant: {
    id: string;
    profile_id: string;
    status?: string | null;
    role?: string | null;
  };
  scores?: { holes_completed?: number | null } | null;
}

export interface ViewerScorecard {
  group_post: {
    id: string;
    creator_id?: string | null;
    status?: string | null;
    date?: string | null;
    post_id?: string | null;
    last_score_activity_at?: string | null;
  };
  golf_data?: { holes_played?: number | null } | null;
  participants?: ViewerParticipant[] | null;
}

export type RoundEntry =
  | { mode: 'not-found' }
  /** Finished round. `participantId` is set when the viewer is an ACTIVE
   *  participant — they may still fix a score (the same policy the feed
   *  card has always had: SharedRoundFullCard's canScore carries no status
   *  gate). Spectators and declined viewers get null. */
  | { mode: 'final'; postId: string | null; participantId: string | null; isCreator: boolean }
  | { mode: 'watch'; reason: 'spectator' | 'declined' | 'card-complete'; postId: string | null }
  | { mode: 'score'; participantId: string; isCreator: boolean; postId: string | null };

/** The viewer finished their own card — nothing left to enter, even while
 *  co-players keep the ROUND live. Same rule as the resume banner. */
function ownCardComplete(p: ViewerParticipant, holesPlayed: number | null | undefined): boolean {
  const done = p.scores?.holes_completed;
  return (
    typeof holesPlayed === 'number' &&
    holesPlayed > 0 &&
    typeof done === 'number' &&
    done >= holesPlayed
  );
}

export function resolveRoundEntry({
  scorecard,
  viewerId,
  now = Date.now(),
}: {
  scorecard: ViewerScorecard | null | undefined;
  viewerId: string | null | undefined;
  now?: number;
}): RoundEntry {
  if (!scorecard?.group_post?.id) return { mode: 'not-found' };

  const postId = scorecard.group_post.post_id ?? null;
  const isCreator = !!viewerId && scorecard.group_post.creator_id === viewerId;

  // effectiveRoundStatus, not status: a round nobody has scored in for 6h reads
  // as finished even though the row still says 'active'.
  const status = effectiveRoundStatus(scorecard.group_post, now);
  if (status === 'completed' || status === 'cancelled') {
    const mineFinal = viewerId
      ? (scorecard.participants ?? []).find(p => p.participant.profile_id === viewerId)
      : undefined;
    const activeMine = mineFinal && isActiveParticipant(mineFinal.participant.status)
      ? mineFinal.participant.id
      : null;
    // Cancelled rounds have nothing to fix — no score affordance.
    return {
      mode: 'final',
      postId,
      participantId: status === 'cancelled' ? null : activeMine,
      isCreator,
    };
  }

  if (!viewerId) return { mode: 'watch', reason: 'spectator', postId };

  const mine = (scorecard.participants ?? []).find(p => p.participant.profile_id === viewerId);
  if (!mine) return { mode: 'watch', reason: 'spectator', postId };

  // A declined participant can still watch a public round — they just have no
  // card to fill in.
  if (!isActiveParticipant(mine.participant.status)) {
    return { mode: 'watch', reason: 'declined', postId };
  }

  if (ownCardComplete(mine, scorecard.golf_data?.holes_played)) {
    return { mode: 'watch', reason: 'card-complete', postId };
  }

  return { mode: 'score', participantId: mine.participant.id, isCreator, postId };
}

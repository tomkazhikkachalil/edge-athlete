import { isActiveParticipant } from './round-status';

/**
 * How many playing partners (everyone on the roster except the creator)
 * have actually entered scores — the number the delete-round confirm uses
 * to warn the creator that other people's work goes with the round.
 *
 * "Has scores" mirrors the leaderboard's own signal: a non-null total or at
 * least one completed hole. Declined participants are out (they can't score);
 * legacy 'pending'/'maybe' rows count, same as everywhere else, because
 * auto-confirm lets them score.
 */
export function countPartnersWithScores(
  participants: Array<{
    participant: { profile_id: string; status: string };
    scores: { holes_completed?: number | null; total_score?: number | null };
  }>,
  creatorId: string
): number {
  return participants.filter(
    p =>
      p.participant.profile_id !== creatorId &&
      isActiveParticipant(p.participant.status) &&
      // != null: an absent total (undefined) must not count as "has a score"
      ((p.scores.holes_completed ?? 0) > 0 || p.scores.total_score != null)
  ).length;
}

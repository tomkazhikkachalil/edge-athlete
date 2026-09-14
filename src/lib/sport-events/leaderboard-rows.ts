/**
 * From rows to leaderboard players (Events program, PR 7) — pure. The
 * event's accepted, playing participants are the field (a player who has
 * not scored ranks last with thru 0); the round's group_post rows carry
 * the cards; names come through publicDisplayName.
 */
import { publicDisplayName, publicHandle } from '@/lib/orgs/public-names';
import type { LeaderboardPlayer } from './leaderboard';
import type { ProfileForView } from './view';

export interface FieldRow {
  id: string;
  profile_id: string;
  handicap_index: number | null;
}

export interface CardRow {
  profile_id: string;
  status: string;
  card: { status?: string | null; hole_scores: Array<{ hole_number: number; strokes: number | null }> } | null;
}

export function toLeaderboardPlayers(field: FieldRow[], cards: CardRow[], profiles: Map<string, ProfileForView>): LeaderboardPlayer[] {
  const cardByProfile = new Map<string, CardRow>();
  for (const c of cards) if (c.status !== 'declined') cardByProfile.set(c.profile_id, c);
  return field.map(f => {
    const p = profiles.get(f.profile_id) ?? null;
    const c = cardByProfile.get(f.profile_id) ?? null;
    const status = c?.card?.status;
    return {
      participantId: f.id,
      profileId: f.profile_id,
      name: p ? publicDisplayName(p) : 'Athlete',
      handle: p ? publicHandle(p) : null,
      handicapIndex: f.handicap_index,
      holeScores: c?.card?.hole_scores ?? [],
      cardStatus: status === 'submitted' || status === 'final' ? status : 'in_progress',
    };
  });
}

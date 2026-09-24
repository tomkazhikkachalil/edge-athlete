/**
 * An event round's results into the org's contest — the pure half (Events
 * program, phase 2b, B1). The event's own leaderboard row becomes a
 * `contest_results` row: the competition's rule picks the score (net when
 * the rule is net and a net exists, else gross — `scoreForRule`'s rule),
 * the provenance is the ORG's (club_recorded for a club, league_verified
 * for a league — the org recorded it from its own event, never
 * self_reported), and `roundRef` names the mirrored golf round when the
 * player has one. Tom's rule: an opted-out player (hide_from_profile)
 * STILL counts for the org — their row carries `roundRef.roundId: null`
 * (no golf_rounds row exists for them) and `groupPostId` set, so the org's
 * standings count them while the profile, the handicap and the dataset
 * never see it (the performance overlay skips a null roundId).
 */
import type { GolfResultPayload } from '@/lib/competitions/golf-league';
import type { ResultProvenance } from '@/lib/orgs/provenance';
import type { LeaderboardRow } from './leaderboard';
import type { OrgKind } from '@/lib/orgs/org-ref';

export type ContestRule = 'golf_net' | 'golf_gross' | 'stroke_total';

/** The competition's rule for a round: net only when it says so. */
export function contestRule(scoringRule: string | null | undefined): ContestRule {
  return scoringRule === 'golf_net' ? 'golf_net' : scoringRule === 'stroke_total' ? 'stroke_total' : 'golf_gross';
}

/** The org that hosts the event recorded the result itself. */
export function provenanceForOrg(org: { side: OrgKind }): ResultProvenance {
  return org.side === 'league' ? 'league_verified' : 'club_recorded';
}

export interface ContestResultInput {
  contestId: string;
  participantId: string;
  rule: ContestRule;
  provenance: ResultProvenance;
  enteredBy: string;
  holes: number;
  tee: string | null;
  golfRoundId: string | null;
  groupPostId: string | null;
  eventId: string;
  roundId: string;
}

export type ContestResultRow = {
  contest_id: string;
  participant_id: string;
  score: number;
  payload: GolfResultPayload & { sportEvent: { eventId: string; roundId: string } };
  provenance: ResultProvenance;
  entered_by: string;
};

/** A leaderboard row with a gross score → the contest_results row; null when the player never scored. */
export function contestResultFor(row: Pick<LeaderboardRow, 'gross' | 'net' | 'courseHandicap' | 'netReason'>, input: ContestResultInput): ContestResultRow | null {
  if (typeof row.gross !== 'number') return null;
  const hasNet = typeof row.net === 'number';
  const payload: ContestResultRow['payload'] = {
    gross: row.gross,
    holes: input.holes,
    holesSource: 'card',
    tee: input.tee,
    roundRef: { roundId: input.golfRoundId, groupPostId: input.groupPostId },
    sportEvent: { eventId: input.eventId, roundId: input.roundId },
    ...(hasNet ? { net: row.net as number, courseHandicap: row.courseHandicap ?? undefined } : {}),
    ...(!hasNet && row.netReason === 'no_index' ? { noIndex: true as const } : {}),
    ...(!hasNet && (row.netReason === 'no_rating' || row.netReason === 'no_stroke_index') ? { noRating: true as const } : {}),
  };
  const score = input.rule === 'golf_net' && hasNet ? (row.net as number) : row.gross;
  return { contest_id: input.contestId, participant_id: input.participantId, score, payload, provenance: input.provenance, entered_by: input.enteredBy };
}

/** The contest status a round status maps to. */
export function contestStatusFor(roundStatus: 'scheduled' | 'live' | 'completed' | 'cancelled'): 'scheduled' | 'in_progress' | 'completed' | 'canceled' {
  if (roundStatus === 'live') return 'in_progress';
  if (roundStatus === 'completed') return 'completed';
  if (roundStatus === 'cancelled') return 'canceled';
  return 'scheduled';
}

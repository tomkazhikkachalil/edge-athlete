/**
 * The one-line "broadcast graphic" for a post's lead media: the moment, one
 * number, and the context.
 *
 * Pure and sport-dispatched HERE rather than inside `SportPostBody`, on
 * purpose. That component's contract is "adding a sport = a case + a body
 * component, zero PostCard edits"; threading a media array through it would
 * make every sport body responsible for rendering media too, duplicating what
 * PostCard already does. A pure function returning three strings keeps the
 * dispatch seam intact and is fully unit-testable — which matters here because
 * there is no jsdom, so the strip's rendering cannot be.
 */

import type { SportKey } from './SportRegistry';
import { getStatSchema, isStatLineData } from './stat-schemas';

export interface PostHeadline {
  /** When/where in the event: "Eagle Creek", "vs Rivals". */
  moment: string;
  /** The single number that carries the post: "29", "2 G". */
  value: string;
  /** What the number is: "Score", "+1", "Final". */
  label: string;
}

interface GolfRoundLike {
  course?: string | null;
  gross_score?: number | null;
  golf_holes?: Array<{ par?: number | null }> | null;
}

/** The shape a SHARED round arrives in — see note in buildPostHeadline. */
interface GroupScorecardLike {
  golf_data?: { course_name?: string | null } | null;
  participants?: Array<{
    participant?: { profile_id?: string | null } | null;
    scores?: { total_score?: number | null; to_par?: number | null } | null;
  }> | null;
}

/**
 * Build the strip content, or null when there is nothing worth overlaying.
 *
 * Returns null rather than a placeholder: an empty strip over someone's photo
 * is worse than no strip.
 */
export function buildPostHeadline(
  sportKey: string | null | undefined,
  input: {
    golfRound?: GolfRoundLike | null;
    statsData?: Record<string, unknown> | null;
    groupScorecard?: GroupScorecardLike | null;
    /** Whose score to lead with; falls back to the best score present. */
    viewerId?: string | null;
  }
): PostHeadline | null {
  const { golfRound, statsData, groupScorecard, viewerId } = input;

  // A SHARED round posts with a group_scorecard and NO golf_round — the two
  // are different pipelines, and handling only the latter left every live/
  // shared round (the whole point of this feature) with no headline at all.
  // Checked first because a shared round is the richer source.
  if (groupScorecard?.golf_data) {
    const scored = (groupScorecard.participants ?? []).filter(
      p => typeof p.scores?.total_score === 'number'
    );
    if (scored.length > 0) {
      // Your own score if you are in the round, else the best one.
      const mine = viewerId
        ? scored.find(p => p.participant?.profile_id === viewerId)
        : undefined;
      const best = scored.reduce((a, b) =>
        (b.scores!.total_score ?? Infinity) < (a.scores!.total_score ?? Infinity) ? b : a
      );
      const chosen = mine ?? best;
      const toPar = chosen.scores?.to_par;
      return {
        moment: groupScorecard.golf_data.course_name?.trim() || 'Round',
        value: String(chosen.scores!.total_score),
        label:
          typeof toPar !== 'number'
            ? 'Score'
            : toPar === 0
              ? 'Even'
              : `${toPar > 0 ? '+' : ''}${toPar}`,
      };
    }
  }

  if (sportKey === 'golf' && golfRound && typeof golfRound.gross_score === 'number') {
    const holes = golfRound.golf_holes ?? [];
    const par = holes.reduce((sum, h) => sum + (h.par ?? 0), 0);
    // to-par only means something once we know the course's par.
    const toPar = par > 0 ? golfRound.gross_score - par : null;
    return {
      moment: golfRound.course?.trim() || 'Round',
      value: String(golfRound.gross_score),
      label:
        toPar === null
          ? 'Score'
          : toPar === 0
            ? 'Even'
            : `${toPar > 0 ? '+' : ''}${toPar}`,
    };
  }

  if (isStatLineData(statsData)) {
    const schema = getStatSchema(statsData.sport_key as SportKey);
    const headline = schema?.headline(statsData.stats ?? {});
    if (!headline) return null;
    return {
      moment: statsData.opponent?.trim() || schema!.activityNoun,
      value: headline,
      label: statsData.result
        ? `${statsData.result}${statsData.result_score ? ` ${statsData.result_score}` : ''}`
        : schema!.activityNoun,
    };
  }

  return null;
}

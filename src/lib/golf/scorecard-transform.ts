// ── Shared-round scorecard shape assembly ─────────────────────────────────────
// One home for (a) the nested group_posts select and (b) the transform from
// the raw PostgREST row to the CompleteGolfScorecard shape components expect:
//   { group_post, golf_data, participants: [{ participant: {..., profile}, scores: {..., hole_scores} }] }
// Used by both the feed list branch and the single-post branch of
// GET /api/posts, so a targeted post refetch carries the same shape the feed
// delivered.

/** Nested select for a group post + scorecard + participants + scores. */
export const GROUP_SCORECARD_SELECT = `
  id,
  creator_id,
  type,
  title,
  description,
  date,
  location,
  visibility,
  status,
  created_at,
  golf_data:golf_scorecard_data (
    id,
    course_name,
    course_id,
    round_type,
    game_format,
    holes_played,
    tee_color,
    slope_rating,
    course_rating,
    hole_data
  ),
  round_media:group_post_media (
    id,
    media_url,
    media_type,
    hole_number,
    uploaded_by,
    caption
  ),
  participants:group_post_participants (
    id,
    profile_id,
    status,
    role,
    attested_at,
    profile:profiles (
      id,
      first_name,
      last_name,
      full_name,
      avatar_url,
      handle
    ),
    scores:golf_participant_scores (
      id,
      total_score,
      to_par,
      holes_completed,
      scores_confirmed,
      updated_at,
      hole_scores:golf_hole_scores (
        hole_number,
        strokes,
        putts,
        fairway_hit,
        green_in_regulation
      )
    )
  )
`;

/**
 * Transform a raw group_posts row (from GROUP_SCORECARD_SELECT) into the
 * CompleteGolfScorecard shape. Returns null when the row has no golf data
 * (scorecard creation failed) — callers render nothing rather than crash.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformGroupPostToScorecard(groupData: any): any | null {
  if (!groupData) return null;

  const { golf_data, participants, round_media, ...groupPostFields } = groupData;
  const golfData = Array.isArray(golf_data) ? golf_data[0] : golf_data;
  if (!golfData) return null;

  // Newest score write across all participants — feeds the lazy auto-end
  // rule (effectiveRoundStatus) so a quiet 'active' round renders FINAL.
  let lastActivityAt: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformedParticipants = (participants || []).map((p: any) => {
    const { scores, profile, ...participantFields } = p;
    const scoreRec = Array.isArray(scores) ? scores[0] : scores;
    if (scoreRec?.updated_at && (!lastActivityAt || scoreRec.updated_at > lastActivityAt)) {
      lastActivityAt = scoreRec.updated_at;
    }
    const holeScores = (scoreRec?.hole_scores || [])
      .slice()
      .sort((a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number);
    return {
      participant: { ...participantFields, profile },
      scores: scoreRec
        ? { ...scoreRec, hole_scores: holeScores }
        : { id: null, total_score: null, to_par: null, holes_completed: 0, scores_confirmed: false, updated_at: null, hole_scores: [] },
    };
  });

  return {
    group_post: { ...groupPostFields, last_score_activity_at: lastActivityAt },
    golf_data: golfData,
    participants: transformedParticipants,
    media: round_media || [],
  };
}

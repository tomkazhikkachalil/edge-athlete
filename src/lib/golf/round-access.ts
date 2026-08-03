// Shared-round access rules — pure, node-tested.
//
// canViewSharedRound is the APP-LAYER copy of the group_posts SELECT RLS
// policy (database/migrations/035_fix_group_rls_recursion.sql, "creator OR
// public OR participant") and of the SECURITY DEFINER helper
// public.can_view_group_post added by 063_public_round_scores_rls_realtime.sql.
// The scorecard route reads through the admin client, so THIS function is the
// enforcement there. If either layer's rule ever changes, change the other in
// the same commit — they must stay identical or viewers will see different
// data over REST vs realtime.

export interface SharedRoundAccessInput {
  viewerId: string | null;
  creatorId: string | null;
  /** group_posts.visibility: 'public' | 'private' | 'participants_only' */
  visibility: string | null;
  /**
   * profile_id of EVERY participant row, all statuses including pending —
   * matching is_group_post_participant() in RLS, which does not filter by
   * status. Do not narrow to "active" participants here; the two layers
   * would diverge.
   */
  participantProfileIds: string[];
}

export function canViewSharedRound({
  viewerId,
  creatorId,
  visibility,
  participantProfileIds,
}: SharedRoundAccessInput): boolean {
  if (!viewerId) return false;
  if (creatorId && viewerId === creatorId) return true;
  if (visibility === 'public') return true;
  return participantProfileIds.includes(viewerId);
}

// ── Realtime score-event classification ─────────────────────────────────────
// The golf_participant_scores subscription is TABLE-WIDE (no server filter),
// so events arrive for every round in the app. A known participant id is this
// round's — refresh. An unknown id is EITHER another round's noise OR this
// round's roster gone stale (participant added mid-round, or a viewer whose
// roster loaded empty) — refresh too, but throttled, so cross-round noise
// costs at most one refetch per window.

export const UNKNOWN_EVENT_REFRESH_WINDOW_MS = 10_000;

export type ScoreEventAction = 'refresh' | 'refresh-unknown' | 'ignore';

export function classifyScoreEvent(
  participantIds: ReadonlySet<string>,
  eventParticipantId: string | null | undefined,
  lastUnknownRefreshAt: number,
  now: number
): ScoreEventAction {
  if (!eventParticipantId) return 'ignore';
  if (participantIds.has(eventParticipantId)) return 'refresh';
  if (now - lastUnknownRefreshAt >= UNKNOWN_EVENT_REFRESH_WINDOW_MS) return 'refresh-unknown';
  return 'ignore';
}

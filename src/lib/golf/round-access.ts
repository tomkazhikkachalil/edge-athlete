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
//
// Events phase 4 (Sep 2026): an ANONYMOUS viewer sees a PUBLIC round — the
// SQL rule ("creator OR public OR participant") already admits anon on the
// public branch; the app copy used to refuse every null viewer only because
// the route required a session. A public event's live round is now a place
// anyone can watch; a private / participants_only round stays a 404 to them.

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
  if (!viewerId) return visibility === 'public';
  if (creatorId && viewerId === creatorId) return true;
  if (visibility === 'public') return true;
  return participantProfileIds.includes(viewerId);
}

// ── Realtime score-event classification ─────────────────────────────────────
// The golf_participant_scores subscription is FILTERED to the round's roster
// (scale fix 1, Oct 25 2026 — it was table-wide before, so events arrived for
// every round in the app). A known participant id is this round's — refresh.
// An unknown id now means the roster-over-100 fallback (unfiltered) or a
// joiner whose first card landed before the resubscribe — refresh too, but
// throttled, so any residual noise costs at most one refetch per window.

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

// ── Refetch coalescing (scale round 2, Nov 7 2026) ──────────────────────────
// Fix 1 bounded DELIVERY to the round; every delivered event was still one
// scorecard refetch per viewer (100 spectators × 5 writes/s = 500 fetches/s).
// A realtime event now SCHEDULES a refresh: the first event opens a window
// of COALESCE + jitter (a burst of writes is one fetch; the jitter spreads
// N spectators over the window), and no scheduled refresh lands sooner than
// FLOOR after the last one. The imperative refresh (after your own save, the
// poll, a return to the tab) stays immediate — it is the user's own ask.

export const REFRESH_COALESCE_MS = 1_500;
export const REFRESH_JITTER_MS = 1_500;
export const REFRESH_FLOOR_MS = 3_000;

/** How long a realtime event waits before its refresh: `random` in [0, 1),
 *  `sinceLastRefreshMs` the time since the last refresh of any kind. */
export function refreshDelayMs(random: number, sinceLastRefreshMs: number = Number.POSITIVE_INFINITY): number {
  const r = Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999_999) : 0;
  const since = Number.isFinite(sinceLastRefreshMs) ? Math.max(sinceLastRefreshMs, 0) : Number.POSITIVE_INFINITY;
  return Math.max(REFRESH_COALESCE_MS + Math.floor(r * REFRESH_JITTER_MS), REFRESH_FLOOR_MS - since);
}

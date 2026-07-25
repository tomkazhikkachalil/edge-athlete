// ── Shared-round lifecycle (live scoring) ─────────────────────────────────────
// group_posts.status is the round's lifecycle: pending (created, no scoring
// activity yet) → active (scores are being entered — the round is LIVE) →
// completed (everyone who scored has finished). The transitions are derived
// from score data, not user intent, so they work identically for:
//   • live per-hole entry (first hole saved flips pending → active; the last
//     player to finish flips active → completed),
//   • post-round batch entry (a full scorecard arrives in one save — the round
//     goes straight to completed, never lingering as LIVE),
//   • rounds where only some players ever enter scores (completion is judged
//     over participants WITH scores; the others aren't waited on forever).
//
// resolveRoundStatus is the pure state machine (unit-tested); advanceRoundStatus
// applies it after a score write. Status updates require the service-role
// client because RLS only lets the creator update group_posts, but any
// confirmed participant's score entry can advance the round.

import type { SupabaseClient } from '@supabase/supabase-js';

export type RoundStatus = 'pending' | 'active' | 'completed' | 'cancelled';

/**
 * Whether a participant counts as playing in the round. Under the
 * auto-confirm model (migration 033) invitees are confirmed at insert, so
 * ONLY an explicit decline excludes someone — legacy 'pending'/'maybe' rows
 * and any future re-invite state all count. Single definition used by
 * rosters, score gates, and the lifecycle machine.
 */
export function isActiveParticipant(status: string | null | undefined): boolean {
  return status !== 'declined';
}

/** How long after its (date-only) round date an 'active' round still counts as
 *  live. Covers timezone slop + a full day of play; beyond it a round someone
 *  abandoned mid-entry stops showing as LIVE. */
const LIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** An 'active' round with no new scores for this long is over — players
 *  stopped and nobody tapped End Round. Product decision (July 25): 6 hours.
 *  Evaluated LAZILY: display-side via effectiveRoundStatus, persisted by the
 *  next advanceRoundStatus (score write / End Round) — no cron. */
export const AUTO_END_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Status a round is CREATED with. "Already played" rounds (scores entered
 * retrospectively) post as completed — FINAL badge immediately, no LIVE, no
 * resume banner. Anything else starts pending. Client input is untrusted:
 * only an explicit boolean true maps to completed.
 */
export function initialRoundStatus(alreadyPlayed: unknown): 'pending' | 'completed' {
  return alreadyPlayed === true ? 'completed' : 'pending';
}

/**
 * The round-status state machine. Returns the status the round should move to,
 * or null when no change is warranted. Never resurrects a finished round:
 * completed/cancelled are terminal here (only the creator's explicit action
 * could change them).
 */
export function resolveRoundStatus(input: {
  status: RoundStatus;
  holesPlayed: number;
  participants: Array<{ confirmed: boolean; holesCompleted: number }>;
  /** ms epoch of the newest score write across all participants (null = none) */
  lastActivityAt?: number | null;
  now?: number;
}): RoundStatus | null {
  const { status, holesPlayed, participants, lastActivityAt, now = Date.now() } = input;

  if (status === 'completed' || status === 'cancelled') return null;

  // Quiet rule: an active round nobody has scored in for AUTO_END_AFTER_MS is
  // finished, whatever the hole counts say (partial rounds happen).
  if (
    status === 'active' &&
    typeof lastActivityAt === 'number' &&
    now - lastActivityAt > AUTO_END_AFTER_MS
  ) {
    return 'completed';
  }

  // Only active (non-declined) participants who have actually entered
  // something count — invitees who never score shouldn't hold the round open.
  const scoring = participants.filter(p => p.confirmed && p.holesCompleted > 0);
  if (scoring.length === 0) return null;

  if (holesPlayed > 0 && scoring.every(p => p.holesCompleted >= holesPlayed)) {
    return 'completed';
  }
  return status === 'pending' ? 'active' : null;
}

/**
 * The status a round should DISPLAY as, without writing anything: an 'active'
 * round that has been quiet past AUTO_END_AFTER_MS renders as completed
 * (FINAL) everywhere. Persistence catches up on the next score write or
 * explicit End Round via resolveRoundStatus's matching quiet rule.
 */
export function effectiveRoundStatus(
  groupPost: { status?: string | null; last_score_activity_at?: string | null },
  now: number = Date.now()
): string | null | undefined {
  if (groupPost.status === 'active' && groupPost.last_score_activity_at) {
    const last = Date.parse(groupPost.last_score_activity_at);
    if (!Number.isNaN(last) && now - last > AUTO_END_AFTER_MS) {
      return 'completed';
    }
  }
  return groupPost.status;
}

/**
 * Whether a round should display as LIVE. status === 'active' alone isn't
 * enough — group_posts.date is date-only, so we also require the round date to
 * be within ±48h of now, and the round must not have gone quiet past the
 * auto-end window (effectiveRoundStatus). A round left 'active' (players
 * stopped entering and nobody ended it) quietly stops advertising itself.
 */
export function isRoundLive(
  groupPost: { status?: string | null; date?: string | null; last_score_activity_at?: string | null },
  now: number = Date.now()
): boolean {
  if (effectiveRoundStatus(groupPost, now) !== 'active' || !groupPost.date) return false;
  const roundDate = Date.parse(groupPost.date);
  if (Number.isNaN(roundDate)) return false;
  return Math.abs(now - roundDate) <= LIVE_WINDOW_MS;
}

/**
 * Re-derive and persist a round's status after a score write. Best-effort:
 * callers fire this after a successful save and a failure here must never fail
 * the save itself (mirrors the notification side-effects in the same routes).
 * `admin` must be the service-role client — see module header.
 */
export async function advanceRoundStatus(
  admin: SupabaseClient,
  groupPostId: string
): Promise<void> {
  try {
    const { data: round, error } = await admin
      .from('group_posts')
      .select(`
        id,
        status,
        golf_data:golf_scorecard_data ( holes_played ),
        participants:group_post_participants (
          status,
          scores:golf_participant_scores ( holes_completed, updated_at )
        )
      `)
      .eq('id', groupPostId)
      .maybeSingle();

    if (error || !round) {
      if (error) console.error('advanceRoundStatus: fetch failed:', error);
      return;
    }

    // PostgREST returns to-one embeds as single-element arrays here.
    const golfData = Array.isArray(round.golf_data) ? round.golf_data[0] : round.golf_data;
    if (!golfData) return; // not a golf round with a scorecard — nothing to derive

    let lastActivityAt: number | null = null;
    const participants = (round.participants || []).map((p: {
      status: string;
      scores: { holes_completed: number | null; updated_at?: string | null }[] | { holes_completed: number | null; updated_at?: string | null } | null;
    }) => {
      const scores = Array.isArray(p.scores) ? p.scores[0] : p.scores;
      if (scores?.updated_at) {
        const t = Date.parse(scores.updated_at);
        if (!Number.isNaN(t) && (lastActivityAt === null || t > lastActivityAt)) {
          lastActivityAt = t;
        }
      }
      return {
        confirmed: isActiveParticipant(p.status),
        holesCompleted: scores?.holes_completed ?? 0,
      };
    });

    const next = resolveRoundStatus({
      status: round.status as RoundStatus,
      holesPlayed: golfData.holes_played ?? 0,
      participants,
      lastActivityAt,
    });

    if (!next || next === round.status) return;

    const { error: updateError } = await admin
      .from('group_posts')
      .update({ status: next })
      .eq('id', groupPostId)
      // Guard against a concurrent request having already advanced it.
      .eq('status', round.status);

    if (updateError) {
      console.error('advanceRoundStatus: update failed:', updateError);
    }
  } catch (e) {
    console.error('advanceRoundStatus: unexpected error:', e);
  }
}

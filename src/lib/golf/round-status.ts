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

/** How long after its (date-only) round date an 'active' round still counts as
 *  live. Covers timezone slop + a full day of play; beyond it a round someone
 *  abandoned mid-entry stops showing as LIVE. */
const LIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

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
}): RoundStatus | null {
  const { status, holesPlayed, participants } = input;

  if (status === 'completed' || status === 'cancelled') return null;

  // Only confirmed participants who have actually entered something count —
  // invitees who never score shouldn't hold the round open.
  const scoring = participants.filter(p => p.confirmed && p.holesCompleted > 0);
  if (scoring.length === 0) return null;

  if (holesPlayed > 0 && scoring.every(p => p.holesCompleted >= holesPlayed)) {
    return 'completed';
  }
  return status === 'pending' ? 'active' : null;
}

/**
 * Whether a round should display as LIVE. status === 'active' alone isn't
 * enough — group_posts.date is date-only, so we also require the round date to
 * be within ±48h of now. A round left 'active' (players stopped entering and
 * nobody ended it) quietly stops advertising itself as live.
 */
export function isRoundLive(
  groupPost: { status?: string | null; date?: string | null },
  now: number = Date.now()
): boolean {
  if (groupPost.status !== 'active' || !groupPost.date) return false;
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
          scores:golf_participant_scores ( holes_completed )
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

    const participants = (round.participants || []).map((p: {
      status: string;
      scores: { holes_completed: number | null }[] | { holes_completed: number | null } | null;
    }) => {
      const scores = Array.isArray(p.scores) ? p.scores[0] : p.scores;
      return {
        confirmed: p.status === 'confirmed',
        holesCompleted: scores?.holes_completed ?? 0,
      };
    });

    const next = resolveRoundStatus({
      status: round.status as RoundStatus,
      holesPlayed: golfData.holes_played ?? 0,
      participants,
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

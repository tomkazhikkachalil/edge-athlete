'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { CompleteGolfScorecard } from '@/types/group-posts';

// ── useSharedRound ────────────────────────────────────────────────────────────
// The single source of truth for a shared golf round's live state, and the seam
// the live-scoring system builds on. It:
//   • seeds from the scorecard the feed already loaded (no extra fetch on mount),
//   • subscribes to Supabase Realtime on golf_participant_scores so scores
//     entered by ANY player stream in live (leaderboard updates for everyone
//     watching, not just the person entering),
//   • exposes refresh() for imperative updates (e.g. right after you save).
//
// Realtime respects RLS: the golf_participant_scores SELECT policy scopes score
// visibility to the round's participants/creator, so live updates reach the
// people actually playing. Non-participant spectators fall back to the seeded
// data + manual refresh — no breakage either way. Requires the table to be in
// the `supabase_realtime` publication (migration 031); if it isn't, the
// subscription simply never fires and refresh() still works.
//
// The subscription is gated by `enabled` so the feed doesn't open a channel per
// shared-round card — callers enable it when the full scorecard is open.
export function useSharedRound({
  groupPostId,
  postId,
  initialScorecard,
  enabled,
}: {
  groupPostId: string | null;
  postId: string;
  initialScorecard: CompleteGolfScorecard | null;
  enabled: boolean;
}) {
  const [scorecard, setScorecard] = useState<CompleteGolfScorecard | null>(initialScorecard);

  // Keep in sync when the parent re-provides a scorecard (e.g. feed refetch).
  useEffect(() => {
    if (initialScorecard) setScorecard(initialScorecard);
  }, [initialScorecard]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/posts?postId=${postId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.post?.group_scorecard) {
        setScorecard(data.post.group_scorecard as CompleteGolfScorecard);
      }
    } catch (e) {
      console.error('useSharedRound refresh failed:', e);
    }
  }, [postId]);

  // Participant RECORD ids (group_post_participants.id) for client-side event
  // filtering. Kept in a ref so the subscription effect doesn't re-run — and
  // resubscribe — every time scores change.
  const participantIds = useMemo(
    () => new Set((scorecard?.participants || []).map(p => p.participant.id)),
    [scorecard]
  );
  const participantIdsRef = useRef(participantIds);
  useEffect(() => {
    participantIdsRef.current = participantIds;
  }, [participantIds]);

  useEffect(() => {
    if (!enabled || !groupPostId) return;

    const channel = supabase
      .channel(`shared-round:${groupPostId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'golf_participant_scores' },
        (payload: { new?: unknown; old?: unknown }) => {
          const row = (payload.new ?? payload.old) as { participant_id?: string } | undefined;
          // Only refetch when the change belongs to THIS round's participants.
          if (row?.participant_id && participantIdsRef.current.has(row.participant_id)) {
            refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, groupPostId, refresh]);

  return { scorecard, refresh };
}

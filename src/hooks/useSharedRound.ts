'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { CompleteGolfScorecard } from '@/types/group-posts';

// ── useSharedRound ────────────────────────────────────────────────────────────
// The single source of truth for a shared golf round's live state, and the seam
// the live-scoring system builds on (feed cards, scorecard modal, score entry —
// and, later, tournament/leaderboard pages). It:
//   • seeds from the scorecard the feed already loaded (no extra fetch on mount),
//   • refreshes once when enabled (the seeded data may be minutes old),
//   • subscribes to Supabase Realtime on golf_participant_scores (scores from
//     ANY player) and on this round's group_posts row (status flips: LIVE →
//     FINAL streams to viewers, e.g. End Round),
//   • retries failed subscriptions with backoff and reports connectionState,
//   • falls back to a 30s poll whenever enabled but not live (real-world
//     conditions: flaky networks, blocked websockets — mirrors messages' poll),
//   • ticks a re-render each minute so time-based badge rules (6h auto-end,
//     48h live window) expire without any server event,
//   • exposes refresh() for imperative updates (e.g. right after you save).
//
// Realtime respects RLS (subscriber's SELECT policies). Requires both tables
// in the `supabase_realtime` publication (migration 038); if absent, the
// channel never fires and the poll fallback carries the feature.

export type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'degraded';

const POLL_FALLBACK_MS = 30_000;
const CLOCK_TICK_MS = 60_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

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
  // True after a refresh fails — the card may be showing out-of-date scores.
  // Cleared by the next successful refresh. Callers surface it (small chip),
  // because silently-stale live leaderboards erode trust in the whole feature.
  const [stale, setStale] = useState(false);
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('idle');
  // Bumped by the retry timer to force a resubscribe attempt
  const [retryNonce, setRetryNonce] = useState(0);
  // Re-render pulse so time-based display rules expire while a card sits open
  const [, setNowTick] = useState(0);

  // Keep in sync when the parent re-provides a scorecard (e.g. feed refetch).
  useEffect(() => {
    if (initialScorecard) setScorecard(initialScorecard);
  }, [initialScorecard]);

  /** Refetch the scorecard. Resolves true on success, false on failure
   *  (callers that NEED freshness — e.g. opening score entry — can decide
   *  whether to proceed with cached data). Never throws. */
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/posts?postId=${postId}`);
      if (!res.ok) {
        setStale(true);
        return false;
      }
      const data = await res.json();
      if (data.post?.group_scorecard) {
        setScorecard(data.post.group_scorecard as CompleteGolfScorecard);
      }
      setStale(false);
      return true;
    } catch (e) {
      console.error('useSharedRound refresh failed:', e);
      setStale(true);
      return false;
    }
  }, [postId]);

  // The seeded scorecard can be minutes old — sync once when going live.
  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

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

  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled || !groupPostId) {
      setConnectionState('idle');
      return;
    }

    setConnectionState('connecting');
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

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
      .on(
        'postgres_changes',
        // Status flips (pending→active→completed, End Round) stream to every
        // viewer — the badge and leaderboard state follow without a reload.
        { event: 'UPDATE', schema: 'public', table: 'group_posts', filter: `id=eq.${groupPostId}` },
        () => {
          refresh();
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          attemptRef.current = 0;
          setConnectionState('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Silent-failure was the old behavior — now we degrade visibly
          // (poll fallback takes over) and retry with backoff.
          setConnectionState('degraded');
          if (!retryTimer) {
            const delay = Math.min(RETRY_BASE_MS * 2 ** attemptRef.current, RETRY_MAX_MS);
            attemptRef.current += 1;
            retryTimer = setTimeout(() => setRetryNonce(n => n + 1), delay);
          }
        }
      });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      supabase.removeChannel(channel);
      setConnectionState('idle');
    };
  }, [enabled, groupPostId, refresh, retryNonce]);

  // Poll fallback: while enabled but the channel isn't healthy, keep the
  // leaderboard moving anyway.
  useEffect(() => {
    if (!enabled || connectionState === 'live') return;
    const interval = setInterval(refresh, POLL_FALLBACK_MS);
    return () => clearInterval(interval);
  }, [enabled, connectionState, refresh]);

  // Minute tick: re-render so isRoundLive/effectiveRoundStatus re-evaluate
  // with fresh Date.now() — LIVE badges expire on time even with no events.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNowTick(t => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  return { scorecard, refresh, stale, connectionState };
}

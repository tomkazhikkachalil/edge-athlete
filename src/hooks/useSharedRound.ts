'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isRoundLive, shouldShowStaleNotice } from '@/lib/golf/round-status';
import { classifyScoreEvent } from '@/lib/golf/round-access';
import type { CompleteGolfScorecard } from '@/types/group-posts';
import { shouldPoll } from '@/lib/net/online';

// ── useSharedRound ────────────────────────────────────────────────────────────
// The single source of truth for a shared golf round's live state, and the seam
// the live-scoring system builds on (feed cards, scorecard modal, score entry —
// and, later, tournament/leaderboard pages). It:
//   • seeds from the scorecard the feed already loaded (no extra fetch on mount),
//   • refreshes once when enabled (the seeded data may be minutes old),
//   • subscribes to Supabase Realtime on THIS ROUND's golf_participant_scores
//     rows (filtered to the roster's participant ids — scale fix 1, Oct 25
//     2026: a table-wide subscription delivered every score written anywhere
//     to every spectator and feed card, one refetch each), on this round's
//     group_post_participants rows (a late joiner → refresh the roster and
//     resubscribe with the new filter; migration 273 publishes the table),
//     and on this round's group_posts row (status flips: LIVE → FINAL streams
//     to viewers, e.g. End Round),
//   • retries failed subscriptions with backoff and reports connectionState,
//   • polls ALWAYS while enabled — 30s when the channel is degraded, 60s even
//     when it reports 'live'. SUBSCRIBED only means the channel joined; it
//     proves nothing about the publication containing our tables or the
//     subscriber's RLS letting events through. Both failed silently in
//     production once, with the poll switched off because the channel looked
//     healthy — a total freeze with the safety net disabled. The relaxed poll
//     caps worst-case staleness at 60s no matter what realtime is doing,
//   • ticks a re-render each minute so time-based badge rules (the ±48 h LIVE window,
//     48h live window) expire without any server event,
//   • exposes refresh() for imperative updates (e.g. right after you save).
//
// Realtime respects RLS (subscriber's SELECT policies). Requires the three
// tables in the `supabase_realtime` publication (migrations 038 + 273); if
// absent, the channel never fires and the poll fallback carries the feature.
// A Realtime `in.(…)` filter takes at most 100 values (Supabase docs); a
// roster past that falls back to the unfiltered listener + classifyScoreEvent.

export type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'degraded';

const POLL_FALLBACK_MS = 30_000;
// Relaxed cadence while the channel claims to be live — see header comment.
const POLL_LIVE_MS = 60_000;
const CLOCK_TICK_MS = 60_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
// Supabase Realtime's `in.(…)` filter accepts at most 100 values.
const REALTIME_IN_FILTER_MAX = 100;

export function useSharedRound({
  groupPostId,
  postId,
  initialScorecard,
  enabled,
}: {
  groupPostId: string | null;
  /** Feed post id. Optional: the live-round screen keys on the group post and
   *  may not have one (post_id's backfill is best-effort), so refresh() falls
   *  back to the group-post scorecard endpoint. */
  postId?: string | null;
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
  // Render-phase synchronisation — an effect here left the previous round's
  // scores on screen for a frame after a refetch.
  const [syncedInitial, setSyncedInitial] = useState(initialScorecard);
  if (syncedInitial !== initialScorecard) {
    setSyncedInitial(initialScorecard);
    if (initialScorecard) setScorecard(initialScorecard);
  }

  /** Refetch the scorecard. Resolves true on success, false on failure
   *  (callers that NEED freshness — e.g. opening score entry — can decide
   *  whether to proceed with cached data). Never throws. */
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const url = postId
        ? `/api/posts?postId=${postId}`
        : `/api/group-posts/${groupPostId}/scorecard`;
      // no-store: vercel.json no-stores /api/* in prod, but dev and any
      // future host must not serve a cached leaderboard either.
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        setStale(true);
        return false;
      }
      const data = await res.json();
      const next = data.post?.group_scorecard ?? data.scorecard;
      if (next) {
        setScorecard(next as CompleteGolfScorecard);
      }
      setStale(false);
      return true;
    } catch (e) {
      console.error('useSharedRound refresh failed:', e);
      setStale(true);
      return false;
    }
  }, [postId, groupPostId]);

  // The seeded scorecard can be minutes old — sync once when going live.
  // ANNOTATED, not refactored: refresh() is part of this hook's PUBLIC API
  // (returned to callers, who consume its boolean) and is also called by the
  // subscription handler, the reconnect path and visibilitychange. Moving it
  // into this effect would mean re-exporting a wrapper and risking drift from
  // the `cache: 'no-store'` guarantee on live leaderboards. Not worth it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) refresh();
  }, [enabled, refresh]);

  // Participant RECORD ids (group_post_participants.id): the server-side
  // filter of the scores subscription AND the client-side classifier. The
  // ref keeps the handler current between resubscribes; the ROSTER KEY (the
  // sorted ids) is what the subscription effect depends on, so a scores
  // change never resubscribes — only a roster change does (a late joiner).
  const participantIds = useMemo(
    () => new Set((scorecard?.participants || []).map(p => p.participant.id)),
    [scorecard]
  );
  const participantIdsRef = useRef(participantIds);
  useEffect(() => {
    participantIdsRef.current = participantIds;
  }, [participantIds]);
  const rosterKey = useMemo(() => Array.from(participantIds).sort().join(','), [participantIds]);

  const attemptRef = useRef(0);
  // Throttle marker for refreshes triggered by score events whose participant
  // id is NOT in the roster (see classifyScoreEvent). With the server-side
  // filter this is the roster-over-100 fallback and the race between a
  // joiner's first card and our resubscribe; it stays, throttled.
  const unknownEventRefreshAtRef = useRef(0);

  // Connection state is effect-owned by definition: this effect owns the
  // Supabase channel, its retry timer and its teardown.
  useEffect(() => {
    if (!enabled || !groupPostId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnectionState('idle');
      return;
    }

    setConnectionState('connecting');
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // The scores listener is FILTERED to this round's roster (server-side:
    // other rounds' scores never leave the database). An empty roster (the
    // scorecard loaded without participants) subscribes to nothing here —
    // the participants listener and the poll bring the roster, and the
    // effect resubscribes when it arrives.
    const roster = rosterKey ? rosterKey.split(',') : [];
    const scoresFilter = roster.length > 0 && roster.length <= REALTIME_IN_FILTER_MAX
      ? { event: '*' as const, schema: 'public', table: 'golf_participant_scores', filter: `participant_id=in.(${roster.join(',')})` }
      : roster.length > REALTIME_IN_FILTER_MAX
        ? { event: '*' as const, schema: 'public', table: 'golf_participant_scores' }
        : null;

    let channel = supabase.channel(`shared-round:${groupPostId}`);
    if (scoresFilter) {
      channel = channel.on(
        'postgres_changes',
        scoresFilter,
        (payload: { new?: unknown; old?: unknown }) => {
          const row = (payload.new ?? payload.old) as { participant_id?: string } | undefined;
          // Known participant → this round's score, refetch. UNKNOWN id is
          // the roster-over-100 fallback or a joiner whose card landed before
          // our resubscribe — refresh, throttled (classifyScoreEvent).
          const action = classifyScoreEvent(
            participantIdsRef.current,
            row?.participant_id,
            unknownEventRefreshAtRef.current,
            Date.now()
          );
          if (action === 'refresh') {
            refresh();
          } else if (action === 'refresh-unknown') {
            unknownEventRefreshAtRef.current = Date.now();
            refresh();
          }
        }
      );
    }
    channel = channel
      .on(
        'postgres_changes',
        // The roster: a late joiner (or a removal) → refresh; the new roster
        // key then resubscribes this effect with the widened scores filter.
        // Published by migration 273; until it is live, the poll carries it.
        { event: '*', schema: 'public', table: 'group_post_participants', filter: `group_post_id=eq.${groupPostId}` },
        () => {
          refresh();
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
  }, [enabled, groupPostId, refresh, retryNonce, rosterKey]);

  // Poll ALWAYS while enabled — fast when degraded, relaxed when the channel
  // reports 'live'. SUBSCRIBED is not proof events are flowing (publication
  // membership and subscriber RLS both fail silently), so 'live' must never
  // switch the safety net fully off.
  useEffect(() => {
    if (!enabled) return;
    // …but never from a hidden tab (Round 3): the visibility effect below
    // refreshes once on return, which is what a backgrounded viewer needs.
    const interval = setInterval(
      () => { if (shouldPoll()) refresh(); },
      connectionState === 'live' ? POLL_LIVE_MS : POLL_FALLBACK_MS
    );
    return () => clearInterval(interval);
  }, [enabled, connectionState, refresh]);

  // Refetch when the tab comes back to the foreground — mobile browsers
  // throttle background intervals, so a viewer returning mid-round would
  // otherwise stare at pre-background scores until the next tick.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (shouldPoll()) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [enabled, refresh]);

  // Minute tick: re-render so isRoundLive re-evaluates
  // with fresh Date.now() — LIVE badges expire on time even with no events.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNowTick(t => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  // DERIVED, never raw. `stale` is set on a failed refresh and cleared only by a
  // later successful one — but refreshing stops when a round is no longer live,
  // so a failure during play used to latch it on forever and a FINAL round kept
  // claiming its scores might be out of date. Gating on liveness here means the
  // notice expires with the round no matter which surface reads it.
  const staleNotice = shouldShowStaleNotice({
    stale,
    live: scorecard ? isRoundLive(scorecard.group_post) : false,
  });

  return { scorecard, refresh, stale: staleNotice, connectionState };
}

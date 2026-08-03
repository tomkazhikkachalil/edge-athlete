'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ScoreEntryModal from '@/components/golf/ScoreEntryModal';
import SharedRoundQuickView from '@/components/golf/SharedRoundQuickView';
import SharedRoundFullCard from '@/components/golf/SharedRoundFullCard';
import { useSharedRound } from '@/hooks/useSharedRound';
import { resolveRoundEntry } from '@/lib/golf/round-viewer';
import { isActiveParticipant } from '@/lib/golf/round-status';
import { formatDisplayName } from '@/lib/formatters';
import type { CompleteGolfScorecard } from '@/types/group-posts';

/**
 * /live/[groupPostId] — a live round as a PLACE.
 *
 * Scoring used to be reachable only through a React state flag on the feed
 * (PostDetailModal + autoOpenScoreEntry), which meant it could not survive a
 * reload or the back button, could not be linked, and had to be re-implemented
 * at every page that mounts the composer — so most users, arriving via the
 * header's "+" (which routes to /athlete), never entered their round at all.
 *
 * Giving the round a URL fixes all of that at once: Go Live, the resume banner
 * and the Live Now cards all just navigate here.
 */
export default function LiveRoundPage() {
  const { groupPostId } = useParams<{ groupPostId: string }>();
  const { user, loading: authLoading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();

  const [initial, setInitial] = useState<CompleteGolfScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showFullCard, setShowFullCard] = useState(false);
  const [scoringParticipantId, setScoringParticipantId] = useState<string | null>(null);
  // Auto-open once. STATE, not a ref: it is read during render (below), and a
  // ref read during render is exactly what react-hooks/refs forbids. State is
  // the better fit anyway — it resets on unmount, so leaving the page and
  // coming back re-arms the auto-open, which is the behaviour asked for.
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    if (initialAuthCheckComplete && !authLoading && !user) router.push('/');
  }, [user, authLoading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user || !groupPostId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/group-posts/${groupPostId}/scorecard`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) setInitial(data.scorecard ?? null);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, groupPostId]);

  // Realtime + poll + the minute tick, exactly as the feed card gets them.
  const { scorecard, refresh, stale } = useSharedRound({
    groupPostId: groupPostId ?? null,
    initialScorecard: initial,
    enabled: !!initial,
  });

  const entry = resolveRoundEntry({ scorecard, viewerId: user?.id });

  const openScorer = useCallback(
    async (participantId: string) => {
      await refresh();
      setScoringParticipantId(participantId);
      setShowFullCard(false);
    },
    [refresh]
  );

  // Open the scorer once, during render rather than in an effect: the page has
  // just fetched, so there is nothing to refresh first, and an effect would
  // paint the leaderboard for a frame before the scorer covered it. The ref
  // guard means closing the scorer to check the leaderboard sticks; leaving the
  // page and coming back remounts and re-arms it, which is the asked-for
  // "pick up where I left off".
  if (!autoOpened && entry.mode === 'score' && !scoringParticipantId) {
    setAutoOpened(true);
    setScoringParticipantId(entry.participantId);
  }

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Never a dead end — a way back exists in every state, including load. */}
        <Link
          href="/live"
          className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-800 mb-4 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Live Now
        </Link>
        {body}
      </main>
    </div>
  );

  const spinner = (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
    </div>
  );

  if (!initialAuthCheckComplete || authLoading || !user) return shell(spinner);
  if (loading) return shell(spinner);

  if (notFound || entry.mode === 'not-found') {
    return shell(
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
        <h1 className="text-h3 font-bold text-gray-900 mb-2">This round isn&apos;t available</h1>
        <p className="text-gray-600 mb-4">
          It may have been deleted, or it isn&apos;t shared with you.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/live"
            className="px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 min-h-[44px] inline-flex items-center"
          >
            Live Now
          </Link>
          <Link
            href="/feed"
            className="px-4 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 min-h-[44px] inline-flex items-center"
          >
            Back to feed
          </Link>
        </div>
      </div>
    );
  }

  if (!scorecard) return shell(spinner);

  const isCreator = scorecard.group_post.creator_id === user.id;
  const viewPostHref = entry.postId ? `/feed?post=${entry.postId}` : '/feed';

  return shell(
    <>
      {entry.mode === 'final' && (
        <div className="mb-4 bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-gray-900">This round is final</p>
            <p className="text-sm text-gray-600">Scoring is closed.</p>
          </div>
          <Link
            href={viewPostHref}
            className="shrink-0 px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 min-h-[44px] inline-flex items-center"
          >
            View the post
          </Link>
        </div>
      )}

      {/* The stale notice used to be a second, separately-worded banner here
          AND a chip in the modal, each gated differently. It now renders once,
          inside QuickView, from the same liveness-gated flag — so this page and
          the feed card can no longer disagree about whether a round is stale. */}
      <SharedRoundQuickView
        scorecard={scorecard}
        currentUserId={user.id}
        stale={stale}
        onExpand={() => setShowFullCard(true)}
        // Ending the round re-timestamps the feed post to now, so the finished
        // scorecard is at the top of the feed. replace(), not push() — the back
        // button must not return to a scorer for a round that is over.
        onStatusChange={() => router.replace(viewPostHref)}
      />

      {entry.mode === 'score' && !scoringParticipantId && (
        <button
          type="button"
          onClick={() => openScorer(entry.participantId)}
          className="mt-4 w-full py-3 bg-violet-600 text-white rounded-lg font-bold hover:bg-violet-700 transition-colors min-h-[44px]"
        >
          Continue scoring
        </button>
      )}

      {entry.mode === 'watch' && entry.reason === 'card-complete' && (
        <p className="mt-4 text-sm text-gray-600 text-center">
          Your card is complete — waiting on the rest of the group.
        </p>
      )}

      {showFullCard && (
        <SharedRoundFullCard
          scorecard={scorecard}
          currentUserId={user.id}
          onClose={() => setShowFullCard(false)}
          onAddScores={entry.mode === 'score' ? openScorer : undefined}
          // A media edit refetches in place. NOT onStatusChange, which on this
          // page navigates away to the finished post.
          onMediaChanged={refresh}
        />
      )}

      {scoringParticipantId && (
        <ScoreEntryModal
          key={scoringParticipantId}
          groupPostId={scorecard.group_post.id}
          participantId={scoringParticipantId}
          holesPlayed={scorecard.golf_data.holes_played}
          holeData={scorecard.golf_data.hole_data ?? null}
          courseName={scorecard.golf_data.course_name}
          uploaderId={user.id}
          players={
            isCreator
              ? scorecard.participants
                  .filter(p => isActiveParticipant(p.participant.status))
                  .map(p => ({
                    participantId: p.participant.id,
                    name: formatDisplayName(
                      p.participant.profile?.first_name ?? null,
                      null,
                      p.participant.profile?.last_name ?? null,
                      p.participant.profile?.full_name ?? null
                    ),
                    avatarUrl: p.participant.profile?.avatar_url ?? null,
                    holesCompleted: p.scores.holes_completed ?? 0,
                    isSelf: p.participant.profile_id === user.id,
                  }))
              : undefined
          }
          onSwitchPlayer={isCreator ? id => setScoringParticipantId(id) : undefined}
          playerName={(() => {
            const p = scorecard.participants.find(
              x => x.participant.id === scoringParticipantId
            );
            if (!p || p.participant.profile_id === user.id) return undefined;
            return formatDisplayName(
              p.participant.profile?.first_name ?? null,
              null,
              p.participant.profile?.last_name ?? null,
              p.participant.profile?.full_name ?? null
            );
          })()}
          existingScores={
            scorecard.participants.find(p => p.participant.id === scoringParticipantId)?.scores
              .hole_scores || []
          }
          onSaveHole={async hole => {
            const res = await fetch(`/api/golf/scorecards/${scoringParticipantId}/scores`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ scores: [hole] }),
            });
            if (!res.ok) throw new Error('Could not save that hole');
            await refresh();
          }}
          onSave={async scores => {
            const res = await fetch(`/api/golf/scorecards/${scoringParticipantId}/scores`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ scores }),
            });
            if (!res.ok) throw new Error('Could not save those scores');
            await refresh();
          }}
          onClose={() => {
            setScoringParticipantId(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

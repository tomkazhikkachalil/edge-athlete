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
import { startingHoleNumber } from '@/lib/golf/holes';
import { isActiveParticipant, effectiveRoundStatus } from '@/lib/golf/round-status';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import CourseMap from '@/components/golf/CourseMap';
import { nextHoleForScores } from '@/lib/golf/score-entry';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';
import { embeddedCourseToInfo } from '@/lib/golf/course-info';
import type { HoleGeometry } from '@/lib/golf/hole-geometry';
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
  const [scoringHole, setScoringHole] = useState<number | null>(null);
  // Full-view switcher (owner UX call): Scorecard and Map each own the panel.
  const [tab, setTab] = useState<'score' | 'map'>('score');
  // Per-hole OSM geometry (lazy: first Map open). undefined = not asked yet,
  // null = asked, no unambiguous coverage (chip-only fallback).
  const [holeGeo, setHoleGeo] = useState<HoleGeometry | null | undefined>(undefined);
  // A hole the golfer stepped/tapped to on the map; null = follow the next
  // unscored hole (and auto-advance as scores land).
  const [viewedHole, setViewedHole] = useState<number | null>(null);
  // Publishes --vvh for the full-height shell (messages-page recipe).
  useVisualViewportHeight();
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
    async (participantId: string, hole?: number) => {
      await refresh();
      setScoringHole(hole ?? null); // null = resume at first unscored
      setScoringParticipantId(participantId);
      setShowFullCard(false);
    },
    [refresh]
  );

  // Lazy per-hole geometry: fetched once, the first time the Map view opens.
  // The 30-day cache lives server-side (migration 102); a null answer means
  // OSM has no unambiguous holes here and the map keeps course-level behavior.
  const embeddedCourseId = scorecard?.golf_data?.course?.id ?? null;
  useEffect(() => {
    if (tab !== 'map' || holeGeo !== undefined || !embeddedCourseId) return;
    let cancelled = false;
    fetch(`/api/golf/courses?id=${embeddedCourseId}&holes=1`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (!cancelled) setHoleGeo((body?.geometry as HoleGeometry | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setHoleGeo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, holeGeo, embeddedCourseId]);

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
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Never a dead end — a way back exists in every state, including load. */}
        <Link
          href="/live"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 mb-4 min-h-[44px]"
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
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
    </div>
  );

  if (!initialAuthCheckComplete || authLoading || !user) return shell(spinner);
  if (loading) return shell(spinner);

  if (notFound || entry.mode === 'not-found') {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center">
        <h1 className="text-h3 font-bold text-primary mb-2">This round isn&apos;t available</h1>
        <p className="text-tertiary mb-4">
          It may have been deleted, or it isn&apos;t shared with you.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/live"
            className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center"
          >
            Live Now
          </Link>
          <Link
            href="/feed"
            className="px-4 py-2 border border-border-strong rounded-lg font-semibold text-secondary hover:bg-surface-muted min-h-[44px] inline-flex items-center"
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

  const courseInfo = embeddedCourseToInfo(scorecard.golf_data.course);
  const mapAvailable = !!courseInfo && typeof courseInfo.lat === 'number' && typeof courseInfo.lng === 'number';
  // Not just isRoundLive: a fresh round is 'pending' until the first score
  // lands — exactly when the player is on the tee.
  const roundOpen = effectiveRoundStatus(scorecard.group_post) !== 'completed';
  const holesPlayedN = scorecard.golf_data.holes_played;
  const startHole = startingHoleNumber(scorecard.golf_data.hole_data ?? null, holesPlayedN);
  const myParticipant = scorecard.participants.find(p => p.participant.profile_id === user.id);
  // The chip, the floating button and the scorer's resume all share
  // firstUnscoredHole — they can never disagree about "the current hole".
  const nextHole = myParticipant
    ? nextHoleForScores(
        myParticipant.scores?.hole_scores ?? [],
        holesPlayedN,
        startHole,
        scorecard.golf_data.hole_data ?? null
      )
    : null;

  // The hole the Map view is ON: an explicit step/tap wins, else the next
  // unscored hole; with geometry but a complete card, hole 1 (peeking a
  // finished round is still useful). Without geometry this collapses to
  // exactly the pre-geometry chip behavior.
  const geoHoles = holeGeo?.holes ?? null;
  const displayHole =
    viewedHole ?? nextHole?.hole ?? (geoHoles && myParticipant ? geoHoles[0]?.hole ?? null : null);
  const holeDataArr = scorecard.golf_data.hole_data ?? null;
  const displayHoleDetail =
    displayHole != null
      ? {
          par:
            holeDataArr?.find(h => h.hole === displayHole)?.par ??
            geoHoles?.find(h => h.hole === displayHole)?.par ??
            null,
          yardage: holeDataArr?.find(h => h.hole === displayHole)?.yardage ?? null,
        }
      : null;
  const stepHole = (dir: 1 | -1) => {
    if (!geoHoles?.length) return;
    const current = displayHole ?? geoHoles[0].hole;
    const idx = geoHoles.findIndex(h => h.hole === current);
    const next = geoHoles[(Math.max(idx, 0) + dir + geoHoles.length) % geoHoles.length].hole;
    setViewedHole(next);
  };

  return (
    <div className="flex flex-col bg-canvas" style={{ height: 'var(--vvh, 100dvh)' }}>
      <AppHeader />
      {/* Compact strip: back link + view switcher. The old page stacked the
          map under the scoring card — cramped on a phone mid-round; each
          view now gets the full panel. */}
      <div className="w-full max-w-2xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <Link
          href="/live"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Live Now
        </Link>
        {mapAvailable && (
          <div role="tablist" aria-label="Round views" className="flex items-center gap-2">
            {([['score', 'Scorecard'], ['map', 'Map']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                  tab === id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Both views stay MOUNTED as absolute siblings; the inactive one is
          `invisible` (visibility, not display) so it keeps its size — the
          Leaflet container never collapses to 0 (no blank tiles, no relayout)
          and tab flips are paint-only. */}
      <div className="relative flex-1 min-h-0">
      {/* Scorecard view — scroll position survives tab flips. */}
      <div className={`absolute inset-0 overflow-y-auto ${tab === 'score' || !mapAvailable ? '' : 'invisible pointer-events-none'}`}>
        <div className="max-w-2xl mx-auto px-4 pb-6">
      {entry.mode === 'final' && (
        <div className="mb-4 bg-surface rounded-lg border border-border p-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-primary">This round is final</p>
            <p className="text-sm text-tertiary">
              {entry.participantId
                ? 'View the scorecard — or open the full card to fix a score.'
                : 'Scoring is closed.'}
            </p>
          </div>
          <Link
            href={viewPostHref}
            className="shrink-0 px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center"
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
        // Deleting the round removes the post too — plain /feed, and
        // replace() for the same back-button reason as above.
        onDeleted={() => router.replace('/feed')}
      />

      {entry.mode === 'score' && !scoringParticipantId && (
        <button
          type="button"
          onClick={() => openScorer(entry.participantId)}
          className="mt-4 w-full py-3 bg-brand text-white rounded-lg font-bold hover:bg-brand-hover transition-colors min-h-[44px]"
        >
          Continue scoring
        </button>
      )}

      {entry.mode === 'watch' && entry.reason === 'card-complete' && (
        <p className="mt-4 text-sm text-tertiary text-center">
          Your card is complete — waiting on the rest of the group.
        </p>
      )}

      {/* Course info stays on the Scorecard view, WITHOUT a map — the Map
          tab owns maps here (stacking them was the cramped-UX complaint). */}
      {courseInfo && (
        <div className="mt-4">
          <CourseInfoCard course={courseInfo} mapMode="hidden" />
        </div>
      )}
        </div>
      </div>

      {/* Map view — full-bleed satellite with overlays. `isolate z-0` is
          load-bearing: Leaflet's panes/controls run z-index 400–1000 and the
          chip/CTA sit at z-[500]; without a stacking context here they paint
          OVER the z-50 scorer modal (phone report: "Score hole 1 does
          nothing" — it opened behind the map). Isolation contains them all. */}
      {mapAvailable && courseInfo && (
        <div className={`absolute inset-0 isolate z-0 ${tab === 'map' ? '' : 'invisible pointer-events-none'}`}>
          <CourseMap
            lat={courseInfo.lat!}
            lng={courseInfo.lng!}
            courseName={courseInfo.name}
            fill
            overlayControls
            visible={tab === 'map'}
            defaultLayer="satellite"
            enableTracking={roundOpen}
            autoTrack={roundOpen}
            holes={geoHoles}
            focusHole={tab === 'map' ? displayHole : null}
            onHoleTap={h => setViewedHole(h)}
          />
          {/* Current-hole chip. With OSM geometry it's a stepper — ‹ › walk
              the course, tapping a tee label jumps, and the map fits each
              hole. Without geometry it's the static chip synced to scoring. */}
          {geoHoles && displayHole != null ? (
            <div className="absolute left-14 top-3 z-[500] flex items-center rounded-lg border border-border bg-surface/90 shadow-sm">
              <button
                type="button"
                aria-label="Previous hole"
                onClick={() => stepHole(-1)}
                className="min-h-[44px] min-w-[36px] flex items-center justify-center text-secondary ea-interactive rounded-l-lg"
              >
                <i className="fas fa-chevron-left text-xs" aria-hidden="true"></i>
              </button>
              <div className="px-1 text-sm font-bold text-primary whitespace-nowrap">
                Hole {displayHole}
                {displayHoleDetail?.par != null && (
                  <span className="font-medium text-secondary"> · Par {displayHoleDetail.par}</span>
                )}
                {displayHoleDetail?.yardage != null && (
                  <span className="font-medium text-secondary hidden sm:inline"> · {displayHoleDetail.yardage} yds</span>
                )}
              </div>
              <button
                type="button"
                aria-label="Next hole"
                onClick={() => stepHole(1)}
                className="min-h-[44px] min-w-[36px] flex items-center justify-center text-secondary ea-interactive rounded-r-lg"
              >
                <i className="fas fa-chevron-right text-xs" aria-hidden="true"></i>
              </button>
            </div>
          ) : nextHole ? (
            <div className="absolute left-14 top-3 z-[500] rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-bold text-primary shadow-sm">
              Hole {nextHole.hole}
              {nextHole.par !== null && <span className="font-medium text-secondary"> · Par {nextHole.par}</span>}
              {nextHole.yardage !== null && <span className="font-medium text-secondary"> · {nextHole.yardage} yds</span>}
            </div>
          ) : myParticipant ? (
            <div className="absolute left-14 top-3 z-[500] rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-sm font-semibold text-secondary shadow-sm">
              Card complete
            </div>
          ) : null}
          {displayHole != null && entry.mode === 'score' && (
            <button
              type="button"
              onClick={() => openScorer(entry.participantId, displayHole)}
              className="absolute bottom-6 left-1/2 z-[500] -translate-x-1/2 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-brand px-6 py-3 font-bold text-white shadow-lg hover:bg-brand-hover transition-colors"
            >
              <i className="fas fa-pen" aria-hidden="true"></i>
              Score hole {displayHole}
            </button>
          )}
        </div>
      )}
      </div>

      {showFullCard && (
        <SharedRoundFullCard
          scorecard={scorecard}
          currentUserId={user.id}
          onClose={() => setShowFullCard(false)}
          // Score entry on a FINAL round matches the feed card's long-standing
          // policy (canScore has no status gate): an active participant may
          // still fix a score. The two surfaces used to disagree — the feed
          // offered it, this page refused.
          onAddScores={
            entry.mode === 'score' || (entry.mode === 'final' && entry.participantId)
              ? openScorer
              : undefined
          }
          // A media edit refetches in place. NOT onStatusChange, which on this
          // page navigates away to the finished post.
          onMediaChanged={refresh}
          onDeleted={() => router.replace('/feed')}
        />
      )}

      {scoringParticipantId && (
        <ScoreEntryModal
          key={`${scoringParticipantId}:${scoringHole ?? 'resume'}`}
          groupPostId={scorecard.group_post.id}
          participantId={scoringParticipantId}
          initialHole={scoringHole ?? undefined}
          holesPlayed={scorecard.golf_data.holes_played}
          startingHoleNumber={startingHoleNumber(
            scorecard.golf_data.hole_data ?? null,
            scorecard.golf_data.holes_played
          )}
          holeData={scorecard.golf_data.hole_data ?? null}
          courseName={scorecard.golf_data.course_name}
          uploaderId={user.id}
          onShowMap={mapAvailable ? () => setTab('map') : undefined}
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
            // Any explicit hole-peek is done once scoring closes — the map
            // snaps back to following the (freshly advanced) next hole.
            setViewedHole(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

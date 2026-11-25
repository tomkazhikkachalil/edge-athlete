'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { draftReviewPath } from '@/lib/golf/round-route';
import AppHeader from '@/components/AppHeader';
import ScoreEntryModal from '@/components/golf/ScoreEntryModal';
import GroupScoreCard from '@/components/golf/GroupScoreCard';
import GroupSwitcher from '@/components/golf/GroupSwitcher';
import SharedRoundQuickView from '@/components/golf/SharedRoundQuickView';
import SharedRoundFullCard from '@/components/golf/SharedRoundFullCard';
import { useSharedRound } from '@/hooks/useSharedRound';
import { resolveRoundEntry } from '@/lib/golf/round-viewer';
import { roundHoleNumbers, startingHoleNumber, stepRoundHole } from '@/lib/golf/holes';
import { geometryForRound, pickerRows, readLoopPicks, writeLoopPicks, type LoopPicks } from '@/lib/golf/hole-loops';
import { isActiveParticipant, isRoundLive } from '@/lib/golf/round-status';
import { COPY } from '@/lib/copy';
import { publishProgress } from '@/lib/sessions/progress-store';
import { holeHeaderFacts, liveLine, type TeeSheetSource, chipDistanceLines } from '@/lib/golf/hole-detail';
import { parseStoredElevation, type HoleElevation } from '@/lib/golf/elevation';

interface HoleDetailState {
  geometry: HoleGeometry | null;
  elevation: HoleElevation | null;
  sheet: TeeSheetSource | null;
  /** The single course the detail came from (null for a two-nine combo). */
  courseId: string | null;
}
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import CourseMap from '@/components/golf/CourseMap';
import { nextHoleForScores, reopenHole } from '@/lib/golf/score-entry';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';
import { embeddedCourseToInfo } from '@/lib/golf/course-info';
import { trimLineToYards, composeHoleGeometry, type HoleGeometry } from '@/lib/golf/hole-geometry';
import { formatDisplayName } from '@/lib/formatters';
import type { CompleteGolfScorecard } from '@/types/group-posts';
import LiveCheers from '@/components/play/LiveCheers';
import FaIcon from '@/components/FaIcon';
import { faChevronLeft } from '@/lib/icons/fa/chevron-left';
import { RoundBadge } from '@/components/golf/scoring/ScoreControls';
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, PencilIcon, SkipStartIcon } from '@/components/golf/scoring/icons';
import { formatRise } from '@/lib/golf/elevation';

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
  // When `initial` was read — the hook skips its own identical refetch (Nov 7 2026).
  const [initialAt, setInitialAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showFullCard, setShowFullCard] = useState(false);
  const [scoringParticipantId, setScoringParticipantId] = useState<string | null>(null);
  const [scoringHole, setScoringHole] = useState<number | null>(null);
  // Full-view switcher (owner UX call): Scorecard and Map each own the panel.
  const [tab, setTab] = useState<'score' | 'map'>('score');
  // The map's info panel (the two hints, behind the info key).
  const [mapInfoOpen, setMapInfoOpen] = useState(false);
  // Per-hole OSM geometry (lazy: first Map open). undefined = not asked yet,
  // null = asked, no unambiguous coverage (chip-only fallback).
  // The hole detail (`?holes=1`, PR E): the geometry the map draws, the
  // cached elevation profiles and the catalog's tee sheet — fetched once, on
  // the first Map open OR the first scorer open. `undefined` = not asked yet.
  const [holeDetail, setHoleDetail] = useState<HoleDetailState | null | undefined>(undefined);
  const holeGeo = holeDetail === undefined ? undefined : (holeDetail?.geometry ?? null);
  // PR E: the map's ONE position watcher publishes every fix here; the
  // scorer reads it — it never prompts for location itself.
  const [playerFix, setPlayerFix] = useState<[number, number] | null>(null);
  // A hole the golfer stepped/tapped to on the map; null = follow the next
  // unscored hole (and auto-advance as scores land).
  const [viewedHole, setViewedHole] = useState<number | null>(null);
  // M1: bumped by the first-hole control to re-fit the map to a hole already focused.
  const [fitNonce, setFitNonce] = useState(0);
  // PR 4: the nine(s) this device picked for a club whose loops carry no
  // labels — per round, per device (localStorage), never drawn unpicked.
  const [loopPicks, setLoopPicks] = useState<LoopPicks>(() => readLoopPicks(groupPostId));
  const pickLoopFor = (key: 'front' | 'back', label: string) => {
    const next = { ...loopPicks, [key]: label };
    setLoopPicks(next);
    writeLoopPicks(groupPostId, next);
  };
  // Publishes --vvh for the full-height shell (messages-page recipe).
  useVisualViewportHeight();
  // Auto-open once. STATE, not a ref: it is read during render (below), and a
  // ref read during render is exactly what react-hooks/refs forbids. State is
  // the better fit anyway — it resets on unmount, so leaving the page and
  // coming back re-arms the auto-open, which is the behaviour asked for.
  const [autoOpened, setAutoOpened] = useState(false);
  // The round's mode as last rendered, and whether it became final under an open scorer.
  const [lastEntryMode, setLastEntryMode] = useState<string | null>(null);
  const [finishedElsewhere, setFinishedElsewhere] = useState(false);

  // Events phase 4: no sign-in redirect up front — a PUBLIC round is a place
  // anyone can watch. The scorecard fetch decides: a 401/404 for a signed-out
  // reader sends them to sign in with a way back; a signed-in stranger gets
  // the not-available screen as before.
  useEffect(() => {
    if (!initialAuthCheckComplete || authLoading || !groupPostId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/group-posts/${groupPostId}/scorecard`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          if (!user) { router.replace(`/?next=${encodeURIComponent(`/live/${groupPostId}`)}`); return; }
          setNotFound(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setInitial(data.scorecard ?? null);
          setInitialAt(Date.now());
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, groupPostId, initialAuthCheckComplete, authLoading, router]);

  // Realtime + poll + the minute tick, exactly as the feed card gets them.
  const { scorecard, refresh, stale } = useSharedRound({
    groupPostId: groupPostId ?? null,
    initialScorecard: initial,
    initialFreshAt: initialAt,
    enabled: !!initial,
  });

  const entry = resolveRoundEntry({ scorecard, viewerId: user?.id });

  // The resume pill's number (sessions/progress-store.ts): the viewer's holes
  // scored, published as the card changes so the pill is right the moment
  // they leave this screen. Before the early returns below — a hook.
  const myHolesCompleted = scorecard?.participants.find(p => p.participant.profile_id === user?.id)?.scores?.holes_completed;
  const roundHolesPlayed = scorecard?.golf_data?.holes_played;
  useEffect(() => {
    if (!groupPostId || typeof myHolesCompleted !== 'number') return;
    publishProgress('round', groupPostId, { holesCompleted: myHolesCompleted, ...(typeof roundHolesPlayed === 'number' ? { holesPlayed: roundHolesPlayed } : {}) });
  }, [groupPostId, myHolesCompleted, roundHolesPlayed]);

  // Phase 4: a recorder / organizer records for ANY group of the round — `?group=` picks it (the deep link the
  // switcher writes); a player's own group is the default, else the round's first.
  const searchParams = useSearchParams();
  const groupParam = searchParams.get('group');
  const eventCtx = scorecard?.sport_event ?? null;
  const isRecorder = eventCtx?.viewer_recorder === true;
  const roundGroups = useMemo(() => eventCtx?.groups ?? [], [eventCtx]);
  const activeGroup = useMemo(() => {
    const picked = groupParam && isRecorder ? roundGroups.find(g => g.id === groupParam) ?? null : null;
    return picked ?? eventCtx?.group ?? (isRecorder ? roundGroups[0] ?? null : null);
  }, [groupParam, isRecorder, roundGroups, eventCtx]);

  // GPS ⇄ scoring, one tap each way (Oct 2026). The scorer hands its hole to
  // the map; this remembers it, so the Scorecard tab can bring the player
  // straight back to score entry on the hole they LEFT — it used to land on
  // the leaderboard, one "Continue scoring" away.
  const [scorerHole, setScorerHole] = useState<number | null>(null);
  const reopening = useRef(false);
  const backToScoring = useCallback(
    async (participantId: string, hole: number | null) => {
      if (reopening.current) return;
      reopening.current = true;
      try {
        // Refreshed FIRST, shown second: the scorer seeds itself from the
        // saved scores when it mounts, and the leaderboard never flashes by.
        await refresh();
      } catch {
        // The scorer still opens on what the page already has.
      } finally {
        reopening.current = false;
      }
      setScoringHole(hole);
      setScoringParticipantId(participantId);
      setShowFullCard(false);
      setTab('score');
    },
    [refresh]
  );

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
  // A two-nine combo round (course_composition, migration 125) fetches BOTH
  // nines' geometries and composes them — front 1–9, back renumbered 10–18 —
  // so everything downstream (displayGeoHole's flat lookup, the rangefinder)
  // works on a normal 18-hole shape; either side missing → null, never a
  // half-right map.
  const embeddedCourseId = scorecard?.golf_data?.course?.id ?? null;
  const composition = scorecard?.golf_data?.course_composition ?? null;
  const wantHoleDetail = tab === 'map' || scoringParticipantId !== null;
  useEffect(() => {
    if (!wantHoleDetail || holeDetail !== undefined || (!embeddedCourseId && !composition)) return;
    let cancelled = false;
    const fetchDetail = (id: string) =>
      fetch(`/api/golf/courses?id=${id}&holes=1`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(body => ({
          geometry: (body?.geometry as HoleGeometry | null) ?? null,
          elevation: parseStoredElevation(body?.elevation),
          sheet: (body?.sheet as TeeSheetSource | null) ?? null,
        }));
    // A two-nine combo composes the geometries; its elevation and sheet are
    // null in this version (each nine has its own).
    const load =
      composition && composition.length === 2
        ? Promise.all([fetchDetail(composition[0].course_id), fetchDetail(composition[1].course_id)])
            .then(([front, back]) => ({ geometry: composeHoleGeometry(front.geometry, back.geometry), elevation: null, sheet: null, courseId: null }))
        : fetchDetail(embeddedCourseId!).then(d => ({ ...d, courseId: embeddedCourseId }));
    load
      .then(detail => {
        if (!cancelled) setHoleDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setHoleDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wantHoleDetail, holeDetail, embeddedCourseId, composition]);

  // No cached profile yet but a mapped single course: ask the computing door
  // ONCE (budgeted, best-effort, nothing without the deployment's key) and
  // keep whatever it answers.
  const elevationAskedRef = useRef(false);
  useEffect(() => {
    if (!holeDetail || holeDetail.elevation || !holeDetail.geometry || !holeDetail.courseId || elevationAskedRef.current) return;
    elevationAskedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/golf/courses?id=${holeDetail.courseId}&elevation=1`, { credentials: 'include' });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const elevation = parseStoredElevation(body?.elevation);
        if (!cancelled && elevation) setHoleDetail(d => (d ? { ...d, elevation } : d));
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [holeDetail]);

  // The holes the map draws, started at the TEE-IN-PLAY: the OSM way begins
  // at the back tee, so each line is walked back from the green by the
  // round's per-hole yardage (the selected tee's scorecard number). No
  // yardage (OSM-only course, manual round without yards) = the full line.
  // Memoised: CourseMapInner keys its label/line effects on this array.
  // Above the early returns — it's a hook.
  const roundHoleData = scorecard?.golf_data?.hole_data ?? null;
  const holesPlayedForGeo = scorecard?.golf_data?.holes_played ?? 18;
  // PR 4: a sections geometry draws only the picked / auto-picked loop(s);
  // anything else passes through untouched.
  const effectiveGeo = useMemo(
    () => (holeGeo === undefined ? undefined : geometryForRound(holeGeo, { holesPlayed: holesPlayedForGeo, fix: playerFix, picks: loopPicks })),
    [holeGeo, holesPlayedForGeo, playerFix, loopPicks]
  );
  const playedHoles = useMemo(() => {
    const holes = effectiveGeo?.holes;
    if (!holes) return null;
    return holes.map(h => ({
      ...h,
      line: trimLineToYards(h.line, roundHoleData?.find(x => x.hole === h.hole)?.yardage),
      // PR G3: the green's outline rides on the hole so the map, the chip
      // and the scorer measure to the same centre (and get front / back).
      green: effectiveGeo?.greens?.find(g => g.hole === h.hole)?.ring,
    }));
  }, [effectiveGeo, roundHoleData]);

  // Open the scorer once, during render rather than in an effect: the page has
  // just fetched, so there is nothing to refresh first, and an effect would
  // paint the leaderboard for a frame before the scorer covered it. The ref
  // guard means closing the scorer to check the leaderboard sticks; leaving the
  // page and coming back remounts and re-arms it, which is the asked-for
  // "pick up where I left off".
  // Events program: a round that belongs to an event AND has the viewer in
  // a playing group mounts the GROUP card in place (GroupScoreCard) — the
  // one-player modal stays for solo / non-event rounds and the organizer's
  // fix path.
  const groupCard = !!activeGroup && (entry.mode === 'score' || entry.mode === 'record');
  if (!autoOpened && entry.mode === 'score' && !scoringParticipantId && !groupCard) {
    setAutoOpened(true);
    setScoringParticipantId(entry.participantId);
  }
  // Nov 19 2026 (Tom: finished on one device, still live on the other). The
  // round went from live to final while this screen had the scorer open: it
  // was finished somewhere else. The scorer closes on the round as it now
  // is, instead of sitting there LIVE and taking more saves. (Opening the
  // scorer from a round that is ALREADY final, to fix one's own card, is a
  // different door and stays open.)
  if (entry.mode !== lastEntryMode) {
    setLastEntryMode(entry.mode);
    if (entry.mode === 'final' && (lastEntryMode === 'score' || lastEntryMode === 'record') && scoringParticipantId) {
      setScoringParticipantId(null);
      setFinishedElsewhere(true);
    }
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
          <FaIcon icon={faChevronLeft} className="text-xs" />
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

  if (!initialAuthCheckComplete || authLoading) return shell(spinner);
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

  const viewerId = user?.id ?? null;
  const isCreator = viewerId !== null && scorecard.group_post.creator_id === viewerId;
  // Drafts (253): the round's post is a DRAFT until the creator posts it, so
  // the creator's "View post" and the End Round landing are the REVIEW
  // screen; a playing partner opens the draft's card (the single-post gate
  // admits participants).
  const viewPostHref = entry.postId
    ? (isCreator ? draftReviewPath(entry.postId) : `/feed?post=${entry.postId}`)
    : '/feed';

  const courseInfo = embeddedCourseToInfo(scorecard.golf_data.course);
  const mapAvailable = !!courseInfo && typeof courseInfo.lat === 'number' && typeof courseInfo.lng === 'number';
  // Not just isRoundLive: a fresh round is 'pending' until the first score
  // lands — exactly when the player is on the tee.
  const roundOpen = scorecard.group_post.status !== 'completed';
  const holesPlayedN = scorecard.golf_data.holes_played;
  const startHole = startingHoleNumber(scorecard.golf_data.hole_data ?? null, holesPlayedN);
  const myParticipant = viewerId ? scorecard.participants.find(p => p.participant.profile_id === viewerId) : undefined;
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
  const geoHoles = playedHoles;
  // M1: the chip walks the ROUND's holes (holes.ts roundHoleNumbers), with
  // or without a line for each — a course with hole data but no OSM lines
  // used to get a static chip and no stepping. A participant with a
  // complete card peeks from the starting hole.
  const roundHoles = roundHoleNumbers(startHole, holesPlayedN);
  const displayHole = viewedHole ?? nextHole?.hole ?? (myParticipant ? startHole : null);
  const holeDataArr = scorecard.golf_data.hole_data ?? null;
  const displayGeoHole = displayHole != null ? geoHoles?.find(h => h.hole === displayHole) : undefined;
  // PR 3: the greens beside the lines — a numbered ring without a line is
  // still a hole on the map; the unnumbered rings are the greens-only tier.
  const geoGreens = effectiveGeo?.greens ?? null;
  const loopRows = pickerRows(holeGeo, holesPlayedN);
  const awaitingPick = loopRows.length > 0 && !effectiveGeo;
  const displayGreenRing = displayHole != null ? (geoGreens?.find(g => g.hole === displayHole)?.ring ?? null) : null;
  const unnumberedRings = geoGreens?.filter(g => g.hole == null).map(g => g.ring) ?? null;
  const greensOnly = !displayGeoHole && !displayGreenRing && !!unnumberedRings?.length;
  // The yardage ladder is ONE rule shared with the scorer's hole header
  // (hole-detail.ts holeHeaderFacts, PR D): the round's own hole_data first,
  // then the catalog's sheet, then the OSM way's drawn length flagged
  // approximate — every OSM-sourced course has no hole_data yardage, and
  // before that fallback the chip read "Hole 2 · Par 4" and nothing else.
  const displayHoleDetail =
    displayHole != null
      ? (() => {
          const facts = holeHeaderFacts({
            hole: displayHole,
            holeData: holeDataArr,
            teeInPlay: scorecard.golf_data.tee_color,
            line: displayGeoHole?.line ?? null,
            fallbackPar: displayGeoHole?.par ?? null,
          });
          // The chip's plays-like (PR F): the same live line the scorer's
          // header reads — from the map's fix when it has one, else the tee.
          const live = liveLine({
            fix: playerFix,
            line: displayGeoHole?.line ?? null,
            green: displayGeoHole?.green ?? displayGreenRing,
            nearestRings: unnumberedRings,
            profile: holeDetail?.elevation?.holes.find(h => h.hole === displayHole) ?? null,
            cardYards: holeDataArr?.find(h => h.hole === displayHole)?.yardage ?? null,
          });
          // M2: ONE distance line — the live one with a fix (never the card's
          // yards beside a GPS plays-like), the card's otherwise.
          return {
            par: facts.par,
            parEstimated: facts.parEstimated === true,
            hcp: facts.hcp,
            lines: chipDistanceLines(facts, live),
            // The plate's readouts (Nov 25 2026): the numbers behind those lines.
            yards: facts.yards,
            approx: facts.approx === true,
            live,
          };
        })()
      : null;
  const stepHole = (dir: 1 | -1) => {
    const next = stepRoundHole(roundHoles, displayHole, dir);
    if (next != null) setViewedHole(next);
  };
  const firstHoleMapped = !!geoHoles?.some(h => h.hole === startHole) || !!geoGreens?.some(g => g.hole === startHole);

  return (
    <div className="flex flex-col bg-canvas" style={{ height: 'calc(var(--vvh, 100dvh) - var(--ea-tabbar-h, 0px) - var(--ea-dock-h, 0px))' }}>
      <AppHeader />
      {/* The top bar (Tom's live-round spec, Nov 25 2026 — D1): Back, the
          LIVE badge (red, as everywhere), and Scorecard | Map as a key
          switch. Both views get the full panel under it. */}
      <div className="ea-mech shrink-0" style={{ backgroundColor: 'var(--mech-surface)', borderBottom: '1px solid var(--mech-divider)' }} data-live-bar="">
        <div className="mx-auto flex h-[60px] w-full max-w-2xl items-center gap-2 px-2 sm:px-4">
          <Link
            href={scorecard.sport_event ? `/events/${scorecard.sport_event.id}?tab=${scorecard.sport_event.match ? 'matches' : 'leaderboard'}` : '/live'}
            className="ea-mech-btn inline-flex h-11 min-w-[44px] shrink items-center gap-1 rounded-xl text-sm font-semibold text-[color:var(--mech-text)]"
            aria-label={scorecard.sport_event ? `Back to ${scorecard.sport_event.name}` : 'Back to Live Now'}
            data-live-back=""
          >
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center"><ChevronLeftIcon size={22} /></span>
            {/* The name is shown from 640 px; the chevron is the button on a phone. */}
            <span className="min-w-0 truncate max-sm:sr-only">{scorecard.sport_event ? scorecard.sport_event.name : 'Live Now'}</span>
          </Link>
          {scorecard.group_post.status === 'completed'
            ? <RoundBadge status="final" scope="live" />
            : isRoundLive(scorecard.group_post) ? <RoundBadge status="live" scope="live" /> : null}
          {mapAvailable && (
            <div role="tablist" aria-label="Round views" className="ea-mech-recess ml-auto inline-flex shrink-0 gap-0 rounded-xl p-[3px]">
              {([['score', 'Scorecard', 'w-[92px]'], ['map', 'Map', 'w-[64px]']] as const).map(([id, label, width]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    // Scorecard, for someone who is scoring, IS score entry —
                    // from the map and from the leaderboard alike. (An event's
                    // group card is already inline on this tab.)
                    if (id === 'score' && entry.mode === 'score' && !groupCard && !scoringParticipantId) {
                      void backToScoring(entry.participantId, reopenHole(scorerHole, startHole, holesPlayedN));
                      return;
                    }
                    setTab(id);
                  }}
                  className={`ea-mech-key inline-flex h-11 items-center justify-center rounded-[9px] text-[13px] font-semibold ${width}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
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
            {finishedElsewhere && (
              <p className="text-sm text-secondary" data-live-finished-elsewhere="">It was finished while you were scoring, so the scorer has closed.</p>
            )}
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
        currentUserId={viewerId ?? undefined}
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

      {/* Play (244): cheers for everyone watching; the floats reach the scorer too. */}
      <LiveCheers contextKey={`group_post:${groupPostId}`} signedIn={!!user} />

      {groupCard && (entry.mode === 'score' || entry.mode === 'record') && user && activeGroup && (
        <div className="mt-4 -mx-4 bg-surface rounded-lg border border-border overflow-hidden" style={{ minHeight: '60vh' }}>
          {isRecorder && roundGroups.length > 1 && (
            <GroupSwitcher groups={roundGroups} activeId={activeGroup.id} onPick={id => router.replace(`/live/${groupPostId}?group=${id}`)} />
          )}
          <GroupScoreCard
            key={activeGroup.id}
            scorecard={scorecard}
            viewerId={user.id}
            group={activeGroup}
            recorder={isRecorder}
            holesPlayed={holesPlayedN}
            startingHole={startHole}
            onRefresh={async () => { await refresh(); }}
            onSubmitCard={async participantId => {
              const eventId = scorecard.sport_event?.id;
              const ok1 = (await fetch(`/api/golf/scorecards/${participantId}/scores`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scores_confirmed: true }) })).ok;
              const ok2 = eventId ? (await fetch(`/api/sport-events/${eventId}/cards/${participantId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).ok : true;
              await refresh();
              return ok1 && ok2;
            }}
          />
        </div>
      )}
      {!groupCard && entry.mode === 'score' && !scoringParticipantId && (
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
          <CourseInfoCard
            course={courseInfo}
            mapMode="hidden"
            teeInPlay={scorecard.golf_data.tee_color ?? null}
            // M3: the summary's "View course map" is the Map tab here.
            onViewMap={mapAvailable ? () => setTab('map') : undefined}
          />
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
        <div className={`ea-mech absolute inset-0 isolate z-0 ${tab === 'map' ? '' : 'invisible pointer-events-none'}`} data-live-map="">
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
            onFix={setPlayerFix}
            holes={geoHoles}
            greens={geoGreens}
            focusHole={tab === 'map' ? displayHole : null}
            onHoleTap={h => setViewedHole(h)}
            fitNonce={fitNonce}
            elevation={holeDetail?.elevation ?? null}
            onTargetHelp={() => setMapInfoOpen(true)}
            // What the map knows about this hole (drawn from tees and greens ·
            // pick a nine · greens only · not mapped), then the nine picker —
            // drawn by the map in its column under the hole plate. The
            // course's map data has no line for this hole: say so, or the map
            // just sits on the course pin looking broken.
            // The info panel (A11): the two hints, behind the info key.
            overlayFooter={mapInfoOpen ? (
              <div id="live-map-info" className="ea-mech-glass flex w-full flex-col gap-1.5 rounded-[14px] px-3.5 py-3 text-xs text-[color:var(--mech-text)]" data-map-info="">
                <p>Tap the map to set a target.</p>
                {roundOpen && <p>Your position stays on your device. It is never uploaded.</p>}
              </div>
            ) : null}
            overlayNotes={
              <>
              {displayHole != null && effectiveGeo?.derived === 'features' && displayGeoHole && (
                <span className="ea-mech-glass ea-mech-micro rounded-lg px-2 py-1" data-hole-derived="">{COPY.GOLF_HOLE.DERIVED_NOTE}</span>
              )}
              {displayHole != null && (awaitingPick ? (
                <span className="ea-mech-glass rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--mech-text)]" data-hole-pick-nine="">{COPY.GOLF_HOLE.PICK_NINE}</span>
              ) : greensOnly ? (
                <span className="ea-mech-glass rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--mech-text)]" data-hole-greens-only="">{COPY.GOLF_HOLE.GREENS_ONLY}</span>
              ) : !displayGeoHole && !displayGreenRing ? (
                <span className="ea-mech-glass rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--mech-text)]" data-hole-unmapped="">{COPY.GOLF_HOLE.NOT_MAPPED}</span>
              ) : null)}
              {/* PR 4: the nine picker — a club whose loops carry no labels is
                  drawn only after a pick (or an unmistakable GPS match). Letters,
                  never guessed names. */}
              {loopRows.length > 0 && (
                <div className="flex flex-col gap-1" data-loop-picker="">
                  {loopRows.map(row => (
                    <div key={row.key} className="ea-mech-glass flex flex-wrap items-center gap-1 rounded-xl px-2 py-1">
                      <span className="text-xs font-medium text-[color:var(--mech-text-soft)]">
                        {loopRows.length > 1 ? (row.key === 'front' ? COPY.GOLF_HOLE.FRONT_NINE : COPY.GOLF_HOLE.BACK_NINE) : COPY.GOLF_HOLE.WHICH_NINE}
                      </span>
                      {row.labels.map(label => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => pickLoopFor(row.key, label)}
                          aria-pressed={loopPicks[row.key] === label}
                          aria-label={COPY.GOLF_HOLE.NINE(label)}
                          data-loop-pick={`${row.key}:${label}`}
                          className="ea-mech-round inline-flex h-[44px] w-[44px] items-center justify-center text-sm font-bold"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              </>
            }
          />
          {/* The hole plate (D3): ALWAYS a stepper for a participant — ‹ ›
              walk the round's holes, tapping a tee marker jumps, and the map
              fits each hole that has a line; a hole without one says so and
              the map stays where it is. On a phone it stops 76 px from the
              right edge (the control capsule); 340 px wide from 640 px. */}
          {displayHole != null ? (
            <div className="live-map-plate z-[500]" data-map-hole-plate="">
              <div className="ea-mech-glass flex h-[68px] items-center rounded-2xl">
                <button type="button" aria-label="Previous hole" onClick={() => stepHole(-1)} className="ea-mech-btn inline-flex h-[44px] w-[40px] shrink-0 items-center justify-center text-[color:var(--mech-text)] max-[359px]:w-[32px]">
                  <ChevronLeftIcon size={20} />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-[12px] overflow-hidden max-[359px]:gap-[8px]" aria-live="polite">
                  <div className="flex shrink-0 flex-col">
                    {/* "Hole N" stays ONE string for a reader (and the specs' idiom); the drawing is the label over the number. */}
                    <span className="sr-only">Hole {displayHole}</span>
                    <span className="ea-mech-micro" aria-hidden="true">Hole</span>
                    <span className="ea-mech-readout text-[26px] leading-[28px]" aria-hidden="true" data-map-hole-number="">{displayHole}</span>
                  </div>
                  {displayHoleDetail?.par != null && (
                    <div className="flex shrink-0 flex-col" data-live-par-estimated={displayHoleDetail.parEstimated ? '' : undefined}>
                      <span className="sr-only">Par {displayHoleDetail.par}{displayHoleDetail.parEstimated ? ' (est.)' : ''}</span>
                      <span className="ea-mech-micro whitespace-nowrap" aria-hidden="true">{displayHoleDetail.parEstimated ? 'Par est.' : 'Par'}</span>
                      <span className="ea-mech-readout text-[15px] leading-5" aria-hidden="true">{displayHoleDetail.par}</span>
                    </div>
                  )}
                  {/* ONE distance (M2): from the fix when there is one — never the
                      card's yards beside a GPS plays-like — the card's otherwise. */}
                  {displayHoleDetail?.lines.distance && (
                    <div className="flex min-w-0 flex-col" data-chip-to-green={displayHoleDetail.lines.source ?? undefined} data-green-fcb={displayHoleDetail.lines.fcb ? '' : undefined}>
                      <span className="sr-only">{displayHoleDetail.lines.distance}</span>
                      {/* "Yds" either way: with a fix it is the yards to the green (the words are in the line above for a reader). */}
                      <span className="ea-mech-micro" aria-hidden="true">Yds</span>
                      <span className="ea-mech-readout truncate text-[15px] leading-5" aria-hidden="true">
                        {displayHoleDetail.lines.source === 'gps' ? displayHoleDetail.live.toGreen : `${displayHoleDetail.approx ? '≈' : ''}${displayHoleDetail.yards ?? ''}`}
                      </span>
                    </div>
                  )}
                  {/* What it plays like, with the rise (PR F / M2). */}
                  {displayHoleDetail?.lines.playsLike && (
                    <div className="flex min-w-0 flex-col" data-chip-plays-like="" data-plays-like-delta={displayHoleDetail.lines.riseYds ?? undefined}>
                      <span className="sr-only">{displayHoleDetail.lines.playsLike}</span>
                      <span className="ea-mech-micro" aria-hidden="true">Plays</span>
                      <span className="ea-mech-readout truncate text-[15px] leading-5" aria-hidden="true">
                        {displayHoleDetail.live.playsLike}
                        {formatRise(displayHoleDetail.live.riseYds) && (
                          <span className="ml-1 text-[11px] font-medium max-[359px]:hidden" style={{ color: 'var(--mech-accent-light)' }}>{formatRise(displayHoleDetail.live.riseYds)!.replace(/ yd$/, '').replace(' ', '')}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <button type="button" aria-label="Next hole" onClick={() => stepHole(1)} className="ea-mech-btn inline-flex h-[44px] w-[40px] shrink-0 items-center justify-center text-[color:var(--mech-text)] max-[359px]:w-[32px]">
                  <ChevronRightIcon size={20} />
                </button>
              </div>
            </div>
          ) : null}
          {/* The bottom bar (D3): First hole · Score hole N · Info — above
              the credit strip. "First hole" takes the round's starting hole
              and fits the map to it (fitNonce re-fits even when the plate is
              already there, so a drag away is one tap back). */}
          <div className="live-map-bar z-[500]" data-map-bar="">
            {displayHole != null && (
              <button
                type="button"
                onClick={() => {
                  setViewedHole(startHole);
                  setFitNonce(n => n + 1);
                }}
                aria-label={COPY.GOLF_HOLE.FIRST_HOLE_LABEL(startHole)}
                title={firstHoleMapped ? undefined : COPY.GOLF_HOLE.FIRST_HOLE_UNMAPPED(startHole)}
                data-map-first-hole=""
                className="ea-mech-glass ea-mech-btn inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-[color:var(--mech-text)]"
              >
                <SkipStartIcon size={20} />
              </button>
            )}
            {displayHole != null && entry.mode === 'score' ? (
              <button
                type="button"
                onClick={() => openScorer(entry.participantId, displayHole)}
                className="ea-mech-go inline-flex h-[56px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap px-4"
                style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.45), 0 4px 14px rgb(0 0 0 / 0.55)' }}
                data-map-score=""
              >
                <PencilIcon size={18} />
                Score hole {displayHole}
              </button>
            ) : (
              <span className="flex-1" />
            )}
            <button
              type="button"
              onClick={() => setMapInfoOpen(o => !o)}
              aria-label="About the map"
              aria-expanded={mapInfoOpen}
              aria-controls="live-map-info"
              data-map-info-key=""
              className="ea-mech-glass ea-mech-btn inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full"
              style={mapInfoOpen ? { backgroundColor: 'var(--mech-accent)', color: '#ffffff' } : { color: 'var(--mech-text)' }}
            >
              <InfoIcon size={20} />
            </button>
          </div>
        </div>
      )}
      </div>

      {showFullCard && (
        <SharedRoundFullCard
          scorecard={scorecard}
          currentUserId={viewerId ?? undefined}
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

      {scoringParticipantId && user && (
        <ScoreEntryModal
          key={`${scoringParticipantId}:${scoringHole ?? 'resume'}`}
          groupPostId={scorecard.group_post.id}
          roundStatus={scorecard.group_post.status}
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
          // The hole header (PR E): the tee, the sheet, the lines, the
          // profiles, the map's fix and everyone's scores — all optional.
          teeInPlay={scorecard.golf_data.tee_color}
          teeSheet={holeDetail?.sheet ?? null}
          holeLines={playedHoles}
          greens={geoGreens}
          holeElevation={holeDetail?.elevation ?? null}
          fix={playerFix}
          group={scorecard.participants
            .filter(p => isActiveParticipant(p.participant.status))
            .map(p => ({
              participantId: p.participant.id,
              name: formatDisplayName(
                p.participant.profile?.first_name ?? null,
                null,
                p.participant.profile?.last_name ?? null,
                p.participant.profile?.full_name ?? null
              ),
              isSelf: p.participant.profile_id === viewerId,
              holeScores: (p.scores.hole_scores ?? []).map(h => ({ hole_number: h.hole_number, strokes: h.strokes ?? null })),
            }))}
          // The map preview of a hole without a line looks at the course.
          courseAt={mapAvailable && courseInfo ? [courseInfo.lat as number, courseInfo.lng as number] : null}
          // The scorer's hole goes with it: the map opens where the player is.
          onShowMap={mapAvailable ? (hole: number) => { setViewedHole(hole); setScorerHole(hole); setTab('map'); } : undefined}
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
                    isSelf: p.participant.profile_id === viewerId,
                  }))
              : undefined
          }
          onSwitchPlayer={isCreator ? (id, hole) => { setScoringHole(hole); setScoringParticipantId(id); } : undefined}
          playerName={(() => {
            const p = scorecard.participants.find(
              x => x.participant.id === scoringParticipantId
            );
            if (!p || p.participant.profile_id === viewerId) return undefined;
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
            // snaps back to following the (freshly advanced) next hole. The
            // remembered scorer hole goes too: a plain close means the next
            // open resumes (the map button sets both again right after this).
            setViewedHole(null);
            setScorerHole(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

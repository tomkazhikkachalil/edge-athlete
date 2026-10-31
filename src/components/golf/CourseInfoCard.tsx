'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { UUID_RE as UUID_SHAPE } from '@/lib/uuid';
import type { GolfCourse } from '@/types/golf';
import type { GreenRing, HoleLine } from '@/lib/golf/hole-geometry';
import CourseMap from '@/components/golf/CourseMap';
import CourseScorecardTable from '@/components/golf/CourseScorecardTable';
import CourseSummaryCard from '@/components/golf/CourseSummaryCard';
import BrandLogo from '@/components/BrandLogo';
import LogoDevAttribution from '@/components/LogoDevAttribution';
import { websiteDomain, logoUrl } from '@/lib/logo-dev';

/**
 * About-this-course card under the composer's selected-course badge:
 * description (with its CC BY-SA attribution — a license duty wherever the
 * description renders), architect · year · type, website, a "View on map"
 * link, and an embedded interactive map.
 *
 * The map is the shared Leaflet CourseMap, lazy behind a toggle so the
 * composer never pays its cost unasked. When the course has cached OSM hole
 * geometry it becomes a hole-by-hole PREVIEW: numbered tees, a ‹ Hole N ›
 * stepper, tap-a-tee to focus — the same overlay the live round map draws,
 * minus anything GPS (the rangefinder pill needs a live fix, which card
 * surfaces never start). No geometry → exactly the old single-pin card;
 * null is a designed state (unmapped or ambiguous courses). Renders nothing
 * at all for courses with no extra data (history rows, custom courses).
 */
interface CourseInfoCardProps {
  course: GolfCourse;
  /** Round surfaces open the map immediately; the composer keeps the toggle. */
  defaultOpen?: boolean;
  /** Live round page only: the map offers device-geolocation tracking. */
  enableTracking?: boolean;
  /** 'hidden': no map affordance at all — the live portal's Map tab owns
   *  maps there; this card stays info-only. */
  mapMode?: 'toggle' | 'hidden';
  /** M3: where the summary's "View course map" goes when this card has no
   *  map of its own (`mapMode="hidden"` — the live page's Map tab). */
  onViewMap?: () => void;
  /** M3: the tee the round plays — the summary leads with it and names it
   *  when the card has no yardage for it. */
  teeInPlay?: string | null;
  /** "Find the official scorecard" found one (Oct 31 2026): the fuller course
   *  for the caller to adopt (the composer swaps its selection so the round's
   *  pars, tees and ratings follow). The card updates itself either way. */
  onCourseUpdated?: (course: GolfCourse) => void;
  /** The person just picked this course to play: ask for its card without a
   *  tap (Oct 31 2026). Other surfaces keep the button, and never ask unprompted. */
  autoFindSheet?: boolean;
}

export default function CourseInfoCard({ course, defaultOpen = false, enableTracking = false, mapMode = 'toggle', onViewMap, teeInPlay = null, onCourseUpdated, autoFindSheet = false }: CourseInfoCardProps) {
  // ONE panel at a time (Oct 29 2026, Tom's refinement spec): the map or
  // the official scorecard, opened by two side-by-side buttons under the
  // summary; opening one closes the other. `defaultOpen` opens the map.
  // Official scorecard: shown from course.holes when the caller has them;
  // otherwise lazily fetched by catalog id on first expand (embeds carry the
  // id but hardcode holes: [] — the tee sheet lives only in the catalog).
  const [open, setOpen] = useState<'map' | 'scorecard' | null>(defaultOpen ? 'map' : null);
  const showMap = open === 'map';
  const showScorecard = open === 'scorecard';
  const setShowMap = (next: boolean) => setOpen(next ? 'map' : null);
  const setShowScorecard = (next: boolean) => setOpen(next ? 'scorecard' : null);
  const [fetchedCourse, setFetchedCourse] = useState<GolfCourse | null>(null);
  // Phase 6b A2: "Home of {org} →" — the org site whose venue recognized
  // this course. Keyed by course id (the composer swaps `course` in place).
  const [homeOfState, setHomeOfState] = useState<{ id: string; orgName: string; path: string } | null>(null);
  const homeOf = homeOfState?.id === course.id ? homeOfState : null;
  const [scorecardLoading, setScorecardLoading] = useState(false);
  // Hole-by-hole preview: fetched once per card when the map is actually
  // shown (the endpoint serves the 30-day cache; anonymous-safe, so Explore
  // stays a guest surface). A ref guards the once-ness — a fetched-flag
  // setState here would trip the set-state-in-effect lint, and rightly so.
  // Both are KEYED BY COURSE and derived below: the composer swaps
  // `course` in place (unkeyed mount), and a per-instance flag + unkeyed
  // state drew course A's tees on course B's map and never fetched B.
  // Deriving by id drops them on a swap with no setState in an effect.
  // `holes: null` = asked, none (a designed state the summary names);
  // a different id = not asked yet (the summary makes no claim).
  const [holeLinesState, setHoleLinesState] = useState<{ id: string; holes: HoleLine[] | null; greens: GreenRing[] | null; sections: number } | null>(null);
  const [focusState, setFocusState] = useState<{ id: string; hole: number } | null>(null);
  const holeLines = holeLinesState?.id === course.id ? holeLinesState.holes : null;
  const holeGreens = holeLinesState?.id === course.id ? holeLinesState.greens : null;
  const holeLinesKnown = holeLinesState?.id === course.id;
  // PR 3: drawn greens with no lines — the summary names it as a softer gap.
  const greensOnly = holeLinesKnown && !holeLines && !!holeGreens?.some(g => g.hole == null);
  const sectionCount = holeLinesState?.id === course.id ? holeLinesState.sections : 0;
  const focusHole = focusState?.id === course.id ? focusState.hole : null;
  const setFocusHole = (hole: number | null) =>
    setFocusState(hole == null ? null : { id: course.id, hole });
  // Which course id the once-guard covers. Cleared on a failed response so
  // Hide/Show map retries — a single 429 from the shared course-search
  // limiter used to disable the preview for the life of the card.
  const holesRequestedFor = useRef<string | null>(null);
  // M3: the summary's thumbnail scrolls the card's own map into view.
  const mapRef = useRef<HTMLDivElement>(null);
  const hasCoords = typeof course.lat === 'number' && typeof course.lng === 'number';

  const mapVisible = showMap && hasCoords && mapMode !== 'hidden';
  // Phase 6b A2: one lightweight ?id= read per catalog course to learn its
  // home org. Guarded by course id so a swapped card refetches exactly once.
  const homeRequestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!UUID_SHAPE.test(course.id) || homeRequestedFor.current === course.id) return;
    const id = course.id;
    homeRequestedFor.current = id;
    let cancelled = false;
    fetch(`/api/golf/courses?id=${id}&home=1`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled) return;
        const h = body?.homeOf as { orgName: string; path: string } | undefined;
        if (h?.path) setHomeOfState({ id, ...h });
      })
      .catch(() => {
        if (!cancelled && homeRequestedFor.current === id) homeRequestedFor.current = null;
      });
    return () => {
      cancelled = true;
      if (homeRequestedFor.current === id) homeRequestedFor.current = null;
    };
  }, [course.id]);
  // M3: the lines are asked for at card-open (= mount), not at "Show map" —
  // the summary's thumbnail and its "No map lines" line need the answer.
  useEffect(() => {
    if (holesRequestedFor.current === course.id || !UUID_SHAPE.test(course.id)) return;
    const id = course.id;
    holesRequestedFor.current = id;
    let cancelled = false;
    fetch(`/api/golf/courses?id=${id}&holes=1`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`holes ${r.status}`))))
      .then(body => {
        if (cancelled) return;
        const geometry = body?.geometry as { holes?: HoleLine[]; greens?: GreenRing[]; sections?: unknown[] } | null;
        const holes = geometry?.holes;
        const greens = geometry?.greens;
        setHoleLinesState({ id, holes: Array.isArray(holes) && holes.length > 0 ? holes : null, greens: Array.isArray(greens) && greens.length > 0 ? greens : null, sections: Array.isArray(geometry?.sections) ? geometry!.sections!.length : 0 });
      })
      .catch(() => {
        // Transport/limiter failure — allow a retry on the next mount.
        // (A null geometry is a designed state and lands in `.then`.)
        if (!cancelled && holesRequestedFor.current === id) holesRequestedFor.current = null;
      });
    return () => {
      cancelled = true;
      // A cancelled ask was never answered: let the next mount ask again
      // (React's development double-mount, Oct 30 2026 — the "asked" ref
      // used to block the re-mount while the first request was discarded,
      // so the summary never learned the lines).
      if (holesRequestedFor.current === id) holesRequestedFor.current = null;
    };
  }, [course.id]);

  // M3: a row that arrived without its tee sheet (an embed's `holes: []`, a
  // thin catalog row) is asked for ONCE at card-open — the summary's stats
  // are there without a second tap. The Official-scorecard toggle used to
  // own this fetch; it now only shows the table. (A thin provider row
  // stamped within 7 days comes back thin: the summary says so.)
  const detailRequestedFor = useRef<string | null>(null);
  // The id whose detail has ANSWERED (with a course or with nothing) — the
  // scorecard button's "may still get a sheet" ends here, whatever came back.
  const [detailDoneFor, setDetailDoneFor] = useState<string | null>(null);
  // "Find the official scorecard" (Oct 31 2026): a tap, one ask, one answer.
  const [sheetAsk, setSheetAsk] = useState<'idle' | 'asking' | 'none' | 'failed'>('idle');
  const findSheetRef = useRef<() => Promise<void>>(async () => {});
  const findSheet = async () => {
    if (sheetAsk === 'asking') return;
    const upgrading = course.sheetSource === 'map';
    setSheetAsk('asking');
    try {
      const res = await fetch(`/api/golf/courses?id=${encodeURIComponent(course.id)}&sheet=1`, { credentials: 'include' });
      const body = res.ok ? ((await res.json()) as { found?: boolean; course?: GolfCourse }) : null;
      if (body?.found && body.course && body.course.holes.length > 0) {
        setFetchedCourse(body.course);
        setDetailDoneFor(course.id);
        setSheetAsk('idle');
        // An upgrade from a map card is quiet: the panel stays as the person left it.
        if (!upgrading) setOpen('scorecard');
        onCourseUpdated?.(body.course);
      } else {
        setSheetAsk(body ? 'none' : 'failed');
      }
    } catch {
      setSheetAsk('failed');
    }
  };
  useEffect(() => { findSheetRef.current = findSheet; });
  useEffect(() => {
    if (detailRequestedFor.current === course.id || !UUID_SHAPE.test(course.id) || course.holes.length > 0) return;
    const id = course.id;
    detailRequestedFor.current = id;
    let cancelled = false;
    setScorecardLoading(true);
    fetch(`/api/golf/courses?id=${id}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled) return;
        setFetchedCourse((body?.course as GolfCourse | null) ?? null);
        const h = body?.homeOf as { orgName: string; path: string } | undefined;
        if (h?.path) setHomeOfState({ id, ...h });
      })
      .catch(() => {
        if (!cancelled) setFetchedCourse(null);
      })
      .finally(() => {
        if (!cancelled) {
          setScorecardLoading(false);
          setDetailDoneFor(id);
        }
      });
    return () => {
      cancelled = true;
      // Same rule as the lines: a cancelled ask lets the next mount ask again.
      if (detailRequestedFor.current === id) detailRequestedFor.current = null;
    };
  }, [course.id, course.holes.length]);

  const logoDomain = websiteDomain(course.website);
  const logoAvailable = !!logoUrl(logoDomain ?? undefined, 40);
  const scorecardSource = course.holes.length > 0 ? course : fetchedCourse;
  // Honest states (Oct 30 2026, Tom's report of an empty panel on a real
  // course): the Official Scorecard button is offered when the course HAS a
  // sheet, or may still get one — a catalog row that is not map-only (OSM
  // rows never gain holes) and whose detail has not answered yet. A map-only
  // course gets no button (the summary's "Not fully mapped" says it); a
  // detail that answered without holes drops the button and closes the panel.
  const sheetKnown = course.holes.length > 0 || (scorecardSource?.holes.length ?? 0) > 0;
  const detailAnswered = detailDoneFor === course.id && !scorecardLoading;
  const mayStillGetSheet =
    UUID_SHAPE.test(course.id) && course.source !== 'osm' && (fetchedCourse?.source ?? course.source) !== 'osm' && !detailAnswered;
  const scorecardPossible = sheetKnown || mayStillGetSheet;
  // No sheet and nothing coming: offer to ASK for one (any catalog row —
  // a thin provider row or a map-only OSM row — may have a sheet under the
  // other provider's name).
  const sheetFindable = !scorecardPossible && UUID_SHAPE.test(course.id);
  const autoAskedFor = useRef<string | null>(null);
  useEffect(() => {
    // A map card asks too (Oct 31 2026): a provider card adds tees, handicaps
    // and ratings. Silent; on a miss the map card simply stays.
    if (!autoFindSheet || autoAskedFor.current === course.id) return;
    // An official card needs no ask, but the pick is counted (294).
    if (course.holes.length > 0 && course.sheetSource !== 'map' && UUID_SHAPE.test(course.id)) {
      autoAskedFor.current = course.id;
      void fetch(`/api/golf/courses?id=${encodeURIComponent(course.id)}&picked=1`, { credentials: 'include' }).catch(() => undefined);
      return;
    }
    if (!(sheetFindable || course.sheetSource === 'map')) return;
    autoAskedFor.current = course.id;
    queueMicrotask(() => { void findSheetRef.current(); });
  }, [autoFindSheet, sheetFindable, course.sheetSource, course.holes.length, course.id]);
  // The panel was opened on a promise the detail then broke: close it.
  if (open === 'scorecard' && !scorecardPossible) setOpen(null);
  const metaBits = [
    course.architect && `Designed by ${course.architect}`,
    course.yearBuilt && `est. ${course.yearBuilt}`,
    course.courseType,
  ].filter(Boolean);

  const hasAnything =
    course.description || metaBits.length > 0 || course.website || hasCoords || scorecardPossible;
  if (!hasAnything) return null;

  const toggleScorecard = () => setShowScorecard(!showScorecard);

  // M3: the summary's facts — the caller's course, or the detail the card
  // fetched for a row that arrived without its sheet.
  const summaryCourse = course.holes.length > 0 ? course : (fetchedCourse ?? course);
  const summaryLoading = course.holes.length === 0 && !fetchedCourse && scorecardLoading;
  const viewMap =
    hasCoords && mapMode !== 'hidden'
      ? () => {
          setShowMap(true);
          requestAnimationFrame(() => mapRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        }
      : mapMode === 'hidden' && hasCoords
        ? onViewMap
        : undefined;

  // Steps walk the ARRAY (partially mapped courses have gaps in hole
  // numbers); ‹ from the first hole returns to the course overview (null),
  // › from the overview enters at the first mapped hole.
  const stepPreview = (dir: 1 | -1) => {
    if (!holeLines?.length) return;
    const idx = focusHole == null ? -1 : holeLines.findIndex(h => h.hole === focusHole);
    const nextIdx = idx < 0 && dir === 1 ? 0 : idx + dir;
    setFocusHole(nextIdx < 0 ? null : holeLines[Math.min(nextIdx, holeLines.length - 1)].hole);
  };


  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken p-3 text-left">
      {/* M3: the course at a glance — FIRST, on every surface this card has. */}
      <CourseSummaryCard
        course={summaryCourse}
        holeLines={holeLinesKnown ? holeLines : undefined}
        greensOnly={greensOnly}
        sections={sectionCount}
        teeInPlay={teeInPlay}
        onViewMap={viewMap}
        loading={summaryLoading}
      />
      <div className={logoAvailable ? 'flex items-start gap-3' : ''}>
        {logoAvailable && (
          <BrandLogo domain={logoDomain ?? undefined} name={course.name} size={40} fallback={null} />
        )}
        <div className="min-w-0 flex-1">
          {course.description && (
            <>
              <p className="text-sm text-secondary leading-relaxed">{course.description}</p>
              {course.descriptionAttribution && (
                <p className="mt-1 text-[10px] text-faint">{course.descriptionAttribution}</p>
              )}
            </>
          )}
          {metaBits.length > 0 && (
            <p className={`text-xs text-tertiary ${course.description ? 'mt-2' : ''}`}>
              {metaBits.join(' · ')}
            </p>
          )}
        </div>
      </div>
      {/* Show Map | Official Scorecard (Oct 29 2026): two equal buttons; the
          open one reads Hide; one panel at a time, directly below. The old
          "View on map" Google link is gone. */}
      {((hasCoords && mapMode !== 'hidden') || scorecardPossible || sheetFindable) && (
        <div className="mt-3 grid grid-cols-2 gap-2" data-course-panels="">
          {hasCoords && mapMode !== 'hidden' && (
            <button
              type="button"
              onClick={() => setShowMap(!showMap)}
              aria-expanded={showMap}
              data-course-show-map=""
              className={`ea-interactive inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 text-xs sm:text-sm font-semibold whitespace-nowrap ${
                showMap ? 'border-brand bg-brand-soft text-brand-fg-strong' : 'border-border-strong bg-surface text-primary'
              }`}
            >
              <i className={`fas ${showMap ? 'fa-chevron-up' : 'fa-map'}`} aria-hidden="true"></i>
              {showMap ? 'Hide' : 'Show Map'}
            </button>
          )}
          {sheetFindable && !(autoFindSheet && sheetAsk !== 'failed') && (
            <button
              type="button"
              onClick={() => { void findSheet(); }}
              disabled={sheetAsk === 'asking'}
              aria-busy={sheetAsk === 'asking' || undefined}
              data-course-find-sheet=""
              className="ea-interactive inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 text-xs sm:text-sm font-semibold whitespace-nowrap text-primary disabled:opacity-60"
            >
              <i className={`fas ${sheetAsk === 'asking' ? 'fa-spinner fa-spin' : 'fa-table-list'}`} aria-hidden="true"></i>
              {sheetAsk === 'asking' ? 'Looking…' : 'Find the official scorecard'}
            </button>
          )}
          {scorecardPossible && (
            <button
              type="button"
              onClick={toggleScorecard}
              aria-expanded={showScorecard}
              data-course-show-scorecard=""
              className={`ea-interactive inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 text-xs sm:text-sm font-semibold whitespace-nowrap ${
                showScorecard ? 'border-brand bg-brand-soft text-brand-fg-strong' : 'border-border-strong bg-surface text-primary'
              }`}
            >
              <i className={`fas ${showScorecard ? 'fa-chevron-up' : 'fa-table-list'}`} aria-hidden="true"></i>
              {showScorecard ? 'Hide' : 'Official Scorecard'}
            </button>
          )}
        </div>
      )}
      {sheetFindable && autoFindSheet && sheetAsk === 'asking' && (
        <p className="mt-2 text-sm text-tertiary" data-course-sheet-looking="">Looking for the official scorecard…</p>
      )}
      {sheetFindable && (sheetAsk === 'none' || sheetAsk === 'failed') && (
        <p className="mt-2 text-sm text-tertiary" data-course-sheet-none="">
          {sheetAsk === 'none'
            ? 'No official scorecard found for this course yet.'
            : 'Could not look that up right now — try again in a minute.'}
        </p>
      )}
      {showScorecard && (
        <div className="mt-2" data-course-scorecard="">
          {scorecardSource && scorecardSource.holes.length > 0 ? (
            <CourseScorecardTable course={scorecardSource} />
          ) : scorecardLoading ? (
            <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" data-course-scorecard-loading="" />
          ) : (
            // Never an empty panel behind a Hide button.
            <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-tertiary" data-course-scorecard-none="">
              No official scorecard for this course yet — the catalog has its location only.
            </p>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {homeOf && (
          <Link
            href={homeOf.path}
            className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-brand-fg hover:underline"
          >
            <i className="fas fa-house-flag" aria-hidden="true"></i>
            Home of {homeOf.orgName}
          </Link>
        )}
        {course.website && (
          <a
            href={course.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-brand-fg hover:underline"
          >
            <i className="fas fa-globe" aria-hidden="true"></i>
            Website
          </a>
        )}
      </div>
      {mapVisible && (
        <div className="mt-2" ref={mapRef}>
          {holeLines && holeLines.length > 0 && (
            <div className="mb-2 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => stepPreview(-1)}
                disabled={focusHole == null}
                aria-label="Previous hole"
                className="ea-icon-btn text-brand-fg disabled:opacity-40"
              >
                <i className="fas fa-chevron-left" aria-hidden="true"></i>
              </button>
              <span className="font-medium text-primary">
                {focusHole != null
                  ? `Hole ${focusHole}`
                  : `${holeLines.length} holes mapped — tap a tee or step through`}
              </span>
              <button
                type="button"
                onClick={() => stepPreview(1)}
                disabled={focusHole === holeLines[holeLines.length - 1].hole}
                aria-label="Next hole"
                className="ea-icon-btn text-brand-fg disabled:opacity-40"
              >
                <i className="fas fa-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
          )}
          <CourseMap
            lat={course.lat!}
            lng={course.lng!}
            courseName={course.name}
            enableTracking={enableTracking}
            holes={holeLines}
            greens={holeGreens}
            focusHole={focusHole}
            onHoleTap={setFocusHole}
          />
        </div>
      )}
      {logoAvailable && <LogoDevAttribution className="mt-2 block text-[10px] text-faint" />}
    </div>
  );
}

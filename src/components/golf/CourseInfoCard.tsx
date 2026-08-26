'use client';

import { useEffect, useRef, useState } from 'react';
import { UUID_RE as UUID_SHAPE } from '@/lib/uuid';
import type { GolfCourse } from '@/types/golf';
import type { HoleLine } from '@/lib/golf/hole-geometry';
import CourseMap from '@/components/golf/CourseMap';
import CourseScorecardTable from '@/components/golf/CourseScorecardTable';
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
}

export default function CourseInfoCard({ course, defaultOpen = false, enableTracking = false, mapMode = 'toggle' }: CourseInfoCardProps) {
  const [showMap, setShowMap] = useState(defaultOpen);
  // Official scorecard: shown from course.holes when the caller has them;
  // otherwise lazily fetched by catalog id on first expand (embeds carry the
  // id but hardcode holes: [] — the tee sheet lives only in the catalog).
  const [showScorecard, setShowScorecard] = useState(false);
  const [fetchedCourse, setFetchedCourse] = useState<GolfCourse | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  // Hole-by-hole preview: fetched once per card when the map is actually
  // shown (the endpoint serves the 30-day cache; anonymous-safe, so Explore
  // stays a guest surface). A ref guards the once-ness — a fetched-flag
  // setState here would trip the set-state-in-effect lint, and rightly so.
  // Both are KEYED BY COURSE and derived below: the composer swaps
  // `course` in place (unkeyed mount), and a per-instance flag + unkeyed
  // state drew course A's tees on course B's map and never fetched B.
  // Deriving by id drops them on a swap with no setState in an effect.
  const [holeLinesState, setHoleLinesState] = useState<{ id: string; holes: HoleLine[] } | null>(null);
  const [focusState, setFocusState] = useState<{ id: string; hole: number } | null>(null);
  const holeLines = holeLinesState?.id === course.id ? holeLinesState.holes : null;
  const focusHole = focusState?.id === course.id ? focusState.hole : null;
  const setFocusHole = (hole: number | null) =>
    setFocusState(hole == null ? null : { id: course.id, hole });
  // Which course id the once-guard covers. Cleared on a failed response so
  // Hide/Show map retries — a single 429 from the shared course-search
  // limiter used to disable the preview for the life of the card.
  const holesRequestedFor = useRef<string | null>(null);
  const hasCoords = typeof course.lat === 'number' && typeof course.lng === 'number';

  const mapVisible = showMap && hasCoords && mapMode !== 'hidden';
  useEffect(() => {
    if (!mapVisible || holesRequestedFor.current === course.id || !UUID_SHAPE.test(course.id)) return;
    const id = course.id;
    holesRequestedFor.current = id;
    let cancelled = false;
    fetch(`/api/golf/courses?id=${id}&holes=1`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`holes ${r.status}`))))
      .then(body => {
        if (cancelled) return;
        const holes = (body?.geometry as { holes?: HoleLine[] } | null)?.holes;
        if (Array.isArray(holes) && holes.length > 0) setHoleLinesState({ id, holes });
      })
      .catch(() => {
        // Transport/limiter failure — allow a retry on the next map open.
        // (A null geometry is a designed state and lands in `.then`.)
        if (!cancelled && holesRequestedFor.current === id) holesRequestedFor.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [mapVisible, course.id]);

  const logoDomain = websiteDomain(course.website);
  const logoAvailable = !!logoUrl(logoDomain ?? undefined, 40);
  const scorecardSource = course.holes.length > 0 ? course : fetchedCourse;
  const scorecardPossible = course.holes.length > 0 || UUID_SHAPE.test(course.id);
  const metaBits = [
    course.architect && `Designed by ${course.architect}`,
    course.yearBuilt && `est. ${course.yearBuilt}`,
    course.courseType,
  ].filter(Boolean);

  const hasAnything =
    course.description || metaBits.length > 0 || course.website || hasCoords || scorecardPossible;
  if (!hasAnything) return null;

  const toggleScorecard = () => {
    const next = !showScorecard;
    setShowScorecard(next);
    if (next && course.holes.length === 0 && !fetchedCourse && !scorecardLoading) {
      setScorecardLoading(true);
      fetch(`/api/golf/courses?id=${course.id}`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(body => setFetchedCourse((body?.course as GolfCourse | null) ?? null))
        .catch(() => setFetchedCourse(null))
        .finally(() => setScorecardLoading(false));
    }
  };

  // Steps walk the ARRAY (partially mapped courses have gaps in hole
  // numbers); ‹ from the first hole returns to the course overview (null),
  // › from the overview enters at the first mapped hole.
  const stepPreview = (dir: 1 | -1) => {
    if (!holeLines?.length) return;
    const idx = focusHole == null ? -1 : holeLines.findIndex(h => h.hole === focusHole);
    const nextIdx = idx < 0 && dir === 1 ? 0 : idx + dir;
    setFocusHole(nextIdx < 0 ? null : holeLines[Math.min(nextIdx, holeLines.length - 1)].hole);
  };

  const mapsQuery = hasCoords
    ? `${course.lat},${course.lng}`
    : [course.name, course.city, course.state].filter(Boolean).join(', ');
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;


  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken p-3 text-left">
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
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-brand-fg hover:underline"
        >
          <i className="fas fa-map-marker-alt" aria-hidden="true"></i>
          View on map
        </a>
        {hasCoords && mapMode !== 'hidden' && (
          <button
            type="button"
            onClick={() => setShowMap(v => !v)}
            className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-brand-fg hover:underline"
          >
            <i className={`fas ${showMap ? 'fa-chevron-up' : 'fa-map'}`} aria-hidden="true"></i>
            {showMap ? 'Hide map' : 'Show map'}
          </button>
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
        {scorecardPossible && (
          <button
            type="button"
            onClick={toggleScorecard}
            className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-brand-fg hover:underline"
          >
            <i className={`fas ${showScorecard ? 'fa-chevron-up' : 'fa-table-list'}`} aria-hidden="true"></i>
            {showScorecard ? 'Hide scorecard' : 'Official scorecard'}
          </button>
        )}
      </div>
      {showScorecard && (
        <div className="mt-2">
          {scorecardSource && scorecardSource.holes.length > 0 ? (
            <CourseScorecardTable course={scorecardSource} />
          ) : scorecardLoading ? (
            <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
          ) : (
            <p className="text-xs text-tertiary">No hole-by-hole tee sheet is available for this course.</p>
          )}
        </div>
      )}
      {mapVisible && (
        <div className="mt-2">
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
            focusHole={focusHole}
            onHoleTap={setFocusHole}
          />
        </div>
      )}
      {logoAvailable && <LogoDevAttribution className="mt-2 block text-[10px] text-faint" />}
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { GolfCourse } from '@/types/golf';
import CourseMap from '@/components/golf/CourseMap';
import CourseScorecardTable from '@/components/golf/CourseScorecardTable';
import BrandLogo from '@/components/BrandLogo';
import LogoDevAttribution from '@/components/LogoDevAttribution';
import { websiteDomain, logoUrl } from '@/lib/logo-dev';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * About-this-course card under the composer's selected-course badge:
 * description (with its CC BY-SA attribution — a license duty wherever the
 * description renders), architect · year · type, website, a "View on map"
 * link, and an embedded interactive map.
 *
 * The map is OpenStreetMap's embed frame — pan/zoom with a marker, ZERO new
 * dependencies (Tom approved an interactive map; Leaflet + per-hole GPS
 * overlays are the future round, once providers actually carry polygon
 * data — sampled fields are all null today). Lazy behind a toggle so the
 * composer never pays the iframe cost unasked. Renders nothing at all for
 * courses with no extra data (history rows, custom courses).
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
  const hasCoords = typeof course.lat === 'number' && typeof course.lng === 'number';
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
      {showMap && hasCoords && mapMode !== 'hidden' && (
        <div className="mt-2">
          <CourseMap
            lat={course.lat!}
            lng={course.lng!}
            courseName={course.name}
            enableTracking={enableTracking}
          />
        </div>
      )}
      {logoAvailable && <LogoDevAttribution className="mt-2 block text-[10px] text-faint" />}
    </div>
  );
}

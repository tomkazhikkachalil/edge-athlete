'use client';

import { useState } from 'react';
import type { GolfCourse } from '@/types/golf';
import CourseMap from '@/components/golf/CourseMap';

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
}

export default function CourseInfoCard({ course, defaultOpen = false, enableTracking = false }: CourseInfoCardProps) {
  const [showMap, setShowMap] = useState(defaultOpen);
  const hasCoords = typeof course.lat === 'number' && typeof course.lng === 'number';
  const metaBits = [
    course.architect && `Designed by ${course.architect}`,
    course.yearBuilt && `est. ${course.yearBuilt}`,
    course.courseType,
  ].filter(Boolean);

  const hasAnything = course.description || metaBits.length > 0 || course.website || hasCoords;
  if (!hasAnything) return null;

  const mapsQuery = hasCoords
    ? `${course.lat},${course.lng}`
    : [course.name, course.city, course.state].filter(Boolean).join(', ');
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;


  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken p-3 text-left">
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
        {hasCoords && (
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
      </div>
      {showMap && hasCoords && (
        <div className="mt-2">
          <CourseMap
            lat={course.lat!}
            lng={course.lng!}
            courseName={course.name}
            enableTracking={enableTracking}
          />
        </div>
      )}
    </div>
  );
}

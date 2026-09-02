'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { GolfCourse } from '@/types/golf';
import CourseCard from '@/components/golf/CourseCard';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import { formatPlace } from '@/lib/geo/regions';
import { courseDisplayName } from '@/lib/golf/tees';

// The org page's venues & courses section (phase 6b A1) — the club's
// PROPERTY: its venues, their facilities, and any catalog golf course a
// manager has recognized on a venue (tees, scorecard, map via the shared
// CourseInfoCard). The OrgStandings contract: additive, renders nothing
// when the org has no venues, a failed load renders nothing.

interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  facilities: { id: string; name: string; kind: string | null }[];
  courses: GolfCourse[];
}

interface OrgVenuesProps {
  side: 'league' | 'club';
  orgId: string;
}

export default function OrgVenues({ side, orgId }: OrgVenuesProps) {
  const [venues, setVenues] = useState<VenueRow[] | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = side === 'league' ? `/api/leagues/${orgId}/venues` : `/api/clubs/${orgId}/venues`;
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setVenues(data.venues ?? []);
      } catch {
        /* additive section — a failed load renders nothing */
      }
    })();
    return () => { cancelled = true; };
  }, [side, orgId]);

  if (!venues || venues.length === 0) return null;

  const hasCourses = venues.some(v => v.courses.length > 0);

  return (
    <section
      aria-label={hasCourses ? 'Courses' : 'Venues'}
      className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6"
    >
      <h2 className="text-lg font-semibold text-primary mb-4">
        {hasCourses ? 'Courses' : 'Venues'}
      </h2>
      <ul className="space-y-5">
        {venues.map(venue => {
          const place = formatPlace({ city: venue.city, region: venue.region, country: venue.country });
          return (
            <li key={venue.id}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-primary">{venue.name}</span>
                {place && (
                  <span className="inline-flex items-center gap-1 text-sm text-tertiary">
                    <MapPin className="w-3.5 h-3.5" />
                    {place}
                  </span>
                )}
              </div>
              {venue.facilities.length > 0 && (
                <p className="mt-1 text-sm text-tertiary">
                  {venue.facilities
                    .map(f => (f.kind ? `${f.name} (${f.kind})` : f.name))
                    .join(' · ')}
                </p>
              )}
              {venue.courses.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {venue.courses.map(course => {
                    const expanded = openCourse === course.id;
                    return (
                      <li key={course.id}>
                        <CourseCard
                          course={{ ...course, name: courseDisplayName(course.clubName, course.name) }}
                          expanded={expanded}
                          onClick={() => setOpenCourse(expanded ? null : course.id)}
                        />
                        {expanded && (
                          <div className="mt-2">
                            <CourseInfoCard course={course} defaultOpen mapMode="toggle" />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

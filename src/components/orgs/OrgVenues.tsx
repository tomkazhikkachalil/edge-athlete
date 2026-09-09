'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { GolfCourse } from '@/types/golf';
import CourseCard from '@/components/golf/CourseCard';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import { formatPlace } from '@/lib/geo/regions';
import { courseDisplayName } from '@/lib/golf/tees';
import MediaTile from '@/components/media/MediaTile';
import MediaLightbox from '@/components/media/MediaLightbox';
import type { CollageItem } from '@/components/media/MediaCollage';
import type { AppCoursePhotos } from '@/lib/org-sites/course-photos';

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
  /** Org Pages R3: hosted in a LargerWindow — no card chrome of its own. */
  bare?: boolean;
}

export default function OrgVenues({ side, orgId, bare = false }: OrgVenuesProps) {
  const [venues, setVenues] = useState<VenueRow[] | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  // R4: the console's course + hole photos (the venues read carries them).
  const [photos, setPhotos] = useState<Record<string, AppCoursePhotos>>({});
  const [lightbox, setLightbox] = useState<{ items: CollageItem[]; index: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = side === 'league' ? `/api/leagues/${orgId}/venues` : `/api/clubs/${orgId}/venues`;
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) {
          setVenues(data.venues ?? []);
          setPhotos((data.photos ?? {}) as Record<string, AppCoursePhotos>);
        }
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
      className={bare ? '' : 'mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6'}
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
                    const media = photos[course.id];
                    const holeItems: CollageItem[] = Object.entries(media?.holes ?? {})
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([n, h]) => ({ id: `${course.id}-hole-${n}`, url: h.url, kind: 'image' as const, alt: h.alt || `Hole ${n}` }));
                    const coverItem: CollageItem | null = media?.photo
                      ? { id: `${course.id}-cover`, url: media.photo.url, kind: 'image', alt: media.photo.alt }
                      : null;
                    const all = coverItem ? [coverItem, ...holeItems] : holeItems;
                    return (
                      <li key={course.id}>
                        {/* R4: the course photo the console set — the same
                            16:9 hero the public course page leads with. */}
                        {coverItem && (
                          <MediaTile
                            src={coverItem.url}
                            kind="image"
                            alt={coverItem.alt ?? ''}
                            className="aspect-video rounded-lg mb-2"
                            sizes="(max-width: 640px) 100vw, 640px"
                            onClick={() => setLightbox({ items: all, index: 0 })}
                          />
                        )}
                        <CourseCard
                          course={{ ...course, name: courseDisplayName(course.clubName, course.name) }}
                          expanded={expanded}
                          onClick={() => setOpenCourse(expanded ? null : course.id)}
                        />
                        {expanded && (
                          <div className="mt-2">
                            <CourseInfoCard course={course} defaultOpen mapMode="toggle" />
                            {/* R4: the hole photos as a strip (snap-scrolling
                                sideways at phone width, never widening the page). */}
                            {holeItems.length > 0 && (
                              <div className="mt-3 flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1" data-hole-photos={course.id}>
                                {holeItems.map((h, i) => (
                                  <MediaTile
                                    key={h.id}
                                    src={h.url}
                                    kind="image"
                                    alt={h.alt ?? ''}
                                    className="aspect-[4/3] w-32 shrink-0 snap-start rounded-lg"
                                    sizes="128px"
                                    onClick={() => setLightbox({ items: all, index: coverItem ? i + 1 : i })}
                                  />
                                ))}
                              </div>
                            )}
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
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndexChange={i => setLightbox(l => (l ? { ...l, index: i } : l))}
          onClose={() => setLightbox(null)}
          footerFor={item => <span className="text-sm">{item.alt}</span>}
        />
      )}
    </section>
  );
}

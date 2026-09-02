import Link from 'next/link';
import type { PublicCourse } from '@/lib/org-sites/public-data';
import { appBaseUrl } from '@/lib/org-sites/urls';
import { courseDisplayName, courseTeeOptions, teeLabel } from '@/lib/golf/tees';
import CourseScorecardTable from '@/components/golf/CourseScorecardTable';

// Courses module (phase 6b A2): the golf club's linked catalog courses.
// Server-safe by construction — plain markup, no Leaflet (the interactive
// map lives in the app; "View on map" deep-links to Explore with an
// ABSOLUTE app URL, the RegisterCard precedent, so it resolves on a
// custom host too). The description's CC BY-SA attribution renders
// wherever the description does — a license duty, not a nicety.

function placeLine(c: PublicCourse['course']): string {
  return [c.city, c.state, c.country].filter(Boolean).join(', ');
}

function teeSummary(c: PublicCourse['course']): string[] {
  return courseTeeOptions(c)
    .map(tee => {
      const rating = c.courseRating?.[tee];
      const slope = c.slopeRating?.[tee];
      if (rating === undefined && slope === undefined) return null;
      return `${teeLabel(tee)} ${[rating, slope].filter(v => v !== undefined).join(' / ')}`;
    })
    .filter((s): s is string => !!s);
}

export default function CoursesList({
  courses,
  detailed,
  basePath,
}: {
  courses: PublicCourse[];
  /** Home shows a teaser list; /courses renders the full tee sheets. */
  detailed: boolean;
  basePath: string;
}) {
  if (!detailed) {
    return (
      <>
        <ul className="mt-2 divide-y divide-border-subtle">
          {courses.map(({ venueName, course }) => (
            <li key={course.id} className="py-2.5">
              <p className="text-sm font-medium text-primary">
                {courseDisplayName(course.clubName, course.name)}
              </p>
              <p className="text-xs text-tertiary">
                {[
                  venueName,
                  course.holesCount ? `${course.holesCount} holes` : null,
                  course.totalPar ? `par ${course.totalPar}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
        <Link
          href={`${basePath}/courses`}
          className="mt-3 inline-block text-sm text-brand-fg font-medium"
        >
          Scorecards &amp; details →
        </Link>
      </>
    );
  }

  return (
    <div className="space-y-6">
      {courses.map(({ venueName, course }) => {
        const tees = teeSummary(course);
        const meta = [
          course.architect ? `Designed by ${course.architect}` : null,
          course.yearBuilt ? `est. ${course.yearBuilt}` : null,
          course.courseType ?? null,
        ].filter(Boolean);
        const place = placeLine(course);
        return (
          <article
            key={course.id}
            aria-label={courseDisplayName(course.clubName, course.name)}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary">
              {courseDisplayName(course.clubName, course.name)}
            </h2>
            <p className="mt-1 text-sm text-tertiary">
              {[
                venueName,
                place || null,
                course.holesCount ? `${course.holesCount} holes` : null,
                course.totalPar ? `par ${course.totalPar}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {meta.length > 0 && <p className="mt-1 text-xs text-tertiary">{meta.join(' · ')}</p>}
            {course.description && (
              <>
                <p className="mt-3 text-sm text-secondary leading-relaxed">{course.description}</p>
                {course.descriptionAttribution && (
                  <p className="mt-1 text-[10px] text-faint">{course.descriptionAttribution}</p>
                )}
              </>
            )}
            {tees.length > 0 && (
              <p className="mt-3 text-xs text-secondary">
                <span className="font-semibold text-primary">Rating / slope:</span>{' '}
                {tees.join(' · ')}
              </p>
            )}
            {course.holes.length > 0 && (
              <div className="mt-3">
                <CourseScorecardTable course={course} />
              </div>
            )}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a
                href={`${appBaseUrl()}/explore?course=${encodeURIComponent(course.id)}`}
                className="text-brand-fg font-medium"
              >
                View on map →
              </a>
              {course.website && /^https:\/\//.test(course.website) && (
                <a
                  href={course.website}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="text-brand-fg font-medium"
                >
                  Website
                </a>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}

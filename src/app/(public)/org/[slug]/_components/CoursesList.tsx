import Link from 'next/link';
import type { PublicCourse } from '@/lib/org-sites/public-data';
import { appBaseUrl } from '@/lib/org-sites/urls';
import { courseDisplayName, courseTeeOptions, teeLabel } from '@/lib/golf/tees';
import CourseScorecardTable from '@/components/golf/CourseScorecardTable';

// Courses module (phase 6b A2; S2 gave every course its own page). The
// golf club's linked catalog courses, grouped under their golf club when
// a facility contributes more than one layout (named nines, a second 18).
// Server-safe by construction — plain markup, no Leaflet. The
// description's CC BY-SA attribution renders wherever the description
// does — a license duty, not a nicety.

export function placeLine(c: PublicCourse['course']): string {
  return [c.city, c.state, c.country].filter(Boolean).join(', ');
}

/** "North Nine · 9 holes" — a section at a multi-course club; null for a
 *  plain course (nothing to say). */
export function sectionLabel(c: PublicCourse['course']): string | null {
  if (!c.sectionName && c.sectionKind !== 'nine') return null;
  const kind = c.sectionKind === 'nine' ? '9 holes' : c.sectionKind === 'course_18' ? '18 holes' : null;
  return [c.sectionName ?? null, kind].filter(Boolean).join(' · ') || null;
}

export function teeSummary(c: PublicCourse['course']): string[] {
  return courseTeeOptions(c)
    .map(tee => {
      const rating = c.courseRating?.[tee];
      const slope = c.slopeRating?.[tee];
      if (rating === undefined && slope === undefined) return null;
      return `${teeLabel(tee)} ${[rating, slope].filter(v => v !== undefined).join(' / ')}`;
    })
    .filter((s): s is string => !!s);
}

/** Group by golf club; a heading only when a club contributes ≥2 layouts. */
export function groupCourses(courses: PublicCourse[]): { key: string; heading: string | null; items: PublicCourse[] }[] {
  const groups = new Map<string, PublicCourse[]>();
  for (const c of courses) {
    const key = c.course.clubId ?? `solo:${c.course.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    heading: items.length >= 2 ? (items[0].course.clubName ?? items[0].venueName) : null,
    items,
  }));
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
  const groups = groupCourses(courses);

  if (!detailed) {
    return (
      <>
        <ul className="mt-2 divide-y divide-border-subtle">
          {groups.map(g =>
            g.items.map(({ venueName, course }) => (
              <li key={course.id} className="py-2.5">
                <Link href={`${basePath}/courses/${course.id}`} className="text-sm font-medium text-primary hover:text-brand-fg">
                  {g.heading ? (course.sectionName ?? course.name) : courseDisplayName(course.clubName, course.name)}
                </Link>
                <p className="text-xs text-tertiary">
                  {[
                    g.heading ?? venueName,
                    course.holesCount ? `${course.holesCount} holes` : null,
                    course.totalPar ? `par ${course.totalPar}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))
          )}
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
      {groups.map(g => (
        <div key={g.key} className="space-y-4">
          {g.heading && <h2 className="text-lg font-semibold text-primary">{g.heading}</h2>}
          {g.items.map(({ venueName, course }) => {
            const tees = teeSummary(course);
            const meta = [
              course.architect ? `Designed by ${course.architect}` : null,
              course.yearBuilt ? `est. ${course.yearBuilt}` : null,
              course.courseType ?? null,
            ].filter(Boolean);
            const place = placeLine(course);
            const section = sectionLabel(course);
            const title = g.heading ? (course.sectionName ?? course.name) : courseDisplayName(course.clubName, course.name);
            return (
              <article
                key={course.id}
                aria-label={courseDisplayName(course.clubName, course.name)}
                className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
              >
                <h3 className="text-lg font-semibold text-primary">
                  <Link href={`${basePath}/courses/${course.id}`} className="hover:text-brand-fg">
                    {title}
                  </Link>
                </h3>
                {section && !g.heading && <p className="mt-0.5 text-sm font-medium text-secondary">{section}</p>}
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
                  <Link href={`${basePath}/courses/${course.id}`} className="text-brand-fg font-medium">
                    Hole by hole →
                  </Link>
                  {/* An ABSOLUTE app URL (the RegisterCard precedent): the
                      interactive map lives in the app, and this resolves on
                      a custom host too. */}
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
      ))}
    </div>
  );
}

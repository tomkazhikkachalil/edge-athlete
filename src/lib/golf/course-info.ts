// Pure adapter: an embedded golf_courses row (snake_case, via the FK embeds
// in GROUP_SCORECARD_SELECT / the rounds GET) → the flat GolfCourse shape
// CourseInfoCard consumes. Round surfaces never fetch the catalog directly.

import type { GolfCourse } from '@/types/golf';
import type { EmbeddedCourseInfo } from '@/types/group-posts';

export function embeddedCourseToInfo(row: EmbeddedCourseInfo | null | undefined): GolfCourse | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    city: row.city ?? undefined,
    state: row.region ?? undefined,
    holes: [],
    totalPar: 72,
    courseRating: {},
    slopeRating: {},
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    description: row.description ?? undefined,
    descriptionAttribution: row.description_attribution ?? undefined,
    architect: row.architect ?? undefined,
    yearBuilt: row.year_built ?? undefined,
    courseType: row.course_type ?? undefined,
    website: row.website ?? undefined,
  };
}

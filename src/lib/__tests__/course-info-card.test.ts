import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The course card's Official Scorecard (Oct 30 2026, Tom's report of an
// empty panel on a real course): the button is offered only when a sheet
// exists or may still arrive — never for a map-only (OSM) row — and the
// panel always says something: the table, the skeleton, or the "none" line.
const src = fs.readFileSync(path.join(process.cwd(), 'src/components/golf/CourseInfoCard.tsx'), 'utf8');

describe('CourseInfoCard — honest scorecard states', () => {
  it('a map-only row never gets the button; a detail that answered without holes drops it and closes the panel', () => {
    expect(src).toMatch(/course\.source !== 'osm'/);
    expect(src).toMatch(/const scorecardPossible = sheetKnown \|\| mayStillGetSheet;/);
    expect(src).toMatch(/if \(open === 'scorecard' && !scorecardPossible\) setOpen\(null\);/);
  });
  it('the panel is the table, the skeleton, or the none line — never null behind Hide', () => {
    expect(src).toContain('data-course-scorecard-loading=""');
    expect(src).toContain('data-course-scorecard-none=""');
    expect(src).toMatch(/No official scorecard for this course yet/);
    expect(src).not.toMatch(/\) : null \/\* the summary's "Not fully mapped" line says it \*\//);
  });
  it('"Find the official scorecard" is offered when no sheet is coming, asks the route once, and adopts the answer', () => {
    expect(src).toMatch(/const sheetFindable = !scorecardPossible && UUID_SHAPE\.test\(course\.id\);/);
    expect(src).toContain('data-course-find-sheet=""');
    expect(src).toMatch(/\/api\/golf\/courses\?id=\$\{encodeURIComponent\(course\.id\)\}&sheet=1/);
    expect(src).toMatch(/onCourseUpdated\?\.\(body\.course\)/);
    expect(src).toContain('data-course-sheet-none=""');
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/golf/courses/route.ts'), 'utf8');
    expect(route).toMatch(/searchParams\.get\('sheet'\) === '1'/);
    expect(route).toMatch(/if \(!viewerId\) return NextResponse\.json\(\{ error: 'Authentication required' \}, \{ status: 401 \}\);/);
    expect(route).toMatch(/findOfficialSheet\(admin, row\)/);
  });
  it('asks on its own only where the composer says so, and the server asks once a day per course', () => {
    expect(src).toMatch(/autoFindSheet = false/);
    const composer = fs.readFileSync(path.join(process.cwd(), 'src/components/golf/GolfComposerSection.tsx'), 'utf8');
    expect(composer).toMatch(/autoFindSheet\n/);
    const catalog = fs.readFileSync(path.join(process.cwd(), 'src/lib/golf/course-catalog.ts'), 'utf8');
    expect(catalog).toContain('golf-sheet-ask:${row.id}');
    expect(catalog).toContain('const mapSheet = hadCard ? null : await readMapSheet(admin, row.id);');
    // The map card is checked first, and an answer that disagrees with it is merged only if a second provider confirms it (Nov 18 2026).
    expect(catalog).toContain('const agreesWithMap = sheetAgreesWithMap(normalized.hole_data, mapSheet);');
    expect(catalog).toContain('const merged = agreesWithMap ? mergeSheets(card, normalized) : null;');
    expect(catalog).toContain('a.source !== b.source && providersConfirm(');
    expect(src).toMatch(/sheetFindable \|\| isMapSheet\(course\.sheetSource\)/); // both map sources (Nov 18 2026)
  });
  it('an official card that still lacks something asks quietly; a complete one only counts the pick (Nov 16 2026)', () => {
    expect(src).toContain('const officialHasGaps = sheetGaps({ hole_data: course.holes, course_rating: course.courseRating, slope_rating: course.slopeRating }).length > 0;');
    expect(src).toMatch(/if \(officialHasGaps\) \{\n\s+queueMicrotask/);
    expect(src).toContain("const upgrading = isMapSheet(course.sheetSource) || course.holes.length > 0;");
  });
  it('one panel at a time: Show Map | Official Scorecard over one `open` state', () => {
    expect(src).toMatch(/useState<'map' \| 'scorecard' \| null>/);
    expect(src).toContain('data-course-show-map=""');
    expect(src).toContain('data-course-show-scorecard=""');
  });
});

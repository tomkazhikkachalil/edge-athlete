import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The golf round's course step in the mechanical dialect (Tom's visual spec,
// Nov 23 2026). A VISUAL change: this pins that what is drawn is wired to the
// handlers the one-page form had — read from the source (the step renders in
// a browser; e2e/golf-course-step.spec.ts walks it).
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const section = read('src/components/golf/GolfComposerSection.tsx');

describe('the course step — two views of one step', () => {
  it('the search shows until a course is picked or a typed name is added by hand', () => {
    expect(section).toContain("const courseShown = !!selectedCourse || (manualCourse && typedCourse !== '');");
    expect(section).toContain("{currentStep.id === 'course' && !courseShown && (");
    expect(section).toContain("{currentStep.id === 'course' && courseShown && (");
    expect(section).toContain('data-course-view="search"');
    expect(section).toContain('data-course-view="selected"');
    // A restored draft has the name but not the catalog row: it is a typed course.
    expect(section).toContain('useState<boolean>(() => !!seed?.sharedRoundDetails?.courseName?.trim())');
  });
  it('the slot is the round\'s course name; Near me asks for the location only on its tap', () => {
    expect(section).toContain('value={sharedRoundDetails.courseName}');
    expect(section).toContain('placeholder="Search courses"');
    expect(section.match(/findNearMe\(\)/g)?.length).toBe(1);
    expect(section).toContain('onClick={() => void findNearMe()}');
    expect(section.match(/requestPosition\(\)/g)?.length).toBe(1);
  });
  it('the list is in the flow — no floating panel, nothing to scroll into view', () => {
    expect(section).toContain('data-course-results=""');
    expect(section).not.toContain('max-h-60');
    expect(section).not.toContain('scrollIntoView');
    expect(section).not.toContain('courseDropdownRef');
  });
  it('Recent is asked once per visit and never stored; a pick runs the same selectCourse', () => {
    expect(section).toContain("fetch('/api/golf/courses?recent=1'");
    expect(section).toContain('<CourseRow key={course.id} course={course} showKm={false} divided={i > 0} onPick={selectCourse} />');
    const route = read('src/app/api/golf/courses/route.ts');
    expect(route).toContain("searchParams.get('recent') === '1'");
    expect(route).toContain("if (!viewerId) return NextResponse.json({ courses: [] }, { headers });");
    expect(route).toMatch(/recent[\s\S]{0,400}'Cache-Control': 'private, no-store'/);
    expect(route).toContain(".eq('profile_id', viewerId)");
    expect(route).toContain(".eq('creator_id', viewerId)");
  });
});

describe('the picked course — the visuals drive the round', () => {
  it('a tee row runs the tee handler: the rating, the slope and the hole yardages re-fill', () => {
    expect(section).toContain('<TeeTable tees={teeRows} value={sharedRoundDetails.teeColor} onPick={pickTee} />');
    const pick = section.slice(section.indexOf('const pickTee = (tee: string) => {'), section.indexOf('const ratingTyped ='));
    expect(pick).toContain('teeColor: tee,');
    expect(pick).toContain('course.courseRating?.[tee]');
    expect(pick).toContain('course.slopeRating?.[tee]');
    expect(pick).toContain('deriveCourseHoles(course, tee,');
    // The Tees select is gone: one picker.
    expect(section).not.toContain('<select\n                value={sharedRoundDetails.teeColor}');
  });
  it('the rows are the old select\'s options; Men | Women only splits them', () => {
    expect(section).toContain('isMapSheet(selectedCourse?.sheetSource) ? [...FALLBACK_TEES] : courseTeeOptions(selectedCourse)');
    expect(section).toContain('(bothTeeSides ? splitTeeSides(teeKeys)[teeSide] : teeKeys)');
    expect(section).toContain('{bothTeeSides && (');
    // Indoor: no tee, as before.
    expect(section).toContain("{sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor' && (");
  });
  it('rating and slope are typed only where the card cannot answer, and the dials read the round\'s values', () => {
    expect(section).toContain('const ratingTyped = ratingEntryNeeded(selectedCourse, sharedRoundDetails.teeColor);');
    expect(section).toContain('{ratingTyped && (');
    expect(section).toContain('rating={ratingShown ? dialValue(sharedRoundDetails.courseRating) : null}');
    expect(section).toContain('slope={ratingShown ? dialValue(sharedRoundDetails.slopeRating) : null}');
  });
  it('the course card is the SAME card in its utility-row dress; nothing about its lookups changed', () => {
    expect(section).toContain('variant="mech"');
    expect(section).toContain('autoFindSheet');
    const card = read('src/components/golf/CourseInfoCard.tsx');
    expect(card).toMatch(/variant = 'card'/);
    for (const hook of ['data-course-show-map=""', 'data-course-show-scorecard=""', 'data-course-find-sheet=""', 'data-course-sheet-none=""', 'data-course-scorecard=""']) {
      expect(card.match(new RegExp(hook.replace(/[=""]/g, m => `\\${m}`), 'g'))?.length, hook).toBe(1);
    }
  });
  it('"Change" lets a catalog course go the way editing its name did; a typed name stays to be corrected', () => {
    const change = section.slice(section.indexOf('const changeCourse = () => {'), section.indexOf('const noCourseFound ='));
    expect(change).toContain('if (!selectedCourse) return;');
    expect(change).toContain('setSelectedCourse(null);');
    expect(change).toContain('courseId: null,');
    expect(change).toContain('courseComposition: null,');
    expect(change).toContain("(FALLBACK_TEES as readonly string[]).includes(prev.teeColor) ? prev.teeColor : ''");
  });
  it('the logo\'s credit is Logo.dev\'s own component, shown with the logo', () => {
    expect(section).toContain('<LogoDevAttribution');
    expect(section).toContain('logoUrl(websiteDomain(selectedCourse.website) ?? undefined, 44)');
  });
});

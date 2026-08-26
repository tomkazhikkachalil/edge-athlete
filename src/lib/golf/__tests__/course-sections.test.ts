import { describe, it, expect } from 'vitest';
import {
  parseComposition,
  combineNineRatings,
  composeCourses,
  buildComposition,
} from '../course-sections';
import type { CourseHole, GolfCourse } from '@/types/golf';

const FRONT_ID = '11111111-1111-4111-8111-111111111111';
const BACK_ID = '22222222-2222-4222-8222-222222222222';

function nine(offsetPar = 0): CourseHole[] {
  return Array.from({ length: 9 }, (_, i) => ({
    number: i + 1,
    par: (i % 3 === 0 ? 5 : i % 3 === 1 ? 4 : 3) + offsetPar,
    yardage: { white: 350 + i, red: 300 + i },
    handicap: i + 1,
  }));
}

function nineCourse(id: string, sectionName: string, holes = nine()): GolfCourse {
  return {
    id,
    name: `Club (${sectionName})`,
    sectionName,
    sectionKind: 'nine',
    holes,
    totalPar: holes.reduce((s, h) => s + h.par, 0),
    holesCount: 9,
    courseRating: { white: 35.2, red: 34.1 },
    slopeRating: { white: 120, red: 115 },
  };
}

describe('parseComposition', () => {
  const valid = [
    { course_id: FRONT_ID, section_name: 'North', holes: '1-9' },
    { course_id: BACK_ID, section_name: 'South', holes: '10-18' },
  ];

  it('accepts a valid two-nine composition and orders front first', () => {
    const flipped = [valid[1], valid[0]];
    const parsed = parseComposition(flipped);
    expect(parsed).not.toBeNull();
    expect(parsed![0].holes).toBe('1-9');
    expect(parsed![1].course_id).toBe(BACK_ID);
  });

  it('accepts a null section_name', () => {
    expect(parseComposition([
      { course_id: FRONT_ID, section_name: null, holes: '1-9' },
      { course_id: BACK_ID, holes: '10-18' },
    ])).not.toBeNull();
  });

  it('rejects non-arrays, wrong lengths, and duplicates', () => {
    expect(parseComposition(null)).toBeNull();
    expect(parseComposition('[]')).toBeNull();
    expect(parseComposition([valid[0]])).toBeNull();
    expect(parseComposition([...valid, valid[0]])).toBeNull();
    // same half twice
    expect(parseComposition([valid[0], { ...valid[1], holes: '1-9' }])).toBeNull();
    // same course both halves
    expect(parseComposition([valid[0], { ...valid[1], course_id: FRONT_ID }])).toBeNull();
  });

  it('rejects malformed ids, holes ranges, and section types', () => {
    expect(parseComposition([{ ...valid[0], course_id: 'not-a-uuid' }, valid[1]])).toBeNull();
    expect(parseComposition([{ ...valid[0], holes: '1-18' }, valid[1]])).toBeNull();
    expect(parseComposition([{ ...valid[0], section_name: 42 }, valid[1]])).toBeNull();
  });
});

describe('combineNineRatings (WHS combination math)', () => {
  it('sums ratings and averages slopes, rounding to the standard precision', () => {
    expect(combineNineRatings({ rating: 35.2, slope: 121 }, { rating: 36.1, slope: 126 }))
      .toEqual({ rating: 71.3, slope: 124 }); // 123.5 rounds up
  });

  it('never fabricates when a side is missing or implausible', () => {
    expect(combineNineRatings({ rating: 35.2, slope: 121 }, {})).toEqual({ rating: undefined, slope: undefined });
    // 71.4 is an 18-hole rating — implausible for a NINE
    expect(combineNineRatings({ rating: 71.4 }, { rating: 35.0 }).rating).toBeUndefined();
    expect(combineNineRatings({ slope: 20 }, { slope: 120 }).slope).toBeUndefined();
  });
});

describe('composeCourses', () => {
  it('renumbers the back nine +9 and sums par', () => {
    const front = nineCourse(FRONT_ID, 'North');
    const back = nineCourse(BACK_ID, 'South');
    const combo = composeCourses(front, back, 'Ottawa Hunt and Golf Club');
    expect(combo).not.toBeNull();
    expect(combo!.id).toBe(FRONT_ID); // course_id convention: front row
    expect(combo!.name).toBe('Ottawa Hunt and Golf Club (North & South)');
    expect(combo!.holes.map(h => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(combo!.holes[9].par).toBe(back.holes[0].par); // hole 10 = back's hole 1
    expect(combo!.totalPar).toBe(front.totalPar + back.totalPar);
    expect(combo!.holesCount).toBe(18);
    // Combined per-tee ratings: sum / rounded average
    expect(combo!.courseRating.white).toBeCloseTo(70.4, 5);
    expect(combo!.slopeRating.white).toBe(120);
    // The combo is no longer a "section"
    expect(combo!.sectionName).toBeUndefined();
  });

  it('drops tees not present on both nines', () => {
    const front = nineCourse(FRONT_ID, 'North');
    const back = nineCourse(BACK_ID, 'South');
    back.courseRating = { white: 36.0 };
    back.slopeRating = { white: 118 };
    const combo = composeCourses(front, back)!;
    expect(Object.keys(combo.courseRating)).toEqual(['white']);
    expect(combo.slopeRating.red).toBeUndefined();
  });

  it('degrades to identity-only (no holes, default par) when a side lacks a full nine', () => {
    const front = nineCourse(FRONT_ID, 'North');
    const partial = composeCourses(front, nineCourse(BACK_ID, 'South', nine().slice(0, 8)));
    expect(partial.holes).toEqual([]);
    expect(partial.totalPar).toBe(72);
    expect(partial.holesCount).toBe(18);
    expect(partial.id).toBe(FRONT_ID);
    // Ratings still combine when present — they come from the row, not holes
    expect(partial.courseRating.white).toBeCloseTo(70.4, 5);
    const thin = composeCourses(front, nineCourse(BACK_ID, 'South', []));
    expect(thin.holes).toEqual([]);
  });

  it('ignores out-of-range hole numbers defensively', () => {
    const weird = nineCourse(BACK_ID, 'South', [
      ...nine(),
      { number: 12, par: 4, yardage: {}, handicap: 3 },
    ]);
    const combo = composeCourses(nineCourse(FRONT_ID, 'North'), weird)!;
    expect(combo.holes).toHaveLength(18);
    expect(Math.max(...combo.holes.map(h => h.number))).toBe(18);
  });
});

describe('buildComposition', () => {
  it('round-trips through parseComposition', () => {
    const built = buildComposition(nineCourse(FRONT_ID, 'North'), nineCourse(BACK_ID, 'South'));
    expect(parseComposition(built)).toEqual([
      { course_id: FRONT_ID, section_name: 'North', holes: '1-9' },
      { course_id: BACK_ID, section_name: 'South', holes: '10-18' },
    ]);
  });
});

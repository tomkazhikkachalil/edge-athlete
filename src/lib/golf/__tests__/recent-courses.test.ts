import { describe, expect, it } from 'vitest';
import { RECENT_COURSES_MAX, recentCourseIds } from '../recent-courses';

describe('recentCourseIds — the course step\'s RECENT list', () => {
  it('each course once, by its NEWEST round, whichever place the round lives in', () => {
    const rows = [
      { course_id: 'a', at: '2026-11-01T10:00:00Z' }, // an individual round
      { course_id: 'b', at: '2026-11-20T10:00:00Z' }, // a live round
      { course_id: 'a', at: '2026-11-22T10:00:00Z' },
      { course_id: 'c', at: '2026-10-05T10:00:00Z' },
    ];
    expect(recentCourseIds(rows)).toEqual(['a', 'b', 'c']);
  });
  it('rows with the same time keep the order given; a row without a time sorts last', () => {
    expect(recentCourseIds([{ course_id: 'x' }, { course_id: 'y' }])).toEqual(['x', 'y']);
    expect(recentCourseIds([{ course_id: 'old' }, { course_id: 'new', at: '2026-11-22T10:00:00Z' }, { course_id: 'junk', at: 'not a date' }])).toEqual(['new', 'old', 'junk']);
  });
  it('a round on a typed course (no id) and junk are skipped', () => {
    expect(recentCourseIds([{ course_id: null }, {}, { course_id: '' }, { course_id: 7 }, { course_id: 'a' }])).toEqual(['a']);
    expect(recentCourseIds([])).toEqual([]);
  });
  it('capped at five by default, or at the number asked', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ course_id: `c${i}` }));
    expect(recentCourseIds(rows)).toHaveLength(RECENT_COURSES_MAX);
    expect(recentCourseIds(rows, 2)).toEqual(['c0', 'c1']);
  });
});

import { describe, it, expect } from 'vitest';
import { courseSummary, mappingGaps, teeChoiceLabel } from '../course-summary';

// M3: the summary card's two pure rules.

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i % 3 === 0 ? 5 : 4, yardage: { white: 350 + i, blue: i === 4 ? 0 : 380 + i }, handicap: i + 1 }));
const course = { holes, holesCount: 18, totalPar: 72, courseRating: { white: 70.1, blue: 71.9 }, slopeRating: { white: 125, blue: 133 } };

describe('courseSummary', () => {
  it('totals per tee — a sparse tee has NO total, never a partial sum', () => {
    const s = courseSummary(course);
    expect(s.holeCount).toBe(18);
    expect(s.par).toBe(holes.reduce((a, h) => a + h.par, 0));
    const white = s.tees.find(t => t.key === 'white')!;
    expect(white.yards).toBe(holes.reduce((a, h) => a + h.yardage.white, 0));
    expect(white).toMatchObject({ label: 'White', rating: 70.1, slope: 125 });
    expect(s.tees.find(t => t.key === 'blue')!.yards).toBeNull();
  });
  it('the tee in play leads; the rated order otherwise', () => {
    expect(courseSummary(course).tees[0].key).toBe('blue'); // hardest first
    expect(courseSummary(course, 'white').tees[0].key).toBe('white');
  });
  it('falls back to holesCount / totalPar when there are no holes; nothing invented', () => {
    expect(courseSummary({ holes: [], holesCount: 9, totalPar: 36, courseRating: {}, slopeRating: {} })).toEqual({ holeCount: 9, par: 36, tees: [] });
    expect(courseSummary({ holes: [], holesCount: undefined, totalPar: 0, courseRating: {}, slopeRating: {} })).toEqual({ holeCount: null, par: null, tees: [] });
  });
});

describe('mappingGaps', () => {
  const lines = [{ line: [[45, -75], [45.001, -75]] as [number, number][] }];
  it('nothing missing', () => {
    expect(mappingGaps({ holes, teeInPlay: 'white', geometry: lines })).toEqual([]);
  });
  it('no hole data; a tee without a yardage on every hole; no lines', () => {
    expect(mappingGaps({ holes: [], geometry: lines })).toEqual(['no-hole-data']);
    expect(mappingGaps({ holes, teeInPlay: 'blue', geometry: lines })).toEqual(['no-yardage-for-tee']);
    expect(mappingGaps({ holes, teeInPlay: 'white', geometry: null })).toEqual(['no-map-lines']);
    expect(mappingGaps({ holes: [], geometry: [] })).toEqual(['no-hole-data', 'no-map-lines']);
  });
  it('geometry not asked yet makes no claim', () => {
    expect(mappingGaps({ holes, geometry: undefined })).toEqual([]);
  });
});

describe('mappingGaps — greens-only (PR 3)', () => {
  it('drawn greens with no lines is the softer gap, not "no map lines"', () => {
    expect(mappingGaps({ holes, teeInPlay: 'white', geometry: null, greensOnly: true })).toEqual(['greens-only']);
    expect(mappingGaps({ holes, teeInPlay: 'white', geometry: [], greensOnly: false })).toEqual(['no-map-lines']);
  });
});

// The golf steps (Oct 29 2026): the tee select names each tee with what the
// course knows — yardage, rating / slope — and nothing it does not.
describe('teeChoiceLabel — the tee as a choice', () => {
  it('name · yards · rating / slope when the course knows all three', () => {
    expect(teeChoiceLabel({ key: 'white', label: 'White', yards: 6412, rating: 71.2, slope: 128 })).toBe('White · 6,412 yds · 71.2 / 128');
  });
  it('drops what is unknown: a name alone stays a name', () => {
    expect(teeChoiceLabel({ key: 'blue', label: 'Blue', yards: null, rating: null, slope: null })).toBe('Blue');
    expect(teeChoiceLabel({ key: 'blue', label: 'Blue', yards: 6800, rating: null, slope: null })).toBe('Blue · 6,800 yds');
    expect(teeChoiceLabel({ key: 'blue', label: 'Blue', yards: null, rating: 72.9, slope: null })).toBe('Blue · 72.9 rating');
    expect(teeChoiceLabel({ key: 'blue', label: 'Blue', yards: null, rating: null, slope: 131 })).toBe('Blue · slope 131');
  });
});

import { describe, it, expect } from 'vitest';
import { mergeSheets, sheetsAgree, sheetGaps, sheetComplete, type Sheet, type SheetHole } from '../sheet-merge';

const hole = (number: number, par: number, yardage: Record<string, number> = {}, handicap = 0): SheetHole => ({ number, par, yardage, handicap });
const nine = (yardage: (n: number) => Record<string, number>, handicap = 0, par = 4): SheetHole[] =>
  Array.from({ length: 9 }, (_, i) => hole(i + 1, par, yardage(i + 1), handicap ? i + 1 : 0));
const sheet = (over: Partial<Sheet> = {}): Sheet => ({ total_par: null, holes_count: null, hole_data: null, course_rating: {}, slope_rating: {}, ...over });

describe('sheetsAgree', () => {
  it('an empty side has nothing to disagree with', () => {
    expect(sheetsAgree([], nine(() => ({})))).toBe(true);
  });
  it('two pars may differ, three may not', () => {
    const a = nine(() => ({}));
    const two = a.map(h => (h.number <= 2 ? { ...h, par: 5 } : h));
    const three = a.map(h => (h.number <= 3 ? { ...h, par: 5 } : h));
    expect(sheetsAgree(a, two)).toBe(true);
    expect(sheetsAgree(a, three)).toBe(false);
  });
  it('a nine fits inside an eighteen; holes the other lacks do not', () => {
    const eighteen = [...nine(() => ({})), ...nine(() => ({})).map(h => ({ ...h, number: h.number + 9 }))];
    expect(sheetsAgree(nine(() => ({})), eighteen)).toBe(true);
    expect(sheetsAgree(nine(() => ({})).map(h => ({ ...h, number: h.number + 20 })), eighteen)).toBe(false);
  });
});

describe('mergeSheets — a stored card never gets poorer', () => {
  const rich = sheet({
    total_par: 36, holes_count: 9,
    hole_data: nine(n => ({ blue: 400 + n, white: 380 + n }), 1),
    course_rating: { blue: 71.2, white: 69.8 }, slope_rating: { blue: 128, white: 122 },
  });

  it('a thinner answer (one tee, no stroke index, no ratings) removes nothing', () => {
    const thin = sheet({ total_par: 36, holes_count: 9, hole_data: nine(n => ({ white: 300 + n })) });
    const m = mergeSheets(rich, thin);
    expect(m.refused).toBe(false);
    expect(m.changed).toBe(false);
    expect(m.sheet).toEqual(rich);
  });

  it('an empty answer keeps the card', () => {
    expect(mergeSheets(rich, sheet()).sheet).toEqual(rich);
  });

  it('fills a new tee, a missing stroke index, a missing rating and slope', () => {
    const stored = sheet({ hole_data: nine(n => ({ white: 380 + n })), course_rating: { white: 69.8 }, slope_rating: {} });
    const incoming = sheet({ total_par: 36, hole_data: nine(n => ({ white: 999, gold: 340 + n }), 1), course_rating: { white: 1, gold: 67.5 }, slope_rating: { white: 122, gold: 117 } });
    const m = mergeSheets(stored, incoming);
    expect(m.changed).toBe(true);
    expect(m.sheet.hole_data?.[0]).toEqual({ number: 1, par: 4, yardage: { white: 381, gold: 341 }, handicap: 1 });
    expect(m.sheet.course_rating).toEqual({ white: 69.8, gold: 67.5 });
    expect(m.sheet.slope_rating).toEqual({ white: 122, gold: 117 });
    expect(m.sheet.total_par).toBe(36);
  });

  it('a stored zero yardage is a gap the answer fills', () => {
    const stored = sheet({ hole_data: nine(() => ({ white: 0 })) });
    const m = mergeSheets(stored, sheet({ hole_data: nine(n => ({ white: 380 + n })) }));
    expect(m.sheet.hole_data?.[8].yardage).toEqual({ white: 389 });
  });

  it('an answer that is a different course is refused whole, ratings included', () => {
    const other = sheet({ hole_data: nine(() => ({ red: 250 }), 1, 5), course_rating: { red: 66 }, slope_rating: { red: 110 } });
    const m = mergeSheets(rich, other);
    expect(m.refused).toBe(true);
    expect(m.sheet).toBe(rich);
  });

  it('no stored card: the answer is the card', () => {
    const incoming = sheet({ total_par: 36, holes_count: 9, hole_data: nine(n => ({ white: 380 + n }), 1), course_rating: { white: 69.8 }, slope_rating: { white: 122 } });
    const m = mergeSheets(sheet({ course_rating: null, slope_rating: null }), incoming);
    expect(m.changed).toBe(true);
    expect(m.sheet).toEqual(incoming);
  });

  it('the women\'s keys ("white (f)") are tees like any other', () => {
    const stored = sheet({ hole_data: nine(() => ({ white: 380 })), course_rating: { white: 69.8 }, slope_rating: { white: 122 } });
    const m = mergeSheets(stored, sheet({ hole_data: nine(() => ({ white: 380 })), course_rating: { 'white (f)': 74.1 }, slope_rating: { 'white (f)': 130 } }));
    expect(m.sheet.course_rating).toEqual({ white: 69.8, 'white (f)': 74.1 });
  });

  it('a nine grows to the eighteen that contains it, keeping its own values', () => {
    const back = nine(n => ({ white: 500 + n })).map(h => ({ ...h, number: h.number + 9 }));
    const stored = sheet({ total_par: 36, holes_count: 9, hole_data: nine(n => ({ white: 380 + n })) });
    const m = mergeSheets(stored, sheet({ total_par: 72, holes_count: 18, hole_data: [...nine(() => ({ white: 1 })), ...back] }));
    expect(m.sheet.hole_data).toHaveLength(18);
    expect(m.sheet.hole_data?.[0].yardage).toEqual({ white: 381 });
    expect(m.sheet.holes_count).toBe(18);
    expect(m.sheet.total_par).toBe(72);
  });
});

describe('sheetGaps', () => {
  it('names what a card still lacks', () => {
    expect(sheetGaps(sheet())).toEqual(['pars', 'yardage', 'strokeIndex', 'ratings']);
    expect(sheetGaps(sheet({ hole_data: nine(() => ({})) }))).toEqual(['yardage', 'strokeIndex', 'ratings']);
    expect(sheetGaps(sheet({ hole_data: nine(() => ({ white: 380 }), 1), course_rating: { white: 69.8 } }))).toEqual(['ratings']);
    expect(sheetComplete(sheet({ hole_data: nine(() => ({ white: 380 }), 1), course_rating: { white: 69.8 }, slope_rating: { white: 122 } }))).toBe(true);
  });
});

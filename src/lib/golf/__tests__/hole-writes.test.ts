import { describe, expect, it } from 'vitest';
import { detectHoleConflict, holeRow, parseExpectedVersion, planHoleWrites, type HoleCurrent } from '../hole-writes';

const row = (version: number, strokes = 4): HoleCurrent => ({ version, strokes, putts: null, fairway_hit: null, green_in_regulation: null, penalties: null });

describe('detectHoleConflict — the per-hole CAS verdict', () => {
  it('unchecked (absent) is never a conflict, whatever is live', () => {
    expect(detectHoleConflict(undefined, null)).toBe(false);
    expect(detectHoleConflict(undefined, 7)).toBe(false);
    expect(detectHoleConflict(null, 7)).toBe(false);
  });
  it('expected 0 = "I saw no score": a live row is a conflict, none is not', () => {
    expect(detectHoleConflict(0, null)).toBe(false);
    expect(detectHoleConflict(0, 1)).toBe(true);
  });
  it('expected n matches only the same live version; a vanished row conflicts', () => {
    expect(detectHoleConflict(3, 3)).toBe(false);
    expect(detectHoleConflict(3, 4)).toBe(true);
    expect(detectHoleConflict(3, 2)).toBe(true);
    expect(detectHoleConflict(3, null)).toBe(true);
  });
});

describe('parseExpectedVersion', () => {
  it('absent → undefined; a non-negative integer → itself; anything else → null (400 by name)', () => {
    expect(parseExpectedVersion(undefined)).toBeUndefined();
    expect(parseExpectedVersion(null)).toBeUndefined();
    expect(parseExpectedVersion(0)).toBe(0);
    expect(parseExpectedVersion(12)).toBe(12);
    expect(parseExpectedVersion(-1)).toBeNull();
    expect(parseExpectedVersion(1.5)).toBeNull();
    expect(parseExpectedVersion('3')).toBeNull();
  });
});

describe('planHoleWrites — inserts, updates, unchecked, conflicts', () => {
  const live = new Map<number, HoleCurrent>([[3, row(2, 6)], [4, row(1)]]);
  it('routes every shape and carries the current row on a conflict', () => {
    const plan = planHoleWrites([
      { hole_number: 2, strokes: 4, expected_version: 0 },          // no row → insert
      { hole_number: 3, strokes: 5, expected_version: 1 },          // live at 2 → conflict with the row
      { hole_number: 4, strokes: 4, expected_version: 1 },          // live at 1 → update
      { hole_number: 5, strokes: 3 },                               // unchecked
      { hole_number: 6, strokes: 4, expected_version: 2 },          // no row, expected 2 → conflict, current null
      { hole_number: 3, strokes: 5, expected_version: 0 },          // a row exists → conflict
    ], live);
    expect(plan.inserts.map(s => s.hole_number)).toEqual([2]);
    expect(plan.updates.map(s => s.hole_number)).toEqual([4]);
    expect(plan.unchecked.map(s => s.hole_number)).toEqual([5]);
    expect(plan.conflicts).toEqual([
      { hole_number: 3, current: row(2, 6) },
      { hole_number: 6, current: null },
      { hole_number: 3, current: row(2, 6) },
    ]);
  });
  it('the false-conflict regression: holes 2 and 4 pass while hole 3 conflicts', () => {
    const plan = planHoleWrites([
      { hole_number: 2, strokes: 4, expected_version: 0 },
      { hole_number: 3, strokes: 5, expected_version: 0 },
      { hole_number: 4, strokes: 5, expected_version: 1 },
    ], live);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(1);
    expect(plan.conflicts.map(c => c.hole_number)).toEqual([3]);
  });
});

describe('holeRow — penalties ride only when named', () => {
  it('omits the penalties key when the write does not carry it; [] clears; null clears', () => {
    expect(holeRow('gp1', { hole_number: 1, strokes: 4 })).toEqual({ golf_participant_id: 'gp1', hole_number: 1, strokes: 4, putts: null, fairway_hit: null, green_in_regulation: null });
    expect(holeRow('gp1', { hole_number: 1, strokes: 4, penalties: [] }).penalties).toEqual([]);
    expect(holeRow('gp1', { hole_number: 1, strokes: 4, penalties: null }).penalties).toBeNull();
    expect(holeRow('gp1', { hole_number: 1, strokes: 4, putts: 2, fairway_hit: true, green_in_regulation: false, penalties: ['water'] })).toMatchObject({ putts: 2, fairway_hit: true, green_in_regulation: false, penalties: ['water'] });
  });
});
